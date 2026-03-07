use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisConnectionTestInput {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) password: Option<String>,
    pub(crate) db: i64,
    pub(crate) tls: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedisKeyLookupInput {
    pub(crate) connection: RedisConnectionTestInput,
    pub(crate) key: String,
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

#[derive(Debug, Serialize)]
pub(crate) struct RedisKeySummary {
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: String,
    pub(crate) ttl: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct RedisKeyValueResponse {
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) key_type: String,
    pub(crate) ttl: i64,
    pub(crate) value: JsonValue,
}
