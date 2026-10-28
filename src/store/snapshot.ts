// Instantané léger de la session (serveurs, salons visibles, MP récents, amis, non-lus),
// gardé en local pour afficher une interface navigable dès le lancement, avant READY.
// Volontairement réduit : noms, icônes et positions, rien de ce qui change à la seconde.

import { batch } from "solid-js";
import { reconcile } from "solid-js/store";
import { channelGroups, isUnread, mentionCount, permissionsIn, sortedPrivateChannels } from "./selectors";
import { setState, state } from "./state";
import { ui } from "./ui";
import type { Channel, GuildSettings, Message, Presence, ReadState, Relationship, Snowflake, User } from "./types";

/** Un instantané par compte ; le compte actif est mémorisé pour le choisir au lancement. */
const keyFor = (id: Snowflake) => `accord:snapshot:${id}`;
const LEGACY_KEY = "accord:snapshot";
const ACTIVE_KEY = "accord:active";
const VERSION = 2;
/** MP gardés dans l'instantané (les plus récents) */
const MAX_DMS = 60;
/** Salons dont les derniers messages sont gardés (visités récemment), et combien par salon */
const MESSAGE_CHANNELS = 10;
const MESSAGES_PER_CHANNEL = 30;

interface Snapshot {
  v: number;
  meId: Snowflake;
  status: typeof state.status;
  customStatus: string | null;
  users: User[];
  guilds: { id: Snowflake; name: string; icon: string | null }[];
  guildOrder: typeof state.guildOrder;
  channels: Channel[];
  privateChannelIds: Snowflake[];
  relationships: Relationship[];
  readStates: Record<Snowflake, ReadState>;
  guildSettings: Record<Snowflake, GuildSettings>;
  /** statut des amis et correspondants (statut personnalisé compris) */
  presences: Record<Snowflake, Presence>;
  /** derniers messages des salons récents */
  messages: Record<Snowflake, Message[]>;
}

const pickUser = (u: User): User => ({
  id: u.id,
  username: u.username,
  global_name: u.global_name ?? null,
  avatar: u.avatar ?? null,
  discriminator: u.discriminator,
  ...(u.bot ? { bot: true } : {}),
});

/** Message allégé : ce qu'il faut pour l'afficher, sans les objets imbriqués lourds. */
function pickMessage(m: Message): Message {
  const ref = m.referenced_message;
  return {
    id: m.id,
    channel_id: m.channel_id,
    guild_id: m.guild_id,
    author: pickUser(m.author),
    content: m.content,
    timestamp: m.timestamp,
    edited_timestamp: m.edited_timestamp ?? null,
    type: m.type,
    flags: m.flags,
    mention_everyone: m.mention_everyone,
    mentions: m.mentions.map(pickUser),
    mention_roles: m.mention_roles,
    attachments: m.attachments,
    // Les embeds peuvent être volumineux : seuls les petits sont gardés.
    embeds: JSON.stringify(m.embeds ?? []).length < 3000 ? m.embeds : [],
    reactions: m.reactions,
    sticker_items: m.sticker_items,
    message_reference: m.message_reference,
    referenced_message: ref
      ? ({ id: ref.id, channel_id: ref.channel_id, author: pickUser(ref.author), content: ref.content.slice(0, 200), timestamp: ref.timestamp, type: ref.type, mentions: [], mention_roles: [], attachments: [], embeds: [] } as Message)
      : ref,
    message_snapshots: m.message_snapshots,
    poll: m.poll,
  };
}

