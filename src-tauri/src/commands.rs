//! Commandes exposées au frontend.

use std::sync::Arc;

use base64::Engine;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::discord::gateway::GatewayHandle;
use crate::discord::http::UploadPart;
use crate::discord::remote_auth::{self, AuthEvent, Outcome};
use crate::error::{Error, Result};
use crate::state::AppState;
use crate::storage::AccountProfile;

/// Charge la session enregistrée. Retourne `true` si un token existe.
#[tauri::command]
pub async fn session_restore(state: State<'_, AppState>) -> Result<bool> {
    state.ensure_build_number().await;
    let token = state.storage.token();
    let has = token.is_some();
    state.http.set_token(token);
    Ok(has)
}

/// Connexion manuelle avec un token (solution de secours au QR code).
#[tauri::command]
pub async fn login_with_token(state: State<'_, AppState>, token: String) -> Result<Value> {
    state.ensure_build_number().await;
    let token = token.trim().trim_matches('"').to_owned();
    state.http.set_token(Some(token.clone()));
    match state.http.request(Method::GET, "/users/@me", None).await {
        Ok(user) => {
            state.storage.set_token(&token)?;
            Ok(user)
        }
        Err(e) => {
            state.http.set_token(None);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn remote_auth_start(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.stop_remote_auth();
    state.ensure_build_number().await;

    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let state = task_app.state::<AppState>();
        let ua = state.identity().user_agent;
        let event = match remote_auth::run(&task_app, state.http.clone(), &ua).await {
            Ok(Outcome::Token(token)) => match state.storage.set_token(&token) {
                Ok(()) => {
                    state.http.set_token(Some(token));
                    AuthEvent::Success
                }
                Err(e) => AuthEvent::Error { message: e.to_string() },
            },
            Ok(Outcome::Cancelled) => AuthEvent::Cancelled,
            Ok(Outcome::Expired) => AuthEvent::Expired,
            Err(e) => AuthEvent::Error { message: e.to_string() },
        };
        let _ = task_app.emit(remote_auth::EVENT, event);
    });
    *state.remote_auth.lock().unwrap() = Some(task);
    Ok(())
}

#[tauri::command]
pub fn remote_auth_cancel(state: State<'_, AppState>) {
    state.stop_remote_auth();
}

#[tauri::command]
pub fn gateway_connect(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let token = state.http.token().ok_or(Error::Unauthorized)?;
    state.stop_gateway();
    let handle = GatewayHandle::spawn(app, state.identity(), token);
    *state.gateway.lock().unwrap() = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn gateway_send(state: State<'_, AppState>, op: u8, d: Value) {
    if let Some(gw) = state.gateway.lock().unwrap().as_ref() {
        gw.send(op, d);
    }
}

/// Déconnecte le compte actif (token invalidé côté Discord) et le retire de l'appareil.
/// Retourne `true` si un autre compte enregistré prend le relais.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<bool> {
    state.stop_gateway();
    // Invalide le token côté serveur, comme le client officiel.
    let _ = state
        .http
        .request(
            Method::POST,
            "/auth/logout",
            Some(json!({ "provider": null, "voip_provider": null })),
        )
        .await;
    let next = state.storage.clear_token();
    let has_next = next.is_some();
    state.http.set_token(next);
    Ok(has_next)
}

/// Comptes enregistrés sur cet appareil (sans les tokens) et compte actif.
#[tauri::command]
pub fn accounts_list(state: State<'_, AppState>) -> Value {
    let (accounts, active) = state.storage.accounts();
    json!({ "accounts": accounts, "active": active })
}

/// Bascule vers un autre compte enregistré (la gateway est relancée par le frontend).
#[tauri::command]
pub fn account_switch(state: State<'_, AppState>, id: String) -> Result<()> {
    let token = state.storage.activate(&id).ok_or(Error::Unauthorized)?;
    state.stop_gateway();
    state.http.set_token(Some(token));
    Ok(())
}

/// Avant d'ajouter un compte : plus de session en cours (l'échange du QR code
/// ne doit pas porter le token du compte actuel). Les comptes restent enregistrés.
#[tauri::command]
pub fn account_prepare_add(state: State<'_, AppState>) {
    state.stop_gateway();
    state.http.set_token(None);
}

/// Profil du compte actif, envoyé après READY (nom et avatar pour le sélecteur de comptes).
#[tauri::command]
pub fn account_remember(state: State<'_, AppState>, profile: AccountProfile) -> Result<()> {
    state.storage.remember(&profile)?;
    Ok(())
}

/// Retire un compte inactif de cet appareil.
#[tauri::command]
pub fn account_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    state.storage.remove_account(&id)?;
    Ok(())
}

