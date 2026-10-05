"""
Service du Bot Telegram Intelligent d'Igitoro Live (Architecture Monolithique FastAPI / Railway).

Fonctionnalités :
1. Cycle de vie (lifespan) : Enregistrement automatique du Webhook Telegram au démarrage.
2. Analyse Multimodale (Texte WhatsApp transféré & Photo/Image de fiche de distribution) via Gemini.
3. Structuration JSON stricte : [{station_name, fuel_type, status, details}].
4. Moteur de Fuzzy Matching (correspondance floue) adapté aux noms de stations de Bujumbura.
5. Pré-validation interactive obligatoire par boutons Inline Keyboard ([ ✅ Confirmer la mise à jour ] / [ ❌ Annuler ]).
6. Commandes d'administration (/stats, /bilan, /help) et gestion complète des erreurs.
"""

from __future__ import annotations

import difflib
import json
import logging
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ActionLog, Report, Station, TelegramPendingBatch, User

logger = logging.getLogger("igitoro.telegram_bot")

# Client HTTP asynchrone partagé pendant toute la durée de vie du processus FastAPI
_http_client: httpx.AsyncClient | None = None

# Dictionnaire de synonymes et raccourcis courants sur les groupes WhatsApp à Bujumbura
BUJUMBURA_ALIASES: dict[str, str] = {
    "brarudi": "brasserie",
    "brasserie": "brasserie",
    "regideso": "vip",
    "musee": "musee vivant",
    "marche": "marche central",
    "kingstar": "king star",
    "inter": "interpetrol",
    "interpetrole": "interpetrol",
    "kigobe": "kigobe city oil",
    "gare": "gare du sud",
    "quick": "quick service",
    "safali": "safari",
    "yakeime": "yakeime oil kinindo",
    "gasoil": "mazout",
    "gazoil": "mazout",
    "diesel": "mazout",
}

STOP_WORDS = {
    "station",
    "service",
    "bujumbura",
    "burundi",
    "chez",
    "de",
    "du",
    "la",
    "le",
    "les",
    "au",
    "aux",
    "pres",
    "vers",
    "quartier",
    "commune",
}


# ==============================================================================
# 1. SCHÉMA DE SORTIE JSON STRICT POUR L'IA (TEXTE & VISION)
# ==============================================================================
class ExtractedStationReport(BaseModel):
    station_name: str = Field(
        description="Nom de la station-service tel que mentionné dans le message ou le tableau."
    )
    fuel_type: str = Field(
        description="Type de carburant : 'essence', 'mazout', 'both' (les deux) ou 'unspecified'."
    )
    status: str = Field(
        description="Statut : 'distribution' (sert actuellement), 'starting' (dépotage/commence), 'no_fuel' (pas de carburant/sec), ou 'unknown'."
    )
    details: str = Field(
        default="",
        description="Détails supplémentaires (file d'attente, livraison camion-citerne, quota, heure)."
    )


# ==============================================================================
# 2. GESTION DU CYCLE DE VIE (LIFESPAN FASTAPI) & CLIENT TELEGRAM API
# ==============================================================================
def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=10.0))
    return _http_client


async def setup_telegram_webhook() -> None:
    """
    Initialise le client HTTP et configure automatiquement le Webhook Telegram
    au démarrage de FastAPI (lifespan).
    """
    get_http_client()
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        logger.info("TELEGRAM_BOT_TOKEN non défini : le bot Telegram est en mode veille.")
        return

    webhook_url = f"{settings.public_base_url.rstrip('/')}/api/telegram/webhook"
    payload: dict[str, Any] = {
        "url": webhook_url,
        "allowed_updates": ["message", "callback_query"],
        "drop_pending_updates": False,
    }
    if settings.sanitized_webhook_secret:
        payload["secret_token"] = settings.sanitized_webhook_secret

    try:
        client = get_http_client()
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json=payload,
        )
        data = resp.json()
        if data.get("ok"):
            logger.info("Webhook Telegram enregistré avec succès sur %s", webhook_url)
        else:
            logger.warning("Échec de l'enregistrement du Webhook Telegram : %s", data)
    except Exception as exc:
        logger.error("Erreur lors de l'initialisation du Webhook Telegram : %s", exc)


