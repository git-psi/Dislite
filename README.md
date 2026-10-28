# Dislite

Client Discord minimaliste pour Linux et Windows : Rust (Tauri 2) + SolidJS.
Un seul code : les différences entre systèmes se limitent à quelques `#[cfg(...)]` côté Rust.

## Pré-requis (Arch / CachyOS)

```sh
sudo pacman -S --needed webkit2gtk-4.1 rustup nodejs npm base-devel
rustup default stable
```

## Pré-requis (Windows)

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Rustlang.Rustup OpenJS.NodeJS.LTS Kitware.CMake
```

WebView2 est déjà présent sous Windows 10/11.

## Lancer

```sh
npm install
npm run tauri icon src-tauri/icons/icon.svg   # une seule fois
npm run tauri dev                              # développement
npm run tauri build                            # binaire optimisé + .deb / AppImage (Linux), installeur NSIS (Windows)
```

Le binaire de release se trouve dans `src-tauri/target/release/dislite`.

## Publier une version (mises à jour automatiques)

Les installations Windows (installeur NSIS) et AppImage se mettent à jour depuis les Releases de
`git-psi/Dislite` : l'app lit `releases/latest/download/latest.json` au lancement puis une fois par
jour, et propose d'installer (rien n'est installé sans le demander). Les paquets sont signés : la
clé publique est dans `src-tauri/tauri.conf.json`, la clé privée dans `~/.tauri/dislite.key`
(**hors du dépôt ; la perdre empêche toute mise à jour future des installations existantes**).

Une seule fois, dans GitHub → Settings → Secrets and variables → Actions :
- `TAURI_SIGNING_PRIVATE_KEY` : le contenu de `~/.tauri/dislite.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : vide

À chaque version :
1. changer `version` dans `package.json` (seul endroit : Tauri la lit là) ;
2. `git tag v0.2.0 && git push --tags` ;
3. le workflow `Release` construit Windows + Linux et crée une Release **brouillon** :
   la publier (les installations ne voient que les Releases publiées).

Tant que le dépôt est **privé**, les installations ne peuvent pas télécharger `latest.json` :
les mises à jour automatiques ne marchent qu'une fois le dépôt public.

## Architecture

```
src-tauri/src/
  discord/identity.rs     identité « client web » (super properties, build number)
  discord/http.rs         API REST + rate limits (discord/ratelimit.rs)
  discord/gateway.rs      websocket zlib-stream, heartbeat, resume, reconnexion
  discord/remote_auth.rs  connexion par QR code
  commands.rs             commandes exposées au frontend
  storage.rs              token (fichier 0600) et cache

src/
  ipc/                    pont vers le Rust
  gateway/handlers/       un module par domaine d'événements (messages, serveurs…)
  store/                  état (state.ts), écritures (mutations.ts), dérivées (selectors.ts), UI (ui.ts)
  actions/                actions utilisateur (envoyer, réagir, naviguer…)
  lib/                    markdown, permissions, protobuf des réglages, CDN…
  components/             interface
```

Ajouter un événement gateway : un `on("EVENT", handler)` dans `src/gateway/handlers/`.
Ajouter un appel REST : une fonction dans `src/actions/` qui utilise `backend.api`.

## Notes

- Les clients tiers sont contraires aux conditions de Discord. Dislite se comporte
  comme le client web officiel et n'automatise rien, mais le risque n'est pas nul.
- Le vocal n'est pas encore géré.
- Les comptes sont stockés dans `~/.config/dev.accord.client/accounts.json` (permissions 0600),
  ou `%APPDATA%\dev.accord.client\accounts.json` sous Windows.
