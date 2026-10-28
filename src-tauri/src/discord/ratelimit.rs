//! Gestion des limites de requêtes de l'API REST.
//!
//! Discord renvoie pour chaque route un « bucket » et le nombre de requêtes
//! restantes. On attend avant d'envoyer plutôt que de recevoir des 429 : un
//! client qui enchaîne les 429 est exactement ce que Discord surveille.

use std::collections::HashMap;
use std::time::Duration;

use reqwest::header::HeaderMap;
use reqwest::Method;
use tokio::sync::Mutex;
use tokio::time::{sleep_until, Instant};

#[derive(Default)]
pub struct RateLimiter {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// route normalisée -> hash du bucket renvoyé par Discord
    routes: HashMap<String, String>,
    /// (hash du bucket + paramètre majeur) -> état
    buckets: HashMap<String, Bucket>,
    global_until: Option<Instant>,
}

struct Bucket {
    remaining: u32,
    reset_at: Instant,
}

/// Clé de route : méthode + chemin où seuls les paramètres majeurs
/// (channel, guild, webhook) gardent leur identifiant.
pub fn route_key(method: &Method, path: &str) -> String {
    let path = path.split('?').next().unwrap_or(path);
    let mut out = String::with_capacity(path.len() + 8);
    out.push_str(method.as_str());
    let mut prev = "";
    let mut major_seen = false;
    for seg in path.split('/').filter(|s| !s.is_empty()) {
        out.push('/');
        let is_id = seg.bytes().all(|b| b.is_ascii_digit());
        if is_id && !major_seen && matches!(prev, "channels" | "guilds" | "webhooks") {
            out.push_str(seg);
            major_seen = true;
        } else if is_id {
            out.push_str(":id");
        } else if prev == "reactions" {
            out.push_str(":emoji");
        } else {
            out.push_str(seg);
        }
        prev = seg;
    }
    out
}

fn major_of(route: &str) -> &str {
    route
        .split('/')
        .find(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or("")
}

impl RateLimiter {
    /// Attend que la route soit disponible et réserve une requête.
    pub async fn acquire(&self, route: &str) {
        loop {
            let wait = {
                let mut inner = self.inner.lock().await;
                let now = Instant::now();
                if let Some(until) = inner.global_until.filter(|u| *u > now) {
                    Some(until)
                } else {
                    let key = inner
                        .routes
                        .get(route)
                        .map(|hash| format!("{hash}:{}", major_of(route)));
                    match key.and_then(|k| inner.buckets.get_mut(&k)) {
                        Some(b) if b.reset_at <= now => {
                            // Fenêtre expirée : on laisse passer, la réponse mettra à jour.
                            None
                        }
                        Some(b) if b.remaining == 0 => Some(b.reset_at),
                        Some(b) => {
                            b.remaining -= 1;
                            None
                        }
                        None => None,
                    }
                }
            };
            match wait {
                Some(until) => sleep_until(until + Duration::from_millis(50)).await,
                None => return,
            }
        }
    }

    pub async fn update(&self, route: &str, headers: &HeaderMap) {
        let get = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
        let Some(hash) = get("x-ratelimit-bucket") else { return };
        let remaining = get("x-ratelimit-remaining").and_then(|v| v.parse::<u32>().ok());
        let reset_after = get("x-ratelimit-reset-after").and_then(|v| v.parse::<f64>().ok());

        let mut inner = self.inner.lock().await;
        inner.routes.insert(route.to_owned(), hash.to_owned());
        if let (Some(remaining), Some(reset_after)) = (remaining, reset_after) {
            inner.buckets.insert(
                format!("{hash}:{}", major_of(route)),
                Bucket {
                    remaining,
                    reset_at: Instant::now() + Duration::from_secs_f64(reset_after),
                },
            );
        }
    }

    pub async fn set_global(&self, retry_after: Duration) {
        self.inner.lock().await.global_until = Some(Instant::now() + retry_after);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_major_parameter() {
        assert_eq!(
            route_key(&Method::GET, "/channels/123/messages/456?limit=50"),
            "GET/channels/123/messages/:id"
        );
        assert_eq!(
            route_key(&Method::PUT, "/channels/1/messages/2/reactions/%F0%9F%91%8D/@me"),
            "PUT/channels/1/messages/:id/reactions/:emoji/@me"
        );
    }
}
