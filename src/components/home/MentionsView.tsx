// Mentions récentes, tous serveurs et MP confondus.

import { createSignal, For, onMount, Show } from "solid-js";
import { jumpToMessage } from "../../actions/messages";
import { openChannel } from "../../actions/navigation";
import { backend, errorMessage } from "../../ipc/tauri";
import { compactTime } from "../../lib/time";
import { ingestMessage } from "../../store/mutations";
import { channelLabel, displayName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Message } from "../../store/types";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { Markdown } from "../common/Markdown";
import { SkeletonRows } from "../common/Skeleton";

const LIMIT = 25;

export function MentionsView() {
  const [items, setItems] = createSignal<Message[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [more, setMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const load = async (before?: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(LIMIT), roles: "true", everyone: "true" });
      if (before) q.set("before", before);
      const res = await backend.api<any[]>("GET", `/users/@me/mentions?${q}`);
      const msgs = res.map(ingestMessage);
      setItems(before ? [...items(), ...msgs] : msgs);
      setMore(msgs.length === LIMIT);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  onMount(() => void load());

  const remove = (m: Message) => {
    setItems(items().filter((x) => x.id !== m.id));
    void backend.api("DELETE", `/users/@me/mentions/${m.id}`).catch(() => {});
  };
  const where = (m: Message) => {
    const ch = state.channels[m.channel_id];
    const guild = m.guild_id ? state.guilds[m.guild_id]?.name : null;
    return guild ? `${guild} · # ${channelLabel(ch)}` : channelLabel(ch) || "Direct message";
  };

  return (
    <div class="channel-view">
      <header class="channel-header">
        <h1 class="channel-title">Mentions</h1>
      </header>
      <div class="mentions-body">
        <Show when={error()}>
          <p class="error-text">{error()}</p>
        </Show>
        <For each={items()} fallback={loading() ? <SkeletonRows count={6} sub /> : <p class="friends-empty">No recent mentions.</p>}>
          {(m) => (
            <div class="mention-row">
              <button
                class="mention-main"
                onClick={() => {
                  openChannel(m.channel_id);
                  void jumpToMessage(m.channel_id, m.id);
                }}
              >
                <Avatar userId={m.author.id} guildId={m.guild_id} size={32} />
                <span class="mention-text">
                  <span class="mention-head">
                    <b>{displayName(m.author.id, m.guild_id)}</b>
                    <span class="ellipsis">{where(m)}</span>
                    <span class="mention-time">{compactTime(m.timestamp)}</span>
                  </span>
                  <span class="mention-content">
                    <Markdown content={m.content || "(attachment)"} guildId={m.guild_id} inline />
                  </span>
                </span>
              </button>
              <button class="icon-button" title="Remove from this list" onClick={() => remove(m)}>
                <Icon name="x" size={15} />
              </button>
            </div>
          )}
        </For>
        <Show when={more() && items().length}>
          <button class="text-button search-more" disabled={loading()} onClick={() => void load(items()[items().length - 1].id)}>
            {loading() ? "Loading…" : "Older mentions"}
          </button>
        </Show>
      </div>
    </div>
  );
}
