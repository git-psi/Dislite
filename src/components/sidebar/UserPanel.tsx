import { createSignal, For, onCleanup, Show } from "solid-js";
import { accounts, addAccount, switchAccount } from "../../actions/accounts";
import { setCustomStatus, setStatus } from "../../actions/social";
import { avatarUrl } from "../../lib/cdn";
import { userName } from "../../store/selectors";
import { me, state } from "../../store/state";
import type { Status } from "../../store/types";
import { Avatar, StatusDot } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { SkeletonRows } from "../common/Skeleton";
import { SettingsModal } from "../settings/SettingsModal";

const STATUSES: { value: Status; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do Not Disturb" },
  { value: "invisible", label: "Invisible" },
];

export function UserPanel(props: { onLogout: () => void }) {
  const [menu, setMenu] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  let panel: HTMLDivElement | undefined;
  const close = () => setMenu(false);
  // Fermeture sur clic extérieur. (Les clics Solid sont délégués au document :
  // stopPropagation dans le bouton n'empêcherait pas cet écouteur de se déclencher.)
  const onOutside = (e: MouseEvent) => !panel?.contains(e.target as Node) && close();
  document.addEventListener("mousedown", onOutside);
  onCleanup(() => document.removeEventListener("mousedown", onOutside));

  return (
    <Show
      when={me()}
      fallback={
        <div class="user-panel sk-panel">
          <SkeletonRows count={1} sub />
        </div>
      }
    >
      {(user) => (
        <div class="user-panel" ref={panel}>
          <button class="user-panel-identity" onClick={() => setMenu(!menu())}>
            <Avatar userId={user().id} size={32} status={state.status === "invisible" ? "offline" : state.status} />
            <div class="user-panel-text">
              <span class="ellipsis user-panel-name">{userName(user())}</span>
              <span class="ellipsis user-panel-sub">{state.customStatus ?? user().username}</span>
            </div>
          </button>
          <button class="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={18} />
          </button>
          <Show when={settingsOpen()}>
            <SettingsModal onClose={() => setSettingsOpen(false)} onLogout={props.onLogout} />
          </Show>

          <Show when={menu()}>
            <div class="popover status-menu">
              <input
                class="custom-status-input"
                placeholder="Custom status…"
                maxLength={128}
                value={state.customStatus ?? ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void setCustomStatus(e.currentTarget.value);
                    close();
                  }
                }}
              />
              <div class="menu-separator" />
              <For each={STATUSES}>
                {(s) => (
                  <button
                    class="menu-item"
                    classList={{ selected: state.status === s.value }}
                    onClick={() => {
                      void setStatus(s.value);
                      close();
                    }}
                  >
                    <StatusDot status={s.value === "invisible" ? "offline" : s.value} class="inline" />
                    {s.label}
                  </button>
                )}
              </For>
              <div class="menu-separator" />
              <For each={accounts().filter((a) => a.id !== state.meId)}>
                {(a) => (
                  <button
                    class="menu-item account-item"
                    onClick={() => {
                      close();
                      void switchAccount(a.id);
                    }}
                  >
                    <img src={avatarUrl({ id: a.id, avatar: a.avatar }, 32)} alt="" />
                    <span class="ellipsis">{a.global_name || a.username}</span>
                    <span class="menu-hint">Switch</span>
                  </button>
                )}
              </For>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  void addAccount();
                }}
              >
                <Icon name="user-plus" size={16} /> Add account
              </button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
