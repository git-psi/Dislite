# Paquet AUR `dislite-bin`

Reprend le `.deb` publié dans les Releases GitHub (même binaire, rien à compiler). Pas de mise
à jour intégrée dans ce cas : c'est pacman / l'assistant AUR qui met à jour.

## Tester (sur Arch / CachyOS)

```sh
cd packaging/aur/dislite-bin
makepkg -si          # télécharge, vérifie les sommes, construit et installe
namcap PKGBUILD *.pkg.tar.zst   # vérifications (paquet namcap)
```

À vérifier : Dislite dans le menu avec son icône, lancement, connexion restaurée, vocal,
notifications, icône de la barre système (avec `libayatana-appindicator`).
Désinstaller : `sudo pacman -R dislite-bin`.

## Publier (une seule fois)

1. Compte sur https://aur.archlinux.org avec une clé SSH publique.
2. Dépôt du paquet (créé au premier push) :

```sh
git clone ssh://aur@aur.archlinux.org/dislite-bin.git aur-dislite-bin
cp packaging/aur/dislite-bin/{PKGBUILD,.SRCINFO} aur-dislite-bin/
cd aur-dislite-bin
git add PKGBUILD .SRCINFO
git commit -m "dislite-bin 0.1.0"
git push
```

## À chaque nouvelle version

Après la publication de la Release `vX.Y.Z` :

```sh
cd packaging/aur/dislite-bin
sed -i 's/^pkgver=.*/pkgver=X.Y.Z/; s/^pkgrel=.*/pkgrel=1/' PKGBUILD
updpkgsums                         # met à jour les sommes (paquet pacman-contrib)
makepkg --printsrcinfo > .SRCINFO
makepkg -si                        # tester
```

Puis copier `PKGBUILD` et `.SRCINFO` dans le dépôt AUR, commit, push.
