import { openUrl } from "@tauri-apps/plugin-opener";
import { createEffect, createSignal, ErrorBoundary, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { reportError } from "./lib/errors";
import { ackChannel } from "./actions/messages";
import { goBack, goForward, moveChannel, openChannel } from "./actions/navigation";
import { onConnected, startGateway, stopGateway, subscribeGuild } from "./gateway/client";
import { backend } from "./ipc/tauri";
import { ChannelView } from "./components/chat/ChannelView";
import { Icon } from "./components/common/Icon";
import { Logo } from "./components/common/Logo";
import { FriendsView } from "./components/friends/FriendsView";
import { HomeView } from "./components/home/HomeView";
import { MentionsView } from "./components/home/MentionsView";
import { ForumView } from "./components/forum/ForumView";
import { GuildBar } from "./components/guilds/GuildBar";
import { ServersView } from "./components/guilds/ServersView";
import { IncomingCall } from "./components/voice/IncomingCall";
import { GroupPicker } from "./components/friends/GroupPicker";
import { VoicePanel } from "./components/voice/VoicePanel";
import { MiniCall, MiniCallStrip } from "./components/voice/MiniCall";
import { VolumePopover } from "./components/voice/VolumePopover";
import { InviteModal } from "./components/guilds/InviteModal";
import { PromptHost } from "./components/common/Prompt";
import { invite, inviteCode, setInvite } from "./actions/invites";
import { installUpdate, watchUpdates } from "./actions/updates";
import { voice } from "./store/voice";
import { Login } from "./components/login/Login";
import { ProfilePopout } from "./components/profile/ProfilePopout";
import { ContextMenuHost } from "./components/common/ContextMenu";
import { QuickSwitcher } from "./components/switcher/QuickSwitcher";
import { ChannelSidebar } from "./components/sidebar/ChannelSidebar";
import { DmSidebar } from "./components/sidebar/DmSidebar";
import { UserPanel } from "./components/sidebar/UserPanel";
import { clearDerivedCaches, mentionCount, unreadChannels } from "./store/selectors";
import { refreshAccounts, registerSession } from "./actions/accounts";
import { declineCall, startCall, startVoiceEvents, voiceConfig } from "./actions/voice";
import { events } from "./ipc/tauri";
import { startPresence } from "./lib/presence";
import { clearSnapshot, loadSnapshot, saveSnapshot, setActiveAccount } from "./store/snapshot";
import { settings } from "./store/settings";
import { resetState, state } from "./store/state";
import { isForumLike } from "./store/types";
import { currentChannelId, HOME, setUi, toggleMiniMode, ui } from "./store/ui";

type Phase = "boot" | "login" | "app";

/** Écran de chargement : logo et nom, sans spinner (léger). */
function Splash(props: { text?: string }) {
  return (
    <div class="splash">
      <Logo size={88} class="splash-logo" />
      <div class="splash-name">Dislite</div>
      <Show when={props.text}><p class="muted small">{props.text}</p></Show>
    </div>
  );
}

/** Petite barre en haut de la fenêtre tant que la connexion à Discord n'est pas établie.
 *  Superposée (pas de décalage du contenu quand elle disparaît). */
function ConnectionBar() {
  const label = () => {
    if (state.ready && state.connection === "connected") return null;
    if (!state.ready) {
      // Première connexion : l'interface (instantané) est déjà utilisable.
      // « disconnected » ici vient de l'arrêt de la connexion précédente : seule une
      // nouvelle tentative (« reconnecting ») signale un vrai problème.
      return state.connection === "reconnecting"
        ? "Can't reach Discord — showing saved data, retrying…"
        : "Connecting to Discord…";
    }
    return state.connection === "disconnected" ? "Disconnected from Discord" : "Reconnecting to Discord…";
  };
  return (
    <Show when={label()}>
      <div class="connection-bar" classList={{ trouble: /reach|Disconnected/.test(label()!) }} role="status">
        <span class="connection-dot" />
        {label()}
      </div>
    </Show>
  );
}

function Lightbox() {
  // Mosaïque : ← / → passent d'une image à l'autre, Échap ferme.
  const step = (d: number) => {
    const lb = ui.lightbox;
    if (!lb?.gallery) return;
    const i = ((lb.index ?? 0) + d + lb.gallery.length) % lb.gallery.length;
    setUi("lightbox", { ...lb.gallery[i], gallery: lb.gallery, index: i });
  };
  const onKey = (e: KeyboardEvent) => {
    if (!ui.lightbox) return;
    if (e.key === "Escape") setUi("lightbox", null);
    else if (e.key === "ArrowLeft" && !e.altKey) step(-1);
    else if (e.key === "ArrowRight" && !e.altKey) step(1);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Phase de capture : avant les raccourcis globaux et la zone de saisie.
  document.addEventListener("keydown", onKey, true);
  onCleanup(() => document.removeEventListener("keydown", onKey, true));
  return (
    <Show when={ui.lightbox}>
      {(lb) => (
        <div class="lightbox" onClick={() => setUi("lightbox", null)}>
          <img src={lb().url} alt="" onClick={(e) => e.stopPropagation()} />
          <Show when={lb().gallery && lb().gallery!.length > 1}>
            <button class="lightbox-nav prev" title="Previous (←)" onClick={(e) => (e.stopPropagation(), step(-1))}>
              <Icon name="chevron" size={22} />
            </button>
            <button class="lightbox-nav next" title="Next (→)" onClick={(e) => (e.stopPropagation(), step(1))}>
              <Icon name="chevron" size={22} />
            </button>
          </Show>
          <div class="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <Show when={lb().gallery && lb().gallery!.length > 1}>
              <span class="muted small">{(lb().index ?? 0) + 1} / {lb().gallery!.length}</span>
            </Show>
            <a class="lightbox-link" href={lb().original}>
              Open original <Icon name="external" size={14} />
            </a>
          </div>
        </div>
      )}
    </Show>
  );
}

function Toast() {
  return (
    <Show when={ui.toast}>
      {(t) => <div class="toast" classList={{ error: !!t().error }}>{t().text}</div>}
    </Show>
  );
}

/** Mise à jour prête : discrète, en bas à droite, jusqu'à ce qu'on l'installe ou l'écarte. */
function UpdateBanner() {
  return (
    <Show when={ui.update && !ui.update.dismissed}>
      <div class="update-banner">
        <Show
          when={ui.updating}
          fallback={
            <>
              <span>Dislite {ui.update!.version} is available.</span>
              <button class="link-button" onClick={() => void installUpdate()}>Update and restart</button>
              <button class="icon-button" title="Later" onClick={() => setUi("update", "dismissed", true)}>
                <Icon name="x" size={14} />
              </button>
            </>
          }
        >
          {(u) => <span>Updating… {u().progress !== null ? `${Math.round(u().progress! * 100)} %` : ""}</span>}
        </Show>
      </div>
    </Show>
  );
}

function MainView() {
  return (
    <Switch fallback={<div class="empty-view muted">Pick a channel.</div>}>
      <Match when={ui.guildId === HOME && !currentChannelId() && ui.homePage === "friends"}>
        <FriendsView />
      </Match>
      <Match when={ui.guildId === HOME && !currentChannelId() && ui.homePage === "mentions"}>
        <MentionsView />
      </Match>
      <Match when={ui.guildId === HOME && !currentChannelId()}>
        <HomeView />
      </Match>
      {/* keyed sur l'id : la vue est recréée à chaque salon, sans lecture d'une valeur périmée. */}
      <Match when={state.channels[currentChannelId() ?? ""] ? currentChannelId() : null} keyed>
        {(id) => (isForumLike(state.channels[id]) ? <ForumView channelId={id} /> : <ChannelView channelId={id} />)}
      </Match>
    </Switch>
  );
}

function Shell(props: { onLogout: () => void }) {

  // Repères de temps de démarrage (performance.getEntriesByType("mark")).
  onMount(() => performance.mark("dislite:shell"));
  // Titre de fenêtre : « (3) Dislite » quand des mentions attendent (visible dans la barre des tâches).
  createEffect(() => {
    const n = settings.titleCount ? unreadChannels("all").reduce((sum, id) => sum + mentionCount(id), 0) : 0;
    document.title = n ? `(${n}) Dislite` : "Dislite";
  });
  return (
    <div class="shell" classList={{ focus: ui.focusMode, mini: ui.miniMode }}>
      <ConnectionBar />
      <GuildBar />
      <aside class="sidebar">
        <Show when={ui.guildId !== HOME && state.guilds[ui.guildId]} fallback={<DmSidebar />}>
          <ChannelSidebar guildId={ui.guildId} />
        </Show>
        <VoicePanel />
        <UserPanel onLogout={props.onLogout} />
      </aside>
      <main class="main">
        <ErrorBoundary
          fallback={(err, reset) => {
            reportError("vue principale", err);
            return (
              <div class="empty-view">
                <p>Something went wrong in this view.</p>
                <button class="btn" onClick={reset}>Retry</button>
              </div>
            );
          }}
        >
          {/* Mode mini pendant un appel : overlay d'appel, ou discussion avec une bande d'appel. */}
          <Show when={ui.miniMode && voice.session} fallback={<MainView />}>
            <Show when={ui.miniView === "call"} fallback={<><MiniCallStrip /><MainView /></>}>
              <MiniCall />
            </Show>
          </Show>
        </ErrorBoundary>
      </main>
      <Lightbox />
      <Show when={ui.profile}>
        <ProfilePopout />
      </Show>
      <Show when={ui.quickSwitcher}>
        <QuickSwitcher />
      </Show>
      <Show when={ui.serversView}>
        <ServersView />
      </Show>
      <Show when={ui.groupPicker}>
        <GroupPicker />
      </Show>
      <IncomingCall />
      <PromptHost />
      <Show when={invite()} keyed>
        {(code) => <InviteModal code={code} />}
      </Show>
      <VolumePopover />
      <ContextMenuHost />
    </div>
  );
}

export function App() {
  // Session connue : l'interface s'affiche tout de suite depuis l'instantané local,
  // la connexion à Discord se fait en arrière-plan.
  const [phase, setPhase] = createSignal<Phase>(loadSnapshot() ? "app" : "boot");

  // Ajout d'un compte en cours : compte à rouvrir si l'on annule.
  const [adding, setAdding] = createSignal<string | null>(null);

  const enterApp = async () => {
    setAdding(null);
    setPhase("app");
    await startGateway({ onAuthFailed: () => void logout() });
  };

  /** Vide l'état de la session affichée (avant bascule, ajout ou déconnexion). */
  const resetSession = () => {
    resetState();
    clearDerivedCaches();
    setUi({ guildId: HOME, channelByGuild: {}, homePage: "home", profile: null, serversView: false, quickSwitcher: false });
  };

  /** Ouvre un compte enregistré : instantané tout de suite, connexion en arrière-plan. */
  const openAccount = async (id: string) => {
    await backend.accountSwitch(id);
    resetSession();
    setActiveAccount(id);
    loadSnapshot(id);
    await enterApp();
  };

  const switchTo = async (id: string) => {
    if (id === state.meId) return;
    saveSnapshot();
    await stopGateway();
    await openAccount(id);
  };

  const add = async () => {
    const previous = state.meId;
    saveSnapshot();
    await stopGateway();
    await backend.accountPrepareAdd();
    resetSession();
    setActiveAccount(null);
    setAdding(previous);
    setPhase("login");
  };

  const logout = async () => {
    const id = state.meId;
    await stopGateway();
    const hasNext = await backend.logout().catch(() => false);
    clearSnapshot(id);
    resetSession();
    void refreshAccounts();
    if (!hasNext) {
      setPhase("login");
      return;
    }
    // Un autre compte enregistré prend le relais.
    const { active } = await backend.accountsList();
    if (active) {
      setActiveAccount(active);
      loadSnapshot(active);
    }
    await enterApp();
  };

  registerSession({ switchTo, add, logout });
  void startVoiceEvents();
  startPresence();
  // Réglages audio transmis au moteur vocal à chaque changement.
  createEffect(() => void backend.voiceSetConfig(voiceConfig()).catch(() => {}));
  void refreshAccounts();

  // Après une reconnexion : on revient au fil du serveur affiché.
  onConnected(() => {
    if (ui.guildId !== HOME && !state.guilds[ui.guildId]) setUi("guildId", HOME);
    const cid = currentChannelId();
    const ch = cid ? state.channels[cid] : undefined;
    if (ch?.guild_id) void subscribeGuild(ch.guild_id, ch.parent_id && ch.type >= 10 && ch.type <= 12 ? ch.parent_id : ch.id);
  });

  onMount(async () => {
    // Liens : toujours dans le navigateur du système.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      // Invitation Discord : aperçu dans l'app plutôt que le navigateur.
      const code = inviteCode(a.href);
      if (code && phase() === "app") return setInvite(code);
      if (/^https?:\/\//.test(a.href)) void openUrl(a.href);
    };
    // Raccourcis clavier globaux.
    const onKeyDown = (e: KeyboardEvent) => {
      if (phase() !== "app") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setUi("quickSwitcher", !ui.quickSwitcher);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f" && currentChannelId()) {
        e.preventDefault();
        setUi("search", true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setUi({ serversView: !ui.serversView, quickSwitcher: false });
        return;
      }
      if (ui.quickSwitcher || document.querySelector(".modal-backdrop")) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleMiniMode();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setUi("focusMode", !ui.focusMode);
        return;
      }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (e.key === "ArrowLeft") goBack();
        else goForward();
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        moveChannel(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
        return;
      }
      // Échap : tout marquer comme lu et revenir en bas (si rien d'autre à fermer).
      if (e.key === "Escape" && !ui.editingId && !ui.profile && !ui.lightbox) {
        const cid = currentChannelId();
        if (cid) {
          ackChannel(cid);
          window.dispatchEvent(new CustomEvent("accord:jump-bottom"));
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));

    // Boutons latéraux de la souris : 3 = précédent, 4 = suivant.
    const onMouseUp = (e: MouseEvent) => {
      if (phase() !== "app" || (e.button !== 3 && e.button !== 4)) return;
      e.preventDefault();
      if (e.button === 3) goBack();
      else goForward();
    };
    document.addEventListener("mouseup", onMouseUp);
    onCleanup(() => document.removeEventListener("mouseup", onMouseUp));

    const onFocus = () => setUi("windowFocused", true);
    const onBlur = () => setUi("windowFocused", false);
    document.addEventListener("click", onClick);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    });

    // Instantané rafraîchi régulièrement et à la fermeture (derniers messages, non-lus).
    const snapshotTimer = setInterval(saveSnapshot, 10 * 60 * 1000);
    window.addEventListener("beforeunload", saveSnapshot);
    onCleanup(() => {
      clearInterval(snapshotTimer);
      window.removeEventListener("beforeunload", saveSnapshot);
    });

    // Boutons des notifications système.
    void events.onNotifyAction((action, id) => {
      if (action === "decline") return declineCall(id);
      if (action === "accept") startCall(id);
      openChannel(id);
      setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 150);
    });
    backend.mediaSupport().then((ok) => setUi("mediaSupported", ok)).catch(() => {});
    watchUpdates();
    const toLogin = () => {
      // Plus de session : l'instantané éventuel n'a plus lieu d'être affiché.
      resetState();
      setPhase("login");
    };
    try {
      if (await backend.sessionRestore()) await enterApp();
      else toLogin();
    } catch {
      toLogin();
    }
  });

  return (
    <>
      <Switch>
        <Match when={phase() === "boot"}>
          <Splash />
        </Match>
        <Match when={phase() === "login"}>
          <Login onLoggedIn={enterApp} onCancel={adding() ? () => void openAccount(adding()!) : undefined} />
        </Match>
        <Match when={phase() === "app"}>
          {/* Pas d'attente : ce qui n'est pas encore connu s'affiche en squelette. */}
          <Shell onLogout={logout} />
        </Match>
      </Switch>
      <Toast />
      <UpdateBanner />
    </>
  );
}
