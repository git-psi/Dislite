// Invitation : aperçu du serveur et « Join », depuis un lien discord.gg cliqué dans l'app.

import { openUrl } from "@tauri-apps/plugin-opener";
import { createResource, createSignal, Show } from "solid-js";
import { setInvite } from "../../actions/invites";
import { selectGuild } from "../../actions/navigation";
import { backend, errorMessage, isBackendError } from "../../ipc/tauri";
import { state } from "../../store/state";
import { Icon } from "../common/Icon";
import { Modal } from "../common/Modal";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function InviteModal(props: { code: string }) {
  const close = () => setInvite(null);
  const [info] = createResource(() => props.code, (code) => backend.api<any>("GET", `/invites/${code}?with_counts=true&with_expiration=true`));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<{ text: string; browser?: boolean } | null>(null);
  const guild = () => info()?.guild;
  const member = () => !!guild() && !!state.guilds[guild().id];
  const icon = () => guild()?.icon && `https://cdn.discordapp.com/icons/${guild().id}/${guild().icon}.webp?size=128`;
  const link = () => `https://discord.gg/${props.code}`;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await backend.api("POST", `/invites/${props.code}`, { session_id: state.sessionId });
      close();
      // Le serveur arrive par GUILD_CREATE ; on l'ouvre dès qu'il est là.
      const id = guild().id;
      const open = () => (state.guilds[id] ? selectGuild(id) : setTimeout(open, 300));
      open();
    } catch (e) {
      // Captcha fermé sans être résolu (ou impossible à charger) : le navigateur reste une issue.
      if (isBackendError(e) && e.kind === "captcha") setError({ text: "The captcha wasn't completed.", browser: true });
      else setError({ text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} class="invite-modal">
      <Show when={!info.loading} fallback={<div class="invite-body"><div class="sk sk-circle" style={{ width: "64px", height: "64px" }} /><span class="sk sk-line" style={{ width: "60%" }} /></div>}>
        <Show
          when={guild()}
          fallback={
            <div class="invite-body">
              <p class="invite-title">This invite is invalid or has expired.</p>
              <button class="btn small" onClick={close}>Close</button>
            </div>
          }
        >
          <div class="invite-body">
            <div class="invite-icon">
              <Show when={icon()} fallback={<span>{guild().name.slice(0, 2)}</span>}>
                <img src={icon()!} alt="" />
              </Show>
            </div>
            <p class="invite-sub">You've been invited to join</p>
            <p class="invite-title">{guild().name}</p>
            <p class="invite-counts">
              <span class="invite-dot online" /> {compact.format(info().approximate_presence_count ?? 0)} online
              <span class="invite-dot" /> {compact.format(info().approximate_member_count ?? 0)} members
            </p>
            <Show when={error()}>
              {(err) => (
                <p class="error-text">
                  {err().text}{" "}
                  <Show when={err().browser}>
                    <button class="link-button" onClick={() => void openUrl(link())}>Open in browser <Icon name="external" size={12} /></button>
                  </Show>
                </p>
              )}
            </Show>
            <div class="invite-actions">
              <button class="text-button" onClick={close}>Cancel</button>
              <Show
                when={!member()}
                fallback={
                  <button class="btn primary small" onClick={() => { selectGuild(guild().id); close(); }}>Open server</button>
                }
              >
                <button class="btn primary small" disabled={busy()} onClick={join}>{busy() ? "Joining…" : "Join server"}</button>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </Modal>
  );
}
