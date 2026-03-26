use crate::models::{
    RedisClusterTopologyInput, RedisClusterTopologyNode, RedisKeyLookupInput, RedisKeyRenameInput,
    RedisKeyRenamePairInput, RedisKeySummary, RedisKeyValuePageInput, RedisKeyValuePageResponse,
    RedisKeyValueResponse, RedisKeysListInput, RedisKeysRenameInput, RedisKeysScanPageInput,
    RedisKeysScanPageResponse,
};
use crate::redis_support::{
    find_cluster_node_address_for_slot, format_cli_output, get_cluster_topology,
    normalize_key_type, open_connection,
};
use redis::cluster_routing::get_slot;
use redis::Value;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Number, Value as JsonValue};
use std::collections::{HashMap, HashSet};

const DEFAULT_SCAN_COUNT: u32 = 200;
const DEFAULT_MAX_KEYS: u32 = 10_000;
const DEFAULT_VALUE_PAGE_SIZE: u32 = 200;
const MAX_SCAN_COUNT: u32 = 5_000;
const MAX_TOTAL_KEYS: u32 = 50_000;
const MAX_VALUE_PAGE_SIZE: u32 = 2_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClusterScanCursor {
    node_index: usize,
    cursor: u64,
}

fn clamp_scan_page_size(value: Option<u32>) -> usize {
    value.unwrap_or(DEFAULT_SCAN_COUNT).clamp(1, MAX_TOTAL_KEYS) as usize
}

fn clamp_value_page_size(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_VALUE_PAGE_SIZE)
        .clamp(1, MAX_VALUE_PAGE_SIZE)
}

fn parse_direct_scan_cursor(cursor: Option<&str>) -> Result<u64, String> {
    let Some(raw_cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(0);
    };

    raw_cursor
        .parse::<u64>()
        .map_err(|error| format!("Invalid scan cursor: {error}"))
}

fn parse_cluster_scan_cursor(cursor: Option<&str>) -> Result<ClusterScanCursor, String> {
    let Some(raw_cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(ClusterScanCursor {
            node_index: 0,
            cursor: 0,
        });
    };

    serde_json::from_str::<ClusterScanCursor>(raw_cursor)
        .map_err(|error| format!("Invalid cluster scan cursor: {error}"))
}

async fn scan_cluster_keys_page(
    input: &RedisKeysScanPageInput,
    scan_count: u32,
    page_size: usize,
) -> Result<RedisKeysScanPageResponse, String> {
    let cluster_node_filter = input
        .cluster_node_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let topology = get_cluster_topology(&input.connection).await?;
    let mut master_nodes = topology
        .iter()
        .filter(|node| {
            cluster_node_filter
                .map(|value| value == node.address)
                .unwrap_or(true)
        })
        .map(|node| (node.host.clone(), node.port, node.address.clone()))
        .collect::<Vec<_>>();

    master_nodes.sort_by(|left, right| left.2.cmp(&right.2));

    if master_nodes.is_empty() {
        return Err(match cluster_node_filter {
            Some(address) => format!("Cluster node not found: {address}"),
            None => "Cluster returned no master nodes".to_string(),
        });
    }

    let mut collected = Vec::with_capacity(page_size.min(1_024));
    let mut cursor = parse_cluster_scan_cursor(input.cursor.as_deref())?;

    while cursor.node_index < master_nodes.len() && collected.len() < page_size {
        let (host, port, node_address) = &master_nodes[cursor.node_index];
        let mut connection = open_connection(&crate::models::RedisConnectionTestInput {
            host: host.clone(),
            port: *port,
            sentinel: None,
            cluster: None,
            username: input.connection.username.clone(),
            password: input.connection.password.clone(),
            db: 0,
            tls: input.connection.tls,
            ssh_tunnel: None,
        })
        .await?;

        loop {
            let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor.cursor)
                .arg("COUNT")
                .arg(scan_count)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to scan cluster node {host}:{port}: {error}"))?;

            for key in batch {
                collected.push(RedisKeySummary {
                    key: key.clone(),
                    key_type: None,
                    ttl: None,
                    slot: Some(get_slot(key.as_bytes())),
                    node_address: Some(node_address.clone()),
                });

                if collected.len() >= page_size {
                    break;
                }
            }

            cursor.cursor = next_cursor;

            if collected.len() >= page_size {
                break;
            }

            if cursor.cursor == 0 {
                cursor.node_index += 1;
                break;
            }
        }
    }

    let next_cursor = if cursor.node_index < master_nodes.len() && cursor.cursor != 0 {
        Some(serde_json::to_string(&cursor).map_err(|error| error.to_string())?)
    } else if cursor.node_index < master_nodes.len() {
        Some(
            serde_json::to_string(&ClusterScanCursor {
                node_index: cursor.node_index,
                cursor: 0,
            })
            .map_err(|error| error.to_string())?,
        )
    } else {
        None
    };

    Ok(RedisKeysScanPageResponse {
        keys: collected,
        next_cursor,
    })
}

