use crate::models::{RedisCommandInput, RedisConnectionTestInput, RedisLuaScriptInput};
use crate::redis_support::{format_cli_output, open_connection};
use redis::Value;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub async fn test_redis_connection(input: RedisConnectionTestInput) -> Result<(), String> {
    let mut connection = open_connection(&input).await?;

    let response: String = redis::cmd("PING")
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Redis ping failed: {error}"))?;

    if response != "PONG" {
        return Err(format!("Unexpected Redis response: {response}"));
    }

    Ok(())
}

#[tauri::command]
pub async fn run_redis_command(input: RedisCommandInput) -> Result<String, String> {
    let command_parts = shell_words::split(&input.command)
        .map_err(|error| format!("Failed to parse command: {error}"))?;

    if command_parts.is_empty() {
        return Err("Command is empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let mut command = redis::cmd(&command_parts[0]);

    for argument in &command_parts[1..] {
        command.arg(argument);
    }

    let result: Value = command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Command failed: {error}"))?;

    Ok(format_cli_output(result))
}

#[tauri::command]
pub async fn run_redis_lua_script(input: RedisLuaScriptInput) -> Result<String, String> {
    let script = input.script.trim();

    if script.is_empty() {
        return Err("Lua script is empty".to_string());
    }

    let mut connection = open_connection(&input.connection).await?;
    let redis_script = redis::Script::new(script);
    let mut invocation = redis_script.prepare_invoke();

    for key in &input.keys {
        invocation.key(key);
    }

    for arg in &input.args {
        invocation.arg(arg);
    }

    let result: Value = invocation
        .invoke_async(&mut connection)
        .await
        .map_err(|error| format!("Lua script failed: {error}"))?;

    Ok(format_cli_output(result))
}
