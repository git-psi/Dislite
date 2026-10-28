// READY et réglages de l'utilisateur.

import { initNsfwBlocked } from "../../actions/messages";
import { reconcile } from "solid-js/store";
import { decodeUserSettings } from "../../lib/userSettings";
import { clearVoiceStates, loadGuild, normalizeChannel, putMembers, putPresence, putUsers } from "../../store/mutations";
import { refreshAccounts } from "../../actions/accounts";
import { backend } from "../../ipc/tauri";
import { dropSnapshotData, saveSnapshot, setActiveAccount } from "../../store/snapshot";
import { setState, state } from "../../store/state";
import type { Channel, GuildListItem, GuildSettings, ReadState, Relationship } from "../../store/types";
import { on } from "../dispatcher";

/** Les listes « versionnées » arrivent sous la forme `{ entries, version }`. */
const entries = (v: any): any[] => (Array.isArray(v) ? v : v?.entries ?? []);

const muteActive = (muted: boolean, config: any) =>
  muted && !(config?.end_time && Date.parse(config.end_time) < Date.now());

export function putGuildSettings(e: any) {
  const id = e.guild_id ?? "@me";
  const settings: GuildSettings = {
    muted: muteActive(!!e.muted, e.mute_config),
    message_notifications: e.message_notifications ?? 3,
    suppress_everyone: !!e.suppress_everyone,
    suppress_roles: !!e.suppress_roles,
    channels: Object.fromEntries(
      (e.channel_overrides ?? []).map((o: any) => [
        o.channel_id,
        { muted: muteActive(!!o.muted, o.mute_config), message_notifications: o.message_notifications ?? 3 },
      ]),
    ),
  };
  setState("guildSettings", id, reconcile(settings));
}

const normalizeId = (v: unknown) => (v && v !== "0" && v !== 0 ? String(v) : null);

function applySettingsProto(b64: string | undefined) {
  if (!b64) return;
  try {
    const s = decodeUserSettings(b64);
    if (s.status) setState("status", s.status);
    if (s.customStatus !== undefined) setState("customStatus", s.customStatus);
    if (s.guildFolders) setState("guildOrder", reconcile(s.guildFolders));
  } catch (e) {
    console.warn("unreadable settings", e);
  }
}

function legacyFolders(settings: any): GuildListItem[] | null {
  const folders = settings?.guild_folders;
  if (!Array.isArray(folders)) return null;
  return folders.map((f: any): GuildListItem =>
    f.id == null && f.guild_ids.length === 1
      ? { kind: "guild", id: f.guild_ids[0] }
      : { kind: "folder", id: String(f.id ?? ""), name: f.name ?? null, color: f.color ?? null, guildIds: f.guild_ids },
  );
}

on("READY", (d) => {
  if (state.cached) {
    // Interface affichée depuis l'instantané : ses données sont remplacées par les vraies.
    // Les messages chargés entre-temps (REST) sont récents, on les garde.
    dropSnapshotData();
  } else {
    // Nouvelle session (pas une reprise) : les caches peuvent avoir des trous.
    setState("messages", reconcile({}));
    setState("forums", reconcile({}));
  }
  setState("memberLists", reconcile({}));
  clearVoiceStates();
  setState("sessionId", d.session_id ?? null);

  putUsers([d.user, ...(d.users ?? [])]);
  setState("meId", d.user.id);
  initNsfwBlocked(d.user);

  // Serveurs (+ notre propre membre, dédupliqué dans merged_members).
  (d.guilds ?? []).forEach((g: any, i: number) => {
    loadGuild(g);
    const mine = d.merged_members?.[i]?.find((m: any) => (m.user_id ?? m.user?.id) === d.user.id);
    if (mine) putMembers(g.id, [{ m: mine, userId: d.user.id }]);
  });

  // MP et groupes.
  const privates: Channel[] = (d.private_channels ?? []).map((c: any) => normalizeChannel(c));
  setState("channels", (map) => ({ ...map, ...Object.fromEntries(privates.map((c) => [c.id, c])) }));
  setState("privateChannelIds", privates.map((c) => c.id));

  // Relations (amis, demandes, bloqués).
  const rels: Record<string, Relationship> = {};
  for (const r of d.relationships ?? []) {
    if (r.user) putUsers([r.user]);
    rels[r.id] = { id: r.id, type: r.type, nickname: r.nickname ?? null };
  }
  setState("relationships", reconcile(rels));

  // États de lecture.
  const reads: Record<string, ReadState> = {};
  for (const e of entries(d.read_state)) {
    if ((e.read_state_type ?? 0) !== 0) continue;
    reads[e.id] = { last_message_id: normalizeId(e.last_message_id), mention_count: e.mention_count ?? 0 };
  }
  setState("readStates", reconcile(reads));

  for (const e of entries(d.user_guild_settings)) putGuildSettings(e);

  // Ordre des serveurs et statut.
  applySettingsProto(d.user_settings_proto);
  const legacy = legacyFolders(d.user_settings);
  if (legacy && !d.user_settings_proto) setState("guildOrder", legacy);
  if (d.user_settings?.status && !d.user_settings_proto) setState("status", d.user_settings.status);

  // Présences des amis.
  const presences = [...(d.presences ?? []), ...(d.merged_presences?.friends ?? [])];
  for (const p of presences) {
    const id = p.user_id ?? p.user?.id;
    if (id) putPresence(id, p);
  }
  (d.merged_presences?.guilds ?? []).forEach((list: any[]) => {
    for (const p of list ?? []) if (p.user_id) putPresence(p.user_id, p);
  });

  setState("ready", true);
  performance.mark("dislite:ready");
  // Profil du compte pour le sélecteur de comptes (le token reste côté Rust).
  setActiveAccount(d.user.id);
  void backend
    .accountRemember({ id: d.user.id, username: d.user.username, global_name: d.user.global_name ?? null, avatar: d.user.avatar ?? null })
    .then(refreshAccounts)
    .catch(() => {});
  // Instantané pour le prochain lancement, une fois l'interface à jour.
  setTimeout(saveSnapshot, 5000);
});

on("USER_UPDATE", (d) => putUsers([d]));

on("USER_SETTINGS_PROTO_UPDATE", (d) => {
  if (d.settings?.type === 1) applySettingsProto(d.settings.proto);
});

on("USER_GUILD_SETTINGS_UPDATE", putGuildSettings);

// Statut agrégé de toutes nos sessions (ex. changé since mobile).
on("SESSIONS_REPLACE", (sessions: any[]) => {
  const all = sessions.find((s) => s.session_id === "all") ?? sessions[0];
  if (all?.status) setState("status", all.status);
});
