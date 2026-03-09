use crate::models::{
    RedisConnectionTestInput, RedisSentinelInput, RedisSentinelNodeInput, RedisSshTunnelInput,
};
use async_ssh2_lite::{AsyncSession, SessionConfiguration, TokioTcpStream};
use redis::{aio::MultiplexedConnection, ConnectionInfo, IntoConnectionInfo, Value};
use std::{
    env,
    net::ToSocketAddrs,
    path::{Path, PathBuf},
};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_native_tls::TlsConnector;
use url::Url;

trait RedisAsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> RedisAsyncStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

type BoxedRedisAsyncStream = Box<dyn RedisAsyncStream>;

fn build_connection_url(
    host: &str,
    port: u16,
    db: i64,
    username: Option<&str>,
    password: Option<&str>,
    tls: bool,
) -> Result<Url, String> {
    let scheme = if tls { "rediss" } else { "redis" };
    let mut url = Url::parse(&format!("{scheme}://localhost"))
        .map_err(|error| format!("Failed to build connection URL: {error}"))?;

    url.set_host(Some(host))
        .map_err(|_| "Invalid host".to_string())?;
    url.set_port(Some(port))
        .map_err(|_| "Invalid port".to_string())?;
    url.set_path(&format!("/{db}"));

    if let Some(username) = username
        .map(str::trim)
        .filter(|username| !username.is_empty())
    {
        url.set_username(username)
            .map_err(|_| "Invalid username".to_string())?;
    }

    if let Some(password) = password.filter(|password| !password.is_empty()) {
        url.set_password(Some(password))
            .map_err(|_| "Invalid password".to_string())?;
    }

    Ok(url)
}

fn build_connection_info(
    host: &str,
    port: u16,
    db: i64,
    username: Option<&str>,
    password: Option<&str>,
    tls: bool,
) -> Result<ConnectionInfo, String> {
    let url = build_connection_url(host, port, db, username, password, tls)?;

    url.as_str()
        .into_connection_info()
        .map_err(|error| format!("Failed to parse Redis connection info: {error}"))
}

fn build_redis_connection_info(input: &RedisConnectionTestInput) -> Result<ConnectionInfo, String> {
    build_connection_info(
        &input.host,
        input.port,
        input.db,
        input.username.as_deref(),
        input.password.as_deref(),
        input.tls,
    )
}

fn build_sentinel_connection_info(
    node: &RedisSentinelNodeInput,
    sentinel: &RedisSentinelInput,
) -> Result<ConnectionInfo, String> {
    build_connection_info(
        &node.host,
        node.port,
        0,
        sentinel.username.as_deref(),
        sentinel.password.as_deref(),
        sentinel.tls,
    )
}

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home_dir) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
            return PathBuf::from(home_dir);
        }
    }

    if let Some(stripped) = path
        .strip_prefix("~/")
        .or_else(|| path.strip_prefix("~\\"))
    {
        if let Some(home_dir) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
            return PathBuf::from(home_dir).join(stripped);
        }
    }

    PathBuf::from(path)
}

async fn authenticate_ssh_session(
    session: &AsyncSession<TokioTcpStream>,
    ssh_tunnel: &RedisSshTunnelInput,
) -> Result<(), String> {
    let mut errors = Vec::new();

    if let Some(private_key_path) = ssh_tunnel
        .private_key_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let private_key_path = expand_home_path(private_key_path);
        session
            .userauth_pubkey_file(
                &ssh_tunnel.username,
                None,
                Path::new(&private_key_path),
                ssh_tunnel.passphrase.as_deref(),
            )
            .await
            .map_err(|error| {
                errors.push(format!("private key auth failed: {error}"));
                error
            })
            .ok();

        if session.authenticated() {
            return Ok(());
        }
    }

    if let Some(password) = ssh_tunnel
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
    {
        session
            .userauth_password(&ssh_tunnel.username, password)
            .await
            .map_err(|error| {
                errors.push(format!("password auth failed: {error}"));
                error
            })
            .ok();

        if session.authenticated() {
            return Ok(());
        }
    }

    session
        .userauth_agent_with_try_next(&ssh_tunnel.username)
        .await
        .map_err(|error| {
            errors.push(format!("ssh-agent auth failed: {error}"));
            error
        })
        .ok();

    if session.authenticated() {
        return Ok(());
    }

    if errors.is_empty() {
        return Err("SSH authentication failed".to_string());
    }

    Err(format!(
        "SSH authentication failed ({})",
        errors.join(" · ")
    ))
}

