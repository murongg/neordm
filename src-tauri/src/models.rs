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
pub(crate) struct RedisClusterTopologyInput {
    pub(crate) connection: RedisConnectionTestInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyLookupInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
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
pub(crate) struct RedisKeySummary {
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: String,
    pub(crate) ttl: i64,
    pub(crate) slot: Option<u16>,
    pub(crate) node_address: Option<String>,
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
