import { createEffect, createSignal, For, on, Show } from "solid-js";
import { createForumPost, loadForumThreads } from "../../actions/forums";
import { openChannel } from "../../actions/navigation";
import { emojiUrl } from "../../lib/cdn";
import { P } from "../../lib/permissions";
import { relativeTime } from "../../lib/time";
import { snowflakeTime } from "../../lib/snowflake";
import { can, displayName, isUnread } from "../../store/selectors";
import { state } from "../../store/state";
import type { Channel, ForumTag, Snowflake } from "../../store/types";
import { Avatar } from "../common/Avatar";
import { Icon } from "../common/Icon";
import { Markdown } from "../common/Markdown";

function TagChip(props: { tag: ForumTag; selected?: boolean; onClick?: () => void }) {
  return (
    <button class="tag-chip" classList={{ selected: !!props.selected, static: !props.onClick }} onClick={props.onClick}>
      <Show when={props.tag.emoji_id} fallback={<Show when={props.tag.emoji_name}><span>{props.tag.emoji_name}</span></Show>}>
        <img src={emojiUrl(props.tag.emoji_id!, false, 32)} alt="" />
      </Show>
      {props.tag.name}
    </button>
  );
}

function PostCard(props: { thread: Channel; forum: Channel }) {
  const first = () => state.forums[props.forum.id]?.firstMessages[props.thread.id];
  const tags = () => (props.forum.available_tags ?? []).filter((t) => props.thread.applied_tags?.includes(t.id));
  const lastActivity = () => snowflakeTime(props.thread.last_message_id ?? props.thread.id);
  const image = () => first()?.attachments.find((a) => a.content_type?.startsWith("image/"));

  return (
    <button class="post-card" classList={{ unread: isUnread(props.thread.id) }} onClick={() => openChannel(props.thread.id)}>
      <div class="post-main">
        <Show when={tags().length}>
          <div class="post-tags"><For each={tags()}>{(t) => <TagChip tag={t} />}</For></div>
        </Show>
        <h3 class="post-title">{props.thread.name}</h3>
        <Show when={first()}>
          {(m) => (
            <div class="post-snippet">
              <b>{displayName(m().author.id, props.forum.guild_id)} : </b>
              <Markdown content={m().content.slice(0, 200)} guildId={props.forum.guild_id} inline />
            </div>
          )}
        </Show>
        <div class="post-meta small muted">
          <Show when={props.thread.owner_id}>
            {(id) => <Avatar userId={id()} guildId={props.forum.guild_id} size={16} />}
          </Show>
          <Icon name="thread" size={14} /> {props.thread.message_count ?? 0}
          <span>•</span>
          <span>{relativeTime(lastActivity())}</span>
          <Show when={props.thread.thread_metadata?.archived}><span>• archived</span></Show>
        </div>
      </div>
      <Show when={image()}>
        {(img) => <img class="post-thumb" src={`${img().proxy_url}?width=160&height=160`} alt="" loading="lazy" />}
      </Show>
    </button>
  );
}

function NewPostForm(props: { forum: Channel; onDone: () => void }) {
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [tags, setTags] = createSignal<Snowflake[]>([]);
  const [busy, setBusy] = createSignal(false);

  const toggleTag = (id: Snowflake) => setTags(tags().includes(id) ? tags().filter((t) => t !== id) : [...tags(), id].slice(0, 5));
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!title().trim() || !content().trim()) return;
    setBusy(true);
    if (await createForumPost(props.forum.id, title().trim(), content(), tags())) props.onDone();
    setBusy(false);
  };

  return (
    <form class="new-post" onSubmit={submit}>
      <input placeholder="Post title" value={title()} maxLength={100} onInput={(e) => setTitle(e.currentTarget.value)} autofocus />
      <textarea placeholder="Message content" rows={4} value={content()} onInput={(e) => setContent(e.currentTarget.value)} />
      <Show when={props.forum.available_tags?.length}>
        <div class="post-tags">
          <For each={props.forum.available_tags}>{(t) => <TagChip tag={t} selected={tags().includes(t.id)} onClick={() => toggleTag(t.id)} />}</For>
        </div>
      </Show>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>Cancel</button>
        <button type="submit" class="btn primary" disabled={busy() || !title().trim() || !content().trim()}>Publish</button>
      </div>
    </form>
  );
}

export function ForumView(props: { channelId: Snowflake }) {
  const forum = () => state.channels[props.channelId];
  const data = () => state.forums[props.channelId];
  const [composing, setComposing] = createSignal(false);
  const [filter, setFilter] = createSignal<Snowflake | null>(null);

  createEffect(on(() => props.channelId, (id) => {
    setComposing(false);
    setFilter(null);
    if (!state.forums[id]) void loadForumThreads(id);
  }));

  const threads = () =>
    (data()?.threadIds ?? [])
      .map((id) => state.channels[id])
      .filter((t): t is Channel => !!t && (!filter() || !!t.applied_tags?.includes(filter()!)));

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) void loadForumThreads(props.channelId, true);
  };

  return (
    <div class="channel-view">
      <header class="channel-header">
        <Icon name="forum" size={22} class="muted" />
        <h1 class="channel-title ellipsis">{forum()?.name}</h1>
        <Show when={forum()?.topic}>
          <span class="header-divider" />
          <div class="channel-topic ellipsis"><Markdown content={forum()!.topic!} inline guildId={forum()?.guild_id} /></div>
        </Show>
      </header>
      <div class="forum-scroll" onScroll={onScroll}>
        <div class="forum-toolbar">
          <Show when={forum()?.available_tags?.length}>
            <div class="post-tags">
              <For each={forum()!.available_tags}>
                {(t) => <TagChip tag={t} selected={filter() === t.id} onClick={() => setFilter(filter() === t.id ? null : t.id)} />}
              </For>
            </div>
          </Show>
          <Show when={can(props.channelId, P.SEND_MESSAGES) && !composing()}>
            <button class="btn primary" onClick={() => setComposing(true)}>
              <Icon name="plus" size={16} /> New post
            </button>
          </Show>
        </div>
        <Show when={composing() && forum()}>
          <NewPostForm forum={forum()!} onDone={() => setComposing(false)} />
        </Show>
        <div class="post-list">
          <For each={threads()}>{(t) => <PostCard thread={t} forum={forum()!} />}</For>
        </div>
        <Show when={data()?.loading}>
          <div class="history-loader"><div class="spinner" /></div>
        </Show>
        <Show when={!data()?.loading && !threads().length}>
          <p class="empty muted">No posts yet.</p>
        </Show>
      </div>
    </div>
  );
}
