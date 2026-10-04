"""
Point d'entrée principal FastAPI d'Igitoro Live avec intégration monolithique
du Bot Telegram Intelligent (Lifespan + Webhook + Validation Inline Keyboard).
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, engine, get_db
from app.services.telegram_bot import (
    build_pending_batch,
    cancel_pending_batch,
    close_telegram_client,
    confirm_pending_batch,
    download_telegram_photo,
    extract_reports_with_ai,
    generate_stats_summary,
    setup_telegram_webhook,
    telegram_api_call,
)
from app.models import Station


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestionnaire de cycle de vie FastAPI (lifespan) :
    1. Crée les tables PostgreSQL (y compris telegram_pending_batches) si absentes.
    2. Initialise le client HTTP asynchrone et enregistre le Webhook Telegram sur Railway.
    3. Ferme proprement les connexions à l'arrêt du conteneur.
    """
    Base.metadata.create_all(bind=engine)
    await setup_telegram_webhook()
    yield
    await close_telegram_client()


app = FastAPI(
    title="Igitoro Live — Plateforme & Bot Telegram Intelligent",
    version="1.1.0",
    lifespan=lifespan,
)


def is_authorized_admin_chat(chat_id: int | str) -> bool:
    """Vérifie que l'expéditeur Telegram fait partie des administrateurs autorisés."""
    allowed = settings.allowed_telegram_chat_ids
    if not allowed:
        # Si TELEGRAM_ADMIN_CHAT_IDS n'est pas restreint en dev, autoriser pour faciliter le test initial
        return settings.app_env != "production"
    try:
        return int(chat_id) in allowed
    except ValueError:
        return False


