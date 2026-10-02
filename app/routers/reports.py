from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter,Depends,File,Form,HTTPException,Request,UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models import AbuseReport,Confirmation,Report,Station
from app.routers.auth import current_user
from app.services.rate_limiter import limiter
router=APIRouter(prefix='/api/reports');TYPES={'image/jpeg','image/png','image/webp'}
@router.post('')
def create(request:Request,station_id:int=Form(...),fuel_status:str=Form(...),queue_status:str=Form(...),approximate_count:str=Form('unknown'),station_open:str=Form('unknown'),comment:str=Form(''),photo:UploadFile|None=File(None),db:Session=Depends(get_db)):
    u=current_user(request,db)
    if not limiter.allow(f'r:{u.id}'):raise HTTPException(429,'Trop de signalements récemment')
    if not db.get(Station,station_id):raise HTTPException(404,'Station introuvable')
    path=None
    if photo and photo.filename:
        if photo.content_type not in TYPES:raise HTTPException(400,'Format photo non accepté')
        data=photo.file.read()
        if len(data)>settings.max_upload_mb*1024*1024:raise HTTPException(413,'Photo trop lourde')
        Path(settings.upload_dir).mkdir(parents=True,exist_ok=True);name=uuid4().hex+Path(photo.filename).suffix.lower();(Path(settings.upload_dir)/name).write_bytes(data);path='/static/uploads/'+name
    r=Report(station_id=station_id,user_id=u.id,fuel_status=fuel_status,queue_status=queue_status,approximate_count=approximate_count,station_open=station_open,comment=comment.strip() or None,photo_path=path);db.add(r);db.commit();db.refresh(r);return {'ok':True,'report_id':r.id}
@router.post('/{report_id}/verify')
def verify(report_id:int,payload:dict,request:Request,db:Session=Depends(get_db)):
    u=current_user(request,db);r=db.get(Report,report_id)
    if not r:raise HTTPException(404,'Signalement introuvable')
    if payload.get('kind') not in {'confirm','no_longer_true'}:raise HTTPException(400,'Type invalide')
    c=db.scalar(select(Confirmation).where(Confirmation.report_id==report_id,Confirmation.user_id==u.id))
    if c:c.kind=payload['kind']
    else:db.add(Confirmation(report_id=report_id,user_id=u.id,kind=payload['kind']))
    db.commit();return {'ok':True}
@router.delete('/{report_id}')
def delete(report_id:int,request:Request,db:Session=Depends(get_db)):
    u=current_user(request,db);r=db.get(Report,report_id)
    if not r or r.user_id!=u.id:raise HTTPException(404,'Signalement introuvable')
    r.is_deleted=True;db.commit();return {'ok':True}
@router.post('/{report_id}/abuse')
def abuse(report_id:int,payload:dict,request:Request,db:Session=Depends(get_db)):
    u=current_user(request,db);r=db.get(Report,report_id)
    if not r:raise HTTPException(404,'Signalement introuvable')
    if not limiter.allow(f'a:{u.id}',1):raise HTTPException(429,'Trop de signalements de modération')
    db.add(AbuseReport(report_id=report_id,user_id=u.id,reason=payload.get('reason','Autre'),details=payload.get('details')));db.commit();return {'ok':True}
