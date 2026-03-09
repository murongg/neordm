use crate::models::{
    RedisPubSubChannelsInput, RedisPubSubEvent, RedisPubSubPublishInput, RedisPubSubSessionInput,
    RedisPubSubStartInput,
};
use crate::redis_support::{open_pubsub, open_pubsub_command_connection};
use futures_util::StreamExt;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};

const REDIS_PUBSUB_EVENT: &str = "redis://pubsub";

static REDIS_PUBSUB_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Default)]
pub(crate) struct RedisPubSubState {
    sessions: Arc<Mutex<HashMap<String, RedisPubSubSessionHandle>>>,
}

#[derive(Clone)]
struct RedisPubSubSessionHandle {
    command_tx: mpsc::UnboundedSender<RedisPubSubCommand>,
}

enum RedisPubSubCommand {
    Subscribe {
        channels: Vec<String>,
        response: oneshot::Sender<Result<Vec<String>, String>>,
    },
    PatternSubscribe {
        patterns: Vec<String>,
        response: oneshot::Sender<Result<Vec<String>, String>>,
    },
    Unsubscribe {
        channels: Vec<String>,
        response: oneshot::Sender<Result<Vec<String>, String>>,
    },
    PatternUnsubscribe {
        patterns: Vec<String>,
        response: oneshot::Sender<Result<Vec<String>, String>>,
    },
    Shutdown {
        response: oneshot::Sender<()>,
    },
}

fn create_pubsub_session_id() -> String {
    let counter = REDIS_PUBSUB_SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    format!("pubsub-{timestamp}-{counter}")
}

fn now_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn normalize_channels(channels: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let normalized = channels
        .into_iter()
        .map(|channel| channel.trim().to_string())
        .filter(|channel| !channel.is_empty())
        .filter(|channel| seen.insert(channel.clone()))
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        return Err("Channel cannot be empty".to_string());
    }

    Ok(normalized)
}

async fn remove_pubsub_session(state: &RedisPubSubState, session_id: &str) {
    state.sessions.lock().await.remove(session_id);
}

async fn get_pubsub_session(
    state: &RedisPubSubState,
    session_id: &str,
) -> Result<RedisPubSubSessionHandle, String> {
    state
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| "Pub/Sub session not found".to_string())
}

async fn run_pubsub_session(
    app: AppHandle,
    state: RedisPubSubState,
    session_id: String,
    pubsub: redis::aio::PubSub,
    mut command_rx: mpsc::UnboundedReceiver<RedisPubSubCommand>,
) {
    let (mut sink, mut stream) = pubsub.split();
    let mut closed_reason: Option<String> = None;

    loop {
        tokio::select! {
            maybe_command = command_rx.recv() => {
                let Some(command) = maybe_command else {
                    break;
                };

                match command {
                    RedisPubSubCommand::Subscribe { channels, response } => {
                        let result = sink
                            .subscribe(channels.as_slice())
                            .await
                            .map(|_| channels)
                            .map_err(|error| format!("Failed to subscribe: {error}"));
                        let _ = response.send(result);
                    }
                    RedisPubSubCommand::PatternSubscribe { patterns, response } => {
                        let result = sink
                            .psubscribe(patterns.as_slice())
                            .await
                            .map(|_| patterns)
                            .map_err(|error| format!("Failed to pattern subscribe: {error}"));
                        let _ = response.send(result);
                    }
                    RedisPubSubCommand::Unsubscribe { channels, response } => {
                        let result = sink
                            .unsubscribe(channels.as_slice())
                            .await
                            .map(|_| channels)
                            .map_err(|error| format!("Failed to unsubscribe: {error}"));
                        let _ = response.send(result);
                    }
                    RedisPubSubCommand::PatternUnsubscribe { patterns, response } => {
                        let result = sink
                            .punsubscribe(patterns.as_slice())
                            .await
                            .map(|_| patterns)
                            .map_err(|error| format!("Failed to pattern unsubscribe: {error}"));
                        let _ = response.send(result);
                    }
                    RedisPubSubCommand::Shutdown { response } => {
                        let _ = response.send(());
                        break;
                    }
                }
            }
            maybe_message = stream.next() => {
                let Some(message) = maybe_message else {
                    closed_reason = Some("Pub/Sub stream ended".to_string());
                    break;
                };

                let payload = String::from_utf8_lossy(message.get_payload_bytes()).into_owned();
                let pattern = message.get_pattern::<Option<String>>().ok().flatten();
                let event = RedisPubSubEvent::Message {
                    session_id: session_id.clone(),
                    channel: message.get_channel_name().to_string(),
                    payload,
                    pattern,
                    timestamp: now_timestamp_ms(),
                };

                let _ = app.emit(REDIS_PUBSUB_EVENT, event);
            }
        }
    }

    remove_pubsub_session(&state, &session_id).await;
    let _ = app.emit(
        REDIS_PUBSUB_EVENT,
        RedisPubSubEvent::Closed {
            session_id,
            reason: closed_reason,
        },
    );
}

