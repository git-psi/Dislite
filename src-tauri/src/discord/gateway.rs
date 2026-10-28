//! Connexion temps réel à la gateway Discord.
//!
//! Le Rust gère le transport (zlib-stream, heartbeat, reprise de session,
//! reconnexion) et transmet chaque événement brut au frontend, qui maintient
//! l'état. Le JSON des événements n'est jamais re-parsé côté Rust (RawValue).

use std::io;
use std::time::Duration;

use flate2::{Decompress, FlushDecompress};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{sleep, sleep_until, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use super::identity::Identity;

const GATEWAY_URL: &str = "wss://gateway.discord.gg";
const GATEWAY_QUERY: &str = "/?encoding=json&v=9&compress=zlib-stream";

/// Capacités annoncées, identiques à celles d'un client web récent :
/// LAZY_USER_NOTES | NO_AFFINE_USER_IDS | VERSIONED_READ_STATES |
/// VERSIONED_USER_GUILD_SETTINGS | DEDUPE_USER_OBJECTS | USER_SETTINGS_PROTO |
/// CLIENT_STATE_V2
const CAPABILITIES: u64 = 1 | 1 << 1 | 1 << 2 | 1 << 3 | 1 << 4 | 1 << 9 | 1 << 10;

pub const EVENT_DISPATCH: &str = "gateway:dispatch";
pub const EVENT_STATUS: &str = "gateway:status";
pub const EVENT_FATAL: &str = "gateway:fatal";

enum Command {
    Send(String),
    Shutdown,
}

/// Poignée vers la tâche de connexion. La tâche s'arrête quand la poignée est abandonnée.
pub struct GatewayHandle {
    tx: mpsc::UnboundedSender<Command>,
}

impl GatewayHandle {
    pub fn spawn(app: AppHandle, identity: Identity, token: String) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        tauri::async_runtime::spawn(run(app, identity, token, rx));
        Self { tx }
    }

    pub fn send(&self, op: u8, d: Value) {
        let _ = self.tx.send(Command::Send(json!({ "op": op, "d": d }).to_string()));
    }
}

impl Drop for GatewayHandle {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Shutdown);
    }
}

#[derive(Deserialize)]
struct Frame<'a> {
    op: u8,
    #[serde(default)]
    s: Option<u64>,
    #[serde(default)]
    t: Option<&'a str>,
    #[serde(default, borrow)]
    d: Option<&'a RawValue>,
}

#[derive(Serialize, Clone)]
struct Dispatch<'a> {
    t: &'a str,
    d: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct Hello {
    heartbeat_interval: u64,
}

#[derive(Deserialize)]
struct ReadyInfo {
    session_id: String,
    resume_gateway_url: String,
}

struct Session {
    id: String,
    resume_url: String,
}

enum Exit {
    Shutdown,
    Reconnect { resume: bool, delay: Duration },
    Fatal { code: u16, reason: String },
}

impl Exit {
    fn resume() -> Self {
        Self::Reconnect {
            resume: true,
            delay: Duration::ZERO,
        }
    }
}

fn emit_status(app: &AppHandle, state: &str) {
    let _ = app.emit(EVENT_STATUS, json!({ "state": state }));
}

async fn run(app: AppHandle, identity: Identity, token: String, mut rx: mpsc::UnboundedReceiver<Command>) {
    let mut session: Option<Session> = None;
    let mut seq: Option<u64> = None;
    let mut failures: u32 = 0;

    loop {
        emit_status(&app, if session.is_some() { "resuming" } else { "connecting" });
        let base = session.as_ref().map_or(GATEWAY_URL, |s| s.resume_url.as_str());
        let url = format!("{}{GATEWAY_QUERY}", base.trim_end_matches('/'));

        let mut conn = Connection {
            app: &app,
            identity: &identity,
            token: &token,
            session: &mut session,
            seq: &mut seq,
            ready: false,
        };
        let exit = conn.run(&url, &mut rx).await;
        let was_ready = conn.ready;

        match exit {
            Exit::Shutdown => {
                emit_status(&app, "disconnected");
                return;
            }
            Exit::Fatal { code, reason } => {
                log::error!("gateway fermée définitivement ({code}) : {reason}");
                let _ = app.emit(EVENT_FATAL, json!({ "code": code, "reason": reason }));
                emit_status(&app, "disconnected");
                return;
            }
            Exit::Reconnect { resume, delay } => {
                if !resume {
                    session = None;
                    seq = None;
                }
                failures = if was_ready { 0 } else { failures + 1 };
                // Backoff exponentiel plafonné à 60 s, avec jitter.
                let backoff = Duration::from_millis(
                    (500u64 << failures.min(7)).min(60_000) + rand::thread_rng().gen_range(0..1000),
                );
                let wait = delay.max(if failures == 0 { Duration::from_millis(300) } else { backoff });
                log::info!("reconnexion à la gateway dans {wait:?} (reprise : {resume})");
                emit_status(&app, "reconnecting");

                tokio::select! {
                    _ = sleep(wait) => {}
                    cmd = rx.recv() => {
                        if matches!(cmd, None | Some(Command::Shutdown)) {
                            emit_status(&app, "disconnected");
                            return;
                        }
                    }
                }
            }
        }
    }
}

