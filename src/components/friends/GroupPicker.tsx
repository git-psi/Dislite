// Choisir des amis : créer un groupe, ou en ajouter à une conversation.

import { createSignal, For, Show } from "solid-js";
import { addToConversation, createGroup, GROUP_MAX } from "../../actions/groups";
import { userName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { setUi, ui } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { Modal } from "../common/Modal";

export function GroupPicker() {
  const target = () => ui.groupPicker?.channelId ?? null;
  const existing = () => (target() ? state.channels[target()!]?.recipient_ids ?? [] : []);
  const room = () => GROUP_MAX - 1 - existing().length;
  const [query, setQuery] = createSignal("");
  const [picked, setPicked] = createSignal<Snowflake[]>([]);
  const close = () => setUi("groupPicker", null);

  const friends = () => {
    const q = query().trim().toLowerCase();
    return Object.values(state.relationships)
      .filter((r) => r.type === 1 && !existing().includes(r.id))
      .map((r) => ({ id: r.id, name: r.nickname || userName(state.users[r.id]), username: state.users[r.id]?.username ?? "" }))
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const toggle = (id: Snowflake) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room() ? [...p, id] : p));
  const confirm = () => {
    const ids = picked();
    if (!ids.length) return;
    close();
    void (target() ? addToConversation(target()!, ids) : createGroup(ids));
  };

  return (
    <Modal onClose={close} class="picker-modal">
      <header class="picker-head">
        <h2>{target() ? "Add people" : "New group"}</h2>
        <span class="picker-room">{picked().length} / {room()}</span>
      </header>
      <input
        class="picker-search"
        placeholder="Search friends"
        value={query()}
        ref={(el) => setTimeout(() => el.focus())}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && confirm()}
      />
      <div class="picker-list">
        <For each={friends()} fallback={<p class="picker-empty">No friends to add.</p>}>
          {(f) => {
            const on = () => picked().includes(f.id);
            return (
              <button class="picker-row" classList={{ on: on(), full: !on() && picked().length >= room() }} onClick={() => toggle(f.id)}>
                <Avatar userId={f.id} size={28} status />
                <span class="picker-name ellipsis">
                  {f.name} <span>{f.username}</span>
                </span>
                <span class="picker-check">
                  <Show when={on()}><Icon name="check" size={13} /></Show>
                </span>
              </button>
            );
          }}
        </For>
      </div>
      <footer class="picker-foot">
        <button class="text-button" onClick={close}>Cancel</button>
        <button class="btn primary small" disabled={!picked().length} onClick={confirm}>
          {target() ? "Add" : "Create group"}
        </button>
      </footer>
    </Modal>
  );
}
