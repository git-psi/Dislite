use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("websocket: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("session invalid or expired")]
    Unauthorized,
    #[error("Captcha not completed")]
    CaptchaRequired,
    #[error("{message}")]
    Api {
        status: u16,
        code: Option<i64>,
        message: String,
    },
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::CaptchaRequired => "captcha",
            Self::Api { .. } => "api",
            Self::Http(_) | Self::WebSocket(_) => "network",
            _ => "other",
        }
    }
}

/// Erreurs sérialisées pour le frontend : `{ kind, message, status?, code? }`.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Error", 4)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        let (status, code) = match self {
            Self::Api { status, code, .. } => (Some(*status), *code),
            _ => (None, None),
        };
        s.serialize_field("status", &status)?;
        s.serialize_field("code", &code)?;
        s.end()
    }
}