/// WebKitGTK plante (abort) s'il tente de lire une vidéo sans les plugins GStreamer
/// de base : le frontend affiche alors des vignettes au lieu des lecteurs.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn media_support() -> bool {
    const DIRS: [&str; 3] = [
        "/usr/lib/gstreamer-1.0",
        "/usr/lib64/gstreamer-1.0",
        "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
    ];
    DIRS.iter().map(std::path::Path::new).any(|dir| {
        ["libgstplayback.so", "libgstautodetect.so", "libgstvideoconvertscale.so"]
            .iter()
            .all(|lib| dir.join(lib).exists())
    })
}

/// WebView2 (Windows) et WebKit (macOS) lisent la vidéo sans rien de plus.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn media_support() -> bool {
    true
}

/// Lit une vidéo dans mpv (repli quand WebKit ne peut pas la lire).
/// Retourne `false` si mpv n'est pas installé : le frontend ouvre alors le navigateur.
#[tauri::command]
pub fn open_media(url: String, looped: bool) -> Result<bool> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(Error::other("invalid media URL"));
    }
    let mut cmd = std::process::Command::new("mpv");
    cmd.arg("--force-window=immediate").arg("--title=Dislite — media");
    if looped {
        cmd.arg("--loop-file=inf");
    }
    // « -- » : l'URL ne peut pas être interprétée comme une option.
    cmd.arg("--").arg(&url);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    match cmd.spawn() {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Mode mini : petite fenêtre flottante, au premier plan, déplaçable.
/// Sous Hyprland, une fenêtre ne peut pas se rendre flottante elle-même :
/// on le demande au compositeur (flottante + épinglée sur tous les bureaux).
#[tauri::command]
pub fn set_mini_mode(window: tauri::WebviewWindow, on: bool) -> Result<()> {
    const MINI: (u32, u32) = (380, 380);
    const NORMAL_MIN: (f64, f64) = (940.0, 520.0);
    let err = |e: tauri::Error| Error::other(e.to_string());

    // La taille minimale normale empêcherait de réduire la fenêtre.
    window
        .set_min_size(if on { None } else { Some(tauri::LogicalSize::new(NORMAL_MIN.0, NORMAL_MIN.1)) })
        .map_err(err)?;

    #[cfg(target_os = "linux")]
    if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() && hyprland_mini(on, MINI) {
        return Ok(());
    }
    window.set_always_on_top(on).map_err(err)?;
    if on {
        window.set_size(tauri::LogicalSize::new(MINI.0, MINI.1)).map_err(err)?;
    }
    Ok(())
}

/// Hyprland récent (configuration Lua), puis l'ancienne syntaxe en repli.
#[cfg(target_os = "linux")]
fn hyprland_mini(on: bool, (w, h): (u32, u32)) -> bool {
    let dispatch = |cmd: &str| {
        std::process::Command::new("hyprctl")
            .args(["dispatch", cmd])
            .output()
            .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "ok")
            .unwrap_or(false)
    };
    let pid = std::process::id();
    let target = format!("window = \"pid:{pid}\"");
    let lua: Vec<String> = if on {
        vec![
            format!("hl.dsp.window.float({{ action = \"enable\", {target} }})"),
            format!("hl.dsp.window.resize({{ x = {w}, y = {h}, {target} }})"),
            format!("hl.dsp.window.pin({{ action = \"enable\", {target} }})"),
        ]
    } else {
        vec![
            format!("hl.dsp.window.pin({{ action = \"disable\", {target} }})"),
            format!("hl.dsp.window.float({{ action = \"disable\", {target} }})"),
        ]
    };
    if lua.iter().all(|c| dispatch(c)) {
        return true;
    }
    let t = format!("pid:{pid}");
    let legacy: Vec<String> = if on {
        vec![format!("setfloating {t}"), format!("resizewindowpixel exact {w} {h},{t}"), format!("pin {t}")]
    } else {
        vec![format!("pin {t}"), format!("settiled {t}")]
    };
    legacy.iter().all(|c| dispatch(c))
}

