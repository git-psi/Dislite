// Pièces jointes, embeds et autocollants.

import { For, Match, Show, Switch } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "../../ipc/tauri";
import { fitSize, scaledMedia, stickerUrl } from "../../lib/cdn";
import { formatBytes } from "../../lib/time";
import type { Attachment, Embed, Snowflake, StickerItem } from "../../store/types";
import { settings } from "../../store/settings";
import { setUi, ui } from "../../store/ui";
import { Icon } from "../common/Icon";
import { VideoPlayer } from "./VideoPlayer";
import { Markdown } from "../common/Markdown";

const MAX_W = 400;
const MAX_H = 300;

const isSpoiler = (a: Attachment) => a.filename.startsWith("SPOILER_");

function ImagePreview(props: { url: string; proxy?: string; width?: number | null; height?: number | null; spoiler?: boolean; alt?: string }) {
  const size = () => fitSize(props.width, props.height, MAX_W, MAX_H);
  // Le proxy redimensionne : on demande 2x pour les écrans HiDPI.
  const src = () => (size().known ? scaledMedia(props.proxy ?? props.url, size().width * 2, size().height * 2) : props.proxy ?? props.url);
  return (
    <div
      class="media-frame"
      classList={{ spoiler: !!props.spoiler }}
      style={size().known ? { width: `${size().width}px`, height: `${size().height}px` } : { "max-width": `${MAX_W}px` }}
      onClick={(e) => {
        const el = e.currentTarget;
        if (el.classList.contains("spoiler")) return el.classList.remove("spoiler");
        const url = lightboxUrl(props.url, props.proxy, props.width, props.height);
        setUi("lightbox", { url, original: props.url, width: props.width ?? undefined, height: props.height ?? undefined });
      }}
    >
      <img src={src()} alt={props.alt ?? ""} loading="lazy" draggable={false} />
    </div>
  );
}

/** URL redimensionnée à la fenêtre (une photo 4K pèse des dizaines de Mo décodée). */
function lightboxUrl(url: string, proxy: string | undefined, width?: number | null, height?: number | null) {
  const fit = fitSize(width, height, innerWidth * devicePixelRatio, innerHeight * devicePixelRatio);
  return (fit.known ? scaledMedia(proxy ?? url, fit.width, fit.height) : proxy) ?? url;
}

const MOSAIC_W = 440;
const MOSAIC_MAX = 9;