struct Connection<'a> {
    app: &'a AppHandle,
    identity: &'a Identity,
    token: &'a str,
    session: &'a mut Option<Session>,
    seq: &'a mut Option<u64>,
    ready: bool,
}

impl Connection<'_> {
    async fn run(&mut self, url: &str, rx: &mut mpsc::UnboundedReceiver<Command>) -> Exit {
        let mut request = match url.into_client_request() {
            Ok(r) => r,
            Err(e) => return Exit::Fatal { code: 0, reason: e.to_string() },
        };
        if let Ok(ua) = HeaderValue::from_str(&self.identity.user_agent) {
            request.headers_mut().insert("User-Agent", ua);
        }
        request
            .headers_mut()
            .insert("Origin", HeaderValue::from_static("https://discord.com"));

        let ws = match tokio_tungstenite::connect_async(request).await {
            Ok((ws, _)) => ws,
            Err(e) => {
                log::warn!("connexion gateway impossible : {e}");
                return Exit::resume();
            }
        };
        let (mut sink, mut stream) = ws.split();

        let mut inflater = Inflater::new();
        let mut interval: Option<Duration> = None;
        let mut next_beat = Instant::now() + Duration::from_secs(3600);
        let mut acked = true;

        loop {
            tokio::select! {
                msg = stream.next() => {
                    let msg = match msg {
                        Some(Ok(m)) => m,
                        Some(Err(e)) => {
                            log::warn!("erreur gateway : {e}");
                            return Exit::resume();
                        }
                        None => return Exit::resume(),
                    };
                    let text = match msg {
                        Message::Binary(bytes) => match inflater.push(&bytes) {
                            Ok(Some(text)) => text,
                            Ok(None) => continue,
                            Err(e) => {
                                log::warn!("décompression impossible : {e}");
                                return Exit::resume();
                            }
                        },
                        Message::Text(t) => t.to_string(),
                        Message::Close(frame) => return close_exit(frame),
                        _ => continue,
                    };

                    let frame: Frame = match serde_json::from_str(&text) {
                        Ok(f) => f,
                        Err(e) => {
                            log::warn!("trame gateway illisible : {e}");
                            continue;
                        }
                    };

                    match frame.op {
                        // Dispatch
                        0 => {
                            if frame.s.is_some() {
                                *self.seq = frame.s;
                            }
                            let t = frame.t.unwrap_or_default();
                            match t {
                                "READY" => {
                                    if let Some(info) = frame.d.and_then(|d| serde_json::from_str::<ReadyInfo>(d.get()).ok()) {
                                        *self.session = Some(Session { id: info.session_id, resume_url: info.resume_gateway_url });
                                    }
                                    self.ready = true;
                                    emit_status(self.app, "connected");
                                }
                                "RESUMED" => {
                                    self.ready = true;
                                    emit_status(self.app, "connected");
                                }
                                _ => {}
                            }
                            let _ = self.app.emit(EVENT_DISPATCH, Dispatch { t, d: frame.d });
                        }
                        // Heartbeat demandé par le serveur
                        1 => {
                            if sink.send(text_msg(self.heartbeat())).await.is_err() {
                                return Exit::resume();
                            }
                        }
                        // Reconnect
                        7 => return Exit::resume(),
                        // Invalid session
                        9 => {
                            let resumable = frame.d.is_some_and(|d| d.get() == "true");
                            let delay = Duration::from_millis(rand::thread_rng().gen_range(1000..5000));
                            return Exit::Reconnect { resume: resumable, delay };
                        }
                        // Hello
                        10 => {
                            let Some(hello) = frame.d.and_then(|d| serde_json::from_str::<Hello>(d.get()).ok()) else {
                                return Exit::resume();
                            };
                            let iv = Duration::from_millis(hello.heartbeat_interval);
                            interval = Some(iv);
                            next_beat = Instant::now() + iv.mul_f64(rand::thread_rng().gen_range(0.0..1.0));
                            acked = true;
                            if sink.send(text_msg(self.handshake())).await.is_err() {
                                return Exit::resume();
                            }
                        }
                        // Heartbeat ACK
                        11 => acked = true,
                        _ => {}
                    }
                }

                cmd = rx.recv() => match cmd {
                    Some(Command::Send(payload)) => {
                        if self.ready && sink.send(text_msg(payload)).await.is_err() {
                            return Exit::resume();
                        }
                    }
                    Some(Command::Shutdown) | None => {
                        let _ = sink.send(Message::Close(Some(CloseFrame {
                            code: CloseCode::Normal,
                            reason: "".into(),
                        }))).await;
                        return Exit::Shutdown;
                    }
                },

                _ = sleep_until(next_beat), if interval.is_some() => {
                    if !acked {
                        log::warn!("heartbeat sans réponse, connexion zombie");
                        return Exit::resume();
                    }
                    acked = false;
                    next_beat = Instant::now() + interval.unwrap_or_default();
                    if sink.send(text_msg(self.heartbeat())).await.is_err() {
                        return Exit::resume();
                    }
                }
            }
        }
    }

    fn heartbeat(&self) -> String {
        json!({ "op": 1, "d": *self.seq }).to_string()
    }

    /// IDENTIFY pour une nouvelle session, RESUME sinon.
    fn handshake(&self) -> String {
        match (self.session.as_ref(), *self.seq) {
            (Some(s), Some(seq)) => json!({
                "op": 6,
                "d": { "token": self.token, "session_id": s.id, "seq": seq }
            }),
            _ => json!({
                "op": 2,
                "d": {
                    "token": self.token,
                    "capabilities": CAPABILITIES,
                    "properties": self.identity.super_properties(),
                    "presence": { "status": "unknown", "since": 0, "activities": [], "afk": false },
                    "compress": false,
                    "client_state": { "guild_versions": {} }
                }
            }),
        }
        .to_string()
    }
}

