// Fiche de profil : identité, actions, puis sections courtes (à propos, dates, rôles,
// en commun, note). Le profil complet est chargé une fois par session (voir actions/profiles).

import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { selectGuild } from "../../actions/navigation";
import { loadNote, loadProfile, profileOf, saveNote } from "../../actions/profiles";
import { acceptFriend, blockUser, openDm, removeRelationship, sendFriendRequest } from "../../actions/social";
import { guildIconUrl } from "../../lib/cdn";
import { snowflakeTime } from "../../lib/snowflake";
import { customStatusOf, displayName, member, statusOf, userName } from "../../store/selectors";
import { state } from "../../store/state";
import type { Role, Snowflake } from "../../store/types";
import { type ProfileTarget, setUi, toast, ui } from "../../store/ui";
import { Avatar } from "../common/Avatar";
import { openContextMenu } from "../common/ContextMenu";
import { Icon } from "../common/Icon";
import { Markdown } from "../common/Markdown";

const WIDTH = 320;
const MARGIN = 10;

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do not disturb", offline: "Offline" };
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Ouvre la fiche à côté de l'élément cliqué. */
export function openProfile(e: MouseEvent, userId: Snowflake, guildId?: Snowflake) {
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  setUi("profile", { userId, guildId, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
}

function place(rect: ProfileTarget["rect"], height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = rect.right + MARGIN + WIDTH <= vw ? rect.right + MARGIN : Math.max(MARGIN, rect.left - MARGIN - WIDTH);
  const top = Math.min(Math.max(MARGIN, rect.top), vh - height - MARGIN);
  return { left: `${left}px`, top: `${Math.max(MARGIN, top)}px` };
}

function Section(props: { label: string; children: any }) {
  return (
    <section class="pc-section">
      <h3>{props.label}</h3>
      {props.children}
    </section>
  );
}

export function ProfilePopout() {
  let root!: HTMLDivElement;
  const [height, setHeight] = createSignal(380);
  const [mutual, setMutual] = createSignal<"guilds" | "friends" | null>(null);
  const target = () => ui.profile!;
  const uid = () => target().userId;
  const gid = () => target().guildId;
  const user = () => state.users[uid()];
  const entry = () => profileOf(uid(), gid());
  const p = () => entry()?.data;
  const isMe = () => uid() === state.meId;
  const rel = () => state.relationships[uid()];
  const close = () => setUi("profile", null);

  createEffect(
    on(
      () => [uid(), gid()] as const,
      ([u, g]) => {
        setMutual(null);
        void loadProfile(u, g);
        if (u !== state.meId) void loadNote(u, g);
      },
    ),
  );

  onMount(() => {
    const outside = (e: MouseEvent) => !root.contains(e.target as Node) && !(e.target as HTMLElement).closest(".context-menu") && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    setTimeout(() => document.addEventListener("mousedown", outside));
    document.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(() => setHeight(root.offsetHeight));
    ro.observe(root);
    onCleanup(() => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
      ro.disconnect();
    });
  });

  const bio = () => p()?.guildBio ?? p()?.bio;
  const pronouns = () => p()?.guildPronouns ?? p()?.pronouns;
  const statusLine = () => customStatusOf(uid()) ?? STATUS_LABEL[statusOf(uid())];
  const roles = () => {
    const guild = gid() ? state.guilds[gid()!] : undefined;
    const m = gid() ? member(gid(), uid()) : undefined;
    if (!guild || !m) return [] as Role[];
    return m.roles.map((id) => guild.roles[id]).filter(Boolean).sort((a, b) => b.position - a.position);
  };
  const joinedServer = () => {
    const j = gid() ? member(gid(), uid())?.joined_at : undefined;
    return j ? dateFmt.format(new Date(j)) : null;
  };
  const guilds = () => p()?.mutualGuilds ?? [];
  const friends = () => p()?.mutualFriends ?? [];

  const addFriend = async () => {
    const u = user();
    if (!u) return;
    const err = await sendFriendRequest(u.username);
    toast(err ?? `Friend request sent to ${userName(u)}`, !!err);
  };
  const more = (e: MouseEvent) =>
    openContextMenu(e, [
      {
        label: "Copy username",
        action: () => {
          void navigator.clipboard.writeText(user()?.username ?? "");
          toast("Username copied");
        },
      },
      {
        label: "Copy ID",
        action: () => {
          void navigator.clipboard.writeText(uid());
          toast("ID copied");
        },
      },
      ...(isMe()
        ? []
        : [
            "separator" as const,
            ...(rel()?.type === 1 ? [{ label: "Remove friend", danger: true, action: () => void removeRelationship(uid()) }] : []),
            rel()?.type === 2
              ? { label: "Unblock", action: () => void removeRelationship(uid()) }
              : { label: "Block", danger: true, action: () => void blockUser(uid()) },
          ]),
    ]);

  return (
    <Portal>
      <div class="profile-card" ref={root} style={{ width: `${WIDTH}px`, ...place(target().rect, height()) }}>
        <div class="pc-identity">
          <Avatar userId={uid()} guildId={gid()} size={56} status />
          <div class="pc-names">
            <span class="pc-display ellipsis">{displayName(uid(), gid())}</span>
            <span class="pc-username ellipsis">
              {user()?.username}
              <Show when={pronouns()}> · {pronouns()}</Show>
              <Show when={user()?.bot}><span class="bot-tag">BOT</span></Show>
            </span>
            <span class="pc-status ellipsis">{statusLine()}</span>
          </div>
          <button class="icon-button pc-more" title="More" onClick={more}>
            <Icon name="more" size={17} />
          </button>
        </div>

        <Show when={!isMe()}>
          <div class="pc-actions">
            <button class="pc-btn primary" onClick={() => { void openDm(uid()); close(); }}>
              <Icon name="thread" size={15} /> Message
            </button>
            <Show when={!user()?.bot}>
              <Show when={rel()?.type === 3}>
                <button class="pc-btn" onClick={() => void acceptFriend(uid())}>Accept request</button>
              </Show>
              <Show when={!rel()}>
                <button class="pc-btn" onClick={addFriend}>
                  <Icon name="user-plus" size={15} /> Add friend
                </button>
              </Show>
              <Show when={rel()?.type === 4}>
                <span class="pc-state">Request sent</span>
              </Show>
              <Show when={rel()?.type === 1}>
                <span class="pc-state">Friends</span>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={entry()?.loading}>
          <div class="pc-loading">
            <span class="sk sk-line" style={{ width: "80%" }} />
            <span class="sk sk-line" style={{ width: "55%" }} />
          </div>
        </Show>

        <Show when={bio()}>
          <Section label="About">
            <div class="pc-bio markdown"><Markdown content={bio()!} guildId={gid()} jumbo={false} /></div>
          </Section>
        </Show>

        <Section label="Member since">
          <div class="pc-dates">
            <span>Discord</span>
            <span>{dateFmt.format(new Date(snowflakeTime(uid())))}</span>
            <Show when={joinedServer()}>
              <span class="ellipsis">{state.guilds[gid()!]?.name}</span>
              <span>{joinedServer()}</span>
            </Show>
          </div>
        </Section>

        <Show when={roles().length}>
          <Section label="Roles">
            <div class="role-chips">
              <For each={roles()}>
                {(r) => (
                  <span class="role-chip">
                    <span class="role-dot" style={{ background: r.color ? hex(r.color) : "var(--faint)" }} />
                    {r.name}
                  </span>
                )}
              </For>
            </div>
          </Section>
        </Show>

        <Show when={!isMe() && (guilds().length || friends().length)}>
          <Section label="In common">
            <div class="pc-common">
              <Show when={guilds().length}>
                <button classList={{ active: mutual() === "guilds" }} onClick={() => setMutual(mutual() === "guilds" ? null : "guilds")}>
                  {guilds().length} server{guilds().length > 1 ? "s" : ""}
                </button>
              </Show>
              <Show when={friends().length}>
                <button classList={{ active: mutual() === "friends" }} onClick={() => setMutual(mutual() === "friends" ? null : "friends")}>
                  {friends().length} friend{friends().length > 1 ? "s" : ""}
                </button>
              </Show>
            </div>
            <Show when={mutual() === "guilds"}>
              <div class="mutual-list">
                <For each={guilds()}>
                  {(g) => {
                    const guild = () => state.guilds[g.id];
                    return (
                      <button class="mutual-item" onClick={() => { selectGuild(g.id); close(); }}>
                        <Show when={guild() && guildIconUrl(guild()!, 32)} fallback={<span class="mutual-icon" />}>
                          {(src) => <img class="mutual-icon" src={src()} alt="" />}
                        </Show>
                        <span class="ellipsis">{guild()?.name ?? "Server"}</span>
                        <Show when={g.nick}><span class="muted small ellipsis">{g.nick}</span></Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
            <Show when={mutual() === "friends"}>
              <div class="mutual-list">
                <For each={friends()}>
                  {(id) => (
                    <button class="mutual-item" onClick={() => setUi("profile", { ...target(), userId: id, guildId: undefined })}>
                      <Avatar userId={id} size={22} status />
                      <span class="ellipsis">{displayName(id)}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Section>
        </Show>

        <Show when={!isMe()}>
          <Section label="Note">
            <textarea
              class="pc-note"
              rows={1}
              placeholder="Only you can see this"
              value={entry()?.note ?? ""}
              onBlur={(e) => {
                const v = e.currentTarget.value;
                if (v !== (entry()?.note ?? "")) void saveNote(uid(), v);
              }}
            />
          </Section>
        </Show>
      </div>
    </Portal>
  );
}
