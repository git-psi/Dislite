import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { subscribeGuild } from "../../gateway/client";
import { customStatusOf, displayName, memberColor, statusOf } from "../../store/selectors";
import { settings } from "../../store/settings";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { isThread } from "../../store/types";
import { isGroupOwner, removeFromGroup } from "../../actions/groups";
import { openDm } from "../../actions/social";
import { Avatar } from "../common/Avatar";
import { openContextMenu } from "../common/ContextMenu";
import { Icon } from "../common/Icon";
import { SkeletonRows } from "../common/Skeleton";
import { openProfile } from "../profile/ProfilePopout";

function MemberRow(props: { userId: Snowflake; guildId?: Snowflake }) {
  const offline = () => statusOf(props.userId) === "offline";
  const activity = () => {
    if (!settings.showActivities) return null;
    const custom = customStatusOf(props.userId);
    if (custom) return custom;
    const a = state.presences[props.userId]?.activities.find((x) => x.type !== 4);
    if (!a) return null;
    const verb = ["Playing", "Streaming", "Listening to", "Watching", "", "Competing in"][a.type] ?? "";
    return `${verb} ${a.name}`.trim();
  };
  return (
    <button
      class="member-row"
      classList={{ offline: offline() }}
      onClick={(e) => openProfile(e, props.userId, props.guildId)}
    >
      <Avatar userId={props.userId} guildId={props.guildId} size={32} status />
      <div class="member-text">
        <span class="ellipsis member-name" style={{ color: memberColor(props.guildId, props.userId) }}>
          {displayName(props.userId, props.guildId)}
          <Show when={state.users[props.userId]?.bot}><span class="bot-tag">BOT</span></Show>
        </span>
        <Show when={activity()}>
          <span class="ellipsis member-activity">{activity()}</span>
        </Show>
      </div>
    </button>
  );
}

function GuildMemberList(props: { guildId: Snowflake; channelId: Snowflake; overlay?: boolean }) {
  const [rangeEnd, setRangeEnd] = createSignal(99);
  const list = () => state.memberLists[props.guildId];

  const groupName = (id: string) => {
    if (id === "online") return "Online";
    if (id === "offline") return "Offline";
    return state.guilds[props.guildId]?.roles[id]?.name ?? id;
  };

  // Demande la plage suivante quand on approche du bas de la liste chargée.
  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    const total = list()?.items.length ?? 0;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 300 && total >= rangeEnd() - 5) {
      const next = rangeEnd() + 100;
      setRangeEnd(next);
      const ranges: [number, number][] = [[0, 99]];
      if (next > 199) ranges.push([next - 199, next - 100]);
      ranges.push([next - 99, next]);
      const c = state.channels[props.channelId];
      void subscribeGuild(props.guildId, isThread(c) && c.parent_id ? c.parent_id : props.channelId, ranges);
    }
  };

  return (
    <aside class="member-list" classList={{ overlay: !!props.overlay }} onScroll={onScroll}>
      <Show when={list()} fallback={<SkeletonRows count={12} />}>
        <For each={list()!.items}>
          {(item) => (
            <Switch>
              <Match when={item?.kind === "group" && item}>
                {(g) => {
                  const group = g() as { id: string; count: number };
                  return <div class="section-title">{groupName(group.id)} — {group.count}</div>;
                }}
              </Match>
              <Match when={item?.kind === "member" && item}>
                {(m) => <MemberRow userId={(m() as { userId: string }).userId} guildId={props.guildId} />}
              </Match>
            </Switch>
          )}
        </For>
      </Show>
    </aside>
  );
}

function GroupDmMembers(props: { channelId: Snowflake; overlay?: boolean }) {
  const ids = createMemo(() => [state.meId!, ...(state.channels[props.channelId]?.recipient_ids ?? [])].filter(Boolean));
  return (
    <aside class="member-list" classList={{ overlay: !!props.overlay }}>
      <div class="section-title">Members — {ids().length}</div>
      <For each={ids()}>
        {(id) => (
          <div
            class="group-member"
            onContextMenu={(e) =>
              openContextMenu(e, [
                ...(id !== state.meId ? [{ label: "Message", action: () => void openDm(id) }] : []),
                ...(isGroupOwner(props.channelId) && id !== state.meId
                  ? ["separator" as const, { label: "Remove from group", danger: true, action: () => void removeFromGroup(props.channelId, id) }]
                  : []),
              ])
            }
          >
            <MemberRow userId={id} />
            <Show when={state.channels[props.channelId]?.owner_id === id}>
              <span class="group-owner" title="Group owner"><Icon name="crown" size={13} /></span>
            </Show>
          </div>
        )}
      </For>
    </aside>
  );
}

export function MemberList(props: { channelId: Snowflake; overlay?: boolean }) {
  const guildId = () => state.channels[props.channelId]?.guild_id;
  return (
    <Show when={guildId()} fallback={<GroupDmMembers channelId={props.channelId} overlay={props.overlay} />}>
      {(gid) => <GuildMemberList guildId={gid()} channelId={props.channelId} overlay={props.overlay} />}
    </Show>
  );
}
