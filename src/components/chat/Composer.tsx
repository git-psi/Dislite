import { open } from "@tauri-apps/plugin-dialog";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { notifyTyping, sendMessage, uploadLimit } from "../../actions/messages";
import { backend } from "../../ipc/tauri";
import { formatBytes } from "../../lib/time";
import { avatarUrl, emojiUrl } from "../../lib/cdn";
import { searchUnicode } from "../../lib/emoji";
import { P } from "../../lib/permissions";
import { channelGroups, channelLabel, can, displayName, member } from "../../store/selectors";
import { me, state } from "../../store/state";
import type { Snowflake } from "../../store/types";
import { isVoiceLike } from "../../store/types";
import { setUi, toast, ui } from "../../store/ui";
import type { UploadFile } from "../../ipc/tauri";
import { Icon } from "../common/Icon";
import { EmojiPicker, emojiToText, usableCustomEmojis } from "./EmojiPicker";
import { type AppCommand, commandsFor, optionHint, runCommand } from "../../actions/interactions";

// ---------------------------------------------------------------- brouillons

interface Draft {
  text: string;
  files: UploadFile[];
}

const [drafts, setDrafts] = createStore<Record<Snowflake, Draft>>({});
const draft = (cid: Snowflake): Draft => drafts[cid] ?? { text: "", files: [] };

function ensureDraft(cid: Snowflake) {
  if (!drafts[cid]) setDrafts(cid, { text: "", files: [] });
}

export function addFilesToDraft(cid: Snowflake, files: UploadFile[]) {
  ensureDraft(cid);
  // Taille : connue pour les données collées, demandée au système pour les fichiers.
  const sized = files.map((f) => (f.data ? { ...f, size: Math.floor((f.data.length * 3) / 4) } : f));
  setDrafts(cid, "files", (f) => [...f, ...sized].slice(0, 10));
  const paths = sized.filter((f) => f.path && f.size === undefined).map((f) => f.path!);
  if (paths.length) {
    void backend.fileSizes(paths).then((sizes) =>
      setDrafts(cid, "files", produce((list) => list.forEach((f) => f.path && paths.includes(f.path) && (f.size = sizes[paths.indexOf(f.path)])))),
    );
  }
}

// ---------------------------------------------------------------- autocomplétion

interface Suggestion {
  key: string;
  label: string;
  hint?: string;
  icon?: string;
  glyph?: string;
  insert: string;
}

