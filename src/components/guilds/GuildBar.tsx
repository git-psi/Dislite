import { createSignal, For, Match, Show, Switch } from "solid-js";
import { openChannel, selectGuild, toggleHome } from "../../actions/navigation";
import { guildIconUrl } from "../../lib/cdn";
import { guildItemKey, guildList, guildUnread, mentionCount, railItems, unreadChannels } from "../../store/selectors";
import { state } from "../../store/state";
import type { GuildListItem, Snowflake } from "../../store/types";
import { currentChannelId, HOME, savePrefs, setUi, ui } from "../../store/ui";
import { openContextMenu } from "../common/ContextMenu";
import { Icon } from "../common/Icon";
import { Logo } from "../common/Logo";
import { SkeletonGuilds } from "../common/Skeleton";
import { guildMenu } from "../common/menus";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => [...w][0] ?? "")
    .join("")
    .slice(0, 4);

function Badge(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="badge">{props.count > 99 ? "99+" : props.count}</span>
    </Show>
  );
}

function GuildIcon(props: { id: Snowflake }) {
  const guild = () => state.guilds[props.id];
  const unread = () => guildUnread(props.id);
  const active = () => ui.guildId === props.id;
  return (
    <div class="guild-item" classList={{ active: active(), unread: unread().unread }}>
      <span class="pill" />
      <button
        class="guild-icon"
        data-tip={guild()?.name}
        onClick={() => selectGuild(props.id)}
        onContextMenu={(e) => openContextMenu(e, guildMenu(props.id))}
      >
        <Show when={guild() && guildIconUrl(guild()!)} fallback={<span class="guild-initials">{initials(guild()?.name ?? "?")}</span>}>
          {(src) => <img src={src()} alt="" draggable={false} />}
        </Show>
        <Badge count={unread().mentions} />
      </button>
    </div>
  );
}