async def close_telegram_client() -> None:
    """Ferme proprement le client HTTP asynchrone à l'arrêt de FastAPI."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


async def telegram_api_call(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Appelle une méthode de l'API Bot Telegram de manière asynchrone."""
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        return {"ok": False, "description": "TELEGRAM_BOT_TOKEN non configuré"}

    client = get_http_client()
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        resp = await client.post(url, json=payload)
        return resp.json()
    except Exception as exc:
        logger.error("Erreur d'appel Telegram API (%s) : %s", method, exc)
        return {"ok": False, "description": str(exc)}


async def download_telegram_photo(file_id: str) -> tuple[bytes | None, str]:
    """
    Récupère le chemin du fichier via getFile puis télécharge les octets de l'image
    envoyée par l'administrateur sur Telegram.
    """
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        return None, "image/jpeg"

    client = get_http_client()
    try:
        info_resp = await client.get(
            f"https://api.telegram.org/bot{token}/getFile",
            params={"file_id": file_id},
        )
        info_data = info_resp.json()
        file_path = info_data.get("result", {}).get("file_path")
        if not file_path:
            return None, "image/jpeg"

        file_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
        img_resp = await client.get(file_url)
        if img_resp.status_code != 200:
            return None, "image/jpeg"

        mime = "image/png" if file_path.lower().endswith(".png") else "image/jpeg"
        return img_resp.content, mime
    except Exception as exc:
        logger.error("Erreur lors du téléchargement de la photo Telegram : %s", exc)
        return None, "image/jpeg"


# ==============================================================================
# 3. MOTEUR DE FUZZY MATCHING (CORRESPONDANCE FLOUE DES STATIONS)
# ==============================================================================
def normalize_station_str(text: str) -> str:
    """Normalise une chaîne (sans accents, minuscules, synonymes locaux de Bujumbura)."""
    if not text:
        return ""
    nfd = unicodedata.normalize("NFD", text.lower())
    clean = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    clean = re.sub(r"[^a-z0-9\s]", " ", clean)
    tokens = []
    for tok in clean.split():
        if tok in STOP_WORDS:
            continue
        mapped = BUJUMBURA_ALIASES.get(tok, tok)
        tokens.extend(mapped.split())
    return " ".join(tokens)


def match_station_fuzzy(
    extracted_name: str,
    stations: list[Station],
    threshold: float = 0.52,
) -> tuple[Station | None, float]:
    """
    Associe un nom extrait approximatif (ex: 'interpetrol brarudi', 'kobil kizingwe')
    avec l'enregistrement Station exact dans PostgreSQL.

    Retourne (Station | None, score_de_confiance entre 0.0 et 1.0).
    """
    query_norm = normalize_station_str(extracted_name)
    if not query_norm:
        return None, 0.0

    query_tokens = set(query_norm.split())
    best_station: Station | None = None
    best_score: float = 0.0

    for st in stations:
        if not st.is_active:
            continue

        name_norm = normalize_station_str(st.name or "")
        brand_norm = normalize_station_str(st.brand or "")
        zone_norm = normalize_station_str(st.zone or "")
        landmark_norm = normalize_station_str(getattr(st, "landmarks", "") or getattr(st, "landmark", "") or "")

        candidate_full = f"{name_norm} {brand_norm} {zone_norm} {landmark_norm}".strip()
        cand_name_tokens = set(f"{name_norm} {zone_norm}".split())
        cand_all_tokens = set(candidate_full.split())

        # 1. Correspondance exacte ou inclusion directe du nom normalisé
        if query_norm == name_norm:
            return st, 1.0

        # 2. Score de recouvrement des jetons (Jaccard pondéré sur Nom + Quartier + Repère)
        overlap_main = len(query_tokens & cand_name_tokens) / max(len(query_tokens), 1)
        overlap_all = len(query_tokens & cand_all_tokens) / max(len(query_tokens), 1)

        # 3. Ratio de similarité de séquence (Levenshtein / Ratcliff-Obershelp via difflib)
        seq_name = difflib.SequenceMatcher(None, query_norm, name_norm).ratio()
        seq_zone = difflib.SequenceMatcher(None, query_norm, f"{brand_norm} {zone_norm}".strip()).ratio()

        score = max(
            seq_name,
            seq_zone,
            (overlap_main * 0.75) + (seq_name * 0.25),
            (overlap_all * 0.70) + (max(seq_name, seq_zone) * 0.30),
        )

        # Bonus si la marque ET la zone/repère correspondent simultanément (ex: "interpetrol brarudi")
        if brand_norm and brand_norm in query_tokens:
            if (zone_norm and any(z in query_tokens for z in zone_norm.split())) or (
                landmark_norm and any(l in query_tokens for l in landmark_norm.split())
            ):
                score = max(score, 0.92)

        if score > best_score:
            best_score = score
            best_station = st

    if best_score >= threshold and best_station is not None:
        return best_station, round(min(best_score, 1.0), 2)

    return None, round(best_score, 2)


