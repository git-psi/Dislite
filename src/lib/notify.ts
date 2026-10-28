// Notifications système pour les MP et mentions.

import { backend } from "../ipc/tauri";
import { playSound } from "./sounds";
import { channelLabel, displayName, isChannelMuted } from "../store/selectors";
import { settings } from "../store/settings";
import { state } from "../store/state";
import type { Message } from "../store/types";
import { currentChannelId, ui } from "../store/ui";


/** Niveau effectif : 0 tout, 1 mentions, 2 rien. */
function notificationLevel(msg: Message): number {
  const ch = state.channels[msg.channel_id];
  const guild = msg.guild_id ? state.guilds[msg.guild_id] : undefined;
  const gs = state.guildSettings[msg.guild_id ?? "@me"];
  const override = gs?.channels[msg.channel_id]?.message_notifications ?? gs?.channels[ch?.parent_id ?? ""]?.message_notifications;
  if (override !== undefined && override !== 3) return override;
  if (gs && gs.message_notifications !== 3) return gs.message_notifications;
  return guild?.default_message_notifications ?? 1;
}

export function shouldNotify(msg: Message, mentioned: boolean): boolean {
  if (!settings.notifications || state.status === "dnd") return false;
  if (ui.windowFocused && currentChannelId() === msg.channel_id) return false;
  if (!msg.guild_id) return !isChannelMuted(msg.channel_id);
  if (mentioned) return true;
  if (isChannelMuted(msg.channel_id)) return false;
  return notificationLevel(msg) === 0;
}

/** Son + notification système (boutons « Open » / « Reply »). */
/** Dernière notification par conversation : une rafale ne crée pas une notification par message. */
const lastNotified = new Map<string, number>();

export function notifyMessage(msg: Message, mentioned = false) {
  const now = Date.now();
  if (now - (lastNotified.get(msg.channel_id) ?? 0) < 3000) return;
  lastNotified.set(msg.channel_id, now);
  playSound(mentioned || !msg.guild_id ? "mention" : "message");
  const author = displayName(msg.author.id, msg.guild_id);
  const ch = state.channels[msg.channel_id];
  const guild = msg.guild_id ? state.guilds[msg.guild_id] : undefined;
  const title = guild ? `${author} (#${channelLabel(ch)}, ${guild.name})` : author;
  const body = !settings.notifyPreview
    ? "New message"
    : msg.content
    ? msg.content.replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/<@!?(\d+)>/g, (_, id) => `@${displayName(id, msg.guild_id)}`)
    : msg.attachments.length
      ? "📎 Attachment"
      : msg.sticker_items?.length
        ? "Sticker"
        : "New message";
  // Découpe par caractères (et non unités UTF-16) pour ne pas couper un emoji en deux.
  const chars = Array.from(body);
  void backend.notify(title, chars.length > 200 ? `${chars.slice(0, 200).join("")}…` : body, msg.channel_id, false).catch(() => {});
}
