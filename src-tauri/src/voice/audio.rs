//! Audio : capture du micro et lecture des voix, au format d'Opus (48 kHz).
//!
//! Les flux cpal ne sont pas `Send` : ils vivent dans un thread dédié, arrêté à la
//! déconnexion. La capture envoie de l'audio mono 48 kHz au codeur ; la lecture tire
//! du mélangeur, alimenté par les voix reçues.

use std::collections::{HashMap, VecDeque};
use std::sync::{mpsc, Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, StreamConfig};
use tokio::sync::mpsc::UnboundedSender;

pub const RATE: u32 = 48_000;
/// 20 ms à 48 kHz : la durée d'une trame Opus.
pub const FRAME: usize = 960;

/// Voix tamponnées avant de commencer à jouer (gigue réseau), et plafond (latence).
const START_FRAMES: usize = 2;
const MAX_FRAMES: usize = 6;
/// Taille de tampon demandée au périphérique (10 ms à 48 kHz).
const LOW_LATENCY_FRAMES: u32 = 480;

#[derive(Default)]
struct Source {
    /// échantillons stéréo entrelacés
    buf: VecDeque<f32>,
    playing: bool,
    gain: f32,
}

/// Mélange les voix reçues (une source par SSRC).
#[derive(Default)]
pub struct Mixer {
    sources: HashMap<u32, Source>,
    pub deaf: bool,
}

impl Mixer {
    pub fn push(&mut self, ssrc: u32, gain: f32, stereo: &[f32]) {
        if self.deaf {
            return;
        }
        let src = self.sources.entry(ssrc).or_insert_with(|| Source { gain, ..Default::default() });
        src.gain = gain;
        src.buf.extend(stereo.iter().copied());
        let max = MAX_FRAMES * FRAME * 2;
        if src.buf.len() > max {
            let extra = src.buf.len() - max;
            src.buf.drain(..extra);
        }
        if !src.playing && src.buf.len() >= START_FRAMES * FRAME * 2 {
            src.playing = true;
        }
    }

    pub fn remove(&mut self, ssrc: u32) {
        self.sources.remove(&ssrc);
    }

    pub fn clear(&mut self) {
        self.sources.clear();
    }

    /// Prochaine trame stéréo du mélange.
    fn next(&mut self) -> (f32, f32) {
        let (mut l, mut r) = (0.0f32, 0.0f32);
        for src in self.sources.values_mut() {
            if !src.playing {
                continue;
            }
            match (src.buf.pop_front(), src.buf.pop_front()) {
                (Some(a), Some(b)) => {
                    l += a * src.gain;
                    r += b * src.gain;
                }
                // Tampon vide : on attend d'en avoir assez avant de reprendre.
                _ => src.playing = false,
            }
        }
        (l.clamp(-1.0, 1.0), r.clamp(-1.0, 1.0))
    }
}

/// Rééchantillonnage linéaire en flux (suffisant pour la voix, sans dépendance).
struct Linear {
    ratio: f64,
    t: f64,
    prev: f32,
}

impl Linear {
    fn new(from: u32, to: u32) -> Self {
        Self { ratio: from as f64 / to as f64, t: 0.0, prev: 0.0 }
    }

    fn push(&mut self, cur: f32, out: &mut Vec<f32>) {
        while self.t <= 1.0 {
            out.push(self.prev + (cur - self.prev) * self.t as f32);
            self.t += self.ratio;
        }
        self.t -= 1.0;
        self.prev = cur;
    }
}

/// Périphérique proposé à l'utilisateur : identifiant (nœud PipeWire/Pulse, ou nom cpal)
/// et nom lisible.
#[derive(serde::Serialize, Clone)]
pub struct DeviceInfo {
    pub id: String,
    pub label: String,
}

pub struct Devices {
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
}

/// Vrais micros et sorties, via PipeWire (pactl) ; sans lui, liste ALSA brute.
#[cfg(target_os = "linux")]
pub fn devices() -> Devices {
    let list = |kind: &str| -> Option<Vec<DeviceInfo>> {
        let out = std::process::Command::new("pactl").args(["-f", "json", "list", kind]).output().ok()?;
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
        Some(
            v.as_array()?
                .iter()
                .filter_map(|d| {
                    let id = d["name"].as_str()?.to_string();
                    // Les « monitor » sont des sorties vues comme entrées : pas des micros.
                    if id.ends_with(".monitor") {
                        return None;
                    }
                    let label = d["description"].as_str().unwrap_or(&id).to_string();
                    Some(DeviceInfo { id, label })
                })
                .collect(),
        )
    };
    if let (Some(inputs), Some(outputs)) = (list("sources"), list("sinks")) {
        return Devices { inputs, outputs };
    }
    cpal_devices()
}

