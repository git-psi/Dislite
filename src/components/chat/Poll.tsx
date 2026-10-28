// Sondage : choisir puis voter ; résultats en barres une fois voté ou terminé.

import { createSignal, For, Show } from "solid-js";
import { vote } from "../../actions/polls";
import { emojiUrl } from "../../lib/cdn";
import { relativeTime } from "../../lib/time";
import type { Message, Poll as PollData } from "../../store/types";
import { Icon } from "../common/Icon";

export function Poll(props: { msg: Message; poll: PollData }) {
  const [picked, setPicked] = createSignal<number[]>([]);
  const counts = () => props.poll.results?.answer_counts ?? [];
  const countOf = (id: number) => counts().find((c) => c.id === id)?.count ?? 0;
  const mine = (id: number) => !!counts().find((c) => c.id === id)?.me_voted;
  const total = () => counts().reduce((n, c) => n + c.count, 0);
  const voted = () => counts().some((c) => c.me_voted);
  const ended = () => !!props.poll.results?.is_finalized || (!!props.poll.expiry && Date.parse(props.poll.expiry) < Date.now());
  const showResults = () => voted() || ended();

  const pick = (id: number) => {
    if (showResults()) return;
    if (props.poll.allow_multiselect) setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    else setPicked([id]);
  };
  const status = () => {
    if (ended()) return "Poll closed";
    return props.poll.expiry ? `Ends ${relativeTime(Date.parse(props.poll.expiry))}` : "";
  };

  return (
    <div class="poll">
      <div class="poll-question">{props.poll.question.text}</div>
      <div class="poll-hint">{props.poll.allow_multiselect ? "Pick one or more" : "Pick one"}</div>
      <div class="poll-answers">
        <For each={props.poll.answers}>
          {(a) => {
            const share = () => (total() ? Math.round((countOf(a.answer_id) / total()) * 100) : 0);
            return (
              <button
                class="poll-answer"
                classList={{ picked: picked().includes(a.answer_id), mine: mine(a.answer_id), results: showResults() }}
                onClick={() => pick(a.answer_id)}
              >
                <Show when={showResults()}>
                  <span class="poll-bar" style={{ width: `${share()}%` }} />
                </Show>
                <Show when={a.poll_media.emoji}>
                  {(e) => (e().id ? <img class="emoji" src={emojiUrl(e().id!, e().animated)} alt="" /> : <span>{e().name}</span>)}
                </Show>
                <span class="poll-text">{a.poll_media.text}</span>
                <Show when={showResults()} fallback={<span class="poll-check">{picked().includes(a.answer_id) && <Icon name="check" size={12} />}</span>}>
                  <Show when={mine(a.answer_id)}><Icon name="check" size={13} /></Show>
                  <span class="poll-share">{share()} %</span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
      <div class="poll-foot">
        <span>{total()} vote{total() === 1 ? "" : "s"}{status() ? ` · ${status()}` : ""}</span>
        <Show when={!ended()}>
          <Show
            when={voted()}
            fallback={
              <button class="btn primary small" disabled={!picked().length} onClick={() => void vote(props.msg, picked())}>
                Vote
              </button>
            }
          >
            <button class="text-button" onClick={() => void vote(props.msg, [])}>Remove vote</button>
          </Show>
        </Show>
      </div>
    </div>
  );
}
