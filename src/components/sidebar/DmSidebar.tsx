import { For, Show } from "solid-js";
import { openChannel, openFriends, openHome, openMentions } from "../../actions/navigation";
import { closeDm } from "../../actions/social";
import { channelIconUrl } from "../../lib/cdn";
import { snowflakeTime } from "../../lib/snowflake";
import { shortAgo } from "../../lib/time";
import {
  customStatusOf,
  dmRecipient,
  isUnread,
  mentionCount,
  privateChannelName,
  sortedPrivateChannels,
} from "../../store/selectors";
import { settings } from "../../store/settings";
import { state } from "../../store/state";
import type { Channel } from "../../store/types";
import { currentChannelId, ui } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { openContextMenu } from "../common/ContextMenu";
import { Icon } from "../common/Icon";
import { channelMenu } from "../common/menus";
import { SkeletonRows } from "../common/Skeleton";
import { SearchButton } from "./SearchButton";

function DmRow(props: { channel: Channel }) {
  const recipient = () => dmRecipient(props.channel);
  const subtitle = () => {
    const r = recipient();
    if (r) return settings.showActivities ? customStatusOf(r.id) : null;
    return `${(props.channel.recipient_ids?.length ?? 0) + 1} members`;
  };
  return (
    <div
      class="dm-row"
      classList={{ active: currentChannelId() === props.channel.id, unread: isUnread(props.channel.id) }}
      onClick={() => openChannel(props.channel.id)}
      onContextMenu={(e) => openContextMenu(e, channelMenu(props.channel))}
    >
      <Show
        when={recipient()}
        fallback={
          <div class="avatar group-icon" style={{ width: "32px", height: "32px" }}>
            <Show when={props.channel.icon} fallback={<Icon name="users" size={18} />}>
              <img src={channelIconUrl(props.channel.id, props.channel.icon!)} alt="" />
            </Show>
          </div>
        }
      >
        {(r) => <Avatar userId={r().id} size={32} status />}
      </Show>
      <div class="dm-text">
        <span class="ellipsis dm-name">
          {privateChannelName(props.channel)}
          <Show when={state.calls[props.channel.id]}>
            <Icon name="phone" size={12} class="dm-call" />
          </Show>
        </span>
        <Show when={subtitle()}>
          <span class="ellipsis dm-sub">{subtitle()}</span>
        </Show>
      </div>
      <Show
        when={mentionCount(props.channel.id) > 0}
        fallback={
          <Show when={props.channel.last_message_id}>
            {(last) => <span class="dm-ago">{shortAgo(snowflakeTime(last()))}</span>}
          </Show>
        }
      >
        <span class="badge">{mentionCount(props.channel.id)}</span>
      </Show>
      <button
        class="icon-button dm-close"
        title="Close conversation"
        onClick={(e) => {
          e.stopPropagation();
          void closeDm(props.channel.id);
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function DmSidebar() {
  const pending = () => Object.values(state.relationships).filter((r) => r.type === 3).length;
  return (
    <>
      <header class="sidebar-header">
        <span class="sidebar-title">Direct messages</span>
        <SearchButton />
      </header>
      <div class="sidebar-scroll">
        <button class="channel-row friends-row" classList={{ active: currentChannelId() === null && ui.homePage === "home" }} onClick={openHome}>
          <Icon name="home" size={20} />
          <span class="channel-name">Home</span>
        </button>
        <button class="channel-row friends-row" classList={{ active: currentChannelId() === null && ui.homePage === "mentions" }} onClick={openMentions}>
          <Icon name="at" size={20} />
          <span class="channel-name">Mentions</span>
        </button>
        <button class="channel-row friends-row" classList={{ active: currentChannelId() === null && ui.homePage === "friends" }} onClick={openFriends}>
          <Icon name="friends" size={20} />
          <span class="channel-name">Friends</span>
          <Show when={pending() > 0}>
            <span class="badge">{pending()}</span>
          </Show>
        </button>
        <div class="section-title">Conversations</div>
        <For each={sortedPrivateChannels()} fallback={!state.ready && <SkeletonRows count={9} sub />}>
          {(ch) => <DmRow channel={ch} />}
        </For>
      </div>
    </>
  );
}
