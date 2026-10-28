// Composants des messages d'applications : boutons, menus, et blocs « V2 » (texte, sections,
// séparateurs, galeries, conteneurs). Rendu simple, interactions comme le client officiel.

import { openUrl } from "@tauri-apps/plugin-opener";
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { interact } from "../../actions/interactions";
import { emojiUrl, scaledMedia } from "../../lib/cdn";
import type { Message } from "../../store/types";
import { setUi } from "../../store/ui";
import { Markdown } from "../common/Markdown";

const STYLE = ["", "primary", "secondary", "success", "danger", "link", "premium"];

function Emoji(props: { emoji?: { id?: string | null; name?: string; animated?: boolean } }) {
  return (
    <Show when={props.emoji}>
      {(e) => (e().id ? <img class="emoji" src={emojiUrl(e().id!, e().animated)} alt="" /> : <span>{e().name}</span>)}
    </Show>
  );
}

function Button(props: { msg: Message; c: any }) {
  const [busy, setBusy] = createSignal(false);
  const click = () => {
    if (props.c.style === 5 && props.c.url) return void openUrl(props.c.url);
    if (busy()) return;
    setBusy(true);
    void interact(props.msg, { component_type: 2, custom_id: props.c.custom_id }).finally(() => setTimeout(() => setBusy(false), 1500));
  };
  return (
    <button class={`app-button ${STYLE[props.c.style] ?? "secondary"}`} classList={{ busy: busy() }} disabled={props.c.disabled} onClick={click}>
      <Emoji emoji={props.c.emoji} />
      <Show when={props.c.label}><span>{props.c.label}</span></Show>
    </button>
  );
}

function Select(props: { msg: Message; c: any }) {
  // Menus d'utilisateurs / rôles / salons : pas de liste locale, seulement les menus texte.
  return (
    <Show when={props.c.type === 3} fallback={<div class="app-select muted small">{props.c.placeholder ?? "Selection menu"} (official app)</div>}>
      <select
        class="app-select"
        disabled={props.c.disabled}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (value) void interact(props.msg, { component_type: 3, custom_id: props.c.custom_id, type: 3, values: [value] });
        }}
      >
        <option value="">{props.c.placeholder ?? "Make a selection"}</option>
        <For each={props.c.options ?? []}>{(o: any) => <option value={o.value}>{o.label}</option>}</For>
      </select>
    </Show>
  );
}

function Node(props: { msg: Message; c: any }): JSX.Element {
  const c = () => props.c;
  return (
    <Switch>
      {/* Rangée d'actions */}
      <Match when={c().type === 1}>
        <div class="app-row">
          <For each={c().components ?? []}>{(child) => <Node msg={props.msg} c={child} />}</For>
        </div>
      </Match>
      <Match when={c().type === 2}>
        <Button msg={props.msg} c={c()} />
      </Match>
      <Match when={[3, 5, 6, 7, 8].includes(c().type)}>
        <Select msg={props.msg} c={c()} />
      </Match>
      {/* Section : textes + accessoire (bouton ou vignette) */}
      <Match when={c().type === 9}>
        <div class="app-section">
          <div class="app-section-text">
            <For each={c().components ?? []}>{(child) => <Node msg={props.msg} c={child} />}</For>
          </div>
          <Show when={c().accessory}>{(a) => <Node msg={props.msg} c={a()} />}</Show>
        </div>
      </Match>
      <Match when={c().type === 10}>
        <div class="app-text markdown"><Markdown content={c().content ?? ""} guildId={props.msg.guild_id} jumbo={false} /></div>
      </Match>
      <Match when={c().type === 11 && c().media?.url}>
        <img class="app-thumb" src={scaledMedia(c().media.proxy_url ?? c().media.url, 160, 160) ?? c().media.url} alt="" loading="lazy" />
      </Match>
      <Match when={c().type === 12}>
        <div class="app-gallery">
          <For each={c().items ?? []}>
            {(it: any) => (
              <img
                src={scaledMedia(it.media?.proxy_url ?? it.media?.url, 400, 300) ?? it.media?.url}
                alt={it.description ?? ""}
                loading="lazy"
                onClick={() => setUi("lightbox", { url: it.media.url, original: it.media.url })}
              />
            )}
          </For>
        </div>
      </Match>
      <Match when={c().type === 14}>
        <hr class="app-separator" classList={{ invisible: c().divider === false }} />
      </Match>
      <Match when={c().type === 17}>
        <div class="app-container" style={{ "border-left-color": c().accent_color ? `#${c().accent_color.toString(16).padStart(6, "0")}` : "var(--bg-4)" }}>
          <For each={c().components ?? []}>{(child) => <Node msg={props.msg} c={child} />}</For>
        </div>
      </Match>
    </Switch>
  );
}

export function Components(props: { msg: Message }) {
  return (
    <div class="app-components">
      <For each={props.msg.components ?? []}>{(c) => <Node msg={props.msg} c={c} />}</For>
    </div>
  );
}