async fn resolve_key_location(
    connection: &crate::models::RedisConnectionTestInput,
    key: &str,
) -> Result<(Option<u16>, Option<String>), String> {
    if connection.cluster.is_some() {
        let slot = get_slot(key.as_bytes());
        let node_address = find_cluster_node_address_for_slot(connection, slot).await?;
        Ok((Some(slot), node_address))
    } else {
        Ok((None, None))
    }
}

async fn inspect_key_summary(
    connection_input: &crate::models::RedisConnectionTestInput,
    key: &str,
) -> Result<RedisKeySummary, String> {
    let mut connection = open_connection(connection_input).await?;
    let (raw_type, ttl) = redis::pipe()
        .cmd("TYPE")
        .arg(key)
        .cmd("TTL")
        .arg(key)
        .query_async::<(String, i64)>(&mut connection)
        .await
        .map_err(|error| format!("Failed to inspect key: {error}"))?;

    if raw_type == "none" {
        return Err("Key no longer exists".to_string());
    }

    let (slot, node_address) = resolve_key_location(connection_input, key).await?;

    Ok(RedisKeySummary {
        key: key.to_string(),
        key_type: Some(normalize_key_type(&raw_type)),
        ttl: Some(ttl),
        slot,
        node_address,
    })
}

async fn scan_direct_keys_page(
    input: &RedisKeysScanPageInput,
    scan_count: u32,
    page_size: usize,
) -> Result<RedisKeysScanPageResponse, String> {
    let mut connection = open_connection(&input.connection).await?;
    let mut cursor = parse_direct_scan_cursor(input.cursor.as_deref())?;
    let mut keys = Vec::with_capacity(page_size.min(1_024));

    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("COUNT")
            .arg(scan_count)
            .query_async(&mut connection)
            .await
            .map_err(|error| format!("Failed to scan keys: {error}"))?;

        for key in batch {
            keys.push(RedisKeySummary {
                key,
                key_type: None,
                ttl: None,
                slot: None,
                node_address: None,
            });

            if keys.len() >= page_size {
                break;
            }
        }

        cursor = next_cursor;

        if cursor == 0 || keys.len() >= page_size {
            break;
        }
    }

    Ok(RedisKeysScanPageResponse {
        keys,
        next_cursor: if cursor == 0 {
            None
        } else {
            Some(cursor.to_string())
        },
    })
}

async fn list_cluster_keys(
    input: &RedisKeysListInput,
    scan_count: u32,
    max_keys: usize,
) -> Result<Vec<RedisKeySummary>, String> {
    let cluster_node_filter = input
        .cluster_node_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let topology = get_cluster_topology(&input.connection).await?;
    let master_nodes = topology
        .iter()
        .filter(|node| {
            cluster_node_filter
                .map(|value| value == node.address)
                .unwrap_or(true)
        })
        .map(|node| (node.host.clone(), node.port, node.address.clone()))
        .collect::<Vec<_>>();

    if master_nodes.is_empty() {
        return Err(match cluster_node_filter {
            Some(address) => format!("Cluster node not found: {address}"),
            None => "Cluster returned no master nodes".to_string(),
        });
    }
    let mut collected = Vec::with_capacity(max_keys.min(1_024));
    let mut seen_keys = HashSet::new();

    for (host, port, node_address) in master_nodes {
        let mut connection = open_connection(&crate::models::RedisConnectionTestInput {
            host: host.clone(),
            port,
            sentinel: None,
            cluster: None,
            username: input.connection.username.clone(),
            password: input.connection.password.clone(),
            db: 0,
            tls: input.connection.tls,
            ssh_tunnel: None,
        })
        .await?;

        let mut cursor = 0_u64;

        loop {
            let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("COUNT")
                .arg(scan_count)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to scan cluster node {host}:{port}: {error}"))?;

            for key in batch {
                if !seen_keys.insert(key.clone()) {
                    continue;
                }

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

                collected.push(RedisKeySummary {
                    key: key.clone(),
                    key_type: Some(normalize_key_type(&raw_type)),
                    ttl: Some(ttl),
                    slot: Some(get_slot(key.as_bytes())),
                    node_address: Some(node_address.clone()),
                });

                if collected.len() >= max_keys {
                    break;
                }
            }

            cursor = next_cursor;

            if cursor == 0 || collected.len() >= max_keys {
                break;
            }
        }

        if collected.len() >= max_keys {
            break;
        }
    }

    collected.sort_by(|left, right| left.key.cmp(&right.key));
    collected.truncate(max_keys);

    Ok(collected)
}

