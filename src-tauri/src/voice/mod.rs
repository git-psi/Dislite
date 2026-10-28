//! Vocal natif : salons vocaux et appels. Une connexion à la fois, rien d'actif hors appel.

mod audio;
mod conn;
mod rtp;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tokio::sync::{mpsc, watch};

use crate::error::{Error, Result};
use crate::state::AppState;

pub use conn::ConnectParams;

/// Réglages audio venant de l'interface.
#[derive(Deserialize, Clone, Default)]
pub struct VoiceConfig {
    pub input: Option<String>,
    pub output: Option<String>,
    /// seuil de détection de la voix (dBFS)
    pub sensitivity: f32,
    /// appui-pour-parler (sinon détection de la voix)
    #[serde(default)]
    pub push_to_talk: bool,
    /// gain du micro (1 = inchangé) et volume général de sortie
    #[serde(default = "one")]
    pub input_gain: f32,
    #[serde(default = "one")]
    pub output_volume: f32,
    /// suppression de bruit (RNNoise)
    #[serde(default)]
    pub noise_suppression: bool,
}

fn one() -> f32 {
    1.0
}

/// Partagé entre l'interface (commandes) et la connexion en cours.
pub struct Shared {
    pub muted: AtomicBool,
    pub push_to_talk: AtomicBool,
    pub noise_suppression: AtomicBool,
    /// niveau du micro envoyé à l'interface (test pendant un appel)
    pub meter: AtomicBool,
    input_gain: AtomicU32,
    output_volume: AtomicU32,
    /// touche d'appui-pour-parler enfoncée
    pub talking: AtomicBool,
    pub deaf: AtomicBool,
    sensitivity: AtomicU32,
    volumes: Mutex<HashMap<u64, f32>>,
    pub mixer: Arc<Mutex<audio::Mixer>>,
    pub user_agent: String,
}

impl Shared {
    pub fn sensitivity(&self) -> f32 {
        f32::from_bits(self.sensitivity.load(Ordering::Relaxed))
    }

    pub fn volume(&self, user_id: u64) -> f32 {
        let user = self.volumes.lock().map(|v| v.get(&user_id).copied().unwrap_or(1.0)).unwrap_or(1.0);
        user * f32::from_bits(self.output_volume.load(Ordering::Relaxed))
    }

    pub fn input_gain(&self) -> f32 {
        f32::from_bits(self.input_gain.load(Ordering::Relaxed))
    }

    fn apply(&self, config: &VoiceConfig) {
        self.sensitivity.store(config.sensitivity.to_bits(), Ordering::Relaxed);
        self.push_to_talk.store(config.push_to_talk, Ordering::Relaxed);
        self.noise_suppression.store(config.noise_suppression, Ordering::Relaxed);
        self.input_gain.store(config.input_gain.clamp(0.0, 4.0).to_bits(), Ordering::Relaxed);
        self.output_volume.store(config.output_volume.clamp(0.0, 2.0).to_bits(), Ordering::Relaxed);
    }
}

struct Connection {
    shutdown: watch::Sender<bool>,
    shared: Arc<Shared>,
    /// pour rouvrir l'audio (changement de périphérique) sans couper l'appel
    capture: mpsc::UnboundedSender<Vec<f32>>,
    audio: Option<audio::AudioIo>,
}

/// Test du micro (hors appel) : le niveau est renvoyé à l'interface.
struct MicTest {
    _audio: audio::AudioIo,
    stop: watch::Sender<bool>,
}

#[derive(Default)]
pub struct Voice {
    current: Mutex<Option<Connection>>,
    test: Mutex<Option<MicTest>>,
    config: Mutex<VoiceConfig>,
    volumes: Mutex<HashMap<u64, f32>>,
}

impl Voice {
    fn stop_test(&self) {
        if let Some(t) = self.test.lock().unwrap().take() {
            let _ = t.stop.send(true);
        }
    }

    fn stop(&self) {
        if let Some(conn) = self.current.lock().unwrap().take() {
            let _ = conn.shutdown.send(true);
            drop(conn.audio);
        }
    }

    fn open_audio(&self, conn: &Connection) -> std::result::Result<audio::AudioIo, String> {
        let config = self.config.lock().unwrap().clone();
        audio::start(audio::AudioSetup {
            input: config.input,
            output: config.output,
            mixer: conn.shared.mixer.clone(),
            capture: conn.capture.clone(),
        })
    }
}

