// Logo Dislite (plume vivante), en SVG intégré : prend la couleur du texte (currentColor).
// Un seul tracé evenodd, sans masque : pas d'identifiants à dédoubler entre instances.

export function Logo(props: { size?: number; class?: string }) {
  return (
    <svg
      class={props.class}
      width={props.size ?? 48}
      height={props.size ?? 48}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-label="Dislite"
      innerHTML={MARKUP}
    />
  );
}

const MARKUP = `<g transform="rotate(32 128 128)"><path fill-rule="evenodd" d="M152 12 C204 36 210 92 196 132 L162 150 L190 146 C176 182 154 206 128 224 C104 204 88 176 86 146 L112 156 L87 132 C86 76 108 34 152 12 Z M114 96 a11 13 0 1 0 22 0 a11 13 0 1 0 -22 0 Z M150 92 a11 13 0 1 0 22 0 a11 13 0 1 0 -22 0 Z M127 218 Q132 190 144 168 Q136 192 131 218 Z"/><path d="M128 222 Q126 238 119 250" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/></g>`;