fn text_msg(s: String) -> Message {
    Message::Text(s.into())
}

fn close_exit(frame: Option<CloseFrame>) -> Exit {
    let (code, reason) = frame
        .map(|f| (u16::from(f.code), f.reason.to_string()))
        .unwrap_or((1006, String::new()));
    log::info!("gateway fermée : {code} {reason}");
    match code {
        4004 => Exit::Fatal { code, reason: "token invalide".into() },
        4010..=4014 => Exit::Fatal { code, reason },
        // Session invalide côté serveur : nouvelle identification.
        1000 | 1001 | 4007 | 4009 => Exit::Reconnect { resume: false, delay: Duration::ZERO },
        _ => Exit::resume(),
    }
}

/// Décompresseur zlib partagé sur toute la durée de la connexion.
struct Inflater {
    z: Decompress,
    buf: Vec<u8>,
}

impl Inflater {
    fn new() -> Self {
        Self {
            z: Decompress::new(true),
            buf: Vec::new(),
        }
    }

    /// Accumule les fragments jusqu'au suffixe `00 00 FF FF` puis décompresse.
    fn push(&mut self, data: &[u8]) -> io::Result<Option<String>> {
        self.buf.extend_from_slice(data);
        if !self.buf.ends_with(&[0x00, 0x00, 0xff, 0xff]) {
            return Ok(None);
        }
        let input = std::mem::take(&mut self.buf);
        let mut out = Vec::with_capacity(input.len() * 4);
        let mut offset = 0usize;
        loop {
            if out.len() == out.capacity() {
                out.reserve(out.capacity().max(8192));
            }
            let (in_before, out_before) = (self.z.total_in(), self.z.total_out());
            self.z
                .decompress_vec(&input[offset..], &mut out, FlushDecompress::Sync)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            offset += (self.z.total_in() - in_before) as usize;
            let progressed = self.z.total_in() != in_before || self.z.total_out() != out_before;
            if (offset >= input.len() && out.len() < out.capacity()) || !progressed {
                break;
            }
        }
        String::from_utf8(out)
            .map(Some)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }
}
