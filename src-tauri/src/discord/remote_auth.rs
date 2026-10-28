//! Connexion par QR code (« remote auth »), comme sur discord.com/login.
//!
//! On génère une paire RSA, le serveur nous donne une empreinte affichée en QR
//! code ; l'appli mobile la scanne, et le token nous est renvoyé chiffré avec
//! notre clé publique. Le mot de passe ne transite jamais par Dislite.

use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use qrcode::render::svg;
use qrcode::QrCode;
use reqwest::Method;
use rsa::pkcs8::EncodePublicKey;
use rsa::{Oaep, RsaPrivateKey, RsaPublicKey};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep_until, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use super::http::DiscordHttp;
use crate::error::{Error, Result};

const REMOTE_AUTH_URL: &str = "wss://remote-auth-gateway.discord.gg/?v=2";
pub const EVENT: &str = "remote_auth";

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthEvent {
    Qr { url: String, svg: String },
    Pending { user: PendingUser },
    Success,
    Cancelled,
    Expired,
    Error { message: String },
}

#[derive(Serialize, Clone)]
pub struct PendingUser {
    id: String,
    discriminator: String,
    avatar: Option<String>,
    username: String,
}

pub enum Outcome {
    Token(String),
    Cancelled,
    Expired,
}

pub async fn run(app: &AppHandle, http: Arc<DiscordHttp>, user_agent: &str) -> Result<Outcome> {
    let key = tokio::task::spawn_blocking(|| RsaPrivateKey::new(&mut rand::thread_rng(), 2048))
        .await
        .map_err(|e| Error::other(e.to_string()))?
        .map_err(|e| Error::other(e.to_string()))?;
    let public_der = RsaPublicKey::from(&key)
        .to_public_key_der()
        .map_err(|e| Error::other(e.to_string()))?;

    let mut request = REMOTE_AUTH_URL.into_client_request()?;
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("https://discord.com"));
    if let Ok(ua) = HeaderValue::from_str(user_agent) {
        request.headers_mut().insert("User-Agent", ua);
    }
    let (ws, _) = tokio_tungstenite::connect_async(request).await?;
    let (mut sink, mut stream) = ws.split();

    let decrypt = |b64: &str| -> Result<Vec<u8>> {
        let data = STANDARD.decode(b64).map_err(|e| Error::other(e.to_string()))?;
        key.decrypt(Oaep::new::<Sha256>(), &data)
            .map_err(|e| Error::other(format!("decryption failed: {e}")))
    };
    let send = |v: Value| Message::Text(v.to_string().into());

    let mut interval: Option<Duration> = None;
    let mut next_beat = Instant::now() + Duration::from_secs(3600);

    loop {
        tokio::select! {
            msg = stream.next() => {
                let text = match msg {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Close(_))) | None => return Ok(Outcome::Expired),
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(e.into()),
                };
                let payload: Value = serde_json::from_str(&text)?;
                match payload["op"].as_str().unwrap_or_default() {
                    "hello" => {
                        let ms = payload["heartbeat_interval"].as_u64().unwrap_or(41_250);
                        interval = Some(Duration::from_millis(ms));
                        next_beat = Instant::now() + Duration::from_millis(ms);
                        sink.send(send(json!({
                            "op": "init",
                            "encoded_public_key": STANDARD.encode(public_der.as_bytes()),
                        }))).await?;
                    }
                    "nonce_proof" => {
                        let nonce = decrypt(payload["encrypted_nonce"].as_str().unwrap_or_default())?;
                        let proof = URL_SAFE_NO_PAD.encode(Sha256::digest(&nonce));
                        sink.send(send(json!({ "op": "nonce_proof", "proof": proof }))).await?;
                    }
                    "pending_remote_init" => {
                        let fingerprint = payload["fingerprint"].as_str().unwrap_or_default();
                        let url = format!("https://discord.com/ra/{fingerprint}");
                        let svg = QrCode::new(url.as_bytes())
                            .map_err(|e| Error::other(e.to_string()))?
                            .render::<svg::Color>()
                            .min_dimensions(220, 220)
                            .quiet_zone(true)
                            .dark_color(svg::Color("#000000"))
                            .light_color(svg::Color("#ffffff"))
                            .build();
                        let _ = app.emit(EVENT, AuthEvent::Qr { url, svg });
                    }
                    "pending_ticket" => {
                        let raw = decrypt(payload["encrypted_user_payload"].as_str().unwrap_or_default())?;
                        let raw = String::from_utf8_lossy(&raw);
                        let mut parts = raw.splitn(4, ':');
                        let user = PendingUser {
                            id: parts.next().unwrap_or_default().into(),
                            discriminator: parts.next().unwrap_or_default().into(),
                            avatar: parts.next().filter(|a| !a.is_empty() && *a != "0").map(Into::into),
                            username: parts.next().unwrap_or_default().into(),
                        };
                        let _ = app.emit(EVENT, AuthEvent::Pending { user });
                    }
                    "pending_login" => {
                        let ticket = payload["ticket"].as_str().unwrap_or_default();
                        let resp = http
                            .request_anonymous(Method::POST, "/users/@me/remote-auth/login", json!({ "ticket": ticket }))
                            .await?;
                        let encrypted = resp["encrypted_token"]
                            .as_str()
                            .ok_or_else(|| Error::other("unexpected sign-in response"))?;
                        let token = String::from_utf8(decrypt(encrypted)?)
                            .map_err(|e| Error::other(e.to_string()))?;
                        return Ok(Outcome::Token(token));
                    }
                    "cancel" => return Ok(Outcome::Cancelled),
                    _ => {}
                }
            }
            _ = sleep_until(next_beat), if interval.is_some() => {
                next_beat = Instant::now() + interval.unwrap_or_default();
                sink.send(send(json!({ "op": "heartbeat" }))).await?;
            }
        }
    }
}
