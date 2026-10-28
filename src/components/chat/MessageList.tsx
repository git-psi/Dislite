// Liste des messages. Le conteneur est en `column-reverse` : la position
// « en bas » est scrollTop = 0, ce qui garde naturellement le bas collé quand
// des messages arrivent, et la position quand on charge l'historique.

import { createEffect, createMemo, createSignal, ErrorBoundary, For, on, onCleanup, onMount, Show } from "solid-js";
import { reportError } from "../../lib/errors";
import { backToPresent, jumpToMessage, loadMessages } from "../../actions/messages";
import { takeScrollRestore } from "../../actions/navigation";
import { isNewer } from "../../lib/snowflake";
import { isSameDay, dayLabel } from "../../lib/time";
import { channelLabel } from "../../store/selectors";
import { state } from "../../store/state";
import type { Attachment, Message, Snowflake } from "../../store/types";
import { isThread } from "../../store/types";
import { Icon } from "../common/Icon";
import { SkeletonMessages } from "../common/Skeleton";
import { isRegular, MessageItem } from "./MessageItem";

const GROUP_WINDOW_MS = 7 * 60 * 1000;

function isGrouped(prev: Message | undefined, msg: Message) {
  if (!prev || !isRegular(prev) || !isRegular(msg)) return false;
  if (msg.type === 19 || prev.author.id !== msg.author.id) return false;
  return Date.parse(msg.timestamp) - Date.parse(prev.timestamp) < GROUP_WINDOW_MS && isSameDay(prev.timestamp, msg.timestamp);
}

const isImage = (a: Attachment) => (a.content_type ?? "").startsWith("image/");
const hasImages = (m: Message) => !m._pending && !m._failed && m.attachments.some(isImage);

/** Message qui ne contient que des images (rien d'autre à afficher ni à perdre en le fusionnant). */
const imagesOnly = (m: Message) =>
  m.type === 0 &&
  hasImages(m) &&
  m.attachments.every(isImage) &&
  !m.content.trim() &&
  !m.embeds?.length &&
  !m.reactions?.length &&
  !m.sticker_items?.length &&
  !m.message_snapshots?.length &&
  !m.poll &&
  !m.thread;

function ChannelStart(props: { channelId: Snowflake }) {
  const ch = () => state.channels[props.channelId];
  return (
    <div class="channel-start">
      <div class="channel-start-icon"><Icon name={isThread(ch()) ? "thread" : "hash"} size={36} /></div>
      <h2>Welcome to {isThread(ch()) ? "" : "#"}{channelLabel(ch())} !</h2>
      <p class="muted">This is the beginning of the conversation.</p>
    </div>
  );
}

export function MessageList(props: {
  channelId: Snowflake;
  /** dernier message lu à l'ouverture : le séparateur « Nouveaux » se place après */
  unreadAfter?: Snowflake | null;
  scrollerRef: (el: HTMLDivElement) => void;
}) {
  let scroller!: HTMLDivElement;
  const [away, setAway] = createSignal(false);
  const bucket = () => state.messages[props.channelId];
  const items = () => bucket()?.items ?? [];

  const firstUnread = createMemo(() => {
    const after = props.unreadAfter;
    if (!after) return null;
    return items().find((m) => isNewer(m.id, after) && m.author.id !== state.meId && !m._pending)?.id ?? null;
  });

  // Images envoyées en plusieurs messages d'affilée : réunies dans la mosaïque du premier.
  const stacks = createMemo(() => {
    const extra = new Map<Snowflake, Attachment[]>();
    const absorbed = new Set<Snowflake>();
    const list = items();
    let head: Message | null = null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (head && imagesOnly(m) && m.id !== firstUnread() && isGrouped(list[i - 1], m)) {
        extra.set(head.id, [...(extra.get(head.id) ?? []), ...m.attachments]);
        absorbed.add(m.id);
        continue;
      }
      head = hasImages(m) ? m : null;
    }
    return { extra, absorbed };
  });

  const maybeLoadOlder = () => {
    const distanceToTop = scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop;
    if (distanceToTop < 400 && bucket()?.hasMore && !bucket()?.loading) void loadMessages(props.channelId, true);
  };

  const onScroll = () => {
    maybeLoadOlder();
    // column-reverse : scrollTop vaut 0 en bas et devient négatif en remontant.
    setAway(scroller.scrollTop < -600);
  };

  const jumpToBottom = () => {
    if (bucket()?.detached) backToPresent(props.channelId);
    scroller.scrollTo({ top: 0, behavior: "smooth" });
  };
  onMount(() => {
    window.addEventListener("accord:jump-bottom", jumpToBottom);
    onCleanup(() => window.removeEventListener("accord:jump-bottom", jumpToBottom));
  });

  // Nouveau salon : retour en bas. Si la page ne remplit pas l'écran, on charge plus.
  createEffect(
    on(
      () => props.channelId,
      (cid) => {
        const anchor = takeScrollRestore(cid);
        scroller.scrollTop = 0;
        setAway(false);
        // Retour par précédent/suivant : on replace la lecture là où on l'avait laissée.
        if (anchor) setTimeout(() => void jumpToMessage(cid, anchor.mid, { offset: anchor.offset }), 0);
      },
    ),
  );
  createEffect(on(() => items().length, () => queueMicrotask(maybeLoadOlder), { defer: true }));

  return (
    <div
      class="messages-scroller"
      ref={(el) => {
        scroller = el;
        props.scrollerRef(el);
      }}
      onScroll={onScroll}
    >
      <div class="messages-inner">
        {/* Spinner seulement pendant un chargement réel : une animation infinie, même
            hors écran, force WebKitGTK à redessiner en continu (≈40 % de CPU). */}
        {/* Premier chargement : squelette plutôt qu'un écran vide ou un faux début de salon. */}
        <Show
          when={!items().length && (!bucket() || bucket()!.loading)}
          fallback={
            <Show
              when={!bucket()?.hasMore}
              fallback={
                <div class="history-loader">
                  <Show when={bucket()?.loading}>
                    <div class="spinner" />
                  </Show>
                </div>
              }
            >
              <ChannelStart channelId={props.channelId} />
            </Show>
          }
        >
          <SkeletonMessages />
        </Show>
        <For each={items()}>
          {(msg, i) => {
            const prev = () => items()[i() - 1];
            const newDay = () => !prev() || !isSameDay(prev()!.timestamp, msg.timestamp);
            return (
              <Show when={!stacks().absorbed.has(msg.id)}>
                <Show when={newDay()}>
                  <div class="day-divider"><span>{dayLabel(msg.timestamp)}</span></div>
                </Show>
                <Show when={firstUnread() === msg.id}>
                  <div class="unread-divider"><span>New</span></div>
                </Show>
                <ErrorBoundary
                  fallback={(err) => {
                    reportError(`message ${msg.id}`, err);
                    return <div class="message-error">This message couldn't be displayed.</div>;
                  }}
                >
                  <MessageItem msg={msg} grouped={!newDay() && isGrouped(prev(), msg)} extraImages={stacks().extra.get(msg.id)} />
                </ErrorBoundary>
              </Show>
            );
          }}
        </For>
        <div class="messages-end" />
      </div>
      <Show when={away() || bucket()?.detached}>
        <button class="jump-bottom" onClick={jumpToBottom}>
          Jump to present <Icon name="chevron" size={14} />
        </button>
      </Show>
    </div>
  );
}
