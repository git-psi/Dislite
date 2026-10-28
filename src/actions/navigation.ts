import { activeThreads, channelGroups, defaultChannel, isChannelMuted, isUnread, mentionCount, sortedPrivateChannels } from "../store/selectors";
import { state } from "../store/state";
import { trimMessages } from "../store/mutations";
import type { Snowflake } from "../store/types";
import { currentChannelId, HOME, type HomePage, savePrefs, setUi, ui } from "../store/ui";

// ---------------------------------------------------------------- historique
// Emplacement = id de salon, « guild:<id> » pour une vue sans salon (accueil), ou « friends ».

const past: string[] = [];
const future: string[] = [];
let replaying = false;

const currentLocation = () =>
  currentChannelId() ?? (ui.guildId === HOME && ui.homePage !== "home" ? ui.homePage : `guild:${ui.guildId}`);

function record(next: string) {
  if (replaying) return;
  const cur = currentLocation();
  if (cur === next) return;
  past.push(cur);
  if (past.length > 100) past.shift();
  future.length = 0;
}

// Position de lecture par salon : premier message visible et son décalage.
interface ScrollAnchor {
  mid: Snowflake;
  offset: number;
}
const anchors = new Map<Snowflake, ScrollAnchor | null>();
let pendingRestore: { channelId: Snowflake; anchor: ScrollAnchor | null } | null = null;

function captureScroll(channelId: Snowflake) {
  const scroller = document.querySelector<HTMLElement>(".messages-scroller");
  if (!scroller) return;
  // Tout en bas : rien à retenir, on reviendra en bas.
  if (scroller.scrollTop > -5) return anchors.set(channelId, null);
  const top = scroller.getBoundingClientRect().top;
  for (const el of scroller.querySelectorAll<HTMLElement>(".message[data-mid]")) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top) return anchors.set(channelId, { mid: el.dataset.mid!, offset: r.top - top });
  }
}

/** Position à restaurer pour ce salon (navigation précédent/suivant uniquement). */
export function takeScrollRestore(channelId: Snowflake): ScrollAnchor | null {
  if (pendingRestore?.channelId !== channelId) return null;
  const anchor = pendingRestore.anchor;
  pendingRestore = null;
  return anchor;
}

function goTo(location: string) {
  if (location === "friends" || location === "mentions") {
    replaying = true;
    try {
      openHomePage(location);
    } finally {
      replaying = false;
    }
    return;
  }
  if (!location.startsWith("guild:")) pendingRestore = { channelId: location, anchor: anchors.get(location) ?? null };
  replaying = true;
  try {
    if (location.startsWith("guild:")) {
      const gid = location.slice(6);
      if (gid === HOME) openHome();
      else if (state.guilds[gid]) selectGuild(gid);
    } else if (state.channels[location]) {
      openChannel(location);
    }
  } finally {
    replaying = false;
  }
}

/** Bouton « précédent » de la souris, Alt+← */
export function goBack() {
  const prev = past.pop();
  if (!prev) return;
  future.push(currentLocation());
  goTo(prev);
}

/** Bouton « suivant » de la souris, Alt+→ */
export function goForward() {
  const next = future.pop();
  if (!next) return;
  past.push(currentLocation());
  goTo(next);
}

function leaveCurrent(next: Snowflake | null) {
  const prev = currentChannelId();
  if (prev && prev !== next) captureScroll(prev);
  if (prev && prev !== next) trimMessages(prev);
  setUi("editingId", null);
}

export function selectGuild(guildId: Snowflake) {
  if (guildId === ui.guildId) return;
  // Le salon mémorisé peut avoir disparu (supprimé, accès retiré) since dernier lancement.
  const saved = ui.channelByGuild[guildId];
  const valid = saved && state.channels[saved] ? saved : null;
  const target = guildId === HOME ? valid : valid ?? defaultChannel(guildId);
  record(target ?? `guild:${guildId}`);
  leaveCurrent(target);
  setUi("guildId", guildId);
  setUi("channelByGuild", guildId, target);
  savePrefs();
}

export function openChannel(channelId: Snowflake) {
  const ch = state.channels[channelId];
  const guildId = ch?.guild_id ?? HOME;
  record(channelId);
  leaveCurrent(channelId);
  setUi("guildId", guildId);
  setUi("channelByGuild", guildId, channelId);
  setUi("history", (h) => [channelId, ...h.filter((id) => id !== channelId)].slice(0, 30));
  savePrefs();
}

/** Salons navigables de la colonne affichée, dans l'ordre visuel. */
function sidebarChannelIds(): Snowflake[] {
  if (ui.guildId === HOME) return sortedPrivateChannels().map((c) => c.id);
  return channelGroups(ui.guildId)
    .filter((g) => !g.category || !ui.collapsedCategories[g.category.id])
    .flatMap((g) => g.channels)
    .filter((c) => c.type !== 2 && c.type !== 13)
    .flatMap((c) => [c.id, ...activeThreads(c.id).map((t) => t.id)]);
}

/** Alt+↑/↓ : salon voisin ; avec `unreadOnly`, prochain salon non lu. */
export function moveChannel(direction: 1 | -1, unreadOnly = false) {
  const ids = sidebarChannelIds();
  if (!ids.length) return;
  const current = currentChannelId();
  let i = current ? ids.indexOf(current) : -1;
  for (let step = 0; step < ids.length; step++) {
    i = (i + direction + ids.length) % ids.length;
    const id = ids[i];
    if (!unreadOnly || mentionCount(id) > 0 || (isUnread(id) && !isChannelMuted(id))) return openChannel(id);
  }
}

function openHomePage(page: HomePage) {
  record(page === "home" ? `guild:${HOME}` : page);
  leaveCurrent(null);
  setUi("guildId", HOME);
  setUi("channelByGuild", HOME, null);
  setUi("homePage", page);
}

/** Page d'accueil Dislite (logo du rail, lancement). */
export const openHome = () => openHomePage("home");

export const openFriends = () => openHomePage("friends");

export const openMentions = () => openHomePage("mentions");

/** Logo du rail : ouvre l'accueil ; déjà dessus, bascule accueil ⇄ amis. */
export function toggleHome() {
  const onHomeView = ui.guildId === HOME && !currentChannelId();
  openHomePage(onHomeView && ui.homePage === "home" ? "friends" : "home");
}
