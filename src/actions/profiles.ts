// Profils utilisateurs : chargés à l'ouverture de la fiche, gardés en cache
// pour la session (Discord surveille les appels répétés à cet endpoint).

import { createStore } from "solid-js/store";
import { backend, errorMessage } from "../ipc/tauri";
import { putUsers } from "../store/mutations";
import type { Snowflake } from "../store/types";

export interface Profile {
  bio: string | null;
  pronouns: string | null;
  banner: string | null;
  accentColor: number | null;
  themeColors: [number, number] | null;
  /** surcharges propres au serveur */
  guildBio: string | null;
  guildPronouns: string | null;
  guildBanner: string | null;
  mutualGuilds: { id: Snowflake; nick: string | null }[];
  mutualFriends: Snowflake[];
  premiumSince: string | null;
}

interface ProfileEntry {
  loading: boolean;
  error: string | null;
  data: Profile | null;
  note: string | null;
}

const [profiles, setProfiles] = createStore<Record<string, ProfileEntry>>({});
export { profiles };

const key = (userId: Snowflake, guildId?: Snowflake) => `${userId}:${guildId ?? ""}`;

export const profileOf = (userId: Snowflake, guildId?: Snowflake) => profiles[key(userId, guildId)];

export async function loadProfile(userId: Snowflake, guildId?: Snowflake) {
  const k = key(userId, guildId);
  if (profiles[k]?.data || profiles[k]?.loading) return;
  setProfiles(k, { loading: true, error: null, data: null, note: profiles[k]?.note ?? null });

  const query = new URLSearchParams({ with_mutual_guilds: "true", with_mutual_friends: "true" });
  if (guildId) query.set("guild_id", guildId);
  try {
    const res = await backend.api<any>("GET", `/users/${userId}/profile?${query}`);
    if (res.user) putUsers([res.user]);
    const up = res.user_profile ?? {};
    const gp = res.guild_member_profile ?? {};
    setProfiles(k, {
      loading: false,
      data: {
        bio: up.bio || res.user?.bio || null,
        pronouns: up.pronouns || null,
        banner: up.banner ?? res.user?.banner ?? null,
        accentColor: up.accent_color ?? res.user?.accent_color ?? null,
        themeColors: up.theme_colors ?? null,
        guildBio: gp.bio || null,
        guildPronouns: gp.pronouns || null,
        guildBanner: gp.banner ?? null,
        mutualGuilds: (res.mutual_guilds ?? []).map((g: any) => ({ id: g.id, nick: g.nick ?? null })),
        mutualFriends: (res.mutual_friends ?? []).map((u: any) => {
          putUsers([u]);
          return u.id;
        }),
        premiumSince: res.premium_since ?? null,
      },
    });
  } catch (e) {
    // Profil inaccessible (aucun serveur en commun…) : la fiche reste utilisable.
    setProfiles(k, { loading: false, error: errorMessage(e) });
  }
}

const notesLoaded = new Set<Snowflake>();

export async function loadNote(userId: Snowflake, guildId?: Snowflake) {
  if (notesLoaded.has(userId)) return;
  notesLoaded.add(userId);
  try {
    const res = await backend.api<any>("GET", `/users/@me/notes/${userId}`);
    setProfiles(key(userId, guildId), "note", res?.note ?? "");
  } catch {
    // 404 = pas de note
    setProfiles(key(userId, guildId), "note", "");
  }
}

export async function saveNote(userId: Snowflake, note: string) {
  try {
    await backend.api("PUT", `/users/@me/notes/${userId}`, { note });
  } catch (e) {
    console.warn("note not saved", e);
  }
}
