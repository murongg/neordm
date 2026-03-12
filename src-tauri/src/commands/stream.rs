use crate::models::{
    RedisKeyCreateEntryInput, RedisKeyLookupInput, RedisStreamAckInput, RedisStreamClaimInput,
    RedisStreamConsumer, RedisStreamConsumerDeleteInput, RedisStreamConsumerGroup,
    RedisStreamEntriesLookupInput, RedisStreamEntriesResponse, RedisStreamEntry,
    RedisStreamEntryAppendInput, RedisStreamEntryDeleteInput, RedisStreamEntryField,
    RedisStreamGroupCreateInput, RedisStreamGroupLookupInput, RedisStreamPendingEntriesInput,
    RedisStreamPendingEntry,
};
use crate::redis_support::{open_connection, redis_value_to_string};
use redis::Value;

const DEFAULT_STREAM_PENDING_COUNT: u32 = 100;
const DEFAULT_STREAM_ENTRIES_COUNT: u32 = 100;
const MAX_STREAM_ENTRIES_COUNT: u32 = 500;

fn unwrap_attribute(value: Value) -> Value {
    match value {
        Value::Attribute { data, .. } => unwrap_attribute(*data),
        other => other,
    }
}

fn parse_kv_pairs(value: Value) -> Result<Vec<(String, Value)>, String> {
    match unwrap_attribute(value) {
        Value::Map(entries) => entries
            .into_iter()
            .map(|(key, value)| Ok((redis_value_to_string(key)?, unwrap_attribute(value))))
            .collect(),
        Value::Array(values) => {
            if values.len() % 2 != 0 {
                return Err("Redis returned an invalid key/value response".to_string());
            }

            let mut pairs = Vec::with_capacity(values.len() / 2);
            let mut values = values.into_iter();

            while let Some(key) = values.next() {
                let value = values
                    .next()
                    .ok_or_else(|| "Redis returned an incomplete key/value response".to_string())?;
                pairs.push((redis_value_to_string(key)?, unwrap_attribute(value)));
            }

            Ok(pairs)
        }
        other => Err(format!("Redis returned an unsupported response: {other:?}")),
    }
}

fn get_required_string_field(pairs: &[(String, Value)], field: &str) -> Result<String, String> {
    let value = pairs
        .iter()
        .find(|(key, _)| key == field)
        .map(|(_, value)| value.clone())
        .ok_or_else(|| format!("Redis stream response is missing `{field}`"))?;

    redis_value_to_string(value)
}

fn get_required_u64_field(pairs: &[(String, Value)], field: &str) -> Result<u64, String> {
    let value = pairs
        .iter()
        .find(|(key, _)| key == field)
        .map(|(_, value)| value.clone())
        .ok_or_else(|| format!("Redis stream response is missing `{field}`"))?;

    redis_value_to_string(value)?
        .parse::<u64>()
        .map_err(|error| format!("Redis returned an invalid `{field}` value: {error}"))
}

fn get_optional_u64_field(pairs: &[(String, Value)], field: &str) -> Result<Option<u64>, String> {
    let Some(value) = pairs
        .iter()
        .find(|(key, _)| key == field)
        .map(|(_, value)| value.clone())
    else {
        return Ok(None);
    };

    match value {
        Value::Nil => Ok(None),
        other => redis_value_to_string(other)?
            .parse::<u64>()
            .map(Some)
            .map_err(|error| format!("Redis returned an invalid `{field}` value: {error}")),
    }
}

fn get_optional_u64_field_lossy(
    pairs: &[(String, Value)],
    field: &str,
) -> Result<Option<u64>, String> {
    let Some(value) = pairs
        .iter()
        .find(|(key, _)| key == field)
        .map(|(_, value)| value.clone())
    else {
        return Ok(None);
    };

    match value {
        Value::Nil => Ok(None),
        other => {
            let raw = redis_value_to_string(other)?;
            let trimmed = raw.trim();

            if trimmed.is_empty() {
                return Ok(None);
            }

            Ok(trimmed.parse::<u64>().ok())
        }
    }
}

