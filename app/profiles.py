"""
Profils de sortie FFmpeg.

Ces profils couvrent les formats couramment acceptés par les serveurs de
diffusion professionnels de type Cynergie (MXF XDCAM/IMX/DNxHD/AVC-Intra en
ingest broadcast) ainsi que quelques formats complémentaires ("et plus") utiles
pour la prévisualisation, l'archivage ou la diffusion IP.

Chaque profil décrit :
  - container : extension/conteneur de sortie
  - video / audio : arguments ffmpeg (hors -i et fichier de sortie)
  - notes : remarques opérationnelles affichées dans l'interface
  - certified : indique si le mapping est un standard broadcast reconnu tel
    quel, ou une reconstruction "au mieux" à valider avant mise en prod
    (le muxer MXF de ffmpeg n'est pas un outil de qualification broadcast
    officiel : un test d'ingest réel dans Cynergie reste recommandé).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Profile:
    id: str
    label: str
    category: str
    container: str
    description: str
    video: list
    audio: list
    extra: list = field(default_factory=list)
    certified: bool = True
    notes: str = ""


CATEGORIES = [
    ("broadcast_hd", "Diffusion HD (MXF)"),
    ("broadcast_sd", "Diffusion SD (MXF)"),
    ("mezzanine", "Mezzanine / échange post-production"),
    ("delivery", "Prévisualisation / diffusion IP"),
]

PROFILES: dict[str, Profile] = {}


def _register(p: Profile) -> None:
    PROFILES[p.id] = p


# ---------------------------------------------------------------------------
# Profils broadcast HD (formats attendus en ingest par la plupart des serveurs
# de diffusion, dont Cynergie)
# ---------------------------------------------------------------------------

_register(Profile(
    id="xdcam_hd422_50",
    label="XDCAM HD422 50 Mb/s (MXF, 1080i25)",
    category="broadcast_hd",
    container="mxf",
    description=(
        "Format de diffusion HD standard en France (MPEG-2 4:2:2 long-GOP, "
        "50 Mb/s CBR, 1080i25, audio PCM). C'est le profil d'ingest HD le plus "
        "largement accepté par les serveurs de diffusion professionnels."
    ),
    video=[
        "-c:v", "mpeg2video", "-pix_fmt", "yuv422p",
        "-b:v", "50M", "-minrate", "50M", "-maxrate", "50M", "-bufsize", "17825792",
        "-g", "12", "-bf", "2", "-flags", "+ildct+ilme", "-top", "1",
        "-r", "25", "-s", "1920x1080",
    ],
    audio=["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"],
    extra=["-f", "mxf"],
    notes="Profil recommandé par défaut pour l'ingest HD Cynergie.",
))

_register(Profile(
    id="xdcam_hd_35",
    label="XDCAM HD 35 Mb/s (MXF, 1080i25)",
    category="broadcast_hd",
    container="mxf",
    description=(
        "Variante 4:2:0 à 35 Mb/s, débit réduit par rapport au 422/50, utile "
        "quand la bande passante de stockage est contrainte."
    ),
    video=[
        "-c:v", "mpeg2video", "-pix_fmt", "yuv420p",
        "-b:v", "35M", "-minrate", "35M", "-maxrate", "35M", "-bufsize", "12500000",
        "-g", "12", "-bf", "2", "-flags", "+ildct+ilme", "-top", "1",
        "-r", "25", "-s", "1920x1080",
    ],
    audio=["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"],
    extra=["-f", "mxf"],
))

_register(Profile(
    id="dnxhd_120",
    label="Avid DNxHD 120 Mb/s (MXF, 1080i25)",
    category="broadcast_hd",
    container="mxf",
    description=(
        "Codec intra-frame Avid, fréquent dans les chaînes qui utilisent un "
        "atelier de montage Avid en amont du playout."
    ),
    video=[
        "-c:v", "dnxhd", "-profile:v", "dnxhd", "-b:v", "120M",
        "-pix_fmt", "yuv422p", "-s", "1920x1080", "-r", "25",
        "-flags", "+ildct+ilme", "-top", "1",
    ],
    audio=["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"],
    extra=["-f", "mxf"],
    notes="Nécessite une résolution/cadence exacte prise en charge par l'encodeur DNxHD (1920x1080, 25 i/s).",
))

_register(Profile(
    id="avc_intra_100",
    label="H.264 Intra ≈ AVC-Intra 100 (MXF, 1080i25)",
    category="broadcast_hd",
    container="mxf",
    description=(
        "Reconstruction par libx264 en tout-intra, profil High 4:2:2, proche "
        "d'un flux AVC-Intra 100. Ce n'est pas un flux AVC-Intra certifié "
        "Panasonic P2 : à valider par un test d'ingest avant usage en régie."
    ),
    video=[
        "-c:v", "libx264", "-profile:v", "high422", "-pix_fmt", "yuv422p10le",
        "-b:v", "100M", "-minrate", "100M", "-maxrate", "100M", "-bufsize", "50M",
        "-g", "1", "-bf", "0", "-s", "1920x1080", "-r", "25",
    ],
    audio=["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"],
    extra=["-f", "mxf"],
    certified=False,
    notes="Approximation non certifiée AVC-Intra : à tester avant mise en production.",
))

# ---------------------------------------------------------------------------
# Profils broadcast SD
# ---------------------------------------------------------------------------

_register(Profile(
    id="imx50_d10",
    label="IMX50 / D10 (MXF, SD 4:2:2, 50 Mb/s)",
    category="broadcast_sd",
    container="mxf",
    description=(
        "Format SD intra-frame historique (MPEG-2 4:2:2, tout-intra, 50 Mb/s), "
        "très largement compatible avec les régies de diffusion SD, y compris "
        "les plus anciennes."
    ),
    video=[
        "-c:v", "mpeg2video", "-pix_fmt", "yuv422p",
        "-b:v", "50M", "-minrate", "50M", "-maxrate", "50M", "-bufsize", "17825792",
        "-g", "1", "-bf", "0", "-flags", "+ildct+ilme", "-top", "1",
        "-r", "25", "-s", "720x576",
    ],
    audio=["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"],
    extra=["-f", "mxf"],
))

# ---------------------------------------------------------------------------
# Mezzanine / échange
# ---------------------------------------------------------------------------

_register(Profile(
    id="prores_hq",
    label="Apple ProRes 422 HQ (MOV)",
    category="mezzanine",
    container="mov",
    description=(
        "Codec mezzanine haute qualité, pratique pour l'échange avec un poste "
        "de montage Final Cut / Avid ou pour l'archivage qualité avant "
        "diffusion."
    ),
    video=[
        "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
        "-vendor", "apl0", "-r", "25",
    ],
    audio=["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"],
    extra=[],
))

_register(Profile(
    id="mpeg2_ts",
    label="MPEG-2 TS (flux de transport, HD/SD)",
    category="mezzanine",
    container="ts",
    description=(
        "Flux de transport MPEG-2, utile pour les chaînes d'injection IP ou "
        "les serveurs de diffusion acceptant un .ts en entrée plutôt qu'un "
        "fichier MXF."
    ),
    video=[
        "-c:v", "mpeg2video", "-b:v", "15M", "-minrate", "15M", "-maxrate", "15M",
        "-bufsize", "5M", "-g", "12", "-bf", "2", "-r", "25",
    ],
    audio=["-c:a", "mp2", "-b:a", "384k", "-ar", "48000", "-ac", "2"],
    extra=["-f", "mpegts"],
))

# ---------------------------------------------------------------------------
# Prévisualisation / diffusion IP ("et plus")
# ---------------------------------------------------------------------------

_register(Profile(
    id="h264_mp4_delivery",
    label="H.264 MP4 (prévisualisation / IP, haute qualité)",
    category="delivery",
    container="mp4",
    description=(
        "Format compact pour la prévisualisation rapide par les opérateurs, "
        "l'archivage web ou les chaînes de diffusion IP acceptant du H.264."
    ),
    video=[
        "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart",
    ],
    audio=["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2"],
    extra=[],
    certified=False,
    notes="Non conçu pour un ingest broadcast MXF classique : à réserver au contrôle qualité ou à la diffusion IP moderne.",
))

_register(Profile(
    id="h265_mp4_delivery",
    label="H.265/HEVC MP4 (diffusion IP basse bande passante)",
    category="delivery",
    container="mp4",
    description=(
        "Compression plus poussée que le H.264 pour les usages IP à bande "
        "passante réduite (relais distants, prévisualisation à distance)."
    ),
    video=[
        "-c:v", "libx265", "-preset", "slow", "-crf", "20",
        "-pix_fmt", "yuv420p10le", "-r", "25", "-tag:v", "hvc1",
    ],
    audio=["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"],
    extra=[],
    certified=False,
))


def list_profiles() -> list[dict]:
    result = []
    for cat_id, cat_label in CATEGORIES:
        items = [p for p in PROFILES.values() if p.category == cat_id]
        if not items:
            continue
        result.append({
            "category": cat_id,
            "category_label": cat_label,
            "profiles": [
                {
                    "id": p.id,
                    "label": p.label,
                    "container": p.container,
                    "description": p.description,
                    "certified": p.certified,
                    "notes": p.notes,
                }
                for p in items
            ],
        })
    return result


def get_profile(profile_id: str) -> Profile:
    if profile_id not in PROFILES:
        raise KeyError(f"Profil inconnu: {profile_id}")
    return PROFILES[profile_id]
