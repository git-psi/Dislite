import { ask } from "@tauri-apps/plugin-dialog";
import { createResource, createSignal, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { micLevel, setMicLevel } from "../../actions/voice";
import { accounts, addAccount, logoutAccount, removeAccount, switchAccount } from "../../actions/accounts";
import { checkForUpdate, installUpdate } from "../../actions/updates";
import { type AudioDevice, backend, type DesktopPrefs, errorMessage } from "../../ipc/tauri";
import { avatarUrl } from "../../lib/cdn";
import { loadProfile, profileOf } from "../../actions/profiles";
import { ACCENTS } from "../../lib/theme";
import { playSound } from "../../lib/sounds";
import { type Density, setSettings, settings, type Theme } from "../../store/settings";
import { state } from "../../store/state";
import { savePrefs, setUi, toast, ui } from "../../store/ui";
import { Icon } from "../common/Icon";
import { Modal } from "../common/Modal";

type Section = "profile" | "accounts" | "appearance" | "voice" | "notifications" | "privacy" | "app";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "voice", label: "Voice" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy & activity" },
  { id: "app", label: "App" },
  { id: "accounts", label: "Accounts" },
];

const ZOOMS = [0.85, 0.9, 1, 1.1, 1.25];
const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "darker", label: "Darker" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function Row(props: { title: string; hint?: JSX.Element; disabled?: boolean; children: JSX.Element }) {
  return (
    <div class="setting-row" classList={{ disabled: !!props.disabled }}>
      <div class="setting-text">
        <span class="setting-title">{props.title}</span>
        <Show when={props.hint}><span class="setting-hint">{props.hint}</span></Show>
      </div>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}

function Toggle(props: { value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      class="toggle"
      classList={{ on: props.value }}
      role="switch"
      aria-checked={props.value}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
    >
      <span />
    </button>
  );
}

function Segmented<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="segmented">
      <For each={props.options}>
        {(o) => (
          <button classList={{ active: props.value === o.value }} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        )}
      </For>
    </div>
  );
}

function Appearance() {
  const custom = () => !ACCENTS.some((a) => a.hex.toLowerCase() === settings.accent.toLowerCase());
  return (
    <>
      <h2>Appearance</h2>
      <Row title="Theme">
        <Segmented<Theme> value={settings.theme} options={THEMES} onChange={(v) => setSettings("theme", v)} />
      </Row>
      <div class="setting-block">
        <span class="setting-title">Accent colour</span>
        <span class="setting-hint">Used for what is active, mentions and unread messages.</span>
        <div class="swatches">
          <For each={ACCENTS}>
            {(a) => (
              <button
                class="swatch"
                classList={{ selected: settings.accent.toLowerCase() === a.hex.toLowerCase() }}
                style={{ background: a.hex }}
                title={a.name}
                onClick={() => setSettings("accent", a.hex)}
              >
                <Show when={settings.accent.toLowerCase() === a.hex.toLowerCase()}>
                  <Icon name="check" size={16} />
                </Show>
              </button>
            )}
          </For>
          <label class="swatch custom" classList={{ selected: custom() }} title="Custom colour" style={custom() ? { background: settings.accent } : undefined}>
            <Icon name="plus" size={16} />
            <input type="color" value={settings.accent} onInput={(e) => setSettings("accent", e.currentTarget.value)} />
          </label>
        </div>
      </div>
      <Row title="Message density" hint="Compact mode shrinks avatars and spacing.">
        <Segmented<Density>
          value={settings.density}
          options={[{ value: "cozy", label: "Cozy" }, { value: "compact", label: "Compact" }]}
          onChange={(v) => setSettings("density", v)}
        />
      </Row>
      <Row title="Interface size">
        <Segmented<number>
          value={settings.zoom}
          options={ZOOMS.map((z) => ({ value: z, label: `${Math.round(z * 100)} %` }))}
          onChange={(v) => setSettings("zoom", v)}
        />
      </Row>
      <Row title="Member list" hint="Shown next to channels by default. The button in the channel header toggles it anytime.">
        <Toggle
          value={ui.showMembers}
          onChange={(v) => {
            setUi("showMembers", v);
            savePrefs();
          }}
        />
      </Row>
      <Row title="Reduce motion" hint="Animated emoji frozen, GIFs play on click.">
        <Toggle value={settings.reduceMotion} onChange={(v) => setSettings("reduceMotion", v)} />
      </Row>
      <Row title="“New messages” divider" hint="Marks the first unread message when opening a channel.">
        <Toggle value={settings.unreadDivider} onChange={(v) => setSettings("unreadDivider", v)} />
      </Row>
    </>
  );
}

