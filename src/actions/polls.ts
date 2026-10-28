// Sondages : voter, retirer son vote, suivre les votes des autres.

import { produce } from "solid-js/store";
import { backend, errorMessage } from "../ipc/tauri";
import { setState, state } from "../store/state";
import type { Message, Snowflake } from "../store/types";
import { toast } from "../store/ui";

/** Applique un vote (le nôtre ou celui de quelqu'un d'autre) au message en mémoire. */
export function applyPollVote(channelId: Snowflake, messageId: Snowflake, answerId: number, add: boolean, mine: boolean) {
  const items = state.messages[channelId]?.items;
  const index = items?.findIndex((m) => m.id === messageId) ?? -1;
  if (index < 0) return;
  setState(
    "messages",
    channelId,
    "items",
    index,
    produce((m: Message) => {
      if (!m.poll) return;
      m.poll.results ??= { answer_counts: [] };
      let row = m.poll.results.answer_counts.find((c) => c.id === answerId);
      if (!row) {
        row = { id: answerId, count: 0, me_voted: false };
        m.poll.results.answer_counts.push(row);
      }
      row.count = Math.max(0, row.count + (add ? 1 : -1));
      if (mine) row.me_voted = add;
    }),
  );
}

/** Remplace nos votes par `answerIds` (vide = retirer). */
export async function vote(msg: Message, answerIds: number[]) {
  try {
    await backend.api("PUT", `/channels/${msg.channel_id}/polls/${msg.id}/answers/@me`, { answer_ids: answerIds.map(String) });
  } catch (e) {
    toast(`Vote not sent: ${errorMessage(e)}`, true);
  }
}
