// Invitations : rejoindre un serveur depuis un lien, créer un lien.

import { createSignal } from "solid-js";
import { backend, errorMessage } from "../ipc/tauri";
import { can } from "../store/selectors";
import { P } from "../lib/permissions";
import { state } from "../store/state";
import type { Snowflake } from "../store/types";
import { toast } from "../store/ui";

/** Code d'invitation dans un lien discord.gg / discord.com/invite, sinon null. */
export function inviteCode(href: string): string | null {
  const m = /^https?:\/\/(?:www\.)?(?:discord\.gg|(?:ptb\.|canary\.)?discord(?:app)?\.com\/invite)\/([\w-]+)/i.exec(href);
  return m ? m[1] : null;
}

/** Invitation affichée dans la fenêtre « Join server ». */
export const [invite, setInvite] = createSignal<string | null>(null);

export const canInvite = (channelId: Snowflake) => can(channelId, P.CREATE_INSTANT_INVITE);

/** Lien d'une semaine, sans limite d'utilisation, copié dans le presse-papiers. */
export async function createInvite(channelId: Snowflake) {
  try {
    const res = await backend.api<any>("POST", `/channels/${channelId}/invites`, { max_age: 604800, max_uses: 0, temporary: false });
    const link = `https://discord.gg/${res.code}`;
    await navigator.clipboard.writeText(link);
    toast(`Invite link copied · ${link}`);
  } catch (e) {
    toast(`Couldn't create an invite: ${errorMessage(e)}`, true);
  }
}

/** Salon où inviter pour un serveur : salon système, sinon le premier où c'est permis. */
export function inviteChannel(guildId: Snowflake): Snowflake | null {
  const sys = state.guilds[guildId]?.system_channel_id;
  if (sys && canInvite(sys)) return sys;
  return (state.guildChannels[guildId] ?? []).find((id) => state.channels[id]?.type === 0 && canInvite(id)) ?? null;
}
