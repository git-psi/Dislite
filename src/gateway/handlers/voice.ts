// Présence vocale, serveur vocal et appels en MP / groupe.

import { onOwnVoiceState, onVoiceServer, onCallChange } from "../../actions/voice";
import { putVoiceState } from "../../store/mutations";
import { setState, state } from "../../store/state";
import { produce } from "solid-js/store";
import { on } from "../dispatcher";
import { playSound } from "../../lib/sounds";
import { voice } from "../../store/voice";

on("VOICE_STATE_UPDATE", (d) => {
  // Quelqu'un rejoint / quitte notre salon : petit son.
  const here = voice.session?.channelId;
  if (here && d.user_id !== state.meId) {
    const before = state.voiceStates[`${d.guild_id ?? "@me"}:${d.user_id}`]?.channel_id;
    if (d.channel_id === here && before !== here) playSound("join");
    else if (before === here && d.channel_id !== here) playSound("leave");
  }
  putVoiceState(d);
  // Nos propres états venant de cette session (pas du téléphone, par exemple).
  if (d.user_id === state.meId && d.session_id === state.sessionId) onOwnVoiceState(d);
});

on("VOICE_SERVER_UPDATE", onVoiceServer);

function putCall(d: any) {
  setState("calls", d.channel_id, { channel_id: d.channel_id, ringing: d.ringing ?? [] });
  for (const vs of d.voice_states ?? []) putVoiceState(vs, null);
  onCallChange(d.channel_id);
}

on("CALL_CREATE", putCall);
on("CALL_UPDATE", putCall);
on("CALL_DELETE", (d) => {
  setState("calls", produce((m) => void delete m[d.channel_id]));
  onCallChange(d.channel_id);
});
