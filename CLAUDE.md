# Dislite — notes pour Claude

Client Discord tiers **léger** (Rust / Tauri 2 + SolidJS). Dossier/paquet historique : `accord`
(l'utilisateur l'appelle parfois « Lightcord »). Interface en anglais, échanges avec l'utilisateur en français.

## Vision (validée par l'utilisateur)
- Identité propre, **pas une copie de Discord**, minimaliste, rien qui « fasse IA » (pas de salutations,
  cartes à pastilles, majuscules forcées…). Style retenu : **« Doux »** (gris neutres, accent réglable
  uniquement pour l'actif / mentions / non-lus). Les autres styles testés (Papier, Une colonne,
  Messagerie, Terminal) ont été écartés.
- **Lite avant tout** : pas d'animation infinie hors état visible, pas de minuterie inutile, aucune
  requête réseau superflue, dépendances minimales.
- Se comporter comme un client normal (pas d'automatisation) pour ne pas risquer le compte.
- Écartés volontairement : vidéo/partage d'écran, administration de serveurs, envoi de GIF, Stage,
  soundboard, activités.

## Points clés de l'architecture
- `src-tauri/src/` : `discord/` (http, gateway, identité web, remote auth QR), `voice/` (moteur vocal
  natif : gateway vocale v8, UDP, chiffrement rtpsize, **DAVE** via `davey`, Opus, RNNoise
  `nnnoiseless`, capture/lecture `cpal`), `storage.rs` (multi-comptes `accounts.json` 0600),
  `desktop.rs` (tray, autostart, démarrage réduit), `commands.rs` (notifications `notify-rust`,
  upload avec progression), `debug_bridge.rs` (dev uniquement).
- `src/` : `store/` (état, instantané local par compte pour un démarrage instantané), `gateway/handlers`,
  `actions/`, `components/`.
- **Ne jamais changer** l'identifiant `dev.accord.client` ni les clés localStorage `accord:*`
  (session et données de l'utilisateur).

## Tester sans risque
- `npm run tauri dev` restaure la session (ne jamais appeler logout / effacer le dossier de config).
- En dev : pont de débogage + `scripts/accord-eval 'js'`, `scripts/accord-shot <png absolu>`
  (socket Unix : **Linux uniquement**).
- Ne pas rejoindre de vocal / appeler / envoyer quoi que ce soit sur le compte sans l'accord de
  l'utilisateur : le vocal se teste **ensemble**.

## État au premier commit (965d059)
Tout compile (tsc, vite, cargo). Restent à tester en vrai avec l'utilisateur : appels (décrocher,
latence), notifications à actions, sons, upload. Pistes : annulation d'écho, push-to-talk global,
paquet AUR / AppImage, mises à jour.

## Portage Windows (prochaine étape)
À adapter (tout est aujourd'hui pensé pour Linux) :
- `voice/audio.rs` : liste des micros via `pactl` + variables PipeWire → sous Windows, noms WASAPI
  de `cpal` directement.
- `desktop.rs` : autostart via `~/.config/autostart` → clé registre `HKCU\...\Run` ; tray : pas besoin
  du test libappindicator.
- `commands.rs` : `notify-rust` `wait_for_action` est propre à freedesktop → notifications Windows
  (toast) avec actions, ou simple notification + clic.
- `storage.rs` : permissions Unix (`0o600`, `OpenOptionsExt`) → `#[cfg(unix)]`.
- `debug_bridge.rs` (socket Unix) et la capture `webkit2gtk` → `#[cfg(target_os = "linux")]`.
- `commands.rs` : `media_support` (GStreamer) → `true` sous Windows (WebView2 lit la vidéo) ;
  mode mini Hyprland (`hyprland_mini`) → Linux seulement.
- `lib.rs` : variable `WEBKIT_DISABLE_DMABUF_RENDERER` → Linux seulement.
Ensuite : `npm install`, `npm run tauri dev`, puis bundle NSIS/MSI.
