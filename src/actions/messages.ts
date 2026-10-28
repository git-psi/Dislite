// Actions liées aux messages : chargement, envoi, édition, réactions, lecture.

import { createStore, produce } from "solid-js/store";
import { reactionKey } from "../lib/cdn";
import { devFlags } from "../lib/devFlags";
import { DISCORD_EPOCH, isNewer, makeNonce } from "../lib/snowflake";
import { settings } from "../store/settings";
import { backend, errorMessage, events, type UploadFile } from "../ipc/tauri";
import {
  ingestMessage,
  addFetchedMessages,
  addPendingMessage,
  ensureMessageBucket,
  insertMessage,
  markReadLocally,
  patchMessage,
} from "../store/mutations";
import { me, setState, state } from "../store/state";
import type { Emoji, Message, Snowflake } from "../store/types";
import { setUi, toast, ui } from "../store/ui";

const PAGE_SIZE = 50;

// ---------------------------------------------------------------- salons 18+

/** Comptes pour lesquels Discord refuse les salons 18+ (retenu d'un lancement à l'autre :
 *  sinon le bouton « prochain non-lu » y retomberait à chaque fois). */
const NSFW_BLOCKED_KEY = "accord:nsfwBlocked";

function nsfwBlockedAccounts(): Snowflake[] {
  try {
    const list = JSON.parse(localStorage.getItem(NSFW_BLOCKED_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** À READY : `nsfw_allowed` explicitement faux, ou refus déjà constaté pour ce compte. */
export function initNsfwBlocked(user: { id: Snowflake; nsfw_allowed?: boolean | null }) {
  setState("nsfwBlocked", user.nsfw_allowed === false || nsfwBlockedAccounts().includes(user.id));
}

export function setNsfwBlocked(on: boolean) {
  setState("nsfwBlocked", on);
  const id = state.meId;
  if (!id) return;
  const others = nsfwBlockedAccounts().filter((a) => a !== id);
  try {
    localStorage.setItem(NSFW_BLOCKED_KEY, JSON.stringify(on ? [...others, id] : others));
  } catch {
    /* stockage plein */
  }
}

/** Refus de Discord pour un contenu 18+ (âge non vérifié). */
const AGE_GATED = 50269;

export async function loadMessages(channelId: Snowflake, older = false) {
  const bucket = state.messages[channelId];
  if (bucket?.loading) return;
  if (older && (!bucket?.hasMore || !bucket.items.length)) return;

  ensureMessageBucket(channelId);
  setState("messages", channelId, "loading", true);
  const before = older ? state.messages[channelId].items.find((m) => !m._pending)?.id : undefined;
  try {
    const query = `limit=${PAGE_SIZE}${before ? `&before=${before}` : ""}`;
    const res = await backend.api<any[]>("GET", `/channels/${channelId}/messages?${query}`);
    addFetchedMessages(channelId, res, res.length === PAGE_SIZE, older);
  } catch (e) {
    // Hors ligne ou refus : on garde les messages en cache sans réessayer en boucle.
    setState("messages", channelId, { loading: false, stale: false });
    if ((e as any)?.code === AGE_GATED) setNsfwBlocked(true);
    // 403 = pas d'accès à l'historique : pas besoin d'alerter.
    else if ((e as any)?.status !== 403) toast(`Couldn't load: ${errorMessage(e)}`, true);
    setState("messages", channelId, "hasMore", false);
  }
}

/** Progression des envois de fichiers en cours (0 à 1), par nonce du message. */
export const [uploads, setUploads] = createStore<Record<string, number>>({});
void events.onUploadProgress((id, sent, total) => setUploads(id, total ? sent / total : 0));

/** Limite d'envoi de Discord selon l'abonnement (octets). */
export const uploadLimit = () => {
  const t = me()?.premium_type;
  return (t === 2 ? 500 : t === 3 ? 50 : 10) * 1024 * 1024;
};

export async function sendMessage(channelId: Snowflake, content: string, files: UploadFile[] = []) {
  const author = me();
  if (!author || (!content.trim() && !files.length)) return;

  const nonce = makeNonce();
  const reply = ui.replyTo[channelId];
  const channel = state.channels[channelId];
  const payload: Record<string, unknown> = {
    content,
    nonce,
    tts: false,
    flags: 0,
    mobile_network_type: "unknown",
  };
  if (reply) {
    payload.message_reference = { channel_id: channelId, message_id: reply.messageId, guild_id: channel?.guild_id };
    if (!reply.mention) payload.allowed_mentions = { parse: ["users", "roles", "everyone"], replied_user: false };
  }

  const referenced = reply ? state.messages[channelId]?.items.find((m) => m.id === reply.messageId) : undefined;
  addPendingMessage({
    id: nonce,
    nonce,
    channel_id: channelId,
    guild_id: channel?.guild_id,
    author: { ...author },
    content,
    timestamp: new Date().toISOString(),
    type: reply ? 19 : 0,
    mentions: [],
    mention_roles: [],
    attachments: files.map((f, i) => ({
      id: `${nonce}-${i}`,
      filename: f.name ?? f.path?.split("/").pop() ?? "fichier",
      size: 0,
      url: "",
      proxy_url: "",
    })),
    embeds: [],
    referenced_message: referenced ? { ...referenced } : undefined,
    _pending: true,
  });
  setUi("replyTo", channelId, undefined);
  typingSentAt.delete(channelId);

  try {
    const path = `/channels/${channelId}/messages`;
    const msg = files.length ? await backend.upload(path, payload, files, nonce) : await backend.api("POST", path, payload);
    insertMessage(msg);
  } catch (e) {
    patchMessage(channelId, nonce, { _pending: false, _failed: true });
    toast(`Message not sent: ${errorMessage(e)}`, true);
  } finally {
    if (files.length) setUploads(produce((u) => void delete u[nonce]));
  }
}

export function discardFailed(channelId: Snowflake, nonce: string) {
  setState("messages", channelId, "items", (items) => items.filter((m) => m.nonce !== nonce || !m._failed));
}

export async function editMessage(msg: Message, content: string) {
  setUi("editingId", null);
  if (content === msg.content) return;
  try {
    await backend.api("PATCH", `/channels/${msg.channel_id}/messages/${msg.id}`, { content });
  } catch (e) {
    toast(`Couldn't edit: ${errorMessage(e)}`, true);
  }
}

export async function deleteMessage(msg: Message) {
  try {
    await backend.api("DELETE", `/channels/${msg.channel_id}/messages/${msg.id}`);
  } catch (e) {
    toast(`Couldn't delete: ${errorMessage(e)}`, true);
  }
}

export async function toggleReaction(msg: Message, emoji: Emoji) {
  const existing = msg.reactions?.find((r) => (emoji.id ? r.emoji.id === emoji.id : r.emoji.name === emoji.name));
  const path = `/channels/${msg.channel_id}/messages/${msg.id}/reactions/${reactionKey(emoji)}/@me`;
  try {
    if (existing?.me) await backend.api("DELETE", `${path}?location=Message&burst=false`);
    else await backend.api("PUT", `${path}?location=Message&type=0`);
  } catch (e) {
    toast(`Couldn't react: ${errorMessage(e)}`, true);
  }
}

// ---------------------------------------------------------------- indicateur de frappe

const typingSentAt = new Map<Snowflake, number>();

/** Envoie l'indicateur « en train d'écrire » au plus toutes les 8 s. */
export function notifyTyping(channelId: Snowflake) {
  if (devFlags.readOnly || !settings.sendTyping) return;
  const last = typingSentAt.get(channelId) ?? 0;
  if (Date.now() - last < 8000) return;
  typingSentAt.set(channelId, Date.now());
  backend.api("POST", `/channels/${channelId}/typing`).catch(() => {});
}

// ---------------------------------------------------------------- lecture

const ackTimers = new Map<Snowflake, number>();

/** Marque le salon comme lu ; l'appel réseau est regroupé (1 s) pour éviter le spam. */
export function ackChannel(channelId: Snowflake) {
  if (devFlags.readOnly) return;
  const last = state.channels[channelId]?.last_message_id;
  if (!last) return;
  const rs = state.readStates[channelId];
  if (rs && !isNewer(last, rs.last_message_id) && !rs.mention_count) return;
  markReadLocally(channelId, last);

  clearTimeout(ackTimers.get(channelId));
  ackTimers.set(
    channelId,
    window.setTimeout(() => {
      ackTimers.delete(channelId);
      const id = state.readStates[channelId]?.last_message_id;
      if (!id) return;
      const lastViewed = Math.floor((Date.now() - DISCORD_EPOCH) / 86_400_000);
      backend
        .api("POST", `/channels/${channelId}/messages/${id}/ack`, { token: null, last_viewed: lastViewed })
        .catch((e) => console.warn("ack failed", e));
    }, 1000),
  );
}

/** Marque tous les salons d'un serveur comme lus en une seule requête. */
export async function ackGuild(guildId: Snowflake) {
  const targets: { channel_id: Snowflake; message_id: Snowflake; read_state_type: 0 }[] = [];
  for (const cid of state.guildChannels[guildId] ?? []) {
    for (const id of [cid, ...(state.threads[cid] ?? [])]) {
      const last = state.channels[id]?.last_message_id;
      const rs = state.readStates[id];
      if (last && rs && (isNewer(last, rs.last_message_id) || rs.mention_count)) {
        targets.push({ channel_id: id, message_id: last, read_state_type: 0 });
      }
    }
  }
  if (!targets.length) return;
  for (const t of targets) markReadLocally(t.channel_id, t.message_id);
  if (devFlags.readOnly) return;
  try {
    // L'API limite chaque requête à 100 salons.
    for (let i = 0; i < targets.length; i += 100) {
      await backend.api("POST", "/read-states/ack-bulk", { read_states: targets.slice(i, i + 100) });
    }
  } catch (e) {
    toast(`Couldn't mark everything as read: ${errorMessage(e)}`, true);
  }
}

// ---------------------------------------------------------------- épinglés et saut

export async function fetchPins(channelId: Snowflake): Promise<Message[]> {
  try {
    const res = await backend.api<any>("GET", `/channels/${channelId}/messages/pins?limit=50`);
    return (res.items ?? []).map((it: any) => ingestMessage(it.message));
  } catch {
    // Ancien endpoint, encore servi par Discord.
    const res = await backend.api<any[]>("GET", `/channels/${channelId}/pins`);
    return res.map(ingestMessage);
  }
}

/** Affiche un message précis, en chargeant l'historique autour si besoin. */
export async function jumpToMessage(
  channelId: Snowflake,
  messageId: Snowflake,
  /** sans `offset` : message centré et mis en surbrillance ; avec : placé à cette distance du haut */
  opts: { offset?: number } = {},
) {
  if (!state.messages[channelId]?.items.some((m) => m.id === messageId)) {
    try {
      const res = await backend.api<any[]>("GET", `/channels/${channelId}/messages?around=${messageId}&limit=50`);
      const items = res.map(ingestMessage).reverse();
      setState("messages", channelId, { items, hasMore: true, loading: false, detached: true });
    } catch (e) {
      toast(`Message not found: ${errorMessage(e)}`, true);
      return;
    }
  }
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`.message[data-mid="${messageId}"]`);
    if (!el) return;
    if (opts.offset !== undefined) {
      const scroller = el.closest<HTMLElement>(".messages-scroller")!;
      scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - opts.offset;
      return;
    }
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  }, 60);
}

/** Revient à la fin du salon (recharge si l'historique est détaché). */
export function backToPresent(channelId: Snowflake) {
  if (state.messages[channelId]?.detached) setState("messages", produce((m) => void delete m[channelId]));
}
