use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

#[path = "statusbar/actions.rs"]
mod actions;
#[path = "statusbar/menu.rs"]
mod menu;

use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use tauri::{
    image::Image,
    menu::MenuItem,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, Listener, Manager,
};
use tauri_plugin_store::StoreExt;

use self::actions::{
    handle_statusbar_context_payload, handle_statusbar_menu_event,
    refresh_statusbar_menu_in_background,
};
use self::menu::build_loading_statusbar_menu;
use crate::models::{
    RedisClusterInput, RedisConnectionTestInput, RedisSentinelInput, RedisSshTunnelInput,
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
const STATUSBAR_TRAY_ID: &str = "statusbar";
const TRAY_OPEN_WINDOW_ID: &str = "tray_open_window";
const TRAY_HIDE_WINDOW_ID: &str = "tray_hide_window";
const TRAY_NEW_CONNECTION_ID: &str = "tray_new_connection";
const TRAY_BROWSE_KEYS_ID: &str = "tray_browse_keys";
const TRAY_REFRESH_KEYS_ID: &str = "tray_refresh_keys";
const TRAY_OPEN_CLI_ID: &str = "tray_open_cli";
const TRAY_OPEN_PUBSUB_ID: &str = "tray_open_pubsub";
const TRAY_DISCONNECT_ID: &str = "tray_disconnect";
const TRAY_QUIT_ID: &str = "tray_quit";
const TRAY_CURRENT_SUBMENU_ID: &str = "tray_current_submenu";
const TRAY_CONNECTIONS_SUBMENU_ID: &str = "tray_connections_submenu";
const TRAY_PINNED_KEYS_SUBMENU_ID: &str = "tray_pinned_keys_submenu";
const TRAY_RECENT_KEYS_SUBMENU_ID: &str = "tray_recent_keys_submenu";
const TRAY_QUICK_ACTIONS_SUBMENU_ID: &str = "tray_quick_actions_submenu";
const TRAY_QUICK_ACTION_EVENT: &str = "neordm://tray/quick-action";
const TRAY_STATUSBAR_EVENT: &str = "neordm://tray/action";
const TRAY_STATUSBAR_CONTEXT_EVENT: &str = "neordm://tray/context";
const STATUSBAR_STORE_PATH: &str = "statusbar.json";
const STATUSBAR_PINNED_KEYS_STORE_KEY: &str = "pinnedKeys";
const STATUSBAR_ICON_BYTES: &[u8] = include_bytes!("../icons/statusbar_icon.png");
const STATUSBAR_TEXT_LIMIT: usize = 64;
const STATUSBAR_VALUE_PREVIEW_LIMIT: usize = 88;
const STATUSBAR_PINNED_KEY_LIMIT: usize = 8;
const STATUSBAR_RECENT_KEY_LIMIT: usize = 6;

#[derive(Clone, Debug)]
enum StatusBarAction {
    SelectConnection {
        connection_id: String,
    },
    OpenKey {
        connection_id: String,
        key: String,
    },
    DeleteKey {
        connection_id: String,
        key: String,
    },
    PinKey {
        connection_id: String,
        key_entry: StatusBarKeyEntry,
    },
    UnpinKey {
        connection_id: String,
        key: String,
    },
}

#[derive(Default)]
pub(crate) struct StatusBarState {
    selected_connection_id: Mutex<Option<String>>,
    menu_actions: Mutex<HashMap<String, StatusBarAction>>,
    recent_keys: Mutex<HashMap<String, Vec<StatusBarKeyEntry>>>,
    pinned_keys: Mutex<HashMap<String, Vec<StatusBarKeyEntry>>>,
    synced_connections: Mutex<Option<Vec<StoredStatusBarConnection>>>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatusBarSettings {
    #[serde(default)]
    ui: StoredStatusBarUiSettings,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatusBarUiSettings {
    #[serde(default)]
    last_connection_id: String,
}

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

struct StatusBarMenuContext {
    next_id: usize,
    actions: HashMap<String, StatusBarAction>,
}

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

fn statusbar_icon() -> Option<Image<'static>> {
    static STATUSBAR_ICON: OnceLock<Option<Image<'static>>> = OnceLock::new();

    STATUSBAR_ICON
        .get_or_init(|| Image::from_bytes(STATUSBAR_ICON_BYTES).ok())
        .clone()
}

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

fn collapse_statusbar_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

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

pub(crate) fn show_main_window(app: &AppHandle) {
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    let _ = app.set_dock_visibility(true);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }

    let _ = app.set_dock_visibility(false);
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

fn emit_tray_quick_action(app: &AppHandle, action: &str) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_QUICK_ACTION_EVENT, action);
}

fn emit_tray_statusbar_event(app: &AppHandle, payload: TrayStatusbarEventPayload) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_STATUSBAR_EVENT, payload);
}

