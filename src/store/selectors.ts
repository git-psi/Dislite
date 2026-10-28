// Données dérivées du store (noms, couleurs, permissions, non-lus…).

import { keyedMemo } from "../lib/keyedMemo";
import { channelPermissions, has, P } from "../lib/permissions";
import { compareSnowflakes, isNewer } from "../lib/snowflake";
import { unmutedChannels } from "./muteExceptions";
import { ui } from "./ui";
import { state } from "./state";
import type { Channel, GuildListItem, Member, Snowflake, User } from "./types";
import { ChannelType, isForumLike, isThread, isVoiceLike } from "./types";

// ---------------------------------------------------------------- personnes

export const userName = (u?: User) => u?.global_name || u?.username || "Unknown user";

export function member(guildId: Snowflake | undefined, userId: Snowflake): Member | undefined {
  return guildId ? state.members[guildId]?.[userId] : undefined;
}

export function displayName(userId: Snowflake, guildId?: Snowflake) {
  const m = member(guildId, userId);
  const rel = state.relationships[userId];
  return m?.nick || rel?.nickname || userName(state.users[userId]);
}

/** Couleur du rôle coloré le plus haut, en hex CSS. */
export function memberColor(guildId: Snowflake | undefined, userId: Snowflake): string | undefined {
  const m = member(guildId, userId);
  const guild = guildId ? state.guilds[guildId] : undefined;
  if (!m || !guild) return undefined;
  let best: { pos: number; color: number } | undefined;
  for (const id of m.roles) {
    const r = guild.roles[id];
    const color = r?.colors?.primary_color || r?.color;
    if (r && color && (!best || r.position > best.pos)) best = { pos: r.position, color };
  }
  return best ? `#${best.color.toString(16).padStart(6, "0")}` : undefined;
}

export function statusOf(userId: Snowflake) {
  // Notre propre statut ne vient pas des présences mais des réglages de session.
  if (userId === state.meId) return state.status === "invisible" ? "offline" : state.status;
  return state.presences[userId]?.status ?? "offline";
}

export function customStatusOf(userId: Snowflake) {
  return state.presences[userId]?.activities.find((a) => a.type === 4)?.state ?? null;
}

// ---------------------------------------------------------------- permissions

export function permissionsIn(channelId: Snowflake): bigint {
  const ch = state.channels[channelId];
  if (!ch?.guild_id) return ~0n; // MP : tout est permis
  if (ch._perms !== undefined) return BigInt(ch._perms); // instantané, avant READY
  const guild = state.guilds[ch.guild_id];
  const meId = state.meId;
  if (!guild || !meId) return 0n;
  return channelPermissions(guild, ch, member(guild.id, meId), meId, (id) => state.channels[id]);
}

export const can = (channelId: Snowflake, flag: bigint) => has(permissionsIn(channelId), flag);

const visibleIds = keyedMemo((guildId: Snowflake) =>
  (state.guildChannels[guildId] ?? []).filter((id) => {
    const ch = state.channels[id];
    return ch && (ch.type === ChannelType.Category || can(id, P.VIEW_CHANNEL));
  }),
);

export interface ChannelGroup {
  category: Channel | null;
  channels: Channel[];
}

const byPosition = (a: Channel, b: Channel) => {
  // Les salons vocaux/scène viennent après les salons textuels, comme dans l'officiel.
  const va = isVoiceLike(a) ? 1 : 0;
  const vb = isVoiceLike(b) ? 1 : 0;
  return va - vb || (a.position ?? 0) - (b.position ?? 0) || compareSnowflakes(a.id, b.id);
};

/** Salons visibles, groupés par catégorie et triés. */
export const channelGroups = keyedMemo((guildId: Snowflake): ChannelGroup[] => {
  const ids = visibleIds(guildId);
  const channels = ids.map((id) => state.channels[id]).filter(Boolean);
  const categories = channels.filter((c) => c.type === ChannelType.Category).sort(byPosition);
  const byParent = new Map<Snowflake | null, Channel[]>();
  for (const c of channels) {
    if (c.type === ChannelType.Category) continue;
    const key = c.parent_id && categories.some((cat) => cat.id === c.parent_id) ? c.parent_id : null;
    const list = byParent.get(key) ?? [];
    list.push(c);
    byParent.set(key, list);
  }
  const groups: ChannelGroup[] = [];
  const orphans = byParent.get(null);
  if (orphans) groups.push({ category: null, channels: orphans.sort(byPosition) });
  for (const cat of categories) {
    const list = byParent.get(cat.id);
    if (list?.length) groups.push({ category: cat, channels: list.sort(byPosition) });
  }
  return groups;
});

