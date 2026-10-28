import { ask } from "@tauri-apps/plugin-dialog";
import { createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { deleteMessage, discardFailed, editMessage, jumpToMessage, sendMessage, toggleReaction, uploads } from "../../actions/messages";
import { openChannel } from "../../actions/navigation";
import { emojiUrl } from "../../lib/cdn";
import { QUICK_REACTIONS } from "../../lib/emoji";
import { P } from "../../lib/permissions";
import { compactTime, fullDate, messageTime, shortTime } from "../../lib/time";
import { can, displayName, memberColor } from "../../store/selectors";
import { state } from "../../store/state";
import type { Attachment, Emoji, Message } from "../../store/types";
import { setUi, ui } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { openContextMenu } from "../common/ContextMenu";
import { Markdown } from "../common/Markdown";
import { messageMenu } from "../common/menus";
import { openProfile } from "../profile/ProfilePopout";
import { EmojiPicker } from "./EmojiPicker";
import { Poll } from "./Poll";
import { Components } from "./Components";
import { Attachments, Embeds, Stickers, visibleEmbeds } from "./Media";

/** Types affichés comme des messages normaux : défaut, réponse, commande, menu contextuel. */
const REGULAR_TYPES = new Set([0, 19, 20, 23]);

export const isRegular = (m: Message) => REGULAR_TYPES.has(m.type);

function Name(props: { userId: string; guildId?: string }) {
  return (
    <span
      class="author-name"
      style={{ color: memberColor(props.guildId, props.userId) }}
      onClick={(e) => openProfile(e, props.userId, props.guildId)}
    >
      {displayName(props.userId, props.guildId)}
    </span>
  );
}

function ReplyPreview(props: { msg: Message }) {
  const ref = () => props.msg.referenced_message;
  return (
    <div
      class="reply-preview"
      classList={{ clickable: !!ref() }}
      title={ref() ? "Jump to original message" : undefined}
      onClick={() => ref() && void jumpToMessage(props.msg.channel_id, ref()!.id)}
    >
      <span class="reply-spine" />
      <Show when={ref()} fallback={<span class="muted small italic">Original message was deleted.</span>}>
        {(r) => (
          <>
            <Avatar userId={r().author.id} guildId={props.msg.guild_id} size={16} />
            <Name userId={r().author.id} guildId={props.msg.guild_id} />
            <span class="reply-content ellipsis">
              {r().content ? <Markdown content={r().content.split("\n")[0]} guildId={props.msg.guild_id} inline /> : <i>Attachment</i>}
            </span>
          </>
        )}
      </Show>
    </div>
  );
}

function SystemMessage(props: { msg: Message }) {
  const who = () => displayName(props.msg.author.id, props.msg.guild_id);
  const text = () => {
    const m = props.msg;
    switch (m.type) {
      case 1: return `${who()} added ${m.mentions[0] ? displayName(m.mentions[0].id) : "someone"} to the group.`;
      case 2: return `${who()} removed ${m.mentions[0] ? displayName(m.mentions[0].id) : "someone"} from the group.`;
      case 3: return `${who()} started a call.`;
      case 4: return `${who()} renamed the channel: ${m.content}`;
      case 5: return `${who()} changed the group icon.`;
      case 6: return `${who()} pinned a message.`;
      case 7: return `${who()} joined the server.`;
      case 8:
      case 9:
      case 10:
      case 11: return `${who()} boosted the server!`;
      case 12: return `${who()} now follows this announcement channel.`;
      case 18: return `${who()} started a thread: ${m.content}`;
      case 21: return "Start of thread";
      case 46: return "Poll results are available.";
      default: return m.content || "System message";
    }
  };
  return (
    <div class="message system">
      <div class="message-gutter"><Icon name="pin" size={16} /></div>
      <div class="message-body">
        <span class="muted">{text()}</span> <span class="timestamp">{messageTime(props.msg.timestamp)}</span>
      </div>
    </div>
  );
}

/** Message transféré depuis un autre salon (contenu figé au moment du transfert). */
function Forwarded(props: { msg: Message }) {
  return (
    <For each={props.msg.message_snapshots}>
      {(snap) => (
        <div class="forwarded">
          <div class="forwarded-label small muted">
            <Icon name="reply" size={14} class="flip" /> Forwarded
          </div>
          <Show when={snap.message.content}>
            <div class="message-content markdown">
              <Markdown content={snap.message.content} guildId={props.msg.guild_id} />
            </div>
          </Show>
          <Show when={snap.message.attachments?.length}>
            <Attachments attachments={snap.message.attachments} />
          </Show>
          <Show when={visibleEmbeds(snap.message.embeds ?? []).length}>
            <Embeds embeds={visibleEmbeds(snap.message.embeds ?? [])} guildId={props.msg.guild_id} />
          </Show>
          <span class="small muted">{messageTime(snap.message.timestamp)}</span>
        </div>
      )}
    </For>
  );
}

function Reactions(props: { msg: Message }) {
  return (
    <div class="reactions">
      <For each={props.msg.reactions}>
        {(r) => (
          <button class="reaction" classList={{ me: r.me }} onClick={() => toggleReaction(props.msg, r.emoji)} title={r.emoji.name}>
            <Show when={r.emoji.id} fallback={<span class="reaction-emoji">{r.emoji.name}</span>}>
              <img src={emojiUrl(r.emoji.id!, r.emoji.animated, 32)} alt={r.emoji.name} />
            </Show>
            <span>{r.count}</span>
          </button>
        )}
      </For>
    </div>
  );
}

function EditBox(props: { msg: Message }) {
  let el!: HTMLTextAreaElement;
  onMount(() => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    resize();
  });
  const resize = () => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <div class="edit-box">
      <textarea
        ref={el}
        value={props.msg.content}
        onInput={resize}
        onKeyDown={(e) => {
          if (e.key === "Escape") setUi("editingId", null);
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void editMessage(props.msg, el.value);
          }
        }}
      />
      <span class="small muted">Esc to cancel • Enter to save</span>
    </div>
  );
}

