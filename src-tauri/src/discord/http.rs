//! Client REST Discord : en-têtes du client web, limites de requêtes, erreurs typées.

use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart::{Form, Part};
use reqwest::{Method, RequestBuilder, StatusCode};
use serde_json::Value;

use super::captcha::{self, Challenge};
use super::identity::Identity;
use super::ratelimit::{route_key, RateLimiter};
use crate::error::{Error, Result};

pub const API_BASE: &str = "https://discord.com/api/v9";
const MAX_RETRIES: u32 = 3;
/// Captchas proposés pour une même requête (un jeton refusé en redemande un).
const MAX_CAPTCHAS: u32 = 2;

pub struct UploadPart {
    pub filename: String,
    pub data: bytes::Bytes,
}

/// Appelé avec le nombre d'octets envoyés depuis le début de l'envoi.
pub type Progress = Arc<dyn Fn(u64) + Send + Sync>;

const CHUNK: usize = 64 * 1024;

pub struct DiscordHttp {
    client: reqwest::Client,
    identity: Arc<RwLock<Identity>>,
    token: RwLock<Option<String>>,
    limiter: RateLimiter,
    /// Pour afficher un captcha quand Discord en demande un.
    app: OnceLock<tauri::AppHandle>,
}

impl DiscordHttp {
    pub fn new(identity: Arc<RwLock<Identity>>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .gzip(true)
            .brotli(true)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()?;
        Ok(Self {
            client,
            identity,
            token: RwLock::new(None),
            limiter: RateLimiter::default(),
            app: OnceLock::new(),
        })
    }

    pub fn set_app(&self, app: tauri::AppHandle) {
        let _ = self.app.set(app);
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub fn token(&self) -> Option<String> {
        self.token.read().unwrap().clone()
    }

    pub fn set_token(&self, token: Option<String>) {
        *self.token.write().unwrap() = token;
    }

    fn headers(&self, auth: bool) -> HeaderMap {
        let id = self.identity.read().unwrap();
        let mut h = HeaderMap::new();
        let mut put = |name: &'static str, value: &str| {
            if let Ok(v) = HeaderValue::from_str(value) {
                h.insert(HeaderName::from_static(name), v);
            }
        };
        put("user-agent", &id.user_agent);
        put("x-super-properties", &id.super_properties_header());
        put("x-discord-locale", &id.locale);
        put("x-discord-timezone", &id.timezone);
        put("x-debug-options", "bugReporterEnabled");
        put("accept-language", &id.accept_language());
        put("origin", "https://discord.com");
        put("referer", "https://discord.com/channels/@me");
        if auth {
            if let Some(token) = self.token.read().unwrap().as_deref() {
                put("authorization", token);
            }
        }
        h
    }

    /// Requête JSON authentifiée.
    pub async fn request(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        self.send(method, path, true, |rb| match &body {
            Some(b) => rb.json(b),
            None => rb,
        })
        .await
    }

    /// Requête JSON sans token (connexion par QR code).
    pub async fn request_anonymous(&self, method: Method, path: &str, body: Value) -> Result<Value> {
        self.send(method, path, false, |rb| rb.json(&body)).await
    }

    /// Envoi multipart (message avec pièces jointes).
    pub async fn upload(&self, path: &str, payload: Value, files: Vec<UploadPart>, progress: Option<Progress>) -> Result<Value> {
        let payload = payload.to_string();
        self.send(Method::POST, path, true, |rb| {
            // Nouveau compteur à chaque tentative (un nouvel essai repart de zéro).
            let sent = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let mut form = Form::new().text("payload_json", payload.clone());
            for (i, f) in files.iter().enumerate() {
                let mime = mime_guess::from_path(&f.filename).first_or_octet_stream();
                // Envoi par morceaux pour suivre la progression.
                let (data, sent, progress) = (f.data.clone(), sent.clone(), progress.clone());
                let chunks = (0..data.len().div_ceil(CHUNK)).map(move |n| {
                    let piece = data.slice(n * CHUNK..((n + 1) * CHUNK).min(data.len()));
                    let total = sent.fetch_add(piece.len() as u64, std::sync::atomic::Ordering::Relaxed) + piece.len() as u64;
                    if let Some(cb) = &progress {
                        cb(total);
                    }
                    Ok::<_, std::io::Error>(piece)
                });
                let body = reqwest::Body::wrap_stream(futures_util::stream::iter(chunks));
                let part = Part::stream_with_length(body, f.data.len() as u64).file_name(f.filename.clone());
                let part = part.mime_str(mime.as_ref()).unwrap_or_else(|_| {
                    Part::bytes(f.data.to_vec()).file_name(f.filename.clone())
                });
                form = form.part(format!("files[{i}]"), part);
            }
            rb.multipart(form)
        })
        .await
    }