#[tauri::command]
pub async fn start_redis_pubsub_session(
    app: AppHandle,
    state: State<'_, RedisPubSubState>,
    input: RedisPubSubStartInput,
) -> Result<String, String> {
    let session_id = create_pubsub_session_id();
    let pubsub = open_pubsub(&input.connection).await?;
    let (command_tx, command_rx) = mpsc::unbounded_channel();
    let shared_state = state.inner().clone();

    shared_state
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), RedisPubSubSessionHandle { command_tx });

    tauri::async_runtime::spawn(run_pubsub_session(
        app,
        shared_state,
        session_id.clone(),
        pubsub,
        command_rx,
    ));

    Ok(session_id)
}

#[tauri::command]
pub async fn subscribe_redis_pubsub_channels(
    state: State<'_, RedisPubSubState>,
    input: RedisPubSubChannelsInput,
) -> Result<Vec<String>, String> {
    let channels = normalize_channels(input.channels)?;
    let session = get_pubsub_session(state.inner(), &input.session_id).await?;
    let (response_tx, response_rx) = oneshot::channel();

    session
        .command_tx
        .send(RedisPubSubCommand::Subscribe {
            channels,
            response: response_tx,
        })
        .map_err(|_| "Pub/Sub session is no longer available".to_string())?;

    response_rx
        .await
        .map_err(|_| "Pub/Sub session did not respond".to_string())?
}

#[tauri::command]
pub async fn unsubscribe_redis_pubsub_channels(
    state: State<'_, RedisPubSubState>,
    input: RedisPubSubChannelsInput,
) -> Result<Vec<String>, String> {
    let channels = normalize_channels(input.channels)?;
    let session = get_pubsub_session(state.inner(), &input.session_id).await?;
    let (response_tx, response_rx) = oneshot::channel();

    session
        .command_tx
        .send(RedisPubSubCommand::Unsubscribe {
            channels,
            response: response_tx,
        })
        .map_err(|_| "Pub/Sub session is no longer available".to_string())?;

    response_rx
        .await
        .map_err(|_| "Pub/Sub session did not respond".to_string())?
}

#[tauri::command]
pub async fn subscribe_redis_pubsub_patterns(
    state: State<'_, RedisPubSubState>,
    input: RedisPubSubChannelsInput,
) -> Result<Vec<String>, String> {
    let patterns = normalize_channels(input.channels)?;
    let session = get_pubsub_session(state.inner(), &input.session_id).await?;
    let (response_tx, response_rx) = oneshot::channel();

    session
        .command_tx
        .send(RedisPubSubCommand::PatternSubscribe {
            patterns,
            response: response_tx,
        })
        .map_err(|_| "Pub/Sub session is no longer available".to_string())?;

    response_rx
        .await
        .map_err(|_| "Pub/Sub session did not respond".to_string())?
}

#[tauri::command]
pub async fn unsubscribe_redis_pubsub_patterns(
    state: State<'_, RedisPubSubState>,
    input: RedisPubSubChannelsInput,
) -> Result<Vec<String>, String> {
    let patterns = normalize_channels(input.channels)?;
    let session = get_pubsub_session(state.inner(), &input.session_id).await?;
    let (response_tx, response_rx) = oneshot::channel();

    session
        .command_tx
        .send(RedisPubSubCommand::PatternUnsubscribe {
            patterns,
            response: response_tx,
        })
        .map_err(|_| "Pub/Sub session is no longer available".to_string())?;

    response_rx
        .await
        .map_err(|_| "Pub/Sub session did not respond".to_string())?
}

#[tauri::command]
pub async fn stop_redis_pubsub_session(
    state: State<'_, RedisPubSubState>,
    input: RedisPubSubSessionInput,
) -> Result<(), String> {
    let session = state.sessions.lock().await.remove(&input.session_id);

    let Some(session) = session else {
        return Ok(());
    };

    let (response_tx, response_rx) = oneshot::channel();
    session
        .command_tx
        .send(RedisPubSubCommand::Shutdown {
            response: response_tx,
        })
        .map_err(|_| "Pub/Sub session is no longer available".to_string())?;

    let _ = response_rx.await;

    Ok(())
}

#[tauri::command]
pub async fn publish_redis_pubsub_message(input: RedisPubSubPublishInput) -> Result<i64, String> {
    let channel = input.channel.trim();

    if channel.is_empty() {
        return Err("Channel cannot be empty".to_string());
    }

    let mut connection = open_pubsub_command_connection(&input.connection).await?;

    redis::cmd("PUBLISH")
        .arg(channel)
        .arg(input.payload)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to publish message: {error}"))
}
