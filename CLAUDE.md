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
  (Linux et Windows ; la capture `accord-shot` : **Linux uniquement**).
- Ne pas rejoindre de vocal / appeler / envoyer quoi que ce soit sur le compte sans l'accord de
  l'utilisateur : le vocal se teste **ensemble**.

## État au premier commit (965d059)
Tout compile (tsc, vite, cargo). Restent à tester en vrai avec l'utilisateur : appels (décrocher,
latence), notifications à actions, sons, upload. Pistes : annulation d'écho, push-to-talk global,
paquet AUR / AppImage, mises à jour.

## Captures du README (mode démo)
`src/dev/demo.ts` (dev seulement) : `scripts/accord-eval 'return await window.__accord.demo()'` remplace
l'état par des serveurs / personnes / messages inventés, gateway débranchée, lecture seule, sans
instantané ni écriture (forums). Recharger la page rend la vraie session. Jamais de vraie
conversation dans le dépôt : `design/` (maquettes, captures réelles) est ignoré par Git.
Captures Windows : lancer le dev avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
puis `Page.captureScreenshot` (CDP) à 1280×800, ×1.5 ; fichiers dans `docs/screenshots/` (JPEG).
Ne pas annoncer de chiffres non mesurés (mémoire : ~40 Mo pour le Rust, mais WebView2 ajoute
plusieurs centaines de Mo sous Windows).

## Captcha
`discord/captcha.rs` : sur une réponse avec `captcha_key`, `http.rs::send` ouvre une petite fenêtre
sur `https://discord.com/robots.txt` (la clé hCaptcha de Discord n'est valable que sur ce domaine),
remplace la page par le widget, récupère le jeton via une navigation sentinelle interceptée
(`https://dislite.invalid/captcha?token=…`), puis rejoue la requête avec `X-Captcha-Key`,
`X-Captcha-Rqtoken`, `X-Captcha-Session-Id`. Transparent pour le frontend. Test en dev :
`scripts/accord-eval '@captcha'` (clé de test publique de hCaptcha, aucun appel à Discord).

## Mises à jour
`updater.rs` + `tauri-plugin-updater` (endpoint GitHub `git-psi/Dislite`, clé publique dans
`tauri.conf.json`, privée dans `~/.tauri/dislite.key`, hors dépôt). Actives seulement en release, sous
Windows et en AppImage (`APPIMAGE`) ; pas pour .deb/AUR. Vérif. 30 s après le lancement puis toutes
les 24 h (réglage `autoUpdate` de `desktop.json`), installation sur demande (bandeau, réglages).
Les artefacts signés ne sont produits qu'en CI (`.github/workflows/release.yml`, `--config` avec
`createUpdaterArtifacts`) : une build locale n'a pas besoin de la clé. Version : `package.json` seul.

## Pièges connus
- En release, Tauri ajoute un nonce à la CSP, ce qui annule `'unsafe-inline'` : d'où
  `dangerousDisableAssetCspModification: ["style-src"]` (sinon styles en ligne bloqués).
- `tauri-plugin-single-instance` : relancer l'app ramène la fenêtre existante.

## Linux et Windows : un seul code
Tout le frontend et l'essentiel du Rust sont communs ; une modification d'interface vaut pour les
deux. Les seules différences sont des `#[cfg(...)]` (rien de spécifique côté TypeScript, hormis
`desktop_get().os` pour un texte d'aide) :
- `voice/audio.rs` : Linux → liste `pactl` + pont PipeWire (`PIPEWIRE_NODE`…) ; ailleurs → noms cpal (WASAPI).
- `desktop.rs` : autostart XDG (Linux) / clé `HKCU\…\Run` (Windows) ; test libappindicator Linux seulement.
- `commands.rs` : notifications `notify-rust` (Linux) / toasts `tauri-winrt-notification` (Windows,
  AUMID `dev.accord.client` en release, PowerShell en dev) ; `media_support` GStreamer (Linux) / `true` ;
  mode mini Hyprland Linux seulement.
- `discord/identity.rs` : UA et `os` = Chrome sous le vrai système ; langue `LANG` ou `GetUserDefaultLocaleName`.
- `storage.rs` : permissions 0600/0700 sous Unix seulement.
- `debug_bridge.rs` : socket Unix (Linux) / tube nommé `\\.\pipe\accord-debug` (Windows) ;
  `scripts/accord-eval` gère les deux (`python scripts/accord-eval '…'` sous Windows).
  La capture `@snapshot` reste Linux seulement.
- `lib.rs` : `WEBKIT_DISABLE_DMABUF_RENDERER` Linux seulement.
- `tauri.windows.conf.json` : bundle NSIS (installation par utilisateur).
