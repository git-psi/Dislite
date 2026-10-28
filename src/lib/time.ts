// Interface en anglais ; en-GB pour l'heure sur 24 h et le format jour/mois.
const locale = "en-GB";

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts);
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit" });
const timeSecFmt = fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
const shortDateFmt = fmt({ day: "2-digit", month: "2-digit", year: "numeric" });
const longDateFmt = fmt({ day: "numeric", month: "long", year: "numeric" });
const fullFmt = fmt({ day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fullDayFmt = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const relFmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const shortTime = (iso: string) => timeFmt.format(new Date(iso));
export const fullDate = (iso: string) => fullDayFmt.format(new Date(iso));
export const dayLabel = (iso: string) => longDateFmt.format(new Date(iso));

/** « Aujourd'hui à 14:03 », « Hier à 09:12 » ou « 12/03/2024 14:03 ». */
export function messageTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Today at ${timeFmt.format(d)}`;
  if (sameDay(d, yesterday)) return `Yesterday at ${timeFmt.format(d)}`;
  return `${shortDateFmt.format(d)} ${timeFmt.format(d)}`;
}

const dayMonthFmt = fmt({ day: "2-digit", month: "2-digit" });

/** Forme courte pour la marge droite : « 14:03 », « Hier 09:12 », « 12/03 14:03 ». */
export function compactTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return timeFmt.format(d);
  if (sameDay(d, yesterday)) return `Yesterday ${timeFmt.format(d)}`;
  const date = d.getFullYear() === now.getFullYear() ? dayMonthFmt.format(d) : shortDateFmt.format(d);
  return `${date} ${timeFmt.format(d)}`;
}

export function isSameDay(a: string, b: string) {
  return sameDay(new Date(a), new Date(b));
}

export function relativeTime(ms: number) {
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) if (abs >= secs) return relFmt.format(Math.round(diff / secs), unit);
  return relFmt.format(Math.round(diff), "second");
}

/** Ancienneté très courte pour les listes : « now », « 5m », « 3h », « 2d », « 6w », « 1y ». */
export function shortAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  if (s < 31536000) return `${Math.floor(s / 604800)}w`;
  return `${Math.floor(s / 31536000)}y`;
}

/** Formats des balises `<t:…:style>`. */
export function discordTimestamp(ms: number, style: string) {
  const d = new Date(ms);
  switch (style) {
    case "t": return timeFmt.format(d);
    case "T": return timeSecFmt.format(d);
    case "d": return shortDateFmt.format(d);
    case "D": return longDateFmt.format(d);
    case "F": return fullDayFmt.format(d);
    case "R": return relativeTime(ms);
    default: return fullFmt.format(d);
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}
