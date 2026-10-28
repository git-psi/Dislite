// Applications (bots) : composants des messages et commandes « / ».
// Mêmes requêtes que le client officiel : POST /interactions avec notre session.

import { backend, errorMessage } from "../ipc/tauri";
import { makeNonce } from "../lib/snowflake";
import { state } from "../store/state";
import type { Message, Snowflake } from "../store/types";
import { toast } from "../store/ui";

// ---------------------------------------------------------------- composants

export async function interact(msg: Message, data: Record<string, unknown>) {
  try {
    await backend.api("POST", "/interactions", {
      type: 3,
      nonce: makeNonce(),
      guild_id: msg.guild_id ?? state.channels[msg.channel_id]?.guild_id ?? null,
      channel_id: msg.channel_id,
      message_flags: msg.flags ?? 0,
      message_id: msg.id,
      application_id: msg.application_id ?? msg.author.id,
      session_id: state.sessionId,
      data,
    });
  } catch (e) {
    toast(`The app didn't accept that: ${errorMessage(e)}`, true);
  }
}

// ---------------------------------------------------------------- commandes « / »

export interface CommandOption {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  options?: CommandOption[];
  choices?: { name: string; value: string | number }[];
}

export interface AppCommand {
  id: Snowflake;
  application_id: Snowflake;
  version: Snowflake;
  name: string;
  description?: string;
  type: number;
  options?: CommandOption[];
  /** nom de l'application, pour l'affichage */
  appName?: string;
}

const cache = new Map<string, Promise<AppCommand[]>>();

/** Commandes disponibles ici (chargées une fois par serveur / conversation). */
export function commandsFor(channelId: Snowflake): Promise<AppCommand[]> {
  const guildId = state.channels[channelId]?.guild_id;
  const key = guildId ?? channelId;
  let p = cache.get(key);
  if (!p) {
    const path = guildId ? `/guilds/${guildId}/application-command-index` : `/channels/${channelId}/application-command-index`;
    p = backend
      .api<any>("GET", path)
      .then((res) => {
        const apps = new Map<string, string>((res.applications ?? []).map((a: any) => [a.id, a.name]));
        return (res.application_commands ?? [])
          .filter((c: any) => (c.type ?? 1) === 1)
          .map((c: any) => ({ ...c, appName: apps.get(c.application_id) }));
      })
      .catch(() => {
        cache.delete(key);
        return [];
      });
    cache.set(key, p);
  }
  return p;
}

const SUB_COMMAND = 1;
const SUB_GROUP = 2;

/** Valeur saisie -> valeur attendue par le type d'option. */
function convert(type: number, raw: string): unknown {
  const id = /^<[@#][!&]?(\d+)>$/.exec(raw)?.[1] ?? raw;
  switch (type) {
    case 4: return parseInt(raw, 10);
    case 10: return parseFloat(raw);
    case 5: return /^(true|yes|1|on)$/i.test(raw);
    case 6: case 7: case 8: case 9: return id;
    default: return raw;
  }
}

/** « nom:valeur nom2:valeur avec espaces » ; une seule option texte : tout le reste. */
function parseOptions(defs: CommandOption[], input: string): { options: any[]; missing: string[] } {
  const values = new Map<string, string>();
  const rest = input.trim();
  if (rest) {
    const named = rest.split(/\s+(?=[\w-]+:)/).filter((p) => /^[\w-]+:/.test(p));
    if (named.length && defs.some((d) => rest.startsWith(`${d.name}:`))) {
      for (const part of named) {
        const i = part.indexOf(":");
        values.set(part.slice(0, i), part.slice(i + 1).trim());
      }
    } else {
      const first = defs.find((d) => d.required) ?? defs[0];
      if (first) values.set(first.name, rest);
    }
  }
  const options = defs
    .filter((d) => values.has(d.name) && values.get(d.name) !== "")
    .map((d) => {
      const raw = values.get(d.name)!;
      const choice = d.choices?.find((c) => c.name.toLowerCase() === raw.toLowerCase());
      return { type: d.type, name: d.name, value: choice ? choice.value : convert(d.type, raw) };
    });
  const missing = defs.filter((d) => d.required && !values.has(d.name)).map((d) => d.name);
  return { options, missing };
}

/** Exécute « /commande [sous-commande] options… ». Retourne false si ce n'est pas une commande connue. */
export async function runCommand(channelId: Snowflake, text: string): Promise<boolean> {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return false;
  const commands = await commandsFor(channelId);
  const cmd = commands.find((c) => c.name === m[1]);
  if (!cmd) return false;

  let defs = cmd.options ?? [];
  let input = m[2] ?? "";
  let wrap = (opts: any[]) => opts;
  // Sous-commandes (et groupes) : premiers mots.
  for (let depth = 0; depth < 2; depth++) {
    const subs = defs.filter((d) => d.type === SUB_COMMAND || d.type === SUB_GROUP);
    if (!subs.length) break;
    const [word, ...after] = input.trim().split(/\s+/);
    const sub = subs.find((s) => s.name === word);
    if (!sub) {
      toast(`/${cmd.name}: choose one of ${subs.map((s) => s.name).join(", ")}`, true);
      return true;
    }
    const outer = wrap;
    wrap = (opts) => outer([{ type: sub.type, name: sub.name, options: opts }]);
    defs = sub.options ?? [];
    input = after.join(" ");
  }
  const { options, missing } = parseOptions(defs, input);
  if (missing.length) {
    toast(`/${cmd.name}: missing ${missing.map((n) => `${n}:`).join(" ")}`, true);
    return true;
  }
  try {
    await backend.api("POST", "/interactions", {
      type: 2,
      application_id: cmd.application_id,
      guild_id: state.channels[channelId]?.guild_id ?? null,
      channel_id: channelId,
      session_id: state.sessionId,
      nonce: makeNonce(),
      data: { version: cmd.version, id: cmd.id, name: cmd.name, type: 1, options: wrap(options), application_command: cmd },
    });
  } catch (e) {
    toast(`/${cmd.name} failed: ${errorMessage(e)}`, true);
  }
  return true;
}

/** Résumé des options pour l'aide de l'autocomplétion. */
export const optionHint = (cmd: AppCommand) =>
  (cmd.options ?? []).map((o) => (o.type <= SUB_GROUP ? o.name : o.required ? `${o.name}:` : `[${o.name}:]`)).join(" ");
