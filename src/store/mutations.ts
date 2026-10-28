// Écritures dans le store. Normalise les objets bruts de Discord pour ne garder
// que ce que l'interface utilise (moins de mémoire, réactivité plus fine).

import { batch } from "solid-js";
import { produce, reconcile } from "solid-js/store";
import { compareSnowflakes, isNewer } from "../lib/snowflake";
import { setState, state } from "./state";
import type { Channel, Emoji, Guild, Member, Message, Presence, Role, Snowflake, User } from "./types";
import { isThread } from "./types";

/** Nombre max de messages gardés en mémoire par salon. */
export const MAX_CACHED_MESSAGES = 250;

// ---------------------------------------------------------------- utilisateurs

const pickUser = (u: any): User => ({
  id: u.id,
  username: u.username,
  global_name: u.global_name ?? null,
  discriminator: u.discriminator,
  avatar: u.avatar ?? null,
  bot: u.bot || undefined,
  system: u.system || undefined,
  premium_type: u.premium_type || undefined,
});

export function putUsers(users: any[] | undefined) {
  if (!users?.length) return;
  setState(
    "users",
    produce((map) => {
      for (const u of users) {
        if (!u?.id || u.username === undefined) continue;
        const prev = map[u.id];
        const next = pickUser(u);
        if (!prev) map[u.id] = next;
        else if (
          prev.avatar !== next.avatar ||
          prev.global_name !== next.global_name ||
          prev.username !== next.username
        )
          Object.assign(prev, next);
      }
    }),
  );
}

// ---------------------------------------------------------------- membres

const pickMember = (m: any, userId: Snowflake): Member => ({
  user_id: userId,
  nick: m.nick ?? null,
  avatar: m.avatar ?? null,
  roles: m.roles ?? [],
  joined_at: m.joined_at,
  communication_disabled_until: m.communication_disabled_until ?? null,
});

/** `m.user` peut être absent (MESSAGE_CREATE) : on passe alors userId. */
export function putMembers(guildId: Snowflake, members: { m: any; userId?: Snowflake }[]) {
  if (!members.length) return;
  if (!state.members[guildId]) setState("members", guildId, {});
  setState(
    "members",
    guildId,
    produce((map) => {
      for (const { m, userId } of members) {
        const id = userId ?? m.user?.id ?? m.user_id;
        if (!id) continue;
        map[id] = pickMember(m, id);
      }
    }),
  );
}

export function putMember(guildId: Snowflake, m: any, userId?: Snowflake) {
  if (m?.user) putUsers([m.user]);
  putMembers(guildId, [{ m, userId }]);
}

// ---------------------------------------------------------------- présences

export function putPresence(userId: Snowflake, p: any) {
  const presence: Presence = {
    status: p.status ?? "offline",
    activities: (p.activities ?? []).map((a: any) => ({
      type: a.type,
      name: a.name,
      state: a.state ?? null,
      details: a.details ?? null,
      emoji: a.emoji ?? null,
    })),
  };
  setState("presences", userId, reconcile(presence));
}

// ---------------------------------------------------------------- salons

export function normalizeChannel(raw: any, guildId?: Snowflake): Channel {
  const ch: Channel = {
    id: raw.id,
    type: raw.type,
    guild_id: raw.guild_id ?? guildId,
    name: raw.name,
    topic: raw.topic ?? null,
    position: raw.position ?? 0,
    parent_id: raw.parent_id ?? null,
    permission_overwrites: raw.permission_overwrites,
    last_message_id: raw.last_message_id ?? null,
    nsfw: raw.nsfw,
    rate_limit_per_user: raw.rate_limit_per_user,
    flags: raw.flags,
  };
  if (raw.type === 1 || raw.type === 3) {
    ch.recipient_ids = raw.recipient_ids ?? raw.recipients?.map((u: any) => u.id) ?? [];
    ch.icon = raw.icon ?? null;
    ch.owner_id = raw.owner_id;
    putUsers(raw.recipients);
  }
  if (isThread(raw)) {
    ch.thread_metadata = raw.thread_metadata;
    ch.message_count = raw.message_count;
    ch.member_count = raw.member_count;
    ch.applied_tags = raw.applied_tags ?? [];
    ch.owner_id = raw.owner_id;
  }
  if (raw.type === 15 || raw.type === 16) {
    ch.available_tags = raw.available_tags ?? [];
    ch.default_reaction_emoji = raw.default_reaction_emoji ?? null;
  }
  return ch;
}

