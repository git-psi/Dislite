// Bas de la colonne : où l'on est connecté en vocal, micro, son, raccrocher.

import { Show } from "solid-js";
import { leaveVoice, toggleDeaf, toggleMute } from "../../actions/voice";
import { openChannel, selectGuild } from "../../actions/navigation";
import { channelLabel } from "../../store/selectors";
import { state } from "../../store/state";
import { setUi, toggleMiniMode, ui } from "../../store/ui";
import { voice } from "../../store/voice";
import { Icon } from "../common/Icon";

const STATUS = { joining: "Joining…", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…" };

/** Passe en mode mini, sur la vue d'appel. */
export function popOut() {
  setUi("miniView", "call");
  if (!ui.miniMode) toggleMiniMode();
}

export function VoiceControls() {
  return (
    <>
      <button class="icon-button" classList={{ off: voice.selfMute }} title={voice.selfMute ? "Unmute" : "Mute"} onClick={toggleMute}>
        <Icon name={voice.selfMute ? "mic-off" : "mic"} size={17} />
      </button>
      <button class="icon-button" classList={{ off: voice.selfDeaf }} title={voice.selfDeaf ? "Undeafen" : "Deafen"} onClick={toggleDeaf}>
        <Icon name={voice.selfDeaf ? "headphone-off" : "headphones"} size={17} />
      </button>
    </>
  );
}

export function VoicePanel() {
  return (
    <Show when={voice.session}>
      {(s) => {
        const ch = () => state.channels[s().channelId];
        const where = () => {
          const g = s().guildId ? state.guilds[s().guildId!]?.name : null;
          return g ? `${channelLabel(ch())} · ${g}` : channelLabel(ch());
        };
        const open = () => (s().guildId ? selectGuild(s().guildId!) : openChannel(s().channelId));
        return (
          <div class="voice-panel" classList={{ live: s().status === "connected" }}>
            <button class="voice-panel-text" onClick={open} title="Go to channel">
              <span class="voice-status">
                <span class="voice-dot" />
                {STATUS[s().status]}
              </span>
              <span class="voice-where ellipsis">{where()}</span>
            </button>
            <VoiceControls />
            <button class="icon-button" title="Call overlay (Ctrl+Shift+B)" onClick={popOut}>
              <Icon name="mini" size={17} />
            </button>
            <button class="icon-button hangup" title="Disconnect" onClick={leaveVoice}>
              <Icon name="phone-off" size={17} />
            </button>
          </div>
        );
      }}
    </Show>
  );
}