const TRIGGER = /(^|\s)([@#:])([^\s@#:]{0,32})$/;

function suggestionsFor(trigger: string, query: string, channelId: Snowflake): Suggestion[] {
  const ch = state.channels[channelId];
  const guildId = ch?.guild_id;
  const q = query.toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(q);

  if (trigger === "@") {
    const ids = new Set<Snowflake>();
    // Auteurs récents d'abord, puis membres connus / destinataires.
    for (const m of [...(state.messages[channelId]?.items ?? [])].reverse()) ids.add(m.author.id);
    if (guildId) for (const id of Object.keys(state.members[guildId] ?? {})) ids.add(id);
    for (const id of ch?.recipient_ids ?? []) ids.add(id);
    ids.delete(state.meId ?? "");
    const out: Suggestion[] = [];
    for (const id of ids) {
      const u = state.users[id];
      if (!u) continue;
      const name = displayName(id, guildId);
      if (q && !match(name) && !match(u.username)) continue;
      out.push({ key: id, label: name, hint: u.username, icon: avatarUrl(u, 32), insert: `<@${id}> ` });
      if (out.length >= 8) break;
    }
    if (guildId && can(channelId, P.MENTION_EVERYONE)) {
      for (const special of ["everyone", "here"]) if (special.startsWith(q)) out.push({ key: special, label: `@${special}`, insert: `@${special} ` });
    }
    if (guildId) {
      const roles = Object.values(state.guilds[guildId]?.roles ?? {}).filter((r) => r.id !== guildId && match(r.name));
      for (const r of roles.slice(0, 3)) out.push({ key: r.id, label: `@${r.name}`, hint: "role", insert: `<@&${r.id}> ` });
    }
    return out;
  }

  if (trigger === "#" && guildId) {
    return channelGroups(guildId)
      .flatMap((g) => g.channels)
      .filter((c) => !isVoiceLike(c) && match(c.name ?? ""))
      .slice(0, 8)
      .map((c) => ({ key: c.id, label: channelLabel(c), hint: state.channels[c.parent_id ?? ""]?.name, glyph: "#", insert: `<#${c.id}> ` }));
  }

  if (trigger === ":" && q.length >= 2) {
    const custom = usableCustomEmojis(guildId)
      .flatMap((g) => g.emojis)
      .filter((e) => match(e.name))
      .slice(0, 6)
      .map((e) => ({ key: e.id!, label: `:${e.name}:`, icon: emojiUrl(e.id!, e.animated, 32), insert: `${emojiToText(e)} ` }));
    const unicode = searchUnicode(q, 8 - custom.length).map((e) => ({ key: e.char, label: `:${e.names[0]}:`, glyph: e.char, insert: e.char }));
    return [...custom, ...unicode];
  }
  return [];
}

// ---------------------------------------------------------------- composant

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Composer(props: { channelId: Snowflake; onSent?: () => void }) {
  let textarea!: HTMLTextAreaElement;
  let emojiButton!: HTMLButtonElement;
  const [caret, setCaret] = createSignal(0);
  const [selected, setSelected] = createSignal(0);
  const [picker, setPicker] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);

  const cid = () => props.channelId;
  const text = () => draft(cid()).text;
  const files = () => draft(cid()).files;
  const ch = () => state.channels[cid()];
  const canSend = () => can(cid(), ch()?.type && ch()!.type >= 10 && ch()!.type <= 12 ? P.SEND_MESSAGES_IN_THREADS : P.SEND_MESSAGES);
  const canAttach = () => !ch()?.guild_id || can(cid(), P.ATTACH_FILES);
  const reply = () => ui.replyTo[cid()];
  const replyMessage = () => state.messages[cid()]?.items.find((m) => m.id === reply()?.messageId);
  const locked = () => !!ch()?.thread_metadata?.locked && !can(cid(), P.MANAGE_THREADS);
  const timedOut = () => {
    const until = member(ch()?.guild_id, state.meId ?? "")?.communication_disabled_until;
    return !!until && Date.parse(until) > Date.now();
  };

  const placeholder = () => {
    if (timedOut()) return "You are timed out in this server.";
    if (locked()) return "This thread is locked.";
    if (!canSend()) return "You can't send messages here.";
    return "Message";
  };
  const disabled = () => !canSend() || locked() || timedOut();
  const maxLength = () => (me()?.premium_type === 2 ? 4000 : 2000);

  // Commandes « / » : chargées la première fois qu'on tape « / » ici.
  const [commands, setCommands] = createSignal<AppCommand[]>([]);
  createEffect(
    on([cid, () => text().startsWith("/")], ([id, slash]) => {
      if (slash) void commandsFor(id).then((list) => id === cid() && setCommands(list));
    }),
  );

  const autocomplete = createMemo(() => {
    if (dismissed()) return null;
    const before = text().slice(0, caret());
    const slash = /^\/([\w-]*)$/.exec(before);
    if (slash) {
      const q = slash[1].toLowerCase();
      const items: Suggestion[] = commands()
        .filter((c) => c.name.startsWith(q))
        .slice(0, 12)
        .map((c) => ({
          key: `cmd:${c.id}`,
          label: `/${c.name} ${optionHint(c)}`.trim(),
          hint: [c.appName, c.description].filter(Boolean).join(" · "),
          glyph: "/",
          insert: `/${c.name} `,
        }));
      return items.length ? { start: 0, items } : null;
    }
    const m = TRIGGER.exec(before);
    if (!m) return null;
    const items = suggestionsFor(m[2], m[3], cid());
    return items.length ? { start: before.length - m[2].length - m[3].length, items } : null;
  });

  createEffect(on(autocomplete, () => setSelected(0)));
  createEffect(
    on(cid, () => {
      // Focus et taille du champ à chaque changement de salon.
      queueMicrotask(() => {
        resize();
        if (!disabled()) textarea.focus();
      });
    }),
  );
  createEffect(on(() => ui.editingId, (id) => id === null && !disabled() && textarea?.focus(), { defer: true }));

  const resize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
  };

  const setText = (value: string) => {
    ensureDraft(cid());
    setDrafts(cid(), "text", value);
    queueMicrotask(resize);
  };

  const insertAt = (start: number, end: number, insert: string) => {
    const value = text().slice(0, start) + insert + text().slice(end);
    setText(value);
    const pos = start + insert.length;
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const applySuggestion = (s: Suggestion) => {
    const ac = autocomplete();
    if (ac) insertAt(ac.start, caret(), s.insert);
  };

  const submit = async () => {
    const content = text().trim();
    const attached = files();
    if ((!content && !attached.length) || disabled()) return;
    if (content.length > maxLength()) return;
    if (attached.some((f) => (f.size ?? 0) > uploadLimit())) {
      toast(`A file is over Discord's ${formatBytes(uploadLimit())} limit.`, true);
      return;
    }
    const channelId = cid();
    setDrafts(channelId, { text: "", files: [] });
    queueMicrotask(resize);
    // « /commande » connue d'une application : interaction plutôt que message.
    if (content.startsWith("/") && !attached.length && (await runCommand(channelId, content))) return;
    void sendMessage(channelId, content, [...attached]);
    props.onSent?.();
  };

  const editLastMessage = () => {
    const last = [...(state.messages[cid()]?.items ?? [])].reverse().find((m) => m.author.id === state.meId && !m._pending);
    if (last) setUi("editingId", last.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const ac = autocomplete();
    if (ac) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = ac.items.length;
        setSelected((selected() + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(ac.items[selected()]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape" && reply()) {
      setUi("replyTo", cid(), undefined);
    } else if (e.key === "ArrowUp" && !text()) {
      e.preventDefault();
      editLastMessage();
    }
  };

  const pickFiles = async () => {
    const selection = await open({ multiple: true, title: "Attach files" });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    addFilesToDraft(cid(), paths.map((path) => ({ path })));
  };

  const onPaste = async (e: ClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (!pasted.length || !canAttach()) return;
    e.preventDefault();
    const uploads = await Promise.all(pasted.map(async (f) => ({ name: f.name || "image.png", data: await readAsBase64(f) })));
    addFilesToDraft(cid(), uploads);
  };

  return (
    <div class="composer-wrap">
      <Show when={autocomplete()}>
        {(ac) => (
          <div class="autocomplete">
            <For each={ac().items}>
              {(s, i) => (
                <button
                  class="autocomplete-item"
                  classList={{ selected: i() === selected() }}
                  onMouseEnter={() => setSelected(i())}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(s);
                  }}
                >
                  <Show when={s.icon} fallback={<span class="ac-glyph">{s.glyph ?? "@"}</span>}>
                    <img src={s.icon} alt="" />
                  </Show>
                  <span class="ellipsis">{s.label}</span>
                  <Show when={s.hint}><span class="muted small ellipsis">{s.hint}</span></Show>
                </button>
              )}
            </For>
          </div>
        )}
      </Show>

      <Show when={reply()}>
        {(r) => (
          <div class="reply-bar">
            <span>
              Replying to <b>{replyMessage() ? displayName(replyMessage()!.author.id, ch()?.guild_id) : "a message"}</b>
            </span>
            <button
              class="link-button"
              classList={{ active: r().mention }}
              title="Mention the author"
              onClick={() => setUi("replyTo", cid(), { ...r(), mention: !r().mention })}
            >
              @ {r().mention ? "ON" : "DÉSON"}
            </button>
            <button class="icon-button" onClick={() => setUi("replyTo", cid(), undefined)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
      </Show>

      <Show when={files().length}>
        <div class="pending-files">
          <For each={files()}>
            {(f, i) => (
              <div class="pending-file" classList={{ toobig: (f.size ?? 0) > uploadLimit() }}>
                <Show when={f.data && /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "")} fallback={<Icon name="file" size={20} />}>
                  <img class="pending-thumb" src={`data:image/*;base64,${f.data}`} alt="" />
                </Show>
                <span class="pending-name">
                  <span class="ellipsis">{f.name ?? f.path?.split("/").pop()}</span>
                  <Show when={f.size !== undefined}><span class="pending-size">{formatBytes(f.size!)}</span></Show>
                </span>
                <button
                  class="icon-button"
                  onClick={() => setDrafts(cid(), "files", produce((list) => void list.splice(i(), 1)))}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="composer" classList={{ disabled: disabled(), "has-reply": !!reply() }}>
        <Show when={canAttach() && !disabled()}>
          <button class="icon-button composer-attach" title="Attach a file" onClick={pickFiles}>
            <Icon name="plus" size={20} />
          </button>
        </Show>
        <textarea
          ref={textarea}
          rows={1}
          value={text()}
          placeholder={placeholder()}
          disabled={disabled()}
          onInput={(e) => {
            setDismissed(false);
            setText(e.currentTarget.value);
            setCaret(e.currentTarget.selectionStart);
            if (e.currentTarget.value) notifyTyping(cid());
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={onPaste}
        />
        <Show when={text().length > maxLength() - 200}>
          <span class="char-count" classList={{ over: text().length > maxLength() }}>{maxLength() - text().length}</span>
        </Show>
        <Show when={!disabled()}>
          <div class="composer-emoji">
            <button ref={emojiButton} class="icon-button" title="Emojis" onClick={() => setPicker(!picker())}>
              <Icon name="smile" size={20} />
            </button>
            <Show when={picker()}>
              <EmojiPicker
                anchor={emojiButton}
                guildId={ch()?.guild_id}
                onClose={() => setPicker(false)}
                onPick={(e) => {
                  setPicker(false);
                  const pos = textarea.selectionStart ?? text().length;
                  insertAt(pos, pos, emojiToText(e) + (e.id ? " " : ""));
                }}
              />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
