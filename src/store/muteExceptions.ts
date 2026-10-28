// Salons réactivés dans un serveur muet. Discord ne permet pas cette exception :
// elle est gardée localement et prise en compte par Dislite seul.

import { createStore } from "solid-js/store";
import type { Snowflake } from "./types";

const KEY = "accord:unmuted-channels";

function load(): Record<Snowflake, true> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const [unmutedChannels, setUnmutedChannels] = createStore<Record<Snowflake, true | undefined>>(load());

export function saveUnmutedChannels() {
  try {
    const clean = Object.fromEntries(Object.entries(unmutedChannels).filter(([, v]) => v));
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* stockage indisponible */
  }
}