#[tauri::command]
pub fn voice_connect(app: AppHandle, state: State<'_, AppState>, params: ConnectParams) -> Result<()> {
    let voice = &state.voice;
    voice.stop();
    voice.stop_test();
    let config = voice.config.lock().unwrap().clone();
    let mut mixer = audio::Mixer::default();
    mixer.deaf = params.self_deaf;
    let mixer = Arc::new(Mutex::new(mixer));
    let shared = Arc::new(Shared {
        muted: AtomicBool::new(params.self_mute || params.self_deaf),
        push_to_talk: AtomicBool::new(false),
        talking: AtomicBool::new(false),
        noise_suppression: AtomicBool::new(false),
        meter: AtomicBool::new(false),
        input_gain: AtomicU32::new(1f32.to_bits()),
        output_volume: AtomicU32::new(1f32.to_bits()),
        deaf: AtomicBool::new(params.self_deaf),
        sensitivity: AtomicU32::new(config.sensitivity.to_bits()),
        volumes: Mutex::new(voice.volumes.lock().unwrap().clone()),
        mixer,
        user_agent: state.identity().user_agent,
    });
    shared.apply(&config);
    let (capture_tx, capture_rx) = mpsc::unbounded_channel();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mut conn = Connection { shutdown: shutdown_tx, shared: shared.clone(), capture: capture_tx, audio: None };
    conn.audio = Some(voice.open_audio(&conn).map_err(|e| Error::other(format!("audio: {e}")))?);

    tauri::async_runtime::spawn(conn::run(app, params, shared, capture_rx, shutdown_rx));
    *voice.current.lock().unwrap() = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn voice_disconnect(state: State<'_, AppState>) {
    state.voice.stop();
}

#[tauri::command]
pub fn voice_set_mute(state: State<'_, AppState>, on: bool) {
    if let Some(conn) = state.voice.current.lock().unwrap().as_ref() {
        conn.shared.muted.store(on || conn.shared.deaf.load(Ordering::Relaxed), Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn voice_set_deaf(state: State<'_, AppState>, on: bool) {
    if let Some(conn) = state.voice.current.lock().unwrap().as_ref() {
        conn.shared.deaf.store(on, Ordering::Relaxed);
        if on {
            conn.shared.muted.store(true, Ordering::Relaxed);
        }
        if let Ok(mut m) = conn.shared.mixer.lock() {
            m.deaf = on;
            if on {
                m.clear();
            }
        }
    }
}

#[tauri::command]
pub async fn voice_devices() -> Value {
    // L'énumération ALSA peut prendre un instant : hors du thread principal.
    let devices = tauri::async_runtime::spawn_blocking(audio::devices).await;
    match devices {
        Ok(d) => json!({ "inputs": d.inputs, "outputs": d.outputs }),
        Err(_) => json!({ "inputs": [], "outputs": [] }),
    }
}

#[tauri::command]
pub fn voice_set_config(state: State<'_, AppState>, config: VoiceConfig) -> Result<()> {
    let voice = &state.voice;
    let devices_changed = {
        let mut current = voice.config.lock().unwrap();
        let changed = current.input != config.input || current.output != config.output;
        *current = config.clone();
        changed
    };
    let mut guard = voice.current.lock().unwrap();
    if let Some(conn) = guard.as_mut() {
        conn.shared.apply(&config);
        if devices_changed {
            // Nouveau périphérique : on ferme l'ancien avant d'ouvrir le nouveau.
            conn.audio = None;
            conn.audio = Some(voice.open_audio(conn).map_err(|e| Error::other(format!("audio: {e}")))?);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn voice_set_user_volume(state: State<'_, AppState>, user_id: String, volume: f32) {
    let Ok(id) = user_id.parse::<u64>() else { return };
    let volume = volume.clamp(0.0, 3.0);
    state.voice.volumes.lock().unwrap().insert(id, volume);
    if let Some(conn) = state.voice.current.lock().unwrap().as_ref() {
        conn.shared.volumes.lock().unwrap().insert(id, volume);
    }
}

/// Touche d'appui-pour-parler enfoncée / relâchée.
#[tauri::command]
pub fn voice_set_talking(state: State<'_, AppState>, on: bool) {
    if let Some(conn) = state.voice.current.lock().unwrap().as_ref() {
        conn.shared.talking.store(on, Ordering::Relaxed);
    }
}

/// Test du micro hors appel : émet `{ type: "level", db }` environ 20 fois par seconde.
#[tauri::command]
pub fn voice_mic_test(app: AppHandle, state: State<'_, AppState>, on: bool) -> Result<()> {
    let voice = &state.voice;
    voice.stop_test();
    // En appel : le micro est déjà ouvert, la connexion envoie le niveau.
    if let Some(conn) = voice.current.lock().unwrap().as_ref() {
        conn.shared.meter.store(on, Ordering::Relaxed);
        return Ok(());
    }
    if !on {
        return Ok(());
    }
    let config = voice.config.lock().unwrap().clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<f32>>();
    let audio = audio::start(audio::AudioSetup {
        input: config.input,
        output: config.output,
        mixer: Arc::new(Mutex::new(audio::Mixer::default())),
        capture: tx,
    })
    .map_err(|e| Error::other(format!("audio: {e}")))?;
    let (stop_tx, mut stop_rx) = watch::channel(false);
    tauri::async_runtime::spawn(async move {
        let mut acc: Vec<f32> = Vec::new();
        loop {
            tokio::select! {
                _ = stop_rx.changed() => return,
                chunk = rx.recv() => {
                    let Some(chunk) = chunk else { return };
                    acc.extend(chunk.iter().map(|s| s * config.input_gain));
                    // ~50 ms par mesure
                    if acc.len() >= 2400 {
                        let energy = acc.iter().map(|s| s * s).sum::<f32>() / acc.len() as f32;
                        let db = 10.0 * energy.max(1e-10).log10();
                        let _ = tauri::Emitter::emit(&app, conn::EVENT, json!({ "type": "level", "db": db }));
                        acc.clear();
                    }
                }
            }
        }
    });
    *voice.test.lock().unwrap() = Some(MicTest { _audio: audio, stop: stop_tx });
    Ok(())
}