@app.post("/api/telegram/webhook")
async def telegram_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Webhook officiel Telegram (POST /api/telegram/webhook).
    Gère :
    - Les commandes d'administration (/start, /help, /stats, /bilan)
    - Les messages texte et messages transférés de WhatsApp
    - Les photos de fiches de distribution (Vision IA)
    - Les clics sur les boutons Inline Keyboard ([ ✅ Confirmer ] / [ ❌ Annuler ])
    """
    # 1. Vérification du jeton secret du Webhook Telegram si configuré
    expected_secret = settings.sanitized_webhook_secret
    if expected_secret and x_telegram_bot_api_secret_token != expected_secret:
        raise HTTPException(status_code=403, detail="Secret de webhook Telegram invalide")

    update: dict[str, Any] = await request.json()

    # ==========================================================================
    # CAS A : CLIC SUR UN BOUTON INLINE KEYBOARD (callback_query)
    # ==========================================================================
    if "callback_query" in update:
        cb = update["callback_query"]
        cb_id = cb.get("id")
        data = str(cb.get("data") or "")
        message = cb.get("message") or {}
        chat_id = (message.get("chat") or {}).get("id")
        message_id = message.get("message_id")

        if not chat_id or not is_authorized_admin_chat(chat_id):
            if cb_id:
                await telegram_api_call(
                    "answerCallbackQuery",
                    {"callback_query_id": cb_id, "text": "⛔ Accès non autorisé.", "show_alert": True},
                )
            return {"ok": False, "reason": "unauthorized_chat"}

        if data.startswith("confirm_batch:"):
            batch_id = data.split(":", 1)[1]
            ok, result_html, count = confirm_pending_batch(db, batch_id, str(chat_id))
            if cb_id:
                await telegram_api_call(
                    "answerCallbackQuery",
                    {
                        "callback_query_id": cb_id,
                        "text": f"✅ {count} signalement(s) publié(s) !" if ok else "⚠️ Lot déjà traité ou introuvable",
                    },
                )
            if message_id:
                await telegram_api_call(
                    "editMessageText",
                    {
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "text": result_html,
                        "parse_mode": "HTML",
                    },
                )
            return {"ok": ok, "action": "confirmed", "batch_id": batch_id, "inserted": count, "message": result_html}

        if data.startswith("cancel_batch:"):
            batch_id = data.split(":", 1)[1]
            ok, result_html = cancel_pending_batch(db, batch_id)
            if cb_id:
                await telegram_api_call(
                    "answerCallbackQuery",
                    {"callback_query_id": cb_id, "text": "❌ Mise à jour annulée."},
                )
            if message_id:
                await telegram_api_call(
                    "editMessageText",
                    {
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "text": result_html,
                        "parse_mode": "HTML",
                    },
                )
            return {"ok": ok, "action": "cancelled", "batch_id": batch_id, "message": result_html}

        return {"ok": True, "action": "ignored_callback"}

    # ==========================================================================
    # CAS B : MESSAGE ENTRANT (COMMANDE, TEXTE WHATSAPP OU PHOTO DE FICHE)
    # ==========================================================================
    message = update.get("message") or update.get("edited_message")
    if not message:
        return {"ok": True, "action": "no_message"}

    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not chat_id or not is_authorized_admin_chat(chat_id):
        if chat_id:
            await telegram_api_call(
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "text": "⛔ Ce bot est réservé à l'administration d'Igitoro Live.",
                },
            )
        return {"ok": False, "reason": "unauthorized_chat"}

    text = (message.get("text") or message.get("caption") or "").strip()
    photos = message.get("photo") or []

    # Gestionnaire de petits messages d'attente éphémères sur Telegram
    status_message_id: int | None = None
    execution_steps: list[str] = []

    async def update_transient_status(action_label: str) -> None:
        nonlocal status_message_id
        execution_steps.append(action_label)
        html_text = f"⏳ <b>Exécution :</b> <i>{action_label}</i>"
        await telegram_api_call("sendChatAction", {"chat_id": chat_id, "action": "typing"})
        if status_message_id is None:
            resp = await telegram_api_call(
                "sendMessage",
                {"chat_id": chat_id, "text": html_text, "parse_mode": "HTML"},
            )
            msg_id = (resp.get("result") or {}).get("message_id")
            if msg_id:
                status_message_id = int(msg_id)
        else:
            await telegram_api_call(
                "editMessageText",
                {
                    "chat_id": chat_id,
                    "message_id": status_message_id,
                    "text": html_text,
                    "parse_mode": "HTML",
                },
            )

    async def clear_transient_status() -> None:
        nonlocal status_message_id
        if status_message_id is not None:
            await telegram_api_call(
                "deleteMessage",
                {"chat_id": chat_id, "message_id": status_message_id},
            )
            status_message_id = None

    # 1. Commandes d'administration (/stats, /bilan, /start, /help)
    if text.startswith("/stats") or text.startswith("/bilan") or text.startswith("/health"):
        await update_transient_status("Calcul du bilan des 24 dernières heures…")
        summary_html = generate_stats_summary(db)
        await clear_transient_status()
        await telegram_api_call(
            "sendMessage",
            {"chat_id": chat_id, "text": summary_html, "parse_mode": "HTML"},
        )
        return {
            "ok": True,
            "action": "stats",
            "execution_steps": execution_steps,
            "transient_message_deleted": True,
            "message": summary_html,
        }

    if text.startswith("/start") or text.startswith("/help"):
        await update_transient_status("Chargement du guide d'utilisation…")
        help_html = (
            "👋 <b>Bienvenue sur le Bot Admin d'Igitoro Live !</b>\n\n"
            "• <b>Transférez un message WhatsApp</b> ou envoyez du texte listant les stations.\n"
            "• <b>Envoyez une photo</b> d'une fiche de distribution de carburant.\n"
            "• Le bot extraira les données en JSON, identifiera les stations de Bujumbura par <i>Fuzzy Matching</i> "
            "et vous demandera confirmation via <b>[ ✅ Confirmer la mise à jour ]</b> ou <b>[ ❌ Annuler ]</b>.\n"
            "• Tapez <code>/stats</code> à tout moment pour obtenir le bilan des 24 dernières heures."
        )
        await clear_transient_status()
        await telegram_api_call(
            "sendMessage",
            {"chat_id": chat_id, "text": help_html, "parse_mode": "HTML"},
        )
        return {
            "ok": True,
            "action": "help",
            "execution_steps": execution_steps,
            "transient_message_deleted": True,
            "message": help_html,
        }

    # 2. Extraction Multimodale (Image Vision ou Texte)
    stations = db.query(Station).filter(Station.is_active == True).all()
    image_bytes: bytes | None = None
    mime_type = "image/jpeg"
    source_type = "text"

    if photos:
        source_type = "image"
        await update_transient_status("Téléchargement de la photo depuis Telegram…")
        largest_photo = photos[-1]
        file_id = largest_photo.get("file_id", "")
        image_bytes, mime_type = await download_telegram_photo(file_id)
        if image_bytes is None and not text:
            await clear_transient_status()
            err_msg = "⚠️ Impossible de télécharger ou lire l'image envoyée. Veuillez réessayer avec une photo plus nette."
            await telegram_api_call(
                "sendMessage",
                {"chat_id": chat_id, "text": err_msg},
            )
            return {"ok": False, "reason": "image_download_failed", "message": err_msg}

    if source_type == "image":
        await update_transient_status("Déchiffrage de l'image par Vision IA / OCR et détection des stations…")
    else:
        await update_transient_status("Analyse du message texte et extraction des stations…")

    extracted_items = await extract_reports_with_ai(
        raw_text=text,
        image_bytes=image_bytes,
        mime_type=mime_type,
        stations=stations,
    )

    if not extracted_items:
        await clear_transient_status()
        alert_msg = (
            "⚠️ <b>Aucune station-service détectée.</b>\n"
            "Le message ou l'image ne contient pas d'information exploitable ou est illisible. "
            "Aucune modification n'a été préparée."
        )
        await telegram_api_call(
            "sendMessage",
            {"chat_id": chat_id, "text": alert_msg, "parse_mode": "HTML"},
        )
        return {"ok": False, "reason": "no_stations_extracted", "message": alert_msg}

    await update_transient_status("Comparaison avec la base de données (stations existantes et nouvelles stations à créer)…")

    # 3. Création du lot en attente (Pré-validation obligatoire)
    batch, summary_html, reply_markup = build_pending_batch(
        db=db,
        chat_id=str(chat_id),
        source_type=source_type,
        raw_input=text or "[Image fiche de distribution]",
        extracted_raw=extracted_items,
    )

    # Supprimer le message d'attente dès que la tâche est terminée
    await clear_transient_status()

    tg_resp = await telegram_api_call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": summary_html,
            "parse_mode": "HTML",
            "reply_markup": reply_markup,
        },
    )
    sent_msg_id = (tg_resp.get("result") or {}).get("message_id")
    if sent_msg_id:
        batch.message_id = int(sent_msg_id)
        db.commit()

    return {
        "ok": True,
        "action": "pending_validation",
        "batch_id": batch.id,
        "extracted_items": batch.extracted_items,
        "execution_steps": execution_steps,
        "transient_message_deleted": True,
        "summary": summary_html,
        "reply_markup": reply_markup,
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
