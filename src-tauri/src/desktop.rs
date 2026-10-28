//! Intégration au bureau : icône dans la barre système, fermeture vers la barre,
//! démarrage réduit et lancement à l'ouverture de session (fichier XDG autostart sous Linux,
//! clé `Run` du registre sous Windows).

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const PREFS_FILE: &str = "desktop.json";
const TRAY_ID: &str = "main";

/// Réglages lus par le Rust dès le lancement (avant le chargement de l'interface).
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopPrefs {
    pub tray: bool,
    pub close_to_tray: bool,
    pub start_minimized: bool,
    /// recherche automatique des mises à jour
    pub auto_update: bool,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self { tray: false, close_to_tray: false, start_minimized: false, auto_update: true }
    }
}

pub fn load_prefs(storage: &crate::storage::Storage) -> DesktopPrefs {
    storage.read_json(PREFS_FILE).unwrap_or_default()
}

pub fn save_prefs(storage: &crate::storage::Storage, prefs: &DesktopPrefs) -> std::io::Result<()> {
    storage.write_json(PREFS_FILE, prefs)
}

/// Sous Linux, l'icône de barre système passe par libappindicator, chargée dynamiquement :
/// si elle est absente, sa création ferait planter l'application. On vérifie donc avant.
#[cfg(target_os = "linux")]
pub fn tray_available() -> bool {
    const DIRS: [&str; 3] = ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu"];
    const LIBS: [&str; 2] = ["libayatana-appindicator3.so.1", "libappindicator3.so.1"];
    DIRS.iter().any(|d| LIBS.iter().any(|l| std::path::Path::new(d).join(l).exists()))
}

#[cfg(not(target_os = "linux"))]
pub fn tray_available() -> bool {
    true
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
        // Clic gauche : la fenêtre (Windows) ; le menu reste au clic droit.
        // Sous Linux (appindicator), seul le menu existe.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
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

/// Commande lancée à l'ouverture de session.
fn autostart_command() -> std::io::Result<String> {
    Ok(format!("\"{}\" --minimized", std::env::current_exe()?.display()))
}

#[cfg(not(windows))]
fn autostart_file() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("autostart").join("dislite.desktop"))
}

#[cfg(not(windows))]
pub fn autostart_enabled() -> bool {
    autostart_file().is_some_and(|f| f.exists())
}

/// Écrit ou supprime l'entrée XDG autostart (lancée avec `--minimized`).
#[cfg(not(windows))]
pub fn set_autostart(on: bool) -> std::io::Result<()> {
    let Some(file) = autostart_file() else { return Ok(()) };
    if !on {
        return match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(file.parent().unwrap())?;
    std::fs::write(
        &file,
        format!(
            "[Desktop Entry]\nType=Application\nName=Dislite\nComment=Lightweight Discord client\nExec={}\nIcon=dislite\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            autostart_command()?
        ),
    )
}

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(windows)]
pub fn autostart_enabled() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|k| k.get_value::<String, _>("Dislite"))
        .is_ok()
}

/// Écrit ou supprime la valeur `Dislite` de la clé `Run` de l'utilisateur.
#[cfg(windows)]
pub fn set_autostart(on: bool) -> std::io::Result<()> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY)?;
    if !on {
        return match key.delete_value("Dislite") {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    key.set_value("Dislite", &autostart_command()?)
}

/// Lancé par l'autostart avec la barre système active et le démarrage réduit demandé.
pub fn should_start_hidden(prefs: &DesktopPrefs) -> bool {
    prefs.tray && prefs.start_minimized && tray_available() && std::env::args().any(|a| a == "--minimized")
}
