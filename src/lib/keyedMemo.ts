import { type Accessor, createMemo, createRoot } from "solid-js";

/**
 * Mémo partagé par clé (ex. un par serveur), créé à la demande et conservé.
 * Évite de recalculer la même dérivée dans chaque composant qui l'utilise.
 */
export function keyedMemo<K, T>(compute: (key: K) => T) {
  const cache = new Map<K, { get: Accessor<T>; dispose: () => void }>();
  const get = (key: K): T => {
    let entry = cache.get(key);
    if (!entry) {
      entry = createRoot((dispose) => ({ get: createMemo(() => compute(key)), dispose }));
      cache.set(key, entry);
    }
    return entry.get();
  };
  get.clear = () => {
    for (const e of cache.values()) e.dispose();
    cache.clear();
  };
  return get;
}
