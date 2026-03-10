use std::collections::HashMap;

use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder},
    AppHandle,
};

use super::{
    format_statusbar_ttl, is_statusbar_key_pinned, load_statusbar_connections,
    load_statusbar_settings, pinned_statusbar_keys_for_connection,
    recent_statusbar_keys_for_connection, resolve_statusbar_selected_connection,
    statusbar_menu_item, statusbar_pinned_keys_snapshot, truncate_statusbar_text, StatusBarAction,
    StatusBarKeyEntry, StatusBarMenuContext, StoredStatusBarConnection, STATUSBAR_TEXT_LIMIT,
    STATUSBAR_VALUE_PREVIEW_LIMIT, TRAY_BROWSE_KEYS_ID, TRAY_CONNECTIONS_SUBMENU_ID,
    TRAY_CURRENT_SUBMENU_ID, TRAY_DISCONNECT_ID, TRAY_HIDE_WINDOW_ID, TRAY_NEW_CONNECTION_ID,
    TRAY_OPEN_CLI_ID, TRAY_OPEN_PUBSUB_ID, TRAY_OPEN_WINDOW_ID, TRAY_PINNED_KEYS_SUBMENU_ID,
    TRAY_QUICK_ACTIONS_SUBMENU_ID, TRAY_QUIT_ID, TRAY_RECENT_KEYS_SUBMENU_ID, TRAY_REFRESH_KEYS_ID,
};

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
        let create_item = statusbar_menu_item(app, TRAY_NEW_CONNECTION_ID, "New Connection", true)?;
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
    let refresh_item = statusbar_menu_item(app, TRAY_REFRESH_KEYS_ID, "Refresh Current", true)?;
    let disconnect_item = statusbar_menu_item(app, TRAY_DISCONNECT_ID, "Disconnect", true)?;

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
            format!(
                "Node: {}",
                truncate_statusbar_text(node_address, STATUSBAR_TEXT_LIMIT)
            ),
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

fn build_statusbar_quick_actions_submenu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, String> {
    let hide_item = statusbar_menu_item(app, TRAY_HIDE_WINDOW_ID, "Hide Window", true)?;
    let new_connection_item =
        statusbar_menu_item(app, TRAY_NEW_CONNECTION_ID, "New Connection", true)?;
    let cli_item = statusbar_menu_item(app, TRAY_OPEN_CLI_ID, "Open Redis CLI", true)?;
    let pubsub_item = statusbar_menu_item(app, TRAY_OPEN_PUBSUB_ID, "Open Pub/Sub", true)?;

    SubmenuBuilder::with_id(app, TRAY_QUICK_ACTIONS_SUBMENU_ID, "Quick Actions")
        .item(&new_connection_item)
        .item(&cli_item)
        .item(&pubsub_item)
        .separator()
        .item(&hide_item)
        .build()
        .map_err(|error| error.to_string())
}

pub(super) async fn build_statusbar_menu(
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
    let selected_connection_id =
        resolve_statusbar_selected_connection(app, &connections, &settings);
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

pub(super) fn build_loading_statusbar_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let loading_current = MenuItem::with_id(
        app,
        "statusbar_loading_current",
        "Loading current context…",
        false,
        None::<&str>,
    )?;
    let loading_connections = MenuItem::with_id(
        app,
        "statusbar_loading_connections",
        "Loading connections…",
        false,
        None::<&str>,
    )?;
    let loading_pinned = MenuItem::with_id(
        app,
        "statusbar_loading_pinned",
        "Loading pinned keys…",
        false,
        None::<&str>,
    )?;
    let loading_recent = MenuItem::with_id(
        app,
        "statusbar_loading_recent",
        "Loading recent keys…",
        false,
        None::<&str>,
    )?;
    let current_submenu = SubmenuBuilder::with_id(app, TRAY_CURRENT_SUBMENU_ID, "Current")
        .item(&loading_current)
        .build()?;
    let connections_submenu =
        SubmenuBuilder::with_id(app, TRAY_CONNECTIONS_SUBMENU_ID, "Connections")
            .item(&loading_connections)
            .build()?;
    let pinned_keys_submenu =
        SubmenuBuilder::with_id(app, TRAY_PINNED_KEYS_SUBMENU_ID, "Pinned Keys")
            .item(&loading_pinned)
            .build()?;
    let recent_keys_submenu =
        SubmenuBuilder::with_id(app, TRAY_RECENT_KEYS_SUBMENU_ID, "Recent Keys")
            .item(&loading_recent)
            .build()?;
    let quick_actions_submenu =
        SubmenuBuilder::with_id(app, TRAY_QUICK_ACTIONS_SUBMENU_ID, "Quick Actions")
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