/// Ailleurs (WASAPI sous Windows), les noms cpal sont déjà les noms lisibles.
#[cfg(not(target_os = "linux"))]
pub fn devices() -> Devices {
    cpal_devices()
}

fn cpal_devices() -> Devices {
    let host = cpal::default_host();
    let names = |devs: Option<Vec<cpal::Device>>| -> Vec<DeviceInfo> {
        devs.unwrap_or_default()
            .into_iter()
            .filter_map(|d| d.name().ok())
            .map(|n| DeviceInfo { id: n.clone(), label: n })
            .collect()
    };
    Devices {
        inputs: names(host.input_devices().ok().map(|d| d.collect())),
        outputs: names(host.output_devices().ok().map(|d| d.collect())),
    }
}

/// Périphérique à ouvrir. On passe de préférence par le pont ALSA natif de PipeWire, qui
/// respecte une latence demandée (PIPEWIRE_LATENCY) et vise le nœud choisi (PIPEWIRE_NODE) ;
/// le pont « pulse » ajoute de gros tampons. Un nom ALSA explicite est ouvert tel quel.
#[cfg(target_os = "linux")]
fn pick(devices: Vec<cpal::Device>, choice: Option<&str>, fallback: Option<cpal::Device>) -> Option<cpal::Device> {
    let named = |n: &str| devices.iter().find(|d| d.name().map(|x| x == n).unwrap_or(false)).cloned();
    if let Some(choice) = choice {
        if let Some(d) = named(choice) {
            std::env::remove_var("PIPEWIRE_NODE");
            return Some(d);
        }
    }
    match choice {
        Some(node) => std::env::set_var("PIPEWIRE_NODE", node),
        None => std::env::remove_var("PIPEWIRE_NODE"),
    }
    named("pipewire").or_else(|| {
        // Sans pont PipeWire : le pont pulse, avec la même cible.
        if let Some(node) = choice {
            std::env::set_var("PULSE_SOURCE", node);
            std::env::set_var("PULSE_SINK", node);
        }
        named("pulse")
    }).or(fallback)
}

/// Le périphérique choisi par son nom cpal, sinon celui par défaut du système.
#[cfg(not(target_os = "linux"))]
fn pick(devices: Vec<cpal::Device>, choice: Option<&str>, fallback: Option<cpal::Device>) -> Option<cpal::Device> {
    choice
        .and_then(|n| devices.into_iter().find(|d| d.name().map(|x| x == n).unwrap_or(false)))
        .or(fallback)
}

/// Flux audio en cours ; les arrêter = relâcher cette valeur.
pub struct AudioIo {
    stop: mpsc::Sender<()>,
}