/// Requête REST générique. `path` est relatif à `/api/v9`.
#[tauri::command]
pub async fn api(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value> {
    if !path.starts_with('/') || path.contains("..") {
        return Err(Error::other("invalid API path"));
    }
    let method = Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|_| Error::other("invalid HTTP method"))?;
    state.http.request(method, &path, body).await
}

#[derive(Deserialize)]
pub struct UploadFile {
    /// Fichier sur disque (sélection ou glisser-déposer).
    path: Option<String>,
    /// Contenu en base64 (collé depuis le presse-papiers).
    data: Option<String>,
    name: Option<String>,
}

#[tauri::command]
pub async fn api_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    payload: Value,
    files: Vec<UploadFile>,
    upload_id: Option<String>,
) -> Result<Value> {
    let mut parts = Vec::with_capacity(files.len());
    for f in files {
        let part = match (f.path, f.data) {
            (Some(p), _) => {
                let filename = f.name.unwrap_or_else(|| {
                    std::path::Path::new(&p)
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "fichier".into())
                });
                UploadPart { filename, data: tokio::fs::read(&p).await?.into() }
            }
            (None, Some(b64)) => UploadPart {
                filename: f.name.unwrap_or_else(|| "image.png".into()),
                data: base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| Error::other(e.to_string()))?
                    .into(),
            },
            (None, None) => return Err(Error::other("empty file")),
        };
        parts.push(part);
    }
    // Progression : au plus ~10 événements par seconde.
    let total: u64 = parts.iter().map(|p| p.data.len() as u64).sum();
    let progress = upload_id.map(|id| {
        let last = std::sync::Mutex::new(std::time::Instant::now() - std::time::Duration::from_secs(1));
        Arc::new(move |sent: u64| {
            let mut last = last.lock().unwrap();
            if sent < total && last.elapsed() < std::time::Duration::from_millis(100) {
                return;
            }
            *last = std::time::Instant::now();
            let _ = app.emit("upload:progress", json!({ "id": id, "sent": sent, "total": total }));
        }) as crate::discord::http::Progress
    });
    state.http.upload(&path, payload, parts, progress).await
}

/// Taille des fichiers choisis (aperçu avant envoi, limite de taille).
#[tauri::command]
pub async fn file_sizes(paths: Vec<String>) -> Vec<u64> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        out.push(tokio::fs::metadata(&p).await.map(|m| m.len()).unwrap_or(0));
    }
    out
}

/// Icône de l'app pour les notifications : embarquée, écrite une fois dans le cache.
fn notify_icon(app: &AppHandle) -> Option<String> {
    static ICON: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    ICON.get_or_init(|| {
        let dir = app.path().app_cache_dir().ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("notification-icon.png");
        if !path.exists() {
            std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;
        }
        Some(path.to_string_lossy().into_owned())
    })
    .clone()
}

/// Notification système avec boutons. Le bouton choisi revient en `notify:action`
/// (`default` : clic sur la notification elle-même).
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String, channel_id: String, call: bool) {
    let icon = notify_icon(&app);
    let on_action = move |action: &str| {
        if action != "decline" {
            crate::desktop::show_main(&app);
        }
        let _ = app.emit("notify:action", json!({ "action": action, "channelId": channel_id }));
    };
    show_notification(title, body, icon, call, on_action);
}

