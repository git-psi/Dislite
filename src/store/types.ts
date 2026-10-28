// Sous-ensemble des objets Discord utilisés par l'interface.
// Les champs non listés sont conservés tels quels mais non typés.

export type Snowflake = string;

export interface User {
  id: Snowflake;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  premium_type?: number;
}

export interface Role {
  id: Snowflake;
  name: string;
  color: number;
  colors?: { primary_color: number };
  position: number;
  permissions: string;
  hoist: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
}

export interface Emoji {
  id: Snowflake | null;
  name: string;
  animated?: boolean;
  available?: boolean;
}

export interface Guild {
  id: Snowflake;
  name: string;
  icon: string | null;
  banner?: string | null;
  owner_id: Snowflake;
  features: string[];
  roles: Record<Snowflake, Role>;
  emojis: Emoji[];
  member_count?: number;
  /** date d'arrivée sur le serveur */
  joined_at?: string;
  rules_channel_id?: Snowflake | null;
  system_channel_id?: Snowflake | null;
  default_message_notifications?: number;
  unavailable?: boolean;
}

export interface Overwrite {
  id: Snowflake;
  type: 0 | 1; // 0 rôle, 1 membre
  allow: string;
  deny: string;
}

export interface ForumTag {
  id: Snowflake;
  name: string;
  emoji_id?: Snowflake | null;
  emoji_name?: string | null;
}

export interface Channel {
  id: Snowflake;
  type: number;
  /** permissions calculées lors de l'instantané (avant READY, rôles inconnus) */
  _perms?: string;
  guild_id?: Snowflake;
  name?: string;
  topic?: string | null;
  position?: number;
  parent_id?: Snowflake | null;
  permission_overwrites?: Overwrite[];
  last_message_id?: Snowflake | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  // MP / groupes
  recipient_ids?: Snowflake[];
  icon?: string | null;
  owner_id?: Snowflake;
  // fils
  thread_metadata?: { archived: boolean; locked?: boolean; archive_timestamp?: string };
  message_count?: number;
  member_count?: number;
  applied_tags?: Snowflake[];
  flags?: number;
  // forums
  available_tags?: ForumTag[];
  default_reaction_emoji?: { emoji_id: Snowflake | null; emoji_name: string | null } | null;
}

export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  Category: 4,
  Announcement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  Stage: 13,
  Directory: 14,
  Forum: 15,
  Media: 16,
} as const;

export const isThread = (c?: Channel) => !!c && c.type >= 10 && c.type <= 12;
export const isTextLike = (c?: Channel) =>
  !!c && (c.type === 0 || c.type === 5 || c.type === 1 || c.type === 3 || isThread(c));
export const isForumLike = (c?: Channel) => !!c && (c.type === 15 || c.type === 16);
export const isVoiceLike = (c?: Channel) => !!c && (c.type === 2 || c.type === 13);

export interface Member {
  user_id: Snowflake;
  nick?: string | null;
  avatar?: string | null;
  roles: Snowflake[];
  joined_at?: string;
  communication_disabled_until?: string | null;
}

export interface Activity {
  type: number;
  name: string;
  state?: string | null;
  details?: string | null;
  emoji?: Emoji | null;
}

export type Status = "online" | "idle" | "dnd" | "offline" | "invisible";

export interface Presence {
  status: Status;
  activities: Activity[];
}

/** Présence dans un salon vocal ou un appel (guild_id null = MP / groupe). */
export interface VoiceState {
  user_id: Snowflake;
  guild_id: Snowflake | null;
  channel_id: Snowflake;
  session_id?: string;
  self_mute: boolean;
  self_deaf: boolean;
  mute: boolean;
  deaf: boolean;
  self_stream?: boolean;
  self_video?: boolean;
}

/** Appel en cours dans un MP ou un groupe. */
export interface Call {
  channel_id: Snowflake;
  /** personnes que l'appel fait sonner */
  ringing: Snowflake[];
}

export interface Relationship {
  id: Snowflake;
  type: 1 | 2 | 3 | 4 | 5 | 6; // ami, bloqué, reçue, envoyée, implicite, suggestion
  nickname?: string | null;
}

export interface ReadState {
  last_message_id: Snowflake | null;
  mention_count: number;
}

export interface ChannelOverride {
  muted: boolean;
  message_notifications: number;
}

export interface GuildSettings {
  muted: boolean;
  message_notifications: number;
  suppress_everyone: boolean;
  suppress_roles: boolean;
  channels: Record<Snowflake, ChannelOverride>;
}

export interface Attachment {
  id: Snowflake;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type?: string;
  width?: number | null;
  height?: number | null;
  description?: string;
}

export interface EmbedMedia {
  url: string;
  proxy_url?: string;
  width?: number;
  height?: number;
}

export interface Embed {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; url?: string; icon_url?: string; proxy_icon_url?: string };
  provider?: { name?: string; url?: string };
  footer?: { text: string; icon_url?: string; proxy_icon_url?: string };
  image?: EmbedMedia;
  thumbnail?: EmbedMedia;
  video?: EmbedMedia;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface Reaction {
  emoji: Emoji;
  count: number;
  me: boolean;
  me_burst?: boolean;
  count_details?: { normal: number; burst: number };
}

export interface StickerItem {
  id: Snowflake;
  name: string;
  format_type: number;
}

export interface Poll {
  question: { text?: string };
  answers: { answer_id: number; poll_media: { text?: string; emoji?: Emoji | null } }[];
  expiry?: string | null;
  allow_multiselect?: boolean;
  results?: { is_finalized?: boolean; answer_counts: { id: number; count: number; me_voted: boolean }[] };
}

export interface Message {
  id: Snowflake;
  channel_id: Snowflake;
  guild_id?: Snowflake;
  author: User;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  type: number;
  flags?: number;
  pinned?: boolean;
  mention_everyone?: boolean;
  mentions: User[];
  mention_roles: Snowflake[];
  attachments: Attachment[];
  embeds: Embed[];
  reactions?: Reaction[];
  sticker_items?: StickerItem[];
  message_reference?: { message_id?: Snowflake; channel_id?: Snowflake; guild_id?: Snowflake };
  referenced_message?: Message | null;
  thread?: Channel;
  poll?: Poll;
  /** boutons, menus et blocs des messages d'applications (bots) */
  components?: any[];
  application_id?: Snowflake;
  webhook_id?: Snowflake;
  /** messages transférés : contenu d'origine figé */
  message_snapshots?: { message: Pick<Message, "content" | "attachments" | "embeds" | "timestamp"> & { sticker_items?: StickerItem[] } }[];
  nonce?: string;
  // état local
  _pending?: boolean;
  _failed?: boolean;
}

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  /** historique chargé autour d'un ancien message : la fin du salon n'est pas en mémoire */
  detached?: boolean;
  /** messages repris de l'instantané local : affichés tout de suite, rafraîchis à l'ouverture */
  stale?: boolean;
}

export type GuildListItem =
  | { kind: "guild"; id: Snowflake }
  | { kind: "folder"; id: string; name: string | null; color: number | null; guildIds: Snowflake[] };

export type MemberListItem =
  | { kind: "group"; id: string; count: number }
  | { kind: "member"; userId: Snowflake };

export interface MemberList {
  id: string;
  memberCount: number;
  onlineCount: number;
  items: (MemberListItem | null)[];
}

export interface ForumThreads {
  threadIds: Snowflake[];
  firstMessages: Record<Snowflake, Message>;
  hasMore: boolean;
  loading: boolean;
}

export type ConnectionState = "idle" | "connecting" | "resuming" | "reconnecting" | "connected" | "disconnected";
