// Vocal : rejoindre / quitter un salon, appels en MP et groupe.
// Même enchaînement que le client officiel : on annonce l'état vocal à la gateway (op 4),
// Discord répond par notre VOICE_STATE_UPDATE (session) et un VOICE_SERVER_UPDATE (jeton,
// serveur) ; le moteur vocal Rust se connecte alors au serveur vocal.

import { createSignal } from "solid-js";
import { produce } from "solid-js/store";
import { backend, errorMessage, events } from "../ipc/tauri";
import { settings } from "../store/settings";
import { state } from "../store/state";
import type { Snowflake } from "../store/types";
import { toast } from "../store/ui";
import { saveVoicePrefs, setVoice, voice } from "../store/voice";
import { playSound } from "../lib/sounds";

const OP_VOICE_STATE_UPDATE = 4;

/** Ce qu'il manque pour se connecter au serveur vocal. */
let pending: { sessionId?: string; server?: { token: string; endpoint: string; serverId: Snowflake } } = {};
/** Appel lancé par nous : on fait sonner les autres dès qu'il existe. */
let ringOnCreate: Snowflake | null = null;
/** Dernier serveur vocal utilisé (pour ignorer une annonce en double). */
let lastServer = "";

function sendVoiceState(guildId: Snowflake | null, channelId: Snowflake | null) {
  return backend.gatewaySend(OP_VOICE_STATE_UPDATE, {
    guild_id: guildId,
    channel_id: channelId,
    self_mute: voice.selfMute,
    self_deaf: voice.selfDeaf,
    self_video: false,
  });
}

export const inVoice = (channelId: Snowflake) => voice.session?.channelId === channelId;

export function joinVoice(channelId: Snowflake) {
  if (inVoice(channelId)) return;
  const guildId = state.channels[channelId]?.guild_id ?? null;
  // Changer de salon : Discord déplace la session, le moteur se reconnecte au nouveau serveur.
  pending = {};
  lastServer = "";
  setVoice({ session: { guildId, channelId, status: "joining" }, speaking: {} });
  void sendVoiceState(guildId, channelId);
}

export function leaveVoice() {
  const s = voice.session;
  if (!s) return;
  playSound("disconnected");
  pending = {};
  ringOnCreate = null;
  setVoice({ session: null, speaking: {} });
  void sendVoiceState(s.guildId, null);
  void backend.voiceDisconnect().catch(() => {});
}

function tryConnect() {
  const s = voice.session;
  if (!s || !pending.sessionId || !pending.server || !state.meId) return;
  const { token, endpoint, serverId } = pending.server;
  pending.server = undefined;
  setVoice("session", "status", "connecting");
  backend
    .voiceConnect({
      serverId,
      channelId: s.channelId,
      userId: state.meId,
      sessionId: pending.sessionId,
      token,
      endpoint,
      selfMute: voice.selfMute,
      selfDeaf: voice.selfDeaf,
    })
    .catch((e) => {
      toast(`Voice: ${errorMessage(e)}`, true);
      leaveVoice();
    });
}

/** Notre état vocal, confirmé par Discord (ou modifié : déplacé, expulsé). */
export function onOwnVoiceState(d: any) {
  const s = voice.session;
  if (!s) return;
  if (!d.channel_id) {
    // Expulsé du salon ou appel terminé ailleurs.
    pending = {};
    setVoice({ session: null, speaking: {} });
    void backend.voiceDisconnect().catch(() => {});
    return;
  }
  if (d.channel_id !== s.channelId) setVoice("session", { channelId: d.channel_id, guildId: d.guild_id ?? null });
  pending.sessionId = d.session_id;
  tryConnect();
}

export function onVoiceServer(d: any) {
  if (!voice.session || !d.token) return;
  // Pas encore de serveur attribué : Discord renverra un VOICE_SERVER_UPDATE.
  if (!d.endpoint) return;
  // Discord renvoie parfois le même serveur (appels privés) : une seconde connexion ferait
  // fermer la première par le serveur vocal.
  const key = `${d.endpoint}|${d.token}`;
  if (key === lastServer && voice.session.status !== "joining") return;
  lastServer = key;
  pending.server = { token: d.token, endpoint: d.endpoint, serverId: d.guild_id ?? d.channel_id };
  tryConnect();
}

// ---------------------------------------------------------------- muet / sourdine

export function toggleMute() {
  // Réactiver le micro pendant la sourdine réactive aussi le son, comme partout.
  const mute = !voice.selfMute;
  playSound(mute ? "mute" : voice.selfDeaf ? "undeafen" : "unmute");
  setVoice({ selfMute: mute, selfDeaf: mute ? voice.selfDeaf : false });
  applySelfState();
}

