import { createEffect, For, Show } from "solid-js";
import { openChannel } from "../../actions/navigation";
import {
  activeThreads,
  categoryUnread,
  can,
  channelGroups,
  isChannelMuted,
  isGuildMuted,
  isUnread,
  mentionCount,
} from "../../store/selectors";
import { state } from "../../store/state";
import { SkeletonChannels } from "../common/Skeleton";
import type { Channel, Snowflake } from "../../store/types";
import { isVoiceLike } from "../../store/types";
import { currentChannelId, savePrefs, setUi, ui } from "../../store/ui";
import { openContextMenu } from "../common/ContextMenu";
import { channelIcon, Icon } from "../common/Icon";
import { channelMenu } from "../common/menus";
import { toggleChannelMute, toggleGuildMute } from "../../actions/mute";
import { SearchButton } from "./SearchButton";
import { inVoice, joinVoice } from "../../actions/voice";
import { P } from "../../lib/permissions";
import { VoiceMembers } from "../voice/VoiceMembers";

function ChannelRow(props: { channel: Channel; thread?: boolean }) {
  const ch = () => props.channel;
  const active = () => {
    if (voice()) return inVoice(ch().id);
    const current = currentChannelId();
    if (current === ch().id) return true;
    // Fil non listé (ex. post de forum) : on surligne son salon parent.
    const cur = current ? state.channels[current] : undefined;
    return !props.thread && cur?.parent_id === ch().id && !state.joinedThreads[cur.id];
  };
  const voice = () => isVoiceLike(ch());
  const canJoin = () => can(ch().id, P.CONNECT);
  const unread = () => !voice() && isUnread(ch().id);
  const mentions = () => mentionCount(ch().id);
  const isRules = () => state.guilds[ch().guild_id ?? ""]?.rules_channel_id === ch().id;
  let el!: HTMLButtonElement;
  // Le salon actif reste visible dans la colonne (navigation clavier, sélecteur rapide…).
  createEffect(() => active() && queueMicrotask(() => el.scrollIntoView({ block: "nearest" })));

  return (
    <button
      ref={el}
      class="channel-row"
      classList={{
        active: active(),
        unread: unread() && !isChannelMuted(ch().id),
        muted: isChannelMuted(ch().id),
        thread: !!props.thread,
        disabled: voice() && !canJoin(),
      }}
      title={voice() ? (canJoin() ? (inVoice(ch().id) ? "You're here" : "Join voice") : "You can't join this channel") : ch().topic ?? undefined}
      onClick={() => (voice() ? canJoin() && joinVoice(ch().id) : openChannel(ch().id))}
      onContextMenu={(e) => !voice() && openContextMenu(e, channelMenu(ch()))}
    >
      <Show when={!props.thread} fallback={<span class="thread-branch" />}>
        <Icon name={channelIcon(ch().type, isRules())} size={18} class="channel-icon" />
      </Show>
      <span class="channel-name">{ch().name}</span>
      <Show when={mentions() > 0}>
        <span class="badge">{mentions()}</span>
      </Show>
      <Show when={!voice()}>
        {/* span : un bouton ne peut pas contenir un autre bouton */}
        <span
          class="row-mute"
          role="button"
          title={isChannelMuted(ch().id) ? "Unmute channel" : "Mute channel"}
          onClick={(e) => {
            e.stopPropagation();
            toggleChannelMute(ch().id);
          }}
        >
          <Icon name={isChannelMuted(ch().id) ? "bell-off" : "bell"} size={14} />
        </span>
      </Show>
    </button>
  );
}

function ChannelWithThreads(props: { channel: Channel }) {
  const threads = () => activeThreads(props.channel.id);
  return (
    <>
      <ChannelRow channel={props.channel} />
      <Show when={isVoiceLike(props.channel)}>
        <VoiceMembers channelId={props.channel.id} guildId={props.channel.guild_id} />
      </Show>
      <For each={threads()}>{(t) => <ChannelRow channel={t} thread />}</For>
    </>
  );
}

export function ChannelSidebar(props: { guildId: Snowflake }) {
  const guild = () => state.guilds[props.guildId];
  const toggle = (id: Snowflake) => {
    setUi("collapsedCategories", id, !ui.collapsedCategories[id]);
    savePrefs();
  };

  return (
    <>
      <header class="sidebar-header">
        <div class="sidebar-title-row">
          <span class="sidebar-title ellipsis" title={guild()?.name}>{guild()?.name}</span>
          <button
            class="icon-button guild-mute"
            classList={{ active: isGuildMuted(props.guildId) }}
            title={isGuildMuted(props.guildId) ? "Unmute server" : "Mute server"}
            onClick={() => toggleGuildMute(props.guildId)}
          >
            <Icon name={isGuildMuted(props.guildId) ? "bell-off" : "bell"} size={16} />
          </button>
        </div>
        <SearchButton />
      </header>
      <div class="sidebar-scroll">
        <For each={channelGroups(props.guildId)} fallback={!state.ready && <SkeletonChannels />}>
          {(group) => {
            const collapsed = () => !!group.category && !!ui.collapsedCategories[group.category.id];
            return (
              <div class="channel-group">
                <Show when={group.category}>
                  {(cat) => (
                    <button
                      class="category"
                      classList={{ collapsed: collapsed(), unread: collapsed() && categoryUnread(group.channels) }}
                      onClick={() => toggle(cat().id)}
                    >
                      <Icon name="chevron" size={12} class="category-chevron" />
                      <span class="ellipsis">{cat().name}</span>
                    </button>
                  )}
                </Show>
                <For each={collapsed() ? group.channels.filter((c) => c.id === currentChannelId() || mentionCount(c.id) > 0) : group.channels}>
                  {(ch) => <ChannelWithThreads channel={ch} />}
                </For>
              </div>
            );
          }}
        </For>
      </div>
    </>
  );
}
