// Registre des handlers d'événements gateway. Chaque module de `handlers/`
// s'enregistre ici ; ajouter une fonctionnalité = ajouter un module.

import { batch } from "solid-js";

type Handler = (d: any) => void;

const handlers = new Map<string, Handler[]>();

export function on(type: string, handler: Handler) {
  const list = handlers.get(type);
  if (list) list.push(handler);
  else handlers.set(type, [handler]);
}

/** Nombre d'événements reçus par type (diagnostic, dev uniquement). */
export const eventCounts: Record<string, number> = {};

export function dispatch(type: string, d: any) {
  if (import.meta.env.DEV) eventCounts[type] = (eventCounts[type] ?? 0) + 1;
  const list = handlers.get(type);
  if (!list) return;
  batch(() => {
    for (const h of list) {
      try {
        h(d);
      } catch (e) {
        console.error(`[gateway] handler error ${type}`, e);
      }
    }
  });
}