/** « KeyV » -> « V », « Backquote » -> « ` »… */
const keyLabel = (code: string) =>
  ({ Backquote: "`", Space: "Space", CapsLock: "Caps Lock" } as Record<string, string>)[code] ??
  code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num ");

/** -100..0 dB -> 0..100 %. */
const pct = (db: number) => Math.max(0, Math.min(100, db + 100));

function VoiceSection() {
  const [devices] = createResource(() => backend.voiceDevices());
  const [capturing, setCapturing] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const level = () => (testing() && micLevel() !== null ? pct(micLevel()!) : 0);
  const toggleTest = () => {
    const on = !testing();
    setTesting(on);
    setMicLevel(null);
    backend.voiceMicTest(on).catch((e) => {
      setTesting(false);
      toast(errorMessage(e), true);
    });
  };
  onCleanup(() => testing() && void backend.voiceMicTest(false).catch(() => {}));
  const Select = (props: { value: string | null; options: AudioDevice[]; onChange: (v: string | null) => void }) => (
    <select class="setting-select" value={props.value ?? ""} onChange={(e) => props.onChange(e.currentTarget.value || null)}>
      <option value="">System default</option>
      <For each={props.options}>{(d) => <option value={d.id}>{d.label}</option>}</For>
    </select>
  );
  const Range = (props: { min: number; max: number; step?: number; value: number; label: string; onInput: (v: number) => void }) => (
    <div class="range-control">
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onInput={(e) => props.onInput(Number(e.currentTarget.value))} />
      <span>{props.label}</span>
    </div>
  );
  const sensitivityLabel = () => (settings.voiceSensitivity <= -90 ? "Always on" : `${settings.voiceSensitivity} dB`);
  return (
    <>
      <h2>Voice</h2>
      <Row title="Microphone">
        <Select value={settings.voiceInput} options={devices()?.inputs ?? []} onChange={(v) => setSettings("voiceInput", v)} />
      </Row>
      <Row title="Speakers or headphones">
        <Select value={settings.voiceOutput} options={devices()?.outputs ?? []} onChange={(v) => setSettings("voiceOutput", v)} />
      </Row>
      <Row title="Microphone volume" hint="Boost a quiet microphone, or lower a loud one.">
        <Range min={0} max={400} step={5} value={Math.round(settings.voiceInputGain * 100)} label={`${Math.round(settings.voiceInputGain * 100)} %`} onInput={(v) => setSettings("voiceInputGain", v / 100)} />
      </Row>
      <Row title="Output volume" hint="Everyone's voice. Right-click someone in a call to change only theirs (up to 300 %).">
        <Range min={0} max={200} step={5} value={Math.round(settings.voiceOutputVolume * 100)} label={`${Math.round(settings.voiceOutputVolume * 100)} %`} onInput={(v) => setSettings("voiceOutputVolume", v / 100)} />
      </Row>
      <Row title="Noise suppression" hint="Removes keyboard, fan and background noise from your voice (RNNoise, on this computer).">
        <Toggle value={settings.voiceNoiseSuppression} onChange={(v) => setSettings("voiceNoiseSuppression", v)} />
      </Row>
      <Row title="Echo cancellation" hint="Keeps the others from hearing themselves when you use speakers instead of headphones.">
        <Toggle value={settings.voiceEchoCancellation} onChange={(v) => setSettings("voiceEchoCancellation", v)} />
      </Row>
      <Row title="Input mode" hint={settings.voicePtt ? "Hold the key while Dislite is focused. Global shortcuts depend on your compositor." : "Your voice is sent when it's louder than the threshold below."}>
        <div class="ptt-control">
          <Segmented<string>
            value={settings.voicePtt ? "ptt" : "vad"}
            options={[{ value: "vad", label: "Voice activity" }, { value: "ptt", label: "Push to talk" }]}
            onChange={(v) => setSettings("voicePtt", v === "ptt")}
          />
          <Show when={settings.voicePtt}>
            <button
              class="key-capture"
              classList={{ waiting: capturing() }}
              onClick={() => setCapturing(true)}
              onKeyDown={(e) => {
                if (!capturing()) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key !== "Escape") setSettings("voicePttKey", e.code);
                setCapturing(false);
              }}
              onBlur={() => setCapturing(false)}
            >
              {capturing() ? "Press a key…" : keyLabel(settings.voicePttKey)}
            </button>
          </Show>
        </div>
      </Row>
      <Row title="Voice detection" hint="How loud you need to be before Dislite sends your voice. Lower picks up quieter speech, and more background noise." disabled={settings.voicePtt}>
        <Range min={-100} max={0} value={settings.voiceSensitivity} label={sensitivityLabel()} onInput={(v) => setSettings("voiceSensitivity", v)} />
      </Row>
      <Row title="Microphone test" hint="Speak to see your level. The mark shows the detection threshold.">
        <div class="mic-test">
          <div class="mic-meter">
            <span class="mic-level" style={{ width: `${level()}%` }} classList={{ over: (micLevel() ?? -100) > settings.voiceSensitivity }} />
            <Show when={!settings.voicePtt && settings.voiceSensitivity > -90}>
              <span class="mic-threshold" style={{ left: `${pct(settings.voiceSensitivity)}%` }} />
            </Show>
          </div>
          <button class="btn small" onClick={toggleTest}>{testing() ? "Stop" : "Test"}</button>
        </div>
      </Row>
      <p class="setting-hint about">Calls are end-to-end encrypted, like in the official app.</p>
    </>
  );
}