# ==============================================================================
# 4. EXTRACTION MULTIMODALE (GEMINI LLM / VISION + FALLBACK DÉTERMINISTE)
# ==============================================================================
def normalize_fuel_type(raw: str) -> str:
    val = (raw or "").strip().lower()
    has_ess = any(k in val for k in ("essence", "super", "ess", "sans plomb", "both", "deux"))
    has_maz = any(k in val for k in ("mazout", "gasoil", "gazoil", "diesel", "maz", "both", "deux"))
    if val == "both" or (has_ess and has_maz):
        return "both"
    if has_ess:
        return "essence"
    if has_maz:
        return "mazout"
    return "unspecified"


def normalize_fuel_status(raw: str) -> str:
    val = (raw or "").strip().lower()
    if val in ("distribution", "starting", "no_fuel", "unknown"):
        return val
    if any(k in val for k in ("dispo", "distrib", "sert", "ouvert", "oui", "ok", "present")):
        return "distribution"
    if any(k in val for k in ("commence", "depotage", "camion", "citerne", "bientot", "attente")):
        return "starting"
    if any(k in val for k in ("sec", "epuise", "rien", "ferme", "pas de", "non", "rupture", "no_fuel")):
        return "no_fuel"
    return "distribution"


def infer_queue_status(details: str) -> str:
    d = (details or "").lower()
    if any(k in d for k in ("longue", "tres longue", "embouteillage", "satur")):
        return "long"
    if any(k in d for k in ("moyenne", "moderee")):
        return "medium"
    if any(k in d for k in ("courte", "fluide", "rapide", "peu de monde")):
        return "short"
    if any(k in d for k in ("aucune file", "pas de file", "sans file")):
        return "none"
    return "unknown"


def fallback_heuristic_parse(raw_text: str, stations: list[Station]) -> list[dict[str, Any]]:
    """
    Analyseur de secours déterministe pour les messages WhatsApp ligne par ligne
    lorsque la clé Gemini n'est pas configurée ou en cas d'indisponibilité réseau.
    """
    results: list[dict[str, Any]] = []
    if not raw_text:
        return results

    lines = [ln.strip(" -•*\t") for ln in raw_text.splitlines() if ln.strip()]
    current_fuel = "unspecified"

    for line in lines:
        low = line.lower()
        # Détection d'en-tête de section (ex: "ESSENCE :", "MAZOUT :")
        if len(line) < 28 and any(k in low for k in ("essence", "mazout", "gasoil", "diesel")) and ":" in line:
            current_fuel = normalize_fuel_type(low)
            continue

        matched_st, score = match_station_fuzzy(line, stations, threshold=0.45)
        fuel = normalize_fuel_type(low)
        if fuel == "unspecified":
            fuel = current_fuel if current_fuel != "unspecified" else "both"

        status = normalize_fuel_status(low)
        if matched_st or any(
            brand in low
            for brand in ("kobil", "interpetrol", "mogas", "engen", "total", "delta", "city oil", "vip", "king star", "kimoil", "safari", "mega oil")
        ):
            results.append(
                {
                    "station_name": matched_st.name if matched_st else line.split("-")[0].split(":")[0].strip(),
                    "fuel_type": fuel,
                    "status": status,
                    "details": line,
                }
            )
    return results


