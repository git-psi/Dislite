//! Connexion à un serveur vocal Discord (gateway vocale v8 + UDP), comme le client officiel :
//! identification, découverte d'IP, choix du chiffrement, puis émission et réception de
//! l'audio Opus. DAVE (chiffrement de bout en bout) est géré avec `davey`, qui suit libdave.
//!
//! Tout tourne dans une seule tâche (un `select!`) : pas de verrou entre la gateway, le
//! codeur et le décodeur, et rien d'actif hors appel.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::num::NonZeroU16;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use davey::{DaveSession, MediaType, ProposalsOperationType, OPUS_SILENCE_PACKET};
use futures_util::{SinkExt, StreamExt};
use nnnoiseless::DenoiseState;
use opus::{Application, Bitrate, Channels, Decoder, Encoder};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::watch;
use tokio::time::{interval, timeout, Instant, MissedTickBehavior};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use super::audio::FRAME;
use super::rtp::{self, Cipher, Sender};
use super::Shared;

pub const EVENT: &str = "voice:event";

/// Version maximale de DAVE prise en charge.
const DAVE_VERSION: u16 = 1;
/// Trames de silence envoyées en fin de parole (évite les artefacts chez les autres).
const SILENCE_FRAMES: usize = 5;
/// Prolongation de la parole après le dernier son au-dessus du seuil (15 × 20 ms).
const HANGOVER_FRAMES: u32 = 15;
const RECONNECT_ATTEMPTS: u32 = 5;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    pub server_id: String,
    pub channel_id: String,
    pub user_id: String,
    pub session_id: String,
    pub token: String,
    pub endpoint: String,
    pub self_mute: bool,
    pub self_deaf: bool,
}

pub fn emit_status(app: &AppHandle, status: &str, message: Option<&str>) {
    let _ = app.emit(EVENT, json!({ "type": "status", "status": status, "message": message }));
}

fn emit_speaking(app: &AppHandle, user_id: u64, speaking: bool) {
    let _ = app.emit(EVENT, json!({ "type": "speaking", "userId": user_id.to_string(), "speaking": speaking }));
}

/// Fin d'une session vocale.
enum End {
    /// déconnexion demandée
    Shutdown,
    /// définitive (expulsé, session invalide…), avec un message éventuel pour l'utilisateur
    Fatal(Option<String>),
    /// coupure : on peut retenter
    Retry(String),
}

/// Boucle principale : une session, et des tentatives de reconnexion en cas de coupure.
pub async fn run(
    app: AppHandle,
    params: ConnectParams,
    shared: Arc<Shared>,
    mut capture: UnboundedReceiver<Vec<f32>>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut attempt = 0;
    loop {
        emit_status(&app, if attempt == 0 { "connecting" } else { "reconnecting" }, None);
        let mut session = Session::new(&app, &params, &shared);
        match session.run(&mut capture, &mut shutdown).await {
            End::Shutdown => return,
            End::Fatal(message) => {
                emit_status(&app, "disconnected", message.as_deref());
                return;
            }
            End::Retry(reason) => {
                attempt = if session.was_connected { 1 } else { attempt + 1 };
                log::warn!("vocal : coupure ({reason}), tentative {attempt}");
                if attempt > RECONNECT_ATTEMPTS {
                    emit_status(&app, "disconnected", Some("Couldn't reach the voice server."));
                    return;
                }
                let wait = Duration::from_secs((attempt as u64).min(5));
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = shutdown.changed() => return,
                }
            }
        }
    }
}

/// État DAVE de la session.
struct Dave {
    session: Option<DaveSession>,
    /// version du protocole en vigueur (0 = pas de chiffrement de bout en bout)
    protocol: u16,
    /// versions annoncées par transition, appliquées à leur exécution
    pending: HashMap<u16, u16>,
    /// clé de l'expéditeur externe reçue avant la création de la session
    external_sender: Option<Vec<u8>>,
    /// personnes connectées (seules acceptées dans le groupe MLS), nous compris
    recognized: HashSet<u64>,
}

