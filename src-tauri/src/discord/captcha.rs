//! Captcha (hCaptcha) demandé par Discord sur certaines actions (rejoindre un serveur,
//! ajouter un ami, se connecter…).
//!
//! La clé de site de Discord n'est valable que sur `discord.com` : une petite fenêtre ouvre
//! donc `https://discord.com/robots.txt` (léger, sans CSP), dont le contenu est remplacé par le
//! seul widget hCaptcha. Une fois résolu, le jeton revient par une navigation vers une adresse
//! sentinelle, interceptée ici. Cette page distante n'a aucun accès à l'IPC (les permissions ne
//! concernent que la fenêtre `main`).

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

const LABEL: &str = "captcha";
const PAGE: &str = "https://discord.com/robots.txt";
const SENTINEL: &str = "https://dislite.invalid/captcha";

/// Défi renvoyé par l'API (réponse 400 avec `captcha_key`).
pub struct Challenge {
    pub sitekey: String,
    pub rqdata: Option<String>,
    pub rqtoken: Option<String>,
    pub session_id: Option<String>,
}

impl Challenge {
    pub fn from_body(body: &Value) -> Option<Self> {
        body.get("captcha_key")?;
        let s = |k: &str| body[k].as_str().map(str::to_owned);
        Some(Self {
            // Discord n'utilise que hCaptcha ; sans clé de site, rien à afficher.
            sitekey: s("captcha_sitekey").filter(|_| s("captcha_service").is_none_or(|v| v == "hcaptcha"))?,
            rqdata: s("captcha_rqdata"),
            rqtoken: s("captcha_rqtoken"),
            session_id: s("captcha_session_id"),
        })
    }
}

/// Une seule fenêtre à la fois : les requêtes suivantes attendent leur tour.
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Affiche le captcha et attend le jeton. `None` : fenêtre fermée ou captcha indisponible.
pub async fn solve(app: &AppHandle, challenge: &Challenge) -> Option<String> {
    let _turn = LOCK.lock().await;
    let (tx, rx) = oneshot::channel::<Option<String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let send = {
        let tx = tx.clone();
        move |v: Option<String>| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(v);
            }
        }
    };

    let config = json!({ "sitekey": challenge.sitekey, "rqdata": challenge.rqdata });
    let script = SCRIPT.replace("__CONFIG__", &config.to_string()).replace("__SENTINEL__", SENTINEL);
    let on_nav = send.clone();
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(PAGE.parse().ok()?))
        .title("Captcha")
        .inner_size(420.0, 600.0)
        .resizable(false)
        .center()
        .initialization_script(&script)
        .on_navigation(move |url| {
            if !url.as_str().starts_with(SENTINEL) {
                return true;
            }
            let token = url.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned());
            on_nav(token);
            false
        });
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).ok()?;
    }
    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            log::warn!("fenêtre de captcha : {e}");
            return None;
        }
    };
    let _ = window.set_focus();
    window.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::Destroyed) {
            send(None);
        }
    });

    let token = rx.await.ok().flatten();
    let _ = window.destroy();
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    token
}

/// Remplace la page par le widget hCaptcha (cadre principal de discord.com uniquement :
/// le script est aussi injecté dans les cadres de hCaptcha).
const SCRIPT: &str = r#"(() => {
  if (window.top !== window || location.origin !== "https://discord.com") return;
  const config = __CONFIG__;
  const done = (query) => { location.href = "__SENTINEL__?" + query; };
  addEventListener("DOMContentLoaded", () => {
    document.documentElement.innerHTML =
      '<head><meta name="color-scheme" content="dark"><title>Captcha</title></head>' +
      '<body><p>Complete the check to continue.</p><div id="captcha"></div></body>';
    const style = document.createElement("style");
    style.textContent =
      "html, body { margin: 0; height: 100%; background: #292734; color: #b9b7c4; font: 14px system-ui, sans-serif; }" +
      "body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }";
    document.head.append(style);
    window.__disliteCaptcha = () => {
      const id = hcaptcha.render("captcha", {
        sitekey: config.sitekey,
        theme: "dark",
        callback: (token) => done("token=" + encodeURIComponent(token)),
      });
      if (config.rqdata) hcaptcha.setData(id, { rqdata: config.rqdata });
    };
    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?render=explicit&onload=__disliteCaptcha&recaptchacompat=off";
    script.onerror = () => done("error=load");
    document.head.append(script);
  });
})();"#;