#[cfg(not(windows))]
fn show_notification(title: String, body: String, icon: Option<String>, call: bool, on_action: impl Fn(&str) + Send + 'static) {
    std::thread::spawn(move || {
        let mut n = notify_rust::Notification::new();
        n.appname("Dislite").summary(&title).body(&body);
        if let Some(icon) = icon {
            n.icon(&icon);
        }
        if call {
            n.action("accept", "Join")
                .action("decline", "Decline")
                .urgency(notify_rust::Urgency::Critical)
                .timeout(notify_rust::Timeout::Milliseconds(30_000));
        } else {
            // Un clic sur la notification ouvre la conversation, prête pour répondre.
            n.action("default", "Open")
                .timeout(notify_rust::Timeout::Milliseconds(8_000));
        }
        let Ok(handle) = n.show() else { return };
        handle.wait_for_action(|action| {
            if action != "__closed" {
                on_action(action);
            }
        });
    });
}

/// Le raccourci du menu Démarrer créé par l'installeur enregistre l'identifiant de l'app
/// auprès de Windows ; sans lui (build de dev, exe lancé à la main), les toasts sous cet
/// identifiant seraient ignorés en silence.
#[cfg(windows)]
fn installed_for_toasts() -> bool {
    static INSTALLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *INSTALLED.get_or_init(|| {
        !cfg!(debug_assertions)
            && std::env::var_os("APPDATA").is_some_and(|d| {
                std::path::Path::new(&d).join(r"Microsoft\Windows\Start Menu\Programs\Dislite.lnk").exists()
            })
    })
}

/// Toast Windows. Une application installée s'annonce sous son identifiant (raccourci du menu
/// Démarrer créé par l'installeur) ; en développement, sous celui de PowerShell.
#[cfg(windows)]
fn show_notification(title: String, body: String, icon: Option<String>, call: bool, on_action: impl Fn(&str) + Send + 'static) {
    use tauri_winrt_notification::{Duration, IconCrop, Scenario, Toast};
    let app_id = if installed_for_toasts() { "dev.accord.client" } else { Toast::POWERSHELL_APP_ID };
    let mut toast = Toast::new(app_id).title(&title).text1(&body);
    if let Some(icon) = icon {
        toast = toast.icon(std::path::Path::new(&icon), IconCrop::Square, "");
    }
    toast = if call {
        toast
            .scenario(Scenario::IncomingCall)
            .add_button("Join", "accept")
            .add_button("Decline", "decline")
    } else {
        toast.duration(Duration::Short)
    };
    let result = toast
        .on_activated(move |action| {
            // Clic sur la notification elle-même : pas d'argument.
            on_action(action.as_deref().unwrap_or("default"));
            Ok(())
        })
        .show();
    if let Err(e) = result {
        log::warn!("notification : {e}");
    }
}

/// Réglages d'intégration au bureau, et ce que le système permet.
#[tauri::command]
pub fn desktop_get(app: AppHandle, state: State<'_, AppState>) -> Value {
    let prefs = *state.desktop.read().unwrap();
    json!({
        "prefs": prefs,
        "trayAvailable": crate::desktop::tray_available(),
        "autostart": crate::desktop::autostart_enabled(),
        "os": std::env::consts::OS,
        "version": app.package_info().version.to_string(),
        "updates": crate::updater::supported(),
    })
}

#[tauri::command]
pub fn desktop_set(app: AppHandle, state: State<'_, AppState>, prefs: crate::desktop::DesktopPrefs) -> Result<()> {
    crate::desktop::save_prefs(&state.storage, &prefs)?;
    *state.desktop.write().unwrap() = prefs;
    crate::desktop::set_tray(&app, prefs.tray).map_err(|e| Error::other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn autostart_set(on: bool) -> Result<()> {
    crate::desktop::set_autostart(on)?;
    Ok(())
}
