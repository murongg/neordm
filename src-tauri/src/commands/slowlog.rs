use crate::models::{
    RedisConnectionTestInput, RedisSlowLogEntry, RedisSlowLogInput, RedisSlowLogResponse,
};
use crate::redis_support::{get_cluster_topology, open_connection, redis_value_to_string};
use redis::Value;

const DEFAULT_SLOWLOG_LIMIT: u32 = 64;
const MAX_SLOWLOG_LIMIT: u32 = 512;

fn clamp_slowlog_limit(limit: Option<u32>) -> u32 {
    limit
        .unwrap_or(DEFAULT_SLOWLOG_LIMIT)
        .clamp(1, MAX_SLOWLOG_LIMIT)
}

fn unwrap_attribute(value: Value) -> Value {
    match value {
        Value::Attribute { data, .. } => unwrap_attribute(*data),
        other => other,
    }
}

fn parse_u64_field(value: Value, field: &str) -> Result<u64, String> {
    redis_value_to_string(unwrap_attribute(value))?
        .parse::<u64>()
        .map_err(|error| format!("Redis returned an invalid slowlog `{field}` value: {error}"))
}

fn parse_optional_string(value: Option<Value>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    match unwrap_attribute(value) {
        Value::Nil => Ok(None),
        other => {
            let parsed = redis_value_to_string(other)?;
            let trimmed = parsed.trim();

            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
    }
}

fn parse_slowlog_arguments(value: Value) -> Result<Vec<String>, String> {
    match unwrap_attribute(value) {
        Value::Array(arguments) => arguments
            .into_iter()
            .map(|argument| redis_value_to_string(unwrap_attribute(argument)))
            .collect(),
        other => Err(format!(
            "Redis returned an invalid slowlog arguments payload: {other:?}"
        )),
    }
}

fn parse_slowlog_entries(
    value: Value,
    node_address: Option<String>,
) -> Result<Vec<RedisSlowLogEntry>, String> {
    let entries = match unwrap_attribute(value) {
        Value::Array(entries) => entries,
        Value::Nil => return Ok(Vec::new()),
        other => {
            return Err(format!(
                "Redis returned an invalid slowlog response: {other:?}"
            ))
        }
    };

    entries
        .into_iter()
        .map(|entry| match unwrap_attribute(entry) {
            Value::Array(values) if values.len() >= 4 => {
                let mut values = values.into_iter();
                let id = parse_u64_field(
                    values
                        .next()
                        .ok_or_else(|| "Redis slowlog entry is missing id".to_string())?,
                    "id",
                )?;
                let started_at = parse_u64_field(
                    values
                        .next()
                        .ok_or_else(|| "Redis slowlog entry is missing timestamp".to_string())?,
                    "timestamp",
                )?;
                let duration_us = parse_u64_field(
                    values
                        .next()
                        .ok_or_else(|| "Redis slowlog entry is missing duration".to_string())?,
                    "duration",
                )?;
                let arguments = parse_slowlog_arguments(
                    values
                        .next()
                        .ok_or_else(|| "Redis slowlog entry is missing arguments".to_string())?,
                )?;
                let client_address = parse_optional_string(values.next())?;
                let client_name = parse_optional_string(values.next())?;

                Ok(RedisSlowLogEntry {
                    id,
                    started_at,
                    duration_us,
                    arguments,
                    client_address,
                    client_name,
                    node_address: node_address.clone(),
                })
            }
            other => Err(format!(
                "Redis returned an invalid slowlog entry: {other:?}"
            )),
        })
        .collect()
}

async fn load_slowlog_from_connection(
    connection: &RedisConnectionTestInput,
    limit: u32,
    node_address: Option<String>,
) -> Result<(u64, Vec<RedisSlowLogEntry>), String> {
    let mut redis_connection = open_connection(connection).await?;

    let total_count = redis::cmd("SLOWLOG")
        .arg("LEN")
        .query_async::<i64>(&mut redis_connection)
        .await
        .map_err(|error| format!("Failed to load slowlog length: {error}"))?;

    if total_count < 0 {
        return Err("Redis returned a negative slowlog length".to_string());
    }

    let response: Value = redis::cmd("SLOWLOG")
        .arg("GET")
        .arg(limit)
        .query_async(&mut redis_connection)
        .await
        .map_err(|error| format!("Failed to load slowlog entries: {error}"))?;

    Ok((
        total_count as u64,
        parse_slowlog_entries(response, node_address)?,
    ))
}

async fn load_cluster_slowlog(
    input: &RedisSlowLogInput,
    limit: u32,
) -> Result<RedisSlowLogResponse, String> {
    let mut nodes = get_cluster_topology(&input.connection).await?;
    nodes.sort_by(|left, right| left.address.cmp(&right.address));

    let mut total_count = 0_u64;
    let mut entries = Vec::new();

    for node in nodes {
        let connection = RedisConnectionTestInput {
            host: node.host.clone(),
            port: node.port,
            sentinel: None,
            cluster: None,
            username: input.connection.username.clone(),
            password: input.connection.password.clone(),
            db: 0,
            tls: input.connection.tls,
            ssh_tunnel: None,
        };
        let (node_total_count, node_entries) =
            load_slowlog_from_connection(&connection, limit, Some(node.address)).await?;

        total_count += node_total_count;
        entries.extend(node_entries);
    }

    entries.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| right.duration_us.cmp(&left.duration_us))
            .then_with(|| right.id.cmp(&left.id))
    });
    entries.truncate(limit as usize);

    Ok(RedisSlowLogResponse {
        total_count,
        limit,
        entries,
    })
}