async def extract_reports_with_ai(
    raw_text: str | None = None,
    image_bytes: bytes | None = None,
    mime_type: str = "image/jpeg",
    stations: list[Station] | None = None,
) -> list[dict[str, Any]]:
    """
    Analyse un message texte (WhatsApp transféré) et/ou une image (fiche de distribution)
    avec Gemini (gemini-3.8-flash) et retourne un tableau JSON strict :
    [{station_name, fuel_type, status, details}].
    """
    station_catalog = ", ".join(
        f"{s.name} ({s.zone})" for s in (stations or []) if s.is_active
    )

    system_prompt = (
        "Tu es l'assistant d'extraction de données d'Igitoro Live à Bujumbura (Burundi). "
        "Analyse le message texte (souvent transféré depuis WhatsApp) ou l'image (tableau/fiche de distribution de carburant) "
        "et extrais toutes les stations-service mentionnées sous forme d'une liste JSON stricte.\n"
        f"Catalogue officiel des stations de Bujumbura pour t'aider à reconnaître les noms : {station_catalog}.\n"
        "Règles de normalisation :\n"
        "- station_name : nom de la station (ex: 'InterPetrol Brasserie', 'Kobil Kizingwe').\n"
        "- fuel_type : 'essence', 'mazout', 'both' (si Essence et Mazout/Gasoil), ou 'unspecified'.\n"
        "- status : 'distribution' (carburant disponible / inscrit sur la fiche de distribution du jour), "
        "'starting' (dépotage / camion en cours), 'no_fuel' (rupture / à sec), ou 'unknown'.\n"
        "- details : file d'attente ou remarque utile mentionnée (ex: 'File courte', 'Livraison matin')."
    )

    api_key = (settings.gemini_api_key or "").strip()
    if api_key:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(
                api_key=api_key,
                http_options={"headers": {"User-Agent": "aistudio-build"}},
            )

            contents: list[Any] = []
            if image_bytes:
                contents.append(
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
                )
            if raw_text:
                contents.append(f"Message à analyser :\n{raw_text}")
            elif image_bytes:
                contents.append(
                    "Extrais toutes les stations-service et types de carburant figurant sur cette fiche de distribution à Bujumbura."
                )

            for model_name in ("gemini-3.1-flash-lite", "gemini-3.8-flash"):
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            temperature=0.1,
                            response_mime_type="application/json",
                            response_schema=list[ExtractedStationReport],
                        ),
                    )

                    raw_json = (response.text or "[]").strip()
                    parsed = json.loads(raw_json)
                    if isinstance(parsed, list):
                        normalized_list: list[dict[str, Any]] = []
                        for item in parsed:
                            if not isinstance(item, dict) or not item.get("station_name"):
                                continue
                            normalized_list.append(
                                {
                                    "station_name": str(item.get("station_name", "")).strip(),
                                    "fuel_type": normalize_fuel_type(str(item.get("fuel_type", ""))),
                                    "status": normalize_fuel_status(str(item.get("status", "distribution"))),
                                    "details": str(item.get("details", "")).strip(),
                                }
                            )
                        if normalized_list:
                            return normalized_list
                except Exception as model_exc:
                    logger.warning("Modèle %s indisponible : %s", model_name, model_exc)
        except Exception as exc:
            logger.error("Erreur lors de l'extraction Gemini : %s", exc)

    # Repli déterministe si texte brut fourni
    if raw_text and stations:
        return fallback_heuristic_parse(raw_text, stations)
    return []


