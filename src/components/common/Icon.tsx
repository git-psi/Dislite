// Icônes Lucide (lucide-solid : seules les icônes importées sont incluses dans le bundle).

import type { JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
// Import icône par icône : le point d'entrée du paquet en charge des milliers en dev.
import AtSign from "lucide-solid/icons/at-sign";
import Bell from "lucide-solid/icons/bell";
import BellOff from "lucide-solid/icons/bell-off";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Copy from "lucide-solid/icons/copy";
import Download from "lucide-solid/icons/download";
import Ellipsis from "lucide-solid/icons/ellipsis";
import ExternalLink from "lucide-solid/icons/external-link";
import File from "lucide-solid/icons/file";
import Folder from "lucide-solid/icons/folder";
import Hash from "lucide-solid/icons/hash";
import House from "lucide-solid/icons/house";
import Lock from "lucide-solid/icons/lock";
import LogOut from "lucide-solid/icons/log-out";
import Maximize from "lucide-solid/icons/maximize";
import Megaphone from "lucide-solid/icons/megaphone";
import MessageSquareText from "lucide-solid/icons/message-square-text";
import MessagesSquare from "lucide-solid/icons/messages-square";
import Minimize from "lucide-solid/icons/minimize";
import Pause from "lucide-solid/icons/pause";
import Pencil from "lucide-solid/icons/pencil";
import PictureInPicture2 from "lucide-solid/icons/picture-in-picture-2";
import Pin from "lucide-solid/icons/pin";
import Play from "lucide-solid/icons/play";
import Plus from "lucide-solid/icons/plus";
import Radio from "lucide-solid/icons/radio";
import Reply from "lucide-solid/icons/reply";
import ScrollText from "lucide-solid/icons/scroll-text";
import Search from "lucide-solid/icons/search";
import Crown from "lucide-solid/icons/crown";
import Eye from "lucide-solid/icons/eye";
import HeadphoneOff from "lucide-solid/icons/headphone-off";
import Headphones from "lucide-solid/icons/headphones";
import Mic from "lucide-solid/icons/mic";
import MicOff from "lucide-solid/icons/mic-off";
import Phone from "lucide-solid/icons/phone";
import PhoneOff from "lucide-solid/icons/phone-off";
import EyeOff from "lucide-solid/icons/eye-off";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import UserPlus from "lucide-solid/icons/user-plus";
import Settings from "lucide-solid/icons/settings";
import Smile from "lucide-solid/icons/face-slightly-smiling";
import Tag from "lucide-solid/icons/tag";
import Trash2 from "lucide-solid/icons/trash";
import Users from "lucide-solid/icons/users";
import UsersRound from "lucide-solid/icons/users-round";
import Volume2 from "lucide-solid/icons/volume-2";
import VolumeX from "lucide-solid/icons/volume-x";
import X from "lucide-solid/icons/x";

const ICONS = {
  hash: Hash,
  speaker: Volume2,
  megaphone: Megaphone,
  forum: MessagesSquare,
  thread: MessageSquareText,
  stage: Radio,
  rules: ScrollText,
  at: AtSign,
  users: Users,
  friends: UsersRound,
  plus: Plus,
  x: X,
  reply: Reply,
  edit: Pencil,
  trash: Trash2,
  smile: Smile,
  chevron: ChevronDown,
  folder: Folder,
  lock: Lock,
  logout: LogOut,
  file: File,
  download: Download,
  pin: Pin,
  search: Search,
  home: House,
  check: Check,
  more: Ellipsis,
  tag: Tag,
  copy: Copy,
  play: Play,
  external: ExternalLink,
  settings: Settings,
  crown: Crown,
  eye: Eye,
  headphones: Headphones,
  "headphone-off": HeadphoneOff,
  mic: Mic,
  "mic-off": MicOff,
  phone: Phone,
  "phone-off": PhoneOff,
  "eye-off": EyeOff,
  grid: LayoutGrid,
  "user-plus": UserPlus,
  bell: Bell,
  "bell-off": BellOff,
  pause: Pause,
  "volume-off": VolumeX,
  maximize: Maximize,
  minimize: Minimize,
  members: Users,
  mini: PictureInPicture2,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon(props: { name: IconName; size?: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <Dynamic
      component={ICONS[props.name]}
      class={props.class ? `icon ${props.class}` : "icon"}
      style={props.style}
      size={props.size ?? 20}
      stroke-width={2}
      aria-hidden="true"
    />
  );
}

/** Icône adaptée au type de salon. */
export function channelIcon(type: number, isRules = false): IconName {
  if (isRules) return "rules";
  switch (type) {
    case 1: return "at";
    case 3: return "users";
    case 2: return "speaker";
    case 5: return "megaphone";
    case 10:
    case 11:
    case 12: return "thread";
    case 13: return "stage";
    case 15:
    case 16: return "forum";
    default: return "hash";
  }
}
