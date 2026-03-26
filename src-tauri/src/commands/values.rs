use crate::models::{
    RedisHashEntryAddInput, RedisHashEntryDeleteInput, RedisHashEntryUpdateInput,
    RedisJsonValueUpdateInput, RedisKeyCreateEntryInput, RedisKeyCreateInput,
    RedisKeyCreateMemberInput, RedisKeySummary, RedisListValueAppendInput,
    RedisListValueDeleteInput, RedisListValueUpdateInput, RedisSetMemberAddInput,
    RedisStringValueUpdateInput, RedisZSetEntryAddInput, RedisZSetEntryDeleteInput,
    RedisZSetEntryUpdateInput,
};
use crate::redis_support::{normalize_key_type, open_connection};
use serde_json::Value as JsonValue;

fn require_text<'a>(value: Option<&'a str>, field_name: &str) -> Result<&'a str, String> {
    value.ok_or_else(|| format!("{field_name} cannot be empty"))
}

fn validate_non_empty_values(
    values: Option<Vec<String>>,
    field_name: &str,
) -> Result<Vec<String>, String> {
    let items: Vec<String> = values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    if items.is_empty() {
        return Err(format!("{field_name} cannot be empty"));
    }

    Ok(items)
}

fn validate_entries(
    entries: Option<Vec<RedisKeyCreateEntryInput>>,
) -> Result<Vec<(String, String)>, String> {
    let next_entries: Vec<(String, String)> = entries
        .unwrap_or_default()
        .into_iter()
        .map(|entry| (entry.field.trim().to_string(), entry.value))
        .filter(|(field, _)| !field.is_empty())
        .collect();

    if next_entries.is_empty() {
        return Err("Field list cannot be empty".to_string());
    }

    Ok(next_entries)
}

fn validate_members(
    members: Option<Vec<RedisKeyCreateMemberInput>>,
) -> Result<Vec<(String, f64)>, String> {
    let next_members: Vec<(String, f64)> = members
        .unwrap_or_default()
        .into_iter()
        .filter_map(|member| {
            let name = member.member.trim().to_string();

            if name.is_empty() {
                return None;
            }

            Some((name, member.score))
        })
        .collect();

    if next_members.is_empty() {
        return Err("Member list cannot be empty".to_string());
    }

    if next_members.iter().any(|(_, score)| !score.is_finite()) {
        return Err("Score must be a finite number".to_string());
    }

    Ok(next_members)
}

#[tauri::command]
pub async fn create_redis_key(input: RedisKeyCreateInput) -> Result<RedisKeySummary, String> {
    let RedisKeyCreateInput {
        connection,
        key,
        key_type,
        ttl,
        value,
        values,
        entries,
        members,
    } = input;
    let key = key.trim().to_string();

    if key.is_empty() {
        return Err("Key name cannot be empty".to_string());
    }

    let key_type = match key_type.trim().to_ascii_lowercase().as_str() {
        "string" => "string",
        "hash" => "hash",
        "list" => "list",
        "set" => "set",
        "zset" => "zset",
        "stream" => "stream",
        "json" => "json",
        _ => return Err("Unsupported key type".to_string()),
    };
    let ttl = ttl.unwrap_or(-1);

    if ttl == 0 || ttl < -1 {
        return Err("TTL must be -1 or a positive integer".to_string());
    }

    let value = value.unwrap_or_default();

    if key_type == "json" {
        serde_json::from_str::<JsonValue>(&value)
            .map_err(|error| format!("Invalid JSON: {error}"))?;
    }

    let mut connection = open_connection(&connection).await?;
    let exists: i64 = redis::cmd("EXISTS")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to inspect key: {error}"))?;

    if exists != 0 {
        return Err("Key already exists".to_string());
    }

    match key_type {
        "string" => {
            let created: Option<String> = redis::cmd("SET")
                .arg(&key)
                .arg(&value)
                .arg("NX")
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create string key: {error}"))?;

            if created.is_none() {
                return Err("Key already exists".to_string());
            }
        }
        "json" => {
            let created: Option<String> = redis::cmd("JSON.SET")
                .arg(&key)
                .arg("$")
                .arg(require_text(Some(&value), "JSON value")?)
                .arg("NX")
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create JSON key: {error}"))?;

            if created.is_none() {
                return Err("Key already exists".to_string());
            }
        }
        "hash" => {
            let entries = validate_entries(entries.clone())?;
            let mut command = redis::cmd("HSET");
            command.arg(&key);

            for (field, entry_value) in entries {
                command.arg(field).arg(entry_value);
            }

            let _: i64 = command
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create hash key: {error}"))?;
        }
        "list" => {
            let values = validate_non_empty_values(values.clone(), "Value list")?;
            let mut command = redis::cmd("RPUSH");
            command.arg(&key);

            for item in values {
                command.arg(item);
            }

            let _: i64 = command
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create list key: {error}"))?;
        }
        "set" => {
            let values = validate_non_empty_values(values.clone(), "Value list")?;
            let mut command = redis::cmd("SADD");
            command.arg(&key);

            for item in values {
                command.arg(item);
            }

            let _: i64 = command
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create set key: {error}"))?;
        }
        "zset" => {
            let members = validate_members(members.clone())?;
            let mut command = redis::cmd("ZADD");
            command.arg(&key);

            for (member, score) in members {
                command.arg(score).arg(member);
            }

            let _: i64 = command
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create sorted set key: {error}"))?;
        }
        "stream" => {
            let entries = validate_entries(entries.clone())?;
            let mut command = redis::cmd("XADD");
            command.arg(&key).arg("*");

            for (field, entry_value) in entries {
                command.arg(field).arg(entry_value);
            }

            let _: String = command
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to create stream key: {error}"))?;
        }
        _ => return Err("Unsupported key type".to_string()),
    }

    if ttl > 0 {
        let applied: bool = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(ttl)
            .query_async(&mut connection)
            .await
            .map_err(|error| format!("Failed to set key TTL: {error}"))?;

        if !applied {
            return Err("Failed to set key TTL".to_string());
        }
    }

    Ok(RedisKeySummary {
        key: key.to_string(),
        key_type: Some(normalize_key_type(key_type)),
        ttl: Some(ttl),
        slot: None,
        node_address: None,
    })
}

