use crate::models::{
    RedisHashEntryDeleteInput, RedisHashEntryUpdateInput, RedisJsonValueUpdateInput,
    RedisStringValueUpdateInput, RedisZSetEntryDeleteInput, RedisZSetEntryUpdateInput,
};
use crate::redis_support::open_connection;
use serde_json::Value as JsonValue;

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
