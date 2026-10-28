import { Show } from "solid-js";
import { avatarUrl, memberAvatarUrl } from "../../lib/cdn";
import { member, statusOf } from "../../store/selectors";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";

export function StatusDot(props: { status: string; class?: string }) {
  return <span class={`status-dot status-${props.status} ${props.class ?? ""}`} />;
}

export function Avatar(props: {
  userId: Snowflake;
  guildId?: Snowflake;
  size?: number;
  /** true : statut réel de l'utilisateur ; chaîne : statut imposé */
  status?: boolean | string;
  onClick?: (e: MouseEvent) => void;
}) {
  const size = () => props.size ?? 40;
  const src = () => {
    const user = state.users[props.userId];
    const m = member(props.guildId, props.userId);
    const px = size() > 64 ? 128 : 64;
    if (m?.avatar && props.guildId) return memberAvatarUrl(props.guildId, props.userId, m.avatar, px);
    return avatarUrl(user ?? { id: props.userId, avatar: null }, px);
  };
  return (
    <div class="avatar" style={{ width: `${size()}px`, height: `${size()}px` }} onClick={props.onClick}>
      <img src={src()} alt="" loading="lazy" draggable={false} />
      <Show when={props.status}>
        <StatusDot status={typeof props.status === "string" ? props.status : statusOf(props.userId)} />
      </Show>
    </div>
  );
}
