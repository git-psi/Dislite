// Petite fenêtre de saisie (renommer…).

import { createSignal, Show } from "solid-js";
import { Modal } from "./Modal";

export function Prompt(props: { title: string; value: string; placeholder?: string; action: string; onSubmit: (v: string) => void; onClose: () => void }) {
  const [value, setValue] = createSignal(props.value);
  const submit = (e: Event) => {
    e.preventDefault();
    props.onSubmit(value());
    props.onClose();
  };
  return (
    <Modal onClose={props.onClose} class="prompt-modal">
      <form onSubmit={submit}>
        <h2>{props.title}</h2>
        <input
          value={value()}
          placeholder={props.placeholder}
          maxLength={100}
          ref={(el) => setTimeout(() => el.select())}
          onInput={(e) => setValue(e.currentTarget.value)}
        />
        <footer class="picker-foot">
          <button type="button" class="text-button" onClick={props.onClose}>Cancel</button>
          <button type="submit" class="btn primary small">{props.action}</button>
        </footer>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- ouverte de n'importe où (menus contextuels…)

interface PromptRequest {
  title: string;
  value?: string;
  placeholder?: string;
  action: string;
  onSubmit: (v: string) => void;
}

const [request, setRequest] = createSignal<PromptRequest | null>(null);
export const openPrompt = (r: PromptRequest) => setRequest(r);

export function PromptHost() {
  return (
    <Show when={request()} keyed>
      {(r) => (
        <Prompt title={r.title} value={r.value ?? ""} placeholder={r.placeholder} action={r.action} onSubmit={r.onSubmit} onClose={() => setRequest(null)} />
      )}
    </Show>
  );
}