fn current_statusbar_selected_connection_id(app: &AppHandle) -> Option<String> {
    app.state::<StatusBarState>()
        .selected_connection_id
        .lock()
        .unwrap()
        .clone()
}

fn set_statusbar_selected_connection_id(app: &AppHandle, next_connection_id: Option<String>) {
    *app.state::<StatusBarState>()
        .selected_connection_id
        .lock()
        .unwrap() = next_connection_id;
}

fn set_statusbar_menu_actions(app: &AppHandle, actions: HashMap<String, StatusBarAction>) {
    *app.state::<StatusBarState>().menu_actions.lock().unwrap() = actions;
}

fn set_statusbar_synced_connections(
    app: &AppHandle,
    connections: Option<Vec<StoredStatusBarConnection>>,
) {
    *app.state::<StatusBarState>()
        .synced_connections
        .lock()
        .unwrap() = connections;
}

fn statusbar_pinned_keys_snapshot(app: &AppHandle) -> HashMap<String, Vec<StatusBarKeyEntry>> {
    app.state::<StatusBarState>()
        .pinned_keys
        .lock()
        .unwrap()
        .clone()
}

fn set_statusbar_pinned_keys(
    app: &AppHandle,
    pinned_keys: HashMap<String, Vec<StatusBarKeyEntry>>,
) {
    *app.state::<StatusBarState>().pinned_keys.lock().unwrap() = pinned_keys;
}

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

fn persist_statusbar_pinned_keys(
    app: &AppHandle,
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
) -> Result<(), String> {
    let store = app
        .store(STATUSBAR_STORE_PATH)
        .map_err(|error| error.to_string())?;
    let value = serde_json::to_value(pinned_keys)
        .map_err(|error| format!("Failed to serialize pinned keys: {error}"))?;

    store.set(STATUSBAR_PINNED_KEYS_STORE_KEY, value);
    store.save().map_err(|error| error.to_string())
}

fn pinned_statusbar_keys_for_connection(
    pinned_keys: &HashMap<String, Vec<StatusBarKeyEntry>>,
    connection_id: &str,
) -> Vec<StatusBarKeyEntry> {
    pinned_keys.get(connection_id).cloned().unwrap_or_default()
}

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

fn record_statusbar_recent_key(app: &AppHandle, connection_id: &str, key_entry: StatusBarKeyEntry) {
    let statusbar_state = app.state::<StatusBarState>();
    let mut recent_keys = statusbar_state.recent_keys.lock().unwrap();
    let entries = recent_keys.entry(connection_id.to_string()).or_default();

    entries.retain(|entry| entry.key != key_entry.key);
    entries.insert(0, key_entry);
    entries.truncate(STATUSBAR_RECENT_KEY_LIMIT);
}

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

fn statusbar_menu_item(
    app: &AppHandle,
    id: impl Into<String>,
    text: impl AsRef<str>,
    enabled: bool,
) -> Result<MenuItem<tauri::Wry>, String> {
    MenuItem::with_id(app, id.into(), text.as_ref(), enabled, None::<&str>)
        .map_err(|error| error.to_string())
}

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

    let store = app
        .store("connections.json")
        .map_err(|error| error.to_string())?;
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

fn load_statusbar_settings(app: &AppHandle) -> Result<StoredStatusBarSettings, String> {
    let store = app
        .store("settings.json")
        .map_err(|error| error.to_string())?;
    let Some(raw_settings) = store.get("app") else {
        return Ok(StoredStatusBarSettings::default());
    };

    serde_json::from_value(raw_settings)
        .map_err(|error| format!("Failed to parse settings.json for status bar: {error}"))
}

fn persist_statusbar_last_connection_id(
    app: &AppHandle,
    connection_id: Option<&str>,
) -> Result<(), String> {
    let store = app
        .store("settings.json")
        .map_err(|error| error.to_string())?;
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

fn resolve_statusbar_selected_connection(
    app: &AppHandle,
    connections: &[StoredStatusBarConnection],
    settings: &StoredStatusBarSettings,
) -> Option<String> {
    current_statusbar_selected_connection_id(app)
        .filter(|connection_id| {
            connections
                .iter()
                .any(|connection| connection.id == *connection_id)
        })
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

pub(crate) fn setup_macos_statusbar(app: &mut tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let listener_app_handle = app_handle.clone();
    let tray_menu = build_loading_statusbar_menu(&app_handle)?;
    let initial_pinned_keys =
        load_statusbar_pinned_keys_from_store(&app_handle).unwrap_or_default();

    set_statusbar_pinned_keys(&app_handle, initial_pinned_keys);

    app_handle.listen_any(
        TRAY_STATUSBAR_CONTEXT_EVENT,
        move |event| match serde_json::from_str::<TrayStatusbarContextPayload>(event.payload()) {
            Ok(payload) => handle_statusbar_context_payload(&listener_app_handle, payload),
            Err(error) => eprintln!("Failed to parse tray context payload: {error}"),
        },
    );

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
