//! Paquets RTP et chiffrement du transport vocal (modes « rtpsize » de Discord).
//!
//! Format : en-tête RTP (non chiffré, sert de données authentifiées) | charge chiffrée + tag |
//! compteur de 4 octets (gros-boutiste), qui forme le début du nonce complété de zéros.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::Aes256Gcm;
use chacha20poly1305::XChaCha20Poly1305;

pub const RTP_HEADER: usize = 12;
const PAYLOAD_TYPE_OPUS: u8 = 0x78;

pub enum Cipher {
    Aes(Box<Aes256Gcm>),
    XChaCha(Box<XChaCha20Poly1305>),
}

impl Cipher {
    /// Modes proposés par le serveur, du préféré au repli.
    pub const MODES: [&'static str; 2] = ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"];

    pub fn new(mode: &str, key: &[u8]) -> Option<Self> {
        match mode {
            "aead_aes256_gcm_rtpsize" => Aes256Gcm::new_from_slice(key).ok().map(|c| Cipher::Aes(Box::new(c))),
            "aead_xchacha20_poly1305_rtpsize" => XChaCha20Poly1305::new_from_slice(key).ok().map(|c| Cipher::XChaCha(Box::new(c))),
            _ => None,
        }
    }

    fn seal(&self, counter: [u8; 4], aad: &[u8], msg: &[u8]) -> Option<Vec<u8>> {
        let payload = Payload { msg, aad };
        match self {
            Cipher::Aes(c) => {
                let mut nonce = [0u8; 12];
                nonce[..4].copy_from_slice(&counter);
                c.encrypt(&nonce.into(), payload).ok()
            }
            Cipher::XChaCha(c) => {
                let mut nonce = [0u8; 24];
                nonce[..4].copy_from_slice(&counter);
                c.encrypt(&nonce.into(), payload).ok()
            }
        }
    }

    fn open(&self, counter: [u8; 4], aad: &[u8], msg: &[u8]) -> Option<Vec<u8>> {
        let payload = Payload { msg, aad };
        match self {
            Cipher::Aes(c) => {
                let mut nonce = [0u8; 12];
                nonce[..4].copy_from_slice(&counter);
                c.decrypt(&nonce.into(), payload).ok()
            }
            Cipher::XChaCha(c) => {
                let mut nonce = [0u8; 24];
                nonce[..4].copy_from_slice(&counter);
                c.decrypt(&nonce.into(), payload).ok()
            }
        }
    }
}

/// État d'émission : numéro de séquence, horodatage (48 kHz) et compteur de nonce.
pub struct Sender {
    pub ssrc: u32,
    seq: u16,
    timestamp: u32,
    nonce: u32,
}

impl Sender {
    pub fn new(ssrc: u32) -> Self {
        Self { ssrc, seq: rand::random(), timestamp: rand::random(), nonce: 0 }
    }

    /// Construit un paquet chiffré pour une trame Opus de `samples` échantillons.
    pub fn packet(&mut self, cipher: &Cipher, opus: &[u8], samples: u32) -> Option<Vec<u8>> {
        let mut header = [0u8; RTP_HEADER];
        header[0] = 0x80;
        header[1] = PAYLOAD_TYPE_OPUS;
        header[2..4].copy_from_slice(&self.seq.to_be_bytes());
        header[4..8].copy_from_slice(&self.timestamp.to_be_bytes());
        header[8..12].copy_from_slice(&self.ssrc.to_be_bytes());
        self.seq = self.seq.wrapping_add(1);
        self.timestamp = self.timestamp.wrapping_add(samples);
        self.nonce = self.nonce.wrapping_add(1);
        let counter = self.nonce.to_be_bytes();

        let sealed = cipher.seal(counter, &header, opus)?;
        let mut out = Vec::with_capacity(RTP_HEADER + sealed.len() + 4);
        out.extend_from_slice(&header);
        out.extend_from_slice(&sealed);
        out.extend_from_slice(&counter);
        Some(out)
    }
}

/// Paquet audio reçu, déchiffré (charge Opus, éventuellement encore chiffrée par DAVE).
pub struct Incoming {
    pub ssrc: u32,
    pub sequence: u16,
    pub payload: Vec<u8>,
}

/// Déchiffre un paquet RTP reçu. Ignore le RTCP et tout ce qui n'est pas de l'audio Opus.
pub fn open(cipher: &Cipher, packet: &[u8]) -> Option<Incoming> {
    if packet.len() < RTP_HEADER + 4 + 16 || packet[0] >> 6 != 2 {
        return None;
    }
    if packet[1] & 0x7F != PAYLOAD_TYPE_OPUS {
        return None;
    }
    let csrc = (packet[0] & 0x0F) as usize;
    let has_extension = packet[0] & 0x10 != 0;
    let sequence = u16::from_be_bytes([packet[2], packet[3]]);
    let ssrc = u32::from_be_bytes([packet[8], packet[9], packet[10], packet[11]]);

    // En mode rtpsize, l'en-tête d'extension (4 octets) est authentifié, son contenu chiffré.
    let mut aad_len = RTP_HEADER + csrc * 4;
    let mut ext_words = 0usize;
    if has_extension {
        if packet.len() < aad_len + 4 {
            return None;
        }
        ext_words = u16::from_be_bytes([packet[aad_len + 2], packet[aad_len + 3]]) as usize;
        aad_len += 4;
    }
    let end = packet.len() - 4;
    if end <= aad_len {
        return None;
    }
    let counter = [packet[end], packet[end + 1], packet[end + 2], packet[end + 3]];
    let plain = cipher.open(counter, &packet[..aad_len], &packet[aad_len..end])?;
    let skip = ext_words * 4;
    if plain.len() < skip {
        return None;
    }
    Some(Incoming { ssrc, sequence, payload: plain[skip..].to_vec() })
}
