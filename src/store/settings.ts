// Préférences de l'utilisateur, locales à cette machine (localStorage).

import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { applyTheme } from "../lib/theme";

export type Density = "cozy" | "compact";
export type Theme = "dark" | "darker" | "light" | "system";

export interface Settings {
  theme: Theme;
  accent: string;
  density: Density;
  /** zoom de l'interface, 1 = 100 % */
  zoom: number;
  notifications: boolean;
  /** n'affiche les GIF/émojis animés qu'au survol */
  reduceMotion: boolean;
  /** affiche la ligne « Nouveaux messages » à l'ouverture d'un salon */
  unreadDivider: boolean;
  /** « (3) Dislite » dans le titre de la fenêtre */
  titleCount: boolean;
  /** sons de l'interface et leur volume (0 à 1) */
  sounds: boolean;
  soundVolume: number;
  /** aperçu du message dans les notifications */
  notifyPreview: boolean;
  /** notifications d'appels entrants */
  notifyCalls: boolean;
  /** envoyer « … est en train d'écrire » */
  sendTyping: boolean;
  /** afficher les activités des autres (jeux, musique, statuts) */
  showActivities: boolean;
  /** activité affichée sur notre profil (vide = aucune) et son type (0 joue, 2 écoute, 3 regarde) */
  activityName: string;
  activityType: 0 | 2 | 3;
  /** passer « absent » après N minutes sans activité (0 = jamais) */
  autoIdleMinutes: number;
  /** micro et sortie (null = par défaut du système) */
  voiceInput: string | null;
  voiceOutput: string | null;
  /** seuil de détection de la voix (dBFS) */
  voiceSensitivity: number;
  /** appui-pour-parler, et sa touche (KeyboardEvent.code) */
  voicePtt: boolean;
  voicePttKey: string;
  /** gain du micro (0 à 4), volume de sortie (0 à 2), suppression de bruit */
  voiceInputGain: number;
  voiceOutputVolume: number;
  voiceNoiseSuppression: boolean;
  /** l'accent par défaut a déjà été converti (on respecte ensuite un choix explicite) */
  accentMigrated?: boolean;
}

const KEY = "accord:settings";

const defaults: Settings = {
  theme: "dark",
  accent: "#7c6cf6",
  density: "cozy",
  zoom: 1,
  notifications: true,
  reduceMotion: false,
  unreadDivider: true,
  titleCount: true,
  sounds: true,
  soundVolume: 0.6,
  notifyPreview: true,
  notifyCalls: true,
  sendTyping: true,
  showActivities: true,
  activityName: "",
  activityType: 0,
  autoIdleMinutes: 10,
  voiceInput: null,
  voiceOutput: null,
  voiceSensitivity: -50,
  voicePtt: false,
  voicePttKey: "Backquote",
  voiceInputGain: 1,
  voiceOutputVolume: 1,
  voiceNoiseSuppression: true,
};

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // L'ancien accent par défaut (celui de Discord) laisse place à la couleur de Dislite.
    if (saved.accent === "#5865f2" && !saved.accentMigrated) saved.accent = defaults.accent;
    return { ...defaults, ...saved, accentMigrated: true };
  } catch {
    return { ...defaults };
  }
}

export const [settings, setSettings] = createStore<Settings>(load());

// Application et sauvegarde automatiques à chaque changement.
// Thème « système » : suit la préférence clair/sombre du bureau.
const systemLight = window.matchMedia("(prefers-color-scheme: light)");
const [systemIsLight, setSystemIsLight] = createSignal(systemLight.matches);
systemLight.addEventListener("change", (e) => setSystemIsLight(e.matches));

export const resolvedTheme = () => (settings.theme === "system" ? (systemIsLight() ? "light" : "dark") : settings.theme);

createRoot(() => {
  createEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme();
    applyTheme(settings.accent, resolvedTheme() === "light");
  });
  createEffect(() => {
    const root = document.documentElement;
    root.dataset.density = settings.density;
    root.dataset.reduceMotion = String(settings.reduceMotion);
    root.style.setProperty("zoom", String(settings.zoom));
  });
  createEffect(() => {
    const snapshot = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, snapshot);
    } catch {
      /* stockage indisponible */
    }
  });
});
