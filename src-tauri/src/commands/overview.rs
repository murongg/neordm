use crate::models::RedisOverviewMetricsInput;
use crate::models::RedisOverviewMetricsResponse;
use crate::redis_support::{open_connection, redis_value_to_string};
use redis::Value;
use std::collections::HashMap;

#[derive(Clone, Copy)]
struct RedisInfoSections<'a> {
    server: &'a str,
    memory: &'a str,
    clients: &'a str,
    stats: &'a str,
    replication: &'a str,
    keyspace: &'a str,
}

fn parse_info_section(output: &str) -> HashMap<String, String> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }

            let separator_index = trimmed.find(':')?;
            let key = trimmed[..separator_index].trim();
            let value = trimmed[separator_index + 1..].trim();

            if key.is_empty() {
                return None;
            }

            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn parse_optional_u64(section: &HashMap<String, String>, key: &str) -> Option<u64> {
    section.get(key)?.parse::<u64>().ok()
}

fn parse_optional_u16(section: &HashMap<String, String>, key: &str) -> Option<u16> {
    section.get(key)?.parse::<u16>().ok()
}

fn parse_optional_f64(section: &HashMap<String, String>, key: &str) -> Option<f64> {
    section.get(key)?.parse::<f64>().ok()
}

fn parse_optional_string(section: &HashMap<String, String>, key: &str) -> Option<String> {
    let value = section.get(key)?.trim();

    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn compute_cache_hit_rate(hits: Option<u64>, misses: Option<u64>) -> Option<f64> {
    let total = hits?.checked_add(misses?)?;

    if total == 0 {
        return None;
    }

    Some(((hits? as f64 / total as f64) * 1000.0).round() / 10.0)
}

fn build_keyspace_summary(section: &HashMap<String, String>) -> Option<String> {
    let mut parts = section
        .iter()
        .filter(|(database, _)| database.starts_with("db"))
        .filter_map(|(database, raw_value)| {
            let mut keys = None;
            let mut expires = None;

            for part in raw_value.split(',') {
                let (name, value) = part.split_once('=')?;

                match name.trim() {
                    "keys" => {
                        keys = value.trim().parse::<u64>().ok();
                    }
                    "expires" => {
                        expires = value.trim().parse::<u64>().ok();
                    }
                    _ => {}
                }
            }

            let keys = keys?;
            let expires = expires.unwrap_or(0);

            Some((
                database.clone(),
                if expires > 0 {
                    format!("{database} ({keys} keys, {expires} expiring)")
                } else {
                    format!("{database} ({keys} keys)")
                },
            ))
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return None;
    }

    parts.sort_by(|left, right| left.0.cmp(&right.0));

    Some(
        parts
            .into_iter()
            .map(|(_, summary)| summary)
            .collect::<Vec<_>>()
            .join(" · "),
    )
}

fn get_mode_label(input: &RedisOverviewMetricsInput) -> String {
    if input.connection.cluster.is_some() {
        return "Cluster".to_string();
    }

    if input.connection.sentinel.is_some() {
        return "Sentinel".to_string();
    }

    "Direct".to_string()
}

fn parse_overview_metrics_from_info_sections(
    sections: RedisInfoSections<'_>,
    mode_label: &str,
) -> RedisOverviewMetricsResponse {
    let server = parse_info_section(sections.server);
    let memory = parse_info_section(sections.memory);
    let clients = parse_info_section(sections.clients);
    let stats = parse_info_section(sections.stats);
    let replication = parse_info_section(sections.replication);
    let keyspace = parse_info_section(sections.keyspace);
    let keyspace_hits = parse_optional_u64(&stats, "keyspace_hits");
    let keyspace_misses = parse_optional_u64(&stats, "keyspace_misses");

    RedisOverviewMetricsResponse {
        memory_used_bytes: parse_optional_u64(&memory, "used_memory"),
        memory_peak_bytes: parse_optional_u64(&memory, "used_memory_peak"),
        memory_rss_bytes: parse_optional_u64(&memory, "used_memory_rss"),
        memory_fragmentation_ratio: parse_optional_f64(&memory, "mem_fragmentation_ratio"),
        connected_clients: parse_optional_u64(&clients, "connected_clients"),
        blocked_clients: parse_optional_u64(&clients, "blocked_clients"),
        instant_ops_per_sec: parse_optional_u64(&stats, "instantaneous_ops_per_sec"),
        keyspace_hits,
        keyspace_misses,
        cache_hit_rate: compute_cache_hit_rate(keyspace_hits, keyspace_misses),
        total_net_input_bytes: parse_optional_u64(&stats, "total_net_input_bytes"),
        total_net_output_bytes: parse_optional_u64(&stats, "total_net_output_bytes"),
        expired_keys: parse_optional_u64(&stats, "expired_keys"),
        evicted_keys: parse_optional_u64(&stats, "evicted_keys"),
        redis_version: parse_optional_string(&server, "redis_version"),
        role: parse_optional_string(&replication, "role"),
        uptime_seconds: parse_optional_u64(&server, "uptime_in_seconds"),
        tcp_port: parse_optional_u16(&server, "tcp_port"),
        keyspace_summary: build_keyspace_summary(&keyspace),
        mode_label: mode_label.to_string(),
    }
}

fn parse_info_pipeline_response(values: Vec<Value>) -> Result<[String; 6], String> {
    let outputs = values
        .into_iter()
        .map(redis_value_to_string)
        .collect::<Result<Vec<_>, _>>()?;

    match outputs.try_into() {
        Ok(array) => Ok(array),
        Err(outputs) => Err(format!(
            "Redis returned {} INFO sections, expected 6",
            outputs.len()
        )),
    }
}

#[tauri::command]
pub async fn get_redis_overview_metrics(
    input: RedisOverviewMetricsInput,
) -> Result<RedisOverviewMetricsResponse, String> {
    let mut connection = open_connection(&input.connection).await?;
    let response: Vec<Value> = redis::pipe()
        .cmd("INFO")
        .arg("server")
        .cmd("INFO")
        .arg("memory")
        .cmd("INFO")
        .arg("clients")
        .cmd("INFO")
        .arg("stats")
        .cmd("INFO")
        .arg("replication")
        .cmd("INFO")
        .arg("keyspace")
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to load Redis overview metrics: {error}"))?;
    let [server, memory, clients, stats, replication, keyspace] =
        parse_info_pipeline_response(response)?;

    Ok(parse_overview_metrics_from_info_sections(
        RedisInfoSections {
            server: &server,
            memory: &memory,
            clients: &clients,
            stats: &stats,
            replication: &replication,
            keyspace: &keyspace,
        },
        &get_mode_label(&input),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sections<'a>(
        server: &'a str,
        memory: &'a str,
        clients: &'a str,
        stats: &'a str,
        replication: &'a str,
        keyspace: &'a str,
    ) -> RedisInfoSections<'a> {
        RedisInfoSections {
            server,
            memory,
            clients,
            stats,
            replication,
            keyspace,
        }
    }

    #[test]
    fn parses_overview_metrics_from_info_sections() {
        let metrics = parse_overview_metrics_from_info_sections(
            sections(
                "redis_version:7.2.4\nuptime_in_seconds:3600\ntcp_port:6379",
                "used_memory:1048576\nused_memory_peak:2097152\nused_memory_rss:3145728\nmem_fragmentation_ratio:1.5",
                "connected_clients:18\nblocked_clients:2",
                "instantaneous_ops_per_sec:321\nkeyspace_hits:900\nkeyspace_misses:100\ntotal_net_input_bytes:2048\ntotal_net_output_bytes:4096\nexpired_keys:12\nevicted_keys:3",
                "role:master",
                "db0:keys=25,expires=7,avg_ttl=12345\ndb1:keys=3,expires=0,avg_ttl=0",
            ),
            "Direct",
        );

        assert_eq!(metrics.memory_used_bytes, Some(1_048_576));
        assert_eq!(metrics.memory_peak_bytes, Some(2_097_152));
        assert_eq!(metrics.memory_rss_bytes, Some(3_145_728));
        assert_eq!(metrics.memory_fragmentation_ratio, Some(1.5));
        assert_eq!(metrics.connected_clients, Some(18));
        assert_eq!(metrics.blocked_clients, Some(2));
        assert_eq!(metrics.instant_ops_per_sec, Some(321));
        assert_eq!(metrics.keyspace_hits, Some(900));
        assert_eq!(metrics.keyspace_misses, Some(100));
        assert_eq!(metrics.cache_hit_rate, Some(90.0));
        assert_eq!(metrics.total_net_input_bytes, Some(2_048));
        assert_eq!(metrics.total_net_output_bytes, Some(4_096));
        assert_eq!(metrics.expired_keys, Some(12));
        assert_eq!(metrics.evicted_keys, Some(3));
        assert_eq!(metrics.redis_version.as_deref(), Some("7.2.4"));
        assert_eq!(metrics.role.as_deref(), Some("master"));
        assert_eq!(metrics.uptime_seconds, Some(3_600));
        assert_eq!(metrics.tcp_port, Some(6_379));
        assert_eq!(
            metrics.keyspace_summary.as_deref(),
            Some("db0 (25 keys, 7 expiring) · db1 (3 keys)")
        );
        assert_eq!(metrics.mode_label, "Direct");
    }

    #[test]
    fn computes_cache_hit_rate_without_divide_by_zero() {
        let metrics = parse_overview_metrics_from_info_sections(
            sections(
                "",
                "",
                "",
                "keyspace_hits:0\nkeyspace_misses:0",
                "",
                "",
            ),
            "Direct",
        );

        assert_eq!(metrics.keyspace_hits, Some(0));
        assert_eq!(metrics.keyspace_misses, Some(0));
        assert_eq!(metrics.cache_hit_rate, None);
    }

    #[test]
    fn tolerates_missing_optional_info_fields() {
        let metrics = parse_overview_metrics_from_info_sections(
            sections(
                "redis_version:7.0.0",
                "",
                "connected_clients:4",
                "",
                "",
                "",
            ),
            "Sentinel",
        );

        assert_eq!(metrics.memory_used_bytes, None);
        assert_eq!(metrics.memory_fragmentation_ratio, None);
        assert_eq!(metrics.connected_clients, Some(4));
        assert_eq!(metrics.role, None);
        assert_eq!(metrics.keyspace_summary, None);
        assert_eq!(metrics.mode_label, "Sentinel");
    }

    #[test]
    fn builds_keyspace_summary_from_info_keyspace() {
        let summary = build_keyspace_summary(&parse_info_section(
            "db2:keys=8,expires=3,avg_ttl=333\ndb0:keys=120,expires=0,avg_ttl=0",
        ));

        assert_eq!(summary.as_deref(), Some("db0 (120 keys) · db2 (8 keys, 3 expiring)"));
    }
}
