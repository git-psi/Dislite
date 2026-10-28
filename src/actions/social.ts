// Amis, MP et statut.

import { sendPresence } from "../gateway/client";
import { devFlags } from "../lib/devFlags";
import { encodeCustomStatusPatch, encodeStatusPatch } from "../lib/userSettings";
import { backend, errorMessage, isBackendError } from "../ipc/tauri";
import { putChannel } from "../store/mutations";
import { setState, state } from "../store/state";
import type { Snowflake, Status } from "../store/types";
import { ChannelType } from "../store/types";
import { toast } from "../store/ui";
import { openChannel } from "./navigation";

export async function openDm(userId: Snowflake) {
  const existing = state.privateChannelIds.find((id) => {
    const c = state.channels[id];
    return c?.type === ChannelType.DM && c.recipient_ids?.[0] === userId;
  });
  if (existing) return openChannel(existing);
  try {
    const ch = await backend.api<any>("POST", "/users/@me/channels", { recipients: [userId] });
    putChannel(ch);
    openChannel(ch.id);
  } catch (e) {
    toast(`Couldn't open conversation: ${errorMessage(e)}`, true);
  }
}

export async function closeDm(channelId: Snowflake) {
  try {
    await backend.api("DELETE", `/channels/${channelId}?silent=false`);
  } catch (e) {
    toast(errorMessage(e), true);
  }
}

export async function acceptFriend(userId: Snowflake) {
  await relationshipCall("PUT", userId, {});
}

export async function removeRelationship(userId: Snowflake) {
  await relationshipCall("DELETE", userId);
}

export async function blockUser(userId: Snowflake) {
  await relationshipCall("PUT", userId, { type: 2 });
}

async function relationshipCall(method: "PUT" | "DELETE", userId: Snowflake, body?: unknown) {
  try {
    await backend.api(method, `/users/@me/relationships/${userId}`, body);
  } catch (e) {
    toast(errorMessage(e), true);
  }
}

/** Retourne un message d'erreur, ou null si la demande est partie. */
export async function sendFriendRequest(username: string): Promise<string | null> {
  try {
    await backend.api("POST", "/users/@me/relationships", { username: username.trim().toLowerCase(), discriminator: null });
    return null;
  } catch (e) {
    if (isBackendError(e) && e.code === 80004) return "No user with that name.";
    return errorMessage(e);
  }
}

export async function setStatus(status: Status) {
  setState("status", status);
  if (devFlags.readOnly) return;
  await sendPresence(status, state.customStatus);
  // Persistance dans les réglages synchronisés (visible sur les autres appareils).
  backend
    .api("PATCH", "/users/@me/settings-proto/1", { settings: encodeStatusPatch(status) })
    .catch((e) => console.warn("status not synced", e));
}

export async function setCustomStatus(text: string) {
  const value = text.trim().slice(0, 128);
  setState("customStatus", value || null);
  if (devFlags.readOnly) return;
  await sendPresence(state.status, value || null);
  backend
    .api("PATCH", "/users/@me/settings-proto/1", { settings: encodeCustomStatusPatch(value) })
    .catch((e) => toast(`Status not saved: ${errorMessage(e)}`, true));
}