fn parse_stream_groups(value: Value) -> Result<Vec<RedisStreamConsumerGroup>, String> {
    let groups = match unwrap_attribute(value) {
        Value::Array(groups) => groups,
        Value::Nil => return Ok(Vec::new()),
        other => {
            return Err(format!(
                "Redis returned an invalid stream groups response: {other:?}"
            ))
        }
    };

    groups
        .into_iter()
        .map(|group| {
            let pairs = parse_kv_pairs(group)?;

            Ok(RedisStreamConsumerGroup {
                name: get_required_string_field(&pairs, "name")?,
                consumers: get_required_u64_field(&pairs, "consumers")?,
                pending: get_required_u64_field(&pairs, "pending")?,
                last_delivered_id: get_required_string_field(&pairs, "last-delivered-id")?,
                entries_read: get_optional_u64_field(&pairs, "entries-read")?,
                lag: get_optional_u64_field(&pairs, "lag")?,
            })
        })
        .collect()
}

fn parse_stream_entries(value: Value) -> Result<Vec<RedisStreamEntry>, String> {
    let entries = match unwrap_attribute(value) {
        Value::Array(entries) => entries,
        Value::Nil => return Ok(Vec::new()),
        other => {
            return Err(format!(
                "Redis returned an invalid stream entries response: {other:?}"
            ))
        }
    };

    entries
        .into_iter()
        .map(|entry| match unwrap_attribute(entry) {
            Value::Array(values) if values.len() >= 2 => {
                let mut values = values.into_iter();
                let id = redis_value_to_string(
                    values
                        .next()
                        .ok_or_else(|| "Redis stream entry is missing id".to_string())?,
                )?;
                let fields = parse_kv_pairs(
                    values
                        .next()
                        .ok_or_else(|| "Redis stream entry is missing fields".to_string())?,
                )?
                .into_iter()
                .map(|(field, value)| {
                    Ok(RedisStreamEntryField {
                        field,
                        value: redis_value_to_string(value)?,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;

                Ok(RedisStreamEntry { id, fields })
            }
            other => Err(format!("Redis returned an invalid stream entry: {other:?}")),
        })
        .collect()
}

fn parse_stream_consumers(value: Value) -> Result<Vec<RedisStreamConsumer>, String> {
    let consumers = match unwrap_attribute(value) {
        Value::Array(consumers) => consumers,
        Value::Nil => return Ok(Vec::new()),
        other => {
            return Err(format!(
                "Redis returned an invalid stream consumers response: {other:?}"
            ))
        }
    };

    consumers
        .into_iter()
        .map(|consumer| {
            let pairs = parse_kv_pairs(consumer)?;

            Ok(RedisStreamConsumer {
                name: get_required_string_field(&pairs, "name")?,
                pending: get_required_u64_field(&pairs, "pending")?,
                idle: get_required_u64_field(&pairs, "idle")?,
                // Some Redis-compatible servers return a placeholder instead of a number
                // for `inactive` when the consumer has not processed messages yet.
                inactive: get_optional_u64_field_lossy(&pairs, "inactive")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bulk(value: &str) -> Value {
        Value::BulkString(value.as_bytes().to_vec())
    }

    #[test]
    fn parse_stream_consumers_keeps_numeric_inactive() {
        let consumers = parse_stream_consumers(Value::Array(vec![Value::Map(vec![
            (bulk("name"), bulk("worker-1")),
            (bulk("pending"), Value::Int(0)),
            (bulk("idle"), Value::Int(42)),
            (bulk("inactive"), Value::Int(128)),
        ])]))
        .expect("stream consumers should parse");

        assert_eq!(consumers.len(), 1);
        assert_eq!(consumers[0].name, "worker-1");
        assert_eq!(consumers[0].inactive, Some(128));
    }

    #[test]
    fn parse_stream_consumers_ignores_invalid_inactive() {
        let consumers = parse_stream_consumers(Value::Array(vec![Value::Map(vec![
            (bulk("name"), bulk("worker-1")),
            (bulk("pending"), Value::Int(0)),
            (bulk("idle"), Value::Int(42)),
            (bulk("inactive"), bulk("N/A")),
        ])]))
        .expect("invalid optional inactive should be ignored");

        assert_eq!(consumers.len(), 1);
        assert_eq!(consumers[0].name, "worker-1");
        assert_eq!(consumers[0].inactive, None);
    }
}

fn parse_stream_pending_entries(value: Value) -> Result<Vec<RedisStreamPendingEntry>, String> {
    let entries = match unwrap_attribute(value) {
        Value::Array(entries) => entries,
        Value::Nil => return Ok(Vec::new()),
        other => {
            return Err(format!(
                "Redis returned an invalid stream pending response: {other:?}"
            ))
        }
    };

    entries
        .into_iter()
        .map(|entry| match unwrap_attribute(entry) {
            Value::Array(values) if values.len() >= 4 => {
                let mut values = values.into_iter();

                let id = redis_value_to_string(
                    values
                        .next()
                        .ok_or_else(|| "Redis pending entry is missing id".to_string())?,
                )?;
                let consumer = redis_value_to_string(
                    values
                        .next()
                        .ok_or_else(|| "Redis pending entry is missing consumer".to_string())?,
                )?;
                let idle = redis_value_to_string(
                    values
                        .next()
                        .ok_or_else(|| "Redis pending entry is missing idle time".to_string())?,
                )?
                .parse::<u64>()
                .map_err(|error| {
                    format!("Redis returned an invalid pending idle value: {error}")
                })?;
                let deliveries =
                    redis_value_to_string(values.next().ok_or_else(|| {
                        "Redis pending entry is missing delivery count".to_string()
                    })?)?
                    .parse::<u64>()
                    .map_err(|error| {
                        format!("Redis returned an invalid pending delivery count: {error}")
                    })?;

                Ok(RedisStreamPendingEntry {
                    id,
                    consumer,
                    idle,
                    deliveries,
                })
            }
            other => Err(format!(
                "Redis returned an invalid pending entry: {other:?}"
            )),
        })
        .collect()
}

fn normalize_non_empty(value: String, label: &str) -> Result<String, String> {
    let value = value.trim().to_string();

    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }

    Ok(value)
}

fn validate_entry_fields(
    entries: Vec<RedisKeyCreateEntryInput>,
) -> Result<Vec<(String, String)>, String> {
    let entries = entries
        .into_iter()
        .map(|entry| (entry.field.trim().to_string(), entry.value))
        .filter(|(field, _)| !field.is_empty())
        .collect::<Vec<_>>();

    if entries.is_empty() {
        return Err("Field list cannot be empty".to_string());
    }

    Ok(entries)
}

fn normalize_ids(ids: Vec<String>) -> Result<Vec<String>, String> {
    let ids = ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();

    if ids.is_empty() {
        return Err("At least one stream entry id is required".to_string());
    }

    Ok(ids)
}

fn parse_claimed_ids(value: Value) -> Result<Vec<String>, String> {
    match unwrap_attribute(value) {
        Value::Array(ids) => ids.into_iter().map(redis_value_to_string).collect(),
        Value::Nil => Ok(Vec::new()),
        other => Err(format!(
            "Redis returned an invalid claimed ids response: {other:?}"
        )),
    }
}

#[tauri::command]
pub async fn get_redis_stream_entries(
    input: RedisStreamEntriesLookupInput,
) -> Result<RedisStreamEntriesResponse, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let page_size = input
        .page_size
        .unwrap_or(DEFAULT_STREAM_ENTRIES_COUNT)
        .clamp(1, MAX_STREAM_ENTRIES_COUNT);
    let cursor = input
        .cursor
        .map(|cursor| cursor.trim().to_string())
        .filter(|cursor| !cursor.is_empty());
    let start = cursor
        .as_ref()
        .map(|cursor| format!("({cursor}"))
        .unwrap_or_else(|| "-".to_string());
    let mut connection = open_connection(&input.connection).await?;
    let (total_count, response): (u64, Value) = redis::pipe()
        .cmd("XLEN")
        .arg(&key)
        .cmd("XRANGE")
        .arg(&key)
        .arg(start)
        .arg("+")
        .arg("COUNT")
        .arg(page_size)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to load stream entries: {error}"))?;
    let entries = parse_stream_entries(response)?;
    let next_cursor = if entries.len() < page_size as usize {
        None
    } else {
        entries.last().map(|entry| entry.id.clone())
    };

    Ok(RedisStreamEntriesResponse {
        total_count,
        next_cursor,
        entries,
    })
}

#[tauri::command]
pub async fn get_redis_stream_groups(
    input: RedisKeyLookupInput,
) -> Result<Vec<RedisStreamConsumerGroup>, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let mut connection = open_connection(&input.connection).await?;
    let response: Value = redis::cmd("XINFO")
        .arg("GROUPS")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to load stream groups: {error}"))?;

    parse_stream_groups(response)
}

#[tauri::command]
pub async fn append_redis_stream_entry(
    input: RedisStreamEntryAppendInput,
) -> Result<String, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let entries = validate_entry_fields(input.entries)?;
    let mut connection = open_connection(&input.connection).await?;
    let mut command = redis::cmd("XADD");
    command.arg(&key).arg("*");

    for (field, value) in entries {
        command.arg(field).arg(value);
    }

    command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to append stream entry: {error}"))
}

#[tauri::command]
pub async fn get_redis_stream_consumers(
    input: RedisStreamGroupLookupInput,
) -> Result<Vec<RedisStreamConsumer>, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let mut connection = open_connection(&input.connection).await?;
    let response: Value = redis::cmd("XINFO")
        .arg("CONSUMERS")
        .arg(&key)
        .arg(&group)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to load stream consumers: {error}"))?;

    parse_stream_consumers(response)
}

#[tauri::command]
pub async fn get_redis_stream_pending_entries(
    input: RedisStreamPendingEntriesInput,
) -> Result<Vec<RedisStreamPendingEntry>, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let count = input.count.unwrap_or(DEFAULT_STREAM_PENDING_COUNT).max(1);
    let consumer = input
        .consumer
        .map(|consumer| consumer.trim().to_string())
        .filter(|consumer| !consumer.is_empty());
    let mut connection = open_connection(&input.connection).await?;

    let mut command = redis::cmd("XPENDING");
    command.arg(&key).arg(&group).arg("-").arg("+").arg(count);

    if let Some(consumer) = consumer {
        command.arg(consumer);
    }

    let response: Value = command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to load stream pending entries: {error}"))?;

    parse_stream_pending_entries(response)
}

#[tauri::command]
pub async fn create_redis_stream_consumer_group(
    input: RedisStreamGroupCreateInput,
) -> Result<(), String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let start_id = normalize_non_empty(input.start_id, "Start id")?;
    let mut connection = open_connection(&input.connection).await?;

    redis::cmd("XGROUP")
        .arg("CREATE")
        .arg(&key)
        .arg(&group)
        .arg(&start_id)
        .query_async::<()>(&mut connection)
        .await
        .map_err(|error| format!("Failed to create stream group: {error}"))
}

#[tauri::command]
pub async fn destroy_redis_stream_consumer_group(
    input: RedisStreamGroupLookupInput,
) -> Result<i64, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let mut connection = open_connection(&input.connection).await?;

    redis::cmd("XGROUP")
        .arg("DESTROY")
        .arg(&key)
        .arg(&group)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to destroy stream group: {error}"))
}

