mod commands;
mod models;
mod redis_support;

use crate::commands::{
    create_redis_key, delete_redis_hash_entry, delete_redis_zset_entry,
    get_redis_cluster_topology, get_redis_key_value, greet, list_redis_keys,
    proxy_http_request, rename_redis_key, rename_redis_keys, run_redis_command,
    test_redis_connection, update_redis_hash_entry, update_redis_json_value,
    update_redis_string_value, update_redis_zset_entry,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

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
            create_redis_key,
            rename_redis_key,
            rename_redis_keys,
            update_redis_string_value,
            update_redis_json_value,
            update_redis_hash_entry,
            delete_redis_hash_entry,
            update_redis_zset_entry,
            delete_redis_zset_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
