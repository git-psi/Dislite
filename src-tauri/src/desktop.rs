//! Intégration au bureau : icône dans la barre système, fermeture vers la barre,
//! démarrage réduit et lancement à l'ouverture de session (fichier XDG autostart).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

const PREFS_FILE: &str = "desktop.json";
const TRAY_ID: &str = "main";

/// Réglages lus par le Rust dès le lancement (avant le chargement de l'interface).
#[derive(Serialize, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefs {
    #[serde(default)]
    pub tray: bool,
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default)]
    pub start_minimized: bool,
}

pub fn load_prefs(storage: &crate::storage::Storage) -> DesktopPrefs {
    storage.read_json(PREFS_FILE).unwrap_or_default()
}

pub fn save_prefs(storage: &crate::storage::Storage, prefs: &DesktopPrefs) -> std::io::Result<()> {
    storage.write_json(PREFS_FILE, prefs)
}

/// L'icône de barre système passe par libappindicator, chargée dynamiquement : si elle
/// est absente, sa création ferait planter l'application. On vérifie donc avant.
pub fn tray_available() -> bool {
    const DIRS: [&str; 3] = ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu"];
    const LIBS: [&str; 2] = ["libayatana-appindicator3.so.1", "libappindicator3.so.1"];
    DIRS.iter().any(|d| LIBS.iter().any(|l| std::path::Path::new(d).join(l).exists()))
}

pub fn has_tray(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

/// Ajoute ou retire l'icône de la barre système.
pub fn set_tray(app: &AppHandle, on: bool) -> tauri::Result<()> {
    if !on {
        app.remove_tray_by_id(TRAY_ID);
        return Ok(());
    }
    if has_tray(app) || !tray_available() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, "open", "Open Dislite", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Dislite")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn autostart_file() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("autostart").join("dislite.desktop"))
}

pub fn autostart_enabled() -> bool {
    autostart_file().is_some_and(|f| f.exists())
}

/// Écrit ou supprime l'entrée XDG autostart (lancée avec `--minimized`).
pub fn set_autostart(on: bool) -> std::io::Result<()> {
    let Some(file) = autostart_file() else { return Ok(()) };
    if !on {
        return match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let exe = std::env::current_exe()?;
    std::fs::create_dir_all(file.parent().unwrap())?;
    std::fs::write(
        &file,
        format!(
            "[Desktop Entry]\nType=Application\nName=Dislite\nComment=Lightweight Discord client\nExec=\"{}\" --minimized\nIcon=dislite\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        ),
    )
}

/// Lancé par l'autostart avec la barre système active et le démarrage réduit demandé.
pub fn should_start_hidden(prefs: &DesktopPrefs) -> bool {
    prefs.tray && prefs.start_minimized && tray_available() && std::env::args().any(|a| a == "--minimized")
}
