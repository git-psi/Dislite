// Volume d'une personne en vocal (clic droit sur elle) : 0 à 200 %, mémorisé.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { setUserVolume, userVolume } from "../../actions/voice";
import { displayName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";

const [target, setTarget] = createSignal<{ userId: Snowflake; x: number; y: number } | null>(null);

export function openVolume(e: MouseEvent, userId: Snowflake) {
  e.preventDefault();
  e.stopPropagation();
  if (userId === state.meId) return;
  setTarget({ userId, x: Math.min(e.clientX, innerWidth - 240), y: Math.min(e.clientY, innerHeight - 90) });
}

export function VolumePopover() {
  return (
    <Show when={target()} keyed>
      {(t) => {
        let el!: HTMLDivElement;
        const [value, setValue] = createSignal(Math.round(userVolume(t.userId) * 100));
        onMount(() => {
          const close = (e: MouseEvent) => !el.contains(e.target as Node) && setTarget(null);
          const key = (e: KeyboardEvent) => e.key === "Escape" && setTarget(null);
          setTimeout(() => document.addEventListener("mousedown", close));
          document.addEventListener("keydown", key);
          onCleanup(() => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", key);
          });
        });
        return (
          <Portal>
            <div class="popover volume-popover" ref={el} style={{ position: "fixed", left: `${t.x}px`, top: `${t.y}px` }}>
              <div class="volume-head">
                <span class="ellipsis">{displayName(t.userId)}</span>
                <span>{value()} %</span>
              </div>
              <input
                type="range"
                min="0"
                max="300"
                step="5"
                value={value()}
                onInput={(e) => {
                  setValue(Number(e.currentTarget.value));
                  setUserVolume(t.userId, value() / 100);
                }}
              />
            </div>
          </Portal>
        );
      }}
    </Show>
  );
}
