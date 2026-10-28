// Mode démo (dev uniquement) : serveurs, personnes et messages inventés, pour les captures du
// README sans montrer de vraies conversations. Rien n'est envoyé (gateway débranchée, lecture
// seule) ni enregistré (pas d'instantané). Recharger la page rend la vraie session.

import { batch } from "solid-js";
import { stopGateway } from "../gateway/client";
import { devFlags } from "../lib/devFlags";
import { DISCORD_EPOCH } from "../lib/snowflake";
import {
  addFetchedMessages,
  loadGuild,
  normalizeChannel,
  putChannel,
  putPresence,
  putUsers,
  putVoiceState,
} from "../store/mutations";
import { resetState, setState, state } from "../store/state";
import { HOME, setUi } from "../store/ui";

// ---------------------------------------------------------------- identifiants et images

const now = Date.now();
let seq = 0;
/** Snowflake d'il y a `minutes` (unique, croissant à minute égale). */
const at = (minutes: number) => ((BigInt(now - minutes * 60_000 - DISCORD_EPOCH) << 22n) + BigInt(++seq)).toString();
/** Identifiants stables pour ce qui n'a pas de date (salons, rôles…). */
const id = () => at(60 * 24 * 400);

const svg = (body: string, viewBox = "0 0 64 64") =>
  "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`);

const gradient = (a: string, b: string) =>
  `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='64' height='64' fill='url(#g)'/>`;

const letter = (text: string, size = 28) =>
  `<text x='32' y='${32 + size * 0.36}' font-family='Segoe UI, Inter, sans-serif' font-size='${size}' font-weight='600' fill='white' fill-opacity='.92' text-anchor='middle'>${text}</text>`;

const avatar = (initial: string, a: string, b: string) => svg(gradient(a, b) + letter(initial));
const icon = (text: string, a: string, b: string) => svg(gradient(a, b) + letter(text, 22));

/** Photo de paysage (crête au coucher du soleil), en vectoriel. */
const ridge = svg(
  `<defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#2b2d55'/><stop offset='.55' stop-color='#b4607a'/><stop offset='1' stop-color='#f0a868'/></linearGradient></defs>` +
    `<rect width='640' height='360' fill='url(#sky)'/>` +
    `<circle cx='452' cy='212' r='34' fill='#ffd9a0' fill-opacity='.9'/>` +
    `<path d='M0 250 L90 200 L170 236 L260 168 L340 222 L430 186 L520 238 L640 196 L640 360 L0 360 Z' fill='#4a3a5c'/>` +
    `<path d='M0 300 L120 248 L210 286 L320 236 L420 290 L530 254 L640 288 L640 360 L0 360 Z' fill='#2d2440'/>`,
  "0 0 640 360",
);

// ---------------------------------------------------------------- personnes

const user = (username: string, name: string, colors: [string, string]) => ({
  id: id(),
  username,
  global_name: name,
  discriminator: "0",
  avatar: avatar(name[0], ...colors),
});

const me = user("alex", "Alex", ["#7c6cf0", "#b08cf7"]);
const lea = user("lea.dev", "Léa", ["#e8875a", "#f0b26a"]);
const marco = user("marco", "Marco", ["#4f9a8a", "#86c9a5"]);
const ines = user("ines", "Inès", ["#c9628f", "#e79ab4"]);
const tom = user("tom_k", "Tom", ["#4a78c2", "#7fa9e6"]);
const nora = user("nora", "Nora", ["#6a8f3c", "#a6c56b"]);
const yanis = user("yanis", "Yanis", ["#b5833a", "#e2b864"]);
const hugo = user("hugo", "Hugo", ["#5b5e70", "#8a8ca0"]);
const sarah = user("sarah", "Sarah", ["#8a5bb5", "#b58ce0"]);
const sam = user("sam.codes", "Sam", ["#3f8fa8", "#79c3d6"]);
const people = [me, lea, marco, ines, tom, nora, yanis, hugo, sarah, sam];

// ---------------------------------------------------------------- messages