# ==============================================================================
# 5. PRÉPARATION DU LOT, FORMATAGE DU RÉSUMÉ & CLAVIER INTERACTIF TELEGRAM
# ==============================================================================
FUEL_LABELS = {
    "essence": "⛽ Essence",
    "mazout": "🛢️ Mazout",
    "both": "⛽🛢️ Essence & Mazout",
    "unspecified": "❓ Non précisé",
}

STATUS_LABELS = {
    "distribution": "🟢 En distribution",
    "starting": "🟡 Dépotage / Commence",
    "no_fuel": "🔴 Pas de carburant",
    "unknown": "⚪ Statut inconnu",
}


def build_pending_batch(
    db: Session,
    chat_id: str,
    source_type: str,
    raw_input: str,
    extracted_raw: list[dict[str, Any]],
) -> tuple[TelegramPendingBatch, str, dict[str, Any]]:
    """
    Associe chaque station extraite à son station_id PostgreSQL via Fuzzy Matching,
    enregistre un lot `TelegramPendingBatch` (status='pending') sans toucher à `reports`,
    et construit le message récapitulatif + Inline Keyboard Telegram.
    """
    stations = db.query(Station).filter(Station.is_active == True).all()
    enriched_items: list[dict[str, Any]] = []
    matched_count = 0
    unmatched_count = 0

    lines_summary: list[str] = [
        "🤖 <b>PRÉ-VALIDATION IGITORO LIVE</b>",
        f"📥 Source : <i>{'Photo / Fiche de distribution' if source_type == 'image' else 'Message texte / WhatsApp'}</i>",
        "",
    ]

    for idx, item in enumerate(extracted_raw, start=1):
        raw_name = item.get("station_name", "")
        fuel_type = normalize_fuel_type(item.get("fuel_type", "unspecified"))
        status = normalize_fuel_status(item.get("status", "distribution"))
        details = item.get("details", "")

        matched_st, score = match_station_fuzzy(raw_name, stations)
        if matched_st:
            matched_count += 1
            enriched_items.append(
                {
                    "station_id": matched_st.id,
                    "station_name": raw_name,
                    "matched_name": matched_st.name,
                    "zone": matched_st.zone,
                    "confidence": score,
                    "fuel_type": fuel_type,
                    "status": status,
                    "details": details,
                }
            )
            lines_summary.append(
                f"{idx}. ✅ <b>{matched_st.name}</b> ({matched_st.zone}) — <i>{int(score * 100)}%</i>\n"
                f"   • {STATUS_LABELS.get(status, status)} | {FUEL_LABELS.get(fuel_type, fuel_type)}"
                + (f"\n   • 📝 {details}" if details else "")
            )
        else:
            unmatched_count += 1
            raw_clean = (raw_name or "Nouvelle Station").strip()
            zone_guess = (item.get("zone") or "").strip() or "Bujumbura"
            brand_guess = (item.get("brand") or "").strip() or None
            if not brand_guess:
                for b in ("InterPetrol", "Kobil", "Mogas", "Engen", "TotalEnergies", "Delta", "City Oil", "VIP", "King Star", "Rubis"):
                    if b.lower() in raw_clean.lower():
                        brand_guess = b
                        break
            proposed_station = {
                "name": raw_clean,
                "brand": brand_guess,
                "zone": zone_guess,
                "commune": item.get("commune") or "Mukaza",
                "location_text": item.get("location_text") or f"Quartier {zone_guess}, Bujumbura",
            }
            enriched_items.append(
                {
                    "station_id": None,
                    "will_create_station": True,
                    "proposed_station": proposed_station,
                    "station_name": raw_name,
                    "matched_name": raw_clean,
                    "zone": zone_guess,
                    "confidence": score,
                    "fuel_type": fuel_type,
                    "status": status,
                    "details": details,
                }
            )
            lines_summary.append(
                f"{idx}. 🆕 <b>[Nouvelle station à créer] {raw_clean}</b> ({zone_guess})\n"
                f"   • ⚡ Action : <b>Créer dans la BDD</b> + publier ({STATUS_LABELS.get(status, status)} | {FUEL_LABELS.get(fuel_type, fuel_type)})"
                + (f"\n   • 📝 {details}" if details else "")
            )

    lines_summary.append("")
    lines_summary.append(
        f"📊 <b>Ce que je vais envoyer dans la base de données si vous confirmez :</b>\n"
        f"• 🔄 <b>{matched_count}</b> station(s) existante(s) à mettre à jour\n"
        f"• 🆕 <b>{unmatched_count}</b> nouvelle(s) station(s) à créer automatiquement"
    )
    lines_summary.append("🔒 <i>Aucune donnée n'est écrite en production tant que vous n'avez pas confirmé.</i>")

    batch_id = uuid.uuid4().hex[:16]
    batch = TelegramPendingBatch(
        id=batch_id,
        chat_id=str(chat_id),
        source_type=source_type,
        raw_input=(raw_input or "")[:4000],
        extracted_items=enriched_items,
        status="pending",
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    reply_markup = {
        "inline_keyboard": [
            [
                {
                    "text": "✅ Confirmer la mise à jour",
                    "callback_data": f"confirm_batch:{batch_id}",
                },
                {
                    "text": "❌ Annuler",
                    "callback_data": f"cancel_batch:{batch_id}",
                },
            ]
        ]
    }

    return batch, "\n".join(lines_summary), reply_markup


# ==============================================================================
# 6. VALIDATION INTERACTIVE (CALLBACK QUERY) & ÉCRITURE EN BASE POSTGRESQL
# ==============================================================================
def get_or_create_bot_admin_user(db: Session) -> User:
    """Récupère ou crée le compte administrateur système associé au Bot Telegram."""
    admin = db.query(User).filter(User.is_admin == True).first()
    if admin:
        return admin

    admin = User(
        google_sub="telegram-admin-bot",
        display_name="Admin Igitoro (Telegram Bot)",
        email="admin@igitorolive.bi",
        reputation_score=5.0,
        badge="Ambassadeur Fiable",
        is_admin=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def confirm_pending_batch(db: Session, batch_id: str, chat_id: str) -> tuple[bool, str, int]:
    """
    Exécute l'insertion effective des signalements dans PostgreSQL uniquement
    après clic de l'administrateur sur [ ✅ Confirmer la mise à jour ].
    """
    batch = db.query(TelegramPendingBatch).filter(TelegramPendingBatch.id == batch_id).first()
    if not batch:
        return False, "⚠️ Lot introuvable ou expiré.", 0

    if batch.status != "pending":
        return False, f"ℹ️ Ce lot a déjà été traité (statut : {batch.status}).", 0

    admin_user = get_or_create_bot_admin_user(db)
    inserted_count = 0
    created_stations_count = 0
    station_names: list[str] = []
    created_station_names: list[str] = []

    for item in batch.extracted_items or []:
        st_id = item.get("station_id")
        if not st_id and item.get("will_create_station") and item.get("proposed_station"):
            prop = item["proposed_station"]
            new_st = Station(
                name=prop.get("name") or "Nouvelle Station",
                brand=prop.get("brand"),
                zone=prop.get("zone") or "Bujumbura",
                location_text=prop.get("location_text") or f"Quartier {prop.get('zone', 'Bujumbura')}, Bujumbura",
                landmarks=item.get("details") or None,
                is_active=True,
                is_verified=True,
            )
            db.add(new_st)
            db.flush()
            st_id = new_st.id
            created_stations_count += 1
            created_station_names.append(f"{new_st.name} ({new_st.zone})")

        if not st_id:
            continue

        details = (item.get("details") or "").strip()
        report = Report(
            station_id=int(st_id),
            user_id=admin_user.id,
            fuel_status=item.get("status", "distribution"),
            fuel_type=item.get("fuel_type", "unspecified"),
            queue_status=infer_queue_status(details),
            comment=details or "Mise à jour validée via Bot Telegram Admin",
            source="telegram_bot",
        )
        db.add(report)
        inserted_count += 1
        station_names.append(item.get("matched_name") or f"Station #{st_id}")

    batch.status = "confirmed"
    batch.resolved_at = datetime.now(timezone.utc)

    db.add(
        ActionLog(
            user_id=admin_user.id,
            action="telegram_batch_confirmed",
            details=f"Lot {batch_id} confirmé ({created_stations_count} nouvelles stations, {inserted_count} signalements : {', '.join(station_names)})",
        )
    )
    db.commit()

    msg = (
        f"✅ <b>Mise à jour publiée en production !</b>\n"
        f"• 📝 <b>{inserted_count}</b> signalement(s) enregistré(s) dans la base de données.\n"
        + (f"• 🆕 <b>{created_stations_count} nouvelle(s) station(s) créée(s) :</b> {', '.join(created_station_names)}\n" if created_stations_count else "")
        + f"• ⛽ Stations mises à jour : {', '.join(station_names) if station_names else 'Aucune'}"
    )
    return True, msg, inserted_count


def cancel_pending_batch(db: Session, batch_id: str) -> tuple[bool, str]:
    """Annule un lot en attente sans écrire aucune donnée dans `reports`."""
    batch = db.query(TelegramPendingBatch).filter(TelegramPendingBatch.id == batch_id).first()
    if not batch:
        return False, "⚠️ Lot introuvable."
    if batch.status != "pending":
        return False, f"ℹ️ Ce lot est déjà à l'état « {batch.status} »."

    batch.status = "cancelled"
    batch.resolved_at = datetime.now(timezone.utc)
    db.commit()
    return True, "❌ <b>Opération annulée.</b> Aucun signalement n'a été écrit dans la base de données."


# ==============================================================================
# 7. COMMANDE /STATS & BILAN DE SANTÉ DU SYSTÈME
# ==============================================================================
def generate_stats_summary(db: Session) -> str:
    """Génère le bilan complet de la journée et l'état de santé du système."""
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    total_stations = db.query(Station).filter(Station.is_active == True).count()
    reports_24h = db.query(Report).filter(Report.created_at >= since_24h).all()
    bot_reports_24h = [r for r in reports_24h if getattr(r, "source", "web") == "telegram_bot"]

    dist_stations = {r.station_id for r in reports_24h if r.fuel_status == "distribution"}
    no_fuel_stations = {r.station_id for r in reports_24h if r.fuel_status == "no_fuel"} - dist_stations
    pending_batches = db.query(TelegramPendingBatch).filter(TelegramPendingBatch.status == "pending").count()

    return (
        "📊 <b>BILAN IGITORO LIVE (24 DERNIÈRES HEURES)</b>\n\n"
        f"🏥 <b>État du système :</b> En ligne (FastAPI + PostgreSQL OK)\n"
        f"⛽ <b>Stations actives :</b> {total_stations} stations à Bujumbura\n"
        f"📝 <b>Signalements (24h) :</b> {len(reports_24h)} (dont {len(bot_reports_24h)} via Bot Telegram)\n"
        f"🟢 <b>En distribution récente :</b> {len(dist_stations)} station(s)\n"
        f"🔴 <b>Signalées à sec :</b> {len(no_fuel_stations)} station(s)\n"
        f"⏳ <b>Lots Telegram en attente de validation :</b> {pending_batches}\n\n"
        "💡 <i>Envoyez un message transféré de WhatsApp ou la photo d'une fiche de distribution pour préparer une mise à jour.</i>"
    )
