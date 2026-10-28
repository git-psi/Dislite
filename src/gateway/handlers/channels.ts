// Salons, MP et fils.

import { produce } from "solid-js/store";
import { ackChannel } from "../../actions/messages";
import { markReadLocally, putChannel, putUsers, removeChannel, setLastMessage } from "../../store/mutations";
import { setState, state } from "../../store/state";
import { isForumLike } from "../../store/types";
import { currentChannelId, HOME, setUi, ui } from "../../store/ui";
import { on } from "../dispatcher";

on("CHANNEL_CREATE", (d) => putChannel(d));
on("CHANNEL_UPDATE", (d) => putChannel(d));
on("CHANNEL_DELETE", (d) => {
  if (currentChannelId() === d.id) setUi("channelByGuild", ui.guildId, null);
  removeChannel(d.id);
});

on("CHANNEL_RECIPIENT_ADD", (d) => {
  putUsers([d.user]);
  if (state.channels[d.channel_id])
    setState("channels", d.channel_id, "recipient_ids", (ids = []) => (ids.includes(d.user.id) ? ids : [...ids, d.user.id]));
});

on("CHANNEL_RECIPIENT_REMOVE", (d) => {
  if (d.user.id === state.meId) {
    if (ui.channelByGuild[HOME] === d.channel_id) setUi("channelByGuild", HOME, null);
    removeChannel(d.channel_id);
  } else if (state.channels[d.channel_id]) {
    setState("channels", d.channel_id, "recipient_ids", (ids = []) => ids.filter((id) => id !== d.user.id));
  }
});

on("THREAD_CREATE", (d) => {
  putChannel(d, d.guild_id);
  // New post dans un forum déjà affiché : on l'ajoute en tête.
  const forum = d.parent_id && state.forums[d.parent_id];
  if (forum && !forum.threadIds.includes(d.id)) setState("forums", d.parent_id, "threadIds", (ids) => [d.id, ...ids]);
  // Le dernier message d'un forum est son dernier post : sans ça, le forum ne passait
  // en non-lu qu'au prochain lancement.
  const parent = d.parent_id ? state.channels[d.parent_id] : undefined;
  if (d.newly_created && parent && isForumLike(parent)) {
    const previous = parent.last_message_id ?? null;
    setLastMessage(parent.id, d.id);
    if (d.owner_id === state.meId) markReadLocally(parent.id, d.id);
    else if (currentChannelId() === parent.id && ui.windowFocused) ackChannel(parent.id);
    // Sans état de lecture, le forum serait considéré comme lu.
    else if (!state.readStates[parent.id]) setState("readStates", parent.id, { last_message_id: previous, mention_count: 0 });
  }
});

on("THREAD_UPDATE", (d) => putChannel(d, d.guild_id));
on("THREAD_DELETE", (d) => removeChannel(d.id));

on("THREAD_LIST_SYNC", (d) => {
  for (const t of d.threads ?? []) putChannel(t, d.guild_id);
  for (const m of d.members ?? []) if (m.user_id === state.meId || !m.user_id) setState("joinedThreads", m.id, true);
});

on("THREAD_MEMBER_UPDATE", (d) => {
  if (!d.user_id || d.user_id === state.meId) setState("joinedThreads", d.id, true);
});

on("THREAD_MEMBERS_UPDATE", (d) => {
  if (state.channels[d.id] && d.member_count !== undefined) setState("channels", d.id, "member_count", d.member_count);
  if (d.added_members?.some((m: any) => m.user_id === state.meId)) setState("joinedThreads", d.id, true);
  if (d.removed_member_ids?.includes(state.meId)) setState("joinedThreads", produce((m) => void delete m[d.id]));
});
