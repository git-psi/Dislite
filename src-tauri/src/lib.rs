mod commands;
mod debug_bridge;
mod desktop;
mod discord;
mod error;
mod state;
mod storage;
mod voice;

use tauri::Manager;

use crate::state::AppState;
use crate::storage::Storage;

pub fn run() {
    let started = std::time::Instant::now();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("dislite_lib=info")).init();

    // WebKitGTK + pilote NVIDIA propriétaire : le rendu DMA-BUF donne souvent une fenêtre blanche.
    if std::path::Path::new("/proc/driver/nvidia").exists()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let storage = Storage::new(app.path().app_config_dir()?)?;
            app.manage(AppState::new(storage)?);
            #[cfg(debug_assertions)]
            debug_bridge::start(app.handle().clone());
            let prefs = *app.state::<AppState>().desktop.read().unwrap();
            if prefs.tray {
                if let Err(e) = desktop::set_tray(app.handle(), true) {
                    log::warn!("barre système indisponible : {e}");
                }
            }
            if desktop::should_start_hidden(&prefs) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            log::info!("démarrage : fenêtre prête en {} ms", started.elapsed().as_millis());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer = réduire dans la barre système, si elle est active et demandée.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let close_to_tray = app.state::<AppState>().desktop.read().unwrap().close_to_tray;
                if close_to_tray && desktop::has_tray(app) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_page_load(move |_, payload| {
            let step = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "page demandée",
                tauri::webview::PageLoadEvent::Finished => "page chargée",
            };
            log::info!("démarrage : {step} à {} ms", started.elapsed().as_millis());
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_restore,
            commands::login_with_token,
            commands::remote_auth_start,
            commands::remote_auth_cancel,
            commands::gateway_connect,
            commands::gateway_send,
            commands::logout,
            commands::accounts_list,
            commands::account_switch,
            commands::account_prepare_add,
            commands::account_remember,
            commands::account_remove,
            commands::desktop_get,
            commands::desktop_set,
            commands::autostart_set,
            commands::file_sizes,
            commands::notify,
            voice::voice_connect,
            voice::voice_disconnect,
            voice::voice_set_mute,
            voice::voice_set_deaf,
            voice::voice_devices,
            voice::voice_set_config,
            voice::voice_set_user_volume,
            voice::voice_set_talking,
            voice::voice_mic_test,
            commands::api,
            commands::api_upload,
            commands::media_support,
            commands::open_media,
            commands::set_mini_mode,
            debug_bridge::debug_result,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Dislite");
}