type Raw = Record<string, any>;
const message = (channel: Raw, author: Raw, minutes: number, content: string, extra: Raw = {}): Raw => {
  const mid = at(minutes);
  return {
    id: mid,
    channel_id: channel.id,
    guild_id: channel.guild_id,
    author,
    content,
    timestamp: new Date(now - minutes * 60_000).toISOString(),
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    pinned: false,
    tts: false,
    type: 0,
    flags: 0,
    ...extra,
  };
};
const reply = (to: Raw) => ({
  type: 19,
  message_reference: { channel_id: to.channel_id, message_id: to.id, guild_id: to.guild_id },
  referenced_message: to,
});
const reactions = (...list: [string, number, boolean][]) =>
  list.map(([name, count, mine]) => ({ emoji: { id: null, name }, count, me: mine, count_details: { normal: count, burst: 0 } }));

// ---------------------------------------------------------------- serveurs

const P = (...bits: number[]) => bits.reduce((p, b) => p | (1n << BigInt(b)), 0n).toString();
/** voir, envoyer, historique, réactions, liens, fichiers, rejoindre / parler, fils */
const EVERYONE = P(10, 11, 16, 6, 14, 15, 20, 21, 25, 35, 38);

function guild(name: string, iconText: string, colors: [string, string], build: (g: Raw) => Raw[]) {
  const g: Raw = { id: id(), name, owner_id: lea.id, features: [], member_count: 0 };
  g.icon = icon(iconText, ...colors);
  g.roles = [{ id: g.id, name: "@everyone", color: 0, position: 0, permissions: EVERYONE, hoist: false }];
  g.channels = build(g).map((c, i) => ({ position: i, permission_overwrites: [], ...c, guild_id: g.id }));
  return g;
}
const channel = (type: number, name: string, extra: Raw = {}): Raw => ({ id: id(), type, name, ...extra });

