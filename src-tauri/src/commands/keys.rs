use crate::models::{
    RedisKeyLookupInput, RedisKeyRenameInput, RedisKeyRenamePairInput, RedisKeySummary,
    RedisKeyValueResponse, RedisKeysRenameInput,
};
use crate::redis_support::{format_cli_output, normalize_key_type, open_connection};
use redis::Value;
use serde_json::{Map as JsonMap, Number, Value as JsonValue};
use std::collections::HashMap;

#[tauri::command]
pub async fn list_redis_keys(
    input: crate::models::RedisConnectionTestInput,
) -> Result<Vec<RedisKeySummary>, String> {
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
pub async fn get_redis_key_value(
    input: RedisKeyLookupInput,
) -> Result<RedisKeyValueResponse, String> {
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
                Err(_) => redis::cmd("GET")
                    .arg(&input.key)
                    .query_async::<String>(&mut connection)
                    .await
                    .map_err(|error| format!("Failed to get JSON value: {error}"))?,
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
pub async fn rename_redis_key(input: RedisKeyRenameInput) -> Result<(), String> {
    if input.old_key.is_empty() {
        return Err("Source key cannot be empty".to_string());
    }

    if input.new_key.is_empty() {
        return Err("Key name cannot be empty".to_string());
    }

    if input.old_key == input.new_key {
        return Ok(());
    }

    let mut connection = open_connection(&input.connection).await?;
    let renamed: i64 = redis::cmd("RENAMENX")
        .arg(&input.old_key)
        .arg(&input.new_key)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to rename key: {error}"))?;

    if renamed == 0 {
        return Err("Target key already exists".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn rename_redis_keys(input: RedisKeysRenameInput) -> Result<(), String> {
    let renames: Vec<&RedisKeyRenamePairInput> = input
        .renames
        .iter()
        .filter(|item| item.old_key != item.new_key)
        .collect();

    if renames.is_empty() {
        return Ok(());
    }

    let namespace = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local namespace = ARGV[1]
local count = tonumber(ARGV[2])

if not count or count < 1 then
  return "OK"
end

local old_lookup = {}
local new_lookup = {}
local old_keys = {}
local new_keys = {}
local temp_keys = {}

for i = 1, count do
  local base = 2 + ((i - 1) * 2)
  local old_key = ARGV[base + 1]
  local new_key = ARGV[base + 2]

  if not old_key or old_key == "" then
    return redis.error_reply("Source key cannot be empty")
  end

  if not new_key or new_key == "" then
    return redis.error_reply("Target key cannot be empty")
  end

  if old_lookup[old_key] then
    return redis.error_reply("Duplicate source key: " .. old_key)
  end

  if new_lookup[new_key] then
    return redis.error_reply("Duplicate target key: " .. new_key)
  end

  old_lookup[old_key] = true
  new_lookup[new_key] = true
  old_keys[i] = old_key
  new_keys[i] = new_key
end

for i = 1, count do
  if redis.call("EXISTS", old_keys[i]) == 0 then
    return redis.error_reply("Source key does not exist: " .. old_keys[i])
  end
end

for i = 1, count do
  if redis.call("EXISTS", new_keys[i]) == 1 and not old_lookup[new_keys[i]] then
    return redis.error_reply("Target key already exists: " .. new_keys[i])
  end
end

for i = 1, count do
  local temp_key = "__neordm_tmp__:" .. namespace .. ":" .. i

  if redis.call("EXISTS", temp_key) == 1 then
    return redis.error_reply("Temporary key collision")
  end

  temp_keys[i] = temp_key
end

for i = 1, count do
  redis.call("RENAME", old_keys[i], temp_keys[i])
end

for i = 1, count do
  redis.call("RENAME", temp_keys[i], new_keys[i])
end

return "OK"
        "#,
    );

    let mut invocation = script.prepare_invoke();
    invocation.arg(namespace);
    invocation.arg(renames.len());

    for item in renames {
        invocation.arg(&item.old_key);
        invocation.arg(&item.new_key);
    }

    let _: String = invocation
        .invoke_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to rename keys: {error}"))?;

    Ok(())
}
