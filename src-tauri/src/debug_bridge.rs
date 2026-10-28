//! Pont de débogage (builds de développement uniquement).
//!
//! Une socket Unix privée (`$XDG_RUNTIME_DIR/accord-debug.sock`, mode 0600) ou, sous
//! Windows, un tube nommé local (`\\.\pipe\accord-debug`) reçoit une ligne de JavaScript,
//! l'exécute dans la fenêtre et renvoie le résultat en JSON. Sert aux tests manuels et
//! automatisés de l'interface.
//! Le serveur n'est démarré qu'en développement : en release, seul `debug_result`
//! reste enregistré (et ne fait rien).
#![cfg_attr(not(debug_assertions), allow(dead_code))]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct DebugBridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
}

#[cfg(unix)]
fn socket_path() -> std::path::PathBuf {
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    dir.join("accord-debug.sock")
}

#[cfg(unix)]
pub fn start(app: AppHandle) {
    use std::os::unix::fs::PermissionsExt;
    app.manage(DebugBridge::default());
    tauri::async_runtime::spawn(async move {
        let path = socket_path();
        let _ = std::fs::remove_file(&path);
        let listener = match tokio::net::UnixListener::bind(&path) {
            Ok(l) => l,
            Err(e) => return log::warn!("pont de débogage indisponible : {e}"),
        };
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        log::info!("pont de débogage : {}", path.display());

        while let Ok((stream, _)) = listener.accept().await {
            tauri::async_runtime::spawn(serve(app.clone(), stream));
        }
    });
}

#[cfg(windows)]
pub fn start(app: AppHandle) {
    use tokio::net::windows::named_pipe::ServerOptions;
    const PIPE: &str = r"\\.\pipe\accord-debug";
    app.manage(DebugBridge::default());
    tauri::async_runtime::spawn(async move {
        // Une instance du tube par client : on en recrée une dès qu'un client se connecte.
        let mut server = match ServerOptions::new().first_pipe_instance(true).create(PIPE) {
            Ok(s) => s,
            Err(e) => return log::warn!("pont de débogage indisponible : {e}"),
        };
        log::info!("pont de débogage : {PIPE}");
        while server.connect().await.is_ok() {
            let client = server;
            server = match ServerOptions::new().create(PIPE) {
                Ok(s) => s,
                Err(e) => return log::warn!("pont de débogage arrêté : {e}"),
            };
            tauri::async_runtime::spawn(serve(app.clone(), client));
        }
    });
}

/// Une connexion : une ligne de code reçue, une ligne de JSON renvoyée.
async fn serve(app: AppHandle, stream: impl AsyncRead + AsyncWrite + Send + 'static) {
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    while let Ok(Some(code)) = lines.next_line().await {
        // « @snapshot <fichier.png> » : capture du contenu de la page.
        let result = match code.strip_prefix("@snapshot ") {
            Some(path) => snapshot(&app, path.trim().to_owned()).await,
            // « @captcha » : fenêtre de captcha avec la clé de test publique de hCaptcha.
            None if code.trim() == "@captcha" => captcha_test(&app).await,
            None => eval(&app, &code).await,
        };
        let mut out = result.to_string();
        out.push('\n');
        if write.write_all(out.as_bytes()).await.is_err() {
            break;
        }
    }
}

async fn captcha_test(app: &AppHandle) -> Value {
    let challenge = crate::discord::captcha::Challenge {
        sitekey: "10000000-ffff-ffff-ffff-000000000001".into(),
        rqdata: None,
        rqtoken: None,
        session_id: None,
    };
    match crate::discord::captcha::solve(app, &challenge).await {
        Some(token) => json!({ "ok": true, "value": token }),
        None => json!({ "ok": false, "error": "no token" }),
    }
}

async fn eval(app: &AppHandle, code: &str) -> Value {
    let bridge = app.state::<DebugBridge>();
    let Some(window) = app.get_webview_window("main") else {
        return json!({ "ok": false, "error": "window not found" });
    };
    let id = bridge.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    bridge.pending.lock().unwrap().insert(id, tx);

    // L'évaluation native contourne la CSP (pas de `eval` côté page).
    let script = format!(
        "(async () => {{ {code} }})().then(\
           v => window.__TAURI_INTERNALS__.invoke('debug_result', {{ id: {id}, ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v).replace(/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/g, '\\uFFFD')) }}),\
           e => window.__TAURI_INTERNALS__.invoke('debug_result', {{ id: {id}, ok: false, value: String(e && e.stack || e) }}))"
    );
    if let Err(e) = window.eval(&script) {
        bridge.pending.lock().unwrap().remove(&id);
        return json!({ "ok": false, "error": e.to_string() });
    }
    match tokio::time::timeout(Duration::from_secs(20), rx).await {
        Ok(Ok(v)) => v,
        _ => {
            bridge.pending.lock().unwrap().remove(&id);
            json!({ "ok": false, "error": "timed out" })
        }
    }
}

#[tauri::command]
pub fn debug_result(app: AppHandle, id: u64, ok: bool, value: Value) {
    if let Some(bridge) = app.try_state::<DebugBridge>() {
        if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(json!({ "ok": ok, "value": value }));
        }
    }
}

/// Capture la zone visible de la page (indépendant de l'écran : fonctionne même
/// si la fenêtre est masquée ou sur un autre espace de travail).
#[cfg(target_os = "linux")]
async fn snapshot(app: &AppHandle, path: String) -> Value {
    let Some(window) = app.get_webview_window("main") else {
        return json!({ "ok": false, "error": "window not found" });
    };
    let (tx, rx) = oneshot::channel::<Result<(), String>>();
    let res = window.with_webview(move |wv| {
        use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
        wv.inner().snapshot(
            SnapshotRegion::Visible,
            SnapshotOptions::NONE,
            None::<&gio::Cancellable>,
            move |result| {
                let out = result.map_err(|e| e.to_string()).and_then(|surface| {
                    let image = cairo::ImageSurface::try_from(surface).map_err(|_| "unexpected surface".to_string())?;
                    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
                    image.write_to_png(&mut file).map_err(|e| e.to_string())
                });
                let _ = tx.send(out);
            },
        );
    });
    if let Err(e) = res {
        return json!({ "ok": false, "error": e.to_string() });
    }
    match tokio::time::timeout(Duration::from_secs(10), rx).await {
        Ok(Ok(Ok(()))) => json!({ "ok": true, "value": "ok" }),
        Ok(Ok(Err(e))) => json!({ "ok": false, "error": e }),
        _ => json!({ "ok": false, "error": "snapshot failed" }),
    }
}

#[cfg(not(target_os = "linux"))]
async fn snapshot(_app: &AppHandle, _path: String) -> Value {
    json!({ "ok": false, "error": "not available on this platform" })
}
