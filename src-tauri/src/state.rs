use std::sync::{Arc, Mutex, RwLock};

use crate::discord::gateway::GatewayHandle;
use crate::discord::http::DiscordHttp;
use crate::discord::identity::{self, Identity};
use crate::error::Result;
use crate::storage::Storage;

pub struct AppState {
    pub storage: Storage,
    pub identity: Arc<RwLock<Identity>>,
    pub http: Arc<DiscordHttp>,
    pub gateway: Mutex<Option<GatewayHandle>>,
    pub remote_auth: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub desktop: RwLock<crate::desktop::DesktopPrefs>,
    pub voice: crate::voice::Voice,
    build_resolved: tokio::sync::OnceCell<()>,
}

impl AppState {
    pub fn new(storage: Storage) -> Result<Self> {
        let identity = Arc::new(RwLock::new(Identity::detect()));
        let http = Arc::new(DiscordHttp::new(identity.clone())?);
        let desktop = RwLock::new(crate::desktop::load_prefs(&storage));
        Ok(Self {
            voice: crate::voice::Voice::default(),
            desktop,
            storage,
            identity,
            http,
            gateway: Mutex::new(None),
            remote_auth: Mutex::new(None),
            build_resolved: tokio::sync::OnceCell::new(),
        })
    }

    pub fn identity(&self) -> Identity {
        self.identity.read().unwrap().clone()
    }

    /// Résout une seule fois par lancement le numéro de build du client web.
    pub async fn ensure_build_number(&self) {
        self.build_resolved
            .get_or_init(|| async {
                let ua = self.identity().user_agent;
                let n = identity::resolve_build_number(self.http.client(), &ua, &self.storage).await;
                self.identity.write().unwrap().build_number = n;
            })
            .await;
    }

    pub fn stop_gateway(&self) {
        self.gateway.lock().unwrap().take();
    }

    pub fn stop_remote_auth(&self) {
        if let Some(task) = self.remote_auth.lock().unwrap().take() {
            task.abort();
        }
    }
}
