<h1 align="center">
<img src="src-tauri/icons/128x128.png" alt="" height="96" align="middle">
&nbsp;&nbsp;Dislite
</h1>

[English version](README.md)

**Un client Discord léger et calme pour Linux et Windows : vocal natif, démarrage rapide, rien qui vous retient.**

Dislite parle directement à Discord, sans l'application officielle. Il s'ouvre en une seconde à
partir d'un instantané local, garde un style sobre (gris neutres, une seule couleur d'accent pour ce
qui compte) et est pensé pour rattraper ce qui est nouveau, puis retourner à sa journée. Rust
(Tauri 2) et SolidJS.

![Dislite : un salon de serveur](docs/screenshots/general.jpg)

> **Client non officiel.** Les clients tiers sont contraires aux conditions d'utilisation de
> Discord. Dislite se comporte comme le client web officiel et n'automatise rien, mais le risque
> n'est pas nul. À utiliser à vos risques.

## Ce qu'il y a dedans

<table>
<tr>
<td><img src="docs/screenshots/home.jpg" alt="Accueil" width="520"></td>
<td><b>Accueil</b><br>Ce qu'il reste à lire, les conversations récentes, les demandes d'ami et qui est en ligne, sur un seul écran. Le bouton <b>unread</b> en bas à gauche ouvre le suivant.</td>
</tr>
<tr>
<td><img src="docs/screenshots/forum.jpg" alt="Forums" width="520"></td>
<td><b>Forums</b><br>Les posts créés depuis votre dernière visite portent un badge <b>New</b>, les nouvelles réponses sont signalées, et les deux passent en tête. Un clic sur <b>New</b> n'affiche qu'eux.</td>
</tr>
<tr>
<td><img src="docs/screenshots/switcher.jpg" alt="Sélecteur rapide" width="520"></td>
<td><b>Sélecteur rapide</b> <code>Ctrl + K</code><br>N'importe quel salon, conversation, serveur ou personne, au clavier. <code>#</code> salons, <code>@</code> personnes, <code>*</code> serveurs.</td>
</tr>
<tr>
<td><img src="docs/screenshots/mini.jpg" alt="Mode mini" width="260"></td>
<td><b>Mode mini</b> <code>Ctrl + Maj + B</code><br>Une petite fenêtre toujours au premier plan : qui est dans l'appel, qui parle, micro, son, raccrocher. Ou seulement la discussion.</td>
</tr>
<tr>
<td><img src="docs/screenshots/settings.jpg" alt="Réglages du vocal" width="520"></td>
<td><b>Vocal natif</b><br>Salons vocaux et appels avec le chiffrement de bout en bout de Discord (DAVE). Suppression de bruit (RNNoise) et annulation d'écho (AEC3 de WebRTC), sur votre ordinateur.</td>
</tr>
<tr>
<td><img src="docs/screenshots/light.jpg" alt="Thème clair" width="520"></td>
<td><b>Clair ou sombre</b><br>Choisissez le thème, la couleur d'accent et la densité.</td>
</tr>
</table>

Et aussi :

- **Messages** : réponses, modifications, réactions, emoji, sondages, aperçus de liens, fichiers
  avec progression de l'envoi, épinglés, recherche, profils.
- **Plusieurs comptes** sur le même ordinateur, connexion par QR code.
- **Captchas** affichés dans une petite fenêtre quand Discord en demande un, puis l'action passe.
- **Mode focus** (`Ctrl + B`) : la conversation seule.
- **Masquer des serveurs** de la barre et les ranger à votre façon, sans rien changer sur Discord.
- **Notifications** avec boutons (ouvrir, rejoindre ou refuser un appel), icône dans la barre
  système, lancement à l'ouverture de session, démarrage réduit.
- **Mises à jour** téléchargées depuis les releases, installées quand vous le décidez.

Ce que Dislite laisse de côté exprès : vidéo et partage d'écran, administration des serveurs, envoi
de GIF, Stage, soundboard et activités.

