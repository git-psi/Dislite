// Parseur du Markdown de Discord vers un petit AST.
// Approche à la simple-markdown : à chaque position on essaie les règles dans
// l'ordre de priorité, sinon on consomme du texte brut.

export type MdNode =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "b" | "i" | "u" | "s" | "spoiler"; c: MdNode[] }
  | { t: "code"; v: string }
  | { t: "codeblock"; lang: string; v: string }
  | { t: "quote"; c: MdNode[] }
  | { t: "heading"; level: 1 | 2 | 3; c: MdNode[] }
  | { t: "subtext"; c: MdNode[] }
  | { t: "list"; ordered: boolean; start: number; items: MdNode[][] }
  | { t: "link"; href: string; c: MdNode[] }
  | { t: "url"; href: string }
  | { t: "user"; id: string }
  | { t: "role"; id: string }
  | { t: "channel"; id: string }
  | { t: "emoji"; name: string; id: string; animated: boolean }
  | { t: "timestamp"; ts: number; style: string }
  | { t: "everyone"; v: string };

interface Ctx {
  inQuote: boolean;
  inLink: boolean;
  /** autorise les éléments de bloc (titres, listes, citations) */
  allowBlocks: boolean;
}

const RE = {
  codeblock: /^```(?:([\w+\-.#]*)\n)?\n*([\s\S]*?)\n*```/,
  blockquoteAll: /^>>> ?([\s\S]*)/,
  blockquote: /^> ([^\n]*)\n?/,
  heading: /^(#{1,3}) +([^\n]+)\n?/,
  subtext: /^-# +([^\n]+)\n?/,
  listItem: /^( *)([-*]|\d{1,9}\.) +([^\n]*)\n?/,
  escape: /^\\([^0-9A-Za-z\s])/,
  inlineCode: /^(`+)([\s\S]*?[^`])\1(?!`)/,
  user: /^<@!?(\d+)>/,
  role: /^<@&(\d+)>/,
  channel: /^<#(\d+)>/,
  emoji: /^<(a)?:(\w+):(\d+)>/,
  timestamp: /^<t:(-?\d{1,13})(?::([tTdDfFR]))?>/,
  maskedLink: /^\[((?:\[[^\]]*\]|[^[\]])+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/,
  angleUrl: /^<(https?:\/\/[^\s>]+)>/,
  url: /^https?:\/\/[^\s<]+[^<.,:;"')\]\s]/,
  everyone: /^@(everyone|here)\b/,
  bold: /^\*\*([\s\S]+?)\*\*(?!\*)/,
  underline: /^__([\s\S]+?)__(?!_)/,
  italicStar: /^\*(?=\S)((?:\*\*[\s\S]+?\*\*|[\s\S])+?)\*(?!\*)/,
  italicUnderscore: /^_((?:__|\\[\s\S]|[^\\_])+?)_\b/,
  strike: /^~~([\s\S]+?)~~/,
  spoiler: /^\|\|([\s\S]+?)\|\|/,
  text: /^[\s\S]+?(?=[\\`<[*_~|@#>\-\d\n]|https?:\/\/|$)/,
};

const isWordChar = (c: string | undefined) => !!c && /\w/.test(c);

function pushText(out: MdNode[], v: string) {
  const last = out[out.length - 1];
  if (last?.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

function parseNodes(src: string, ctx: Ctx): MdNode[] {
  const out: MdNode[] = [];
  let pos = 0;
  let lineStart = true;

  while (pos < src.length) {
    const rest = src.slice(pos);
    let m: RegExpExecArray | null;

    const take = (node: MdNode | null, len: number, endsLine = false) => {
      if (node) out.push(node);
      pos += len;
      lineStart = endsLine;
    };

    if ((m = RE.codeblock.exec(rest))) {
      take({ t: "codeblock", lang: m[1] ?? "", v: m[2] }, m[0].length);
      continue;
    }

    if (lineStart && ctx.allowBlocks) {
      if (!ctx.inQuote && (m = RE.blockquoteAll.exec(rest))) {
        take({ t: "quote", c: parseNodes(m[1], { ...ctx, inQuote: true }) }, m[0].length, true);
        continue;
      }
      if (!ctx.inQuote && RE.blockquote.test(rest)) {
        // Lignes « > » consécutives regroupées dans une seule citation.
        const lines: string[] = [];
        let len = 0;
        while ((m = RE.blockquote.exec(src.slice(pos + len)))) {
          lines.push(m[1]);
          len += m[0].length;
        }
        take({ t: "quote", c: parseNodes(lines.join("\n"), { ...ctx, inQuote: true }) }, len, true);
        continue;
      }
      if ((m = RE.heading.exec(rest))) {
        take({ t: "heading", level: m[1].length as 1 | 2 | 3, c: parseNodes(m[2], { ...ctx, allowBlocks: false }) }, m[0].length, true);
        continue;
      }
      if ((m = RE.subtext.exec(rest))) {
        take({ t: "subtext", c: parseNodes(m[1], { ...ctx, allowBlocks: false }) }, m[0].length, true);
        continue;
      }
      if ((m = RE.listItem.exec(rest))) {
        const ordered = /\d/.test(m[2]);
        const items: MdNode[][] = [];
        let len = 0;
        let mm: RegExpExecArray | null;
        while ((mm = RE.listItem.exec(src.slice(pos + len))) && /\d/.test(mm[2]) === ordered) {
          items.push(parseNodes(mm[3], { ...ctx, allowBlocks: false }));
          len += mm[0].length;
        }
        take({ t: "list", ordered, start: ordered ? parseInt(m[2], 10) : 1, items }, len, true);
        continue;
      }
    }

    if (rest[0] === "\n") {
      take({ t: "br" }, 1, true);
      continue;
    }
    if ((m = RE.escape.exec(rest))) {
      pushText(out, m[1]);
      take(null, m[0].length);
      continue;
    }
    if ((m = RE.inlineCode.exec(rest))) {
      take({ t: "code", v: m[2].replace(/^ (.*) $/, "$1") }, m[0].length);
      continue;
    }
    if ((m = RE.user.exec(rest))) { take({ t: "user", id: m[1] }, m[0].length); continue; }
    if ((m = RE.role.exec(rest))) { take({ t: "role", id: m[1] }, m[0].length); continue; }
    if ((m = RE.channel.exec(rest))) { take({ t: "channel", id: m[1] }, m[0].length); continue; }
    if ((m = RE.emoji.exec(rest))) {
      take({ t: "emoji", animated: !!m[1], name: m[2], id: m[3] }, m[0].length);
      continue;
    }
    if ((m = RE.timestamp.exec(rest))) {
      take({ t: "timestamp", ts: Number(m[1]) * 1000, style: m[2] ?? "f" }, m[0].length);
      continue;
    }
    if (!ctx.inLink) {
      if ((m = RE.maskedLink.exec(rest))) {
        take({ t: "link", href: m[2], c: parseNodes(m[1], { ...ctx, inLink: true, allowBlocks: false }) }, m[0].length);
        continue;
      }
      if ((m = RE.angleUrl.exec(rest)) || (m = RE.url.exec(rest))) {
        take({ t: "url", href: m[1] ?? m[0] }, m[0].length);
        continue;
      }
    }
    if ((m = RE.everyone.exec(rest))) { take({ t: "everyone", v: m[0] }, m[0].length); continue; }

    const inline = { ...ctx, allowBlocks: false };
    if ((m = RE.bold.exec(rest))) { take({ t: "b", c: parseNodes(m[1], inline) }, m[0].length); continue; }
    if ((m = RE.underline.exec(rest))) { take({ t: "u", c: parseNodes(m[1], inline) }, m[0].length); continue; }
    if ((m = RE.italicStar.exec(rest))) { take({ t: "i", c: parseNodes(m[1], inline) }, m[0].length); continue; }
    if (!isWordChar(src[pos - 1]) && (m = RE.italicUnderscore.exec(rest))) {
      take({ t: "i", c: parseNodes(m[1], inline) }, m[0].length);
      continue;
    }
    if ((m = RE.strike.exec(rest))) { take({ t: "s", c: parseNodes(m[1], inline) }, m[0].length); continue; }
    if ((m = RE.spoiler.exec(rest))) { take({ t: "spoiler", c: parseNodes(m[1], inline) }, m[0].length); continue; }

    m = RE.text.exec(rest);
    const len = m && m[0].length > 0 ? m[0].length : 1;
    pushText(out, rest.slice(0, len));
    pos += len;
    lineStart = false;
  }
  return out;
}

const cache = new Map<string, MdNode[]>();
const CACHE_MAX = 2000;

export function parseMarkdown(src: string): MdNode[] {
  let nodes = cache.get(src);
  if (!nodes) {
    nodes = parseNodes(src, { inQuote: false, inLink: false, allowBlocks: true });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(src, nodes);
  }
  return nodes;
}

/** Version sans blocs (titres d'embeds, noms de champs…). */
export function parseInline(src: string): MdNode[] {
  return parseNodes(src, { inQuote: false, inLink: false, allowBlocks: false });
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|\s)+$/u;

/** Message composé uniquement d'emojis (≤ 27) : affichage en grand, comme l'officiel. */
export function isJumbo(nodes: MdNode[]): boolean {
  let count = 0;
  for (const n of nodes) {
    if (n.t === "emoji") count++;
    else if (n.t === "text") {
      if (!EMOJI_ONLY.test(n.v)) return false;
      count += [...n.v.matchAll(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu)].length;
    } else if (n.t !== "br") return false;
  }
  return count > 0 && count <= 27;
}
