// Thème dérivé d'une seule couleur d'accent.
// Les fonds sombres reprennent la teinte de l'accent avec une saturation très
// faible : l'ensemble reste sobre mais cohérent avec la couleur choisie.

export interface AccentPreset {
  name: string;
  hex: string;
}

export const ACCENTS: AccentPreset[] = [
  { name: "Plume", hex: "#7c6cf6" },
  { name: "Indigo", hex: "#5865f2" },
  { name: "Bleu", hex: "#3b82f6" },
  { name: "Cyan", hex: "#06b6d4" },
  { name: "Menthe", hex: "#14b8a6" },
  { name: "Vert", hex: "#22c55e" },
  { name: "Ambre", hex: "#f59e0b" },
  { name: "Orange", hex: "#f97316" },
  { name: "Rouge", hex: "#ef4444" },
  { name: "Rose", hex: "#ec4899" },
  { name: "Violet", hex: "#8b5cf6" },
  { name: "Graphite", hex: "#94a3b8" },
];

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x5865f2;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  a >= 1
    ? `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`
    : `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}% / ${a})`;

/** Luminance relative approximative pour choisir un texte lisible sur l'accent. */
function isLight({ h, s, l }: Hsl) {
  // Les jaunes/verts paraissent plus clairs à luminosité égale.
  const boost = h > 40 && h < 190 ? 0.12 : 0;
  return l + boost * s > 0.62;
}

/** Variables liées à l'accent. Les fonds restent neutres (définis dans app.css) :
 *  l'accent ne colore que ce qui est actif, les mentions et les non-lus. */
export function themeVariables(accentHex: string, light = false): Record<string, string> {
  const a = hexToHsl(accentHex);
  const h = a.h;
  // Accent lisible sur fond sombre : on remonte la luminosité des teintes trop sombres.
  // (sur fond clair, c'est l'inverse : on l'assombrit un peu).
  const al = light ? Math.min(Math.max(a.l, 0.42), 0.55) : Math.min(Math.max(a.l, 0.55), 0.7);
  const accent = hsl(h, a.s, al);
  return {
    "--accent": accent,
    "--accent-hover": hsl(h, a.s, al - 0.08),
    "--accent-soft": hsl(h, a.s, al, 0.14),
    "--accent-soft-strong": hsl(h, a.s, al, 0.26),
    "--accent-text": hsl(h, Math.min(1, a.s + 0.1), light ? 0.36 : 0.84),
    "--accent-deep": hsl(h, a.s * 0.7, 0.28),
    "--on-accent": isLight({ h, s: a.s, l: al }) ? "#111214" : "#ffffff",
    "--mention-bg": hsl(h, a.s, al, 0.08),
    "--mention-border": accent,
  };
}

/** Couleurs reprises par le splash statique (public/boot.js) au prochain lancement. */
const BOOT_KEYS = ["--bg-0", "--bg-2", "--bg-3", "--bg-4", "--text-strong", "--accent"];
/** Le splash les applique tels quels : on ne retire que ceux qui ne viennent pas d'ici. */
const BOOT_ONLY = BOOT_KEYS.filter((k) => k !== "--accent");

export function applyTheme(accentHex: string, light = false) {
  const root = document.documentElement.style;
  const vars = themeVariables(accentHex, light);
  // Les couleurs posées par boot.js (splash) laissent place à celles de la feuille de style.
  for (const k of BOOT_ONLY) root.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  try {
    const css = getComputedStyle(document.documentElement);
    localStorage.setItem("accord:boot", JSON.stringify(Object.fromEntries(BOOT_KEYS.map((k) => [k, css.getPropertyValue(k).trim()]))));
  } catch {
    /* stockage indisponible */
  }
}