## Installation

### Windows

Téléchargez `Dislite_x.y.z_x64-setup.exe` depuis la [dernière release](https://github.com/git-psi/Dislite/releases/latest)
et lancez-le. Pas besoin de droits administrateur. Dislite se met ensuite à jour tout seul.

### Linux

Depuis la [dernière release](https://github.com/git-psi/Dislite/releases/latest) :

- **AppImage** : rendez-le exécutable et lancez-le. Il se met à jour tout seul.
- **.deb** (Debian, Ubuntu) : `sudo apt install ./Dislite_x.y.z_amd64.deb`.

Les notifications à boutons, l'icône de la barre système et la lecture des vidéos utilisent les
bibliothèques habituelles du bureau (`libayatana-appindicator`, GStreamer). Sans GStreamer, les
vidéos s'ouvrent dans mpv ou le navigateur.

## Raccourcis

| Touches | Action |
|---|---|
| `Ctrl + K` | sélecteur rapide |
| `Ctrl + F` | rechercher dans le salon |
| `Ctrl + G` | tous les serveurs |
| `Ctrl + B` | mode focus |
| `Ctrl + Maj + B` | mode mini |
| `Alt + ↑` / `Alt + ↓` | salon précédent / suivant (`Maj` : non-lus seulement) |
| `Alt + ←` / `Alt + →`, boutons latéraux de la souris | précédent / suivant |
| `Échap` | marquer le salon comme lu et revenir en bas |

## Compiler depuis les sources

<details>
<summary>Linux (Arch, CachyOS…)</summary>

```sh
sudo pacman -S --needed webkit2gtk-4.1 rustup nodejs npm base-devel opus
rustup default stable
```

</details>

<details>
<summary>Windows</summary>

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Rustlang.Rustup OpenJS.NodeJS.LTS Kitware.CMake
```

WebView2 est déjà présent sous Windows 10 et 11.

</details>

```sh
npm install
npm run tauri dev      # développement
npm run tauri build    # installeur (Windows) ou .deb / AppImage (Linux)
```

La session et les réglages restent dans `~/.config/dev.accord.client/` (Linux) ou
`%APPDATA%\dev.accord.client\` (Windows).

<details>
<summary>Organisation du code</summary>

```
src-tauri/src/
  discord/          API REST, gateway, identité, connexion par QR code, captcha
  voice/            moteur vocal : gateway, UDP, chiffrement, DAVE, Opus, RNNoise, annulation d'écho
  commands.rs       commandes appelées par l'interface
  desktop.rs        barre système, lancement à l'ouverture de session, démarrage réduit
  updater.rs        mises à jour depuis les releases
  storage.rs        comptes et réglages sur le disque

src/
  gateway/handlers/ un fichier par type d'événement (messages, serveurs…)
  store/            état, écritures, données dérivées, état de l'interface
  actions/          ce que fait l'utilisateur (envoyer, réagir, naviguer…)
  components/       interface
  dev/              pont de débogage et données de démo (développement seulement)
```

</details>

Linux et Windows partagent le même code : les quelques différences sont des blocs `#[cfg(...)]`
côté Rust. Une modification de l'interface vaut pour les deux.

## Publier une version

1. Changez `version` dans `package.json` (Tauri la lit là).
2. `git tag v0.2.0 && git push --tags`.
3. Le workflow *Release* construit Windows et Linux, signe les paquets de mise à jour et crée une
   release brouillon avec `latest.json`. Publiez-la : les installations la récupèrent.

La clé de signature est le secret `TAURI_SIGNING_PRIVATE_KEY` du dépôt ; sa moitié publique est
dans `src-tauri/tauri.conf.json`.

## Licence

MIT (`LICENSE`). Sans lien avec Discord.

---

<p align="center">
Fait avec ❤️ · conçu par <a href="https://github.com/git-psi">git-psi</a>, développé avec
<a href="https://claude.com/claude-code">Claude</a>
</p>
