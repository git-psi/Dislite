// Groupes (MP à plusieurs) : créer, ajouter, retirer, renommer, quitter.
// Discord limite un groupe à 10 personnes, nous compris.

import { ask } from "@tauri-apps/plugin-dialog";
import { backend, errorMessage } from "../ipc/tauri";
import { putChannel } from "../store/mutations";
import { privateChannelName } from "../store/selectors";
import { state } from "../store/state";
import type { Snowflake } from "../store/types";
import { toast } from "../store/ui";
import { openChannel } from "./navigation";

export const GROUP_MAX = 10;

const fail = (what: string) => (e: unknown) => toast(`Couldn't ${what}: ${errorMessage(e)}`, true);

export async function createGroup(userIds: Snowflake[]) {
  try {
    const ch = await backend.api<any>("POST", "/users/@me/channels", { recipients: userIds });
    putChannel(ch);
    openChannel(ch.id);
  } catch (e) {
    fail("create the group")(e);
  }
}

/** Depuis un MP à deux, ajouter quelqu'un crée un nouveau groupe (comme l'officiel). */
export async function addToConversation(channelId: Snowflake, userIds: Snowflake[]) {
  const ch = state.channels[channelId];
  if (!ch) return;
  if (ch.type === 1) return createGroup([...(ch.recipient_ids ?? []), ...userIds]);
  for (const id of userIds) {
    await backend.api("PUT", `/channels/${channelId}/recipients/${id}`, {}).catch(fail("add someone"));
  }
}

export async function removeFromGroup(channelId: Snowflake, userId: Snowflake) {
  await backend.api("DELETE", `/channels/${channelId}/recipients/${userId}`).catch(fail("remove them"));
}

export async function renameGroup(channelId: Snowflake, name: string) {
  await backend.api("PATCH", `/channels/${channelId}`, { name: name.trim() || null }).catch(fail("rename the group"));
}

export async function leaveGroup(channelId: Snowflake) {
  const ch = state.channels[channelId];
  if (!ch) return;
  const ok = await ask(`Leave ${privateChannelName(ch)}? You won't get its messages anymore unless someone adds you back.`, {
    title: "Leave group",
    kind: "warning",
    okLabel: "Leave",
  });
  if (ok) await backend.api("DELETE", `/channels/${channelId}?silent=false`).catch(fail("leave the group"));
}

export const isGroupOwner = (channelId: Snowflake) => state.channels[channelId]?.owner_id === state.meId;