async fn open_ssh_session(
    ssh_tunnel: &RedisSshTunnelInput,
) -> Result<AsyncSession<TokioTcpStream>, String> {
    let socket_addr = (ssh_tunnel.host.as_str(), ssh_tunnel.port)
        .to_socket_addrs()
        .map_err(|error| format!("Failed to resolve SSH host: {error}"))?
        .next()
        .ok_or_else(|| "SSH host did not resolve to any address".to_string())?;

    let mut configuration = SessionConfiguration::new();
    configuration.set_timeout(15_000);
    configuration.set_keepalive(false, 30);

    let mut session = AsyncSession::<TokioTcpStream>::connect(socket_addr, Some(configuration))
        .await
        .map_err(|error| format!("Failed to connect to SSH host: {error}"))?;

    session
        .handshake()
        .await
        .map_err(|error| format!("Failed to complete SSH handshake: {error}"))?;

    authenticate_ssh_session(&session, ssh_tunnel).await?;

    Ok(session)
}

async fn open_ssh_connection(
    input: &RedisConnectionTestInput,
    ssh_tunnel: &RedisSshTunnelInput,
) -> Result<MultiplexedConnection, String> {
    let connection_info = build_redis_connection_info(input)?;
    let session = open_ssh_session(ssh_tunnel).await?;
    open_ssh_connection_to_target(
        &session,
        &connection_info,
        &input.host,
        input.port,
        input.tls,
        "Redis",
    )
    .await
}

async fn open_direct_connection(
    connection_info: &ConnectionInfo,
    target_name: &str,
) -> Result<MultiplexedConnection, String> {
    let client = redis::Client::open(connection_info.clone()).map_err(|error| {
        format!("Failed to create {target_name} client: {error}")
    })?;

    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Failed to connect to {target_name}: {error}"))
}

async fn open_ssh_stream(
    session: &AsyncSession<TokioTcpStream>,
    host: &str,
    port: u16,
    tls: bool,
) -> Result<BoxedRedisAsyncStream, String> {
    let channel = session
        .channel_direct_tcpip(host, port, None)
        .await
        .map_err(|error| format!("Failed to open SSH tunnel to {host}:{port}: {error}"))?;

    if !tls {
        return Ok(Box::new(channel));
    }

    let tls_connector = native_tls::TlsConnector::new()
        .map_err(|error| format!("Failed to create TLS connector: {error}"))?;
    let tls_connector = TlsConnector::from(tls_connector);
    let tls_stream = tls_connector
        .connect(host, channel)
        .await
        .map_err(|error| format!("Failed to establish TLS to {host}:{port}: {error}"))?;

    Ok(Box::new(tls_stream))
}

async fn open_stream_connection(
    connection_info: &ConnectionInfo,
    stream: BoxedRedisAsyncStream,
    target_name: &str,
) -> Result<MultiplexedConnection, String> {
    let (connection, driver) = MultiplexedConnection::new(&connection_info.redis, stream)
        .await
        .map_err(|error| format!("Failed to connect to {target_name}: {error}"))?;

    tauri::async_runtime::spawn(driver);

    Ok(connection)
}

async fn open_ssh_connection_to_target(
    session: &AsyncSession<TokioTcpStream>,
    connection_info: &ConnectionInfo,
    host: &str,
    port: u16,
    tls: bool,
    target_name: &str,
) -> Result<MultiplexedConnection, String> {
    let stream = open_ssh_stream(session, host, port, tls).await?;
    open_stream_connection(connection_info, stream, target_name).await
}

