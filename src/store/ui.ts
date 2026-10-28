// État purement visuel (navigation, panneaux ouverts…), indépendant de Discord.

import { createStore, produce } from "solid-js/store";
import type { Snowflake } from "./types";

export interface ProfileTarget {
  userId: Snowflake;
  guildId?: Snowflake;
  /** rectangle de l'élément cliqué (coordonnées écran) */
  rect: { left: number; top: number; right: number; bottom: number };
}

export const HOME = "@me";

/** Vue « maison » sans conversation ouverte : accueil Dislite ou liste d'amis. */
export type HomePage = "home" | "friends" | "mentions";

export type FriendsTab = "all" | "online" | "pending" | "blocked";

export interface Lightbox {
  url: string;
  original: string;
  width?: number;
  height?: number;
  video?: boolean;
  /** images voisines (mosaïque) : ← / → pour passer de l'une à l'autre */
  gallery?: { url: string; original: string }[];
  index?: number;
}

export interface UiState {
  guildId: Snowflake;
  /** dernier salon ouvert par serveur ; `@me` -> MP ou null (amis) */
  channelByGuild: Record<Snowflake, Snowflake | null>;
  showMembers: boolean;
  /** liste des membres en panneau superposé (fenêtre étroite) */
  membersOverlay: boolean;
  /** largeur de fenêtre sous laquelle la liste des membres se superpose */
  narrow: boolean;
  replyTo: Record<Snowflake, { messageId: Snowflake; mention: boolean } | undefined>;
  editingId: Snowflake | null;
  lightbox: Lightbox | null;
  homePage: HomePage;
  friendsTab: FriendsTab;
  collapsedCategories: Record<Snowflake, boolean>;
  openFolders: Record<string, boolean>;
  windowFocused: boolean;
  /** lecture vidéo/audio possible (plugins GStreamer présents) */
  mediaSupported: boolean;
  /** salons ouverts récemment (le plus récent en premier) */
  history: Snowflake[];
  quickSwitcher: boolean;
  /** ordre des serveurs choisi dans Dislite (clés « g:id » / « f:id ») */
  guildOrderLocal: string[];
  /** serveurs masqués du rail (toujours accessibles par Ctrl+K et la vue des serveurs) */
  hiddenGuilds: Record<Snowflake, true>;
  /** vue de tous les serveurs (Ctrl+G) */
  serversView: boolean;
  /** choix d'amis : nouveau groupe (channelId null) ou ajout à une conversation */
  groupPicker: { channelId: Snowflake | null } | null;
  /** panneau de recherche ouvert dans la vue de salon */
  search: boolean;

  /** mode focus (Ctrl+B) : rail et colonne masqués */
  focusMode: boolean;
  /** mode mini (Ctrl+Maj+B) : petite fenêtre flottante, utile pendant les appels */
  miniMode: boolean;
  /** en mode mini pendant un appel : la vue d'appel ou la discussion */
  miniView: "call" | "chat";
  /** fiche de profil ouverte */
  profile: ProfileTarget | null;
  toast: { text: string; error?: boolean } | null;
}

export const [ui, setUi] = createStore<UiState>({
  guildId: HOME,
  channelByGuild: {},
  showMembers: false,
  membersOverlay: false,
  narrow: window.innerWidth < 1100,
  replyTo: {},
  editingId: null,
  lightbox: null,
  homePage: "home",
  friendsTab: "all",
  collapsedCategories: {},
  openFolders: {},
  windowFocused: true,
  mediaSupported: false,
  history: [],
  quickSwitcher: false,
  focusMode: false,
  miniMode: false,
  miniView: "call",
  guildOrderLocal: [],
  hiddenGuilds: {},
  serversView: false,
  groupPicker: null,
  search: false,

  profile: null,
  toast: null,
});

window.addEventListener("resize", () => setUi("narrow", window.innerWidth < 1100));

/** La liste des membres est-elle visible (colonne ou panneau superposé) ? */
export const membersVisible = () => (ui.narrow ? ui.membersOverlay : ui.showMembers);

export function toggleMembers() {
  if (ui.narrow) setUi("membersOverlay", !ui.membersOverlay);
  else {
    setUi("showMembers", !ui.showMembers);
    savePrefs();
  }
}

export function toggleMiniMode() {
  const on = !ui.miniMode;
  setUi("miniMode", on);
  // Les fenêtres en Portal (sélecteur rapide…) sont hors du shell : attribut sur la racine.
  document.documentElement.dataset.mini = String(on);
  void import("../ipc/tauri").then(({ backend }) => backend.setMiniMode(on)).catch(() => {});
}

/** Masque ou réaffiche un serveur dans le rail. */
export function toggleGuildHidden(guildId: Snowflake) {
  // produce : une clé supprimée doit vraiment disparaître (setUi fusionnerait l'objet).
  setUi(
    "hiddenGuilds",
    produce((h) => {
      if (h[guildId]) delete h[guildId];
      else h[guildId] = true;
    }),
  );
  savePrefs();
}

export const currentChannelId = () => ui.channelByGuild[ui.guildId] ?? null;

let toastTimer: number | undefined;
export function toast(text: string, error = false) {
  setUi("toast", { text, error });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setUi("toast", null), 4000);
}

// Préférences d'affichage conservées entre les lancements.
const PREFS_KEY = "accord:prefs";
/** v2 : liste des membres masquée par défaut (l'ancien réglage n'est pas repris) */
const PREFS_VERSION = 2;
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  if (saved.v === PREFS_VERSION && typeof saved.showMembers === "boolean") setUi("showMembers", saved.showMembers);
  if (saved.hiddenGuilds) setUi("hiddenGuilds", saved.hiddenGuilds);

  if (saved.collapsedCategories) setUi("collapsedCategories", saved.collapsedCategories);
  if (saved.openFolders) setUi("openFolders", saved.openFolders);
  // Au lancement, on arrive toujours sur l'accueil (les serveurs gardent leur dernier salon).
  if (saved.lastChannels) setUi("channelByGuild", { ...saved.lastChannels, [HOME]: null });
  if (Array.isArray(saved.guildOrderLocal)) setUi("guildOrderLocal", saved.guildOrderLocal);
  if (Array.isArray(saved.history)) setUi("history", saved.history);
} catch {
  /* préférences absentes ou illisibles */
}

export function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        v: PREFS_VERSION,
        showMembers: ui.showMembers,
        hiddenGuilds: ui.hiddenGuilds,

        collapsedCategories: ui.collapsedCategories,
        openFolders: ui.openFolders,
        lastChannels: ui.channelByGuild,
        guildOrderLocal: ui.guildOrderLocal,
        history: ui.history,
      }),
    );
  } catch {
    /* stockage indisponible */
  }
}
