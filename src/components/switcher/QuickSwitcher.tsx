// Sélecteur rapide (Ctrl+K) : salons, conversations et serveurs.
// Préfixes : « # » salons, « @ » personnes / MP, « * » serveurs.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { openChannel, selectGuild } from "../../actions/navigation";
import { avatarUrl, channelIconUrl, guildIconUrl } from "../../lib/cdn";
import { P } from "../../lib/permissions";
import { can, channelLabel, dmRecipient, isChannelMuted, isUnread, mentionCount } from "../../store/selectors";
import { state } from "../../store/state";
import type { Channel, Snowflake } from "../../store/types";
import { isForumLike, isTextLike } from "../../store/types";
import { setUi, ui } from "../../store/ui";
import { channelIcon, Icon } from "../common/Icon";
import { Modal } from "../common/Modal";

interface Result {
  key: string;
  guildId?: Snowflake;
  kind: "channel" | "dm" | "guild";
  label: string;
  hint?: string;
  icon?: string | null;
  iconName?: Parameters<typeof channelIcon>[0];
  unread: boolean;
  mentions: number;
  score: number;
  open: () => void;
}

/** Score de correspondance approximative (0 = aucune) : sous-séquence, bonus préfixe et début de mot. */
function fuzzy(query: string, text: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 300 - idx - t.length / 10;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    streak = found === ti ? streak + 1 : 0;
    const wordStart = found === 0 || /[\s\-_.]/.test(t[found - 1]);
    score += 1 + streak * 2 + (wordStart ? 4 : 0);
    ti = found + 1;
  }
  return score;
}

function channelResult(ch: Channel): Omit<Result, "score"> {
  const guild = ch.guild_id ? state.guilds[ch.guild_id] : undefined;
  if (!guild) {
    const r = dmRecipient(ch);
    return {
      key: ch.id,
      kind: "dm",
      label: channelLabel(ch),
      hint: r?.username,
      icon: r ? avatarUrl(r, 32) : ch.icon ? channelIconUrl(ch.id, ch.icon, 32) : null,
      unread: isUnread(ch.id),
      mentions: mentionCount(ch.id),
      open: () => openChannel(ch.id),
    };
  }
  const parent = ch.parent_id ? state.channels[ch.parent_id] : undefined;
  return {
    key: ch.id,
    guildId: ch.guild_id,
    kind: "channel",
    label: ch.name ?? "",
    hint: parent && parent.type !== 4 ? `${parent.name} · ${guild.name}` : guild.name,
    iconName: ch.type,
    unread: isUnread(ch.id) && !isChannelMuted(ch.id),
    mentions: mentionCount(ch.id),
    open: () => openChannel(ch.id),
  };
}

function candidates(mode: string): Omit<Result, "score">[] {
  const out: Omit<Result, "score">[] = [];
  if (mode === "" || mode === "@") {
    for (const id of state.privateChannelIds) {
      const ch = state.channels[id];
      if (ch) out.push(channelResult(ch));
    }
  }
  if (mode === "" || mode === "#") {
    for (const gid of Object.keys(state.guilds)) {
      for (const cid of state.guildChannels[gid] ?? []) {
        const ch = state.channels[cid];
        if (!ch || !(isTextLike(ch) || isForumLike(ch)) || !can(cid, P.VIEW_CHANNEL)) continue;
        out.push(channelResult(ch));
        for (const tid of state.threads[cid] ?? []) {
          if (state.joinedThreads[tid] && state.channels[tid]) out.push(channelResult(state.channels[tid]));
        }
      }
    }
  }
  if (mode === "" || mode === "*") {
    for (const g of Object.values(state.guilds)) {
      if (g.unavailable) continue;
      out.push({
        key: g.id,
        kind: "guild",
        label: g.name,
        hint: "Server",
        icon: guildIconUrl(g, 32),
        unread: false,
        mentions: 0,
        open: () => selectGuild(g.id),
      });
    }
  }
  return out;
}

export function QuickSwitcher() {
  let input!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const close = () => setUi("quickSwitcher", false);

  onMount(() => input.focus());

  const results = createMemo<Result[]>(() => {
    const raw = query().trim();
    const mode = /^[#@*]/.test(raw) ? raw[0] : "";
    const q = mode ? raw.slice(1).trim() : raw;

    if (!q) {
      // Sans recherche : non-lus avec mention, puis salons récents.
      const seen = new Set<Snowflake>();
      const list: Result[] = [];
      const push = (ch: Channel | undefined, score: number) => {
        if (!ch || seen.has(ch.id)) return;
        seen.add(ch.id);
        list.push({ ...channelResult(ch), score });
      };
      for (const id of Object.keys(state.readStates)) if (mentionCount(id) > 0) push(state.channels[id], 2);
      for (const id of ui.history) push(state.channels[id], 1);
      return list.filter((r) => !mode || (mode === "@" ? r.kind === "dm" : mode === "#" ? r.kind === "channel" : false)).slice(0, 12);
    }

    return candidates(mode)
      .map((r) => {
        const base = Math.max(fuzzy(q, r.label), fuzzy(q, r.hint ?? "") * 0.3);
        if (!base) return { ...r, score: 0 };
        // Départage : non-lus, serveur courant, salons visités récemment.
        const recent = ui.history.indexOf(r.key);
        const bonus =
          (r.mentions ? 20 : r.unread ? 5 : 0) +
          (r.guildId && r.guildId === ui.guildId ? 12 : 0) +
          (recent >= 0 ? 10 - Math.min(recent, 9) : 0);
        return { ...r, score: base + bonus };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  });

  const pick = (r: Result | undefined) => {
    if (!r) return;
    close();
    r.open();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const n = results().length;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setSelected((selected() + 1) % Math.max(n, 1));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setSelected((selected() - 1 + n) % Math.max(n, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results()[selected()]);
    }
  };

  return (
    <Modal onClose={close} class="switcher">
      <input
        ref={input}
        class="switcher-input"
        placeholder="Where to?"
        value={query()}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setSelected(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div class="switcher-results">
        <Show when={!query().trim()}>
          <div class="section-title">{results().length ? "Unread & recent" : "Start typing a name"}</div>
        </Show>
        <For each={results()} fallback={<Show when={query().trim()}><p class="empty muted">No results.</p></Show>}>
          {(r, i) => (
            <button
              class="switcher-item"
              classList={{ selected: i() === selected(), unread: r.unread }}
              onMouseEnter={() => setSelected(i())}
              onClick={() => pick(r)}
            >
              <Show
                when={r.icon}
                fallback={
                  <span class="switcher-glyph">
                    <Icon name={r.kind === "guild" ? "home" : r.kind === "dm" ? "users" : channelIcon(r.iconName ?? 0)} size={18} />
                  </span>
                }
              >
                <img class="switcher-icon" classList={{ round: r.kind === "dm" }} src={r.icon!} alt="" />
              </Show>
              <span class="switcher-label ellipsis">{r.label}</span>
              <Show when={r.hint}><span class="switcher-hint ellipsis">{r.hint}</span></Show>
              <Show when={r.mentions > 0}><span class="badge">{r.mentions}</span></Show>
            </button>
          )}
        </For>
      </div>
      <div class="switcher-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>#</kbd> channels <kbd>@</kbd> people <kbd>*</kbd> servers</span>
      </div>
    </Modal>
  );
}
