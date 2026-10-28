import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { ackChannel, loadMessages, setNsfwBlocked } from "../../actions/messages";
import { openChannel, selectGuild } from "../../actions/navigation";
import { subscribeGuild } from "../../gateway/client";
import { channelLabel, displayName, dmRecipient, isAgeBlocked, isUnread, privateChannelName, typingUserIds } from "../../store/selectors";
import { settings } from "../../store/settings";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { isForumLike, isThread } from "../../store/types";
import { membersVisible, setUi, toggleMembers, toggleMiniMode, ui } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { channelIcon, Icon } from "../common/Icon";
import { Markdown } from "../common/Markdown";
import { openProfile } from "../profile/ProfilePopout";
import { MemberList } from "../members/MemberList";
import { addFilesToDraft, Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { PinsPanel } from "./PinsPanel";
import { SearchPanel } from "./SearchPanel";
import { inVoice, startCall } from "../../actions/voice";
import { CallBar } from "../voice/CallBar";
import { leaveGroup, renameGroup } from "../../actions/groups";
import { openContextMenu } from "../common/ContextMenu";
import { Prompt } from "../common/Prompt";

function TypingIndicator(props: { channelId: Snowflake }) {
  const guildId = () => state.channels[props.channelId]?.guild_id;
  const text = () => {
    const ids = typingUserIds(props.channelId);
    const names = ids.map((id) => displayName(id, guildId()));
    if (!names.length) return "";
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are typing…`;
    return "Several people are typing…";
  };
  return (
    <div class="typing">
      <Show when={text()}>
        <span class="typing-dots"><i /><i /><i /></span>
        <span class="ellipsis">{text()}</span>
      </Show>
    </div>
  );
}

function Header(props: { channelId: Snowflake }) {
  const ch = () => state.channels[props.channelId];
  const parent = () => (isThread(ch()) ? state.channels[ch()?.parent_id ?? ""] : undefined);
  const guild = () => (ch()?.guild_id ? state.guilds[ch()!.guild_id!] : undefined);
  const [pinsOpen, setPinsOpen] = createSignal(false);
  let pinsButton!: HTMLButtonElement;
  const recipient = () => (ch() ? dmRecipient(ch()!) : undefined);
  const hasMembers = () => !!ch()?.guild_id || ch()?.type === 3;
  const [renaming, setRenaming] = createSignal(false);
  const groupMenu = () => [
    { label: "Rename", action: () => setRenaming(true) },
    { label: "Add people", action: () => setUi("groupPicker", { channelId: props.channelId }) },
    "separator" as const,
    { label: "Leave group", danger: true, action: () => void leaveGroup(props.channelId) },
  ];

  return (
    <header class="channel-header" data-tauri-drag-region={ui.miniMode ? "" : undefined}>
      {/* En mode mini, l'en-tête sert de poignée pour déplacer la fenêtre. */}
      <Show when={guild()}>
        {(g) => (
          <>
            <button class="crumb-guild ellipsis" onClick={() => selectGuild(g().id)}>{g().name}</button>
            <Icon name="chevron" size={14} class="muted crumb-sep" />
          </>
        )}
      </Show>
      <Show when={parent()}>
        {(p) => (
          <>
            <button class="header-crumb" onClick={() => openChannel(p().id)}>
              <Icon name={channelIcon(p().type)} size={20} class="muted" />
              <span>{p().name}</span>
            </button>
            <Icon name="chevron" size={14} class="muted crumb-sep" />
          </>
        )}
      </Show>
      <Show when={recipient()} fallback={<Icon name={channelIcon(ch()?.type ?? 0)} size={22} class="muted" />}>
        {(r) => <Avatar userId={r().id} size={24} status onClick={(e) => openProfile(e, r().id)} />}
      </Show>
      <h1 class="channel-title ellipsis">{channelLabel(ch())}</h1>
      <Show when={ch()?.topic}>
        <span class="header-divider" />
        <div class="channel-topic ellipsis" title={ch()!.topic!}>
          <Markdown content={ch()!.topic!} guildId={ch()?.guild_id} inline />
        </div>
      </Show>
      <div class="header-actions">
        <Show when={ch() && !ch()!.guild_id}>
          <button class="icon-button hide-in-mini" title="Add people" onClick={() => setUi("groupPicker", { channelId: props.channelId })}>
            <Icon name="user-plus" size={19} />
          </button>
        </Show>
        <Show when={ch()?.type === 3}>
          <button class="icon-button hide-in-mini" title="Group options" onClick={(e) => openContextMenu(e, groupMenu())}>
            <Icon name="more" size={19} />
          </button>
          <Show when={renaming()}>
            <Prompt
              title="Rename group"
              value={ch()?.name ?? ""}
              placeholder={privateChannelName(ch()!)}
              action="Rename"
              onSubmit={(v) => void renameGroup(props.channelId, v)}
              onClose={() => setRenaming(false)}
            />
          </Show>
        </Show>
        <Show when={ch() && !ch()!.guild_id && !inVoice(props.channelId)}>
          <button class="icon-button" title={state.calls[props.channelId] ? "Join call" : "Start a call"} onClick={() => startCall(props.channelId)}>
            <Icon name="phone" size={19} />
          </button>
        </Show>
        <button class="icon-button hide-in-mini" classList={{ active: ui.search }} title="Search (Ctrl+F)" onClick={() => setUi("search", !ui.search)}>
          <Icon name="search" size={19} />
        </button>
        <button class="icon-button mini-only" title="Switch channel (Ctrl+K)" onClick={() => setUi("quickSwitcher", true)}>
          <Icon name="search" size={18} />
        </button>
        <button
          class="icon-button"
          classList={{ active: ui.miniMode }}
          title={ui.miniMode ? "Exit mini mode (Ctrl+Shift+B)" : "Mini mode (Ctrl+Shift+B)"}
          onClick={toggleMiniMode}
        >
          <Icon name="mini" size={20} />
        </button>
        <button
          ref={pinsButton}
          class="icon-button hide-in-mini"
          classList={{ active: pinsOpen() }}
          title="Pinned messages"
          onClick={() => setPinsOpen(!pinsOpen())}
        >
          <Icon name="pin" size={20} />
        </button>
        <Show when={pinsOpen()}>
          <PinsPanel channelId={props.channelId} anchor={pinsButton} onClose={() => setPinsOpen(false)} />
        </Show>
        <Show when={hasMembers()}>
          <button
            class="icon-button hide-in-mini"
            classList={{ active: membersVisible() }}
            title={membersVisible() ? "Hide member list" : "Show member list"}
            onClick={toggleMembers}
          >
            <Icon name="members" size={20} />
          </button>
        </Show>
      </div>
    </header>
  );
}

export function ChannelView(props: { channelId: Snowflake }) {
  let scroller: HTMLDivElement | undefined;
  const ch = () => state.channels[props.channelId];

  // Position du séparateur « Nouveaux », figée avant que l'ouverture ne marque le salon comme lu.
  const unreadAfter = createMemo(
    on(
      () => props.channelId,
      (cid) => (settings.unreadDivider && isUnread(cid) ? state.readStates[cid]?.last_message_id ?? null : null),
    ),
  );

  // Charge l'historique si absent (premier affichage ou cache vidé à la reconnexion),
  // ou le rafraîchit s'il vient de l'instantané (affiché en attendant).
  createEffect(() => {
    const cid = props.channelId;
    const bucket = state.messages[cid];
    if ((!bucket || (bucket.stale && !bucket.loading)) && !isForumLike(state.channels[cid])) void loadMessages(cid);
  });

  // Abonnement serveur (frappe, membres) pour le salon affiché.
  createEffect(
    on([() => props.channelId, () => state.connection], ([cid]) => {
      const c = state.channels[cid];
      if (!c?.guild_id) return;
      const listChannel = isThread(c) && c.parent_id ? c.parent_id : cid;
      void subscribeGuild(c.guild_id, listChannel);
    }),
  );

  // Marque comme lu à l'ouverture et quand la fenêtre reprend le focus.
  createEffect(() => {
    const bucket = state.messages[props.channelId];
    if (ui.windowFocused && bucket?.items.length && !bucket.stale) ackChannel(props.channelId);
  });

  // Glisser-déposer de fichiers since gestionnaire de fichiers.
  onMount(async () => {
    const unlisten = await getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths.length) {
        addFilesToDraft(props.channelId, e.payload.paths.map((path) => ({ path })));
      }
    });
    onCleanup(unlisten);
  });

  // Âge vérifié entre-temps : on réessaie de charger le salon.
  const retryAgeGate = () => {
    setNsfwBlocked(false);
    void loadMessages(props.channelId);
  };

  const showMembers = () => membersVisible() && (!!ch()?.guild_id || ch()?.type === 3);
  // Le panneau superposé se referme quand on change de salon.
  createEffect(on(() => props.channelId, () => setUi("membersOverlay", false), { defer: true }));

  return (
    <div class="channel-view">
      <Header channelId={props.channelId} />
      <div class="channel-body">
        <div class="chat">
          <Show when={!ch()?.guild_id}>
            <CallBar channelId={props.channelId} />
          </Show>
          <Show
            when={!isAgeBlocked(props.channelId)}
            fallback={
              <div class="empty-view age-gate">
                <Icon name="lock" size={28} />
                <p>This channel is age-restricted, and Discord doesn't let this account see it.</p>
                <button class="link-button" onClick={retryAgeGate}>Try again</button>
              </div>
            }
          >
            <MessageList channelId={props.channelId} unreadAfter={unreadAfter()} scrollerRef={(el) => (scroller = el)} />
            <Composer channelId={props.channelId} onSent={() => scroller && (scroller.scrollTop = 0)} />
            <TypingIndicator channelId={props.channelId} />
          </Show>
        </div>
        <Show when={ui.search}>
          <SearchPanel channelId={props.channelId} />
        </Show>
        <Show when={showMembers() && !ui.search}>
          <MemberList channelId={props.channelId} overlay={ui.narrow} />
        </Show>
      </div>
    </div>
  );
}