struct Session<'a> {
    app: &'a AppHandle,
    params: &'a ConnectParams,
    shared: &'a Shared,
    user_id: u64,
    channel_id: u64,
    seq_ack: i64,
    dave: Dave,
    ssrc_users: HashMap<u32, u64>,
    decoders: HashMap<u32, Decoder>,
    was_connected: bool,
}

/// Messages à envoyer sur la gateway vocale.
enum Out {
    Json(Value),
    Binary(Vec<u8>),
}

impl<'a> Session<'a> {
    fn new(app: &'a AppHandle, params: &'a ConnectParams, shared: &'a Shared) -> Self {
        let user_id = params.user_id.parse().unwrap_or(0);
        Self {
            app,
            params,
            shared,
            user_id,
            channel_id: params.channel_id.parse().unwrap_or(0),
            seq_ack: -1,
            dave: Dave {
                session: None,
                protocol: 0,
                pending: HashMap::new(),
                external_sender: None,
                recognized: HashSet::from([user_id]),
            },
            ssrc_users: HashMap::new(),
            decoders: HashMap::new(),
            was_connected: false,
        }
    }

    async fn run(&mut self, capture: &mut UnboundedReceiver<Vec<f32>>, shutdown: &mut watch::Receiver<bool>) -> End {
        // ---------------------------------------------------------------- gateway vocale
        let host = self.params.endpoint.trim_start_matches("wss://").trim_end_matches('/');
        let url = format!("wss://{host}/?v=8");
        let mut request = match url.into_client_request() {
            Ok(r) => r,
            Err(e) => return End::Fatal(Some(e.to_string())),
        };
        request.headers_mut().insert("Origin", HeaderValue::from_static("https://discord.com"));
        if let Ok(ua) = HeaderValue::from_str(&self.shared.user_agent) {
            request.headers_mut().insert("User-Agent", ua);
        }
        let ws = match timeout(Duration::from_secs(10), tokio_tungstenite::connect_async(request)).await {
            Ok(Ok((ws, _))) => ws,
            Ok(Err(e)) => return End::Retry(e.to_string()),
            Err(_) => return End::Retry("timeout".into()),
        };
        let (mut sink, mut stream) = ws.split();
        let mut outbox: Vec<Out> = vec![Out::Json(json!({
            "op": 0,
            "d": {
                "server_id": self.params.server_id,
                "user_id": self.params.user_id,
                "session_id": self.params.session_id,
                "token": self.params.token,
                "max_dave_protocol_version": DAVE_VERSION,
            }
        }))];

        // Rythme réel donné par le Hello ; d'ici là, aucun battement.
        let mut heartbeat = interval(Duration::from_secs(3600));
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        heartbeat.reset();
        let mut speaking_tick = interval(Duration::from_millis(100));
        let mut keepalive = interval(Duration::from_secs(5));

        // ---------------------------------------------------------------- transport
        let mut udp: Option<Arc<UdpSocket>> = None;
        let mut ssrc = 0u32;
        let mut cipher: Option<Cipher> = None;
        let mut sender: Option<Sender> = None;
        let mut encoder = match Encoder::new(48_000, Channels::Stereo, Application::Voip) {
            Ok(mut e) => {
                let _ = e.set_bitrate(Bitrate::Bits(64_000));
                e
            }
            Err(e) => return End::Fatal(Some(format!("Opus: {e}"))),
        };

        // ---------------------------------------------------------------- parole
        let mut pending_pcm: Vec<f32> = Vec::with_capacity(FRAME * 4);
        let mut speaking = false;
        let mut hangover = 0u32;
        let mut silence_left = 0usize;
        let mut last_voice: HashMap<u64, Instant> = HashMap::new();
        let mut speaking_users: HashSet<u64> = HashSet::new();
        let mut keepalive_counter = 0u32;
        let mut denoise: Option<Box<DenoiseState<'static>>> = None;
        let mut meter_frames = 0u32;
        let mut udp_buf = vec![0u8; 2048];
        let mut pcm_out = vec![0f32; 5760 * 2];

        loop {
            // Envoi de ce qui attend (identification, réponses DAVE, parole…).
            for msg in outbox.drain(..) {
                let res = match msg {
                    Out::Json(v) => sink.send(Message::Text(v.to_string().into())).await,
                    Out::Binary(b) => sink.send(Message::Binary(b.into())).await,
                };
                if let Err(e) = res {
                    return End::Retry(e.to_string());
                }
            }

            let udp_ref = udp.clone();
            tokio::select! {
                _ = shutdown.changed() => {
                    let _ = sink.close().await;
                    return End::Shutdown;
                }

                msg = stream.next() => {
                    let msg = match msg {
                        Some(Ok(m)) => m,
                        Some(Err(e)) => return End::Retry(e.to_string()),
                        None => return End::Retry("closed".into()),
                    };
                    match msg {
                        Message::Text(text) => {
                            let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                            if let Some(s) = v.get("seq").and_then(Value::as_i64) {
                                self.seq_ack = s;
                            }
                            let op = v["op"].as_u64().unwrap_or(u64::MAX);
                            let d = &v["d"];
                            match op {
                                // Hello : rythme des battements.
                                8 => {
                                    let ms = d["heartbeat_interval"].as_f64().unwrap_or(13_750.0);
                                    heartbeat = interval(Duration::from_millis(ms as u64));
                                    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
                                }
                                // Ready : SSRC et adresse UDP du serveur, modes de chiffrement.
                                2 => {
                                    ssrc = d["ssrc"].as_u64().unwrap_or(0) as u32;
                                    let ip = d["ip"].as_str().unwrap_or_default();
                                    let port = d["port"].as_u64().unwrap_or(0) as u16;
                                    let modes: Vec<&str> = d["modes"].as_array().map(|m| m.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                                    let Some(mode) = Cipher::MODES.iter().find(|m| modes.contains(m)) else {
                                        return End::Fatal(Some("No supported encryption mode.".into()));
                                    };
                                    let (socket, address, ext_port) = match discover(ip, port, ssrc).await {
                                        Ok(r) => r,
                                        Err(e) => return End::Retry(e),
                                    };
                                    udp = Some(Arc::new(socket));
                                    outbox.push(Out::Json(json!({
                                        "op": 1,
                                        "d": { "protocol": "udp", "data": { "address": address, "port": ext_port, "mode": mode } }
                                    })));
                                }
                                // Session description : clé du transport, version de DAVE.
                                4 => {
                                    let mode = d["mode"].as_str().unwrap_or_default();
                                    let key: Vec<u8> = d["secret_key"].as_array().map(|k| k.iter().filter_map(|b| b.as_u64().map(|b| b as u8)).collect()).unwrap_or_default();
                                    cipher = Cipher::new(mode, &key);
                                    if cipher.is_none() {
                                        return End::Fatal(Some("Unexpected voice encryption.".into()));
                                    }
                                    sender = Some(Sender::new(ssrc));
                                    let version = d["dave_protocol_version"].as_u64().unwrap_or(0) as u16;
                                    self.dave.protocol = version;
                                    if version > 0 {
                                        self.dave_reinit(&mut outbox);
                                    }
                                    self.was_connected = true;
                                    emit_status(self.app, "connected", None);
                                }
                                // Quelqu'un parle : correspondance SSRC -> personne.
                                5 => {
                                    if let (Some(uid), Some(s)) = (d["user_id"].as_str().and_then(|u| u.parse().ok()), d["ssrc"].as_u64()) {
                                        self.ssrc_users.insert(s as u32, uid);
                                        self.dave.recognized.insert(uid);
                                    }
                                }
                                // Personnes connectées / partie.
                                11 => {
                                    for uid in d["user_ids"].as_array().into_iter().flatten().filter_map(|u| u.as_str()?.parse().ok()) {
                                        self.dave.recognized.insert(uid);
                                    }
                                }
                                13 => {
                                    if let Some(uid) = d["user_id"].as_str().and_then(|u| u.parse::<u64>().ok()) {
                                        self.dave.recognized.remove(&uid);
                                        let gone: Vec<u32> = self.ssrc_users.iter().filter(|(_, u)| **u == uid).map(|(s, _)| *s).collect();
                                        for s in gone {
                                            self.ssrc_users.remove(&s);
                                            self.decoders.remove(&s);
                                            if let Ok(mut m) = self.shared.mixer.lock() {
                                                m.remove(s);
                                            }
                                        }
                                        if speaking_users.remove(&uid) {
                                            emit_speaking(self.app, uid, false);
                                        }
                                    }
                                }
                                // DAVE : préparer / exécuter une transition, nouvelle époque.
                                21 => {
                                    let tid = d["transition_id"].as_u64().unwrap_or(0) as u16;
                                    let version = d["protocol_version"].as_u64().unwrap_or(0) as u16;
                                    self.prepare_transition(tid, version, &mut outbox);
                                }
                                22 => {
                                    let tid = d["transition_id"].as_u64().unwrap_or(0) as u16;
                                    self.execute_transition(tid);
                                }
                                24 => {
                                    let epoch = d["epoch"].as_u64().unwrap_or(0);
                                    let version = d["protocol_version"].as_u64().unwrap_or(0) as u16;
                                    if epoch == 1 {
                                        self.dave.protocol = version;
                                        self.dave_reinit(&mut outbox);
                                    }
                                }
                                _ => {}
                            }
                        }
                        Message::Binary(bytes) => {
                            // Serveur -> client : séquence (u16), opcode (u8), charge.
                            if bytes.len() < 3 {
                                continue;
                            }
                            self.seq_ack = u16::from_be_bytes([bytes[0], bytes[1]]) as i64;
                            self.handle_dave_binary(bytes[2], &bytes[3..], &mut outbox);
                        }
                        Message::Close(frame) => {
                            let code = frame.as_ref().map(|f| u16::from(f.code)).unwrap_or(0);
                            log::warn!("vocal : connexion fermée par le serveur ({code})");
                            return match code {
                                // Déconnecté (expulsé, salon supprimé, déplacé) : la gateway principale prévient l'interface.
                                // 4014 : déconnecté (expulsé, ou session remplacée par une connexion plus récente).
                                // On retente : si c'était un vrai départ, la gateway principale le signale à l'interface.
                                4004 | 4006 | 4021 | 4022 => End::Fatal(Some("The voice session ended.".into())),
                                _ => End::Retry(format!("closed ({code})")),
                            };
                        }
                        _ => {}
                    }
                }

                _ = heartbeat.tick() => {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                    outbox.push(Out::Json(json!({ "op": 3, "d": { "t": now, "seq_ack": self.seq_ack } })));
                }

                // Micro : trames de 20 ms -> détection de la voix -> Opus -> DAVE -> transport.
                chunk = capture.recv() => {
                    let Some(chunk) = chunk else { return End::Fatal(Some("Audio stopped.".into())) };
                    let (Some(socket), Some(c), Some(tx)) = (udp_ref.as_ref(), cipher.as_ref(), sender.as_mut()) else { continue };
                    pending_pcm.extend_from_slice(&chunk);
                    while pending_pcm.len() >= FRAME {
                        let gain = self.shared.input_gain();
                        let mut frame: Vec<f32> = pending_pcm.drain(..FRAME).map(|s| s * gain).collect();
                        // Suppression de bruit : deux blocs RNNoise de 10 ms (échelle 16 bits).
                        if self.shared.noise_suppression.load(Ordering::Relaxed) {
                            let state = denoise.get_or_insert_with(DenoiseState::new);
                            let mut out = [0f32; DenoiseState::FRAME_SIZE];
                            for half in frame.chunks_mut(DenoiseState::FRAME_SIZE) {
                                let input: Vec<f32> = half.iter().map(|s| s * 32767.0).collect();
                                state.process_frame(&mut out, &input);
                                for (dst, src) in half.iter_mut().zip(out.iter()) {
                                    *dst = (src / 32767.0).clamp(-1.0, 1.0);
                                }
                            }
                        }
                        let db = level_db(&frame);
                        if self.shared.meter.load(Ordering::Relaxed) {
                            meter_frames += 1;
                            if meter_frames % 3 == 0 {
                                let _ = self.app.emit(EVENT, json!({ "type": "level", "db": db }));
                            }
                        }
                        let muted = self.shared.muted.load(Ordering::Relaxed);
                        // Appui-pour-parler : la touche remplace la détection de la voix.
                        let loud = !muted
                            && if self.shared.push_to_talk.load(Ordering::Relaxed) {
                                self.shared.talking.load(Ordering::Relaxed)
                            } else {
                                db > self.shared.sensitivity()
                            };
                        if loud {
                            hangover = HANGOVER_FRAMES;
                        } else {
                            hangover = hangover.saturating_sub(1);
                        }
                        let active = !muted && hangover > 0;
                        if active && !speaking {
                            speaking = true;
                            silence_left = 0;
                            // Annoncé avant la première trame, sinon le serveur peut l'ignorer.
                            let op = json!({ "op": 5, "d": { "speaking": 1, "delay": 0, "ssrc": ssrc } });
                            if let Err(e) = sink.send(Message::Text(op.to_string().into())).await {
                                return End::Retry(e.to_string());
                            }
                            emit_speaking(self.app, self.user_id, true);
                        }
                        if !active && speaking {
                            speaking = false;
                            silence_left = SILENCE_FRAMES;
                            emit_speaking(self.app, self.user_id, false);
                        }
                        let packet: Option<Vec<u8>> = if active {
                            let mut stereo = Vec::with_capacity(FRAME * 2);
                            for s in &frame {
                                stereo.push(*s);
                                stereo.push(*s);
                            }
                            let mut out = vec![0u8; 1275];
                            match encoder.encode_float(&stereo, &mut out) {
                                Ok(n) => {
                                    out.truncate(n);
                                    Some(out)
                                }
                                Err(_) => None,
                            }
                        } else if silence_left > 0 {
                            silence_left -= 1;
                            if silence_left == 0 {
                                outbox.push(Out::Json(json!({ "op": 5, "d": { "speaking": 0, "delay": 0, "ssrc": ssrc } })));
                            }
                            Some(OPUS_SILENCE_PACKET.to_vec())
                        } else {
                            None
                        };
                        if let Some(opus) = packet {
                            let frame = self.dave_encrypt(&opus);
                            if let Some(rtp) = tx.packet(c, &frame, FRAME as u32) {
                                let _ = socket.send(&rtp).await;
                            }
                        }
                    }
                }

                // Voix reçues : transport -> DAVE -> Opus -> mélangeur.
                res = async { udp_ref.as_ref().unwrap().recv(&mut udp_buf).await }, if udp_ref.is_some() && cipher.is_some() => {
                    let Ok(n) = res else { continue };
                    let Some(c) = cipher.as_ref() else { continue };
                    let Some(packet) = rtp::open(c, &udp_buf[..n]) else { continue };
                    let Some(&uid) = self.ssrc_users.get(&packet.ssrc) else { continue };
                    let Some(opus) = self.dave_decrypt(uid, &packet.payload) else { continue };
                    if opus == OPUS_SILENCE_PACKET {
                        continue;
                    }
                    last_voice.insert(uid, Instant::now());
                    if self.shared.deaf.load(Ordering::Relaxed) {
                        continue;
                    }
                    let decoder = match self.decoders.entry(packet.ssrc) {
                        std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                        std::collections::hash_map::Entry::Vacant(e) => match Decoder::new(48_000, Channels::Stereo) {
                            Ok(d) => e.insert(d),
                            Err(_) => continue,
                        },
                    };
                    let _ = packet.sequence;
                    if let Ok(samples) = decoder.decode_float(&opus, &mut pcm_out, false) {
                        let gain = self.shared.volume(uid);
                        if let Ok(mut m) = self.shared.mixer.lock() {
                            m.push(packet.ssrc, gain, &pcm_out[..samples * 2]);
                        }
                    }
                }

                // Qui parle (côté réception) : actif dans les 300 dernières ms.
                _ = speaking_tick.tick() => {
                    let now = Instant::now();
                    for (uid, at) in &last_voice {
                        let active = now.duration_since(*at) < Duration::from_millis(300);
                        if active && speaking_users.insert(*uid) {
                            emit_speaking(self.app, *uid, true);
                        } else if !active && speaking_users.remove(uid) {
                            emit_speaking(self.app, *uid, false);
                        }
                    }
                }

                // Garde la liaison UDP ouverte quand personne ne parle (NAT).
                _ = keepalive.tick(), if udp_ref.is_some() => {
                    keepalive_counter = keepalive_counter.wrapping_add(1);
                    let mut ka = [0u8; 8];
                    ka[..4].copy_from_slice(&keepalive_counter.to_le_bytes());
                    let _ = udp_ref.as_ref().unwrap().send(&ka).await;
                }
            }
        }
    }

    // ---------------------------------------------------------------- DAVE

    /// Nouvelle session MLS (début, nouvelle époque, ou après une erreur) : on renvoie
    /// notre paquet de clés (opcode 26).
    fn dave_reinit(&mut self, outbox: &mut Vec<Out>) {
        let Some(version) = NonZeroU16::new(self.dave.protocol) else { return };
        let session = match self.dave.session.as_mut() {
            Some(s) => s.reinit(version, self.user_id, self.channel_id, None).map_err(|e| e.to_string()),
            None => DaveSession::new(version, self.user_id, self.channel_id, None)
                .map(|s| self.dave.session = Some(s))
                .map_err(|e| e.to_string()),
        };
        if let Err(e) = session {
            log::warn!("DAVE : initialisation impossible : {e}");
            return;
        }
        let session = self.dave.session.as_mut().unwrap();
        if let Some(ext) = self.dave.external_sender.take() {
            if let Err(e) = session.set_external_sender(&ext) {
                log::warn!("DAVE : expéditeur externe refusé : {e}");
            }
        }
        match session.create_key_package() {
            Ok(kp) => outbox.push(binary(26, &kp)),
            Err(e) => log::warn!("DAVE : paquet de clés impossible : {e}"),
        }
    }

    fn recognized(&self) -> Vec<u64> {
        self.dave.recognized.iter().copied().collect()
    }

    fn handle_dave_binary(&mut self, op: u8, payload: &[u8], outbox: &mut Vec<Out>) {
        match op {
            // Expéditeur externe (le serveur vocal, qui propose les ajouts/retraits).
            25 => match self.dave.session.as_mut() {
                Some(s) => {
                    if let Err(e) = s.set_external_sender(payload) {
                        log::warn!("DAVE : expéditeur externe refusé : {e}");
                    }
                }
                None => self.dave.external_sender = Some(payload.to_vec()),
            },
            // Propositions : ajouts / retraits de membres -> commit (+ welcome).
            27 => {
                let Some(kind) = payload.first() else { return };
                let kind = if *kind == 1 { ProposalsOperationType::REVOKE } else { ProposalsOperationType::APPEND };
                let recognized = self.recognized();
                let Some(s) = self.dave.session.as_mut() else { return };
                match s.process_proposals(kind, &payload[1..], Some(&recognized)) {
                    Ok(Some(cw)) => {
                        let mut data = cw.commit;
                        if let Some(w) = cw.welcome {
                            data.extend_from_slice(&w);
                        }
                        outbox.push(binary(28, &data));
                    }
                    Ok(None) => {}
                    Err(e) => log::warn!("DAVE : propositions refusées : {e}"),
                }
            }
            // Commit annoncé : nouvelles clés à la prochaine transition.
            29 => {
                if payload.len() < 2 {
                    return;
                }
                let tid = u16::from_be_bytes([payload[0], payload[1]]);
                let Some(s) = self.dave.session.as_mut() else { return };
                match s.process_commit(&payload[2..]) {
                    Ok(true) => {
                        let version = self.dave.protocol;
                        self.prepare_transition(tid, version, outbox);
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::warn!("DAVE : commit invalide : {e}");
                        self.recover(tid, outbox);
                    }
                }
            }
            // Bienvenue dans le groupe (on rejoint un appel déjà chiffré).
            30 => {
                if payload.len() < 2 {
                    return;
                }
                let tid = u16::from_be_bytes([payload[0], payload[1]]);
                let recognized = self.recognized();
                let Some(s) = self.dave.session.as_mut() else { return };
                match s.process_welcome(&payload[2..], Some(&recognized)) {
                    Ok(()) => {
                        let version = self.dave.protocol;
                        self.prepare_transition(tid, version, outbox);
                    }
                    Err(e) => {
                        log::warn!("DAVE : bienvenue invalide : {e}");
                        self.recover(tid, outbox);
                    }
                }
            }
            _ => {}
        }
    }

    fn prepare_transition(&mut self, tid: u16, version: u16, outbox: &mut Vec<Out>) {
        if let Some(s) = self.dave.session.as_mut() {
            if let Err(e) = s.prepare_transition(tid, version) {
                log::warn!("DAVE : transition {tid} impossible : {e}");
            }
        }
        if tid == 0 {
            self.dave.protocol = version;
        } else {
            self.dave.pending.insert(tid, version);
            outbox.push(Out::Json(json!({ "op": 23, "d": { "transition_id": tid } })));
        }
    }

    fn execute_transition(&mut self, tid: u16) {
        if let Some(s) = self.dave.session.as_mut() {
            if let Err(e) = s.execute_transition(tid) {
                log::warn!("DAVE : exécution de la transition {tid} impossible : {e}");
            }
        }
        if let Some(version) = self.dave.pending.remove(&tid) {
            self.dave.protocol = version;
        }
    }

    /// Commit ou bienvenue illisible : on le signale (opcode 31) et on repart d'un groupe neuf.
    fn recover(&mut self, tid: u16, outbox: &mut Vec<Out>) {
        outbox.push(Out::Json(json!({ "op": 31, "d": { "transition_id": tid } })));
        self.dave_reinit(outbox);
    }

    fn dave_encrypt(&mut self, opus: &[u8]) -> Vec<u8> {
        if self.dave.protocol == 0 {
            return opus.to_vec();
        }
        match self.dave.session.as_mut() {
            Some(s) if s.is_ready() => match s.encrypt_opus(opus) {
                Ok(frame) => frame.into_owned(),
                Err(e) => {
                    log::debug!("DAVE : chiffrement impossible : {e}");
                    opus.to_vec()
                }
            },
            _ => opus.to_vec(),
        }
    }

    fn dave_decrypt(&mut self, user_id: u64, payload: &[u8]) -> Option<Vec<u8>> {
        let protocol = self.dave.protocol;
        match self.dave.session.as_mut() {
            Some(s) if s.is_ready() && (protocol != 0 || s.can_passthrough(user_id)) => {
                match s.decrypt(user_id, MediaType::AUDIO, payload) {
                    Ok(frame) => Some(frame),
                    Err(e) => {
                        log::debug!("DAVE : déchiffrement impossible ({user_id}) : {e}");
                        None
                    }
                }
            }
            _ => Some(payload.to_vec()),
        }
    }
}

/// Client -> serveur : opcode (u8) puis charge.
fn binary(op: u8, payload: &[u8]) -> Out {
    let mut data = Vec::with_capacity(payload.len() + 1);
    data.push(op);
    data.extend_from_slice(payload);
    Out::Binary(data)
}

/// Niveau d'une trame en dBFS (RMS).
fn level_db(frame: &[f32]) -> f32 {
    let energy = frame.iter().map(|s| s * s).sum::<f32>() / frame.len().max(1) as f32;
    10.0 * energy.max(1e-10).log10()
}

/// Découverte d'IP : le serveur nous renvoie l'adresse et le port vus de l'extérieur.
async fn discover(ip: &str, port: u16, ssrc: u32) -> Result<(UdpSocket, String, u16), String> {
    let addr: SocketAddr = format!("{ip}:{port}").parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    let socket = UdpSocket::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
    socket.connect(addr).await.map_err(|e| e.to_string())?;
    let mut req = [0u8; 74];
    req[0..2].copy_from_slice(&1u16.to_be_bytes());
    req[2..4].copy_from_slice(&70u16.to_be_bytes());
    req[4..8].copy_from_slice(&ssrc.to_be_bytes());
    let mut buf = [0u8; 74];
    for _ in 0..3 {
        socket.send(&req).await.map_err(|e| e.to_string())?;
        if let Ok(Ok(n)) = timeout(Duration::from_secs(2), socket.recv(&mut buf)).await {
            if n >= 74 && u16::from_be_bytes([buf[0], buf[1]]) == 2 {
                let end = buf[8..72].iter().position(|b| *b == 0).map(|p| 8 + p).unwrap_or(72);
                let address = String::from_utf8_lossy(&buf[8..end]).to_string();
                let ext_port = u16::from_be_bytes([buf[72], buf[73]]);
                return Ok((socket, address, ext_port));
            }
        }
    }
    Err("IP discovery failed".into())
}
