import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { emojiUrl } from "../../lib/cdn";
import { UNICODE_EMOJIS } from "../../lib/emoji";
import { me, state } from "../../store/state";
import type { Emoji, Snowflake } from "../../store/types";

/** Emojis personnalisés utilisables : ceux du serveur courant, ou tous avec Nitro. */
export function usableCustomEmojis(guildId?: Snowflake): { guildId: Snowflake; emojis: Emoji[] }[] {
  const nitro = !!me()?.premium_type;
  const ids = nitro ? Object.keys(state.guilds) : guildId ? [guildId] : [];
  return ids
    .map((id) => ({ guildId: id, emojis: (state.guilds[id]?.emojis ?? []).filter((e) => e.available !== false && (nitro || !e.animated)) }))
    .filter((g) => g.emojis.length);
}

export function emojiToText(e: Emoji) {
  return e.id ? `<${e.animated ? "a" : ""}:${e.name}:${e.id}>` : e.name;
}

const PICKER_W = 340;
const PICKER_H = 380;
const MARGIN = 8;

/** Position fixe à côté du bouton, au-dessus si la place le permet, toujours dans la fenêtre. */
function placeNear(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const above = r.top - PICKER_H - MARGIN >= MARGIN;
  const top = above ? r.top - PICKER_H - MARGIN : Math.min(r.bottom + MARGIN, window.innerHeight - PICKER_H - MARGIN);
  const left = Math.min(Math.max(MARGIN, r.right - PICKER_W), window.innerWidth - PICKER_W - MARGIN);
  return { top: `${Math.max(MARGIN, top)}px`, left: `${left}px` };
}

export function EmojiPicker(props: {
  anchor: HTMLElement;
  guildId?: Snowflake;
  onPick: (e: Emoji) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  let input!: HTMLInputElement;
  let root!: HTMLDivElement;

  onMount(() => {
    input.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!root.contains(target) && !props.anchor.contains(target)) props.onClose();
    };
    // Différé : le clic qui ouvre le sélecteur ne doit pas le refermer.
    setTimeout(() => document.addEventListener("mousedown", onDown));
    onCleanup(() => document.removeEventListener("mousedown", onDown));
  });

  const custom = createMemo(() => {
    const q = query().toLowerCase();
    return usableCustomEmojis(props.guildId)
      .map((g) => ({ ...g, emojis: q ? g.emojis.filter((e) => e.name.toLowerCase().includes(q)) : g.emojis }))
      .filter((g) => g.emojis.length);
  });
  const unicode = createMemo(() => {
    const q = query().toLowerCase();
    return q ? UNICODE_EMOJIS.filter((e) => e.names.some((n) => n.includes(q))) : UNICODE_EMOJIS;
  });

  return (
    <Portal>
      <div
        class="popover emoji-picker"
        ref={root}
        style={placeNear(props.anchor)}
        onKeyDown={(e) => e.key === "Escape" && props.onClose()}
      >
        <input
          ref={input}
          class="emoji-search"
          placeholder="Search emoji"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="emoji-scroll">
          <For each={custom()}>
            {(g) => (
              <>
                <div class="emoji-section">{state.guilds[g.guildId]?.name}</div>
                <div class="emoji-grid">
                  <For each={g.emojis}>
                    {(e) => (
                      <button class="emoji-cell" title={`:${e.name}:`} onClick={() => props.onPick(e)}>
                        <img src={emojiUrl(e.id!, e.animated, 48)} alt={e.name} loading="lazy" />
                      </button>
                    )}
                  </For>
                </div>
              </>
            )}
          </For>
          <Show when={unicode().length}>
            <div class="emoji-section">Emojis</div>
            <div class="emoji-grid">
              <For each={unicode()}>
                {(e) => (
                  <button class="emoji-cell unicode" title={`:${e.names[0]}:`} onClick={() => props.onPick({ id: null, name: e.char })}>
                    {e.char}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
