// Sourdine des serveurs, salons et MP en un clic.

import { devFlags } from "../lib/devFlags";
import { backend, errorMessage } from "../ipc/tauri";
import { saveUnmutedChannels, setUnmutedChannels } from "../store/muteExceptions";
import { isChannelMuted, isChannelMutedItself, isGuildMuted } from "../store/selectors";
import { setState, state } from "../store/state";
import type { Snowflake } from "../store/types";
import { toast } from "../store/ui";

function ensureSettings(id: Snowflake) {
  if (!state.guildSettings[id]) {
    setState("guildSettings", id, {
      muted: false,
      message_notifications: 3,
      suppress_everyone: false,
      suppress_roles: false,
      channels: {},
    });
  }
}

async function patchSettings(id: Snowflake, body: unknown) {
  if (devFlags.readOnly) return;
  try {
    await backend.api("PATCH", `/users/@me/guilds/${id}/settings`, body);
  } catch (e) {
    toast(`Mute not saved: ${errorMessage(e)}`, true);
  }
}

export function toggleGuildMute(guildId: Snowflake) {
  const muted = !isGuildMuted(guildId);
  ensureSettings(guildId);
  setState("guildSettings", guildId, "muted", muted);
  void patchSettings(guildId, { muted, mute_config: null });
}

export function toggleChannelMute(channelId: Snowflake) {
  const ch = state.channels[channelId];
  if (!ch) return;
  const scope = ch.guild_id ?? "@me";
  ensureSettings(scope);
  const setOverride = (muted: boolean) => {
    const prev = state.guildSettings[scope].channels[channelId];
    setState("guildSettings", scope, "channels", channelId, { muted, message_notifications: prev?.message_notifications ?? 3 });
    void patchSettings(scope, { channel_overrides: { [channelId]: { muted, mute_config: null } } });
  };

  if (isChannelMuted(channelId)) {
    // Réactiver : on lève la sourdine propre au salon, et si le serveur (ou la
    // catégorie) reste muet, on ajoute une exception locale.
    if (state.guildSettings[scope].channels[channelId]?.muted) setOverride(false);
    if (isChannelMutedItself(channelId) || (ch.guild_id && isGuildMuted(ch.guild_id))) {
      setUnmutedChannels(channelId, true);
      saveUnmutedChannels();
    }
  } else {
    setUnmutedChannels(channelId, undefined);
    saveUnmutedChannels();
    setOverride(true);
  }
}

// ---------------------------------------------------------------- niveaux de notification
// 0 tous les messages, 1 mentions seulement, 2 rien, 3 réglage par défaut (catégorie / serveur).

export type NotifyLevel = 0 | 1 | 2 | 3;

export function setGuildNotifications(guildId: Snowflake, level: Exclude<NotifyLevel, 3>) {
  ensureSettings(guildId);
  setState("guildSettings", guildId, "message_notifications", level);
  void patchSettings(guildId, { message_notifications: level });
}

export function setChannelNotifications(channelId: Snowflake, level: NotifyLevel) {
  const ch = state.channels[channelId];
  if (!ch?.guild_id) return;
  const scope = ch.guild_id;
  ensureSettings(scope);
  const prev = state.guildSettings[scope].channels[channelId];
  setState("guildSettings", scope, "channels", channelId, { muted: prev?.muted ?? false, message_notifications: level });
  void patchSettings(scope, { channel_overrides: { [channelId]: { message_notifications: level } } });
}
