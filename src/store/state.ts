// État global de la session Discord, alimenté par les événements de la gateway.
// Les composants lisent ce store ; seuls les handlers de gateway et les actions l'écrivent.

import { createStore, reconcile } from "solid-js/store";
import type {
  Call,
  Channel,
  ChannelMessages,
  ConnectionState,
  ForumThreads,
  Guild,
  GuildListItem,
  GuildSettings,
  Member,
  MemberList,
  Presence,
  ReadState,
  Relationship,
  Snowflake,
  Status,
  User,
  VoiceState,
} from "./types";

export interface SessionState {
  connection: ConnectionState;
  ready: boolean;
  /** interface affichée depuis l'instantané local, en attendant READY */
  cached: boolean;
  meId: Snowflake | null;
  status: Status;
  customStatus: string | null;

  users: Record<Snowflake, User>;
  guilds: Record<Snowflake, Guild>;
  guildOrder: GuildListItem[];
  channels: Record<Snowflake, Channel>;
  /** guild -> ids des salons (hors fils) */
  guildChannels: Record<Snowflake, Snowflake[]>;
  /** salon parent -> ids des fils actifs connus */
  threads: Record<Snowflake, Snowflake[]>;
  /** fils dont l'utilisateur est membre */
  joinedThreads: Record<Snowflake, true>;
  privateChannelIds: Snowflake[];

  /** guild -> user -> membre */
  members: Record<Snowflake, Record<Snowflake, Member>>;
  presences: Record<Snowflake, Presence>;
  relationships: Record<Snowflake, Relationship>;
  readStates: Record<Snowflake, ReadState>;
  guildSettings: Record<Snowflake, GuildSettings>;

  messages: Record<Snowflake, ChannelMessages>;
  /** salon -> user -> expiration (ms) */
  typing: Record<Snowflake, Record<Snowflake, number>>;
  /** guild -> liste de membres affichée */
  memberLists: Record<Snowflake, MemberList>;
  forums: Record<Snowflake, ForumThreads>;
  /** session de la gateway principale (pour reconnaître nos propres états vocaux) */
  sessionId: string | null;
  /** « guild:user » -> état vocal ; une personne n'est que dans un salon à la fois par serveur */
  voiceStates: Record<string, VoiceState>;
  /** salon vocal -> personnes présentes (index pour un affichage sans balayage) */
  voiceChannels: Record<Snowflake, Snowflake[]>;
  /** MP / groupe -> appel en cours */
  calls: Record<Snowflake, Call>;
}

export const initialState = (): SessionState => ({
  connection: "idle",
  ready: false,
  cached: false,
  meId: null,
  status: "online",
  customStatus: null,
  users: {},
  guilds: {},
  guildOrder: [],
  channels: {},
  guildChannels: {},
  threads: {},
  joinedThreads: {},
  privateChannelIds: [],
  members: {},
  presences: {},
  relationships: {},
  readStates: {},
  guildSettings: {},
  messages: {},
  typing: {},
  memberLists: {},
  forums: {},
  sessionId: null,
  voiceStates: {},
  voiceChannels: {},
  calls: {},
});

export const [state, setState] = createStore<SessionState>(initialState());

export const me = () => (state.meId ? state.users[state.meId] : undefined);

export function resetState() {
  // reconcile remplace intégralement (setState fusionnerait les objets).
  setState(reconcile(initialState()));
}
