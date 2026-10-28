//! Mises à jour depuis les Releases GitHub (paquets signés, voir `plugins.updater` dans
//! `tauri.conf.json`). Vérifiées 30 s après le lancement puis toutes les 24 h si l'utilisateur
//! le veut ; l'installation n'a lieu que sur sa demande (l'installeur Windows ferme l'app).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{Error, Result};
use crate::state::AppState;

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

/// Version installée par l'installeur Windows ou en AppImage. Les paquets .deb / AUR sont mis
/// à jour par le gestionnaire de paquets, et une build de développement jamais.
pub fn supported() -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    if cfg!(target_os = "linux") {
        return std::env::var_os("APPIMAGE").is_some();
    }
    true
}

pub fn start(app: AppHandle) {
    app.manage(Updates::default());
    if !supported() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        // Laisse le démarrage et la connexion se faire tranquillement.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            let auto = app.state::<AppState>().desktop.read().unwrap().auto_update;
            if auto {
                match check(&app).await {
                    Ok(Some(info)) => {
                        let _ = app.emit("update:available", info);
                    }
                    Ok(None) => {}
                    Err(e) => log::warn!("mise à jour : {e}"),
                }
            }
            tokio::time::sleep(Duration::from_secs(24 * 3600)).await;
        }
    });
}

fn info(update: &Update) -> UpdateInfo {
    UpdateInfo { version: update.version.clone(), notes: update.body.clone() }
}

async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>> {
    let err = |e: tauri_plugin_updater::Error| {
        log::warn!("mise à jour : {e}");
        Error::other("Couldn't check for updates, try again later")
    };
    let update = app.updater().map_err(err)?.check().await.map_err(err)?;
    let found = update.as_ref().map(info);
    *app.state::<Updates>().pending.lock().unwrap() = update;
    Ok(found)
}

/// Mise à jour déjà trouvée (sans requête réseau).
#[tauri::command]
pub fn update_pending(app: AppHandle) -> Option<UpdateInfo> {
    app.state::<Updates>().pending.lock().unwrap().as_ref().map(info)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>> {
    if !supported() {
        return Err(Error::other("Updates aren't available for this installation"));
    }
    check(&app).await
}

/// Télécharge, installe et relance. Sous Windows, l'installeur ferme l'app lui-même.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<()> {
    let update = app.state::<Updates>().pending.lock().unwrap().take().ok_or_else(|| Error::other("No update to install"))?;
    let mut received = 0u64;
    let mut last = std::time::Instant::now();
    let progress_app = app.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                // Au plus ~5 événements par seconde.
                if last.elapsed() >= Duration::from_millis(200) {
                    last = std::time::Instant::now();
                    let _ = progress_app.emit("update:progress", json!({ "received": received, "total": total }));
                }
            },
            || {},
        )
        .await;
    if let Err(e) = result {
        // On pourra réessayer.
        *app.state::<Updates>().pending.lock().unwrap() = Some(update);
        return Err(Error::other(e.to_string()));
    }
    app.restart();
}