fn redis_value_to_string(value: Value) -> Result<String, String> {
    match value {
        Value::BulkString(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Value::SimpleString(value) => Ok(value),
        Value::VerbatimString { text, .. } => Ok(text),
        Value::Int(number) => Ok(number.to_string()),
        _ => Err("Unexpected sentinel response".to_string()),
    }
}

async fn query_sentinel_master_address(
    connection: &mut MultiplexedConnection,
    master_name: &str,
) -> Result<Option<(String, u16)>, String> {
    let response: Value = redis::cmd("SENTINEL")
        .arg("GET-MASTER-ADDR-BY-NAME")
        .arg(master_name)
        .query_async(connection)
        .await
        .map_err(|error| format!("Failed to query sentinel master: {error}"))?;

    match response {
        Value::Nil => Ok(None),
        Value::Array(values) => {
            if values.len() < 2 {
                return Err("Sentinel returned an incomplete master address".to_string());
            }

            let mut values = values.into_iter();
            let host = redis_value_to_string(
                values
                    .next()
                    .ok_or_else(|| "Sentinel returned an empty master host".to_string())?,
            )?;
            let port = redis_value_to_string(
                values
                    .next()
                    .ok_or_else(|| "Sentinel returned an empty master port".to_string())?,
            )?
            .parse::<u16>()
            .map_err(|error| format!("Invalid sentinel master port: {error}"))?;

            Ok(Some((host, port)))
        }
        _ => Err("Sentinel returned an unsupported response".to_string()),
    }
}

async fn discover_master_address_direct(
    sentinel: &RedisSentinelInput,
) -> Result<(String, u16), String> {
    let mut errors = Vec::new();

    for node in &sentinel.nodes {
        let connection_info = build_sentinel_connection_info(node, sentinel)?;

        match open_direct_connection(&connection_info, "Sentinel").await {
            Ok(mut connection) => match query_sentinel_master_address(
                &mut connection,
                &sentinel.master_name,
            )
            .await
            {
                Ok(Some(address)) => return Ok(address),
                Ok(None) => errors.push(format!(
                    "{}:{} did not resolve master `{}`",
                    node.host, node.port, sentinel.master_name
                )),
                Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
            },
            Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
        }
    }

    Err(format!(
        "Failed to resolve sentinel master `{}` ({})",
        sentinel.master_name,
        errors.join(" · ")
    ))
}

async fn discover_master_address_over_ssh(
    session: &AsyncSession<TokioTcpStream>,
    sentinel: &RedisSentinelInput,
) -> Result<(String, u16), String> {
    let mut errors = Vec::new();

    for node in &sentinel.nodes {
        let connection_info = build_sentinel_connection_info(node, sentinel)?;

        match open_ssh_connection_to_target(
            session,
            &connection_info,
            &node.host,
            node.port,
            sentinel.tls,
            "Sentinel",
        )
        .await
        {
            Ok(mut connection) => match query_sentinel_master_address(
                &mut connection,
                &sentinel.master_name,
            )
            .await
            {
                Ok(Some(address)) => return Ok(address),
                Ok(None) => errors.push(format!(
                    "{}:{} did not resolve master `{}`",
                    node.host, node.port, sentinel.master_name
                )),
                Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
            },
            Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
        }
    }

    Err(format!(
        "Failed to resolve sentinel master `{}` ({})",
        sentinel.master_name,
        errors.join(" · ")
    ))
}

async fn open_sentinel_connection(
    input: &RedisConnectionTestInput,
    sentinel: &RedisSentinelInput,
) -> Result<MultiplexedConnection, String> {
    let (host, port) = discover_master_address_direct(sentinel).await?;
    let connection_info = build_connection_info(
        &host,
        port,
        input.db,
        input.username.as_deref(),
        input.password.as_deref(),
        input.tls,
    )?;

    open_direct_connection(&connection_info, "Redis via Sentinel").await
}

async fn open_sentinel_connection_over_ssh(
    input: &RedisConnectionTestInput,
    sentinel: &RedisSentinelInput,
    ssh_tunnel: &RedisSshTunnelInput,
) -> Result<MultiplexedConnection, String> {
    let session = open_ssh_session(ssh_tunnel).await?;
    let (host, port) = discover_master_address_over_ssh(&session, sentinel).await?;
    let connection_info = build_connection_info(
        &host,
        port,
        input.db,
        input.username.as_deref(),
        input.password.as_deref(),
        input.tls,
    )?;

    open_ssh_connection_to_target(
        &session,
        &connection_info,
        &host,
        port,
        input.tls,
        "Redis via Sentinel",
    )
    .await
}

pub(crate) async fn open_connection(
    input: &RedisConnectionTestInput,
) -> Result<MultiplexedConnection, String> {
    if let Some(sentinel) = &input.sentinel {
        if let Some(ssh_tunnel) = &input.ssh_tunnel {
            return open_sentinel_connection_over_ssh(input, sentinel, ssh_tunnel).await;
        }

        return open_sentinel_connection(input, sentinel).await;
    }

    if let Some(ssh_tunnel) = &input.ssh_tunnel {
        return open_ssh_connection(input, ssh_tunnel).await;
    }

    let connection_info = build_redis_connection_info(input)?;
    open_direct_connection(&connection_info, "Redis").await
}

pub(crate) fn normalize_key_type(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();

    if lower.contains("json") {
        return "json".to_string();
    }

    match lower.as_str() {
        "string" | "hash" | "list" | "set" | "zset" | "stream" | "json" => lower,
        _ => "string".to_string(),
    }
}

fn quote_cli_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("{text:?}"))
}

