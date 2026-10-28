// Panneau de recherche (à droite de la discussion) : serveur entier ou conversation privée.

import { createSignal, For, Show } from "solid-js";
import { jumpToMessage } from "../../actions/messages";
import { openChannel } from "../../actions/navigation";
import { PAGE, searchMessages } from "../../actions/search";
import { compactTime } from "../../lib/time";
import { channelLabel, displayName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Message, Snowflake } from "../../store/types";
import { setUi } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { Markdown } from "../common/Markdown";

export function SearchPanel(props: { channelId: Snowflake }) {
  const guildId = () => state.channels[props.channelId]?.guild_id;
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Message[]>([]);
  const [total, setTotal] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const run = async (more = false) => {
    if (busy()) return;
    setBusy(true);
    const scope = guildId() ? { guildId: guildId() } : { channelId: props.channelId };
    const res = await searchMessages(scope, query(), more ? results().length : 0);
    setBusy(false);
    setError(res.error ?? null);
    setTotal(res.error ? null : res.total);
    setResults(more ? [...results(), ...res.messages] : res.messages);
  };

  const open = (m: Message) => {
    if (m.channel_id !== props.channelId) openChannel(m.channel_id);
    void jumpToMessage(m.channel_id, m.id);
  };

  return (
    <aside class="search-panel">
      <div class="search-field">
        <Icon name="search" size={15} />
        <input
          placeholder={guildId() ? `Search ${state.guilds[guildId()!]?.name ?? "server"}` : "Search this conversation"}
          value={query()}
          ref={(el) => setTimeout(() => el.focus())}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
            if (e.key === "Escape") setUi("search", false);
          }}
        />
        <button class="icon-button" title="Close (Esc)" onClick={() => setUi("search", false)}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <p class="search-help">
        <code>from:name</code> <Show when={guildId()}><code>in:channel</code> </Show>
        <code>has:link</code> <code>has:image</code> <code>has:file</code>
      </p>
      <Show when={error()}>
        <p class="search-note error-text">{error()}</p>
      </Show>
      <Show when={total() !== null}>
        <p class="search-note">{total() === 0 ? "No results." : `${total()} result${total()! > 1 ? "s" : ""}`}</p>
      </Show>
      <div class="search-results">
        <For each={results()}>
          {(m) => (
            <button class="search-hit" onClick={() => open(m)}>
              <Avatar userId={m.author.id} guildId={m.guild_id ?? guildId()} size={28} />
              <span class="search-hit-body">
                <span class="search-hit-head">
                  <b>{displayName(m.author.id, guildId())}</b>
                  <Show when={guildId() && m.channel_id !== props.channelId}>
                    <span># {channelLabel(state.channels[m.channel_id])}</span>
                  </Show>
                  <span class="search-hit-time">{compactTime(m.timestamp)}</span>
                </span>
                <span class="search-hit-text">
                  <Show when={m.content} fallback={<i>{m.attachments.length ? `${m.attachments.length} attachment(s)` : "Embed"}</i>}>
                    <Markdown content={m.content} guildId={guildId()} inline />
                  </Show>
                </span>
              </span>
            </button>
          )}
        </For>
        <Show when={total() !== null && results().length < total()! && results().length >= PAGE}>
          <button class="text-button search-more" disabled={busy()} onClick={() => void run(true)}>
            {busy() ? "Loading…" : "More results"}
          </button>
        </Show>
      </div>
    </aside>
  );
}
