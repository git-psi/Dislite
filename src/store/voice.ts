// Session vocale de cet appareil (salon rejoint, état de la connexion, qui parle).

import { createStore } from "solid-js/store";
import type { Snowflake } from "./types";

export type VoiceStatus = "joining" | "connecting" | "connected" | "reconnecting";

export interface VoiceSession {
  guildId: Snowflake | null;
  channelId: Snowflake;
  status: VoiceStatus;
}

export interface VoiceStore {
  session: VoiceSession | null;
  selfMute: boolean;
  selfDeaf: boolean;
  /** personnes qui parlent dans notre salon (nous compris) */
  speaking: Record<Snowflake, boolean>;
  /** appels entrants refusés (on ne les fait plus sonner) */
  declined: Record<Snowflake, true>;
}

const KEY = "accord:voice";
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
})();

export const [voice, setVoice] = createStore<VoiceStore>({
  session: null,
  selfMute: !!saved.selfMute,
  selfDeaf: !!saved.selfDeaf,
  speaking: {},
  declined: {},
});

export function saveVoicePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ selfMute: voice.selfMute, selfDeaf: voice.selfDeaf }));
  } catch {
    /* stockage indisponible */
  }
}