/** Plusieurs images d'affilée : grille compacte au lieu d'une pile d'images pleine taille. */
function Mosaic(props: { images: Attachment[] }) {
  const shown = () => props.images.slice(0, MOSAIC_MAX);
  const extra = () => props.images.length - MOSAIC_MAX;
  const cols = () => (props.images.length <= 4 ? 2 : 3);
  const cell = () => Math.floor((MOSAIC_W - (cols() - 1) * 4) / cols());
  const open = (i: number) => {
    const gallery = props.images.map((a) => ({ url: lightboxUrl(a.url, a.proxy_url, a.width, a.height), original: a.url }));
    setUi("lightbox", { ...gallery[i], gallery, index: i });
  };
  return (
    <div
      class="mosaic"
      classList={{ "mosaic-3": props.images.length === 3 }}
      style={{ "grid-template-columns": `repeat(${cols()}, ${cell()}px)`, "grid-auto-rows": `${props.images.length === 2 ? 220 : cell()}px` }}
    >
      <For each={shown()}>
        {(a, i) => (
          <div
            class="mosaic-cell"
            classList={{ spoiler: isSpoiler(a) }}
            onClick={(e) => {
              const el = e.currentTarget;
              if (el.classList.contains("spoiler")) return el.classList.remove("spoiler");
              open(i());
            }}
          >
            <img src={scaledMedia(a.proxy_url ?? a.url, cell() * 2, cell() * 2) ?? a.url} alt={a.description ?? ""} loading="lazy" draggable={false} />
            <Show when={i() === MOSAIC_MAX - 1 && extra() > 0}>
              <span class="mosaic-more">+{extra()}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function VideoPreview(props: {
  url: string;
  width?: number | null;
  height?: number | null;
  gifv?: boolean;
  /** vignette affichée si la lecture est impossible */
  poster?: string;
  /** lien ouvert dans le navigateur si la lecture est impossible */
  link?: string;
}) {
  const size = () => fitSize(props.width, props.height, MAX_W, MAX_H);
  const style = () => (size().known ? { width: `${size().width}px`, height: `${size().height}px` } : undefined);
  return (
    <Show
      when={ui.mediaSupported}
      fallback={
        <a
          class="media-frame video-fallback"
          href={props.link ?? props.url}
          style={style()}
          title="Play in mpv"
          onClick={(e) => {
            // Sans GStreamer, WebKit ne lit pas la vidéo : mpv, sinon le navigateur.
            e.preventDefault();
            e.stopPropagation();
            backend
              .openMedia(props.url, !!props.gifv)
              .then((ok) => {
                if (!ok) void openUrl(props.link ?? props.url);
              })
              .catch(() => void openUrl(props.link ?? props.url));
          }}
        >
          <Show when={props.poster}>
            <img src={scaledMedia(props.poster, size().width * 2, size().height * 2)} alt="" loading="lazy" />
          </Show>
          <span class="play-badge"><Icon name="play" size={24} /></span>
        </a>
      }
    >
      <Show
        when={props.gifv}
        fallback={<VideoPlayer src={props.url} poster={props.poster} width={size().width} height={size().height} known={size().known} />}
      >
        <div class="media-frame video" style={style()}>
          <video
            src={props.url}
            autoplay={!settings.reduceMotion}
            loop
            muted
            playsinline
            onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())}
          />
        </div>
      </Show>
    </Show>
  );
}

function FileCard(props: { attachment: Attachment }) {
  return (
    <div class="file-card">
      <Icon name="file" size={28} />
      <div class="file-info">
        <a href={props.attachment.url} class="ellipsis">{props.attachment.filename}</a>
        <span class="muted small">{props.attachment.size ? formatBytes(props.attachment.size) : "uploading…"}</span>
      </div>
      <Show when={props.attachment.url}>
        <a class="icon-button" href={props.attachment.url} title="Download">
          <Icon name="download" size={18} />
        </a>
      </Show>
    </div>
  );
}

const isImage = (a: Attachment) => !!a.url && (a.content_type ?? "").startsWith("image/");

export function Attachments(props: { attachments: Attachment[] }) {
  const images = () => props.attachments.filter(isImage);
  const stacked = () => images().length > 1;
  return (
    <div class="attachments">
      <Show when={stacked()}>
        <Mosaic images={images()} />
      </Show>
      <For each={stacked() ? props.attachments.filter((a) => !isImage(a)) : props.attachments}>
        {(a) => {
          const type = a.content_type ?? "";
          return (
            <Switch fallback={<FileCard attachment={a} />}>
              <Match when={type.startsWith("image/") && a.url}>
                <ImagePreview url={a.url} proxy={a.proxy_url} width={a.width} height={a.height} spoiler={isSpoiler(a)} alt={a.description} />
              </Match>
              <Match when={type.startsWith("video/") && a.url}>
                <VideoPreview url={a.url} width={a.width} height={a.height} poster={`${a.proxy_url}?format=webp`} />
              </Match>
              <Match when={type.startsWith("audio/") && a.url && ui.mediaSupported}>
                <div class="audio-card">
                  <FileCard attachment={a} />
                  <audio src={a.url} controls preload="none" />
                </div>
              </Match>
            </Switch>
          );
        }}
      </For>
    </div>
  );
}

const colorOf = (n?: number) => (n ? `#${n.toString(16).padStart(6, "0")}` : undefined);

function RichEmbed(props: { embed: Embed; guildId?: Snowflake }) {
  const e = () => props.embed;
  const fields = () => e().fields ?? [];
  return (
    <div class="embed" style={{ "--bar": colorOf(e().color) ?? "var(--bg-4)" }}>
      <div class="embed-body">
        <Show when={e().provider?.name}>
          <div class="embed-provider small muted">{e().provider!.name}</div>
        </Show>
        <Show when={e().author?.name}>
          <div class="embed-author">
            <Show when={e().author!.proxy_icon_url}>
              <img src={e().author!.proxy_icon_url} alt="" />
            </Show>
            <Show when={e().author!.url} fallback={<span>{e().author!.name}</span>}>
              <a href={e().author!.url}>{e().author!.name}</a>
            </Show>
          </div>
        </Show>
        <Show when={e().title}>
          <div class="embed-title">
            <Show when={e().url} fallback={<Markdown content={e().title!} inline guildId={props.guildId} />}>
              <a href={e().url}>{e().title}</a>
            </Show>
          </div>
        </Show>
        <Show when={e().description}>
          <div class="embed-description markdown">
            <Markdown content={e().description!} guildId={props.guildId} jumbo={false} />
          </div>
        </Show>
        <Show when={fields().length}>
          <div class="embed-fields">
            <For each={fields()}>
              {(f) => (
                <div class="embed-field" classList={{ inline: !!f.inline }}>
                  <div class="embed-field-name"><Markdown content={f.name} inline guildId={props.guildId} /></div>
                  <div class="embed-field-value markdown"><Markdown content={f.value} guildId={props.guildId} jumbo={false} /></div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={e().image}>
          <ImagePreview url={e().image!.url} proxy={e().image!.proxy_url} width={e().image!.width} height={e().image!.height} />
        </Show>
        <Show when={e().video && e().thumbnail && !e().image}>
          <a class="embed-video" href={e().url ?? e().video!.url}>
            <img src={scaledMedia(e().thumbnail!.proxy_url, 400, 225) ?? e().thumbnail!.url} alt="" loading="lazy" />
            <span class="play-badge"><Icon name="play" size={28} /></span>
          </a>
        </Show>
        <Show when={e().footer?.text || e().timestamp}>
          <div class="embed-footer small muted">
            <Show when={e().footer?.proxy_icon_url}>
              <img src={e().footer!.proxy_icon_url} alt="" />
            </Show>
            {e().footer?.text}
            {e().footer?.text && e().timestamp ? " • " : ""}
            {e().timestamp ? new Date(e().timestamp!).toLocaleString() : ""}
          </div>
        </Show>
      </div>
      <Show when={e().thumbnail && !e().video && e().type !== "image"}>
        <img class="embed-thumbnail" src={scaledMedia(e().thumbnail!.proxy_url, 160, 160) ?? e().thumbnail!.url} alt="" loading="lazy" />
      </Show>
    </div>
  );
}

export function Embeds(props: { embeds: Embed[]; guildId?: Snowflake }) {
  return (
    <div class="embeds">
      <For each={props.embeds}>
        {(e) => (
          <Switch fallback={<RichEmbed embed={e} guildId={props.guildId} />}>
            <Match when={e.type === "gifv" && e.video}>
              <VideoPreview
                url={e.video!.proxy_url ?? e.video!.url}
                width={e.video!.width}
                height={e.video!.height}
                gifv
                poster={e.thumbnail?.proxy_url}
                link={e.url ?? e.video!.url}
              />
            </Match>
            <Match when={e.type === "image" && (e.thumbnail || e.image)}>
              {(() => {
                const media = (e.image ?? e.thumbnail)!;
                return <ImagePreview url={media.url} proxy={media.proxy_url} width={media.width} height={media.height} />;
              })()}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}

/** Ne garde que les embeds affichables (Discord en renvoie parfois de vides). */
export const visibleEmbeds = (embeds: Embed[]) =>
  embeds.filter((e) => e.title || e.description || e.image || e.thumbnail || e.video || e.fields?.length || e.author);

export function Stickers(props: { stickers: StickerItem[] }) {
  return (
    <div class="stickers">
      <For each={props.stickers}>
        {(s) => (
          <Show when={s.format_type !== 3} fallback={<span class="muted small">[Sticker : {s.name}]</span>}>
            <img class="sticker" src={stickerUrl(s.id, s.format_type)} alt={s.name} title={s.name} loading="lazy" />
          </Show>
        )}
      </For>
    </div>
  );
}
