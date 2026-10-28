// Lecteur vidéo d'Dislite : contrôles légers et plein écran fiable.
// Le plein écran HTML de WebKitGTK ne fonctionne pas dans Tauri : on agrandit
// le lecteur à toute la page et on passe la fenêtre native en plein écran.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, onCleanup, Show } from "solid-js";
import { Icon } from "../common/Icon";

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export function VideoPlayer(props: { src: string; poster?: string; width: number; height: number; known: boolean }) {
  let video!: HTMLVideoElement;
  let root!: HTMLDivElement;
  const [playing, setPlaying] = createSignal(false);
  const [started, setStarted] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [muted, setMuted] = createSignal(false);
  const [volume, setVolume] = createSignal(1);
  const [full, setFull] = createSignal(false);

  const toggle = () => {
    setStarted(true);
    if (video.paused) void video.play();
    else video.pause();
  };

  const setFullscreen = (on: boolean) => {
    setFull(on);
    void getCurrentWindow().setFullscreen(on).catch(() => {});
    if (on) root.focus();
  };
  onCleanup(() => full() && void getCurrentWindow().setFullscreen(false).catch(() => {}));

  const seekFromEvent = (e: MouseEvent) => {
    const bar = e.currentTarget as HTMLElement;
    const r = bar.getBoundingClientRect();
    video.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (duration() || 0);
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const keys: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      f: () => setFullscreen(!full()),
      m: () => (video.muted = !video.muted),
      ArrowRight: () => (video.currentTime += 5),
      ArrowLeft: () => (video.currentTime -= 5),
      Escape: () => full() && setFullscreen(false),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  };

  return (
    <div
      ref={root}
      class="player"
      classList={{ full: full(), playing: playing() }}
      tabIndex={0}
      style={full() ? undefined : props.known ? { width: `${props.width}px`, height: `${props.height}px` } : { width: `${props.width}px` }}
      onKeyDown={onKey}
    >
      <video
        ref={video}
        src={props.src}
        poster={props.poster}
        preload="metadata"
        playsinline
        onClick={toggle}
        onDblClick={() => setFullscreen(!full())}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setTime(video.currentTime)}
        onLoadedMetadata={() => setDuration(video.duration)}
        onVolumeChange={() => {
          setMuted(video.muted);
          setVolume(video.volume);
        }}
      />
      <Show when={!started()}>
        <button class="player-big-play" onClick={toggle} title="Play">
          <Icon name="play" size={28} />
        </button>
      </Show>
      <div class="player-controls" classList={{ visible: started() && !playing() }}>
        <button class="player-btn" onClick={toggle} title={playing() ? "Pause (Space)" : "Play (Space)"}>
          <Icon name={playing() ? "pause" : "play"} size={18} />
        </button>
        <div class="player-progress" onClick={seekFromEvent}>
          <div class="player-progress-fill" style={{ width: `${duration() ? (time() / duration()) * 100 : 0}%` }} />
        </div>
        <span class="player-time">{fmt(time())} / {fmt(duration())}</span>
        <button class="player-btn" onClick={() => (video.muted = !video.muted)} title="Sound (M)">
          <Icon name={muted() || volume() === 0 ? "volume-off" : "speaker"} size={18} />
        </button>
        <input
          class="player-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted() ? 0 : volume()}
          onInput={(e) => {
            video.volume = Number(e.currentTarget.value);
            video.muted = video.volume === 0;
          }}
        />
        <button class="player-btn" onClick={() => setFullscreen(!full())} title={full() ? "Exit fullscreen (Esc)" : "Fullscreen (F)"}>
          <Icon name={full() ? "minimize" : "maximize"} size={18} />
        </button>
      </div>
    </div>
  );
}
