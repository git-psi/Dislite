// Serveurs, rôles, emojis, membres et liste des membres.

import { produce } from "solid-js/store";
import { loadGuild, putMember, putMembers, putPresence, putRoles, putUsers, removeGuild, setGuildEmojis, updateGuild } from "../../store/mutations";
import { setState, state } from "../../store/state";
import type { MemberListItem } from "../../store/types";
import { HOME, setUi, ui } from "../../store/ui";
import { on } from "../dispatcher";

on("GUILD_CREATE", loadGuild);
on("GUILD_UPDATE", updateGuild);

on("GUILD_DELETE", (d) => {
  if (d.unavailable) {
    setState("guilds", d.id, "unavailable", true);
    return;
  }
  if (ui.guildId === d.id) setUi("guildId", HOME);
  removeGuild(d.id);
});

on("GUILD_ROLE_CREATE", (d) => putRoles(d.guild_id, [d.role]));
on("GUILD_ROLE_UPDATE", (d) => putRoles(d.guild_id, [d.role]));
on("GUILD_ROLE_DELETE", (d) => {
  if (state.guilds[d.guild_id]) setState("guilds", d.guild_id, "roles", produce((r) => void delete r[d.role_id]));
});

on("GUILD_EMOJIS_UPDATE", (d) => setGuildEmojis(d.guild_id, d.emojis));

on("GUILD_MEMBER_ADD", (d) => putMember(d.guild_id, d));
on("GUILD_MEMBER_UPDATE", (d) => putMember(d.guild_id, d));
on("GUILD_MEMBER_REMOVE", (d) => {
  if (state.members[d.guild_id]) setState("members", d.guild_id, produce((m) => void delete m[d.user.id]));
});

on("GUILD_MEMBERS_CHUNK", (d) => {
  putUsers(d.members.map((m: any) => m.user));
  putMembers(d.guild_id, d.members.map((m: any) => ({ m })));
  for (const p of d.presences ?? []) putPresence(p.user.id, p);
});

// Liste des membres « paresseuse » : le serveur envoie des opérations sur une liste plate
// de groupes et de membres, pour la plage demandée via l'op 37.
on("GUILD_MEMBER_LIST_UPDATE", (d) => {
  const gid: string = d.guild_id;
  const current = state.memberLists[gid];
  const isNewList = !current || current.id !== d.id;
  if (isNewList && !d.ops.some((op: any) => op.op === "SYNC")) return;

  const items: (MemberListItem | null)[] = isNewList ? [] : [...current.items];
  const users: any[] = [];
  const members: { m: any }[] = [];

  // Les effectifs à jour sont dans `d.groups`, pas dans les éléments de la liste.
  const counts = new Map<string, number>((d.groups ?? []).map((g: any) => [g.id, g.count ?? 0]));
  const convert = (item: any): MemberListItem | null => {
    if (item.group) return { kind: "group", id: item.group.id, count: counts.get(item.group.id) ?? item.group.count ?? 0 };
    if (item.member) {
      const m = item.member;
      users.push(m.user);
      members.push({ m });
      if (m.presence) putPresence(m.user.id, m.presence);
      return { kind: "member", userId: m.user.id };
    }
    return null;
  };

  for (const op of d.ops) {
    switch (op.op) {
      case "SYNC": {
        const [start] = op.range;
        op.items.forEach((item: any, i: number) => (items[start + i] = convert(item)));
        break;
      }
      case "INSERT":
        items.splice(op.index, 0, convert(op.item));
        break;
      case "UPDATE":
        items[op.index] = convert(op.item);
        break;
      case "DELETE":
        items.splice(op.index, 1);
        break;
      case "INVALIDATE": {
        const [start, end] = op.range;
        for (let i = start; i <= end && i < items.length; i++) items[i] = null;
        break;
      }
    }
  }

  // Met aussi à jour les effectifs des groupes déjà présents.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it?.kind === "group" && counts.has(it.id) && counts.get(it.id) !== it.count) items[i] = { ...it, count: counts.get(it.id)! };
  }

  putUsers(users);
  putMembers(gid, members);
  setState("memberLists", gid, {
    id: d.id,
    memberCount: d.member_count ?? 0,
    onlineCount: d.online_count ?? 0,
    items,
  });
});