#[tauri::command]
pub async fn update_redis_hash_entry(input: RedisHashEntryUpdateInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.old_field.is_empty() || input.new_field.is_empty() {
        return Err("Field cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local old_field = ARGV[1]
local new_field = ARGV[2]
local next_value = ARGV[3]

if redis.call("HEXISTS", key, old_field) == 0 then
  return redis.error_reply("Source field does not exist")
end

if old_field ~= new_field and redis.call("HEXISTS", key, new_field) == 1 then
  return redis.error_reply("Target field already exists")
end

if old_field == new_field then
  redis.call("HSET", key, new_field, next_value)
  return 1
end

redis.call("HDEL", key, old_field)
redis.call("HSET", key, new_field, next_value)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.old_field)
        .arg(&input.new_field)
        .arg(&input.value)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to update hash field: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn add_redis_hash_entry(input: RedisHashEntryAddInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.field.is_empty() {
        return Err("Field cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local field = ARGV[1]
local value = ARGV[2]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "hash" then
  return redis.error_reply("Key is not a hash")
end

if redis.call("HEXISTS", key, field) == 1 then
  return redis.error_reply("Field already exists")
end

redis.call("HSET", key, field, value)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.field)
        .arg(&input.value)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to add hash field: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn update_redis_string_value(input: RedisStringValueUpdateInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local next_value = ARGV[1]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "string" then
  return redis.error_reply("Key is not a string")
end

redis.call("SET", key, next_value, "KEEPTTL")
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.value)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to update string value: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn update_redis_json_value(input: RedisJsonValueUpdateInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    serde_json::from_str::<JsonValue>(&input.value)
        .map_err(|error| format!("Invalid JSON: {error}"))?;

    let mut connection = open_connection(&input.connection).await?;
    let exists: i64 = redis::cmd("EXISTS")
        .arg(&input.key)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to inspect key: {error}"))?;

    if exists == 0 {
        return Err("Key does not exist".to_string());
    }

    let key_type: String = redis::cmd("TYPE")
        .arg(&input.key)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to inspect key type: {error}"))?;

    if !key_type.to_ascii_lowercase().contains("json") {
        return Err(format!("Key is not JSON: {key_type}"));
    }

    let _: String = redis::cmd("JSON.SET")
        .arg(&input.key)
        .arg("$")
        .arg(&input.value)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to update JSON value: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_redis_hash_entry(input: RedisHashEntryDeleteInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.field.is_empty() {
        return Err("Field cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let removed: i64 = redis::cmd("HDEL")
        .arg(&input.key)
        .arg(&input.field)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to delete hash field: {error}"))?;

    if removed == 0 {
        return Err("Field does not exist".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn append_redis_list_value(input: RedisListValueAppendInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.value.is_empty() {
        return Err("Value cannot be empty".to_string());
    }

    let position = input.position.as_deref().unwrap_or("tail");
    if position != "head" && position != "tail" {
        return Err("Position must be `head` or `tail`".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local value = ARGV[1]
local position = ARGV[2]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "list" then
  return redis.error_reply("Key is not a list")
end

if position == "head" then
  redis.call("LPUSH", key, value)
else
  redis.call("RPUSH", key, value)
end
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.value)
        .arg(position)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to append list value: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn update_redis_list_value(input: RedisListValueUpdateInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.index < 0 {
        return Err("Index must be a non-negative integer".to_string());
    }

    if input.value.is_empty() {
        return Err("Value cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local index = tonumber(ARGV[1])
local value = ARGV[2]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "list" then
  return redis.error_reply("Key is not a list")
end

local length = redis.call("LLEN", key)
if index < 0 or index >= length then
  return redis.error_reply("Index out of range")
end

redis.call("LSET", key, index, value)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(input.index)
        .arg(&input.value)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to update list value: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_redis_list_value(input: RedisListValueDeleteInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.index < 0 {
        return Err("Index must be a non-negative integer".to_string());
    }

    let marker = format!("__neordm_list_delete__{}__{}__", input.key, input.index);
    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local index = tonumber(ARGV[1])
local marker = ARGV[2]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "list" then
  return redis.error_reply("Key is not a list")
end

local length = redis.call("LLEN", key)
if index < 0 or index >= length then
  return redis.error_reply("Index out of range")
end

while redis.call("LPOS", key, marker) ~= false do
  marker = marker .. ":x"
end

redis.call("LSET", key, index, marker)
redis.call("LREM", key, 1, marker)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(input.index)
        .arg(marker)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to delete list value: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn add_redis_set_member(input: RedisSetMemberAddInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.member.is_empty() {
        return Err("Member cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local member = ARGV[1]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "set" then
  return redis.error_reply("Key is not a set")
end

if redis.call("SISMEMBER", key, member) == 1 then
  return redis.error_reply("Member already exists")
end

redis.call("SADD", key, member)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.member)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to add set member: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn update_redis_zset_entry(input: RedisZSetEntryUpdateInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.old_member.is_empty() || input.new_member.is_empty() {
        return Err("Member cannot be empty".to_string());
    }

    if !input.score.is_finite() {
        return Err("Score must be a finite number".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local old_member = ARGV[1]
local new_member = ARGV[2]
local next_score = ARGV[3]

if redis.call("ZSCORE", key, old_member) == false then
  return redis.error_reply("Source member does not exist")
end

if old_member ~= new_member and redis.call("ZSCORE", key, new_member) ~= false then
  return redis.error_reply("Target member already exists")
end

if old_member == new_member then
  redis.call("ZADD", key, "XX", next_score, new_member)
  return 1
end

redis.call("ZREM", key, old_member)
redis.call("ZADD", key, next_score, new_member)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.old_member)
        .arg(&input.new_member)
        .arg(input.score)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to update sorted set member: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn add_redis_zset_entry(input: RedisZSetEntryAddInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.member.is_empty() {
        return Err("Member cannot be empty".to_string());
    }

    if !input.score.is_finite() {
        return Err("Score must be a finite number".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let script = redis::Script::new(
        r#"
local key = KEYS[1]
local member = ARGV[1]
local score = ARGV[2]

if redis.call("EXISTS", key) == 0 then
  return redis.error_reply("Key does not exist")
end

local key_type = redis.call("TYPE", key).ok
if key_type ~= "zset" then
  return redis.error_reply("Key is not a sorted set")
end

if redis.call("ZSCORE", key, member) ~= false then
  return redis.error_reply("Member already exists")
end

redis.call("ZADD", key, score, member)
return 1
"#,
    );

    script
        .key(&input.key)
        .arg(&input.member)
        .arg(input.score)
        .invoke_async::<i32>(&mut connection)
        .await
        .map_err(|error| format!("Failed to add sorted set member: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_redis_zset_entry(input: RedisZSetEntryDeleteInput) -> Result<(), String> {
    if input.key.is_empty() {
        return Err("Key cannot be empty".to_string());
    }

    if input.member.is_empty() {
        return Err("Member cannot be empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let removed: i64 = redis::cmd("ZREM")
        .arg(&input.key)
        .arg(&input.member)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to delete sorted set member: {error}"))?;

    if removed == 0 {
        return Err("Member does not exist".to_string());
    }

    Ok(())
}
