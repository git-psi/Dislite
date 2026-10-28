// Squelettes affichés tant que les données ne sont pas arrivées.
// Statiques (pas d'animation) : WebKitGTK redessine en continu toute animation infinie.

import { For } from "solid-js";

/** Largeurs variées mais stables (pas d'aléatoire : aucun saut entre deux rendus). */
const WIDTHS = [62, 48, 74, 55, 68, 42, 80, 51];
const width = (i: number) => `${WIDTHS[i % WIDTHS.length]}%`;

/** Lignes avatar + texte (MP, membres, listes). */
export function SkeletonRows(props: { count: number; avatar?: number; sub?: boolean }) {
  return (
    <div class="sk-rows">
      <For each={Array.from({ length: props.count }, (_, i) => i)}>
        {(i) => (
          <div class="sk-row">
            <span class="sk sk-circle" style={{ width: `${props.avatar ?? 32}px`, height: `${props.avatar ?? 32}px` }} />
            <span class="sk-lines">
              <span class="sk sk-line" style={{ width: width(i) }} />
              {props.sub && <span class="sk sk-line small" style={{ width: width(i + 3) }} />}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/** Salons d'un serveur : catégories et lignes « # nom ». */
export function SkeletonChannels() {
  return (
    <div class="sk-rows">
      <For each={[0, 1, 2]}>
        {(g) => (
          <>
            <span class="sk sk-line small sk-category" style={{ width: width(g + 5) }} />
            <For each={[0, 1, 2, 3]}>
              {(i) => (
                <div class="sk-row sk-channel">
                  <span class="sk sk-line" style={{ width: width(g * 4 + i) }} />
                </div>
              )}
            </For>
          </>
        )}
      </For>
    </div>
  );
}

/** Messages : avatar, nom, une ou deux lignes de texte. */
export function SkeletonMessages() {
  return (
    <div class="sk-messages">
      <For each={[0, 1, 2, 3, 4, 5]}>
        {(i) => (
          <div class="sk-message">
            <span class="sk sk-circle" style={{ width: "40px", height: "40px" }} />
            <span class="sk-lines">
              <span class="sk sk-line small" style={{ width: `${90 + (i % 3) * 30}px` }} />
              <span class="sk sk-line" style={{ width: width(i) }} />
              {i % 2 === 0 && <span class="sk sk-line" style={{ width: width(i + 2) }} />}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/** Icônes du rail des serveurs. */
export function SkeletonGuilds() {
  return (
    <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
      {() => (
        <div class="guild-item">
          <span class="sk guild-icon" />
        </div>
      )}
    </For>
  );
}
