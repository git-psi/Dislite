// Amis : ajout toujours accessible en haut, filtres, demandes en tête, liste en ligne / hors ligne.

import { createSignal, For, type JSX, Show } from "solid-js";
import { acceptFriend, blockUser, openDm, removeRelationship, sendFriendRequest } from "../../actions/social";
import { customStatusOf, statusOf, userName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Relationship } from "../../store/types";
import { type FriendsTab, setUi, toast, ui } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { openContextMenu } from "../common/ContextMenu";
import { Icon } from "../common/Icon";
import { openProfile } from "../profile/ProfilePopout";

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do not disturb", offline: "Offline" };

const nameOf = (r: Relationship) => r.nickname || userName(state.users[r.id]);
const byName = (a: Relationship, b: Relationship) => nameOf(a).localeCompare(nameOf(b));
const isOnline = (r: Relationship) => statusOf(r.id) !== "offline";

function FriendRow(props: { rel: Relationship; actions?: JSX.Element }) {
  const user = () => state.users[props.rel.id];
  const isFriend = () => props.rel.type === 1;
  const subtitle = () => {
    switch (props.rel.type) {
      case 3: return "Wants to be your friend";
      case 4: return "Request sent";
      case 2: return "Blocked";
      default: return customStatusOf(props.rel.id) ?? STATUS_LABEL[statusOf(props.rel.id)];
    }
  };
  const menu = (e: MouseEvent) =>
    openContextMenu(e, [
      ...(isFriend() ? [{ label: "Message", action: () => void openDm(props.rel.id) }] : []),
      {
        label: "Copy username",
        action: () => {
          void navigator.clipboard.writeText(user()?.username ?? "");
          toast("Username copied");
        },
      },
      "separator",
      ...(isFriend() ? [{ label: "Remove friend", danger: true, action: () => void removeRelationship(props.rel.id) }] : []),
      props.rel.type === 2
        ? { label: "Unblock", action: () => void removeRelationship(props.rel.id) }
        : { label: "Block", danger: true, action: () => void blockUser(props.rel.id) },
    ]);

  return (
    <div
      class="friend-row"
      classList={{ offline: isFriend() && !isOnline(props.rel) }}
      onClick={(e) => (isFriend() ? void openDm(props.rel.id) : openProfile(e, props.rel.id))}
      onContextMenu={menu}
    >
      <Avatar userId={props.rel.id} size={32} status={isFriend()} />
      <div class="friend-text">
        <span class="friend-name ellipsis">
          {nameOf(props.rel)} <span class="friend-username">{user()?.username}</span>
        </span>
        <span class="friend-sub ellipsis">{subtitle()}</span>
      </div>
      <div class="friend-actions" onClick={(e) => e.stopPropagation()}>
        {props.actions}
        <Show when={isFriend()}>
          <button class="icon-button" title="Message" onClick={() => void openDm(props.rel.id)}>
            <Icon name="thread" size={17} />
          </button>
        </Show>
        <button class="icon-button" title="More" onClick={menu}>
          <Icon name="more" size={17} />
        </button>
      </div>
    </div>
  );
}

function Group(props: { title: string; items: Relationship[]; actions?: (r: Relationship) => JSX.Element }) {
  return (
    <Show when={props.items.length}>
      <div class="friends-group">
        {props.title} <span>{props.items.length}</span>
      </div>
      <For each={props.items}>{(r) => <FriendRow rel={r} actions={props.actions?.(r)} />}</For>
    </Show>
  );
}

function AddFriend() {
  const [name, setName] = createSignal("");
  const [result, setResult] = createSignal<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    const target = name().trim();
    if (!target) return;
    const error = await sendFriendRequest(target);
    setResult(error ? { ok: false, text: error } : { ok: true, text: `Request sent to ${target}.` });
    if (!error) setName("");
  };
  return (
    <form class="friends-add" onSubmit={submit}>
      <div class="friends-add-field" classList={{ error: result()?.ok === false }}>
        <Icon name="user-plus" size={16} />
        <input
          placeholder="Add a friend by username"
          value={name()}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setResult(null);
          }}
        />
        <button class="btn primary small" type="submit" disabled={!name().trim()}>Send request</button>
      </div>
      <Show when={result()}>
        <p class={result()!.ok ? "success-text" : "error-text"}>{result()!.text}</p>
      </Show>
    </form>
  );
}