export function toggleDeaf() {
  const deaf = !voice.selfDeaf;
  playSound(deaf ? "deafen" : "undeafen");
  setVoice({ selfDeaf: deaf, selfMute: deaf ? true : voice.selfMute });
  applySelfState();
}

function applySelfState() {
  saveVoicePrefs();
  void backend.voiceSetMute(voice.selfMute).catch(() => {});
  void backend.voiceSetDeaf(voice.selfDeaf).catch(() => {});
  const s = voice.session;
  if (s) void sendVoiceState(s.guildId, s.channelId);
}

// ---------------------------------------------------------------- appels

/** Lance (ou rejoint) l'appel d'un MP / groupe. */
export function startCall(channelId: Snowflake) {
  if (!state.calls[channelId]) ringOnCreate = channelId;
  joinVoice(channelId);
}

export function declineCall(channelId: Snowflake) {
  setVoice("declined", channelId, true);
  if (!state.meId) return;
  void backend.api("POST", `/channels/${channelId}/call/stop-ringing`, { recipients: [state.meId] }).catch(() => {});
}

export function onCallChange(channelId: Snowflake) {
  const call = state.calls[channelId];
  // Appel terminé : on oublie le refus, le prochain sonnera de nouveau.
  if (!call && voice.declined[channelId]) setVoice("declined", produce((d) => void delete d[channelId]));
  if (call && ringOnCreate === channelId) {
    ringOnCreate = null;
    void backend.api("POST", `/channels/${channelId}/call/ring`, { recipients: null }).catch(() => {});
  }
}

/** Appel qui nous fait sonner (et que l'on n'a ni rejoint ni refusé). */
export function incomingCall(): Snowflake | null {
  if (!state.meId) return null;
  for (const call of Object.values(state.calls)) {
    if (call.ringing.includes(state.meId) && !inVoice(call.channel_id) && !voice.declined[call.channel_id]) return call.channel_id;
  }
  return null;
}

// ---------------------------------------------------------------- moteur

export const voiceConfig = () => ({
  input: settings.voiceInput,
  output: settings.voiceOutput,
  // Tout en bas : transmission permanente.
  sensitivity: settings.voiceSensitivity <= -90 ? -200 : settings.voiceSensitivity,
  push_to_talk: settings.voicePtt,
  input_gain: settings.voiceInputGain,
  output_volume: settings.voiceOutputVolume,
  noise_suppression: settings.voiceNoiseSuppression,
  echo_cancellation: settings.voiceEchoCancellation,
});

// ---------------------------------------------------------------- volumes

const VOLUMES_KEY = "accord:volumes";
const volumes: Record<Snowflake, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(VOLUMES_KEY) ?? "{}");
  } catch {
    return {};
  }
})();

export const userVolume = (userId: Snowflake) => volumes[userId] ?? 1;

export function setUserVolume(userId: Snowflake, volume: number) {
  volumes[userId] = volume;
  try {
    localStorage.setItem(VOLUMES_KEY, JSON.stringify(volumes));
  } catch {
    /* stockage indisponible */
  }
  void backend.voiceSetUserVolume(userId, volume).catch(() => {});
}

// ---------------------------------------------------------------- appui-pour-parler

let talking = false;
function setTalking(on: boolean) {
  if (talking === on) return;
  talking = on;
  void backend.voiceSetTalking(on).catch(() => {});
}

/** Touche d'appui-pour-parler (fenêtre active seulement). */
function listenPushToTalk() {
  const match = (e: KeyboardEvent) => settings.voicePtt && !!voice.session && e.code === settings.voicePttKey;
  document.addEventListener("keydown", (e) => {
    if (!match(e)) return;
    e.preventDefault();
    setTalking(true);
  }, true);
  document.addEventListener("keyup", (e) => {
    if (!match(e)) return;
    e.preventDefault();
    setTalking(false);
  }, true);
  window.addEventListener("blur", () => setTalking(false));
}

/** Niveau du micro pendant le test (réglages). */
export const [micLevel, setMicLevel] = createSignal<number | null>(null);

/** Écoute les événements du moteur vocal (état de la connexion, qui parle). */
export async function startVoiceEvents() {
  listenPushToTalk();
  for (const [id, v] of Object.entries(volumes)) void backend.voiceSetUserVolume(id, v).catch(() => {});
  await events.onVoice((e) => {
    if (e.type === "level") {
      setMicLevel(e.db);
      return;
    }
    if (e.type === "speaking") {
      setVoice("speaking", e.userId, e.speaking);
      return;
    }
    if (!voice.session) return;
    if (e.status === "disconnected") {
      if (e.message) toast(`Voice: ${e.message}`, true);
      leaveVoice();
    } else {
      if (e.status === "connected" && voice.session.status !== "connected") playSound("connected");
      setVoice("session", "status", e.status);
    }
  });
  void backend.voiceSetConfig(voiceConfig()).catch(() => {});
}
