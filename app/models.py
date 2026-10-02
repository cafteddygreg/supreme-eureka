from datetime import datetime,timezone
from sqlalchemy import Boolean,DateTime,ForeignKey,Integer,String,Text,UniqueConstraint
from sqlalchemy.orm import Mapped,mapped_column,relationship
from app.database import Base
def now(): return datetime.now(timezone.utc)
class User(Base):
    __tablename__='users'; id:Mapped[int]=mapped_column(primary_key=True); google_sub:Mapped[str]=mapped_column(String(255),unique=True); name:Mapped[str]=mapped_column(String(120),default='Utilisateur'); email:Mapped[str|None]=mapped_column(String(255)); is_admin:Mapped[bool]=mapped_column(Boolean,default=False); is_suspended:Mapped[bool]=mapped_column(Boolean,default=False); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class Station(Base):
    __tablename__='stations'; id:Mapped[int]=mapped_column(primary_key=True); name:Mapped[str]=mapped_column(String(180),index=True); brand:Mapped[str|None]=mapped_column(String(80)); zone:Mapped[str]=mapped_column(String(100),index=True); location_text:Mapped[str]=mapped_column(String(255)); landmark:Mapped[str|None]=mapped_column(String(255)); fuels:Mapped[str]=mapped_column(String(120),default='Essence,Diesel'); is_active:Mapped[bool]=mapped_column(Boolean,default=True); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class Report(Base):
    __tablename__='reports'; id:Mapped[int]=mapped_column(primary_key=True); station_id:Mapped[int]=mapped_column(ForeignKey('stations.id')); user_id:Mapped[int]=mapped_column(ForeignKey('users.id')); fuel_status:Mapped[str]=mapped_column(String(30)); queue_status:Mapped[str]=mapped_column(String(30)); approximate_count:Mapped[str]=mapped_column(String(30),default='unknown'); station_open:Mapped[str]=mapped_column(String(20),default='unknown'); comment:Mapped[str|None]=mapped_column(Text); photo_path:Mapped[str|None]=mapped_column(String(255)); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now); is_deleted:Mapped[bool]=mapped_column(Boolean,default=False)
    station=relationship('Station'); user=relationship('User')
class Confirmation(Base):
    __tablename__='confirmations'; __table_args__=(UniqueConstraint('report_id','user_id'),); id:Mapped[int]=mapped_column(primary_key=True); report_id:Mapped[int]=mapped_column(ForeignKey('reports.id')); user_id:Mapped[int]=mapped_column(ForeignKey('users.id')); kind:Mapped[str]=mapped_column(String(30)); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class AbuseReport(Base):
    __tablename__='abuse_reports'; id:Mapped[int]=mapped_column(primary_key=True); report_id:Mapped[int]=mapped_column(ForeignKey('reports.id')); user_id:Mapped[int]=mapped_column(ForeignKey('users.id')); reason:Mapped[str]=mapped_column(String(80)); details:Mapped[str|None]=mapped_column(Text); status:Mapped[str]=mapped_column(String(30),default='pending'); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class ZoneSubscription(Base):
    __tablename__='zone_subscriptions'; __table_args__=(UniqueConstraint('user_id','zone'),); id:Mapped[int]=mapped_column(primary_key=True); user_id:Mapped[int]=mapped_column(ForeignKey('users.id')); zone:Mapped[str]=mapped_column(String(100)); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class ActionLog(Base):
    __tablename__='action_logs'; id:Mapped[int]=mapped_column(primary_key=True); user_id:Mapped[int|None]=mapped_column(ForeignKey('users.id')); action:Mapped[str]=mapped_column(String(120)); target_type:Mapped[str|None]=mapped_column(String(50)); target_id:Mapped[int|None]=mapped_column(Integer); details:Mapped[str|None]=mapped_column(Text); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
