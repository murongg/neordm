use crate::models::{
    RedisClusterInput, RedisClusterSlotRange, RedisClusterTopologyNode, RedisConnectionTestInput,
    RedisSentinelInput, RedisSentinelNodeInput, RedisSshTunnelInput,
};
use async_ssh2_lite::{AsyncSession, SessionConfiguration, TokioTcpStream};
use redis::{
    aio::{ConnectionLike, MultiplexedConnection, PubSub},
    cluster::ClusterClientBuilder,
    cluster_async::ClusterConnection,
    ConnectionInfo, IntoConnectionInfo, RedisFuture, Value,
};
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

pub(crate) enum RedisConnectionHandle {
    Single(MultiplexedConnection),
    Cluster(ClusterConnection),
}

impl ConnectionLike for RedisConnectionHandle {
    fn req_packed_command<'a>(&'a mut self, cmd: &'a redis::Cmd) -> RedisFuture<'a, Value> {
        match self {
            RedisConnectionHandle::Single(connection) => connection.req_packed_command(cmd),
            RedisConnectionHandle::Cluster(connection) => connection.req_packed_command(cmd),
        }
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        cmd: &'a redis::Pipeline,
        offset: usize,
        count: usize,
    ) -> RedisFuture<'a, Vec<Value>> {
        match self {
            RedisConnectionHandle::Single(connection) => {
                connection.req_packed_commands(cmd, offset, count)
            }
            RedisConnectionHandle::Cluster(connection) => {
                connection.req_packed_commands(cmd, offset, count)
            }
        }
    }

    fn get_db(&self) -> i64 {
        match self {
            RedisConnectionHandle::Single(connection) => connection.get_db(),
            RedisConnectionHandle::Cluster(connection) => connection.get_db(),
        }
    }
}

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

fn build_cluster_node_urls(
    input: &RedisConnectionTestInput,
    cluster: &RedisClusterInput,
) -> Result<Vec<String>, String> {
    cluster
        .nodes
        .iter()
        .map(|node| {
            build_connection_url(
                &node.host,
                node.port,
                0,
                input.username.as_deref(),
                input.password.as_deref(),
                input.tls,
            )
            .map(|url| url.to_string())
        })
        .collect()
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

    if let Some(stripped) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
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
    let client = redis::Client::open(connection_info.clone())
        .map_err(|error| format!("Failed to create {target_name} client: {error}"))?;

    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Failed to connect to {target_name}: {error}"))
}