function Folder(props: { item: Extract<GuildListItem, { kind: "folder" }> }) {
  const open = () => !!ui.openFolders[props.item.id];
  const toggle = () => {
    setUi("openFolders", props.item.id, !open());
    savePrefs();
  };
  const color = () => (props.item.color ? `#${props.item.color.toString(16).padStart(6, "0")}` : "var(--accent)");
  const stats = () =>
    props.item.guildIds.reduce(
      (acc, id) => {
        const u = guildUnread(id);
        return { unread: acc.unread || u.unread, mentions: acc.mentions + u.mentions };
      },
      { unread: false, mentions: 0 },
    );
  const containsActive = () => props.item.guildIds.includes(ui.guildId);

  return (
    <div class="folder" classList={{ open: open() }} style={{ "--folder-color": color() }}>
      <div class="guild-item" classList={{ unread: !open() && stats().unread, active: !open() && containsActive() }}>
        <span class="pill" />
        <button class="guild-icon folder-icon" data-tip={props.item.name ?? "Folder"} onClick={toggle}>
          <Show
            when={open()}
            fallback={
              <div class="folder-preview">
                <For each={props.item.guildIds.slice(0, 4)}>
                  {(id) => {
                    const g = state.guilds[id];
                    const src = g && guildIconUrl(g, 32);
                    return src ? <img src={src} alt="" /> : <span>{initials(g?.name ?? "")}</span>;
                  }}
                </For>
              </div>
            }
          >
            <Icon name="folder" size={22} style={{ color: color() }} />
          </Show>
          <Show when={!open()}>
            <Badge count={stats().mentions} />
          </Show>
        </button>
      </div>
      <Show when={open()}>
        <For each={props.item.guildIds}>{(id) => <GuildIcon id={id} />}</For>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- réorganisation

const [drag, setDrag] = createSignal<{ key: string; over: number } | null>(null);

/** `over` est une position dans le rail affiché : on la convertit en position dans la
 *  liste complète (les serveurs masqués gardent leur place). */
function moveItem(key: string, over: number) {
  const before = railItems().map(guildItemKey)[over] ?? null;
  if (before === key) return;
  const keys = guildList().map(guildItemKey);
  const from = keys.indexOf(key);
  if (from < 0) return;
  keys.splice(from, 1);
  const to = before ? keys.indexOf(before) : -1;
  keys.splice(to < 0 ? keys.length : to, 0, key);
  setUi("guildOrderLocal", keys);
  savePrefs();
}

/** Glisser un serveur ou un dossier du rail (au-delà de 6 px, sinon c'est un clic). */
function startDrag(e: MouseEvent, key: string) {
  if (e.button !== 0) return;
  const startY = e.clientY;
  let dragging = false;
  const move = (ev: MouseEvent) => {
    if (!dragging && Math.abs(ev.clientY - startY) < 6) return;
    dragging = true;
    const slots = [...document.querySelectorAll<HTMLElement>(".guild-scroll > .rail-slot")];
    const idx = slots.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    });
    setDrag({ key, over: idx < 0 ? slots.length : idx });
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    const d = drag();
    setDrag(null);
    if (!dragging || !d) return;
    moveItem(d.key, d.over);
    // Le clic qui suit le relâchement ne doit pas ouvrir le serveur.
    const swallow = (ce: Event) => {
      ce.stopPropagation();
      ce.preventDefault();
    };
    document.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 50);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

export function GuildBar() {
  const unread = () => unreadChannels("all");
  const hiddenCount = () => Object.keys(ui.hiddenGuilds).filter((id) => state.guilds[id]).length;
  const dmMentions = () => state.privateChannelIds.reduce((n, id) => n + mentionCount(id), 0);
  // Ouvre le prochain non-lu (mentions d'abord), en sautant celui déjà affiché.
  const openNextUnread = () => {
    const list = unread();
    const next = list.find((id) => id !== currentChannelId()) ?? list[0];
    if (next) openChannel(next);
  };

  return (
    <nav class="guild-bar">
      <div class="guild-scroll">
        <div class="guild-item" classList={{ active: ui.guildId === HOME }}>
          <span class="pill" />
          <button class="guild-icon home" data-tip={ui.guildId === HOME && !currentChannelId() && ui.homePage === "home" ? "Friends" : "Home"} onClick={toggleHome}>
            <Logo size={28} />
            <Badge count={dmMentions()} />
          </button>
        </div>
        <div class="guild-separator" />
        <Show when={!state.ready && !guildList().length}>
          <SkeletonGuilds />
        </Show>
        <For each={railItems()}>
          {(item, i) => (
            <div
              class="rail-slot"
              classList={{
                "drop-before": drag()?.over === i() && drag()?.key !== guildItemKey(item),
                dragging: drag()?.key === guildItemKey(item),
              }}
              onMouseDown={(e) => startDrag(e, guildItemKey(item))}
            >
              <Switch>
                <Match when={item.kind === "guild" && item} keyed>{(g) => <GuildIcon id={g.id} />}</Match>
                <Match when={item.kind === "folder" && item} keyed>
                  {(f) => <Folder item={f as Extract<GuildListItem, { kind: "folder" }>} />}
                </Match>
              </Switch>
            </div>
          )}
        </For>
        <div class="rail-end" classList={{ "drop-before": drag()?.over === railItems().length }} />
      </div>
      <button
        class="rail-servers"
        classList={{ active: ui.serversView }}
        data-tip={`All servers${hiddenCount() ? ` · ${hiddenCount()} hidden` : ""} (Ctrl G)`}
        onClick={() => setUi("serversView", true)}
      >
        <Icon name="grid" size={18} />
      </button>
      <button
        class="unread-jump"
        classList={{ empty: !unread().length }}
        disabled={!unread().length}
        data-tip={unread().length ? "Open next unread" : "All caught up"}
        onClick={openNextUnread}
      >
        <span class="unread-count">{unread().length > 99 ? "99+" : unread().length}</span>
        <span class="unread-label">unread</span>
      </button>
    </nav>
  );
}
