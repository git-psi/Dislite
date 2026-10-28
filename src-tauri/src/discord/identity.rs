//! Identité du client présentée à Discord.
//!
//! Dislite se présente comme le client web officiel (Chrome sous Linux) : mêmes
//! « super properties », même user-agent, même numéro de build. C'est ce qui
//! permet de ne pas se distinguer d'un navigateur classique.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rand::RngCore;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::storage::Storage;

/// Utilisé si la récupération du numéro de build échoue et qu'aucun cache n'existe.
const FALLBACK_BUILD_NUMBER: u64 = 460_000;
const CHROME_VERSION: &str = "140.0.0.0";
const BUILD_CACHE_FILE: &str = "build.json";
const BUILD_CACHE_TTL: Duration = Duration::from_secs(24 * 3600);

#[derive(Clone, Debug)]
pub struct Identity {
    pub user_agent: String,
    pub locale: String,
    pub timezone: String,
    pub build_number: u64,
    launch_id: String,
}

impl Identity {
    pub fn detect() -> Self {
        Self {
            user_agent: format!(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{CHROME_VERSION} Safari/537.36"
            ),
            locale: detect_locale(),
            timezone: detect_timezone(),
            build_number: FALLBACK_BUILD_NUMBER,
            launch_id: uuid_v4(),
        }
    }

    pub fn super_properties(&self) -> Value {
        json!({
            "os": "Linux",
            "browser": "Chrome",
            "device": "",
            "system_locale": self.locale,
            "has_client_mods": false,
            "browser_user_agent": self.user_agent,
            "browser_version": CHROME_VERSION,
            "os_version": "",
            "referrer": "",
            "referring_domain": "",
            "referrer_current": "",
            "referring_domain_current": "",
            "release_channel": "stable",
            "client_build_number": self.build_number,
            "client_event_source": null,
            "client_launch_id": self.launch_id,
        })
    }

    pub fn super_properties_header(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(self.super_properties().to_string())
    }

    pub fn accept_language(&self) -> String {
        let lang = self.locale.split('-').next().unwrap_or("en");
        format!("{},{};q=0.9,en;q=0.8", self.locale, lang)
    }
}

#[derive(Serialize, Deserialize)]
struct BuildCache {
    build_number: u64,
    fetched_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Retourne le numéro de build courant de Discord.
/// Le cache est utilisé tel quel, même périmé (> 24 h) : il est alors rafraîchi en tâche de fond
/// pour le prochain lancement. Le réseau ne retarde le démarrage que sans aucun cache.
pub async fn resolve_build_number(client: &reqwest::Client, ua: &str, storage: &Storage) -> u64 {
    if let Some(c) = storage.read_json::<BuildCache>(BUILD_CACHE_FILE) {
        if now_secs().saturating_sub(c.fetched_at) >= BUILD_CACHE_TTL.as_secs() {
            let (client, ua, storage) = (client.clone(), ua.to_owned(), storage.clone());
            tauri::async_runtime::spawn(async move {
                refresh_build_number(&client, &ua, &storage).await;
            });
        }
        return c.build_number;
    }
    refresh_build_number(client, ua, storage)
        .await
        .unwrap_or(FALLBACK_BUILD_NUMBER)
}

async fn refresh_build_number(client: &reqwest::Client, ua: &str, storage: &Storage) -> Option<u64> {
    match tokio::time::timeout(Duration::from_secs(10), fetch_build_number(client, ua)).await {
        Ok(Some(n)) => {
            log::info!("numéro de build Discord : {n}");
            let _ = storage.write_json(
                BUILD_CACHE_FILE,
                &BuildCache {
                    build_number: n,
                    fetched_at: now_secs(),
                },
            );
            Some(n)
        }
        _ => {
            log::warn!("impossible de récupérer le numéro de build, utilisation du cache/fallback");
            None
        }
    }
}

async fn fetch_build_number(client: &reqwest::Client, ua: &str) -> Option<u64> {
    let html = client
        .get("https://discord.com/app")
        .header("User-Agent", ua)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    let script_re = Regex::new(r#"<script[^>]+src="(/assets/[^"]+\.js)""#).ok()?;
    let build_re = Regex::new(r#"build_?[Nn]umber["']?\s*[:=,]\s*["']?(\d{5,7})"#).ok()?;

    let mut scripts: Vec<&str> = script_re
        .captures_iter(&html)
        .filter_map(|c| c.get(1).map(|m| m.as_str()))
        .collect();
    // Le numéro est généralement dans le bundle sentry ou web.*, on les essaie d'abord.
    scripts.sort_by_key(|s| !(s.contains("sentry") || s.contains("web.")));

    for src in scripts.into_iter().take(6) {
        let Ok(resp) = client
            .get(format!("https://discord.com{src}"))
            .header("User-Agent", ua)
            .send()
            .await
        else {
            continue;
        };
        let Ok(js) = resp.text().await else { continue };
        if let Some(n) = build_re
            .captures(&js)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
        {
            return Some(n);
        }
    }
    None
}

/// Convertit `LANG` (ex. `fr_FR.UTF-8`) en locale Discord (ex. `fr`, `en-US`).
fn detect_locale() -> String {
    let raw = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LC_MESSAGES"))
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_default();
    let base = raw.split(['.', '@']).next().unwrap_or("");
    let mut parts = base.split('_');
    let lang = parts.next().unwrap_or("").to_lowercase();
    let region = parts.next().unwrap_or("").to_uppercase();

    match (lang.as_str(), region.as_str()) {
        ("", _) | ("c", _) | ("posix", _) => "en-US".into(),
        ("en", "GB") => "en-GB".into(),
        ("en", _) => "en-US".into(),
        ("es", "419") => "es-419".into(),
        ("es", _) => "es-ES".into(),
        ("pt", "BR") => "pt-BR".into(),
        ("zh", "TW") => "zh-TW".into(),
        ("zh", _) => "zh-CN".into(),
        ("sv", _) => "sv-SE".into(),
        ("nb", _) | ("no", _) => "no".into(),
        (l, _) => l.into(),
    }
}

fn detect_timezone() -> String {
    if let Ok(tz) = std::env::var("TZ") {
        let tz = tz.trim_start_matches(':');
        if !tz.is_empty() {
            return tz.into();
        }
    }
    if let Ok(target) = std::fs::read_link("/etc/localtime") {
        let s = target.to_string_lossy();
        if let Some(idx) = s.find("zoneinfo/") {
            return s[idx + "zoneinfo/".len()..].to_string();
        }
    }
    std::fs::read_to_string("/etc/timezone")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "UTC".into())
}

fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}
