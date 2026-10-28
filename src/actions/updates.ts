// Mises à jour de l'app : la recherche se fait côté Rust (au lancement puis toutes les 24 h),
// l'installation seulement à la demande de l'utilisateur.

import { backend, errorMessage, events } from "../ipc/tauri";
import { setUi, toast, ui } from "../store/ui";

export function watchUpdates() {
  void backend.updatePending().then((u) => u && setUi("update", u)).catch(() => {});
  void events.onUpdate((u) => setUi("update", u));
  void events.onUpdateProgress((received, total) => setUi("updating", { progress: total ? received / total : null }));
}

/** Recherche immédiate (réglages). Retourne true si une version plus récente existe. */
export async function checkForUpdate(): Promise<boolean> {
  const u = await backend.updateCheck();
  setUi("update", u);
  return !!u;
}

export async function installUpdate() {
  if (ui.updating) return;
  setUi("updating", { progress: 0 });
  try {
    // L'app redémarre (ou l'installeur Windows la ferme) : rien ne suit en cas de succès.
    await backend.updateInstall();
  } catch (e) {
    setUi("updating", null);
    toast(errorMessage(e), true);
  }
}
