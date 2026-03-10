mod commands;
mod models;
mod redis_support;

#[cfg(target_os = "macos")]
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

#[cfg(target_os = "macos")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use serde_json::{Map as JsonMap, Value as JsonValue};
#[cfg(target_os = "macos")]
use tauri::{
    image::Image,
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, Listener, Manager, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri_plugin_store::StoreExt;

#[cfg(target_os = "macos")]
use crate::models::{
    RedisClusterInput, RedisConnectionTestInput, RedisSentinelInput, RedisSshTunnelInput,
};
#[cfg(target_os = "macos")]
use crate::redis_support::open_connection;
use crate::commands::{
    ack_redis_stream_entries, add_redis_hash_entry, add_redis_set_member, add_redis_zset_entry,
    append_redis_list_value, append_redis_stream_entry, claim_redis_stream_entries,
    create_redis_key, create_redis_stream_consumer_group, delete_redis_hash_entry,
    delete_redis_list_value, delete_redis_stream_consumer, delete_redis_stream_entries,
    delete_redis_zset_entry, destroy_redis_stream_consumer_group, get_redis_cluster_topology,
    get_redis_key_value, get_redis_stream_consumers, get_redis_stream_entries,
    get_redis_stream_groups, get_redis_stream_pending_entries, greet, list_redis_keys,
    proxy_http_request, publish_redis_pubsub_message, rename_redis_key, rename_redis_keys,
    run_redis_command, start_redis_pubsub_session, stop_redis_pubsub_session,
    subscribe_redis_pubsub_channels, subscribe_redis_pubsub_patterns, test_redis_connection,
    unsubscribe_redis_pubsub_channels, unsubscribe_redis_pubsub_patterns,
    update_redis_hash_entry, update_redis_json_value, update_redis_list_value,
    update_redis_string_value, update_redis_zset_entry, RedisPubSubState,
};

#[cfg(target_os = "macos")]
const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(target_os = "macos")]
const STATUSBAR_TRAY_ID: &str = "statusbar";
#[cfg(target_os = "macos")]
const TRAY_OPEN_WINDOW_ID: &str = "tray_open_window";
#[cfg(target_os = "macos")]
const TRAY_HIDE_WINDOW_ID: &str = "tray_hide_window";
#[cfg(target_os = "macos")]
const TRAY_NEW_CONNECTION_ID: &str = "tray_new_connection";
#[cfg(target_os = "macos")]
const TRAY_BROWSE_KEYS_ID: &str = "tray_browse_keys";
#[cfg(target_os = "macos")]
const TRAY_REFRESH_KEYS_ID: &str = "tray_refresh_keys";
#[cfg(target_os = "macos")]
const TRAY_OPEN_CLI_ID: &str = "tray_open_cli";
#[cfg(target_os = "macos")]
const TRAY_OPEN_PUBSUB_ID: &str = "tray_open_pubsub";
#[cfg(target_os = "macos")]
const TRAY_DISCONNECT_ID: &str = "tray_disconnect";
#[cfg(target_os = "macos")]
const TRAY_QUIT_ID: &str = "tray_quit";
#[cfg(target_os = "macos")]
const TRAY_CURRENT_SUBMENU_ID: &str = "tray_current_submenu";
#[cfg(target_os = "macos")]
const TRAY_CONNECTIONS_SUBMENU_ID: &str = "tray_connections_submenu";
#[cfg(target_os = "macos")]
const TRAY_PINNED_KEYS_SUBMENU_ID: &str = "tray_pinned_keys_submenu";
#[cfg(target_os = "macos")]
const TRAY_RECENT_KEYS_SUBMENU_ID: &str = "tray_recent_keys_submenu";
#[cfg(target_os = "macos")]
const TRAY_QUICK_ACTIONS_SUBMENU_ID: &str = "tray_quick_actions_submenu";
#[cfg(target_os = "macos")]
const TRAY_QUICK_ACTION_EVENT: &str = "neordm://tray/quick-action";
#[cfg(target_os = "macos")]
const TRAY_STATUSBAR_EVENT: &str = "neordm://tray/action";
#[cfg(target_os = "macos")]
const TRAY_STATUSBAR_CONTEXT_EVENT: &str = "neordm://tray/context";
#[cfg(target_os = "macos")]
const STATUSBAR_STORE_PATH: &str = "statusbar.json";
#[cfg(target_os = "macos")]
const STATUSBAR_PINNED_KEYS_STORE_KEY: &str = "pinnedKeys";
#[cfg(target_os = "macos")]
const STATUSBAR_ICON_BYTES: &[u8] = include_bytes!("../icons/statusbar_icon.png");
#[cfg(target_os = "macos")]
const STATUSBAR_TEXT_LIMIT: usize = 64;
#[cfg(target_os = "macos")]
const STATUSBAR_VALUE_PREVIEW_LIMIT: usize = 88;
#[cfg(target_os = "macos")]
const STATUSBAR_PINNED_KEY_LIMIT: usize = 8;
#[cfg(target_os = "macos")]
const STATUSBAR_RECENT_KEY_LIMIT: usize = 6;