export async function startDemo() {
  devFlags.demo = true;
  devFlags.readOnly = true;
  await stopGateway();

  // Atelier principal, celui des captures.
  let general: Raw = {}, help: Raw = {}, showcase: Raw = {}, lounge: Raw = {}, info: Raw = {}, talk: Raw = {}, voice: Raw = {};
  const maintainer = id();
  const rust = guild("Rust Workshop", "Rs", ["#d06a3a", "#e9a15a"], () => {
    info = channel(4, "Info");
    talk = channel(4, "Talk");
    voice = channel(4, "Voice");
    general = channel(0, "general", { parent_id: talk.id, topic: "Rust, Tauri and everything in between" });
    help = channel(0, "help", { parent_id: talk.id, topic: "Ask anything, no question is too small" });
    showcase = channel(15, "showcase", {
      parent_id: talk.id,
      topic: "Show what you built",
      available_tags: [
        { id: id(), name: "app", emoji_name: "📦" },
        { id: id(), name: "game", emoji_name: "🎮" },
        { id: id(), name: "tool", emoji_name: "🔧" },
      ],
    });
    lounge = channel(2, "Lounge", { parent_id: voice.id, bitrate: 64000 });
    return [
      info,
      channel(5, "announcements", { parent_id: info.id }),
      channel(0, "rules", { parent_id: info.id }),
      talk,
      general,
      help,
      channel(0, "off-topic", { parent_id: talk.id }),
      showcase,
      voice,
      lounge,
      channel(2, "Pairing", { parent_id: voice.id }),
    ];
  });
  rust.roles.push(
    { id: maintainer, name: "Maintainers", color: 0xe8a35a, position: 2, permissions: "0", hoist: true },
    { id: id(), name: "Members", color: 0x8fb4e6, position: 1, permissions: "0", hoist: false },
  );
  const memberRole = rust.roles[2].id;
  rust.members = people
    .filter((u) => u !== sam)
    .map((u) => ({ user: u, roles: u === lea ? [maintainer] : [memberRole], nick: null, joined_at: new Date(now - 9e9).toISOString() }));
  rust.member_count = 1284;

  const simple = (name: string, text: string, colors: [string, string], channels: string[]) =>
    guild(name, text, colors, () => channels.map((n) => channel(0, n)));
  const pixel = simple("Pixel Club", "Px", ["#4a78c2", "#8a6cf0"], ["general", "wip", "palettes"]);
  const games = simple("Game Night", "GN", ["#3f9a6a", "#7cc79a"], ["general", "lfg", "screenshots"]);
  const photo = simple("Photo Walks", "Ph", ["#b5536f", "#e58f8f"], ["general", "gear", "this-week"]);
  const oss = simple("Open Source Lounge", "OS", ["#5b5e70", "#9a9cb0"], ["general", "releases"]);
  const guilds = [rust, pixel, games, photo, oss];

  // Messages de #general.
  const g = general;
  const m1 = message(g, lea, 52, "Has anyone tried Tauri 2 on Wayland yet?");
  const m2 = message(g, marco, 49, "Yes, works fine with WebKitGTK. Just watch out for the DMA-BUF renderer on NVIDIA.", reply(m1));
  const m3 = message(g, marco, 49, "And the whole installer is 4 MB 🎉", { reactions: reactions(["🎉", 4, true], ["🔥", 2, false]) });
  const m4 = message(g, ines, 41, "The command for the release build:\n```sh\nnpm run tauri build\n```");
  const m5 = message(g, yanis, 33, "Sunset from the ridge last weekend:", {
    attachments: [{ id: id(), filename: "ridge.svg", content_type: "image/svg+xml", size: 2048, url: ridge, proxy_url: ridge, width: 640, height: 360 }],
  });
  const m6 = message(g, tom, 31, "wow, where is that? 😄", { reactions: reactions(["😍", 3, false]) });
  const m7 = message(g, nora, 12, "Echo cancellation works great btw, nobody hears themselves anymore");
  const m8 = message(g, lea, 4, `<@${me.id}> can you show a demo on Friday?`, { mentions: [me] });
  const generalMessages = [m1, m2, m3, m4, m5, m6, m7, m8];

  const h = help;
  const helpMessages = [
    message(h, sam, 80, "How do I keep a websocket alive in tokio without blocking the UI thread?"),
    message(h, marco, 74, "Spawn it on the async runtime and talk to it through a channel, the UI only gets events."),
    message(h, tom, 8, `<@${me.id}> you did that for the voice engine, right?`, { mentions: [me] }),
  ];

  // Forum #showcase : quelques posts, dont deux nouveaux.
  const tags = showcase.available_tags;
  const post = (author: Raw, minutes: number, name: string, tag: Raw, count: number, text: string, lastMinutes = minutes) => {
    const tid = at(minutes);
    const t = {
      id: tid, type: 11, name, parent_id: showcase.id, guild_id: rust.id, owner_id: author.id,
      applied_tags: [tag.id], message_count: count, last_message_id: at(lastMinutes),
      thread_metadata: { archived: false, locked: false, archive_timestamp: new Date(now).toISOString() },
    };
    const first = message({ id: tid, guild_id: rust.id }, author, minutes, text);
    first.id = tid;
    return { t, first };
  };
  const posts = [
    post(yanis, 20, "Weekend ray tracer, now with soft shadows", tags[1], 6, "Finally got soft shadows working. 40 fps on my laptop, no GPU tricks yet."),
    post(ines, 95, "Sprite editor in egui", tags[2], 14, "Small pixel-art editor, layers and onion skin. Feedback welcome!", 15),
    post(me, 60 * 26, "Dislite: a light Discord client", tags[0], 31, "Tauri + SolidJS, native voice, starts in a second."),
    post(hugo, 60 * 50, "Tiling WM config, round 3", tags[2], 9, "Rewrote my bar from scratch, it only shows up when needed."),
  ];

  // MP.
  const dm = (u: Raw, extra: Raw = {}) => ({ id: id(), type: 1, recipients: [u], ...extra });
  const dmLea = dm(lea), dmTom = dm(tom), dmNora = dm(nora);
  const group = { id: id(), type: 3, name: "weekend trip", recipients: [marco, tom, nora] };
  const dmMessages = [
    message(dmLea, lea, 30, "are you coming saturday?"),
    message(dmLea, me, 26, "yes! I'll bring the board games"),
    message(dmLea, lea, 3, "perfect, see you there"),
  ];
  const groupMessages = [message(group, marco, 18, "I can drive, 3 seats left"), message(group, nora, 15, "count me in")];

  batch(() => {
    resetState();
    putUsers(people);
    setState("meId", me.id);
    for (const gd of guilds) loadGuild(gd);
    setState("guildOrder", guilds.map((x) => ({ kind: "guild" as const, id: x.id })));

    const privates = [dmLea, group, dmTom, dmNora].map((c) => normalizeChannel(c));
    setState("channels", (map) => ({ ...map, ...Object.fromEntries(privates.map((c) => [c.id, c])) }));
    setState("privateChannelIds", privates.map((c) => c.id));

    // Messages et derniers messages des salons.
    const fill = (c: Raw, list: Raw[]) => {
      addFetchedMessages(c.id, [...list].reverse(), false, false);
      setState("channels", c.id, "last_message_id", list[list.length - 1].id);
    };
    fill(general, generalMessages);
    fill(help, helpMessages);
    fill(dmLea, dmMessages);
    fill(group, groupMessages);
    fill(dmTom, [message(dmTom, tom, 60 * 20, "sounds good")]);
    fill(dmNora, [message(dmNora, nora, 60 * 30, "hello!")]);
    // Quelques salons d'autres serveurs avec du neuf.
    for (const [gd, minutes] of [[games, 6], [pixel, 90]] as const) {
      const c = gd.channels[0];
      fill(c, [message(c, tom, minutes, "anyone around tonight?")]);
    }

    // Lu jusqu'à un certain point : séparateur « nouveaux » et non-lus crédibles.
    const read = (c: Raw, upTo: Raw | null, mentions = 0) =>
      setState("readStates", c.id, { last_message_id: upTo?.id ?? at(60 * 24 * 300), mention_count: mentions });
    read(general, m6);
    read(help, helpMessages[1], 1);
    read(dmLea, dmMessages[1], 1);
    read(group, groupMessages[1]);
    read(dmTom, { id: state.channels[dmTom.id].last_message_id });
    read(dmNora, { id: state.channels[dmNora.id].last_message_id });
    read(games.channels[0], null);
    read(pixel.channels[0], null);
    read(showcase, { id: at(60 * 6) });
    for (const gd of guilds) for (const c of gd.channels) if (c.type === 0 && !["general", "help"].includes(c.name)) read(c, null);

    // Forum.
    for (const p of posts) putChannel(p.t, rust.id);
    setState("channels", showcase.id, "last_message_id", posts[0].t.id);
    setState("joinedThreads", posts[2].t.id, true);
    setState("readStates", posts[2].t.id, { last_message_id: posts[2].t.last_message_id, mention_count: 0 });
    setState("forums", showcase.id, {
      threadIds: posts.map((p) => p.t.id),
      firstMessages: Object.fromEntries(posts.map((p) => [p.t.id, p.first as any])),
      hasMore: false,
      loading: false,
    });

    // Amis, demande reçue, présences.
    const friends = [lea, marco, ines, tom, nora, yanis, hugo, sarah];
    setState("relationships", {
      ...Object.fromEntries(friends.map((u) => [u.id, { id: u.id, type: 1, nickname: null }])),
      [sam.id]: { id: sam.id, type: 3, nickname: null },
    });
    putPresence(me.id, { status: "online" });
    putPresence(lea.id, { status: "online", activities: [{ type: 0, name: "Factorio" }] });
    putPresence(marco.id, { status: "idle" });
    putPresence(ines.id, { status: "dnd", activities: [{ type: 4, name: "Custom Status", state: "deep in a refactor" }] });
    putPresence(tom.id, { status: "online" });
    putPresence(nora.id, { status: "online", activities: [{ type: 2, name: "Spotify", details: "Lo-fi beats" }] });
    putPresence(yanis.id, { status: "online" });

    // Liste des membres de l'atelier.
    const online = [marco, ines, tom, me, yanis, nora];
    setState("memberLists", rust.id, {
      id: "everyone",
      memberCount: 1284,
      onlineCount: 312,
      items: [
        { kind: "group", id: maintainer, count: 1 },
        { kind: "member", userId: lea.id },
        { kind: "group", id: "online", count: 311 },
        ...online.map((u) => ({ kind: "member" as const, userId: u.id })),
        { kind: "group", id: "offline", count: 972 },
        { kind: "member", userId: hugo.id },
        { kind: "member", userId: sarah.id },
      ],
    });

    // Salon vocal occupé.
    for (const [u, mute] of [[lea, false], [marco, true]] as const) {
      putVoiceState({ user_id: u.id, channel_id: lounge.id, guild_id: rust.id, session_id: id(), self_mute: mute, self_deaf: false, mute: false, deaf: false }, rust.id);
    }

    // Quelqu'un écrit dans #general.
    setState("typing", general.id, { [ines.id]: Date.now() + 10 * 60_000 });

    setState("status", "online");
    setState("connection", "connected");
    setState("ready", true);
  });

  setUi("guildId", rust.id);
  setUi("channelByGuild", rust.id, general.id);
  setUi("channelByGuild", HOME, null);
  setUi("homePage", "home");
  return { guildId: rust.id, general: general.id, help: help.id, showcase: showcase.id, dm: dmLea.id, lounge: lounge.id, me: me.id };
}
