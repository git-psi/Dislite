// Accès aux internes depuis le pont de débogage (`scripts/accord-eval`), en dev uniquement.
import * as forums from "../actions/forums";
import * as messages from "../actions/messages";
import * as navigation from "../actions/navigation";
import * as social from "../actions/social";
import { eventCounts } from "../gateway/dispatcher";
import { devFlags } from "../lib/devFlags";
import * as selectors from "../store/selectors";
import { state } from "../store/state";
import { setUi, ui } from "../store/ui";

// Pas de requestAnimationFrame : il est suspendu quand la fenêtre n'est pas visible.
const tick = () => new Promise((r) => setTimeout(r, 30));

(window as any).__accord = {
  state,
  ui,
  setUi,
  devFlags,
  eventCounts,
  selectors,
  actions: { ...navigation, ...messages, ...social, ...forums },
  /** laisse le temps au DOM d'être rendu */
  settle: async (ms = 0) => {
    await tick();
    await tick();
    if (ms) await new Promise((r) => setTimeout(r, ms));
  },
  /** éléments flottants qui sortent de la fenêtre ou sont rognés par un parent */
  checkOverflow,
  /** erreurs JS capturées depuis le lancement */
  errors: [] as string[],
};

window.addEventListener("error", (e) => (window as any).__accord.errors.push(String(e.error?.stack ?? e.message)));
window.addEventListener("unhandledrejection", (e) => (window as any).__accord.errors.push(`promise: ${String(e.reason?.message ?? e.reason)}`));

const FLOATING = ".message-toolbar, .popover, .profile-card, .emoji-picker, .autocomplete, .jump-bottom, .modal, .member-list.overlay, .status-menu";

function checkOverflow() {
  const problems: string[] = [];
  const vw = innerWidth;
  const vh = innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>(FLOATING)) {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).display === "none") continue;
    const name = el.className.toString().split(" ")[0];
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)
      problems.push(`${name} hors fenêtre [${[r.left, r.top, r.right, r.bottom].map(Math.round)}]`);
    // Rognage par un ancêtre en overflow caché/défilant.
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflow === "visible" && o.overflowX === "visible" && o.overflowY === "visible") continue;
      const pr = p.getBoundingClientRect();
      if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.right > pr.right + 1) {
        problems.push(`${name} rogné par ${p.className.toString().split(" ")[0] || p.tagName}`);
        break;
      }
    }
  }
  return problems;
}