#[tauri::command]
pub async fn delete_redis_stream_consumer(
    input: RedisStreamConsumerDeleteInput,
) -> Result<i64, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let consumer = normalize_non_empty(input.consumer, "Consumer")?;
    let mut connection = open_connection(&input.connection).await?;

    redis::cmd("XGROUP")
        .arg("DELCONSUMER")
        .arg(&key)
        .arg(&group)
        .arg(&consumer)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to delete stream consumer: {error}"))
}

#[tauri::command]
pub async fn delete_redis_stream_entries(
    input: RedisStreamEntryDeleteInput,
) -> Result<i64, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let ids = normalize_ids(input.ids)?;
    let mut connection = open_connection(&input.connection).await?;
    let mut command = redis::cmd("XDEL");
    command.arg(&key).arg(ids);

    command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to delete stream entries: {error}"))
}

#[tauri::command]
pub async fn ack_redis_stream_entries(input: RedisStreamAckInput) -> Result<i64, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let ids = normalize_ids(input.ids)?;
    let mut connection = open_connection(&input.connection).await?;
    let mut command = redis::cmd("XACK");
    command.arg(&key).arg(&group).arg(ids);

    command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to ack stream entries: {error}"))
}

#[tauri::command]
pub async fn claim_redis_stream_entries(
    input: RedisStreamClaimInput,
) -> Result<Vec<String>, String> {
    let key = normalize_non_empty(input.key, "Key")?;
    let group = normalize_non_empty(input.group, "Group")?;
    let consumer = normalize_non_empty(input.consumer, "Consumer")?;
    let ids = normalize_ids(input.ids)?;
    let mut connection = open_connection(&input.connection).await?;
    let response: Value = redis::cmd("XCLAIM")
        .arg(&key)
        .arg(&group)
        .arg(&consumer)
        .arg(input.min_idle_time)
        .arg(ids)
        .arg("JUSTID")
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to claim stream entries: {error}"))?;

    parse_claimed_ids(response)
}
