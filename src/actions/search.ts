// Recherche dans les messages d'un serveur ou d'une conversation privée.
// Filtres : from:nom, in:salon, has:link|file|image|video|embed|sound|sticker, le reste = texte.

import { backend, errorMessage } from "../ipc/tauri";
import { displayName, userName } from "../store/selectors";
import { ingestMessage } from "../store/mutations";
import { state } from "../store/state";
import type { Message, Snowflake } from "../store/types";

export const PAGE = 25;
const HAS = new Set(["link", "file", "image", "video", "embed", "sound", "sticker", "poll"]);

export interface SearchResult {
  total: number;
  messages: Message[];
  error?: string;
}

/** Personnes connues dont le nom commence par `name` (membres chargés, amis, MP). */
function findUsers(name: string, guildId?: Snowflake): Snowflake[] {
  const q = name.toLowerCase();
  const ids = new Set<Snowflake>();
  const match = (id: Snowflake) => {
    const u = state.users[id];
    if (!u) return;
    const names = [u.username, userName(u), displayName(id, guildId)].map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith(q))) ids.add(id);
  };
  if (guildId) Object.keys(state.members[guildId] ?? {}).forEach(match);
  Object.keys(state.users).forEach(match);
  return [...ids].slice(0, 5);
}

function buildQuery(input: string, guildId?: Snowflake): URLSearchParams | string {
  const params = new URLSearchParams();
  const text: string[] = [];
  for (const token of input.trim().split(/\s+/)) {
    const m = /^(from|in|has):(.+)$/i.exec(token);
    if (!m) {
      if (token) text.push(token);
      continue;
    }
    const [, key, value] = m;
    if (key.toLowerCase() === "from") {
      const ids = findUsers(value.replace(/^@/, ""), guildId);
      if (!ids.length) return `No one called “${value}” found.`;
      ids.forEach((id) => params.append("author_id", id));
    } else if (key.toLowerCase() === "in") {
      if (!guildId) continue;
      const name = value.replace(/^#/, "").toLowerCase();
      const ids = (state.guildChannels[guildId] ?? []).filter((id) => state.channels[id]?.name?.toLowerCase().startsWith(name));
      if (!ids.length) return `No channel called “${value}”.`;
      ids.slice(0, 5).forEach((id) => params.append("channel_id", id));
    } else if (HAS.has(value.toLowerCase())) {
      params.append("has", value.toLowerCase());
    }
  }
  if (text.length) params.set("content", text.join(" "));
  return params;
}

/** `scope` : un serveur, ou un salon privé. */
export async function searchMessages(scope: { guildId?: Snowflake; channelId?: Snowflake }, input: string, offset = 0): Promise<SearchResult> {
  const params = buildQuery(input, scope.guildId);
  if (typeof params === "string") return { total: 0, messages: [], error: params };
  if (![...params.keys()].length) return { total: 0, messages: [] };
  params.set("offset", String(offset));
  const path = scope.guildId ? `/guilds/${scope.guildId}/messages/search?${params}` : `/channels/${scope.channelId}/messages/search?${params}`;
  // Index en cours de construction (202) : Discord demande de réessayer un peu plus tard.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await backend.api<any>("GET", path);
      if (res?.retry_after !== undefined && !res.messages) {
        await new Promise((r) => setTimeout(r, Math.min(5, res.retry_after || 2) * 1000));
        continue;
      }
      const messages = (res.messages ?? []).map((group: any[]) => ingestMessage(group.find((m) => m.hit) ?? group[0]));
      return { total: res.total_results ?? messages.length, messages };
    } catch (e) {
      return { total: 0, messages: [], error: errorMessage(e) };
    }
  }
  return { total: 0, messages: [], error: "Discord is still indexing, try again in a moment." };
}
