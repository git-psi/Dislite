// Appel entrant : une petite carte et une sonnerie discrète (générée, pas de fichier audio).

import { createEffect, on, onCleanup, Show } from "solid-js";
import { backend } from "../../ipc/tauri";
import { settings } from "../../store/settings";
import { ui } from "../../store/ui";
import { declineCall, incomingCall, startCall } from "../../actions/voice";
import { openChannel } from "../../actions/navigation";
import { channelIconUrl } from "../../lib/cdn";
import { dmRecipient, privateChannelName } from "../../store/selectors";
import { state } from "../../store/state";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";

/** Deux notes douces toutes les deux secondes, tant que l'appel sonne. */
function ring(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const beep = (at: number, freq: number) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.08, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  };
  const play = () => {
    const t = ctx!.currentTime;
    beep(t, 660);
    beep(t + 0.22, 880);
  };
  play();
  const timer = setInterval(play, 2000);
  return () => {
    clearInterval(timer);
    void ctx?.close();
  };
}

export function IncomingCall() {
  // Fenêtre en arrière-plan : notification système avec « Join » / « Decline ».
  createEffect(
    on(incomingCall, (id) => {
      if (!id || ui.windowFocused || !settings.notifyCalls || state.status === "dnd") return;
      const ch = state.channels[id];
      void backend.notify(ch ? privateChannelName(ch) : "Call", "Incoming call", id, true).catch(() => {});
    }),
  );
  createEffect(() => {
    if (!incomingCall() || state.status === "dnd") return;
    onCleanup(ring());
  });

  return (
    <Show when={incomingCall()} keyed>
      {(id) => {
        const ch = () => state.channels[id];
        const recipient = () => (ch() ? dmRecipient(ch()) : undefined);
        return (
          <div class="incoming-call" role="alertdialog">
            <button class="incoming-who" onClick={() => openChannel(id)}>
              <Show
                when={recipient()}
                fallback={
                  <div class="incoming-group">
                    <Show when={ch()?.icon} fallback={<Icon name="users" size={18} />}>
                      <img src={channelIconUrl(id, ch()!.icon!)} alt="" />
                    </Show>
                  </div>
                }
              >
                {(r) => <Avatar userId={r().id} size={40} />}
              </Show>
              <span class="incoming-text">
                <span class="incoming-name ellipsis">{ch() ? privateChannelName(ch()) : "Call"}</span>
                <span class="incoming-sub">Incoming call</span>
              </span>
            </button>
            <button class="call-btn decline" title="Decline" onClick={() => declineCall(id)}>
              <Icon name="phone-off" size={18} />
            </button>
            <button
              class="call-btn accept"
              title="Join"
              onClick={() => {
                startCall(id);
                openChannel(id);
              }}
            >
              <Icon name="phone" size={18} />
            </button>
          </div>
        );
      }}
    </Show>
  );
}