/** Salon à ouvrir dans un serveur : mention, sinon non-lu, sinon le premier salon textuel. */
export function defaultChannel(guildId: Snowflake): Snowflake | null {
  const candidates = channelGroups(guildId)
    .flatMap((g) => g.channels)
    .filter((c) => c.type === 0 || c.type === 5 || isForumLike(c));
  const pick =
    candidates.find((c) => mentionCount(c.id) > 0) ??
    candidates.find((c) => !isForumLike(c) && isUnread(c.id) && !isChannelMuted(c.id)) ??
    candidates[0];
  return pick?.id ?? null;
}

export function activeThreads(parentId: Snowflake, onlyJoined = true): Channel[] {
  return (state.threads[parentId] ?? [])
    .map((id) => state.channels[id])
    .filter((t) => t && !t.thread_metadata?.archived && (!onlyJoined || state.joinedThreads[t.id]))
    .sort((a, b) => compareSnowflakes(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}

// ---------------------------------------------------------------- muet / notifications

export function isGuildMuted(guildId: Snowflake) {
  return !!state.guildSettings[guildId]?.muted;
}

/** Sourdine explicite du salon (ou de sa catégorie / son salon parent), sans tenir compte du serveur. */
export function isChannelMutedItself(channelId: Snowflake): boolean {
  const ch = state.channels[channelId];
  if (!ch) return false;
  const settings = state.guildSettings[ch.guild_id ?? "@me"];
  if (!settings) return false;
  if (settings.channels[channelId]?.muted) return true;
  if (ch.parent_id && settings.channels[ch.parent_id]?.muted) return true;
  const parent = ch.parent_id ? state.channels[ch.parent_id] : undefined;
  return !!(parent?.parent_id && settings.channels[parent.parent_id]?.muted);
}

/** Sourdine effective : salon, catégorie ou serveur, sauf exception locale. */
export function isChannelMuted(channelId: Snowflake): boolean {
  if (unmutedChannels[channelId]) return false;
  if (isChannelMutedItself(channelId)) return true;
  const gid = state.channels[channelId]?.guild_id;
  return !!gid && isGuildMuted(gid);
}

// ---------------------------------------------------------------- non-lus

/** Salon (ou fil d'un salon) 18+ que Discord refuse à ce compte : ni lisible, ni marquable comme lu. */
export function isAgeBlocked(channelId: Snowflake): boolean {
  if (!state.nsfwBlocked) return false;
  const ch = state.channels[channelId];
  return !!ch && (!!ch.nsfw || !!(ch.parent_id && state.channels[ch.parent_id]?.nsfw));
}

export function isUnread(channelId: Snowflake): boolean {
  const ch = state.channels[channelId];
  if (!ch?.last_message_id || isAgeBlocked(channelId)) return false;
  const rs = state.readStates[channelId];
  // Pas d'état de lecture : on considère le salon comme lu (comme l'officiel pour les anciens salons).
  if (!rs) return false;
  return isNewer(ch.last_message_id, rs.last_message_id);
}

export const mentionCount = (channelId: Snowflake) =>
  isAgeBlocked(channelId) ? 0 : state.readStates[channelId]?.mention_count ?? 0;

export const guildUnread = keyedMemo((guildId: Snowflake) => {
  let unread = false;
  let mentions = 0;
  for (const id of visibleIds(guildId)) {
    const ch = state.channels[id];
    if (!ch || ch.type === ChannelType.Category || isVoiceLike(ch)) continue;
    mentions += mentionCount(id);
    if (!unread && !isChannelMuted(id) && isUnread(id)) unread = true;
    for (const tid of state.threads[id] ?? []) {
      if (!state.joinedThreads[tid]) continue;
      mentions += mentionCount(tid);
      if (!unread && isUnread(tid)) unread = true;
    }
  }
  return { unread, mentions };
});

/** Tous les salons et MP à lire, hors sourdine ; mentions d'abord, puis les plus récents. */
export const unreadChannels = keyedMemo((_all: "all"): Snowflake[] => {
  const out: Channel[] = [];
  const consider = (id: Snowflake) => {
    const ch = state.channels[id];
    if (ch && (mentionCount(id) > 0 || (isUnread(id) && !isChannelMuted(id)))) out.push(ch);
  };
  for (const gid of Object.keys(state.guilds)) {
    // Serveur masqué : hors du compteur et de l'accueil (toujours joignable par Ctrl+K).
    if (ui.hiddenGuilds[gid]) continue;
    for (const id of visibleIds(gid)) {
      const ch = state.channels[id];
      if (!ch || ch.type === ChannelType.Category || isVoiceLike(ch)) continue;
      consider(id);
      for (const tid of state.threads[id] ?? []) if (state.joinedThreads[tid]) consider(tid);
    }
  }
  for (const id of state.privateChannelIds) consider(id);
  return out
    .sort((a, b) => mentionCount(b.id) - mentionCount(a.id) || compareSnowflakes(b.last_message_id, a.last_message_id))
    .map((c) => c.id);
});

export function categoryUnread(channels: Channel[]) {
  return channels.some((c) => !isVoiceLike(c) && !isChannelMuted(c.id) && isUnread(c.id));
}

// ---------------------------------------------------------------- MP

export function sortedPrivateChannels(): Channel[] {
  return state.privateChannelIds
    .map((id) => state.channels[id])
    .filter(Boolean)
    .sort((a, b) => compareSnowflakes(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}

export function privateChannelName(ch: Channel): string {
  if (ch.name) return ch.name;
  const names = (ch.recipient_ids ?? []).map((id) => displayName(id));
  return names.join(", ") || "Unnamed group";
}

export function dmRecipient(ch: Channel): User | undefined {
  return ch.type === ChannelType.DM && ch.recipient_ids?.[0] ? state.users[ch.recipient_ids[0]] : undefined;
}

export function unreadDms(): Channel[] {
  return sortedPrivateChannels().filter((c) => mentionCount(c.id) > 0 || (isUnread(c.id) && !isChannelMuted(c.id)));
}

export function channelLabel(ch: Channel | undefined): string {
  if (!ch) return "";
  if (ch.type === ChannelType.DM || ch.type === ChannelType.GroupDM) return privateChannelName(ch);
  return ch.name ?? "";
}

// ---------------------------------------------------------------- serveurs

/** Liste ordonnée des serveurs ; les serveurs absents des réglages apparaissent en tête. */
export function guildList(): GuildListItem[] {
  const placed = new Set<Snowflake>();
  const items: GuildListItem[] = [];
  for (const item of state.guildOrder) {
    if (item.kind === "guild") {
      if (state.guilds[item.id] && !placed.has(item.id)) {
        placed.add(item.id);
        items.push(item);
      }
    } else {
      const ids = item.guildIds.filter((id) => state.guilds[id] && !placed.has(id));
      ids.forEach((id) => placed.add(id));
      if (ids.length) items.push({ ...item, guildIds: ids });
    }
  }
  const missing = Object.keys(state.guilds)
    .filter((id) => !placed.has(id))
    .sort((a, b) => compareSnowflakes(b, a))
    .map((id): GuildListItem => ({ kind: "guild", id }));
  const all = [...missing, ...items];
  // Ordre choisi dans Dislite ; les nouveaux serveurs restent en tête.
  const order = ui.guildOrderLocal;
  if (!order.length) return all;
  const rank = (item: GuildListItem) => order.indexOf(guildItemKey(item));
  return all.map((item, i) => ({ item, i, r: rank(item) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.item);
}

/** Rail : sans les serveurs masqués (sauf celui affiché, pour savoir où l'on est). */
export function railItems(): GuildListItem[] {
  const shown = (id: Snowflake) => !ui.hiddenGuilds[id] || ui.guildId === id;
  const out: GuildListItem[] = [];
  for (const item of guildList()) {
    if (item.kind === "guild") {
      if (shown(item.id)) out.push(item);
    } else {
      const ids = item.guildIds.filter(shown);
      if (ids.length) out.push(ids.length === item.guildIds.length ? item : { ...item, guildIds: ids });
    }
  }
  return out;
}

export const guildItemKey = (item: GuildListItem) => (item.kind === "guild" ? `g:${item.id}` : `f:${item.id}`);

export function typingUserIds(channelId: Snowflake): Snowflake[] {
  const now = Date.now();
  const map = state.typing[channelId] ?? {};
  return Object.keys(map).filter((id) => map[id] > now && id !== state.meId);
}

export { isThread };

/** À appeler à la déconnexion : libère les mémos par serveur. */
export function clearDerivedCaches() {
  visibleIds.clear();
  channelGroups.clear();
  guildUnread.clear();
  unreadChannels.clear();
}
