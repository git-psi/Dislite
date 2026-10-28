// Menu contextuel global (clic droit). Un seul menu ouvert à la fois.

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: (MenuItem | "separator")[];
}

const [menu, setMenu] = createSignal<MenuState | null>(null);

export function openContextMenu(e: MouseEvent, items: (MenuItem | "separator")[]) {
  e.preventDefault();
  e.stopPropagation();
  setMenu({ x: e.clientX, y: e.clientY, items });
}

/** Petit utilitaire : copie un texte dans le presse-papiers. */
export const copy = (text: string) => () => void navigator.clipboard.writeText(text);

export function ContextMenuHost() {
  let el: HTMLDivElement | undefined;
  onMount(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && el?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    onCleanup(() => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    });
  });

  // Garde le menu dans la fenêtre.
  const position = (m: MenuState) => {
    const w = 220;
    const h = m.items.length * 34 + 12;
    return {
      left: `${Math.min(m.x, window.innerWidth - w - 8)}px`,
      top: `${Math.min(m.y, window.innerHeight - h - 8)}px`,
    };
  };

  return (
    <Show when={menu()}>
      {(m) => (
        <Portal>
          <div class="popover context-menu" ref={el} style={position(m())}>
            <For each={m().items}>
              {(item) =>
                item === "separator" ? (
                  <div class="menu-separator" />
                ) : (
                  <button
                    class="menu-item"
                    classList={{ danger: !!item.danger }}
                    disabled={item.disabled}
                    onClick={() => {
                      setMenu(null);
                      item.action();
                    }}
                  >
                    {item.label}
                  </button>
                )
              }
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}
