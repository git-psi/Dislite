// Contenu des menus contextuels, regroupé ici pour rester cohérent partout.

import { canLeaveGuild, leaveGuild } from "../../actions/guilds";
import { ackChannel, ackGuild } from "../../actions/messages";
import { type NotifyLevel, setChannelNotifications, setGuildNotifications, toggleChannelMute, toggleGuildMute } from "../../actions/mute";
import { canInvite, createInvite, inviteChannel } from "../../actions/invites";
import { createThread } from "../../actions/threads";
import { P } from "../../lib/permissions";
import { state } from "../../store/state";
import { openPrompt } from "./Prompt";
import { closeDm } from "../../actions/social";
import { can, guildUnread, isChannelMuted, isGuildMuted, isUnread, mentionCount } from "../../store/selectors";
import type { Channel, Message, Snowflake } from "../../store/types";
import { setUi, toast, toggleGuildHidden, ui } from "../../store/ui";
import type { MenuItem } from "./ContextMenu";

type Entry = MenuItem | "separator";

const copyText = (label: string, text: string, done: string): MenuItem => ({
  label,
  action: () => {
    void navigator.clipboard.writeText(text);
    toast(done);
  },
});

const LEVELS: { level: NotifyLevel; label: string }[] = [
  { level: 0, label: "All messages" },
  { level: 1, label: "Only mentions" },
  { level: 2, label: "Nothing" },
];

/** Entrées « Notify: … » avec une coche sur le niveau actuel. */
function notifyEntries(current: number, pick: (l: NotifyLevel) => void, withDefault: boolean): MenuItem[] {
  const list = withDefault ? [{ level: 3 as NotifyLevel, label: "Server default" }, ...LEVELS] : LEVELS;
  return list.map((l) => ({ label: `${current === l.level ? "✓ " : "\u2003 "}Notify: ${l.label}`, action: () => pick(l.level) }));
}

const askThreadName = (channelId: Snowflake, messageId?: Snowflake, preset = "") =>
  openPrompt({ title: "New thread", value: preset.slice(0, 100), placeholder: "Thread name", action: "Create", onSubmit: (name) => void createThread(channelId, name, messageId) });

const channelLink = (ch: Channel) => `https://discord.com/channels/${ch.guild_id ?? "@me"}/${ch.id}`;

export function guildMenu(guildId: Snowflake): Entry[] {
  const u = guildUnread(guildId);
  return [
    { label: "Mark as read", disabled: !u.unread && !u.mentions, action: () => void ackGuild(guildId) },
    { label: isGuildMuted(guildId) ? "Unmute server" : "Mute server", action: () => toggleGuildMute(guildId) },
    { label: ui.hiddenGuilds[guildId] ? "Show in sidebar" : "Hide from sidebar", action: () => toggleGuildHidden(guildId) },
    ...(inviteChannel(guildId) ? [{ label: "Invite people", action: () => void createInvite(inviteChannel(guildId)!) }] : []),
    "separator",
    ...notifyEntries(state.guildSettings[guildId]?.message_notifications ?? state.guilds[guildId]?.default_message_notifications ?? 1, (l) => setGuildNotifications(guildId, l as 0 | 1 | 2), false),
    { label: "All servers…", action: () => setUi("serversView", true) },
    "separator",
    copyText("Copy ID", guildId, "ID copied"),
    "separator",
    { label: "Leave server", danger: true, disabled: !canLeaveGuild(guildId), action: () => void leaveGuild(guildId) },
  ];
}

export function channelMenu(ch: Channel): Entry[] {
  const unread = isUnread(ch.id) || mentionCount(ch.id) > 0;
  const items: Entry[] = [
    { label: "Mark as read", disabled: !unread, action: () => ackChannel(ch.id) },
    { label: isChannelMuted(ch.id) ? "Unmute" : "Mute", action: () => toggleChannelMute(ch.id) },
    "separator",
    copyText("Copy link", channelLink(ch), "Link copied"),
    copyText("Copy ID", ch.id, "ID copied"),
  ];
  if (!ch.guild_id) items.splice(1, 0, { label: "Close conversation", danger: true, action: () => void closeDm(ch.id) });
  if (ch.guild_id) {
    const extra: Entry[] = [];
    if (canInvite(ch.id)) extra.push({ label: "Create invite", action: () => void createInvite(ch.id) });
    if ((ch.type === 0 || ch.type === 5) && can(ch.id, P.CREATE_PUBLIC_THREADS)) extra.push({ label: "New thread", action: () => askThreadName(ch.id) });
    const level = state.guildSettings[ch.guild_id]?.channels[ch.id]?.message_notifications ?? 3;
    items.splice(2, 0, ...extra, "separator", ...notifyEntries(level, (l) => setChannelNotifications(ch.id, l), true));
  }
  return items;
}

export function messageMenu(msg: Message, opts: { canEdit: boolean; onDelete?: () => void }): Entry[] {
  const items: Entry[] = [
    { label: "Reply", action: () => setUi("replyTo", msg.channel_id, { messageId: msg.id, mention: true }) },
  ];
  if (opts.canEdit) items.push({ label: "Edit", action: () => setUi("editingId", msg.id) });
  const ch = state.channels[msg.channel_id];
  if (ch?.guild_id && (ch.type === 0 || ch.type === 5) && !msg.thread && can(ch.id, P.CREATE_PUBLIC_THREADS)) {
    items.push({ label: "Create thread", action: () => askThreadName(ch.id, msg.id, msg.content.split("\n")[0]) });
  }
  items.push(
    "separator",
    copyText("Copy text", msg.content, "Text copied"),
    copyText("Copy message link", `https://discord.com/channels/${msg.guild_id ?? "@me"}/${msg.channel_id}/${msg.id}`, "Link copied"),
    copyText("Copy ID", msg.id, "ID copied"),
  );
  if (opts.onDelete) items.push("separator", { label: "Delete", danger: true, action: opts.onDelete });
  return items;
}