#[cfg(target_os = "macos")]
#[derive(Clone, Debug)]
enum StatusBarAction {
    SelectConnection { connection_id: String },
    OpenKey { connection_id: String, key: String },
    DeleteKey { connection_id: String, key: String },
    PinKey {
        connection_id: String,
        key_entry: StatusBarKeyEntry,
    },
    UnpinKey { connection_id: String, key: String },
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct StatusBarState {
    selected_connection_id: Mutex<Option<String>>,
    menu_actions: Mutex<HashMap<String, StatusBarAction>>,
    recent_keys: Mutex<HashMap<String, Vec<StatusBarKeyEntry>>>,
    pinned_keys: Mutex<HashMap<String, Vec<StatusBarKeyEntry>>>,
    synced_connections: Mutex<Option<Vec<StoredStatusBarConnection>>>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatusBarSettings {
    #[serde(default)]
    ui: StoredStatusBarUiSettings,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatusBarUiSettings {
    #[serde(default)]
    last_connection_id: String,
}

#[cfg(target_os = "macos")]
impl StoredStatusBarSettings {
    fn last_connection_id(&self) -> Option<&str> {
        let connection_id = self.ui.last_connection_id.trim();

        if connection_id.is_empty() {
            None
        } else {
            Some(connection_id)
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatusBarConnection {
    id: String,
    name: String,
    host: String,
    port: u16,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    sentinel: Option<RedisSentinelInput>,
    #[serde(default)]
    cluster: Option<RedisClusterInput>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    db: i64,
    #[serde(default)]
    tls: bool,
    #[serde(default)]
    ssh_tunnel: Option<RedisSshTunnelInput>,
}

#[cfg(target_os = "macos")]
impl StoredStatusBarConnection {
    fn to_connection_input(&self) -> RedisConnectionTestInput {
        let mode = self.mode.as_deref();
        let cluster = if matches!(mode, Some("cluster")) || self.cluster.is_some() {
            self.cluster.clone()
        } else {
            None
        };
        let sentinel = if matches!(mode, Some("sentinel")) || self.sentinel.is_some() {
            self.sentinel.clone()
        } else {
            None
        };

        RedisConnectionTestInput {
            host: self.host.clone(),
            port: self.port,
            sentinel,
            cluster,
            username: self.username.clone(),
            password: self.password.clone(),
            db: if self.cluster.is_some() { 0 } else { self.db },
            tls: self.tls,
            ssh_tunnel: self.ssh_tunnel.clone(),
        }
    }

    fn mode_label(&self) -> &'static str {
        if matches!(self.mode.as_deref(), Some("cluster")) || self.cluster.is_some() {
            "cluster"
        } else if matches!(self.mode.as_deref(), Some("sentinel")) || self.sentinel.is_some() {
            "sentinel"
        } else {
            "direct"
        }
    }

    fn endpoint_label(&self) -> String {
        match self.mode_label() {
            "cluster" => format!("{}:{} · cluster", self.host, self.port),
            "sentinel" => format!("{}:{} · sentinel", self.host, self.port),
            _ => format!("{}:{} · db {}", self.host, self.port, self.db),
        }
    }

    fn menu_label(&self) -> String {
        format!(
            "{} · {}",
            truncate_statusbar_text(&self.name, 24),
            truncate_statusbar_text(&self.endpoint_label(), 32)
        )
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusBarKeyEntry {
    key: String,
    key_type: String,
    ttl: i64,
    slot: Option<u16>,
    node_address: Option<String>,
    preview: String,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayStatusbarEventPayload {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    panel: Option<&'static str>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum TrayStatusbarContextPayload {
    #[serde(rename_all = "camelCase")]
    SyncConnection { connection_id: String },
    #[serde(rename_all = "camelCase")]
    SyncConnections {
        active_connection_id: Option<String>,
        connections: Vec<StoredStatusBarConnection>,
    },
    #[serde(rename_all = "camelCase")]
    SyncKey {
        connection_id: String,
        key: String,
        key_type: String,
        ttl: i64,
        slot: Option<u16>,
        node_address: Option<String>,
        preview: String,
    },
}

#[cfg(target_os = "macos")]
struct StatusBarMenuContext {
    next_id: usize,
    actions: HashMap<String, StatusBarAction>,
}

#[cfg(target_os = "macos")]
impl StatusBarMenuContext {
    fn new() -> Self {
        Self {
            next_id: 0,
            actions: HashMap::new(),
        }
    }

    fn next_info_id(&mut self, prefix: &str) -> String {
        let id = format!("statusbar_{prefix}_{}", self.next_id);
        self.next_id += 1;
        id
    }

    fn register_action(&mut self, prefix: &str, action: StatusBarAction) -> String {
        let id = self.next_info_id(prefix);
        self.actions.insert(id.clone(), action);
        id
    }
}

#[cfg(target_os = "macos")]
fn statusbar_icon() -> Option<Image<'static>> {
    static STATUSBAR_ICON: OnceLock<Option<Image<'static>>> = OnceLock::new();

    STATUSBAR_ICON
        .get_or_init(|| Image::from_bytes(STATUSBAR_ICON_BYTES).ok())
        .clone()
}

#[cfg(target_os = "macos")]
fn truncate_statusbar_text(value: &str, limit: usize) -> String {
    let mut characters = value.chars();
    let mut truncated = String::new();

    for _ in 0..limit {
        let Some(character) = characters.next() else {
            return value.to_string();
        };

        truncated.push(character);
    }

    if characters.next().is_some() {
        truncated.push('…');
    }

    truncated
}

#[cfg(target_os = "macos")]
fn collapse_statusbar_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(target_os = "macos")]
fn format_statusbar_ttl(ttl: i64) -> String {
    match ttl {
        -2 => "expired".to_string(),
        -1 => "persistent".to_string(),
        seconds if seconds < 60 => format!("{seconds}s"),
        seconds if seconds < 3_600 => format!("{}m {}s", seconds / 60, seconds % 60),
        seconds if seconds < 86_400 => {
            format!("{}h {}m", seconds / 3_600, (seconds % 3_600) / 60)
        }
        seconds => format!("{}d {}h", seconds / 86_400, (seconds % 86_400) / 3_600),
    }
}

#[cfg(target_os = "macos")]
fn show_main_window(app: &AppHandle) {
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    let _ = app.set_dock_visibility(true);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }

    let _ = app.set_dock_visibility(false);
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

#[cfg(target_os = "macos")]
fn emit_tray_quick_action(app: &AppHandle, action: &str) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_QUICK_ACTION_EVENT, action);
}

#[cfg(target_os = "macos")]
fn emit_tray_statusbar_event(app: &AppHandle, payload: TrayStatusbarEventPayload) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_STATUSBAR_EVENT, payload);
}

#[cfg(target_os = "macos")]
fn current_statusbar_selected_connection_id(app: &AppHandle) -> Option<String> {
    app.state::<StatusBarState>()
        .selected_connection_id
        .lock()
        .unwrap()
        .clone()
}

#[cfg(target_os = "macos")]
fn set_statusbar_selected_connection_id(app: &AppHandle, next_connection_id: Option<String>) {
    *app.state::<StatusBarState>()
        .selected_connection_id
        .lock()
        .unwrap() = next_connection_id;
}

#[cfg(target_os = "macos")]
fn set_statusbar_menu_actions(app: &AppHandle, actions: HashMap<String, StatusBarAction>) {
    *app.state::<StatusBarState>().menu_actions.lock().unwrap() = actions;
}

#[cfg(target_os = "macos")]
fn set_statusbar_synced_connections(
    app: &AppHandle,
    connections: Option<Vec<StoredStatusBarConnection>>,
) {
    *app.state::<StatusBarState>()
        .synced_connections
        .lock()
        .unwrap() = connections;
}

#[cfg(target_os = "macos")]
fn statusbar_pinned_keys_snapshot(
    app: &AppHandle,
) -> HashMap<String, Vec<StatusBarKeyEntry>> {
    app.state::<StatusBarState>()
        .pinned_keys
        .lock()
        .unwrap()
        .clone()
}

#[cfg(target_os = "macos")]
fn set_statusbar_pinned_keys(
    app: &AppHandle,
    pinned_keys: HashMap<String, Vec<StatusBarKeyEntry>>,
) {
    *app.state::<StatusBarState>().pinned_keys.lock().unwrap() = pinned_keys;
}

#[cfg(target_os = "macos")]
fn recent_statusbar_keys_for_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Vec<StatusBarKeyEntry> {
    app.state::<StatusBarState>()
        .recent_keys
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn load_statusbar_pinned_keys_from_store(
    app: &AppHandle,
) -> Result<HashMap<String, Vec<StatusBarKeyEntry>>, String> {
    let store = app
        .store(STATUSBAR_STORE_PATH)
        .map_err(|error| error.to_string())?;
    let Some(raw_pinned_keys) = store.get(STATUSBAR_PINNED_KEYS_STORE_KEY) else {
        return Ok(HashMap::new());
    };

    serde_json::from_value(raw_pinned_keys)
        .map_err(|error| format!("Failed to parse statusbar pinned keys: {error}"))
}

#[cfg(target_os = "macos")]
fn persist_statusbar_pinned_keys(
    app: &AppHandle,
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
) -> Result<(), String> {
    let store = app
        .store(STATUSBAR_STORE_PATH)
        .map_err(|error| error.to_string())?;
    let value =
        serde_json::to_value(pinned_keys).map_err(|error| format!("Failed to serialize pinned keys: {error}"))?;

    store.set(STATUSBAR_PINNED_KEYS_STORE_KEY, value);
    store.save().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn pinned_statusbar_keys_for_connection(
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
    connection_id: &str,
) -> Vec<StatusBarKeyEntry> {
    pinned_keys.get(connection_id).cloned().unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn is_statusbar_key_pinned(
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
    connection_id: &str,
    key: &str,
) -> bool {
    pinned_keys
        .get(connection_id)
        .map(|entries| entries.iter().any(|entry| entry.key == key))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn pin_statusbar_key(
    app: &AppHandle,
    connection_id: &str,
    key_entry: StatusBarKeyEntry,
) -> Result<(), String> {
    let mut pinned_keys = statusbar_pinned_keys_snapshot(app);
    let entries = pinned_keys.entry(connection_id.to_string()).or_default();

    entries.retain(|entry| entry.key != key_entry.key);
    entries.insert(0, key_entry);
    entries.truncate(STATUSBAR_PINNED_KEY_LIMIT);

    set_statusbar_pinned_keys(app, pinned_keys.clone());
    persist_statusbar_pinned_keys(app, &pinned_keys)
}

#[cfg(target_os = "macos")]
fn unpin_statusbar_key(app: &AppHandle, connection_id: &str, key: &str) -> Result<(), String> {
    let mut pinned_keys = statusbar_pinned_keys_snapshot(app);

    if let Some(entries) = pinned_keys.get_mut(connection_id) {
        entries.retain(|entry| entry.key != key);

        if entries.is_empty() {
            pinned_keys.remove(connection_id);
        }
    }

    set_statusbar_pinned_keys(app, pinned_keys.clone());
    persist_statusbar_pinned_keys(app, &pinned_keys)
}

#[cfg(target_os = "macos")]
fn sync_statusbar_pinned_key_metadata(
    app: &AppHandle,
    connection_id: &str,
    key_entry: &StatusBarKeyEntry,
) -> Result<(), String> {
    let mut pinned_keys = statusbar_pinned_keys_snapshot(app);
    let Some(entries) = pinned_keys.get_mut(connection_id) else {
        return Ok(());
    };
    let Some(existing_entry) = entries.iter_mut().find(|entry| entry.key == key_entry.key) else {
        return Ok(());
    };

    *existing_entry = key_entry.clone();
    set_statusbar_pinned_keys(app, pinned_keys.clone());
    persist_statusbar_pinned_keys(app, &pinned_keys)
}

#[cfg(target_os = "macos")]
fn record_statusbar_recent_key(
    app: &AppHandle,
    connection_id: &str,
    key_entry: StatusBarKeyEntry,
) {
    let statusbar_state = app.state::<StatusBarState>();
    let mut recent_keys = statusbar_state.recent_keys.lock().unwrap();
    let entries = recent_keys.entry(connection_id.to_string()).or_default();

    entries.retain(|entry| entry.key != key_entry.key);
    entries.insert(0, key_entry);
    entries.truncate(STATUSBAR_RECENT_KEY_LIMIT);
}

#[cfg(target_os = "macos")]
fn remove_statusbar_recent_key(app: &AppHandle, connection_id: &str, key: &str) {
    let statusbar_state = app.state::<StatusBarState>();
    let mut recent_keys = statusbar_state.recent_keys.lock().unwrap();

    if let Some(entries) = recent_keys.get_mut(connection_id) {
        entries.retain(|entry| entry.key != key);

        if entries.is_empty() {
            recent_keys.remove(connection_id);
        }
    }
}

#[cfg(target_os = "macos")]
fn statusbar_menu_item(
    app: &AppHandle,
    id: impl Into<String>,
    text: impl AsRef<str>,
    enabled: bool,
) -> Result<MenuItem<tauri::Wry>, String> {
    MenuItem::with_id(app, id.into(), text.as_ref(), enabled, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn load_statusbar_connections(app: &AppHandle) -> Result<Vec<StoredStatusBarConnection>, String> {
    if let Some(connections) = app
        .state::<StatusBarState>()
        .synced_connections
        .lock()
        .unwrap()
        .clone()
    {
        return Ok(connections);
    }

    let store = app.store("connections.json").map_err(|error| error.to_string())?;
    let Some(raw_connections) = store.get("connections") else {
        return Ok(Vec::new());
    };
    let Some(raw_connections) = raw_connections.as_array() else {
        return Ok(Vec::new());
    };

    let mut connections = Vec::with_capacity(raw_connections.len());

    for raw_connection in raw_connections {
        match serde_json::from_value::<StoredStatusBarConnection>(raw_connection.clone()) {
            Ok(connection) => connections.push(connection),
            Err(error) => {
                eprintln!("Failed to parse stored connection for status bar: {error}");
            }
        }
    }

    Ok(connections)
}

#[cfg(target_os = "macos")]
fn load_statusbar_settings(app: &AppHandle) -> Result<StoredStatusBarSettings, String> {
    let store = app.store("settings.json").map_err(|error| error.to_string())?;
    let Some(raw_settings) = store.get("app") else {
        return Ok(StoredStatusBarSettings::default());
    };

    serde_json::from_value(raw_settings)
        .map_err(|error| format!("Failed to parse settings.json for status bar: {error}"))
}

#[cfg(target_os = "macos")]
fn persist_statusbar_last_connection_id(
    app: &AppHandle,
    connection_id: Option<&str>,
) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|error| error.to_string())?;
    let raw_settings = store
        .get("app")
        .unwrap_or_else(|| JsonValue::Object(JsonMap::new()));
    let mut app_settings = match raw_settings {
        JsonValue::Object(map) => map,
        _ => JsonMap::new(),
    };
    let raw_ui_settings = app_settings
        .remove("ui")
        .unwrap_or_else(|| JsonValue::Object(JsonMap::new()));
    let mut ui_settings = match raw_ui_settings {
        JsonValue::Object(map) => map,
        _ => JsonMap::new(),
    };

    ui_settings.insert(
        "lastConnectionId".to_string(),
        JsonValue::String(connection_id.unwrap_or_default().to_string()),
    );
    app_settings.insert("ui".to_string(), JsonValue::Object(ui_settings));
    store.set("app", JsonValue::Object(app_settings));
    store.save().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn resolve_statusbar_selected_connection(
    app: &AppHandle,
    connections: &[StoredStatusBarConnection],
    settings: &StoredStatusBarSettings,
) -> Option<String> {
    current_statusbar_selected_connection_id(app)
        .filter(|connection_id| connections.iter().any(|connection| connection.id == *connection_id))
        .or_else(|| {
            settings.last_connection_id().and_then(|connection_id| {
                connections
                    .iter()
                    .find(|connection| connection.id == connection_id)
                    .map(|connection| connection.id.clone())
            })
        })
        .or_else(|| connections.first().map(|connection| connection.id.clone()))
}

#[cfg(target_os = "macos")]
async fn delete_statusbar_key(
    connection: &RedisConnectionTestInput,
    key: &str,
) -> Result<(), String> {
    let mut redis_connection = open_connection(connection).await?;

    redis::cmd("DEL")
        .arg(key)
        .query_async::<i64>(&mut redis_connection)
        .await
        .map_err(|error| format!("Failed to delete key: {error}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn build_statusbar_connections_submenu(
    app: &AppHandle,
    context: &mut StatusBarMenuContext,
    connections: &[StoredStatusBarConnection],
    selected_connection_id: Option<&str>,
) -> Result<Submenu<tauri::Wry>, String> {
    let title = if connections.is_empty() {
        "Connections".to_string()
    } else {
        format!("Connections ({})", connections.len())
    };
    let mut builder = SubmenuBuilder::with_id(app, TRAY_CONNECTIONS_SUBMENU_ID, title);

    if connections.is_empty() {
        let empty_item = statusbar_menu_item(
            app,
            context.next_info_id("connections_empty"),
            "No saved connections",
            false,
        )?;
        builder = builder.item(&empty_item);
    } else {
        for connection in connections {
            let item_id = context.register_action(
                "connection",
                StatusBarAction::SelectConnection {
                    connection_id: connection.id.clone(),
                },
            );
            let item = CheckMenuItemBuilder::with_id(item_id, connection.menu_label())
                .checked(selected_connection_id == Some(connection.id.as_str()))
                .build(app)
                .map_err(|error| error.to_string())?;
            builder = builder.item(&item);
        }
    }

    builder.build().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn build_statusbar_current_submenu(
    app: &AppHandle,
    context: &mut StatusBarMenuContext,
    selected_connection: Option<&StoredStatusBarConnection>,
    pinned_key_count: usize,
    recent_key_count: usize,
) -> Result<Submenu<tauri::Wry>, String> {
    let mut builder = SubmenuBuilder::with_id(app, TRAY_CURRENT_SUBMENU_ID, "Current");

    let Some(connection) = selected_connection else {
        let empty_item = statusbar_menu_item(
            app,
            context.next_info_id("current_empty"),
            "No active connection",
            false,
        )?;
        let create_item =
            statusbar_menu_item(app, TRAY_NEW_CONNECTION_ID, "New Connection", true)?;
        builder = builder.item(&empty_item).separator().item(&create_item);
        return builder.build().map_err(|error| error.to_string());
    };

    let name_item = statusbar_menu_item(
        app,
        context.next_info_id("current_name"),
        truncate_statusbar_text(&connection.name, STATUSBAR_TEXT_LIMIT),
        false,
    )?;
    let endpoint_item = statusbar_menu_item(
        app,
        context.next_info_id("current_endpoint"),
        truncate_statusbar_text(&connection.endpoint_label(), STATUSBAR_TEXT_LIMIT),
        false,
    )?;
    let pinned_item = statusbar_menu_item(
        app,
        context.next_info_id("current_pinned"),
        format!("Pinned keys: {pinned_key_count}"),
        false,
    )?;
    let recent_item = statusbar_menu_item(
        app,
        context.next_info_id("current_recent"),
        format!("Recent keys: {recent_key_count}"),
        false,
    )?;
    let browse_item = statusbar_menu_item(app, TRAY_BROWSE_KEYS_ID, "Browse Keys", true)?;
    let refresh_item =
        statusbar_menu_item(app, TRAY_REFRESH_KEYS_ID, "Refresh Current", true)?;
    let disconnect_item =
        statusbar_menu_item(app, TRAY_DISCONNECT_ID, "Disconnect", true)?;

    builder = builder
        .item(&name_item)
        .item(&endpoint_item)
        .item(&pinned_item)
        .item(&recent_item)
        .separator()
        .item(&browse_item)
        .item(&refresh_item)
        .item(&disconnect_item);

    builder.build().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn build_statusbar_key_submenu(
    app: &AppHandle,
    context: &mut StatusBarMenuContext,
    connection: &StoredStatusBarConnection,
    key_entry: &StatusBarKeyEntry,
    is_pinned: bool,
) -> Result<Submenu<tauri::Wry>, String> {
    let mut builder = SubmenuBuilder::with_id(
        app,
        context.next_info_id("key_submenu"),
        truncate_statusbar_text(&key_entry.key, STATUSBAR_TEXT_LIMIT),
    );
    let type_item = statusbar_menu_item(
        app,
        context.next_info_id("key_type"),
        format!("Type: {}", key_entry.key_type),
        false,
    )?;
    let ttl_item = statusbar_menu_item(
        app,
        context.next_info_id("key_ttl"),
        format!("TTL: {}", format_statusbar_ttl(key_entry.ttl)),
        false,
    )?;
    let value_item = statusbar_menu_item(
        app,
        context.next_info_id("key_value"),
        format!(
            "Value: {}",
            truncate_statusbar_text(&key_entry.preview, STATUSBAR_VALUE_PREVIEW_LIMIT)
        ),
        false,
    )?;
    let open_item = statusbar_menu_item(
        app,
        context.register_action(
            "open_key",
            StatusBarAction::OpenKey {
                connection_id: connection.id.clone(),
                key: key_entry.key.clone(),
            },
        ),
        "Open in NeoRDM",
        true,
    )?;
    let delete_item = statusbar_menu_item(
        app,
        context.register_action(
            "delete_key",
            StatusBarAction::DeleteKey {
                connection_id: connection.id.clone(),
                key: key_entry.key.clone(),
            },
        ),
        "Delete Key",
        true,
    )?;
    let pin_item = statusbar_menu_item(
        app,
        if is_pinned {
            context.register_action(
                "unpin_key",
                StatusBarAction::UnpinKey {
                    connection_id: connection.id.clone(),
                    key: key_entry.key.clone(),
                },
            )
        } else {
            context.register_action(
                "pin_key",
                StatusBarAction::PinKey {
                    connection_id: connection.id.clone(),
                    key_entry: key_entry.clone(),
                },
            )
        },
        if is_pinned { "Unpin Key" } else { "Pin Key" },
        true,
    )?;

    builder = builder.item(&type_item).item(&ttl_item);

    if let Some(node_address) = &key_entry.node_address {
        let node_item = statusbar_menu_item(
            app,
            context.next_info_id("key_node"),
            format!("Node: {}", truncate_statusbar_text(node_address, STATUSBAR_TEXT_LIMIT)),
            false,
        )?;
        builder = builder.item(&node_item);
    }

    if let Some(slot) = key_entry.slot {
        let slot_item = statusbar_menu_item(
            app,
            context.next_info_id("key_slot"),
            format!("Slot: {slot}"),
            false,
        )?;
        builder = builder.item(&slot_item);
    }

    builder = builder
        .item(&value_item)
        .separator()
        .item(&open_item)
        .item(&pin_item)
        .item(&delete_item);

    builder.build().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn build_statusbar_recent_keys_submenu(
    app: &AppHandle,
    context: &mut StatusBarMenuContext,
    selected_connection: Option<&StoredStatusBarConnection>,
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
) -> Result<Submenu<tauri::Wry>, String> {
    let mut builder = SubmenuBuilder::with_id(app, TRAY_RECENT_KEYS_SUBMENU_ID, "Recent Keys");

    let Some(connection) = selected_connection else {
        let empty_item = statusbar_menu_item(
            app,
            context.next_info_id("recent_keys_empty"),
            "Select a connection first",
            false,
        )?;
        builder = builder.item(&empty_item);
        return builder.build().map_err(|error| error.to_string());
    };

    let recent_keys = recent_statusbar_keys_for_connection(app, &connection.id);

    if recent_keys.is_empty() {
        let empty_item = statusbar_menu_item(
            app,
            context.next_info_id("recent_keys_none"),
            "Open keys in NeoRDM to list them here",
            false,
        )?;
        let browse_item =
            statusbar_menu_item(app, TRAY_BROWSE_KEYS_ID, "Browse Keys in NeoRDM", true)?;
        builder = builder.item(&empty_item).separator().item(&browse_item);
    } else {
        for key_entry in &recent_keys {
            let key_submenu = build_statusbar_key_submenu(
                app,
                context,
                connection,
                key_entry,
                is_statusbar_key_pinned(pinned_keys, &connection.id, &key_entry.key),
            )?;
            builder = builder.item(&key_submenu);
        }
    }

    builder.build().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn build_statusbar_pinned_keys_submenu(
    app: &AppHandle,
    context: &mut StatusBarMenuContext,
    selected_connection: Option<&StoredStatusBarConnection>,
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
) -> Result<Submenu<tauri::Wry>, String> {
    let mut builder = SubmenuBuilder::with_id(app, TRAY_PINNED_KEYS_SUBMENU_ID, "Pinned Keys");

    let Some(connection) = selected_connection else {
        let empty_item = statusbar_menu_item(
            app,
            context.next_info_id("pinned_keys_empty"),
            "Select a connection first",
            false,
        )?;
        builder = builder.item(&empty_item);
        return builder.build().map_err(|error| error.to_string());
    };

    let pinned_keys = pinned_statusbar_keys_for_connection(pinned_keys, &connection.id);

    if pinned_keys.is_empty() {
        let empty_item = statusbar_menu_item(
            app,
            context.next_info_id("pinned_keys_none"),
            "Pin keys from Recent Keys",
            false,
        )?;
        builder = builder.item(&empty_item);
    } else {
        for key_entry in &pinned_keys {
            let key_submenu =
                build_statusbar_key_submenu(app, context, connection, key_entry, true)?;
            builder = builder.item(&key_submenu);
        }
    }

    builder.build().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn build_statusbar_quick_actions_submenu(
    app: &AppHandle,
) -> Result<Submenu<tauri::Wry>, String> {
    let hide_item = statusbar_menu_item(app, TRAY_HIDE_WINDOW_ID, "Hide Window", true)?;
    let new_connection_item =
        statusbar_menu_item(app, TRAY_NEW_CONNECTION_ID, "New Connection", true)?;
    let cli_item = statusbar_menu_item(app, TRAY_OPEN_CLI_ID, "Open Redis CLI", true)?;
    let pubsub_item =
        statusbar_menu_item(app, TRAY_OPEN_PUBSUB_ID, "Open Pub/Sub", true)?;

    SubmenuBuilder::with_id(app, TRAY_QUICK_ACTIONS_SUBMENU_ID, "Quick Actions")
        .item(&new_connection_item)
        .item(&cli_item)
        .item(&pubsub_item)
        .separator()
        .item(&hide_item)
        .build()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
async fn build_statusbar_menu(
    app: &AppHandle,
) -> Result<
    (
        Menu<tauri::Wry>,
        HashMap<String, StatusBarAction>,
        Option<String>,
    ),
    String,
> {
    let connections = load_statusbar_connections(app)?;
    let pinned_keys = statusbar_pinned_keys_snapshot(app);
    let settings = load_statusbar_settings(app).unwrap_or_default();
    let selected_connection_id = resolve_statusbar_selected_connection(app, &connections, &settings);
    let selected_connection = selected_connection_id.as_ref().and_then(|connection_id| {
        connections
            .iter()
            .find(|connection| connection.id == *connection_id)
    });
    let pinned_key_count = selected_connection
        .map(|connection| pinned_statusbar_keys_for_connection(&pinned_keys, &connection.id).len())
        .unwrap_or_default();
    let recent_key_count = selected_connection
        .map(|connection| recent_statusbar_keys_for_connection(app, &connection.id).len())
        .unwrap_or_default();
    let mut context = StatusBarMenuContext::new();
    let current_submenu = build_statusbar_current_submenu(
        app,
        &mut context,
        selected_connection,
        pinned_key_count,
        recent_key_count,
    )?;
    let connections_submenu = build_statusbar_connections_submenu(
        app,
        &mut context,
        &connections,
        selected_connection_id.as_deref(),
    )?;
    let pinned_keys_submenu =
        build_statusbar_pinned_keys_submenu(app, &mut context, selected_connection, &pinned_keys)?;
    let recent_keys_submenu =
        build_statusbar_recent_keys_submenu(app, &mut context, selected_connection, &pinned_keys)?;
    let quick_actions_submenu = build_statusbar_quick_actions_submenu(app)?;

    let menu = MenuBuilder::new(app)
        .text(TRAY_OPEN_WINDOW_ID, "Open NeoRDM")
        .separator()
        .item(&current_submenu)
        .item(&connections_submenu)
        .item(&pinned_keys_submenu)
        .item(&recent_keys_submenu)
        .item(&quick_actions_submenu)
        .separator()
        .text(TRAY_QUIT_ID, "Quit")
        .build()
        .map_err(|error| error.to_string())?;

    Ok((menu, context.actions, selected_connection_id))
}

#[cfg(target_os = "macos")]
fn build_loading_statusbar_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let loading_current =
        MenuItem::with_id(app, "statusbar_loading_current", "Loading current context…", false, None::<&str>)?;
    let loading_connections =
        MenuItem::with_id(app, "statusbar_loading_connections", "Loading connections…", false, None::<&str>)?;
    let loading_pinned =
        MenuItem::with_id(app, "statusbar_loading_pinned", "Loading pinned keys…", false, None::<&str>)?;
    let loading_recent =
        MenuItem::with_id(app, "statusbar_loading_recent", "Loading recent keys…", false, None::<&str>)?;
    let current_submenu = SubmenuBuilder::with_id(app, TRAY_CURRENT_SUBMENU_ID, "Current")
        .item(&loading_current)
        .build()?;
    let connections_submenu = SubmenuBuilder::with_id(app, TRAY_CONNECTIONS_SUBMENU_ID, "Connections")
        .item(&loading_connections)
        .build()?;
    let pinned_keys_submenu = SubmenuBuilder::with_id(app, TRAY_PINNED_KEYS_SUBMENU_ID, "Pinned Keys")
        .item(&loading_pinned)
        .build()?;
    let recent_keys_submenu = SubmenuBuilder::with_id(app, TRAY_RECENT_KEYS_SUBMENU_ID, "Recent Keys")
        .item(&loading_recent)
        .build()?;
    let quick_actions_submenu = SubmenuBuilder::with_id(app, TRAY_QUICK_ACTIONS_SUBMENU_ID, "Quick Actions")
        .text(TRAY_NEW_CONNECTION_ID, "New Connection")
        .build()?;

    MenuBuilder::new(app)
        .text(TRAY_OPEN_WINDOW_ID, "Open NeoRDM")
        .separator()
        .item(&current_submenu)
        .item(&connections_submenu)
        .item(&pinned_keys_submenu)
        .item(&recent_keys_submenu)
        .item(&quick_actions_submenu)
        .separator()
        .text(TRAY_QUIT_ID, "Quit")
        .build()
}

#[cfg(target_os = "macos")]
async fn refresh_statusbar_menu(app: &AppHandle) -> Result<(), String> {
    let (menu, actions, selected_connection_id) = build_statusbar_menu(app).await?;

    set_statusbar_selected_connection_id(app, selected_connection_id);
    set_statusbar_menu_actions(app, actions);

    let Some(tray) = app.tray_by_id(STATUSBAR_TRAY_ID) else {
        return Ok(());
    };

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn refresh_statusbar_menu_in_background(app: &AppHandle) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = refresh_statusbar_menu(&app_handle).await {
            eprintln!("Failed to refresh status bar menu: {error}");
        }
    });
}

#[cfg(target_os = "macos")]
fn handle_statusbar_context_payload(app: &AppHandle, payload: TrayStatusbarContextPayload) {
    match payload {
        TrayStatusbarContextPayload::SyncConnection { connection_id } => {
            if connection_id.trim().is_empty() {
                return;
            }

            set_statusbar_selected_connection_id(app, Some(connection_id.clone()));
            let _ = persist_statusbar_last_connection_id(app, Some(&connection_id));
            refresh_statusbar_menu_in_background(app);
        }
        TrayStatusbarContextPayload::SyncConnections {
            active_connection_id,
            connections,
        } => {
            set_statusbar_synced_connections(app, Some(connections));

            if let Some(connection_id) = active_connection_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                set_statusbar_selected_connection_id(app, Some(connection_id.clone()));
                let _ = persist_statusbar_last_connection_id(app, Some(&connection_id));
            }

            refresh_statusbar_menu_in_background(app);
        }
        TrayStatusbarContextPayload::SyncKey {
            connection_id,
            key,
            key_type,
            ttl,
            slot,
            node_address,
            preview,
        } => {
            if connection_id.trim().is_empty() || key.trim().is_empty() {
                return;
            }

            let key_entry = StatusBarKeyEntry {
                key,
                key_type,
                ttl,
                slot,
                node_address,
                preview: truncate_statusbar_text(
                    &collapse_statusbar_whitespace(&preview),
                    STATUSBAR_VALUE_PREVIEW_LIMIT,
                ),
            };

            set_statusbar_selected_connection_id(app, Some(connection_id.clone()));
            record_statusbar_recent_key(app, &connection_id, key_entry.clone());
            let _ = sync_statusbar_pinned_key_metadata(app, &connection_id, &key_entry);
            refresh_statusbar_menu_in_background(app);
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_statusbar_static_action_for_selected_connection(
    app: &AppHandle,
    panel: Option<&'static str>,
    action_kind: &'static str,
) -> bool {
    let Some(connection_id) = current_statusbar_selected_connection_id(app) else {
        return false;
    };

    emit_tray_statusbar_event(
        app,
        TrayStatusbarEventPayload {
            kind: action_kind,
            connection_id: Some(connection_id),
            key: None,
            panel,
        },
    );

    true
}

#[cfg(target_os = "macos")]
fn handle_statusbar_menu_event(app: &AppHandle, event_id: &str) {
    match event_id {
        TRAY_OPEN_WINDOW_ID => show_main_window(app),
        TRAY_HIDE_WINDOW_ID => hide_main_window(app),
        TRAY_NEW_CONNECTION_ID => {
            show_main_window(app);
            emit_tray_quick_action(app, "new-connection");
        }
        TRAY_BROWSE_KEYS_ID => {
            show_main_window(app);
            if !handle_statusbar_static_action_for_selected_connection(
                app,
                Some("editor"),
                "open-panel",
            ) {
                emit_tray_quick_action(app, "browse-keys");
            }
        }
        TRAY_REFRESH_KEYS_ID => {
            let handled = handle_statusbar_static_action_for_selected_connection(
                app,
                None,
                "refresh-connection",
            );

            if handled {
                refresh_statusbar_menu_in_background(app);
            } else {
                show_main_window(app);
                emit_tray_quick_action(app, "refresh-keys");
            }
        }
        TRAY_OPEN_CLI_ID => {
            show_main_window(app);
            if !handle_statusbar_static_action_for_selected_connection(
                app,
                Some("cli"),
                "open-panel",
            ) {
                emit_tray_quick_action(app, "open-cli");
            }
        }
        TRAY_OPEN_PUBSUB_ID => {
            show_main_window(app);
            if !handle_statusbar_static_action_for_selected_connection(
                app,
                Some("pubsub"),
                "open-panel",
            ) {
                emit_tray_quick_action(app, "open-pubsub");
            }
        }
        TRAY_DISCONNECT_ID => {
            show_main_window(app);
            if !handle_statusbar_static_action_for_selected_connection(
                app,
                None,
                "disconnect-connection",
            ) {
                emit_tray_quick_action(app, "disconnect");
            }
        }
        TRAY_QUIT_ID => app.exit(0),
        _ => {
            let action = app
                .state::<StatusBarState>()
                .menu_actions
                .lock()
                .unwrap()
                .get(event_id)
                .cloned();

            match action {
                Some(StatusBarAction::SelectConnection { connection_id }) => {
                    set_statusbar_selected_connection_id(app, Some(connection_id.clone()));
                    let _ = persist_statusbar_last_connection_id(app, Some(&connection_id));
                    emit_tray_statusbar_event(
                        app,
                        TrayStatusbarEventPayload {
                            kind: "select-connection",
                            connection_id: Some(connection_id),
                            key: None,
                            panel: None,
                        },
                    );
                    refresh_statusbar_menu_in_background(app);
                }
                Some(StatusBarAction::OpenKey { connection_id, key }) => {
                    show_main_window(app);
                    emit_tray_statusbar_event(
                        app,
                        TrayStatusbarEventPayload {
                            kind: "open-key",
                            connection_id: Some(connection_id),
                            key: Some(key),
                            panel: None,
                        },
                    );
                }
                Some(StatusBarAction::DeleteKey { connection_id, key }) => {
                    let app_handle = app.clone();

                    tauri::async_runtime::spawn(async move {
                        let connection = load_statusbar_connections(&app_handle)
                            .ok()
                            .and_then(|connections| {
                                connections
                                    .into_iter()
                                    .find(|connection| connection.id == connection_id)
                            });

                        if let Some(connection) = connection {
                            if let Err(error) =
                                delete_statusbar_key(&connection.to_connection_input(), &key).await
                            {
                                eprintln!("Failed to delete tray key: {error}");
                            } else {
                                remove_statusbar_recent_key(&app_handle, &connection_id, &key);
                                let _ = unpin_statusbar_key(&app_handle, &connection_id, &key);
                                emit_tray_statusbar_event(
                                    &app_handle,
                                    TrayStatusbarEventPayload {
                                        kind: "refresh-connection",
                                        connection_id: Some(connection_id),
                                        key: None,
                                        panel: None,
                                    },
                                );
                            }
                        }

                        if let Err(error) = refresh_statusbar_menu(&app_handle).await {
                            eprintln!("Failed to refresh status bar menu after delete: {error}");
                        }
                    });
                }
                Some(StatusBarAction::PinKey {
                    connection_id,
                    key_entry,
                }) => {
                    if let Err(error) = pin_statusbar_key(app, &connection_id, key_entry) {
                        eprintln!("Failed to pin tray key: {error}");
                    }
                    refresh_statusbar_menu_in_background(app);
                }
                Some(StatusBarAction::UnpinKey { connection_id, key }) => {
                    if let Err(error) = unpin_statusbar_key(app, &connection_id, &key) {
                        eprintln!("Failed to unpin tray key: {error}");
                    }
                    refresh_statusbar_menu_in_background(app);
                }
                None => {}
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn setup_macos_statusbar(app: &mut tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let listener_app_handle = app_handle.clone();
    let tray_menu = build_loading_statusbar_menu(&app_handle)?;
    let initial_pinned_keys = load_statusbar_pinned_keys_from_store(&app_handle).unwrap_or_default();

    set_statusbar_pinned_keys(&app_handle, initial_pinned_keys);

    app_handle.listen_any(TRAY_STATUSBAR_CONTEXT_EVENT, move |event| {
        match serde_json::from_str::<TrayStatusbarContextPayload>(event.payload()) {
            Ok(payload) => handle_statusbar_context_payload(&listener_app_handle, payload),
            Err(error) => eprintln!("Failed to parse tray context payload: {error}"),
        }
    });

    let mut tray_builder = TrayIconBuilder::with_id(STATUSBAR_TRAY_ID)
        .menu(&tray_menu)
        .tooltip("NeoRDM")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_statusbar_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left | MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                refresh_statusbar_menu_in_background(tray.app_handle());
            }
        });

    if let Some(icon) = statusbar_icon().or_else(|| app.default_window_icon().cloned()) {
        tray_builder = tray_builder.icon(icon).icon_as_template(true);
    }

    let _ = tray_builder.build(app)?;
    refresh_statusbar_menu_in_background(&app_handle);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(RedisPubSubState::default());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(StatusBarState::default());
    #[cfg(not(target_os = "macos"))]
    let builder = builder;

    let app = builder
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    hide_main_window(&window.app_handle());
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            #[cfg(target_os = "macos")]
            setup_macos_statusbar(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            test_redis_connection,
            proxy_http_request,
            list_redis_keys,
            get_redis_cluster_topology,
            get_redis_key_value,
            run_redis_command,
            start_redis_pubsub_session,
            stop_redis_pubsub_session,
            subscribe_redis_pubsub_channels,
            subscribe_redis_pubsub_patterns,
            unsubscribe_redis_pubsub_channels,
            unsubscribe_redis_pubsub_patterns,
            publish_redis_pubsub_message,
            append_redis_stream_entry,
            get_redis_stream_entries,
            get_redis_stream_groups,
            get_redis_stream_consumers,
            get_redis_stream_pending_entries,
            create_redis_stream_consumer_group,
            destroy_redis_stream_consumer_group,
            delete_redis_stream_consumer,
            delete_redis_stream_entries,
            ack_redis_stream_entries,
            claim_redis_stream_entries,
            create_redis_key,
            rename_redis_key,
            rename_redis_keys,
            update_redis_string_value,
            update_redis_json_value,
            append_redis_list_value,
            update_redis_list_value,
            delete_redis_list_value,
            add_redis_set_member,
            add_redis_hash_entry,
            update_redis_hash_entry,
            delete_redis_hash_entry,
            add_redis_zset_entry,
            update_redis_zset_entry,
            delete_redis_zset_entry
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main_window(app);
        }
    });
}
