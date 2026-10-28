// Messages, réactions, lectures et indicateurs de frappe.

import { produce } from "solid-js/store";
import { ackChannel } from "../../actions/messages";
import { applyPollVote } from "../../actions/polls";
import { notifyMessage, shouldNotify } from "../../lib/notify";
import { insertMessage, putMember, removeMessages, setLastMessage, updateMessage } from "../../store/mutations";
import { member } from "../../store/selectors";
import { setState, state } from "../../store/state";
import type { Emoji, Message, Reaction } from "../../store/types";
import { isThread } from "../../store/types";
import { currentChannelId, ui } from "../../store/ui";
import { on } from "../dispatcher";

function mentionsMe(d: any): boolean {
  const meId = state.meId;
  if (!meId) return false;
  if (!d.guild_id) return true;
  if (d.mentions?.some((u: any) => u.id === meId)) return true;
  const settings = state.guildSettings[d.guild_id];
  if (d.mention_everyone && !settings?.suppress_everyone) return true;
  const myRoles = member(d.guild_id, meId)?.roles ?? [];
  return !settings?.suppress_roles && (d.mention_roles ?? []).some((r: string) => myRoles.includes(r));
}

function clearTyping(channelId: string, userId: string) {
  if (state.typing[channelId]?.[userId]) setState("typing", channelId, produce((m) => void delete m[userId]));
}

on("MESSAGE_CREATE", (d) => {
  const cid: string = d.channel_id;
  const previousLast = state.channels[cid]?.last_message_id ?? null;

  insertMessage(d);
  setLastMessage(cid, d.id);
  clearTyping(cid, d.author.id);

  const ch = state.channels[cid];
  if (ch && isThread(ch)) setState("channels", cid, "message_count", (n) => (n ?? 0) + 1);

  if (d.author.id === state.meId) {
    setState("readStates", cid, { last_message_id: d.id, mention_count: 0 });
    return;
  }

  if (currentChannelId() === cid && ui.windowFocused) {
    ackChannel(cid);
    return;
  }

  // Sans état de lecture, le salon serait considéré comme lu : on en crée un.
  if (!state.readStates[cid]) setState("readStates", cid, { last_message_id: previousLast, mention_count: 0 });

  const mentioned = mentionsMe(d);
  if (mentioned) setState("readStates", cid, "mention_count", (n) => n + 1);
  if (shouldNotify(d as Message, mentioned && !!d.guild_id)) notifyMessage(d as Message, mentioned);
});

on("MESSAGE_UPDATE", updateMessage);
on("MESSAGE_DELETE", (d) => removeMessages(d.channel_id, [d.id]));
on("MESSAGE_DELETE_BULK", (d) => removeMessages(d.channel_id, d.ids));

on("MESSAGE_ACK", (d) => {
  setState("readStates", d.channel_id, { last_message_id: d.message_id, mention_count: d.mention_count ?? 0 });
});

// ---------------------------------------------------------------- réactions

const sameEmoji = (a: Emoji, b: Emoji) => (a.id ? a.id === b.id : a.name === b.name);

function editReactions(channelId: string, messageId: string, edit: (r: Reaction[]) => Reaction[]) {
  const items = state.messages[channelId]?.items;
  const idx = items?.findIndex((m) => m.id === messageId) ?? -1;
  if (idx < 0) return;
  setState("messages", channelId, "items", idx, "reactions", (r) => edit(r ?? []));
}

on("MESSAGE_REACTION_ADD", (d) => {
  if (d.member && d.guild_id) putMember(d.guild_id, d.member, d.user_id);
  const mine = d.user_id === state.meId;
  editReactions(d.channel_id, d.message_id, (list) => {
    const existing = list.find((r) => sameEmoji(r.emoji, d.emoji));
    if (!existing) return [...list, { emoji: d.emoji, count: 1, me: mine }];
    return list.map((r) => (r === existing ? { ...r, count: r.count + 1, me: r.me || mine } : r));
  });
});

on("MESSAGE_REACTION_REMOVE", (d) => {
  const mine = d.user_id === state.meId;
  editReactions(d.channel_id, d.message_id, (list) =>
    list
      .map((r) => (sameEmoji(r.emoji, d.emoji) ? { ...r, count: r.count - 1, me: mine ? false : r.me } : r))
      .filter((r) => r.count > 0),
  );
});

on("MESSAGE_REACTION_REMOVE_ALL", (d) => editReactions(d.channel_id, d.message_id, () => []));
on("MESSAGE_REACTION_REMOVE_EMOJI", (d) =>
  editReactions(d.channel_id, d.message_id, (list) => list.filter((r) => !sameEmoji(r.emoji, d.emoji))),
);

// ---------------------------------------------------------------- frappe

const TYPING_DURATION = 10_000;

on("TYPING_START", (d) => {
  if (d.member && d.guild_id) putMember(d.guild_id, d.member, d.user_id);
  const expires = Date.now() + TYPING_DURATION;
  if (!state.typing[d.channel_id]) setState("typing", d.channel_id, {});
  setState("typing", d.channel_id, d.user_id, expires);
  setTimeout(() => {
    if (state.typing[d.channel_id]?.[d.user_id] === expires) clearTyping(d.channel_id, d.user_id);
  }, TYPING_DURATION + 100);
});

// Votes aux sondages (les nôtres reviennent aussi par ici).
on("MESSAGE_POLL_VOTE_ADD", (d) => applyPollVote(d.channel_id, d.message_id, d.answer_id, true, d.user_id === state.meId));
on("MESSAGE_POLL_VOTE_REMOVE", (d) => applyPollVote(d.channel_id, d.message_id, d.answer_id, false, d.user_id === state.meId));
