// Calcul des permissions effectives, selon l'algorithme documenté par Discord.

import type { Channel, Guild, Member } from "../store/types";

export const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
} as const;

const ALL = (1n << 64n) - 1n;
const big = (s: string | undefined) => (s ? BigInt(s) : 0n);

export function basePermissions(guild: Guild, member: Member | undefined, userId: string): bigint {
  if (guild.owner_id === userId) return ALL;
  let perms = big(guild.roles[guild.id]?.permissions);
  for (const roleId of member?.roles ?? []) perms |= big(guild.roles[roleId]?.permissions);
  return perms & P.ADMINISTRATOR ? ALL : perms;
}

export function channelPermissions(
  guild: Guild,
  channel: Channel,
  member: Member | undefined,
  userId: string,
  resolveParent: (id: string) => Channel | undefined,
): bigint {
  const base = basePermissions(guild, member, userId);
  if (base === ALL) return ALL;

  // Les fils héritent des permissions de leur salon parent.
  const target = channel.type >= 10 && channel.type <= 12 && channel.parent_id ? resolveParent(channel.parent_id) ?? channel : channel;
  const overwrites = target.permission_overwrites ?? [];
  let perms = base;

  const everyone = overwrites.find((o) => o.id === guild.id);
  if (everyone) perms = (perms & ~big(everyone.deny)) | big(everyone.allow);

  let allow = 0n;
  let deny = 0n;
  const roles = new Set(member?.roles ?? []);
  for (const o of overwrites) {
    if (o.type === 0 && roles.has(o.id)) {
      allow |= big(o.allow);
      deny |= big(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;

  const own = overwrites.find((o) => o.type === 1 && o.id === userId);
  if (own) perms = (perms & ~big(own.deny)) | big(own.allow);

  // Sans VIEW_CHANNEL, aucune autre permission n'a d'effet.
  return perms & P.VIEW_CHANNEL ? perms : 0n;
}

export const has = (perms: bigint, flag: bigint) => (perms & flag) === flag;
