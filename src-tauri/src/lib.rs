mod commands;
mod models;
mod redis_support;

#[cfg(target_os = "macos")]
mod statusbar;

#[cfg(target_os = "macos")]
use tauri::{Manager, WindowEvent};

#[cfg(target_os = "macos")]
use crate::statusbar::{
    hide_main_window, setup_macos_statusbar, show_main_window, StatusBarState,
    MAIN_WINDOW_LABEL,
};
use crate::commands::{
    ack_redis_stream_entries, add_redis_hash_entry, add_redis_set_member, add_redis_zset_entry,
    append_redis_list_value, append_redis_stream_entry, claim_redis_stream_entries,
    create_redis_key, create_redis_stream_consumer_group, delete_redis_hash_entry,
    delete_redis_list_value, delete_redis_stream_consumer, delete_redis_stream_entries,
    delete_redis_zset_entry, destroy_redis_stream_consumer_group, get_redis_cluster_topology,
    get_redis_key_value, get_redis_stream_consumers, get_redis_stream_entries,
    get_redis_stream_groups, get_redis_stream_pending_entries, greet, list_redis_keys,
    proxy_http_request, publish_redis_pubsub_message, rename_redis_key, rename_redis_keys,
    run_redis_command, scan_redis_keys_page, start_redis_pubsub_session, stop_redis_pubsub_session,
    subscribe_redis_pubsub_channels, subscribe_redis_pubsub_patterns, test_redis_connection,
    unsubscribe_redis_pubsub_channels, unsubscribe_redis_pubsub_patterns,
    update_redis_hash_entry, update_redis_json_value, update_redis_list_value,
    update_redis_string_value, update_redis_zset_entry, RedisPubSubState,
};

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
            scan_redis_keys_page,
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
