// Cycle de vie de la connexion gateway et opcodes envoyés par le client.

import type { UnlistenFn } from "@tauri-apps/api/event";
import { devFlags } from "../lib/devFlags";
import { backend, events } from "../ipc/tauri";
import { settings } from "../store/settings";
import { setState, state } from "../store/state";
import type { ConnectionState, Snowflake, Status } from "../store/types";
import { dispatch } from "./dispatcher";
import "./handlers";

const OP_PRESENCE_UPDATE = 3;
const OP_GUILD_SUBSCRIPTIONS_BULK = 37;

let unlisteners: UnlistenFn[] = [];
let onFatal: (() => void) | null = null;
const reconnectedCallbacks: (() => void)[] = [];

/** Appelé à chaque READY/RESUMED (ex. pour se réabonner au serveur affiché). */
export function onConnected(cb: () => void) {
  reconnectedCallbacks.push(cb);
}

export async function startGateway(handlers: { onAuthFailed: () => void }) {
  await stopGateway();
  onFatal = handlers.onAuthFailed;
  unlisteners = await Promise.all([
    events.onDispatch((t, d) => {
      dispatch(t, d);
      if (t === "READY" || t === "RESUMED") reconnectedCallbacks.forEach((cb) => cb());
    }),
    events.onStatus((s) => setState("connection", s as ConnectionState)),
    events.onFatal((code) => {
      if (code === 4004) onFatal?.();
    }),
  ]);
  await backend.gatewayConnect();
}

export async function stopGateway() {
  unlisteners.forEach((u) => u());
  unlisteners = [];
}

/** Présence : statut, statut personnalisé et activité choisie dans les réglages. */
export function sendPresence(status: Status, customStatus?: string | null, afk = false) {
  if (devFlags.demo) return Promise.resolve();
  const activities: unknown[] = customStatus ? [{ type: 4, name: "Custom Status", state: customStatus }] : [];
  const name = settings.activityName.trim();
  if (name) activities.push({ type: settings.activityType, name, created_at: Date.now() });
  return backend.gatewaySend(OP_PRESENCE_UPDATE, { status, since: afk ? Date.now() : 0, activities, afk });
}

/**
 * Abonnement aux événements d'un serveur (frappe, activités, fils) et à la
 * liste des membres d'un salon, comme le fait le client officiel à l'ouverture.
 */
export function subscribeGuild(guildId: Snowflake, channelId: Snowflake | null, memberRanges: [number, number][] = [[0, 99]]) {
  if (state.connection !== "connected" || devFlags.demo) return;
  const sub: Record<string, unknown> = { typing: true, activities: true, threads: true };
  if (channelId) sub.channels = { [channelId]: memberRanges };
  return backend.gatewaySend(OP_GUILD_SUBSCRIPTIONS_BULK, { subscriptions: { [guildId]: sub } });
}