#[tauri::command]
pub async fn get_redis_cluster_topology(
    input: RedisClusterTopologyInput,
) -> Result<Vec<RedisClusterTopologyNode>, String> {
    if input.connection.cluster.is_none() {
        return Ok(Vec::new());
    }

    get_cluster_topology(&input.connection).await
}

#[tauri::command]
pub async fn list_redis_keys(input: RedisKeysListInput) -> Result<Vec<RedisKeySummary>, String> {
    let scan_count = input
        .scan_count
        .unwrap_or(DEFAULT_SCAN_COUNT)
        .clamp(1, MAX_SCAN_COUNT);
    let max_keys = input
        .max_keys
        .unwrap_or(DEFAULT_MAX_KEYS)
        .clamp(1, MAX_TOTAL_KEYS) as usize;

    if input.connection.cluster.is_some() {
        return list_cluster_keys(&input, scan_count, max_keys).await;
    }

    let mut connection = open_connection(&input.connection).await?;
    let mut cursor = 0_u64;
    let mut collected_keys: Vec<String> = Vec::with_capacity(max_keys.min(1_024));

    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("COUNT")
            .arg(scan_count)
            .query_async(&mut connection)
            .await
            .map_err(|error| format!("Failed to scan keys: {error}"))?;

        collected_keys.extend(batch);
        cursor = next_cursor;

        if cursor == 0 || collected_keys.len() >= max_keys {
            break;
        }
    }

    collected_keys.sort();
    collected_keys.dedup();
    collected_keys.truncate(max_keys);

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
            key_type: Some(normalize_key_type(&raw_type)),
            ttl: Some(ttl),
            slot: None,
            node_address: None,
        });

        if keys.len() >= max_keys {
            break;
        }
    }

    Ok(keys)
}

#[tauri::command]
pub async fn scan_redis_keys_page(
    input: RedisKeysScanPageInput,
) -> Result<RedisKeysScanPageResponse, String> {
    let scan_count = input
        .scan_count
        .unwrap_or(DEFAULT_SCAN_COUNT)
        .clamp(1, MAX_SCAN_COUNT);
    let page_size = clamp_scan_page_size(input.page_size);

    if input.connection.cluster.is_some() {
        return scan_cluster_keys_page(&input, scan_count, page_size).await;
    }

    scan_direct_keys_page(&input, scan_count, page_size).await
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

    let (slot, node_address) = resolve_key_location(&input.connection, &input.key).await?;

    Ok(RedisKeyValueResponse {
        key: input.key,
        key_type,
        ttl,
        slot,
        node_address,
        value,
    })
}

#[tauri::command]
pub async fn get_redis_key_summary(input: RedisKeyLookupInput) -> Result<RedisKeySummary, String> {
    inspect_key_summary(&input.connection, &input.key).await
}

#[tauri::command]
pub async fn get_redis_key_type(input: RedisKeyLookupInput) -> Result<Option<String>, String> {
    let mut connection = open_connection(&input.connection).await?;
    let raw_type: String = redis::cmd("TYPE")
        .arg(&input.key)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to inspect key type: {error}"))?;

    if raw_type == "none" {
        return Ok(None);
    }

    Ok(Some(normalize_key_type(&raw_type)))
}