export function MessageItem(props: { msg: Message; grouped: boolean; extraImages?: Attachment[] }) {
  const [picker, setPicker] = createSignal(false);
  let pickerButton!: HTMLButtonElement;
  const msg = () => props.msg;
  const mine = () => msg().author.id === state.meId;
  const canManage = () => can(msg().channel_id, P.MANAGE_MESSAGES);
  const editing = () => ui.editingId === msg().id;
  const mentioned = () =>
    !!state.meId &&
    (msg().mentions.some((u) => u.id === state.meId) || !!msg().mention_everyone);

  const embeds = () => visibleEmbeds(msg().embeds ?? []);
  // Un lien seul vers une image/GIF : on n'affiche que l'aperçu, comme l'officiel.
  const hideContent = () => {
    const e = msg().embeds?.[0];
    return msg().embeds?.length === 1 && (e?.type === "gifv" || e?.type === "image") && msg().content.trim() === e.url;
  };

  const react = (e: Emoji) => {
    setPicker(false);
    void toggleReaction(msg(), e);
  };

  const remove = async (e: MouseEvent) => {
    if (e.shiftKey || (await ask("Delete this message?", { title: "Delete", kind: "warning" }))) void deleteMessage(msg());
  };

  const retry = () => {
    const m = msg();
    discardFailed(m.channel_id, m.nonce!);
    void sendMessage(m.channel_id, m.content);
  };

  return (
    <Show when={isRegular(msg())} fallback={<SystemMessage msg={msg()} />}>
      <div
        class="message"
        data-mid={msg().id}
        onMouseEnter={(e) => {
          // Pas assez de place au-dessus (message en haut de la liste) : barre à l'intérieur.
          const el = e.currentTarget;
          const top = el.closest(".messages-scroller")?.getBoundingClientRect().top ?? 0;
          el.classList.toggle("toolbar-inside", el.getBoundingClientRect().top - top < 20);
        }}
        onDblClick={(e) => {
          // Double-clic sur son propre message : modification directe.
          if (!mine() || editing() || msg()._pending || msg()._failed || !msg().content) return;
          if ((e.target as HTMLElement).closest("a, button, textarea, img, video, .media-frame, .mosaic, .reaction")) return;
          window.getSelection()?.removeAllRanges();
          setUi("editingId", msg().id);
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("a, textarea") || window.getSelection()?.toString()) return;
          openContextMenu(e, messageMenu(msg(), { canEdit: mine(), onDelete: mine() || canManage() ? () => void deleteMessage(msg()) : undefined }));
        }}
        classList={{
          grouped: props.grouped,
          pending: !!msg()._pending,
          failed: !!msg()._failed,
          mentioned: mentioned(),
          editing: editing(),
        }}
      >
        <Show when={msg().type === 19 && msg().message_reference}>
          <ReplyPreview msg={msg()} />
        </Show>
        <div class="message-main">
          <div class="message-gutter">
            <Show when={!props.grouped} fallback={<span class="hover-time">{shortTime(msg().timestamp)}</span>}>
              <Avatar
                userId={msg().author.id}
                guildId={msg().guild_id}
                size={40}
                onClick={(e) => openProfile(e, msg().author.id, msg().guild_id)}
              />
            </Show>
          </div>
          <div class="message-body">
            <Show when={!props.grouped}>
              <div class="message-header">
                <Name userId={msg().author.id} guildId={msg().guild_id} />
                <Show when={msg().author.bot}><span class="bot-tag">BOT</span></Show>
                <span class="timestamp" title={fullDate(msg().timestamp)}>{compactTime(msg().timestamp)}</span>
              </div>
            </Show>

            <Switch>
              <Match when={editing()}>
                <EditBox msg={msg()} />
              </Match>
              <Match when={msg().content && !hideContent()}>
                <div class="message-content markdown">
                  <Markdown content={msg().content} guildId={msg().guild_id} />
                  <Show when={msg().edited_timestamp}>
                    <span class="edited" title={fullDate(msg().edited_timestamp!)}> (edited)</span>
                  </Show>
                </div>
              </Match>
            </Switch>

            <Show when={msg().message_snapshots?.length}>
              <Forwarded msg={msg()} />
            </Show>
            <Show when={msg()._pending && msg().nonce && uploads[msg().nonce!] !== undefined}>
              <div class="upload-progress">
                <span style={{ width: `${Math.round(uploads[msg().nonce!] * 100)}%` }} />
                <em>Uploading… {Math.round(uploads[msg().nonce!] * 100)} %</em>
              </div>
            </Show>
            <Show when={msg().attachments.length}>
              <Attachments attachments={props.extraImages ? [...msg().attachments, ...props.extraImages] : msg().attachments} />
            </Show>
            <Show when={embeds().length}>
              <Embeds embeds={embeds()} guildId={msg().guild_id} />
            </Show>
            <Show when={msg().sticker_items?.length}>
              <Stickers stickers={msg().sticker_items!} />
            </Show>
            <Show when={msg().components?.length}>
              <Components msg={msg()} />
            </Show>
            <Show when={msg().poll}>
              {(poll) => <Poll msg={msg()} poll={poll()} />}
            </Show>
            <Show when={msg().thread}>
              {(t) => (
                <button class="thread-pill" onClick={() => openChannel(t().id)}>
                  <Icon name="thread" size={16} />
                  <b>{state.channels[t().id]?.name ?? t().name}</b>
                  <span class="muted">{state.channels[t().id]?.message_count ?? t().message_count ?? 0} messages</span>
                </button>
              )}
            </Show>
            <Show when={msg().reactions?.length}>
              <Reactions msg={msg()} />
            </Show>
            <Show when={msg()._failed}>
              <div class="failed-actions small">
                Failed to send.
                <button class="link-button" onClick={retry}>Retry</button>
                <button class="link-button" onClick={() => discardFailed(msg().channel_id, msg().nonce!)}>Supprimer</button>
              </div>
            </Show>
          </div>
        </div>

        <Show when={!msg()._pending && !msg()._failed && !editing()}>
          <div class="message-toolbar" classList={{ open: picker() }}>
            <For each={QUICK_REACTIONS.slice(0, 3)}>
              {(e) => (
                <button class="toolbar-emoji" title={`React ${e}`} onClick={() => react({ id: null, name: e })}>{e}</button>
              )}
            </For>
            <button ref={pickerButton} class="icon-button" title="Add reaction" onClick={() => setPicker(!picker())}>
              <Icon name="smile" size={18} />
            </button>
            <button
              class="icon-button"
              title="Reply"
              onClick={() => setUi("replyTo", msg().channel_id, { messageId: msg().id, mention: !mine() })}
            >
              <Icon name="reply" size={18} />
            </button>
            <Show when={mine()}>
              <button class="icon-button" title="Modifier" onClick={() => setUi("editingId", msg().id)}>
                <Icon name="edit" size={18} />
              </button>
            </Show>
            <Show when={mine() || canManage()}>
              <button class="icon-button danger" title="Delete (Shift+click: no confirmation)" onClick={remove}>
                <Icon name="trash" size={18} />
              </button>
            </Show>
            <button class="icon-button" title="Copy text" onClick={() => navigator.clipboard.writeText(msg().content)}>
              <Icon name="copy" size={18} />
            </button>
            <Show when={picker()}>
              <EmojiPicker anchor={pickerButton} guildId={msg().guild_id} onPick={react} onClose={() => setPicker(false)} />
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

