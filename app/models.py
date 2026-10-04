from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from app.database import Base


def utc_now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    google_sub = Column(String(255), unique=True, index=True, nullable=True)
    display_name = Column(String(120), nullable=False)
    email = Column(String(255), index=True, nullable=True)
    avatar_url = Column(String(512), nullable=True)
    reputation_score = Column(Float, default=1.0, nullable=False)
    badge = Column(String(64), default="Nouveau membre", nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)


class Station(Base):
    __tablename__ = "stations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    brand = Column(String(100), nullable=True)
    zone = Column(String(100), nullable=False, index=True)
    commune = Column(String(100), nullable=True, index=True)
    location_text = Column(String(255), nullable=True)
    landmarks = Column(String(255), nullable=True)
    fuels_sold = Column(JSON, default=lambda: ["Essence", "Gasoil"])
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    manager_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    station_id = Column(Integer, ForeignKey("stations.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    fuel_status = Column(String(32), nullable=False)  # distribution | starting | no_fuel | unknown
    fuel_type = Column(String(32), default="unspecified", nullable=False)  # essence | mazout | both | unspecified
    queue_status = Column(String(32), default="unknown", nullable=False)  # none | short | medium | long | unknown
    queue_bucket = Column(String(64), nullable=True)
    wait_bucket = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    photo_path = Column(String(512), nullable=True)
    source = Column(String(32), default="web", nullable=False)  # web | telegram_bot
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)


class TelegramPendingBatch(Base):
    """
    Lot de signalements extraits par l'IA (Texte WhatsApp ou Vision Photo)
    en attente de validation explicite par l'administrateur via Inline Keyboard Telegram.
    """
    __tablename__ = "telegram_pending_batches"

    id = Column(String(64), primary_key=True, index=True)  # UUID court utilisé dans callback_data
    chat_id = Column(String(64), nullable=False, index=True)
    message_id = Column(Integer, nullable=True)
    source_type = Column(String(32), nullable=False)  # "text" | "image"
    raw_input = Column(Text, nullable=True)
    extracted_items = Column(JSON, nullable=False)  # Liste structurée [{station_id, station_name, matched_name, score, fuel_type, status, details}]
    status = Column(String(32), default="pending", nullable=False, index=True)  # pending | confirmed | cancelled | expired
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class ActionLog(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(64), nullable=False)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