function ProfileSection() {
  const user = () => (state.meId ? state.users[state.meId] : undefined);
  void loadProfile(state.meId!);
  const p = () => profileOf(state.meId!)?.data;
  const [name, setName] = createSignal(user()?.global_name ?? "");
  const [pronouns, setPronouns] = createSignal<string | null>(null);
  const [bio, setBio] = createSignal<string | null>(null);
  const [avatar, setAvatar] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const pickAvatar = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast("Image too large (8 MB max).", true);
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };
  const save = async () => {
    setBusy(true);
    try {
      const me: Record<string, unknown> = {};
      if (name() !== (user()?.global_name ?? "")) me.global_name = name().trim() || null;
      if (avatar()) me.avatar = avatar();
      if (Object.keys(me).length) await backend.api("PATCH", "/users/@me", me);
      const profile: Record<string, unknown> = {};
      if (bio() !== null) profile.bio = bio();
      if (pronouns() !== null) profile.pronouns = pronouns();
      if (Object.keys(profile).length) await backend.api("PATCH", "/users/@me/profile", profile);
      setAvatar(null);
      toast("Profile saved");
    } catch (e) {
      toast(`Not saved: ${errorMessage(e)}`, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Profile</h2>
      <div class="profile-edit">
        <label class="avatar-edit" title="Change avatar">
          <img src={avatar() ?? avatarUrl(user(), 128)} alt="" />
          <span>Change</span>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pickAvatar} />
        </label>
        <div class="profile-fields">
          <label>Display name<input value={name()} maxLength={32} placeholder={user()?.username} onInput={(e) => setName(e.currentTarget.value)} /></label>
          <label>Pronouns<input value={pronouns() ?? p()?.pronouns ?? ""} maxLength={40} onInput={(e) => setPronouns(e.currentTarget.value)} /></label>
        </div>
      </div>
      <label class="profile-bio">About me<textarea rows={4} maxLength={190} value={bio() ?? p()?.bio ?? ""} onInput={(e) => setBio(e.currentTarget.value)} /></label>
      <div class="profile-save"><button class="btn primary small" disabled={busy()} onClick={save}>{busy() ? "Saving…" : "Save"}</button></div>
    </>
  );
}

function Notifications() {
  return (
    <>
      <h2>Notifications</h2>
      <Row title="Desktop notifications" hint="DMs and mentions, following each server's settings. Off in Do Not Disturb.">
        <Toggle value={settings.notifications} onChange={(v) => setSettings("notifications", v)} />
      </Row>
      <Row title="Show message content" hint="Off: notifications only say who wrote, not what.">
        <Toggle value={settings.notifyPreview} onChange={(v) => setSettings("notifyPreview", v)} />
      </Row>
      <Row title="Incoming calls" hint="A notification with Join / Decline when Dislite isn't in front.">
        <Toggle value={settings.notifyCalls} onChange={(v) => setSettings("notifyCalls", v)} />
      </Row>
      <Row title="Mentions in the window title" hint="Shows “(3) Dislite” in your taskbar when mentions are waiting.">
        <Toggle value={settings.titleCount} onChange={(v) => setSettings("titleCount", v)} />
      </Row>
      <Row title="Sounds" hint="Messages, mentions, people joining or leaving your call, mute.">
        <div class="ptt-control">
          <input class="sound-volume" type="range" min="0" max="100" value={Math.round(settings.soundVolume * 100)} disabled={!settings.sounds}
            onInput={(e) => setSettings("soundVolume", Number(e.currentTarget.value) / 100)} onChange={() => playSound("message")} />
          <Toggle value={settings.sounds} onChange={(v) => setSettings("sounds", v)} />
        </div>
      </Row>
    </>
  );
}

