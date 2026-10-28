//! Persistance locale minimale : fichiers JSON dans le dossier de config de l'app.
//! Le token est écrit avec des permissions 0600 (sous Windows, le dossier de l'utilisateur
//! dans %APPDATA% n'est déjà accessible qu'à lui).

use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Ancien format (un seul compte), migré vers `accounts.json` au premier accès.
const LEGACY_SESSION_FILE: &str = "session.json";
const ACCOUNTS_FILE: &str = "accounts.json";

#[derive(Serialize, Deserialize)]
struct LegacySession {
    token: String,
}

/// Compte enregistré. Le profil (id, noms, avatar) est complété par le frontend
/// après la connexion ; le token ne quitte jamais le Rust.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Account {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub global_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    pub token: String,
}

#[derive(Serialize, Deserialize, Default)]
struct AccountsFile {
    #[serde(default)]
    active: Option<usize>,
    #[serde(default)]
    accounts: Vec<Account>,
}

impl AccountsFile {
    fn active(&self) -> Option<&Account> {
        self.active.and_then(|i| self.accounts.get(i))
    }
}

/// Profil public d'un compte, tel que renvoyé au frontend.
#[derive(Serialize, Deserialize, Clone)]
pub struct AccountProfile {
    pub id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Clone)]
pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        Ok(Self { dir })
    }

    fn load_accounts(&self) -> AccountsFile {
        if let Some(file) = self.read_json::<AccountsFile>(ACCOUNTS_FILE) {
            return file;
        }
        // Migration : l'ancienne session devient le premier compte.
        let mut file = AccountsFile::default();
        if let Some(legacy) = self.read_json::<LegacySession>(LEGACY_SESSION_FILE).filter(|s| !s.token.is_empty()) {
            file.accounts.push(Account { token: legacy.token, ..Default::default() });
            file.active = Some(0);
            if self.write_json(ACCOUNTS_FILE, &file).is_ok() {
                let _ = fs::remove_file(self.dir.join(LEGACY_SESSION_FILE));
            }
        }
        file
    }

    fn save_accounts(&self, file: &AccountsFile) -> std::io::Result<()> {
        self.write_json(ACCOUNTS_FILE, file)
    }

    /// Token du compte actif.
    pub fn token(&self) -> Option<String> {
        self.load_accounts().active().map(|a| a.token.clone()).filter(|t| !t.is_empty())
    }

    /// Nouveau compte connecté (ou reconnecté) : il devient le compte actif.
    pub fn set_token(&self, token: &str) -> std::io::Result<()> {
        let mut file = self.load_accounts();
        let index = match file.accounts.iter().position(|a| a.token == token) {
            Some(i) => i,
            None => {
                file.accounts.push(Account { token: token.to_owned(), ..Default::default() });
                file.accounts.len() - 1
            }
        };
        file.active = Some(index);
        self.save_accounts(&file)
    }

    /// Retire le compte actif ; le premier compte restant devient actif. Retourne son token.
    pub fn clear_token(&self) -> Option<String> {
        let mut file = self.load_accounts();
        if let Some(i) = file.active.filter(|&i| i < file.accounts.len()) {
            file.accounts.remove(i);
        }
        file.active = if file.accounts.is_empty() { None } else { Some(0) };
        let _ = self.save_accounts(&file);
        file.active().map(|a| a.token.clone())
    }

    /// Retire un compte inactif de cet appareil (sans le déconnecter côté Discord).
    pub fn remove_account(&self, id: &str) -> std::io::Result<()> {
        let mut file = self.load_accounts();
        let active_id = file.active().and_then(|a| a.id.clone());
        file.accounts.retain(|a| a.id.as_deref() != Some(id) || active_id.as_deref() == Some(id));
        file.active = active_id
            .and_then(|aid| file.accounts.iter().position(|a| a.id.as_deref() == Some(aid.as_str())))
            .or(if file.accounts.is_empty() { None } else { Some(0) });
        self.save_accounts(&file)
    }

    /// Rend actif le compte `id` et retourne son token.
    pub fn activate(&self, id: &str) -> Option<String> {
        let mut file = self.load_accounts();
        let index = file.accounts.iter().position(|a| a.id.as_deref() == Some(id))?;
        file.active = Some(index);
        self.save_accounts(&file).ok()?;
        Some(file.accounts[index].token.clone())
    }

    /// Complète le profil du compte actif ; supprime un doublon plus ancien du même utilisateur.
    pub fn remember(&self, profile: &AccountProfile) -> std::io::Result<()> {
        let mut file = self.load_accounts();
        let Some(active) = file.active else { return Ok(()) };
        let token = file.accounts[active].token.clone();
        file.accounts.retain(|a| a.token == token || a.id.as_deref() != Some(profile.id.as_str()));
        let index = file.accounts.iter().position(|a| a.token == token).unwrap_or(0);
        let account = &mut file.accounts[index];
        account.id = Some(profile.id.clone());
        account.username = Some(profile.username.clone());
        account.global_name = profile.global_name.clone();
        account.avatar = profile.avatar.clone();
        file.active = Some(index);
        self.save_accounts(&file)
    }

    /// Comptes connus (sans les tokens), et l'id du compte actif.
    pub fn accounts(&self) -> (Vec<AccountProfile>, Option<String>) {
        let file = self.load_accounts();
        let list = file
            .accounts
            .iter()
            .filter_map(|a| {
                Some(AccountProfile {
                    id: a.id.clone()?,
                    username: a.username.clone().unwrap_or_default(),
                    global_name: a.global_name.clone(),
                    avatar: a.avatar.clone(),
                })
            })
            .collect();
        (list, file.active().and_then(|a| a.id.clone()))
    }

    pub fn read_json<T: DeserializeOwned>(&self, name: &str) -> Option<T> {
        let data = fs::read(self.dir.join(name)).ok()?;
        serde_json::from_slice(&data).ok()
    }

    pub fn write_json<T: Serialize>(&self, name: &str, value: &T) -> std::io::Result<()> {
        let data = serde_json::to_vec(value)?;
        let path = self.dir.join(name);
        let tmp = path.with_extension("tmp");
        {
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&tmp)?;
            file.write_all(&data)?;
            file.sync_all()?;
        }
        fs::rename(tmp, path)
    }
}
