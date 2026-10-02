from datetime import datetime,timezone,timedelta
from sqlalchemy import select
from app.models import Report,Confirmation
from app.config import settings
def freshness(dt):
    if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
    m=max(0,int((datetime.now(timezone.utc)-dt).total_seconds()/60))
    return 'À l’instant' if m<5 else f'Il y a {m} min' if m<60 else f'Il y a {m//60} h' if m<1440 else 'Information ancienne'
def aggregate(db,station):
    cut=datetime.now(timezone.utc)-timedelta(minutes=settings.report_window_minutes)
    r=db.scalar(select(Report).where(Report.station_id==station.id,Report.is_deleted.is_(False),Report.created_at>=cut).order_by(Report.created_at.desc()))
    if not r:return {'status':'unknown','queue':'unknown','freshness':'Aucun signalement récent','report':None,'confirmations':0,'contradictions':0}
    cs=db.scalars(select(Confirmation).where(Confirmation.report_id==r.id)).all()
    return {'status':r.fuel_status,'queue':r.queue_status,'freshness':freshness(r.created_at),'report':r,'confirmations':sum(c.kind=='confirm' for c in cs),'contradictions':sum(c.kind=='no_longer_true' for c in cs)}