impl Drop for AudioIo {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

pub struct AudioSetup {
    pub input: Option<String>,
    pub output: Option<String>,
    pub mixer: Arc<Mutex<Mixer>>,
    /// audio du micro, mono 48 kHz
    pub capture: UnboundedSender<Vec<f32>>,
}

/// Ouvre le micro et la sortie dans un thread dédié.
pub fn start(setup: AudioSetup) -> Result<AudioIo, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new()
        .name("dislite-audio".into())
        .spawn(move || {
            let streams = open_streams(setup);
            match streams {
                Ok(streams) => {
                    let _ = ready_tx.send(Ok(()));
                    // Les flux vivent jusqu'à la demande d'arrêt (ou la fin du canal).
                    let _ = stop_rx.recv();
                    drop(streams);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    ready_rx.recv().map_err(|e| e.to_string())??;
    Ok(AudioIo { stop: stop_tx })
}

fn open_streams(setup: AudioSetup) -> Result<(Option<cpal::Stream>, cpal::Stream), String> {
    let host = cpal::default_host();
    // ~10 ms par période : la voix part et arrive sans attendre de gros tampons.
    #[cfg(target_os = "linux")]
    std::env::set_var("PIPEWIRE_LATENCY", "480/48000");
    let outputs = host.output_devices().map(|d| d.collect()).unwrap_or_default();
    let output = pick(outputs, setup.output.as_deref(), host.default_output_device()).ok_or("no audio output found")?;
    let out_stream = build_output(&output, setup.mixer)?;
    out_stream.play().map_err(|e| e.to_string())?;

    // Sans micro, on peut quand même écouter.
    let inputs = host.input_devices().map(|d| d.collect()).unwrap_or_default();
    let input = pick(inputs, setup.input.as_deref(), host.default_input_device());
    let in_stream = match input {
        Some(dev) => match build_input(&dev, setup.capture) {
            Ok(s) => {
                s.play().map_err(|e| e.to_string())?;
                Some(s)
            }
            Err(e) => {
                log::warn!("micro indisponible : {e}");
                None
            }
        },
        None => None,
    };
    Ok((in_stream, out_stream))
}

fn build_input(device: &cpal::Device, tx: UnboundedSender<Vec<f32>>) -> Result<cpal::Stream, String> {
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let format = supported.sample_format();
    let mut config: StreamConfig = supported.into();
    let build = |config: &StreamConfig| match format {
        SampleFormat::F32 => input_stream::<f32>(device, config, tx.clone()),
        SampleFormat::I16 => input_stream::<i16>(device, config, tx.clone()),
        SampleFormat::U16 => input_stream::<u16>(device, config, tx.clone()),
        SampleFormat::I32 => input_stream::<i32>(device, config, tx.clone()),
        other => Err(format!("unsupported microphone format {other}")),
    };
    // Petit tampon (10 ms) si le périphérique l'accepte, sinon celui par défaut.
    config.buffer_size = cpal::BufferSize::Fixed(LOW_LATENCY_FRAMES);
    build(&config).or_else(|_| {
        config.buffer_size = cpal::BufferSize::Default;
        build(&config)
    })
}

fn input_stream<T>(device: &cpal::Device, config: &StreamConfig, tx: UnboundedSender<Vec<f32>>) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    let mut resample = (config.sample_rate.0 != RATE).then(|| Linear::new(config.sample_rate.0, RATE));
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mut mono = Vec::with_capacity(data.len() / channels + 8);
                for frame in data.chunks(channels) {
                    let s = frame.iter().map(|x| x.to_sample::<f32>()).sum::<f32>() / channels as f32;
                    match resample.as_mut() {
                        Some(r) => r.push(s, &mut mono),
                        None => mono.push(s),
                    }
                }
                let _ = tx.send(mono);
            },
            |e| log::warn!("micro : {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}

fn build_output(device: &cpal::Device, mixer: Arc<Mutex<Mixer>>) -> Result<cpal::Stream, String> {
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let format = supported.sample_format();
    let mut config: StreamConfig = supported.into();
    let build = |config: &StreamConfig| match format {
        SampleFormat::F32 => output_stream::<f32>(device, config, mixer.clone()),
        SampleFormat::I16 => output_stream::<i16>(device, config, mixer.clone()),
        SampleFormat::U16 => output_stream::<u16>(device, config, mixer.clone()),
        SampleFormat::I32 => output_stream::<i32>(device, config, mixer.clone()),
        other => Err(format!("unsupported output format {other}")),
    };
    config.buffer_size = cpal::BufferSize::Fixed(LOW_LATENCY_FRAMES);
    build(&config).or_else(|_| {
        config.buffer_size = cpal::BufferSize::Default;
        build(&config)
    })
}

fn output_stream<T>(device: &cpal::Device, config: &StreamConfig, mixer: Arc<Mutex<Mixer>>) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels.max(1) as usize;
    // Rééchantillonnage 48 kHz -> sortie, par interpolation entre deux trames du mélange.
    let step = RATE as f64 / config.sample_rate.0 as f64;
    let mut pos = 1.0f64;
    let (mut prev, mut next) = ((0.0f32, 0.0f32), (0.0f32, 0.0f32));
    device
        .build_output_stream(
            config,
            move |out: &mut [T], _| {
                let Ok(mut mix) = mixer.lock() else { return };
                for frame in out.chunks_mut(channels) {
                    while pos >= 1.0 {
                        prev = next;
                        next = mix.next();
                        pos -= 1.0;
                    }
                    let t = pos as f32;
                    let l = prev.0 + (next.0 - prev.0) * t;
                    let r = prev.1 + (next.1 - prev.1) * t;
                    pos += step;
                    match frame.len() {
                        1 => frame[0] = T::from_sample((l + r) * 0.5),
                        _ => {
                            frame[0] = T::from_sample(l);
                            frame[1] = T::from_sample(r);
                            for extra in &mut frame[2..] {
                                *extra = T::from_sample(0.0);
                            }
                        }
                    }
                }
            },
            |e| log::warn!("sortie audio : {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}