#[tauri::command]
pub async fn get_redis_slowlog(input: RedisSlowLogInput) -> Result<RedisSlowLogResponse, String> {
    let limit = clamp_slowlog_limit(input.limit);

    if input.connection.cluster.is_some() {
        return load_cluster_slowlog(&input, limit).await;
    }

    let (total_count, entries) =
        load_slowlog_from_connection(&input.connection, limit, None).await?;

    Ok(RedisSlowLogResponse {
        total_count,
        limit,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bulk(value: &str) -> Value {
        Value::BulkString(value.as_bytes().to_vec())
    }

    #[test]
    fn parses_slowlog_entry_with_client_metadata() {
        let entries = parse_slowlog_entries(
            Value::Array(vec![Value::Array(vec![
                Value::Int(9),
                Value::Int(1_717_171_717),
                Value::Int(15_000),
                Value::Array(vec![bulk("SET"), bulk("user:1"), bulk("hello world")]),
                bulk("127.0.0.1:6379"),
                bulk("worker-1"),
            ])]),
            Some("127.0.0.1:6379".to_string()),
        )
        .expect("entry should parse");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, 9);
        assert_eq!(entries[0].started_at, 1_717_171_717);
        assert_eq!(entries[0].duration_us, 15_000);
        assert_eq!(entries[0].arguments, vec!["SET", "user:1", "hello world"]);
        assert_eq!(entries[0].client_address.as_deref(), Some("127.0.0.1:6379"));
        assert_eq!(entries[0].client_name.as_deref(), Some("worker-1"));
        assert_eq!(entries[0].node_address.as_deref(), Some("127.0.0.1:6379"));
    }

    #[test]
    fn parses_legacy_slowlog_entry_without_client_metadata() {
        let entries = parse_slowlog_entries(
            Value::Array(vec![Value::Array(vec![
                Value::Int(3),
                Value::Int(1_600_000_000),
                Value::Int(850),
                Value::Array(vec![bulk("GET"), bulk("cache:key")]),
            ])]),
            None,
        )
        .expect("entry should parse");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].arguments, vec!["GET", "cache:key"]);
        assert_eq!(entries[0].client_address, None);
        assert_eq!(entries[0].client_name, None);
        assert_eq!(entries[0].node_address, None);
    }
}