const addId = (list: Snowflake[] | undefined, id: Snowflake) => (list?.includes(id) ? list : [...(list ?? []), id]);

export function putChannel(raw: any, guildId?: Snowflake) {
  const ch = normalizeChannel(raw, guildId);
  batch(() => {
    const prev = state.channels[ch.id];
    // Les mises à jour partielles ne renvoient pas toujours last_message_id.
    if (prev && !ch.last_message_id) ch.last_message_id = prev.last_message_id;
    setState("channels", ch.id, reconcile(ch));
    if (isThread(ch) && ch.parent_id) {
      setState("threads", ch.parent_id, (l) => addId(l, ch.id));
    } else if (ch.guild_id) {
      setState("guildChannels", ch.guild_id, (l) => addId(l, ch.id));
    } else {
      setState("privateChannelIds", (l) => addId(l, ch.id));
    }
    if (raw.member) setState("joinedThreads", ch.id, true);
  });
}

export function removeChannel(id: Snowflake) {
  const ch = state.channels[id];
  if (!ch) return;
  batch(() => {
    if (isThread(ch) && ch.parent_id) {
      setState("threads", ch.parent_id, (l) => (l ?? []).filter((x) => x !== id));
      setState("joinedThreads", produce((m) => void delete m[id]));
    } else if (ch.guild_id) {
      setState("guildChannels", ch.guild_id, (l) => (l ?? []).filter((x) => x !== id));
    } else {
      setState("privateChannelIds", (l) => l.filter((x) => x !== id));
    }
    setState("messages", produce((m) => void delete m[id]));
    setState("channels", produce((m) => void delete m[id]));
  });
}

// ---------------------------------------------------------------- serveurs

const pickRole = (r: any): Role => ({
  id: r.id,
  name: r.name,
  color: r.color ?? 0,
  colors: r.colors,
  position: r.position ?? 0,
  permissions: r.permissions ?? "0",
  hoist: !!r.hoist,
  icon: r.icon ?? null,
  unicode_emoji: r.unicode_emoji ?? null,
});

const pickEmoji = (e: any): Emoji => ({ id: e.id, name: e.name, animated: !!e.animated, available: e.available !== false });

export function putRoles(guildId: Snowflake, roles: any[]) {
  setState(
    "guilds",
    guildId,
    "roles",
    produce((map) => {
      for (const r of roles) map[r.id] = pickRole(r);
    }),
  );
}

/** Charge un serveur complet (READY ou GUILD_CREATE, format v1 ou CLIENT_STATE_V2). */
export function loadGuild(raw: any) {
  batch(() => {
    if (raw.unavailable) {
      if (!state.guilds[raw.id]) {
        setState("guilds", raw.id, {
          id: raw.id, name: "", icon: null, owner_id: "", features: [], roles: {}, emojis: [], unavailable: true,
        });
      }
      return;
    }
    const p = raw.properties ?? raw;
    const guild: Guild = {
      id: raw.id,
      name: p.name,
      icon: p.icon ?? null,
      banner: p.banner ?? null,
      owner_id: p.owner_id,
      features: p.features ?? [],
      roles: Object.fromEntries((raw.roles ?? p.roles ?? []).map((r: any) => [r.id, pickRole(r)])),
      emojis: (raw.emojis ?? p.emojis ?? []).map(pickEmoji),
      member_count: raw.member_count ?? p.member_count,
      joined_at: raw.joined_at ?? p.joined_at,
      rules_channel_id: p.rules_channel_id ?? null,
      system_channel_id: p.system_channel_id ?? null,
      default_message_notifications: p.default_message_notifications ?? 0,
    };
    setState("guilds", raw.id, reconcile(guild));

    const channels = (raw.channels ?? []).map((c: any) => normalizeChannel(c, raw.id));
    setState(
      "channels",
      produce((map) => {
        for (const c of channels) map[c.id] = c;
      }),
    );
    setState("guildChannels", raw.id, channels.map((c: Channel) => c.id));

    for (const t of raw.threads ?? []) putChannel(t, raw.id);

    const members = raw.members ?? [];
    putUsers(members.map((m: any) => m.user));
    putMembers(raw.id, members.map((m: any) => ({ m })));
    for (const pr of raw.presences ?? []) if (pr.user?.id) putPresence(pr.user.id, pr);
    for (const vs of raw.voice_states ?? []) putVoiceState(vs, raw.id);
  });
}