function Privacy() {
  const commit = (name: string) => {
    if (name.trim() !== settings.activityName) setSettings("activityName", name.trim());
  };
  return (
    <>
      <h2>Privacy & activity</h2>
      <Row title="Show when I'm typing" hint="Off: others don't see “… is typing”.">
        <Toggle value={settings.sendTyping} onChange={(v) => setSettings("sendTyping", v)} />
      </Row>
      <Row title="My activity" hint="Shown on your profile, like a game or music. Leave empty for none.">
        <div class="ptt-control">
          <select class="setting-select narrow" value={settings.activityType} onChange={(e) => setSettings("activityType", Number(e.currentTarget.value) as 0 | 2 | 3)}>
            <option value="0">Playing</option>
            <option value="2">Listening to</option>
            <option value="3">Watching</option>
          </select>
          <input class="activity-input" placeholder="Nothing" maxLength={128} value={settings.activityName}
            onChange={(e) => commit(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)} />
        </div>
      </Row>
      <Row title="Away when inactive" hint="Switches to Idle after a while without using Dislite (never during a call).">
        <Segmented<number>
          value={settings.autoIdleMinutes}
          options={[{ value: 0, label: "Never" }, { value: 5, label: "5 min" }, { value: 10, label: "10 min" }, { value: 30, label: "30 min" }]}
          onChange={(v) => setSettings("autoIdleMinutes", v)}
        />
      </Row>
      <Row title="Show others' activities" hint="Games, music and custom statuses in lists. Off for a calmer view.">
        <Toggle value={settings.showActivities} onChange={(v) => setSettings("showActivities", v)} />
      </Row>
    </>
  );
}

