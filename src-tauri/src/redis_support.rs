use crate::models::RedisConnectionTestInput;
use redis::Value;
use serde_json::{Map as JsonMap, Number, Value as JsonValue};
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

pub(crate) fn redis_value_to_json(value: Value) -> JsonValue {
    match value {
        Value::Nil => JsonValue::Null,
        Value::Int(number) => JsonValue::Number(Number::from(number)),
        Value::BulkString(bytes) => JsonValue::String(String::from_utf8_lossy(&bytes).into_owned()),
        Value::Array(values) | Value::Set(values) => {
            JsonValue::Array(values.into_iter().map(redis_value_to_json).collect())
        }
        Value::SimpleString(value) => JsonValue::String(value),
        Value::Okay => JsonValue::String("OK".to_string()),
        Value::Map(entries) => {
            let mut object = JsonMap::new();
            let mut is_object = true;

            for (key, entry_value) in &entries {
                if let JsonValue::String(key) = redis_value_to_json(key.clone()) {
                    object.insert(key, redis_value_to_json(entry_value.clone()));
                } else {
                    is_object = false;
                    break;
                }
            }

            if is_object {
                JsonValue::Object(object)
            } else {
                JsonValue::Array(
                    entries
                        .into_iter()
                        .map(|(key, entry_value)| {
                            JsonValue::Object(JsonMap::from_iter([
                                ("key".to_string(), redis_value_to_json(key)),
                                ("value".to_string(), redis_value_to_json(entry_value)),
                            ]))
                        })
                        .collect(),
                )
            }
        }
        Value::Attribute { data, .. } => redis_value_to_json(*data),
        Value::Double(number) => Number::from_f64(number)
            .map(JsonValue::Number)
            .unwrap_or_else(|| JsonValue::String(number.to_string())),
        Value::Boolean(value) => JsonValue::Bool(value),
        Value::VerbatimString { text, .. } => JsonValue::String(text),
        Value::BigNumber(value) => JsonValue::String(value.to_string()),
        Value::Push { kind, data } => JsonValue::Object(JsonMap::from_iter([
            ("kind".to_string(), JsonValue::String(format!("{kind:?}"))),
            (
                "data".to_string(),
                JsonValue::Array(data.into_iter().map(redis_value_to_json).collect()),
            ),
        ])),
        Value::ServerError(error) => JsonValue::String(format!("{error:?}")),
    }
}

pub(crate) fn format_cli_output(value: Value) -> String {
    match redis_value_to_json(value) {
        JsonValue::Null => "(nil)".to_string(),
        JsonValue::String(text) => text,
        json => serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string()),
    }
}
