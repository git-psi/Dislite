// Actions sur les serveurs : quitter.

import { ask } from "@tauri-apps/plugin-dialog";
import { backend, errorMessage } from "../ipc/tauri";
import { state } from "../store/state";
import type { Snowflake } from "../store/types";
import { toast, toggleGuildHidden, ui } from "../store/ui";

/** Le propriétaire ne peut pas quitter son serveur (il doit le transférer ou le supprimer). */
export const canLeaveGuild = (guildId: Snowflake) => !!state.meId && state.guilds[guildId]?.owner_id !== state.meId;

export async function leaveGuild(guildId: Snowflake) {
  const name = state.guilds[guildId]?.name ?? "this server";
  if (!canLeaveGuild(guildId)) return toast("You own this server: transfer or delete it in the official client.", true);
  const ok = await ask(`Leave ${name}? You won't be able to come back unless you're invited again.`, {
    title: "Leave server",
    kind: "warning",
    okLabel: "Leave",
  });
  if (!ok) return;
  try {
    await backend.api("DELETE", `/users/@me/guilds/${guildId}`, { lurking: false });
    // Le retrait du rail se fait à la réception de GUILD_DELETE.
    if (ui.hiddenGuilds[guildId]) toggleGuildHidden(guildId);
    toast(`You left ${name}`);
  } catch (e) {
    toast(`Couldn't leave: ${errorMessage(e)}`, true);
  }
}
