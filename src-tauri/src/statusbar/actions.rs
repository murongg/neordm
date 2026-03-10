use tauri::{AppHandle, Manager};

use crate::redis_support::open_connection;

use super::{
    collapse_statusbar_whitespace, current_statusbar_selected_connection_id,
    emit_tray_quick_action, emit_tray_statusbar_event, hide_main_window,
    load_statusbar_connections, persist_statusbar_last_connection_id, pin_statusbar_key,
    record_statusbar_recent_key, remove_statusbar_recent_key, set_statusbar_menu_actions,
    set_statusbar_selected_connection_id, set_statusbar_synced_connections, show_main_window,
    sync_statusbar_pinned_key_metadata, truncate_statusbar_text, unpin_statusbar_key,
    StatusBarAction, StatusBarKeyEntry, StatusBarState, TrayStatusbarContextPayload,
    TrayStatusbarEventPayload, RedisConnectionTestInput, STATUSBAR_TRAY_ID,
    STATUSBAR_VALUE_PREVIEW_LIMIT, TRAY_BROWSE_KEYS_ID, TRAY_DISCONNECT_ID,
    TRAY_HIDE_WINDOW_ID, TRAY_NEW_CONNECTION_ID, TRAY_OPEN_CLI_ID, TRAY_OPEN_PUBSUB_ID,
    TRAY_OPEN_WINDOW_ID, TRAY_QUIT_ID, TRAY_REFRESH_KEYS_ID,
};

pub(super) async fn delete_statusbar_key(
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

pub(super) async fn refresh_statusbar_menu(app: &AppHandle) -> Result<(), String> {
    let (menu, actions, selected_connection_id) = super::menu::build_statusbar_menu(app).await?;

    set_statusbar_selected_connection_id(app, selected_connection_id);
    set_statusbar_menu_actions(app, actions);

    let Some(tray) = app.tray_by_id(STATUSBAR_TRAY_ID) else {
        return Ok(());
    };

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

pub(super) fn refresh_statusbar_menu_in_background(app: &AppHandle) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = refresh_statusbar_menu(&app_handle).await {
            eprintln!("Failed to refresh status bar menu: {error}");
        }
    });
}

pub(super) fn handle_statusbar_context_payload(
    app: &AppHandle,
    payload: TrayStatusbarContextPayload,
) {
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

pub(super) fn handle_statusbar_menu_event(app: &AppHandle, event_id: &str) {
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
