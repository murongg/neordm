use crate::models::RedisConnectionTestInput;
use redis::Value;
use url::Url;

fn build_connection_url(input: &RedisConnectionTestInput) -> Result<Url, String> {
    let scheme = if input.tls { "rediss" } else { "redis" };
    let mut url = Url::parse(&format!("{scheme}://localhost"))
        .map_err(|error| format!("Failed to build connection URL: {error}"))?;

    url.set_host(Some(&input.host))
        .map_err(|_| "Invalid host".to_string())?;
    url.set_port(Some(input.port))
        .map_err(|_| "Invalid port".to_string())?;
    url.set_path(&format!("/{}", input.db));

    if let Some(password) = input
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
    {
        url.set_password(Some(password))
            .map_err(|_| "Invalid password".to_string())?;
    }

    Ok(url)
}

pub(crate) async fn open_connection(
    input: &RedisConnectionTestInput,
) -> Result<redis::aio::MultiplexedConnection, String> {
    let url = build_connection_url(input)?;
    let client = redis::Client::open(url.as_str())
        .map_err(|error| format!("Failed to create Redis client: {error}"))?;

    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Failed to connect to Redis: {error}"))
}

pub(crate) fn normalize_key_type(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();

    if lower.contains("json") {
        return "json".to_string();
    }

    match lower.as_str() {
        "string" | "hash" | "list" | "set" | "zset" | "stream" | "json" => lower,
        _ => "string".to_string(),
    }
}

fn quote_cli_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("{text:?}"))
}

fn format_cli_multiline(prefix: &str, value: &str) -> String {
    let mut lines = value.lines();
    let first_line = lines.next().unwrap_or_default();
    let continuation_padding = " ".repeat(prefix.len());
    let mut output = format!("{prefix}{first_line}");

    for line in lines {
        output.push('\n');
        output.push_str(&continuation_padding);
        output.push_str(line);
    }

    output
}

fn format_cli_sequence(values: Vec<Value>) -> String {
    if values.is_empty() {
        return "(empty array)".to_string();
    }

    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let prefix = format!("{}) ", index + 1);
            format_cli_multiline(&prefix, &format_cli_value(value))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_cli_value(value: Value) -> String {
    match value {
        Value::Nil => "(nil)".to_string(),
        Value::Int(number) => format!("(integer) {number}"),
        Value::BulkString(bytes) => quote_cli_string(&String::from_utf8_lossy(&bytes)),
        Value::Array(values) | Value::Set(values) => format_cli_sequence(values),
        Value::SimpleString(value) => value,
        Value::Okay => "OK".to_string(),
        Value::Map(entries) => {
            let mut flattened = Vec::with_capacity(entries.len() * 2);

            for (key, value) in entries {
                flattened.push(key);
                flattened.push(value);
            }

            format_cli_sequence(flattened)
        }
        Value::Attribute { data, .. } => format_cli_value(*data),
        Value::Double(number) => format!("(double) {number}"),
        Value::Boolean(value) => format!("(boolean) {}", if value { "true" } else { "false" }),
        Value::VerbatimString { text, .. } => quote_cli_string(&text),
        Value::BigNumber(value) => format!("(bignumber) {value}"),
        Value::Push { kind, data } => {
            if data.is_empty() {
                format!("(push {kind:?})")
            } else {
                format_cli_multiline(&format!("(push {kind:?}) "), &format_cli_sequence(data))
            }
        }
        Value::ServerError(error) => format!("(error) {error:?}"),
    }
}

pub(crate) fn format_cli_output(value: Value) -> String {
    format_cli_value(value)
}