export function updateGuild(raw: any) {
  const prev = state.guilds[raw.id];
  if (!prev) return loadGuild(raw);
  batch(() => {
    setState("guilds", raw.id, {
      name: raw.name ?? prev.name,
      icon: raw.icon ?? null,
      banner: raw.banner ?? null,
      owner_id: raw.owner_id ?? prev.owner_id,
      features: raw.features ?? prev.features,
      rules_channel_id: raw.rules_channel_id ?? null,
      system_channel_id: raw.system_channel_id ?? null,
    });
    if (raw.roles) putRoles(raw.id, raw.roles);
    if (raw.emojis) setState("guilds", raw.id, "emojis", raw.emojis.map(pickEmoji));
  });
}

export function setGuildEmojis(guildId: Snowflake, emojis: any[]) {
  if (state.guilds[guildId]) setState("guilds", guildId, "emojis", emojis.map(pickEmoji));
}

export function removeGuild(id: Snowflake) {
  batch(() => {
    for (const cid of state.guildChannels[id] ?? []) {
      for (const tid of state.threads[cid] ?? []) removeChannel(tid);
      removeChannel(cid);
    }
    setState("guildChannels", produce((m) => void delete m[id]));
    setState("members", produce((m) => void delete m[id]));
    setState("memberLists", produce((m) => void delete m[id]));
    setState("guilds", produce((m) => void delete m[id]));
  });
}

// ---------------------------------------------------------------- messages

/** Enregistre les auteurs/membres embarqués et retourne le message allégé. */
export function ingestMessage(raw: any): Message {
  const users = [raw.author, ...(raw.mentions ?? [])];
  if (raw.referenced_message?.author) users.push(raw.referenced_message.author);
  putUsers(users);
  if (raw.guild_id) {
    const members: { m: any; userId: Snowflake }[] = [];
    if (raw.member) members.push({ m: raw.member, userId: raw.author.id });
    for (const u of raw.mentions ?? []) if (u.member) members.push({ m: u.member, userId: u.id });
    putMembers(raw.guild_id, members);
  }
  if (raw.thread) putChannel(raw.thread, raw.guild_id);
  const { member: _m, interaction_metadata: _i, ...msg } = raw;
  return msg as Message;
}

export function ensureMessageBucket(channelId: Snowflake) {
  if (!state.messages[channelId]) {
    setState("messages", channelId, { items: [], hasMore: true, loading: false });
  }
}

/** Ajoute un lot de messages récupérés par l'API (ordre décroissant, comme renvoyé). */
export function addFetchedMessages(channelId: Snowflake, rawDesc: any[], hasMore: boolean, older: boolean) {
  batch(() => {
    const fetched = rawDesc.map(ingestMessage).reverse();
    ensureMessageBucket(channelId);
    setState("messages", channelId, (bucket) => {
      // Instantané rafraîchi : la page reçue remplace les messages en cache (éditions, suppressions).
      if (bucket.stale && !older) {
        return { items: [...fetched, ...bucket.items.filter((m) => m._pending || m._failed)], hasMore, loading: false, stale: false };
      }
      const known = new Set(bucket.items.map((m) => m.id));
      const fresh = fetched.filter((m) => !known.has(m.id));
      const items = older ? [...fresh, ...bucket.items] : mergeSorted(bucket.items, fresh);
      return { items, hasMore, loading: false };
    });
  });
}

function mergeSorted(a: Message[], b: Message[]) {
  return [...a, ...b].sort((x, y) => compareSnowflakes(x.id, y.id));
}

