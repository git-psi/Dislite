import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { avatarUrl } from "../../lib/cdn";
import { Logo } from "../common/Logo";
import { backend, errorMessage, events, type RemoteAuthEvent } from "../../ipc/tauri";

type Phase =
  | { kind: "loading" }
  | { kind: "qr"; svg: string }
  | { kind: "pending"; user: Extract<RemoteAuthEvent, { type: "pending" }>["user"] }
  | { kind: "error"; message: string };

/** `onCancel` : ajout d'un compte depuis l'app, avec retour possible au compte précédent. */
export function Login(props: { onLoggedIn: () => void; onCancel?: () => void }) {
  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" });
  const [tokenMode, setTokenMode] = createSignal(false);
  const [token, setToken] = createSignal("");
  const [tokenError, setTokenError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const start = () => {
    setPhase({ kind: "loading" });
    backend.remoteAuthStart().catch((e) => setPhase({ kind: "error", message: errorMessage(e) }));
  };

  onMount(async () => {
    const unlisten = await events.onRemoteAuth((e) => {
      switch (e.type) {
        case "qr": return setPhase({ kind: "qr", svg: e.svg });
        case "pending": return setPhase({ kind: "pending", user: e.user });
        case "success": return props.onLoggedIn();
        // QR expiré ou refusé sur le téléphone : on en génère un nouveau.
        case "expired":
        case "cancelled": return start();
        case "error": return setPhase({ kind: "error", message: e.message });
      }
    });
    onCleanup(() => {
      unlisten();
      backend.remoteAuthCancel();
    });
    start();
  });

  const submitToken = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setTokenError(null);
    try {
      await backend.loginWithToken(token());
      props.onLoggedIn();
    } catch (err) {
      setTokenError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <div class="login-card">
        <div class="login-text">
          <div class="login-brand"><Logo size={36} /> Dislite</div>
          <h1>{props.onCancel ? "Add an account" : "Welcome back!"}</h1>
          <p class="muted">
            {props.onCancel ? "Sign in with another Discord account. You can switch between them anytime." : "Sign in with your Discord account."}
          </p>
          <Show when={props.onCancel}>
            <button class="link-button login-back" onClick={() => props.onCancel?.()}>← Back to your account</button>
          </Show>

          <Show
            when={tokenMode()}
            fallback={
              <ol class="login-steps">
                <li>Open the Discord app on your phone.</li>
                <li>Go to <b>Settings → Scan QR Code</b>.</li>
                <li>Scan the code and confirm.</li>
              </ol>
            }
          >
            <form class="token-form" onSubmit={submitToken}>
              <label for="token">Token</label>
              <input
                id="token"
                type="password"
                autocomplete="off"
                spellcheck={false}
                value={token()}
                onInput={(e) => setToken(e.currentTarget.value)}
                placeholder="Paste your token here"
              />
              <Show when={tokenError()}>
                <p class="error-text">{tokenError()}</p>
              </Show>
              <button class="btn primary" type="submit" disabled={busy() || !token().trim()}>
                {busy() ? "Signing in…" : "Sign in"}
              </button>
              <p class="hint">Your token stays on this computer (readable by you only).</p>
            </form>
          </Show>

          <button class="link-button" onClick={() => setTokenMode(!tokenMode())}>
            {tokenMode() ? "Use QR code" : "Sign in with a token"}
          </button>
        </div>

        <Show when={!tokenMode()}>
          <div class="login-qr">
            <Switch>
              <Match when={phase().kind === "loading"}>
                <div class="qr-placeholder"><div class="spinner" /></div>
              </Match>
              <Match when={phase().kind === "qr"}>
                {/* SVG généré localement par le backend (crate qrcode) */}
                <div class="qr" innerHTML={(phase() as Extract<Phase, { kind: "qr" }>).svg} />
              </Match>
              <Match when={phase().kind === "pending"}>
                {(() => {
                  const user = (phase() as Extract<Phase, { kind: "pending" }>).user;
                  return (
                    <div class="qr-pending">
                      <img class="pending-avatar" src={avatarUrl({ id: user.id, avatar: user.avatar, discriminator: user.discriminator }, 128)} alt="" />
                      <b>{user.username}</b>
                      <p class="muted">Confirm the sign-in on your phone.</p>
                    </div>
                  );
                })()}
              </Match>
              <Match when={phase().kind === "error"}>
                <div class="qr-placeholder error">
                  <p>{(phase() as Extract<Phase, { kind: "error" }>).message}</p>
                  <button class="btn" onClick={start}>Retry</button>
                </div>
              </Match>
            </Switch>
            <p class="muted small">QR code sign-in</p>
          </div>
        </Show>
      </div>
    </div>
  );
}
