// Accueil : demandes d'ami, puis deux colonnes « à lire » / « récent ».
// Tout vient de l'état déjà chargé (aucune requête) : la page reste instantanée.

import { For, type JSX, Show } from "solid-js";
import { openChannel, openFriends } from "../../actions/navigation";
import { acceptFriend, openDm, removeRelationship } from "../../actions/social";
import { channelIconUrl, guildIconUrl } from "../../lib/cdn";
import { snowflakeTime } from "../../lib/snowflake";
import { shortAgo } from "../../lib/time";
import {
  channelLabel,
  customStatusOf,
  dmRecipient,
  isUnread,
  mentionCount,
  sortedPrivateChannels,
  statusOf,
  unreadChannels,
  userName,
} from "../../store/selectors";
import { state } from "../../store/state";
import type { Channel, Snowflake } from "../../store/types";
import { isThread } from "../../store/types";
import { setUi } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { SkeletonRows } from "../common/Skeleton";

const MAX_ROWS = 8;
const MAX_REQUESTS = 3;

const isPrivate = (ch: Channel) => !ch.guild_id;
const lastActivity = (ch: Channel) => shortAgo(snowflakeTime(ch.last_message_id ?? ch.id));

/** Icône d'un salon ou d'une conversation : avatar, icône de groupe ou du serveur. */
function ChannelIcon(props: { channel: Channel }) {
  const guild = () => (props.channel.guild_id ? state.guilds[props.channel.guild_id] : undefined);
  const src = () =>
    isPrivate(props.channel)
      ? props.channel.icon && channelIconUrl(props.channel.id, props.channel.icon)
      : guild() && guildIconUrl(guild()!, 64);
  return (
    <Show when={dmRecipient(props.channel)} fallback={<div class="home-icon">{src() ? <img src={src()!} alt="" /> : <Icon name={isPrivate(props.channel) ? "users" : "hash"} size={15} />}</div>}>
      {(r) => <Avatar userId={r().id} size={28} status />}
    </Show>
  );
}

/** Dernier message connu (si le salon est en mémoire). */
function lastPreview(channelId: Snowflake) {
  const items = state.messages[channelId]?.items;
  const last = items?.[items.length - 1];
  if (!last) return null;
  const who = last.author.id === state.meId ? "You" : userName(state.users[last.author.id] ?? last.author);
  const text = last.content.replace(/\s+/g, " ").trim() || (last.attachments.length ? "sent an attachment" : "…");
  return `${who}: ${text}`;
}

function Row(props: { channel: Channel; sub?: string | null; right: JSX.Element }) {
  const where = () => {
    const ch = props.channel;
    if (!ch.guild_id) return null;
    const guild = state.guilds[ch.guild_id]?.name ?? "";
    return isThread(ch) && ch.parent_id ? `${guild} › #${state.channels[ch.parent_id]?.name ?? ""}` : guild;
  };
  const title = () => (isPrivate(props.channel) || isThread(props.channel) ? "" : "# ") + channelLabel(props.channel);
  return (
    <button class="home-row" classList={{ unread: isUnread(props.channel.id) }} onClick={() => openChannel(props.channel.id)}>
      <ChannelIcon channel={props.channel} />
      <span class="home-row-text">
        <span class="home-row-title ellipsis">{title()}</span>
        <Show when={props.sub ?? where()}>{(sub) => <span class="home-row-sub ellipsis">{sub()}</span>}</Show>
      </span>
      {props.right}
    </button>
  );
}

function Column(props: { title: string; aside?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="home-col">
      <header class="home-col-head">
        <h2>{props.title}</h2>
        {props.aside}
      </header>
      {props.children}
    </section>
  );
}

export function HomeView() {
  // Ni READY ni instantané : rien de connu, squelettes.
  const blank = () => !state.ready && !state.cached;
  const unread = () => unreadChannels("all");
  const recent = () => sortedPrivateChannels().slice(0, MAX_ROWS);
  const requests = () => Object.values(state.relationships).filter((r) => r.type === 3);
  const online = () =>
    Object.values(state.relationships)
      .filter((r) => r.type === 1 && statusOf(r.id) !== "offline")
      .slice(0, 16);

  return (
    <div class="channel-view home-view">
      <header class="channel-header">
        <h1 class="channel-title">Home</h1>
        <div class="header-actions">
          <button class="header-search" onClick={() => setUi("quickSwitcher", true)}>
            <Icon name="search" size={14} />
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button class="icon-button" title="Friends" onClick={openFriends}>
            <Icon name="friends" size={18} />
          </button>
        </div>
      </header>

      <div class="home-scroll">
        <div class="home-inner">
          <For each={requests().slice(0, MAX_REQUESTS)}>
            {(r) => (
              <div class="home-request">
                <Avatar userId={r.id} size={22} />
                <span class="ellipsis">
                  <b>{userName(state.users[r.id])}</b> sent you a friend request
                </span>
                <button class="text-button strong" onClick={() => acceptFriend(r.id)}>Accept</button>
                <button class="text-button" onClick={() => removeRelationship(r.id)}>Ignore</button>
              </div>
            )}
          </For>
          <Show when={requests().length > MAX_REQUESTS}>
            <button class="text-button home-more" onClick={openFriends}>
              {requests().length - MAX_REQUESTS} more requests
            </button>
          </Show>

          <div class="home-columns">
            <Column
              title="To read"
              aside={
                <Show when={unread().length}>
                  <span class="home-count">{unread().length}</span>
                </Show>
              }
            >
              <For
                each={unread().slice(0, MAX_ROWS)}
                fallback={blank() ? <SkeletonRows count={6} sub /> : <p class="home-empty">All caught up.</p>}
              >
                {(id) => (
                  <Row
                    channel={state.channels[id]}
                    right={
                      <Show when={mentionCount(id) > 0} fallback={<span class="home-time">{lastActivity(state.channels[id])}</span>}>
                        <span class="home-mentions">{mentionCount(id)}</span>
                      </Show>
                    }
                  />
                )}
              </For>
              <Show when={unread().length > MAX_ROWS}>
                <p class="home-more">{unread().length - MAX_ROWS} more · Alt+Shift+↓ goes through them</p>
              </Show>
            </Column>

            <Column title="Recent">
              <For each={recent()} fallback={blank() ? <SkeletonRows count={6} sub /> : <p class="home-empty">No conversations yet.</p>}>
                {(ch) => {
                  const r = dmRecipient(ch);
                  return <Row channel={ch} sub={lastPreview(ch.id) ?? (r ? customStatusOf(r.id) : null)} right={<span class="home-time">{lastActivity(ch)}</span>} />;
                }}
              </For>
              <Show when={online().length}>
                <div class="home-online">
                  <span class="home-online-label">Online</span>
                  <For each={online()}>
                    {(r) => (
                      <button class="home-face" title={userName(state.users[r.id])} onClick={() => openDm(r.id)}>
                        <Avatar userId={r.id} size={26} status />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Column>
          </div>
        </div>
      </div>
    </div>
  );
}
