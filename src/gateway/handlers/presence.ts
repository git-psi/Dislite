// Présences et relations (amis, demandes, bloqués).

import { produce } from "solid-js/store";
import { putPresence, putUsers } from "../../store/mutations";
import { setState, state } from "../../store/state";
import { on } from "../dispatcher";

on("PRESENCE_UPDATE", (d) => {
  if (!d.user?.id) return;
  if (d.user.username !== undefined) putUsers([d.user]);
  putPresence(d.user.id, d);
});

on("RELATIONSHIP_ADD", (d) => {
  if (d.user) putUsers([d.user]);
  setState("relationships", d.id, { id: d.id, type: d.type, nickname: d.nickname ?? null });
  if (d.presence) putPresence(d.id, d.presence);
});

on("RELATIONSHIP_UPDATE", (d) => {
  if (state.relationships[d.id]) setState("relationships", d.id, { type: d.type, nickname: d.nickname ?? null });
});

on("RELATIONSHIP_REMOVE", (d) => {
  setState("relationships", produce((r) => void delete r[d.id]));
});
