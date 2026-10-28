import { createStore } from "solid-js/store";
import { backend, errorMessage } from "../ipc/tauri";
import { devFlags } from "../lib/devFlags";
import { ingestMessage, putChannel } from "../store/mutations";
import { setState, state } from "../store/state";
import { isNewer, makeNonce } from "../lib/snowflake";
import type { Channel, Message, Snowflake } from "../store/types";
import { toast } from "../store/ui";
import { openChannel } from "./navigation";

const PAGE = 25;

async function searchThreads(forumId: Snowflake, offset: number, retry = true): Promise<any> {
  const query = `archived=true&sort_by=last_message_time&sort_order=desc&limit=${PAGE}&tag_setting=match_some&offset=${offset}`;
  const res = await backend.api<any>("GET", `/channels/${forumId}/threads/search?${query}`);
  // L'index de recherche peut ne pas être prêt (code 110000) : on réessaie une fois.
  if (res?.code === 110000 && retry) {
    await new Promise((r) => setTimeout(r, (res.retry_after ?? 2) * 1000));
    return searchThreads(forumId, offset, false);
  }
  return res;
}

export async function loadForumThreads(forumId: Snowflake, more = false) {
  const current = state.forums[forumId];
  if (current?.loading || (more && !current?.hasMore)) return;
  setState("forums", forumId, {
    threadIds: current?.threadIds ?? [],
    firstMessages: current?.firstMessages ?? {},
    hasMore: current?.hasMore ?? true,
    loading: true,
  });

  try {
    const res = await searchThreads(forumId, more ? current!.threadIds.length : 0);
    const threads: any[] = res.threads ?? [];
    for (const t of threads) putChannel(t);
    for (const m of res.members ?? []) if (m.user_id === state.meId) setState("joinedThreads", m.id, true);

    const firstMessages: Record<Snowflake, Message> = {};
    for (const m of res.first_messages ?? []) firstMessages[m.channel_id] = ingestMessage(m);

    const ids = threads.map((t) => t.id);
    const prev = more ? state.forums[forumId].threadIds : [];
    setState("forums", forumId, {
      threadIds: [...prev, ...ids.filter((id) => !prev.includes(id))],
      firstMessages: { ...(more ? state.forums[forumId].firstMessages : {}), ...firstMessages },
      hasMore: !!res.has_more,
      loading: false,
    });
  } catch (e) {
    setState("forums", forumId, "loading", false);
    toast(`Forum unavailable: ${errorMessage(e)}`, true);
  }
}

export async function createForumPost(forumId: Snowflake, title: string, content: string, tags: Snowflake[]) {
  try {
    const thread = await backend.api<any>("POST", `/channels/${forumId}/threads`, {
      name: title,
      auto_archive_duration: 4320,
      applied_tags: tags,
      message: { content },
    });
    putChannel(thread);
    setState("joinedThreads", thread.id, true);
    openChannel(thread.id);
    return true;
  } catch (e) {
    toast(`Couldn't publish: ${errorMessage(e)}`, true);
    return false;
  }
}

// ---------------------------------------------------------------- nouveautés

/** Dernière visite de chaque forum (snowflake de la date), d'un lancement à l'autre. */
const VISITS_KEY = "accord:forumVisits";
/** Repère de la session : fixé à la première ouverture, pour que les badges restent
 *  jusqu'à ce que chaque post soit lu (et non jusqu'au prochain passage sur le forum). */
const [baselines, setBaselines] = createStore<Record<Snowflake, Snowflake | null>>({});

function loadVisits(): Record<Snowflake, Snowflake> {
  try {
    return JSON.parse(localStorage.getItem(VISITS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** À l'ouverture d'un forum, avant de le marquer comme lu. */
export function visitForum(forumId: Snowflake) {
  if (forumId in baselines) return;
  const visits = loadVisits();
  // Première visite : ce que l'état de lecture du forum dit déjà lu.
  setBaselines(forumId, visits[forumId] ?? state.readStates[forumId]?.last_message_id ?? null);
  visits[forumId] = makeNonce();
  if (devFlags.demo) return;
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(visits));
  } catch {
    /* stockage plein : les badges seront seulement moins précis */
  }
}

export type PostNews = "new" | "replies" | null;

/** Post créé depuis la dernière visite et jamais ouvert, ou post avec des réponses non lues. */
export function postNews(thread: Channel): PostNews {
  const rs = state.readStates[thread.id];
  const last = thread.last_message_id ?? thread.id;
  const base = baselines[thread.parent_id ?? ""] ?? null;
  if (rs) return isNewer(last, rs.last_message_id) ? "replies" : null;
  if (!base) return null;
  if (isNewer(thread.id, base)) return "new";
  return isNewer(last, base) ? "replies" : null;
}
