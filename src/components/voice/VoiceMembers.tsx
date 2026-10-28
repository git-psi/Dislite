// Personnes présentes dans un salon vocal ou un appel.

import { For, Show } from "solid-js";
import { inVoice } from "../../actions/voice";
import { displayName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { voice } from "../../store/voice";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { openProfile } from "../profile/ProfilePopout";
import { openVolume } from "./VolumePopover";

export const voiceStateOf = (guildId: Snowflake | null | undefined, userId: Snowflake) =>
  state.voiceStates[`${guildId ?? "@me"}:${userId}`];

/** Parle en ce moment (connu seulement pour le salon où l'on est). */
export const isSpeaking = (channelId: Snowflake, userId: Snowflake) => inVoice(channelId) && !!voice.speaking[userId];

export function VoiceMembers(props: { channelId: Snowflake; guildId?: Snowflake }) {
  const ids = () => state.voiceChannels[props.channelId] ?? [];
  return (
    <Show when={ids().length}>
      <div class="voice-members">
        <For each={ids()}>
          {(uid) => {
            const vs = () => voiceStateOf(props.guildId, uid);
            return (
              <button class="voice-member" onClick={(e) => openProfile(e, uid, props.guildId)} onContextMenu={(e) => openVolume(e, uid)}>
                <span class="voice-avatar" classList={{ speaking: isSpeaking(props.channelId, uid) }}>
                  <Avatar userId={uid} guildId={props.guildId} size={20} />
                </span>
                <span class="ellipsis">{displayName(uid, props.guildId)}</span>
                <Show when={vs()?.self_deaf || vs()?.deaf} fallback={<Show when={vs()?.self_mute || vs()?.mute}><Icon name="mic-off" size={13} class="voice-flag" /></Show>}>
                  <Icon name="headphone-off" size={13} class="voice-flag" />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
