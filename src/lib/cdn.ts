import type { Emoji, Guild, User } from "../store/types";

const CDN = "https://cdn.discordapp.com";
const MEDIA = "https://media.discordapp.net";

export function defaultAvatar(user: Pick<User, "id" | "discriminator">) {
  const index =
    !user.discriminator || user.discriminator === "0"
      ? Number((BigInt(user.id) >> 22n) % 6n)
      : Number(user.discriminator) % 5;
  return `${CDN}/embed/avatars/${index}.png`;
}

export function avatarUrl(user: Pick<User, "id" | "avatar" | "discriminator"> | undefined, size = 80) {
  if (!user) return `${CDN}/embed/avatars/0.png`;
  if (!user.avatar) return defaultAvatar(user);
  return `${CDN}/avatars/${user.id}/${user.avatar}.webp?size=${size}`;
}

export function memberAvatarUrl(guildId: string, userId: string, hash: string, size = 80) {
  return `${CDN}/guilds/${guildId}/users/${userId}/avatars/${hash}.webp?size=${size}`;
}

export function guildIconUrl(guild: Pick<Guild, "id" | "icon">, size = 96) {
  return guild.icon ? `${CDN}/icons/${guild.id}/${guild.icon}.webp?size=${size}` : null;
}

export function channelIconUrl(channelId: string, hash: string, size = 64) {
  return `${CDN}/channel-icons/${channelId}/${hash}.webp?size=${size}`;
}

export function emojiUrl(id: string, animated?: boolean, size = 48) {
  return animated ? `${CDN}/emojis/${id}.gif?size=${size}` : `${CDN}/emojis/${id}.webp?size=${size}`;
}

export function stickerUrl(id: string, formatType: number) {
  return formatType === 4 ? `${MEDIA}/stickers/${id}.gif?size=160` : `${MEDIA}/stickers/${id}.webp?size=160`;
}

/** Représentation d'un emoji pour l'API des réactions. */
export function reactionKey(emoji: Emoji) {
  return encodeURIComponent(emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name);
}

/** Redimensionne via le proxy media de Discord (économise bande passante et mémoire). */
export function scaledMedia(proxyUrl: string | undefined, width: number, height: number) {
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    if (!u.hostname.endsWith("discordapp.net")) return proxyUrl;
    u.searchParams.set("width", String(Math.round(width)));
    u.searchParams.set("height", String(Math.round(height)));
    if (!u.searchParams.has("format")) u.searchParams.set("format", "webp");
    return u.toString();
  } catch {
    return proxyUrl;
  }
}

/** Dimensions affichées en respectant le ratio et une boîte maximale. */
export function fitSize(w: number | null | undefined, h: number | null | undefined, maxW: number, maxH: number) {
  if (!w || !h) return { width: maxW, height: maxH, known: false };
  const ratio = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)), known: true };
}
