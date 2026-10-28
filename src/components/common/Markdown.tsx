// Rendu de l'AST Markdown en éléments Solid.

import { createSignal, For, type JSX, Match, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";
import { openChannel } from "../../actions/navigation";
import { openProfile } from "../profile/ProfilePopout";
import { emojiUrl } from "../../lib/cdn";
import { isJumbo, type MdNode, parseInline, parseMarkdown } from "../../lib/markdown";
import { discordTimestamp } from "../../lib/time";
import { channelLabel, displayName } from "../../store/selectors";
import { settings } from "../../store/settings";
import { state } from "../../store/state";
import type { Snowflake } from "../../store/types";

interface Ctx {
  guildId?: Snowflake;
  jumbo?: boolean;
}

function Spoiler(props: { children: JSX.Element }) {
  const [shown, setShown] = createSignal(false);
  return (
    <span class="spoiler" classList={{ shown: shown() }} onClick={() => setShown(true)}>
      {props.children}
    </span>
  );
}

function RoleMention(props: { id: string; guildId?: string }) {
  const role = () => (props.guildId ? state.guilds[props.guildId]?.roles[props.id] : undefined);
  const color = () => {
    const c = role()?.color;
    return c ? `#${c.toString(16).padStart(6, "0")}` : undefined;
  };
  return (
    <span class="mention" style={color() ? { color: color(), background: `${color()}1f` } : undefined}>
      @{role()?.name ?? "unknown-role"}
    </span>
  );
}

function renderNode(n: MdNode, ctx: Ctx): JSX.Element {
  switch (n.t) {
    case "text": return n.v;
    case "br": return <br />;
    case "b": return <strong>{renderNodes(n.c, ctx)}</strong>;
    case "i": return <em>{renderNodes(n.c, ctx)}</em>;
    case "u": return <u>{renderNodes(n.c, ctx)}</u>;
    case "s": return <s>{renderNodes(n.c, ctx)}</s>;
    case "spoiler": return <Spoiler>{renderNodes(n.c, ctx)}</Spoiler>;
    case "code": return <code class="inline-code">{n.v}</code>;
    case "codeblock": return <pre class="codeblock"><code data-lang={n.lang || undefined}>{n.v}</code></pre>;
    case "quote": return <blockquote>{renderNodes(n.c, ctx)}</blockquote>;
    case "heading":
      return <Dynamic component={`h${n.level}`} class="md-heading">{renderNodes(n.c, ctx)}</Dynamic>;
    case "subtext": return <small class="md-subtext">{renderNodes(n.c, ctx)}</small>;
    case "list": {
      const items = <For each={n.items}>{(item) => <li>{renderNodes(item, ctx)}</li>}</For>;
      return n.ordered ? <ol start={n.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "link": return <a href={n.href} title={n.href}>{renderNodes(n.c, ctx)}</a>;
    case "url": return <a href={n.href}>{n.href}</a>;
    case "user":
      return (
        <span class="mention" onClick={(e) => openProfile(e, n.id, ctx.guildId)}>
          @{displayName(n.id, ctx.guildId)}
        </span>
      );
    case "role": return <RoleMention id={n.id} guildId={ctx.guildId} />;
    case "channel": {
      const id = n.id;
      return (
        <span class="mention" onClick={() => state.channels[id] && openChannel(id)}>
          #{channelLabel(state.channels[id]) || "unknown-channel"}
        </span>
      );
    }
    case "emoji":
      return (
        <img
          class="emoji"
          classList={{ jumbo: !!ctx.jumbo }}
          src={emojiUrl(n.id, n.animated && !settings.reduceMotion, ctx.jumbo ? 96 : 48)}
          alt={`:${n.name}:`}
          title={`:${n.name}:`}
          draggable={false}
        />
      );
    case "timestamp":
      return <span class="timestamp-tag" title={new Date(n.ts).toLocaleString()}>{discordTimestamp(n.ts, n.style)}</span>;
    case "everyone": return <span class="mention">{n.v}</span>;
  }
}

function renderNodes(nodes: MdNode[], ctx: Ctx): JSX.Element {
  return <For each={nodes}>{(n) => renderNode(n, ctx)}</For>;
}

export function Markdown(props: {
  content: string;
  guildId?: Snowflake;
  inline?: boolean;
  /** agrandit les messages composés uniquement d'émojis (désactivé hors messages) */
  jumbo?: boolean;
}) {
  const nodes = () => (props.inline ? parseInline(props.content) : parseMarkdown(props.content));
  const jumbo = () => props.jumbo !== false && !props.inline && isJumbo(nodes());
  return (
    <Switch>
      <Match when={jumbo()}>
        <span class="jumbo-emoji">{renderNodes(nodes(), { guildId: props.guildId, jumbo: true })}</span>
      </Match>
      <Match when={!jumbo()}>{renderNodes(nodes(), { guildId: props.guildId })}</Match>
    </Switch>
  );
}