export function insertMessage(raw: any) {
  const msg = ingestMessage(raw);
  const bucket = state.messages[msg.channel_id];
  if (!bucket || bucket.detached) return;
  const items = bucket.items;
  // Remplace le message local en attente qui porte le même nonce.
  const pending = msg.nonce ? items.findIndex((m) => m._pending && m.nonce === msg.nonce) : -1;
  if (pending >= 0) {
    setState("messages", msg.channel_id, "items", pending, reconcile(msg));
    return;
  }
  if (items.some((m) => m.id === msg.id)) return;
  if (items.length >= MAX_CACHED_MESSAGES * 2) {
    setState("messages", msg.channel_id, { items: [...items.slice(-MAX_CACHED_MESSAGES), msg], hasMore: true });
  } else {
    setState("messages", msg.channel_id, "items", items.length, msg);
  }
}

export function addPendingMessage(msg: Message) {
  ensureMessageBucket(msg.channel_id);
  setState("messages", msg.channel_id, "items", (items) => [...items, msg]);
}

export function patchMessage(channelId: Snowflake, id: Snowflake, patch: Partial<Message>) {
  const items = state.messages[channelId]?.items;
  if (!items) return;
  const idx = items.findIndex((m) => m.id === id || (m._pending && m.nonce === id));
  if (idx >= 0) setState("messages", channelId, "items", idx, patch);
}

export function updateMessage(raw: any) {
  const items = state.messages[raw.channel_id]?.items;
  if (!items) return;
  const idx = items.findIndex((m) => m.id === raw.id);
  if (idx < 0) return;
  const msg = ingestMessage(raw);
  setState("messages", raw.channel_id, "items", idx, (prev) => ({ ...prev, ...msg }));
}

export function removeMessages(channelId: Snowflake, ids: Snowflake[]) {
  if (!state.messages[channelId]) return;
  const set = new Set(ids);
  setState("messages", channelId, "items", (items) => items.filter((m) => !set.has(m.id)));
}

/** Réduit les gros caches quand on quitte un salon. */
export function trimMessages(channelId: Snowflake) {
  const bucket = state.messages[channelId];
  if (bucket && bucket.items.length > 60) {
    setState("messages", channelId, { items: bucket.items.slice(-50), hasMore: true });
  }
}

// ---------------------------------------------------------------- lectures

export function setLastMessage(channelId: Snowflake, messageId: Snowflake) {
  const ch = state.channels[channelId];
  if (ch && isNewer(messageId, ch.last_message_id)) setState("channels", channelId, "last_message_id", messageId);
}

export function markReadLocally(channelId: Snowflake, messageId: Snowflake) {
  setState("readStates", channelId, { last_message_id: messageId, mention_count: 0 });
}

// ---------------------------------------------------------------- vocal

const voiceKey = (guildId: Snowflake | null | undefined, userId: Snowflake) => `${guildId ?? "@me"}:${userId}`;

/** Met à jour la présence vocale d'une personne (channel_id null = elle est partie). */
export function putVoiceState(raw: any, guildId?: Snowflake | null) {
  const gid: Snowflake | null = raw.guild_id ?? guildId ?? null;
  const uid: Snowflake = raw.user_id;
  if (!uid) return;
  if (raw.member?.user) putUsers([raw.member.user]);
  const key = voiceKey(gid, uid);
  const prev = state.voiceStates[key];
  batch(() => {
    if (prev && prev.channel_id !== raw.channel_id) {
      setState("voiceChannels", prev.channel_id, (ids = []) => ids.filter((id) => id !== uid));
    }
    if (!raw.channel_id) {
      setState("voiceStates", produce((m) => void delete m[key]));
      return;
    }
    setState("voiceStates", key, {
      user_id: uid,
      guild_id: gid,
      channel_id: raw.channel_id,
      session_id: raw.session_id,
      self_mute: !!raw.self_mute,
      self_deaf: !!raw.self_deaf,
      mute: !!raw.mute,
      deaf: !!raw.deaf,
      self_stream: !!raw.self_stream,
      self_video: !!raw.self_video,
    });
    setState("voiceChannels", raw.channel_id, (ids = []) => (ids.includes(uid) ? ids : [...ids, uid]));
  });
}

export function clearVoiceStates() {
  setState("voiceStates", reconcile({}));
  setState("voiceChannels", reconcile({}));
  setState("calls", reconcile({}));
}
