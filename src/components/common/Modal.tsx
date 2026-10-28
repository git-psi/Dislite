import { type JSX, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

/** Fenêtre modale : fond assombri, fermeture par Échap ou clic à l'extérieur. */
export function Modal(props: { onClose: () => void; class?: string; children: JSX.Element }) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });
  return (
    <Portal>
      <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class={`modal ${props.class ?? ""}`} role="dialog" aria-modal="true">
          {props.children}
        </div>
      </div>
    </Portal>
  );
}