export function saveSnapshot() {
  if (!state.ready || !state.meId) return;
  const users = new Map<Snowflake, User>();
  const addUser = (id: Snowflake) => {
    const u = state.users[id];
    if (u && !users.has(id)) users.set(id, pickUser(u));
  };
  addUser(state.meId);

  const channels: Channel[] = [];
  const readStates: Record<Snowflake, ReadState> = {};
  const keep = (c: Channel) => {
    if (isUnread(c.id) || mentionCount(c.id) > 0) readStates[c.id] = { ...state.readStates[c.id] };
  };

  for (const gid of Object.keys(state.guilds)) {
    if (state.guilds[gid].unavailable) continue;
    for (const g of channelGroups(gid)) {
      for (const c of g.category ? [g.category, ...g.channels] : g.channels) {
        channels.push({
          id: c.id,
          type: c.type,
          guild_id: gid,
          name: c.name,
          position: c.position,
          parent_id: c.parent_id ?? null,
          last_message_id: c.last_message_id ?? null,
          _perms: permissionsIn(c.id).toString(),
        });
        keep(c);
      }
    }
  }

  const privates = sortedPrivateChannels().slice(0, MAX_DMS);
  for (const c of privates) {
    channels.push({
      id: c.id,
      type: c.type,
      name: c.name,
      icon: c.icon ?? null,
      owner_id: c.owner_id,
      recipient_ids: c.recipient_ids ?? [],
      last_message_id: c.last_message_id ?? null,
    });
    keep(c);
    for (const id of c.recipient_ids ?? []) addUser(id);
  }

  const relationships = Object.values(state.relationships).map((r) => ({ ...r }));
  for (const r of relationships) addUser(r.id);

  // Statuts : amis et correspondants (pas les membres des serveurs, trop nombreux et volatils).
  const presences: Record<Snowflake, Presence> = {};
  for (const id of users.keys()) {
    const p = state.presences[id];
    if (p && p.status !== "offline") presences[id] = { status: p.status, activities: p.activities.filter((a) => a.type === 4).map((a) => ({ ...a })) };
  }

  // Derniers messages des salons visités récemment (puis des MP récents), déjà en mémoire.
  const messages: Record<Snowflake, Message[]> = {};
  const inSnapshot = new Set(channels.map((c) => c.id));
  for (const id of [...ui.history, ...privates.map((c) => c.id)]) {
    if (Object.keys(messages).length >= MESSAGE_CHANNELS) break;
    const bucket = state.messages[id];
    if (!inSnapshot.has(id) || messages[id] || !bucket?.items.length || bucket.detached) continue;
    messages[id] = bucket.items
      .filter((m) => !m._pending && !m._failed)
      .slice(-MESSAGES_PER_CHANNEL)
      .map(pickMessage);
  }

  // Seulement ce qui sert à la sourdine (pastilles de non-lus).
  const guildSettings: Record<Snowflake, GuildSettings> = {};
  for (const [id, s] of Object.entries(state.guildSettings)) {
    const muted = Object.entries(s.channels).filter(([, o]) => o.muted);
    if (s.muted || muted.length) guildSettings[id] = { ...s, channels: Object.fromEntries(muted.map(([cid, o]) => [cid, { ...o }])) };
  }

  const snap: Snapshot = {
    v: VERSION,
    meId: state.meId,
    status: state.status,
    customStatus: state.customStatus,
    users: [...users.values()],
    guilds: Object.values(state.guilds)
      .filter((g) => !g.unavailable)
      .map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
    guildOrder: JSON.parse(JSON.stringify(state.guildOrder)),
    channels,
    privateChannelIds: privates.map((c) => c.id),
    relationships,
    readStates,
    guildSettings,
    presences,
    messages,
  };
  try {
    localStorage.setItem(keyFor(state.meId), JSON.stringify(snap));
    localStorage.setItem(ACTIVE_KEY, state.meId);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* stockage plein ou indisponible : on s'en passe */
  }
}

/** Remplit l'état depuis l'instantané du compte (par défaut le dernier actif). */
export function loadSnapshot(accountId?: Snowflake): boolean {
  let snap: Snapshot | null = null;
  try {
    const id = accountId ?? localStorage.getItem(ACTIVE_KEY);
    // Ancien emplacement (un seul compte) : repris tant que le nouveau n'existe pas.
    snap = JSON.parse((id && localStorage.getItem(keyFor(id))) || localStorage.getItem(LEGACY_KEY) || "null");
    if (snap && id && snap.meId !== id) snap = null;
  } catch {
    return false;
  }
  // v1 (sans messages ni statuts) reste lisible : pas de démarrage à vide après mise à jour.
  if (!snap || snap.v < 1 || snap.v > VERSION || !snap.meId) return false;
  const s = snap;

  const guildChannels: Record<Snowflake, Snowflake[]> = {};
  for (const c of s.channels) if (c.guild_id) (guildChannels[c.guild_id] ??= []).push(c.id);

  batch(() => {
    setState({
      cached: true,
      meId: s.meId,
      status: s.status,
      customStatus: s.customStatus,
      users: Object.fromEntries(s.users.map((u) => [u.id, u])),
      guilds: Object.fromEntries(
        s.guilds.map((g) => [g.id, { ...g, owner_id: "", features: [], roles: {}, emojis: [] }]),
      ),
      guildOrder: s.guildOrder,
      channels: Object.fromEntries(s.channels.map((c) => [c.id, { topic: null, ...c }])),
      guildChannels,
      privateChannelIds: s.privateChannelIds,
      relationships: Object.fromEntries(s.relationships.map((r) => [r.id, r])),
      readStates: s.readStates,
      guildSettings: s.guildSettings,
      presences: s.presences ?? {},
      messages: Object.fromEntries(
        Object.entries(s.messages ?? {}).map(([id, items]) => [id, { items, hasMore: true, loading: false, stale: true }]),
      ),
    });
  });
  return true;
}

/** À la réception de READY : on repart des vraies données (serveurs quittés, salons supprimés…). */
export function dropSnapshotData() {
  setState("guilds", reconcile({}));
  setState("channels", reconcile({}));
  setState("guildChannels", reconcile({}));
  setState("threads", reconcile({}));
  // Statuts de l'instantané : remplacés par ceux de READY (qui n'envoie que les présents).
  setState("presences", reconcile({}));
  setState("cached", false);
}

export function clearSnapshot(accountId: Snowflake | null) {
  try {
    if (accountId) localStorage.removeItem(keyFor(accountId));
    localStorage.removeItem(LEGACY_KEY);
    if (localStorage.getItem(ACTIVE_KEY) === accountId) localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignoré */
  }
}

/** Compte à afficher au prochain lancement. */
export function setActiveAccount(id: Snowflake | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignoré */
  }
}