fn format_cli_multiline(prefix: &str, value: &str) -> String {
    let mut lines = value.lines();
    let first_line = lines.next().unwrap_or_default();
    let continuation_padding = " ".repeat(prefix.len());
    let mut output = format!("{prefix}{first_line}");

    for line in lines {
        output.push('\n');
        output.push_str(&continuation_padding);
        output.push_str(line);
    }

    output
}

fn format_cli_sequence(values: Vec<Value>) -> String {
    if values.is_empty() {
        return "(empty array)".to_string();
    }

    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let prefix = format!("{}) ", index + 1);
            format_cli_multiline(&prefix, &format_cli_value(value))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_cli_value(value: Value) -> String {
    match value {
        Value::Nil => "(nil)".to_string(),
        Value::Int(number) => format!("(integer) {number}"),
        Value::BulkString(bytes) => quote_cli_string(&String::from_utf8_lossy(&bytes)),
        Value::Array(values) | Value::Set(values) => format_cli_sequence(values),
        Value::SimpleString(value) => value,
        Value::Okay => "OK".to_string(),
        Value::Map(entries) => {
            let mut flattened = Vec::with_capacity(entries.len() * 2);

            for (key, value) in entries {
                flattened.push(key);
                flattened.push(value);
            }

            format_cli_sequence(flattened)
        }
        Value::Attribute { data, .. } => format_cli_value(*data),
        Value::Double(number) => format!("(double) {number}"),
        Value::Boolean(value) => format!("(boolean) {}", if value { "true" } else { "false" }),
        Value::VerbatimString { text, .. } => quote_cli_string(&text),
        Value::BigNumber(value) => format!("(bignumber) {value}"),
        Value::Push { kind, data } => {
            if data.is_empty() {
                format!("(push {kind:?})")
            } else {
                format_cli_multiline(&format!("(push {kind:?}) "), &format_cli_sequence(data))
            }
        }
        Value::ServerError(error) => format!("(error) {error:?}"),
    }
}

pub(crate) fn format_cli_output(value: Value) -> String {
    format_cli_value(value)
}
