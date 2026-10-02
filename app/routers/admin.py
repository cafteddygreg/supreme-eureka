from fastapi import APIRouter,Depends,HTTPException,Request
from sqlalchemy import func,select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import AbuseReport,Report,Station,User
from app.routers.auth import current_user
router=APIRouter(prefix='/api/admin')
def admin(request,db):
 u=current_user(request,db)
 if not u.is_admin:raise HTTPException(403,'Accès administrateur requis')
 return u
@router.get('/dashboard')
def dashboard(request:Request,db:Session=Depends(get_db)):
 admin(request,db);return {'users':db.scalar(select(func.count(User.id))) or 0,'stations':db.scalar(select(func.count(Station.id))) or 0,'reports':db.scalar(select(func.count(Report.id))) or 0,'pending_abuse':db.scalar(select(func.count(AbuseReport.id)).where(AbuseReport.status=='pending')) or 0}
@router.post('/stations/{station_id}/toggle')
def toggle(station_id:int,request:Request,db:Session=Depends(get_db)):
 admin(request,db);s=db.get(Station,station_id)
 if not s:raise HTTPException(404,'Station introuvable')
 s.is_active=not s.is_active;db.commit();return {'ok':True,'active':s.is_active}
@router.post('/abuse/{abuse_id}/moderate')
def moderate(abuse_id:int,action:str,request:Request,db:Session=Depends(get_db)):
 admin(request,db);a=db.get(AbuseReport,abuse_id)
 if not a:raise HTTPException(404,'Abus introuvable')
 if action=='hide_report':db.get(Report,a.report_id).is_deleted=True
 if action=='suspend_user':db.get(User,a.user_id).is_suspended=True
 a.status='resolved';db.commit();return {'ok':True}
