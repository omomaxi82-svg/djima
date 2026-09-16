# Djima

Outil interne de **correction et transcodage de fichiers** avant ingest dans le playout **Cynergie**, base sur **FFmpeg** (logiciel libre).

## Pourquoi cet outil

Cynergie bascule automatiquement sur une mire de barres ou un bumper des qu'il rencontre un fichier anormal (introuvable, corrompu, codec non gere, image noire prolongee). La seule parade fiable est de garantir que le fichier est correct **avant** de l'injecter dans le playout.

A la SRTB, faute d'avoir pu renouveler les serveurs de diffusion, nous n'avons pas la suite d'outils de transcodage habituellement livree avec un logiciel de diffusion professionnel. Djima comble ce manque avec FFmpeg :

- un **dossier d'entree** surveille en continu,
- une **analyse automatique** (lisibilite, codec, image noire prolongee),
- un **transcodage** vers un des formats acceptes par Cynergie (ou d'autres formats utiles : post-prod, archivage, previsualisation web),
- une **verification du fichier de sortie** avant de le deposer dans le dossier de sortie utilise par Cynergie : un fichier encore suspect part en quarantaine plutot que d'etre livre silencieusement au playout.

## Fonctionnement

```
[Dossier d'entree] --watch--> [Analyse FFprobe/FFmpeg] --> [Transcodage FFmpeg] --> [Verification] --> [Dossier de sortie (Cynergie)]
                                                                                         |
                                                                                         +--> anomalie persistante --> [Quarantaine / a verifier]
```

L'interface web permet de suivre tout cela en temps reel (websocket), de lancer des transcodages manuels ou de configurer l'automatisation complete (fichier depose => transcode => livre).

## Presets de codecs fournis

| Preset | Categorie | Conteneur | Usage |
|---|---|---|---|
| XDCAM HD422 50 Mb/s | Cynergie / Diffusion | MXF | Ingest broadcast standard 1080i25, PCM 48kHz |
| MPEG IMX 50 Mb/s | Cynergie / Diffusion | MXF | Ingest SD historique |
| Avid DNxHD 120 Mb/s | Cynergie / Diffusion | MXF | Format intermediaire tres compatible |
| H.264 High Profile | Cynergie / Diffusion | MP4 | Compatible avec les ingest modernes MP4/MOV |
| MPEG-2 TS | Cynergie / Diffusion | TS | Flux de transport DVB |
| Apple ProRes 422 | Post-production | MOV | Montage, pas pour l'ingest direct |
| H.265 / HEVC | Archivage | MP4 | Gain de place pour le stockage long terme |
| Proxy web H.264 | Autres | MP4 | Verification rapide dans un navigateur |

**Important** : ces presets sont des points de depart raisonnables pour un ingest broadcast, mais chaque installation Cynergie peut avoir un cahier des charges d'ingest specifique (bitrate exact, GOP, nombre de canaux audio embarques, etc.). Verifiez et ajustez les presets marques "recommande Cynergie" avec l'equipe technique avant une mise en production, et ajoutez vos propres presets depuis l'onglet **Reglages** si besoin (les arguments FFmpeg sont entierement personnalisables).

## Ce que Djima peut corriger (et ce qu'il ne peut pas)

Un transcodage avec options de resilience (`-err_detect ignore_err`, regeneration des timestamps) resout la plupart des soucis de conteneur/metadonnees et remet le fichier dans un codec standard. En revanche, une image reellement noire ou un flux dont les donnees sources sont detruites ne peuvent pas etre "reparees" par un simple transcodage : Djima les detecte et les isole en quarantaine pour verification humaine plutot que de les livrer au playout.

## Prerequis

- Node.js >= 18
- FFmpeg et FFprobe installes et presents dans le `PATH` du serveur (`apt install ffmpeg` sous Debian/Ubuntu, ou paquet equivalent)

## Installation (sans Docker)

```bash
git clone <ce-depot> djima
cd djima
npm install
npm start
```

L'interface est alors disponible sur `http://<serveur>:4590`.

Pour un demarrage automatique au boot sur un serveur Linux :

```bash
sudo ./scripts/install-systemd.sh
```

## Installation avec Docker

```bash
docker compose up -d --build
```

Adaptez les volumes de `docker-compose.yml` pour pointer vers vos partages reseau reels d'entree/sortie, puis renseignez les chemins correspondants (cotes conteneur) dans l'onglet **Reglages** de l'interface.

## Configuration

Tout se regle depuis l'onglet **Reglages** de l'interface :

- dossier d'entree, dossier de sortie (celui lu par Cynergie), dossier de quarantaine,
- nombre de transcodages simultanes (a limiter selon la puissance du serveur),
- transcodage automatique a l'arrivee d'un fichier (avec un preset par defaut),
- sensibilite de la detection d'image noire,
- protection de l'interface par mot de passe (recommande si le serveur est accessible sur le reseau general).

La configuration et l'historique des jobs sont stockes dans `data/` (fichiers JSON, aucune base de donnees externe requise).

## Securite

- L'authentification HTTP basique est optionnelle mais recommandee des que l'interface est exposee au-dela d'un poste unique.
- Le dossier de sortie n'est alimente qu'avec des fichiers ayant passe la verification post-transcodage ; toute anomalie persistante est isolee en quarantaine, jamais livree silencieusement.

## Licence

FFmpeg est un logiciel libre (LGPL/GPL selon les composants actives). Ce projet est fourni pour un usage interne SRTB.
