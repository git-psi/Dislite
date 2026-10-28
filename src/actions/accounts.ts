// Comptes enregistrés sur cet appareil : liste, bascule, ajout, déconnexion.
// Les changements de session (phases de l'app, gateway) sont faits par App.tsx, qui s'enregistre ici.

import { createSignal } from "solid-js";
import { type AccountProfile, backend } from "../ipc/tauri";

const [accounts, setAccounts] = createSignal<AccountProfile[]>([]);
export { accounts };

export async function refreshAccounts() {
  try {
    setAccounts((await backend.accountsList()).accounts);
  } catch {
    /* liste indisponible : le sélecteur reste vide */
  }
}

export interface SessionControls {
  switchTo: (id: string) => Promise<void>;
  add: () => Promise<void>;
  logout: () => Promise<void>;
}

let controls: SessionControls | null = null;
export const registerSession = (c: SessionControls) => (controls = c);

export const switchAccount = (id: string) => controls?.switchTo(id);
export const addAccount = () => controls?.add();
export const logoutAccount = () => controls?.logout();

/** Retire un compte inactif de cet appareil (il reste connecté ailleurs). */
export async function removeAccount(id: string) {
  await backend.accountRemove(id);
  localStorage.removeItem(`accord:snapshot:${id}`);
  await refreshAccounts();
}