async fn open_direct_pubsub(
    connection_info: &ConnectionInfo,
    target_name: &str,
) -> Result<PubSub, String> {
    let client = redis::Client::open(connection_info.clone())
        .map_err(|error| format!("Failed to create {target_name} client: {error}"))?;

    client
        .get_async_pubsub()
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

async fn open_ssh_pubsub_to_target(
    session: &AsyncSession<TokioTcpStream>,
    connection_info: &ConnectionInfo,
    host: &str,
    port: u16,
    tls: bool,
    target_name: &str,
) -> Result<PubSub, String> {
    let stream = open_ssh_stream(session, host, port, tls).await?;

    PubSub::new(&connection_info.redis, stream)
        .await
        .map_err(|error| format!("Failed to connect to {target_name}: {error}"))
}

pub(crate) fn redis_value_to_string(value: Value) -> Result<String, String> {
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
            Ok(mut connection) => {
                match query_sentinel_master_address(&mut connection, &sentinel.master_name).await {
                    Ok(Some(address)) => return Ok(address),
                    Ok(None) => errors.push(format!(
                        "{}:{} did not resolve master `{}`",
                        node.host, node.port, sentinel.master_name
                    )),
                    Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
                }
            }
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
            Ok(mut connection) => {
                match query_sentinel_master_address(&mut connection, &sentinel.master_name).await {
                    Ok(Some(address)) => return Ok(address),
                    Ok(None) => errors.push(format!(
                        "{}:{} did not resolve master `{}`",
                        node.host, node.port, sentinel.master_name
                    )),
                    Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
                }
            }
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

fn parse_cluster_master_node(value: Value) -> Result<(String, u16), String> {
    let values = match value {
        Value::Array(values) => values,
        _ => return Err("Cluster returned an invalid node entry".to_string()),
    };

    if values.len() < 2 {
        return Err("Cluster returned an incomplete node entry".to_string());
    }

    let mut values = values.into_iter();
    let host = redis_value_to_string(
        values
            .next()
            .ok_or_else(|| "Cluster returned an empty node host".to_string())?,
    )?;
    let port = redis_value_to_string(
        values
            .next()
            .ok_or_else(|| "Cluster returned an empty node port".to_string())?,
    )?
    .parse::<u16>()
    .map_err(|error| format!("Invalid cluster node port: {error}"))?;

    Ok((host, port))
}

fn parse_cluster_topology(value: Value) -> Result<Vec<RedisClusterTopologyNode>, String> {
    let slots = match value {
        Value::Array(values) => values,
        _ => return Err("Cluster returned an invalid slots response".to_string()),
    };

    let mut nodes = std::collections::HashMap::<String, RedisClusterTopologyNode>::new();

    for entry in slots {
        let values = match entry {
            Value::Array(values) => values,
            _ => continue,
        };

        if values.len() < 3 {
            continue;
        }

        let start = redis_value_to_string(values[0].clone())?
            .parse::<u16>()
            .map_err(|error| format!("Invalid cluster slot start: {error}"))?;
        let end = redis_value_to_string(values[1].clone())?
            .parse::<u16>()
            .map_err(|error| format!("Invalid cluster slot end: {error}"))?;
        let (host, port) = parse_cluster_master_node(values[2].clone())?;
        let address = format!("{host}:{port}");

        let node = nodes
            .entry(address.clone())
            .or_insert_with(|| RedisClusterTopologyNode {
                host: host.clone(),
                port,
                address,
                slot_ranges: Vec::new(),
                slot_count: 0,
            });

        node.slot_ranges.push(RedisClusterSlotRange { start, end });
        node.slot_count += u32::from(end.saturating_sub(start)) + 1;
    }

    let mut nodes = nodes.into_values().collect::<Vec<_>>();

    for node in &mut nodes {
        node.slot_ranges.sort_by_key(|range| range.start);
    }

    nodes.sort_by_key(|node| {
        node.slot_ranges
            .first()
            .map(|range| range.start)
            .unwrap_or(u16::MAX)
    });

    if nodes.is_empty() {
        return Err("Cluster returned no master nodes".to_string());
    }

    Ok(nodes)
}

pub(crate) async fn get_cluster_topology(
    input: &RedisConnectionTestInput,
) -> Result<Vec<RedisClusterTopologyNode>, String> {
    let cluster = input
        .cluster
        .as_ref()
        .ok_or_else(|| "Cluster configuration is missing".to_string())?;

    if input.ssh_tunnel.is_some() {
        return Err("Redis Cluster over SSH is not supported yet".to_string());
    }

    let mut errors = Vec::new();

    for node in &cluster.nodes {
        let connection_info = build_connection_info(
            &node.host,
            node.port,
            0,
            input.username.as_deref(),
            input.password.as_deref(),
            input.tls,
        )?;

        match open_direct_connection(&connection_info, "Redis Cluster seed").await {
            Ok(mut connection) => {
                let response: Value = match redis::cmd("CLUSTER")
                    .arg("SLOTS")
                    .query_async(&mut connection)
                    .await
                {
                    Ok(response) => response,
                    Err(error) => {
                        errors.push(format!(
                            "{}:{} failed to inspect cluster slots: {error}",
                            node.host, node.port
                        ));
                        continue;
                    }
                };

                return parse_cluster_topology(response);
            }
            Err(error) => errors.push(format!("{}:{} {error}", node.host, node.port)),
        }
    }

    Err(format!(
        "Failed to inspect Redis Cluster topology ({})",
        errors.join(" · ")
    ))
}

pub(crate) async fn find_cluster_node_address_for_slot(
    input: &RedisConnectionTestInput,
    slot: u16,
) -> Result<Option<String>, String> {
    let topology = get_cluster_topology(input).await?;

    Ok(topology.into_iter().find_map(|node| {
        node.slot_ranges
            .iter()
            .any(|range| slot >= range.start && slot <= range.end)
            .then_some(node.address)
    }))
}

async fn open_cluster_connection(
    input: &RedisConnectionTestInput,
    cluster: &RedisClusterInput,
) -> Result<ClusterConnection, String> {
    if input.ssh_tunnel.is_some() {
        return Err("Redis Cluster over SSH is not supported yet".to_string());
    }

    let cluster_urls = build_cluster_node_urls(input, cluster)?;
    let client = ClusterClientBuilder::new(cluster_urls)
        .build()
        .map_err(|error| format!("Failed to create Redis Cluster client: {error}"))?;

    client
        .get_async_connection()
        .await
        .map_err(|error| format!("Failed to connect to Redis Cluster: {error}"))
}

pub(crate) async fn open_connection(
    input: &RedisConnectionTestInput,
) -> Result<RedisConnectionHandle, String> {
    if let Some(cluster) = &input.cluster {
        return open_cluster_connection(input, cluster)
            .await
            .map(RedisConnectionHandle::Cluster);
    }

    if let Some(sentinel) = &input.sentinel {
        if let Some(ssh_tunnel) = &input.ssh_tunnel {
            return open_sentinel_connection_over_ssh(input, sentinel, ssh_tunnel)
                .await
                .map(RedisConnectionHandle::Single);
        }

        return open_sentinel_connection(input, sentinel)
            .await
            .map(RedisConnectionHandle::Single);
    }

    if let Some(ssh_tunnel) = &input.ssh_tunnel {
        return open_ssh_connection(input, ssh_tunnel)
            .await
            .map(RedisConnectionHandle::Single);
    }

    let connection_info = build_redis_connection_info(input)?;
    open_direct_connection(&connection_info, "Redis")
        .await
        .map(RedisConnectionHandle::Single)
}

pub(crate) async fn open_pubsub(input: &RedisConnectionTestInput) -> Result<PubSub, String> {
    if let Some(cluster) = &input.cluster {
        let node = cluster
            .nodes
            .first()
            .ok_or_else(|| "Cluster configuration is missing seed nodes".to_string())?;
        let connection_info = build_connection_info(
            &node.host,
            node.port,
            0,
            input.username.as_deref(),
            input.password.as_deref(),
            input.tls,
        )?;

        return open_direct_pubsub(&connection_info, "Redis Cluster Pub/Sub").await;
    }

    if let Some(sentinel) = &input.sentinel {
        if let Some(ssh_tunnel) = &input.ssh_tunnel {
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

            return open_ssh_pubsub_to_target(
                &session,
                &connection_info,
                &host,
                port,
                input.tls,
                "Redis Pub/Sub via Sentinel",
            )
            .await;
        }

        let (host, port) = discover_master_address_direct(sentinel).await?;
        let connection_info = build_connection_info(
            &host,
            port,
            input.db,
            input.username.as_deref(),
            input.password.as_deref(),
            input.tls,
        )?;

        return open_direct_pubsub(&connection_info, "Redis Pub/Sub via Sentinel").await;
    }

    if let Some(ssh_tunnel) = &input.ssh_tunnel {
        let connection_info = build_redis_connection_info(input)?;
        let session = open_ssh_session(ssh_tunnel).await?;

        return open_ssh_pubsub_to_target(
            &session,
            &connection_info,
            &input.host,
            input.port,
            input.tls,
            "Redis Pub/Sub",
        )
        .await;
    }

    let connection_info = build_redis_connection_info(input)?;
    open_direct_pubsub(&connection_info, "Redis Pub/Sub").await
}

pub(crate) async fn open_pubsub_command_connection(
    input: &RedisConnectionTestInput,
) -> Result<MultiplexedConnection, String> {
    if let Some(cluster) = &input.cluster {
        let node = cluster
            .nodes
            .first()
            .ok_or_else(|| "Cluster configuration is missing seed nodes".to_string())?;
        let connection_info = build_connection_info(
            &node.host,
            node.port,
            0,
            input.username.as_deref(),
            input.password.as_deref(),
            input.tls,
        )?;

        return open_direct_connection(&connection_info, "Redis Cluster Pub/Sub").await;
    }

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
    open_direct_connection(&connection_info, "Redis Pub/Sub").await
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
