use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSshTunnelInput {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: Option<String>,
    pub(crate) private_key_path: Option<String>,
    pub(crate) passphrase: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSentinelNodeInput {
    pub(crate) host: String,
    pub(crate) port: u16,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSentinelInput {
    pub(crate) master_name: String,
    pub(crate) nodes: Vec<RedisSentinelNodeInput>,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
    pub(crate) tls: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisClusterNodeInput {
    pub(crate) host: String,
    pub(crate) port: u16,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisClusterInput {
    pub(crate) nodes: Vec<RedisClusterNodeInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisConnectionTestInput {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) sentinel: Option<RedisSentinelInput>,
    pub(crate) cluster: Option<RedisClusterInput>,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
    pub(crate) db: i64,
    pub(crate) tls: bool,
    pub(crate) ssh_tunnel: Option<RedisSshTunnelInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeysListInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) scan_count: Option<u32>,
    pub(crate) max_keys: Option<u32>,
    pub(crate) cluster_node_address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeysScanPageInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) scan_count: Option<u32>,
    pub(crate) page_size: Option<u32>,
    pub(crate) cursor: Option<String>,
    pub(crate) cluster_node_address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisClusterTopologyInput {
    pub(crate) connection: RedisConnectionTestInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyLookupInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyValuePageInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) page_size: Option<u32>,
    pub(crate) cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamGroupLookupInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) group: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamGroupCreateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) group: String,
    pub(crate) start_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamConsumerDeleteInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) group: String,
    pub(crate) consumer: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamEntryAppendInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) entries: Vec<RedisKeyCreateEntryInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamEntriesLookupInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) page_size: Option<u32>,
    pub(crate) cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamPendingEntriesInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) group: String,
    pub(crate) count: Option<u32>,
    pub(crate) consumer: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamAckInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) group: String,
    pub(crate) ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamEntryDeleteInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamClaimInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) group: String,
    pub(crate) consumer: String,
    pub(crate) min_idle_time: u64,
    pub(crate) ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyCreateEntryInput {
    pub(crate) field: String,
    pub(crate) value: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyCreateMemberInput {
    pub(crate) member: String,
    pub(crate) score: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyCreateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: String,
    pub(crate) ttl: Option<i64>,
    pub(crate) value: Option<String>,
    pub(crate) values: Option<Vec<String>>,
    pub(crate) entries: Option<Vec<RedisKeyCreateEntryInput>>,
    pub(crate) members: Option<Vec<RedisKeyCreateMemberInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisCommandInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSlowLogInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisOverviewMetricsInput {
    pub(crate) connection: RedisConnectionTestInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisPubSubStartInput {
    pub(crate) connection: RedisConnectionTestInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisPubSubSessionInput {
    pub(crate) session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisPubSubChannelsInput {
    pub(crate) session_id: String,
    pub(crate) channels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisPubSubPublishInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) channel: String,
    pub(crate) payload: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyRenameInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) old_key: String,
    pub(crate) new_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyRenamePairInput {
    pub(crate) old_key: String,
    pub(crate) new_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeysRenameInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) renames: Vec<RedisKeyRenamePairInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisHashEntryUpdateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) old_field: String,
    pub(crate) new_field: String,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisHashEntryDeleteInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) field: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisHashEntryAddInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) field: String,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStringValueUpdateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisJsonValueUpdateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisZSetEntryUpdateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) old_member: String,
    pub(crate) new_member: String,
    pub(crate) score: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisZSetEntryDeleteInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) member: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisZSetEntryAddInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) member: String,
    pub(crate) score: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisListValueAppendInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) value: String,
    pub(crate) position: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisListValueUpdateInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) index: i64,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisListValueDeleteInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) index: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSetMemberAddInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
    pub(crate) member: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpProxyHeaderInput {
    pub(crate) name: String,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpProxyRequestInput {
    pub(crate) url: String,
    pub(crate) method: String,
    pub(crate) headers: Vec<HttpProxyHeaderInput>,
    pub(crate) body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpProxyHeaderOutput {
    pub(crate) name: String,
    pub(crate) value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpProxyResponse {
    pub(crate) status: u16,
    pub(crate) status_text: String,
    pub(crate) headers: Vec<HttpProxyHeaderOutput>,
    pub(crate) body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeySummary {
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: Option<String>,
    pub(crate) ttl: Option<i64>,
    pub(crate) slot: Option<u16>,
    pub(crate) node_address: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeysScanPageResponse {
    pub(crate) keys: Vec<RedisKeySummary>,
    pub(crate) next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RedisKeyValueResponse {
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: String,
    pub(crate) ttl: i64,
    pub(crate) slot: Option<u16>,
    pub(crate) node_address: Option<String>,
    pub(crate) value: JsonValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyValuePageResponse {
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: String,
    pub(crate) ttl: i64,
    pub(crate) slot: Option<u16>,
    pub(crate) node_address: Option<String>,
    pub(crate) value: JsonValue,
    pub(crate) next_cursor: Option<String>,
    pub(crate) total_count: Option<u64>,
    pub(crate) loaded_count: u64,
    pub(crate) page_size: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSlowLogEntry {
    pub(crate) id: u64,
    pub(crate) started_at: u64,
    pub(crate) duration_us: u64,
    pub(crate) arguments: Vec<String>,
    pub(crate) client_address: Option<String>,
    pub(crate) client_name: Option<String>,
    pub(crate) node_address: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisSlowLogResponse {
    pub(crate) total_count: u64,
    pub(crate) limit: u32,
    pub(crate) entries: Vec<RedisSlowLogEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisOverviewMetricsResponse {
    pub(crate) memory_used_bytes: Option<u64>,
    pub(crate) memory_peak_bytes: Option<u64>,
    pub(crate) memory_rss_bytes: Option<u64>,
    pub(crate) memory_fragmentation_ratio: Option<f64>,
    pub(crate) connected_clients: Option<u64>,
    pub(crate) blocked_clients: Option<u64>,
    pub(crate) instant_ops_per_sec: Option<u64>,
    pub(crate) keyspace_hits: Option<u64>,
    pub(crate) keyspace_misses: Option<u64>,
    pub(crate) cache_hit_rate: Option<f64>,
    pub(crate) total_net_input_bytes: Option<u64>,
    pub(crate) total_net_output_bytes: Option<u64>,
    pub(crate) expired_keys: Option<u64>,
    pub(crate) evicted_keys: Option<u64>,
    pub(crate) redis_version: Option<String>,
    pub(crate) role: Option<String>,
    pub(crate) uptime_seconds: Option<u64>,
    pub(crate) tcp_port: Option<u16>,
    pub(crate) keyspace_summary: Option<String>,
    pub(crate) mode_label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamConsumerGroup {
    pub(crate) name: String,
    pub(crate) consumers: u64,
    pub(crate) pending: u64,
    pub(crate) last_delivered_id: String,
    pub(crate) entries_read: Option<u64>,
    pub(crate) lag: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamEntryField {
    pub(crate) field: String,
    pub(crate) value: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamEntry {
    pub(crate) id: String,
    pub(crate) fields: Vec<RedisStreamEntryField>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamEntriesResponse {
    pub(crate) total_count: u64,
    pub(crate) next_cursor: Option<String>,
    pub(crate) entries: Vec<RedisStreamEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamConsumer {
    pub(crate) name: String,
    pub(crate) pending: u64,
    pub(crate) idle: u64,
    pub(crate) inactive: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisStreamPendingEntry {
    pub(crate) id: String,
    pub(crate) consumer: String,
    pub(crate) idle: u64,
    pub(crate) deliveries: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisClusterSlotRange {
    pub(crate) start: u16,
    pub(crate) end: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisClusterTopologyNode {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) address: String,
    pub(crate) slot_ranges: Vec<RedisClusterSlotRange>,
    pub(crate) slot_count: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum RedisPubSubEvent {
    Message {
        #[serde(rename = "sessionId")]
        session_id: String,
        channel: String,
        payload: String,
        pattern: Option<String>,
        timestamp: u64,
    },
    Closed {
        #[serde(rename = "sessionId")]
        session_id: String,
        reason: Option<String>,
    },
}
