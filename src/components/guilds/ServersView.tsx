// Vue de tous les serveurs (Ctrl+G ou bouton du rail) : chercher, ouvrir, masquer du rail,
// mettre en sourdine, quitter. Tout vient de l'état déjà chargé : aucune requête.

import { createMemo, createSignal, For, Show } from "solid-js";
import { canLeaveGuild, leaveGuild } from "../../actions/guilds";
import { toggleGuildMute } from "../../actions/mute";
import { selectGuild } from "../../actions/navigation";
import { guildIconUrl } from "../../lib/cdn";
import { channelGroups, guildList, guildUnread, isGuildMuted } from "../../store/selectors";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { setUi, toggleGuildHidden, ui } from "../../store/ui";
import { Icon } from "../common/Icon";
import { Modal } from "../common/Modal";

type Filter = "all" | "shown" | "hidden";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => [...w][0] ?? "")
    .join("")
    .slice(0, 3);

/** Serveurs dans l'ordre du rail (dossiers dépliés), avec le nom du dossier éventuel. */
function orderedGuilds(): { id: Snowflake; folder: string | null }[] {
  return guildList().flatMap((item): { id: Snowflake; folder: string | null }[] =>
    item.kind === "guild" ? [{ id: item.id, folder: null }] : item.guildIds.map((id) => ({ id, folder: item.name || "Folder" })),
  );
}

function ServerCard(props: { id: Snowflake; folder: string | null; onOpen: () => void }) {
  const guild = () => state.guilds[props.id];
  const hidden = () => !!ui.hiddenGuilds[props.id];
  const muted = () => isGuildMuted(props.id);
  const unread = () => guildUnread(props.id);
  const channels = () => channelGroups(props.id).reduce((n, g) => n + g.channels.length, 0);
  const owner = () => guild()?.owner_id === state.meId;
  const icon = () => guild() && guildIconUrl(guild()!, 96);

  const facts = () => {
    const g = guild();
    const parts: string[] = [];
    if (g?.member_count) parts.push(`${compact.format(g.member_count)} member${g.member_count > 1 ? "s" : ""}`);
    if (channels()) parts.push(`${channels()} channel${channels() > 1 ? "s" : ""}`);
    return parts.join(" · ");
  };
  const origin = () => {
    const parts: string[] = [];
    if (guild()?.joined_at) parts.push(`Joined ${monthYear.format(new Date(guild()!.joined_at!))}`);
    if (props.folder) parts.push(props.folder);
    return parts.join(" · ");
  };
  // Les boutons d'action ne doivent pas ouvrir le serveur.
  const act = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      class="server-card"
      classList={{ hidden: hidden(), active: ui.guildId === props.id }}
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && props.onOpen()}
    >
      <div class="sc-top">
        <div class="sc-icon">
          <Show when={icon()} fallback={<span>{initials(guild()?.name ?? "?")}</span>}>
            {(src) => <img src={src()} alt="" loading="lazy" draggable={false} />}
          </Show>
        </div>
        <div class="sc-title">
          <span class="sc-name" title={guild()?.name}>{guild()?.name}</span>
          <Show when={facts()}>
            <span class="sc-meta">{facts()}</span>
          </Show>
        </div>
        <Show when={unread().mentions > 0} fallback={<Show when={unread().unread && !muted()}><span class="sc-dot" title="Unread" /></Show>}>
          <span class="badge">{unread().mentions}</span>
        </Show>
      </div>

      <Show when={origin()}>
        <span class="sc-meta">{origin()}</span>
      </Show>

      <div class="sc-foot">
        <div class="sc-tags">
          <Show when={owner()}><span class="sc-tag">Owner</span></Show>
          <Show when={muted()}><span class="sc-tag">Muted</span></Show>
          <Show when={hidden()}><span class="sc-tag">Hidden</span></Show>
        </div>
        <div class="sc-actions">
          <button
            class="icon-button"
            title={hidden() ? "Show in sidebar" : "Hide from sidebar"}
            onClick={act(() => toggleGuildHidden(props.id))}
          >
            <Icon name={hidden() ? "eye-off" : "eye"} size={16} />
          </button>
          <button class="icon-button" title={muted() ? "Unmute" : "Mute"} onClick={act(() => toggleGuildMute(props.id))}>
            <Icon name={muted() ? "bell-off" : "bell"} size={16} />
          </button>
          <button
            class="icon-button danger"
            title={canLeaveGuild(props.id) ? "Leave server" : "You own this server"}
            disabled={!canLeaveGuild(props.id)}
            onClick={act(() => void leaveGuild(props.id))}
          >
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ServersView() {
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<Filter>("all");
  const close = () => setUi("serversView", false);

  const all = createMemo(() => orderedGuilds().filter((g) => state.guilds[g.id] && !state.guilds[g.id].unavailable));
  const hiddenCount = () => all().filter((g) => ui.hiddenGuilds[g.id]).length;
  const results = () => {
    const q = query().trim().toLowerCase();
    return all().filter((g) => {
      const hidden = !!ui.hiddenGuilds[g.id];
      if ((filter() === "shown" && hidden) || (filter() === "hidden" && !hidden)) return false;
      return !q || state.guilds[g.id].name.toLowerCase().includes(q) || !!g.folder?.toLowerCase().includes(q);
    });
  };
  const open = (id: Snowflake) => {
    selectGuild(id);
    close();
  };

  const FILTERS: { id: Filter; label: () => string }[] = [
    { id: "all", label: () => `All ${all().length}` },
    { id: "shown", label: () => "In sidebar" },
    { id: "hidden", label: () => `Hidden ${hiddenCount()}` },
  ];

  return (
    <Modal onClose={close} class="servers-modal">
      <header class="servers-head">
        <h2>Servers</h2>
        <input
          class="servers-search"
          placeholder="Search servers"
          value={query()}
          autofocus
          ref={(el) => setTimeout(() => el.focus())}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results()[0]) open(results()[0].id);
          }}
        />
        <div class="segmented">
          <For each={FILTERS}>
            {(f) => (
              <button classList={{ active: filter() === f.id }} onClick={() => setFilter(f.id)}>
                {f.label()}
              </button>
            )}
          </For>
        </div>
        <button class="icon-button servers-close" title="Close (Esc)" onClick={close}>
          <Icon name="x" size={18} />
        </button>
      </header>
      <p class="servers-hint">
        Hidden servers leave the sidebar and the unread count. They stay here and in <kbd>Ctrl K</kbd>.
      </p>
      <div class="servers-grid">
        <For each={results()} fallback={<p class="servers-empty muted">No server matches.</p>}>
          {(g) => <ServerCard id={g.id} folder={g.folder} onOpen={() => open(g.id)} />}
        </For>
      </div>
    </Modal>
  );
}
