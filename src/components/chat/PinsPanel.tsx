// Pinned messages du salon (bouton de l'en-tête).

import { createResource, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { fetchPins, jumpToMessage } from "../../actions/messages";
import { compactTime } from "../../lib/time";
import { displayName, memberColor } from "../../store/selectors";
import type { Snowflake } from "../../store/types";
import { Avatar } from "../common/Avatar";
import { Markdown } from "../common/Markdown";

export function PinsPanel(props: { channelId: Snowflake; anchor: HTMLElement; onClose: () => void }) {
  let root!: HTMLDivElement;
  const [pins] = createResource(() => props.channelId, fetchPins);
  const r = props.anchor.getBoundingClientRect();
  const style = { top: `${r.bottom + 6}px`, right: `${Math.max(8, innerWidth - r.right)}px` };

  onMount(() => {
    const close = (e: MouseEvent) => !root.contains(e.target as Node) && !props.anchor.contains(e.target as Node) && props.onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <Portal>
      <div class="popover pins-panel" ref={root} style={style}>
        <div class="pins-title">Pinned messages</div>
        <div class="pins-list">
          <Show when={!pins.loading} fallback={<div class="history-loader"><div class="spinner" /></div>}>
            <For each={pins() ?? []} fallback={<p class="empty muted">No pinned messages.</p>}>
              {(m) => (
                <button
                  class="pin-item"
                  onClick={() => {
                    props.onClose();
                    void jumpToMessage(props.channelId, m.id);
                  }}
                >
                  <Avatar userId={m.author.id} guildId={m.guild_id} size={24} />
                  <div class="pin-body">
                    <div class="pin-head">
                      <span class="pin-author" style={{ color: memberColor(m.guild_id, m.author.id) }}>{displayName(m.author.id, m.guild_id)}</span>
                      <span class="timestamp">{compactTime(m.timestamp)}</span>
                    </div>
                    <div class="pin-content">
                      <Show when={m.content} fallback={<i class="muted">{m.attachments.length ? "Attachment" : "Embedded content"}</i>}>
                        <Markdown content={m.content.slice(0, 400)} guildId={m.guild_id} jumbo={false} />
                      </Show>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
