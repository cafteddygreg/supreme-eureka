from fastapi import APIRouter,Depends,Request
from sqlalchemy import delete,select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Report,ZoneSubscription
from app.routers.auth import current_user
router=APIRouter(prefix='/api/notifications')
@router.get('')
def get(request:Request,db:Session=Depends(get_db)):
 u=current_user(request,db);subs=db.scalars(select(ZoneSubscription).where(ZoneSubscription.user_id==u.id)).all();rs=db.scalars(select(Report).order_by(Report.created_at.desc()).limit(10)).all();return {'subscriptions':[x.zone for x in subs],'recent':[{'id':r.id,'station':r.station.name,'zone':r.station.zone,'created_at':r.created_at.isoformat()} for r in rs]}
@router.post('/subscribe')
def subscribe(payload:dict,request:Request,db:Session=Depends(get_db)):
 u=current_user(request,db);z=payload['zone'];
 if not db.scalar(select(ZoneSubscription).where(ZoneSubscription.user_id==u.id,ZoneSubscription.zone==z)):db.add(ZoneSubscription(user_id=u.id,zone=z));db.commit()
 return {'ok':True,'subscribed':True,'zone':z}
@router.post('/unsubscribe')
def unsubscribe(payload:dict,request:Request,db:Session=Depends(get_db)):
 u=current_user(request,db);db.execute(delete(ZoneSubscription).where(ZoneSubscription.user_id==u.id,ZoneSubscription.zone==payload['zone']));db.commit();return {'ok':True,'subscribed':False,'zone':payload['zone']}