export function FriendsView() {
  const [filter, setFilter] = createSignal("");
  const rels = () => Object.values(state.relationships);
  const matches = (r: Relationship) => {
    const q = filter().trim().toLowerCase();
    return !q || nameOf(r).toLowerCase().includes(q) || !!state.users[r.id]?.username.toLowerCase().includes(q);
  };
  const friends = () => rels().filter((r) => r.type === 1 && matches(r)).sort(byName);
  const incoming = () => rels().filter((r) => r.type === 3 && matches(r)).sort(byName);
  const outgoing = () => rels().filter((r) => r.type === 4 && matches(r)).sort(byName);
  const blocked = () => rels().filter((r) => r.type === 2 && matches(r)).sort(byName);

  const count = (tab: FriendsTab) => {
    const all = rels();
    switch (tab) {
      case "all": return all.filter((r) => r.type === 1).length;
      case "online": return all.filter((r) => r.type === 1 && isOnline(r)).length;
      case "pending": return all.filter((r) => r.type === 3 || r.type === 4).length;
      case "blocked": return all.filter((r) => r.type === 2).length;
    }
  };
  const TABS: { id: FriendsTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "online", label: "Online" },
    { id: "pending", label: "Pending" },
    { id: "blocked", label: "Blocked" },
  ];

  const requestActions = (r: Relationship) => (
    <Show
      when={r.type === 3}
      fallback={<button class="text-button" onClick={() => void removeRelationship(r.id)}>Cancel</button>}
    >
      <button class="text-button strong" onClick={() => void acceptFriend(r.id)}>Accept</button>
      <button class="text-button" onClick={() => void removeRelationship(r.id)}>Ignore</button>
    </Show>
  );
  const empty = () =>
    ({
      all: "No friends yet. Add someone with their username above.",
      online: "Nobody is online right now.",
      pending: "No pending requests.",
      blocked: "You haven't blocked anyone.",
    })[ui.friendsTab];
  const shownCount = () => {
    switch (ui.friendsTab) {
      case "all": return friends().length + incoming().length;
      case "online": return friends().filter(isOnline).length;
      case "pending": return incoming().length + outgoing().length;
      case "blocked": return blocked().length;
    }
  };

  return (
    <div class="channel-view">
      <header class="channel-header">
        <h1 class="channel-title">Friends</h1>
        <div class="header-actions">
          <button class="tab" onClick={() => setUi("groupPicker", { channelId: null })}>
            <Icon name="users" size={16} /> New group
          </button>
        </div>
      </header>
      <div class="friends-body">
        <AddFriend />
        <div class="friends-toolbar">
          <div class="segmented">
            <For each={TABS}>
              {(t) => (
                <button classList={{ active: ui.friendsTab === t.id }} onClick={() => setUi("friendsTab", t.id)}>
                  {t.label} <span class="seg-count">{count(t.id)}</span>
                </button>
              )}
            </For>
          </div>
          <input class="friends-filter" placeholder="Filter" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        </div>

        <Show when={ui.friendsTab === "all"}>
          <Group title="Requests" items={incoming()} actions={requestActions} />
          <Group title="Online" items={friends().filter(isOnline)} />
          <Group title="Offline" items={friends().filter((r) => !isOnline(r))} />
        </Show>
        <Show when={ui.friendsTab === "online"}>
          <Group title="Online" items={friends().filter(isOnline)} />
        </Show>
        <Show when={ui.friendsTab === "pending"}>
          <Group title="Received" items={incoming()} actions={requestActions} />
          <Group title="Sent" items={outgoing()} actions={requestActions} />
        </Show>
        <Show when={ui.friendsTab === "blocked"}>
          <Group title="Blocked" items={blocked()} />
        </Show>
        <Show when={!shownCount()}>
          <p class="friends-empty">{filter() ? "No one matches." : empty()}</p>
        </Show>
      </div>
    </div>
  );
}
