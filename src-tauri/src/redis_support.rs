use crate::models::{RedisConnectionTestInput, RedisSshTunnelInput};
use async_ssh2_lite::{AsyncSession, SessionConfiguration, TokioTcpStream};
use redis::{aio::MultiplexedConnection, IntoConnectionInfo, Value};
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

fn build_connection_url(input: &RedisConnectionTestInput) -> Result<Url, String> {
    let scheme = if input.tls { "rediss" } else { "redis" };
    let mut url = Url::parse(&format!("{scheme}://localhost"))
        .map_err(|error| format!("Failed to build connection URL: {error}"))?;

    url.set_host(Some(&input.host))
        .map_err(|_| "Invalid host".to_string())?;
    url.set_port(Some(input.port))
        .map_err(|_| "Invalid port".to_string())?;
    url.set_path(&format!("/{}", input.db));

    if let Some(username) = input
        .username
        .as_deref()
        .map(str::trim)
        .filter(|username| !username.is_empty())
    {
        url.set_username(username)
            .map_err(|_| "Invalid username".to_string())?;
    }

    if let Some(password) = input
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
    {
        url.set_password(Some(password))
            .map_err(|_| "Invalid password".to_string())?;
    }

    Ok(url)
}

fn build_connection_info(input: &RedisConnectionTestInput) -> Result<redis::ConnectionInfo, String> {
    let url = build_connection_url(input)?;

    url.as_str()
        .into_connection_info()
        .map_err(|error| format!("Failed to parse Redis connection info: {error}"))
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
    let connection_info = build_connection_info(input)?;
    let session = open_ssh_session(ssh_tunnel).await?;
    let channel = session
        .channel_direct_tcpip(&input.host, input.port, None)
        .await
        .map_err(|error| format!("Failed to open SSH tunnel to Redis: {error}"))?;

    let stream: BoxedRedisAsyncStream = if input.tls {
        let tls_connector = native_tls::TlsConnector::new()
            .map_err(|error| format!("Failed to create TLS connector: {error}"))?;
        let tls_connector = TlsConnector::from(tls_connector);
        let tls_stream = tls_connector
            .connect(&input.host, channel)
            .await
            .map_err(|error| format!("Failed to establish TLS over SSH tunnel: {error}"))?;

        Box::new(tls_stream)
    } else {
        Box::new(channel)
    };

    let (connection, driver) = MultiplexedConnection::new(&connection_info.redis, stream)
        .await
        .map_err(|error| format!("Failed to connect to Redis through SSH tunnel: {error}"))?;

    tauri::async_runtime::spawn(driver);

    Ok(connection)
}

pub(crate) async fn open_connection(
    input: &RedisConnectionTestInput,
) -> Result<MultiplexedConnection, String> {
    if let Some(ssh_tunnel) = &input.ssh_tunnel {
        return open_ssh_connection(input, ssh_tunnel).await;
    }

    let url = build_connection_url(input)?;
    let client = redis::Client::open(url.as_str())
        .map_err(|error| format!("Failed to create Redis client: {error}"))?;

    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Failed to connect to Redis: {error}"))
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
