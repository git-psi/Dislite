// Mode mini pendant un appel : un petit overlay (qui est là, qui parle, micro, son, raccrocher),
// avec la discussion à un clic.

import { For, Show } from "solid-js";
import { leaveVoice } from "../../actions/voice";
import { channelLabel, displayName } from "../../store/selectors";
import { state } from "../../store/state";
import { setUi, toggleMiniMode } from "../../store/ui";
import { voice } from "../../store/voice";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { isSpeaking, voiceStateOf } from "./VoiceMembers";
import { VoiceControls } from "./VoicePanel";
import { openVolume } from "./VolumePopover";

const STATUS = { joining: "Joining…", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…" };

function Hangup() {
  return (
    <button class="call-btn decline" title="Disconnect" onClick={leaveVoice}>
      <Icon name="phone-off" size={17} />
    </button>
  );
}

/** Bande d'appel au-dessus de la discussion, en mode mini. */
export function MiniCallStrip() {
  return (
    <Show when={voice.session}>
      {(s) => (
        <div class="mini-strip" classList={{ live: s().status === "connected" }}>
          <button class="mini-strip-back" title="Back to call" onClick={() => setUi("miniView", "call")}>
            <span class="voice-dot" />
            <span class="ellipsis">{channelLabel(state.channels[s().channelId])}</span>
          </button>
          <VoiceControls />
          <Hangup />
        </div>
      )}
    </Show>
  );
}

export function MiniCall() {
  return (
    <Show when={voice.session}>
      {(s) => {
        const ids = () => state.voiceChannels[s().channelId] ?? [];
        return (
          <div class="mini-call">
            <header class="mini-call-head" data-tauri-drag-region="">
              <span class="mini-call-status" classList={{ live: s().status === "connected" }}>
                <span class="voice-dot" />
                {STATUS[s().status]}
              </span>
              <span class="mini-call-name ellipsis">{channelLabel(state.channels[s().channelId])}</span>
              <button class="icon-button" title="Chat" onClick={() => setUi("miniView", "chat")}>
                <Icon name="thread" size={17} />
              </button>
              <button class="icon-button" title="Exit mini mode (Ctrl+Shift+B)" onClick={toggleMiniMode}>
                <Icon name="mini" size={17} />
              </button>
            </header>

            <div class="mini-call-people" classList={{ few: ids().length <= 2 }}>
              <For each={ids()} fallback={<p class="mini-call-empty">Waiting for others…</p>}>
                {(uid) => {
                  const vs = () => voiceStateOf(s().guildId, uid);
                  return (
                    <div class="mini-tile" onContextMenu={(e) => openVolume(e, uid)}>
                      <span class="mini-avatar" classList={{ speaking: isSpeaking(s().channelId, uid) }}>
                        <Avatar userId={uid} guildId={s().guildId ?? undefined} size={72} />
                        <Show when={vs()?.self_deaf || vs()?.deaf} fallback={<Show when={vs()?.self_mute || vs()?.mute}><span class="mini-flag"><Icon name="mic-off" size={12} /></span></Show>}>
                          <span class="mini-flag"><Icon name="headphone-off" size={12} /></span>
                        </Show>
                      </span>
                      <span class="mini-tile-name ellipsis">{displayName(uid, s().guildId ?? undefined)}</span>
                    </div>
                  );
                }}
              </For>
            </div>

            <footer class="mini-call-controls">
              <VoiceControls />
              <Hangup />
            </footer>
          </div>
        );
      }}
    </Show>
  );
}