function AppSection() {
  const [desktop, { mutate }] = createResource(() => backend.desktopGet());
  const prefs = () => desktop()?.prefs;
  const update = async (patch: Partial<DesktopPrefs>) => {
    const current = desktop();
    if (!current) return;
    const next = { ...current.prefs, ...patch };
    try {
      await backend.desktopSet(next);
      mutate({ ...current, prefs: next });
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const setAutostart = async (on: boolean) => {
    const current = desktop();
    if (!current) return;
    try {
      await backend.autostartSet(on);
      mutate({ ...current, autostart: on });
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const trayOff = () => !desktop()?.trayAvailable;
  const [checking, setChecking] = createSignal(false);
  const checkNow = async () => {
    setChecking(true);
    try {
      if (!(await checkForUpdate())) toast("Dislite is up to date.");
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <h2>App</h2>
      <Show when={desktop()}>
        <Row
          title="Launch when you log in"
          hint={
            desktop()!.os === "linux"
              ? "Adds Dislite to your session's autostart. On Hyprland, this needs XDG autostart support (uwsm or dex)."
              : "Starts Dislite when you sign in."
          }
        >
          <Toggle value={desktop()!.autostart} onChange={setAutostart} />
        </Row>
        <Row
          title="Icon in the system tray"
          disabled={trayOff()}
          hint={
            trayOff() ? (
              <>Needs libayatana-appindicator: <code>sudo pacman -S libayatana-appindicator</code>, then restart Dislite.</>
            ) : (
              "Open or quit Dislite from your bar."
            )
          }
        >
          <Toggle value={prefs()!.tray && !trayOff()} disabled={trayOff()} onChange={(v) => update({ tray: v })} />
        </Row>
        <Row title="Close to the tray" hint="Closing the window keeps Dislite running in the tray." disabled={!prefs()!.tray || trayOff()}>
          <Toggle value={prefs()!.closeToTray} disabled={!prefs()!.tray || trayOff()} onChange={(v) => update({ closeToTray: v })} />
        </Row>
        <Row title="Start minimized" hint="When launched at login, stay in the tray until you open it." disabled={!prefs()!.tray || trayOff()}>
          <Toggle value={prefs()!.startMinimized} disabled={!prefs()!.tray || trayOff()} onChange={(v) => update({ startMinimized: v })} />
        </Row>
        <Show when={desktop()!.updates}>
          <Row title="Check for updates" hint="Looks for a new version at launch, then once a day. You choose when to install it.">
            <Toggle value={prefs()!.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
          </Row>
          <Row
            title={ui.update ? `Version ${ui.update.version} is available` : "Updates"}
            hint={ui.update?.notes ?? undefined}
          >
            <Show
              when={ui.update}
              fallback={<button class="btn small" disabled={checking()} onClick={() => void checkNow()}>{checking() ? "Checking…" : "Check now"}</button>}
            >
              <button class="btn small" disabled={!!ui.updating} onClick={() => void installUpdate()}>
                {ui.updating ? "Updating…" : "Update and restart"}
              </button>
            </Show>
          </Row>
        </Show>
      </Show>
      <p class="setting-hint about">
        Dislite {desktop()?.version ?? ""} — a lightweight Discord client. Settings are stored on this computer.
      </p>
    </>
  );
}

function Accounts(props: { onClose: () => void }) {
  const signOut = async () => {
    if (await ask("Sign out of this account? It will be removed from this computer.", { title: "Sign out", kind: "warning" })) {
      props.onClose();
      void logoutAccount();
    }
  };
  const remove = async (id: string, name: string) => {
    if (await ask(`Remove ${name} from this computer? You stay signed in elsewhere.`, { title: "Remove account", kind: "warning" })) {
      void removeAccount(id);
    }
  };
  // Le compte actif d'abord.
  const list = () => [...accounts()].sort((a, b) => Number(b.id === state.meId) - Number(a.id === state.meId));
  return (
    <>
      <h2>Accounts</h2>
      <p class="setting-hint">Switch between accounts from here or by clicking your name at the bottom left. Each account keeps its own saved data on this computer.</p>
      <div class="account-list">
        <For each={list()}>
          {(a) => {
            const current = () => a.id === state.meId;
            const name = () => a.global_name || a.username;
            return (
              <div class="account-row" classList={{ current: current() }}>
                <img src={avatarUrl({ id: a.id, avatar: a.avatar }, 64)} alt="" />
                <div class="account-text">
                  <span class="account-name ellipsis">{name()}</span>
                  <span class="account-user ellipsis">{a.username}</span>
                </div>
                <Show
                  when={current()}
                  fallback={
                    <>
                      <button class="text-button" onClick={() => void remove(a.id, name())}>Remove</button>
                      <button
                        class="btn small"
                        onClick={() => {
                          props.onClose();
                          void switchAccount(a.id);
                        }}
                      >
                        Switch
                      </button>
                    </>
                  }
                >
                  <span class="account-current">Current</span>
                  <button class="btn small danger" onClick={signOut}>Sign out</button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      <button
        class="btn small add-account"
        onClick={() => {
          props.onClose();
          void addAccount();
        }}
      >
        <Icon name="user-plus" size={15} /> Add account
      </button>
    </>
  );
}

export function SettingsModal(props: { onClose: () => void; onLogout?: () => void; section?: Section }) {
  const [section, setSection] = createSignal<Section>(props.section ?? "appearance");
  return (
    <Modal onClose={props.onClose} class="settings-modal">
      <nav class="settings-nav">
        <div class="settings-nav-title">Settings</div>
        <For each={SECTIONS}>
          {(s) => (
            <button class="settings-nav-item" classList={{ active: section() === s.id }} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          )}
        </For>
      </nav>
      <div class="settings-content">
        <button class="icon-button settings-close" title="Close (Esc)" onClick={props.onClose}>
          <Icon name="x" size={20} />
        </button>
        <Switch>
          <Match when={section() === "profile"}><ProfileSection /></Match>
          <Match when={section() === "appearance"}><Appearance /></Match>
          <Match when={section() === "voice"}><VoiceSection /></Match>
          <Match when={section() === "notifications"}><Notifications /></Match>
          <Match when={section() === "privacy"}><Privacy /></Match>
          <Match when={section() === "app"}><AppSection /></Match>
          <Match when={section() === "accounts"}><Accounts onClose={props.onClose} /></Match>
        </Switch>
      </div>
    </Modal>
  );
}
