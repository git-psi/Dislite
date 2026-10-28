// Pont vers le backend Rust. Tout appel réseau passe par ici.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BackendError {
  kind: "unauthorized" | "captcha" | "api" | "network" | "other";
  message: string;
  status: number | null;
  code: number | null;
}

export const isBackendError = (e: unknown): e is BackendError =>
  typeof e === "object" && e !== null && "kind" in e && "message" in e;

export const errorMessage = (e: unknown) =>
  isBackendError(e) ? e.message : e instanceof Error ? e.message : String(e);

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const backend = {
  sessionRestore: () => invoke<boolean>("session_restore"),
  loginWithToken: (token: string) => invoke<unknown>("login_with_token", { token }),
  remoteAuthStart: () => invoke<void>("remote_auth_start"),
  remoteAuthCancel: () => invoke<void>("remote_auth_cancel"),
  gatewayConnect: () => invoke<void>("gateway_connect"),
  gatewaySend: (op: number, d: unknown) => invoke<void>("gateway_send", { op, d }),
  /** retourne true si un autre compte enregistré prend le relais */
  logout: () => invoke<boolean>("logout"),
  accountsList: () => invoke<{ accounts: AccountProfile[]; active: string | null }>("accounts_list"),
  accountSwitch: (id: string) => invoke<void>("account_switch", { id }),
  accountPrepareAdd: () => invoke<void>("account_prepare_add"),
  accountRemember: (profile: AccountProfile) => invoke<void>("account_remember", { profile }),
  accountRemove: (id: string) => invoke<void>("account_remove", { id }),
  desktopGet: () => invoke<{ prefs: DesktopPrefs; trayAvailable: boolean; autostart: boolean }>("desktop_get"),
  desktopSet: (prefs: DesktopPrefs) => invoke<void>("desktop_set", { prefs }),
  autostartSet: (on: boolean) => invoke<void>("autostart_set", { on }),
  voiceConnect: (params: VoiceConnectParams) => invoke<void>("voice_connect", { params }),
  voiceDisconnect: () => invoke<void>("voice_disconnect"),
  voiceSetMute: (on: boolean) => invoke<void>("voice_set_mute", { on }),
  voiceSetDeaf: (on: boolean) => invoke<void>("voice_set_deaf", { on }),
  voiceDevices: () => invoke<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>("voice_devices"),
  voiceSetConfig: (config: VoiceConfig) => invoke<void>("voice_set_config", { config }),
  voiceSetUserVolume: (userId: string, volume: number) => invoke<void>("voice_set_user_volume", { userId, volume }),
  voiceSetTalking: (on: boolean) => invoke<void>("voice_set_talking", { on }),
  voiceMicTest: (on: boolean) => invoke<void>("voice_mic_test", { on }),
  mediaSupport: () => invoke<boolean>("media_support"),
  setMiniMode: (on: boolean) => invoke<void>("set_mini_mode", { on }),
  openMedia: (url: string, looped: boolean) => invoke<boolean>("open_media", { url, looped }),
  api: <T = unknown>(method: HttpMethod, path: string, body?: unknown) =>
    invoke<T>("api", { method, path, body: body ?? null }),
  upload: <T = unknown>(path: string, payload: unknown, files: UploadFile[], uploadId?: string) =>
    invoke<T>("api_upload", { path, payload, files, uploadId }),
  fileSizes: (paths: string[]) => invoke<number[]>("file_sizes", { paths }),
  notify: (title: string, body: string, channelId: string, call: boolean) => invoke<void>("notify", { title, body, channelId, call }),
};

/** Compte enregistré sur cet appareil (le token reste côté Rust). */
export interface AccountProfile {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

/** Intégration au bureau, gérée par le Rust (lue avant le chargement de l'interface). */
export interface DesktopPrefs {
  tray: boolean;
  closeToTray: boolean;
  startMinimized: boolean;
}

export interface VoiceConnectParams {
  /** serveur, ou le MP / groupe pour un appel */
  serverId: string;
  channelId: string;
  userId: string;
  sessionId: string;
  token: string;
  endpoint: string;
  selfMute: boolean;
  selfDeaf: boolean;
}

/** Réglages audio (null = périphérique par défaut). */
export interface VoiceConfig {
  input: string | null;
  output: string | null;
  /** seuil de détection de la voix, en dBFS (-100 = toujours transmettre) */
  sensitivity: number;
  push_to_talk: boolean;
  input_gain: number;
  output_volume: number;
  noise_suppression: boolean;
}

/** Micro ou sortie (identifiant PipeWire et nom lisible). */
export interface AudioDevice {
  id: string;
  label: string;
}

export type VoiceEvent =
  | { type: "status"; status: "connecting" | "connected" | "reconnecting" | "disconnected"; message?: string }
  | { type: "speaking"; userId: string; speaking: boolean }
  | { type: "level"; db: number };

export interface UploadFile {
  /** taille en octets (affichage et limite ; ignorée par le Rust) */
  size?: number;
  path?: string;
  /** base64 */
  data?: string;
  name?: string;
}

export type RemoteAuthEvent =
  | { type: "qr"; url: string; svg: string }
  | { type: "pending"; user: { id: string; username: string; avatar: string | null; discriminator: string } }
  | { type: "success" }
  | { type: "cancelled" }
  | { type: "expired" }
  | { type: "error"; message: string };

export const events = {
  onDispatch: (cb: (t: string, d: any) => void): Promise<UnlistenFn> =>
    listen<{ t: string; d: any }>("gateway:dispatch", (e) => cb(e.payload.t, e.payload.d)),
  onStatus: (cb: (state: string) => void) =>
    listen<{ state: string }>("gateway:status", (e) => cb(e.payload.state)),
  onFatal: (cb: (code: number, reason: string) => void) =>
    listen<{ code: number; reason: string }>("gateway:fatal", (e) => cb(e.payload.code, e.payload.reason)),
  onNotifyAction: (cb: (action: string, channelId: string) => void) =>
    listen<{ action: string; channelId: string }>("notify:action", (e) => cb(e.payload.action, e.payload.channelId)),
  onUploadProgress: (cb: (id: string, sent: number, total: number) => void) =>
    listen<{ id: string; sent: number; total: number }>("upload:progress", (e) => cb(e.payload.id, e.payload.sent, e.payload.total)),
  onVoice: (cb: (e: VoiceEvent) => void) => listen<VoiceEvent>("voice:event", (e) => cb(e.payload)),
  onRemoteAuth: (cb: (e: RemoteAuthEvent) => void) =>
    listen<RemoteAuthEvent>("remote_auth", (e) => cb(e.payload)),
};
