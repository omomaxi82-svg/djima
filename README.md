# Atelier de transcodage FFmpeg — SRTB

Application web open source, basée sur **FFmpeg**, pour corriger et
transcoder les fichiers vidéo avant leur ingest dans le playout **Cynergie**.

## Contexte

Cynergie bascule automatiquement sur une mire de barres ou un bumper dès
qu'il rencontre une anomalie sur un fichier : fichier introuvable, corrompu,
codec manquant, noir prolongé. Le logiciel de diffusion attend donc des
fichiers déjà conformes en entrée.

Faute de budget pour renouveler les serveurs de diffusion (et la suite
d'outils de transcodage qui les accompagne habituellement), cette
application propose une alternative open source basée sur FFmpeg :

- un **dossier d'entrée** où les opérateurs déposent les fichiers bruts ;
- une **interface web** pour analyser ces fichiers, détecter les anomalies
  probables (codec non identifié, cadence non conforme, plans noirs
  prolongés, fichier illisible) et lancer un transcodage vers un format de
  diffusion reconnu ;
- un **dossier de sortie** contenant les fichiers prêts à être injectés dans
  Cynergie.

## Fonctionnalités

- Interface web sombre, pensée régie, avec suivi de progression en temps
  réel (Server-Sent Events).
- Dépôt de fichiers par glisser-déposer ou sélection, en plus de la
  surveillance directe du dossier d'entrée.
- Analyse automatique (via `ffprobe`) : codec vidéo/audio, résolution,
  cadence image, entrelacement, fréquence d'échantillonnage audio, durée —
  avec un verdict **conforme / à risque / corrompu**.
- Détection optionnelle des **plans noirs prolongés** (`blackdetect`).
- Large choix de **profils de sortie** couvrant les formats broadcast les
  plus courants (voir ci-dessous) et quelques formats complémentaires.
- Options de correction : normalisation de la loudness (EBU R128,
  -23 LUFS, mesure en 2 passes), désentrelacement, rognage des noirs en
  tête/fin, réinitialisation du timecode.
- Vérification automatique du fichier généré après transcodage (relecture
  `ffprobe`) avant de le considérer comme prêt.
- Historique des jobs, téléchargement et suppression des fichiers de
  sortie.

## Profils de sortie proposés

| Profil | Conteneur | Usage |
|---|---|---|
| XDCAM HD422 50 Mb/s | MXF | Profil de diffusion HD standard, recommandé par défaut pour Cynergie |
| XDCAM HD 35 Mb/s | MXF | Variante HD à débit réduit |
| Avid DNxHD 120 Mb/s | MXF | Chaînes avec montage Avid en amont |
| H.264 Intra ≈ AVC-Intra 100 | MXF | Approximation non certifiée, à valider avant prod |
| IMX50 / D10 | MXF | Diffusion SD, très large compatibilité |
| Apple ProRes 422 HQ | MOV | Mezzanine / échange post-production |
| MPEG-2 TS | TS | Injection IP / flux de transport |
| H.264 MP4 | MP4 | Prévisualisation rapide, diffusion IP |
| H.265/HEVC MP4 | MP4 | Diffusion IP basse bande passante |

Les profils marqués « à valider » dans l'interface sont des reconstructions
FFmpeg au mieux (ex. AVC-Intra) : le muxer MXF de FFmpeg n'est pas un outil
de qualification broadcast officiel. **Avant toute mise en production,
testez un ingest réel dans Cynergie** avec un fichier de chaque profil
utilisé sur votre serveur.

## Installation

### Avec Docker (recommandé)

```bash
docker compose up -d --build
```

L'interface est alors disponible sur `http://<serveur>:8090`. Les dossiers
`watch/in`, `watch/out` et `watch/archive` du dépôt sont montés dans le
conteneur : déposez les fichiers à corriger dans `watch/in`.

### Installation manuelle (sans Docker)

Prérequis : Python 3.10+, FFmpeg/ffprobe installés sur la machine.

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp config.example.yaml config.yaml
# adapter input_dir / output_dir / max_parallel_jobs dans config.yaml

python run.py --config config.yaml
```

Un exemple de service `systemd` pour un démarrage automatique est fourni
dans `deploy/broadcast-transcoder.service`.

## Configuration

Voir `config.example.yaml` pour la liste complète des paramètres
(dossiers d'entrée/sortie/archive, chemins des binaires ffmpeg/ffprobe,
nombre de transcodages en parallèle, port d'écoute).

En environnement Docker, ces paramètres peuvent aussi être définis par
variables d'environnement : `INPUT_DIR`, `OUTPUT_DIR`, `ARCHIVE_DIR`,
`FFMPEG_BIN`, `FFPROBE_BIN`, `MAX_PARALLEL_JOBS`, `HOST`, `PORT`.

## Utilisation

1. Déposez les fichiers à corriger dans le dossier d'entrée (via
   l'interface ou directement sur le partage réseau monté sur ce dossier).
2. Cliquez sur **Analyser** pour vérifier la conformité d'un fichier avant
   transcodage (codec, cadence, audio, plans noirs).
3. Sélectionnez un ou plusieurs fichiers, choisissez un profil de sortie et
   les options de correction nécessaires, puis lancez le transcodage.
4. Suivez la progression en temps réel dans la section « Suivi des
   transcodages ».
5. Une fois le job terminé, récupérez le fichier dans le dossier de sortie
   (ou téléchargez-le depuis l'interface) et injectez-le dans Cynergie.

## Limites connues / points à tester

- Le muxage MXF (OP1a) de FFmpeg est fonctionnel mais n'embarque pas les
  métadonnées étendues (UMID complet, métadonnées AS-11/DPP, etc.) de
  certaines chaînes d'ingest professionnelles : validez un fichier test par
  profil directement dans Cynergie.
- Le rognage automatique des noirs ne traite que les plans noirs en tout
  début ou toute fin de fichier, par prudence (pas de coupe au milieu du
  programme).
- L'application ne remplace pas une supervision humaine : le verdict
  « conforme » signale l'absence d'anomalie détectable automatiquement, pas
  une garantie d'acceptation par Cynergie.
