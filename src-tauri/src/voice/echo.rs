//! Annulation d'écho (AEC3 de WebRTC, porté en Rust) : retire du micro ce que les
//! haut-parleurs jouent, pour que les autres ne s'entendent pas en retour.
//!
//! Le traitement vit dans son propre thread (le pipeline n'est pas `Send`), entre la capture
//! et la connexion : le micro y entre, la référence (ce que l'app joue) est tirée du mélangeur,
//! et l'audio nettoyé repart vers la connexion. Le thread s'arrête avec le micro.

use std::sync::{Arc, Mutex};

use aec3::nodes::audio::AudioFormat;
use aec3::pipelines::linear;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use super::audio::{Mixer, RATE};

/// Intercale l'annulation d'écho avant `out` ; renvoie l'entrée à donner à la capture.
pub fn spawn(out: UnboundedSender<Vec<f32>>, mixer: Arc<Mutex<Mixer>>) -> UnboundedSender<Vec<f32>> {
    let (tx, mut rx) = unbounded_channel::<Vec<f32>>();
    let fallback = out.clone();
    let started = std::thread::Builder::new().name("dislite-aec".into()).spawn(move || {
        let format = AudioFormat::ten_ms(RATE, 1);
        // Seulement le filtre passe-haut et l'AEC : RNNoise et le gain restent ceux de Dislite.
        let pipeline = linear::builder(format, format)
            .enable_noise_suppression(false)
            .enable_gain_controller2(false)
            .enable_post_filter(false)
            .build();
        let mut pipeline = match pipeline {
            Ok(p) => Some(p),
            Err(e) => {
                log::warn!("annulation d'écho indisponible : {e:?}");
                None
            }
        };
        if pipeline.is_some() {
            set_recording(&mixer, true);
        }
        let n = format.sample_count();
        let (mut mic, mut reference) = (Vec::<f32>::new(), Vec::<f32>::new());
        let mut cleaned = vec![0f32; n];
        while let Some(chunk) = rx.blocking_recv() {
            let Some(p) = pipeline.as_mut() else {
                if out.send(chunk).is_err() {
                    break;
                }
                continue;
            };
            // D'abord ce qui a été joué jusqu'ici (l'écho arrive après, dans le micro).
            if let Ok(mut m) = mixer.lock() {
                reference.extend(m.reference.drain(..));
            }
            let whole = reference.len() / n * n;
            for frame in reference[..whole].chunks_exact(n) {
                let _ = p.handle_render_frame(frame);
            }
            reference.drain(..whole);

            mic.extend_from_slice(&chunk);
            let whole = mic.len() / n * n;
            let mut processed = Vec::with_capacity(whole);
            for frame in mic[..whole].chunks_exact(n) {
                match p.process_capture_frame(frame, &mut cleaned) {
                    Ok(true) => processed.extend_from_slice(&cleaned),
                    _ => processed.extend_from_slice(frame),
                }
            }
            mic.drain(..whole);
            if !processed.is_empty() && out.send(processed).is_err() {
                break;
            }
        }
        set_recording(&mixer, false);
    });
    match started {
        Ok(_) => tx,
        Err(e) => {
            log::warn!("annulation d'écho indisponible : {e}");
            fallback
        }
    }
}

fn set_recording(mixer: &Mutex<Mixer>, on: bool) {
    if let Ok(mut m) = mixer.lock() {
        m.record_reference = on;
        m.reference.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Écho simulé (référence retardée de 60 ms, atténuée) : il doit être fortement réduit.
    #[test]
    fn removes_simulated_echo() {
        let format = AudioFormat::ten_ms(RATE, 1);
        let mut p = linear::builder(format, format)
            .enable_noise_suppression(false)
            .enable_gain_controller2(false)
            .enable_post_filter(false)
            .build()
            .unwrap();
        let n = format.sample_count();
        let delay = RATE as usize * 60 / 1000;
        // Bruit pseudo-aléatoire façon parole (amplitude variable).
        let mut seed = 1u32;
        let total = RATE as usize * 8;
        let far: Vec<f32> = (0..total)
            .map(|i| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let env = 0.5 + 0.5 * ((i as f32 / 4000.0).sin());
                ((seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.4 * env
            })
            .collect();
        let mut out = vec![0f32; n];
        let (mut e_in, mut e_out) = (0f64, 0f64);
        let start = std::time::Instant::now();
        for (k, frame) in far.chunks_exact(n).enumerate() {
            p.handle_render_frame(frame).unwrap();
            let mic: Vec<f32> = (0..n)
                .map(|j| {
                    let i = k * n + j;
                    if i >= delay { far[i - delay] * 0.5 } else { 0.0 }
                })
                .collect();
            p.process_capture_frame(&mic, &mut out).unwrap();
            // Mesure après 4 s de convergence.
            if k * n > RATE as usize * 4 {
                e_in += mic.iter().map(|s| (*s as f64).powi(2)).sum::<f64>();
                e_out += out.iter().map(|s| (*s as f64).powi(2)).sum::<f64>();
            }
        }
        let frames = total / n;
        let reduction = 10.0 * (e_in / e_out.max(1e-12)).log10();
        println!("réduction de l'écho : {reduction:.1} dB, {:.2} ms par trame de 10 ms", start.elapsed().as_secs_f64() * 1000.0 / frames as f64);
        assert!(reduction > 15.0, "écho réduit de {reduction:.1} dB seulement");
    }
}