    async fn send<F>(&self, method: Method, path: &str, auth: bool, build: F) -> Result<Value>
    where
        F: Fn(RequestBuilder) -> RequestBuilder,
    {
        if auth && self.token.read().unwrap().is_none() {
            return Err(Error::Unauthorized);
        }
        let route = route_key(&method, path);
        let url = format!("{API_BASE}{path}");

        let mut captcha_headers = HeaderMap::new();
        let mut captchas = 0;
        let mut attempt = 0;
        loop {
            self.limiter.acquire(&route).await;
            let mut headers = self.headers(auth);
            headers.extend(captcha_headers.clone());
            let rb = self.client.request(method.clone(), &url).headers(headers);
            let resp = build(rb).send().await?;
            self.limiter.update(&route, resp.headers()).await;

            let status = resp.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                let global = resp
                    .headers()
                    .get("x-ratelimit-global")
                    .is_some_and(|v| v == "true");
                let body: Value = resp.json().await.unwrap_or_default();
                let retry = Duration::from_secs_f64(body["retry_after"].as_f64().unwrap_or(1.0).max(0.1));
                log::warn!("429 sur {route}, nouvel essai dans {retry:?}");
                if attempt == MAX_RETRIES {
                    return Err(Error::Api {
                        status: 429,
                        code: None,
                        message: "Too many requests, try again in a moment".into(),
                    });
                }
                if global {
                    self.limiter.set_global(retry).await;
                } else {
                    tokio::time::sleep(retry).await;
                }
                attempt += 1;
                continue;
            }

            if status == StatusCode::UNAUTHORIZED {
                return Err(Error::Unauthorized);
            }
            if status == StatusCode::NO_CONTENT {
                return Ok(Value::Null);
            }

            let text = resp.text().await?;
            if status.is_success() {
                return Ok(if text.is_empty() {
                    Value::Null
                } else {
                    serde_json::from_str(&text)?
                });
            }
            let body: Value = serde_json::from_str(&text).unwrap_or_default();
            if let Some(challenge) = Challenge::from_body(&body) {
                let app = self.app.get().filter(|_| captchas < MAX_CAPTCHAS);
                let token = match app {
                    Some(app) => captcha::solve(app, &challenge).await,
                    None => None,
                };
                let Some(token) = token else { return Err(Error::CaptchaRequired) };
                captchas += 1;
                captcha_headers = challenge_headers(&challenge, &token);
                continue;
            }
            return Err(api_error(status, &body));
        }
    }
}

/// En-têtes de la nouvelle tentative, avec le jeton du captcha résolu.
fn challenge_headers(challenge: &Challenge, token: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    let mut put = |name: &'static str, value: Option<&str>| {
        if let Some(v) = value.and_then(|v| HeaderValue::from_str(v).ok()) {
            h.insert(HeaderName::from_static(name), v);
        }
    };
    put("x-captcha-key", Some(token));
    put("x-captcha-rqtoken", challenge.rqtoken.as_deref());
    put("x-captcha-session-id", challenge.session_id.as_deref());
    h
}

fn api_error(status: StatusCode, body: &Value) -> Error {
    if body.get("captcha_key").is_some() {
        return Error::CaptchaRequired;
    }
    let mut message = body["message"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("Erreur HTTP {}", status.as_u16()));
    // Les erreurs de validation détaillées sont dans `errors.<champ>._errors[].message`.
    if let Some(detail) = first_nested_error(&body["errors"]) {
        message = format!("{message} : {detail}");
    }
    Error::Api {
        status: status.as_u16(),
        code: body["code"].as_i64(),
        message,
    }
}

fn first_nested_error(v: &Value) -> Option<String> {
    match v {
        Value::Object(map) => {
            if let Some(errs) = map.get("_errors").and_then(Value::as_array) {
                return errs.first()?.get("message")?.as_str().map(str::to_owned);
            }
            map.values().find_map(first_nested_error)
        }
        _ => None,
    }
}
