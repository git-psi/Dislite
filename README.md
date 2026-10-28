# Dislite

Client Discord minimaliste pour Linux : Rust (Tauri 2) + SolidJS.

## Pré-requis (Arch / CachyOS)

```sh
sudo pacman -S --needed webkit2gtk-4.1 rustup nodejs npm base-devel
rustup default stable
```

## Lancer

```sh
npm install
npm run tauri icon src-tauri/icons/icon.svg   # une seule fois
npm run tauri dev                              # développement
npm run tauri build                            # binaire optimisé + .deb / AppImage
```

Le binaire de release se trouve dans `src-tauri/target/release/dislite`.

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
- Le token est stocké dans `~/.config/dev.accord.client/session.json` (permissions 0600).
