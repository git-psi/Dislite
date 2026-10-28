// Décodage des parties utiles de PreloadedUserSettings (réglages synchronisés).

import type { GuildListItem, Status } from "../store/types";
import { base64ToBytes, bytesToBase64, ProtoReader, ProtoWriter } from "./protobuf";

export interface DecodedSettings {
  status?: Status;
  customStatus?: string | null;
  guildFolders?: GuildListItem[];
}

const FIELD_STATUS = 11;
const FIELD_GUILD_FOLDERS = 14;

export function decodeUserSettings(b64: string): DecodedSettings {
  const out: DecodedSettings = {};
  const r = new ProtoReader(base64ToBytes(b64));
  while (!r.eof) {
    const [field, wt] = r.tag();
    if (field === FIELD_STATUS && wt === 2) Object.assign(out, decodeStatus(r.bytes()));
    else if (field === FIELD_GUILD_FOLDERS && wt === 2) out.guildFolders = decodeFolders(r.bytes());
    else r.skip(wt);
  }
  return out;
}

/** Lit un wrapper google.protobuf.*Value (champ 1). */
function readWrapper<T>(bytes: Uint8Array, read: (r: ProtoReader, wt: number) => T): T | undefined {
  const r = new ProtoReader(bytes);
  let value: T | undefined;
  while (!r.eof) {
    const [field, wt] = r.tag();
    if (field === 1) value = read(r, wt);
    else r.skip(wt);
  }
  return value;
}

function decodeStatus(bytes: Uint8Array): Pick<DecodedSettings, "status" | "customStatus"> {
  const out: Pick<DecodedSettings, "status" | "customStatus"> = {};
  const r = new ProtoReader(bytes);
  while (!r.eof) {
    const [field, wt] = r.tag();
    if (field === 1 && wt === 2) {
      const s = readWrapper(r.bytes(), (rr) => rr.string());
      if (s) out.status = s as Status;
    } else if (field === 2 && wt === 2) {
      const cr = new ProtoReader(r.bytes());
      let text: string | null = null;
      let expires = 0n;
      while (!cr.eof) {
        const [f, w] = cr.tag();
        if (f === 1 && w === 2) text = cr.string();
        else if (f === 4 && w === 1) expires = cr.fixed64();
        else cr.skip(w);
      }
      out.customStatus = expires && Number(expires) < Date.now() ? null : text;
    } else r.skip(wt);
  }
  return out;
}

function decodeFolders(bytes: Uint8Array): GuildListItem[] {
  const r = new ProtoReader(bytes);
  const folders: GuildListItem[] = [];
  const positions: bigint[] = [];
  while (!r.eof) {
    const [field, wt] = r.tag();
    if (field === 1 && wt === 2) folders.push(decodeFolder(r.bytes()));
    else if (field === 2) r.repeatedFixed64(wt, positions);
    else r.skip(wt);
  }
  // Les serveurs hors dossier sont représentés comme des dossiers sans id.
  return folders.flatMap((f): GuildListItem[] =>
    f.kind === "folder" && f.id === "" && f.guildIds.length === 1 ? [{ kind: "guild", id: f.guildIds[0] }] : [f],
  );
}

function decodeFolder(bytes: Uint8Array): GuildListItem {
  const r = new ProtoReader(bytes);
  const ids: bigint[] = [];
  let id = "";
  let name: string | null = null;
  let color: number | null = null;
  while (!r.eof) {
    const [field, wt] = r.tag();
    if (field === 1) r.repeatedFixed64(wt, ids);
    else if (field === 2 && wt === 2) id = String(readWrapper(r.bytes(), (rr) => rr.varint()) ?? "");
    else if (field === 3 && wt === 2) name = readWrapper(r.bytes(), (rr) => rr.string()) ?? null;
    else if (field === 4 && wt === 2) {
      const c = readWrapper(r.bytes(), (rr) => rr.varint());
      color = c === undefined ? null : Number(c);
    } else r.skip(wt);
  }
  return { kind: "folder", id, name, color, guildIds: ids.map(String) };
}

/** Patch partiel des réglages : uniquement le statut. */
export function encodeStatusPatch(status: Status): string {
  const bytes = new ProtoWriter()
    .message(FIELD_STATUS, (s) => s.message(1, (v) => v.string(1, status)))
    .finish();
  return bytesToBase64(bytes);
}

/** Patch partiel : statut personnalisé (texte vide = effacé). */
export function encodeCustomStatusPatch(text: string): string {
  const bytes = new ProtoWriter()
    .message(FIELD_STATUS, (s) =>
      s.message(2, (c) => {
        if (text) c.string(1, text);
      }),
    )
    .finish();
  return bytesToBase64(bytes);
}