#[tauri::command]
pub async fn get_redis_key_value_page(
    input: RedisKeyValuePageInput,
) -> Result<RedisKeyValuePageResponse, String> {
    let page_size = clamp_value_page_size(input.page_size);
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
    let mut next_cursor = None;
    let mut total_count = None;
    let mut loaded_count_override = None;

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
            let count: u64 = redis::cmd("HLEN")
                .arg(&input.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to inspect hash size: {error}"))?;
            total_count = Some(count);

            let mut cursor = parse_direct_scan_cursor(input.cursor.as_deref())?;
            let mut entries: Vec<(String, String)> = Vec::with_capacity(page_size as usize);

            loop {
                let (next, batch): (u64, Vec<(String, String)>) = redis::cmd("HSCAN")
                    .arg(&input.key)
                    .arg(cursor)
                    .arg("COUNT")
                    .arg(page_size)
                    .query_async(&mut connection)
                    .await
                    .map_err(|error| format!("Failed to scan hash value: {error}"))?;

                entries.extend(batch);
                cursor = next;

                if cursor == 0 || entries.len() >= page_size as usize {
                    break;
                }
            }

            entries.truncate(page_size as usize);
            next_cursor = if cursor == 0 {
                None
            } else {
                Some(cursor.to_string())
            };

            JsonValue::Object(
                entries
                    .into_iter()
                    .map(|(field, value)| (field, JsonValue::String(value)))
                    .collect(),
            )
        }
        "list" => {
            let count: u64 = redis::cmd("LLEN")
                .arg(&input.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to inspect list size: {error}"))?;
            total_count = Some(count);

            let start = parse_direct_scan_cursor(input.cursor.as_deref())?;
            let stop = start.saturating_add(page_size as u64).saturating_sub(1);
            let items: Vec<String> = redis::cmd("LRANGE")
                .arg(&input.key)
                .arg(start as i64)
                .arg(stop as i64)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get list value page: {error}"))?;
            let loaded = start.saturating_add(items.len() as u64);

            next_cursor = if loaded < count {
                Some(loaded.to_string())
            } else {
                None
            };

            JsonValue::Array(items.into_iter().map(JsonValue::String).collect())
        }
        "set" => {
            let count: u64 = redis::cmd("SCARD")
                .arg(&input.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to inspect set size: {error}"))?;
            total_count = Some(count);

            let mut cursor = parse_direct_scan_cursor(input.cursor.as_deref())?;
            let mut items: Vec<String> = Vec::with_capacity(page_size as usize);

            loop {
                let (next, batch): (u64, Vec<String>) = redis::cmd("SSCAN")
                    .arg(&input.key)
                    .arg(cursor)
                    .arg("COUNT")
                    .arg(page_size)
                    .query_async(&mut connection)
                    .await
                    .map_err(|error| format!("Failed to scan set value: {error}"))?;

                items.extend(batch);
                cursor = next;

                if cursor == 0 || items.len() >= page_size as usize {
                    break;
                }
            }

            items.truncate(page_size as usize);
            next_cursor = if cursor == 0 {
                None
            } else {
                Some(cursor.to_string())
            };

            JsonValue::Array(items.into_iter().map(JsonValue::String).collect())
        }
        "zset" => {
            let count: u64 = redis::cmd("ZCARD")
                .arg(&input.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to inspect sorted set size: {error}"))?;
            total_count = Some(count);

            let start = parse_direct_scan_cursor(input.cursor.as_deref())?;
            let stop = start.saturating_add(page_size as u64).saturating_sub(1);
            let members: Vec<(String, f64)> = redis::cmd("ZRANGE")
                .arg(&input.key)
                .arg(start as i64)
                .arg(stop as i64)
                .arg("WITHSCORES")
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get sorted set value page: {error}"))?;
            let loaded = start.saturating_add(members.len() as u64);

            next_cursor = if loaded < count {
                Some(loaded.to_string())
            } else {
                None
            };

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
            let (count, stream_value): (u64, Value) = redis::pipe()
                .cmd("XLEN")
                .arg(&input.key)
                .cmd("XRANGE")
                .arg(&input.key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(100)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to get stream value: {error}"))?;

            total_count = Some(count);
            loaded_count_override = Some(count.min(100));

            JsonValue::String(format_cli_output(stream_value))
        }
        _ => JsonValue::Null,
    };

    let loaded_count = loaded_count_override.unwrap_or_else(|| match &value {
        JsonValue::Object(entries) => entries.len() as u64,
        JsonValue::Array(items) => items.len() as u64,
        JsonValue::Null => 0,
        _ => 1,
    });
    let (slot, node_address) = resolve_key_location(&input.connection, &input.key).await?;

    Ok(RedisKeyValuePageResponse {
        key: input.key,
        key_type,
        ttl,
        slot,
        node_address,
        value,
        next_cursor,
        total_count,
        loaded_count,
        page_size,
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
    if input.connection.cluster.is_some() {
        for rename in &input.renames {
            rename_redis_key(RedisKeyRenameInput {
                connection: input.connection.clone(),
                old_key: rename.old_key.clone(),
                new_key: rename.new_key.clone(),
            })
            .await?;
        }

        return Ok(());
    }

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
