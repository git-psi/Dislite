// Barre d'appel en haut d'un MP / groupe : qui est là, rejoindre ou contrôler l'appel.

import { For, Show } from "solid-js";
import { inVoice, leaveVoice, startCall } from "../../actions/voice";
import { displayName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { voice } from "../../store/voice";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { isSpeaking, voiceStateOf } from "./VoiceMembers";
import { popOut, VoiceControls } from "./VoicePanel";
import { openVolume } from "./VolumePopover";

export function CallBar(props: { channelId: Snowflake }) {
  const ids = () => state.voiceChannels[props.channelId] ?? [];
  const here = () => inVoice(props.channelId);
  const ringing = () => state.calls[props.channelId]?.ringing ?? [];
  const label = () => {
    if (here() && voice.session?.status !== "connected") return "Connecting…";
    if (!ids().length) return "Calling…";
    return here() ? "In call" : "Call in progress";
  };
  return (
    <Show when={state.calls[props.channelId] || here()}>
      <div class="call-bar" classList={{ here: here() }}>
        <div class="call-people">
          <For each={ids()}>
            {(uid) => (
              <span class="call-person" classList={{ speaking: isSpeaking(props.channelId, uid) }} title={displayName(uid)} onContextMenu={(e) => openVolume(e, uid)}>
                <Avatar userId={uid} size={36} />
                <Show when={voiceStateOf(null, uid)?.self_mute}>
                  <span class="call-muted"><Icon name="mic-off" size={11} /></span>
                </Show>
              </span>
            )}
          </For>
          <For each={ringing().filter((id) => !ids().includes(id))}>
            {(uid) => (
              <span class="call-person ringing" title={`Ringing ${displayName(uid)}`}>
                <Avatar userId={uid} size={36} />
              </span>
            )}
          </For>
        </div>
        <span class="call-label">{label()}</span>
        <div class="call-actions">
          <Show
            when={here()}
            fallback={
              <button class="call-btn accept wide" onClick={() => startCall(props.channelId)}>
                <Icon name="phone" size={16} /> Join
              </button>
            }
          >
            <VoiceControls />
            <button class="icon-button hide-in-mini" title="Call overlay (Ctrl+Shift+B)" onClick={popOut}>
              <Icon name="mini" size={17} />
            </button>
            <button class="call-btn decline" title="Leave call" onClick={leaveVoice}>
              <Icon name="phone-off" size={16} />
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
