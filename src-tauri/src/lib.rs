use redis::Value;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Number, Value as JsonValue};
use std::collections::HashMap;
use url::Url;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedisConnectionTestInput {
    host: String,
    port: u16,
    password: Option<String>,
    db: i64,
    tls: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedisKeyLookupInput {
    connection: RedisConnectionTestInput,
    key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedisCommandInput {
    connection: RedisConnectionTestInput,
    command: String,
}

#[derive(Debug, Serialize)]
struct RedisKeySummary {
    key: String,
    #[serde(rename = "type")]
    key_type: String,
    ttl: i64,
}

#[derive(Debug, Serialize)]
struct RedisKeyValueResponse {
    key: String,
    #[serde(rename = "type")]
    key_type: String,
    ttl: i64,
    value: JsonValue,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn build_connection_url(input: &RedisConnectionTestInput) -> Result<Url, String> {
    let scheme = if input.tls { "rediss" } else { "redis" };
    let mut url = Url::parse(&format!("{scheme}://localhost"))
        .map_err(|error| format!("Failed to build connection URL: {error}"))?;

    url.set_host(Some(&input.host))
        .map_err(|_| "Invalid host".to_string())?;
    url.set_port(Some(input.port))
        .map_err(|_| "Invalid port".to_string())?;
    url.set_path(&format!("/{}", input.db));

    if let Some(password) = input.password.as_deref().filter(|password| !password.is_empty()) {
        url.set_password(Some(password))
            .map_err(|_| "Invalid password".to_string())?;
    }

    Ok(url)
}

async fn open_connection(
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

fn normalize_key_type(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();

    if lower.contains("json") {
        return "json".to_string();
    }

    match lower.as_str() {
        "string" | "hash" | "list" | "set" | "zset" | "stream" | "json" => lower,
        _ => "string".to_string(),
    }
}

fn redis_value_to_json(value: Value) -> JsonValue {
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

fn format_cli_output(value: Value) -> String {
    match redis_value_to_json(value) {
        JsonValue::Null => "(nil)".to_string(),
        JsonValue::String(text) => text,
        json => serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string()),
    }
}

#[tauri::command]
async fn test_redis_connection(input: RedisConnectionTestInput) -> Result<(), String> {
    let mut connection = open_connection(&input).await?;

    let response: String = redis::cmd("PING")
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Redis ping failed: {error}"))?;

    if response != "PONG" {
        return Err(format!("Unexpected Redis response: {response}"));
    }

    Ok(())
}

#[tauri::command]
async fn list_redis_keys(input: RedisConnectionTestInput) -> Result<Vec<RedisKeySummary>, String> {
    let mut connection = open_connection(&input).await?;
    let mut cursor = 0_u64;
    let mut collected_keys: Vec<String> = Vec::new();

    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("COUNT")
            .arg(200)
            .query_async(&mut connection)
            .await
            .map_err(|error| format!("Failed to scan keys: {error}"))?;

        collected_keys.extend(batch);
        cursor = next_cursor;

        if cursor == 0 || collected_keys.len() >= 5_000 {
            break;
        }
    }

    collected_keys.sort();
    collected_keys.dedup();

    let mut keys = Vec::with_capacity(collected_keys.len());

    for key in collected_keys {
        let metadata = redis::pipe()
            .cmd("TYPE")
            .arg(&key)
            .cmd("TTL")
            .arg(&key)
            .query_async::<(String, i64)>(&mut connection)
            .await;

        let Ok((raw_type, ttl)) = metadata else {
            continue;
        };

        if raw_type == "none" {
            continue;
        }

        keys.push(RedisKeySummary {
            key,
            key_type: normalize_key_type(&raw_type),
            ttl,
        });
    }

    Ok(keys)
}

#[tauri::command]
async fn get_redis_key_value(input: RedisKeyLookupInput) -> Result<RedisKeyValueResponse, String> {
    let mut connection = open_connection(&input.connection).await?;
    let (raw_type, ttl) = redis::pipe()
        .cmd("TYPE")
        .arg(&input.key)
        .cmd("TTL")
        .arg(&input.key)
        .query_async::<(String, i64)>(&mut connection)
        .await
        .map_err(|error| format!("Failed to inspect key: {error}"))?;

    if raw_type == "none" {
        return Err("Key no longer exists".to_string());
    }

    let key_type = normalize_key_type(&raw_type);

    let value = match key_type.as_str() {
        "string" => {
            let value: Option<String> = redis::cmd("GET")
                .arg(&input.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get string value: {error}"))?;

            JsonValue::String(value.unwrap_or_default())
        }
        "hash" => {
            let entries: HashMap<String, String> = redis::cmd("HGETALL")
                .arg(&input.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get hash value: {error}"))?;

            JsonValue::Object(
                entries
                    .into_iter()
                    .map(|(field, value)| (field, JsonValue::String(value)))
                    .collect(),
            )
        }
        "list" => redis::cmd("LRANGE")
            .arg(&input.key)
            .arg(0)
            .arg(-1)
            .query_async::<Vec<String>>(&mut connection)
            .await
            .map(|items| JsonValue::Array(items.into_iter().map(JsonValue::String).collect()))
            .map_err(|error| format!("Failed to get list value: {error}"))?,
        "set" => redis::cmd("SMEMBERS")
            .arg(&input.key)
            .query_async::<Vec<String>>(&mut connection)
            .await
            .map(|items| JsonValue::Array(items.into_iter().map(JsonValue::String).collect()))
            .map_err(|error| format!("Failed to get set value: {error}"))?,
        "zset" => {
            let members: Vec<(String, f64)> = redis::cmd("ZRANGE")
                .arg(&input.key)
                .arg(0)
                .arg(-1)
                .arg("WITHSCORES")
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get sorted set value: {error}"))?;

            JsonValue::Array(
                members
                    .into_iter()
                    .map(|(member, score)| {
                        JsonValue::Object(JsonMap::from_iter([
                            ("member".to_string(), JsonValue::String(member)),
                            (
                                "score".to_string(),
                                Number::from_f64(score)
                                    .map(JsonValue::Number)
                                    .unwrap_or_else(|| JsonValue::String(score.to_string())),
                            ),
                        ]))
                    })
                    .collect(),
            )
        }
        "json" => {
            let json_text = match redis::cmd("JSON.GET")
                .arg(&input.key)
                .query_async::<String>(&mut connection)
                .await
            {
                Ok(value) => value,
                Err(_) => {
                    redis::cmd("GET")
                        .arg(&input.key)
                        .query_async::<String>(&mut connection)
                        .await
                        .map_err(|error| format!("Failed to get JSON value: {error}"))?
                }
            };

            JsonValue::String(json_text)
        }
        "stream" => {
            let stream_value: Value = redis::cmd("XRANGE")
                .arg(&input.key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(100)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get stream value: {error}"))?;

            JsonValue::String(format_cli_output(stream_value))
        }
        _ => JsonValue::Null,
    };

    Ok(RedisKeyValueResponse {
        key: input.key,
        key_type,
        ttl,
        value,
    })
}

#[tauri::command]
async fn run_redis_command(input: RedisCommandInput) -> Result<String, String> {
    let command_parts = shell_words::split(&input.command)
        .map_err(|error| format!("Failed to parse command: {error}"))?;

    if command_parts.is_empty() {
        return Err("Command is empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let mut command = redis::cmd(&command_parts[0]);

    for argument in &command_parts[1..] {
        command.arg(argument);
    }

    let result: Value = command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Command failed: {error}"))?;

    Ok(format_cli_output(result))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            test_redis_connection,
            list_redis_keys,
            get_redis_key_value,
            run_redis_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
