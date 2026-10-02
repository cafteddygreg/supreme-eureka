from pathlib import Path
from fastapi import APIRouter,Depends,Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Report,Station,User,ZoneSubscription
from app.services.aggregator import aggregate
router=APIRouter();templates=Jinja2Templates(str(Path(__file__).resolve().parents[1] / 'templates'))
def ctx(request,db):return {'request':request,'user':db.get(User,request.session.get('user_id')) if request.session.get('user_id') else None}
@router.get('/',response_class=HTMLResponse)
def home(request:Request,db:Session=Depends(get_db)):
 ss=db.scalars(select(Station).where(Station.is_active.is_(True)).order_by(Station.name)).all();return templates.TemplateResponse(request,'home.html',{**ctx(request,db),'stations':[{'station':s,'state':aggregate(db,s)} for s in ss]})
@router.get('/stations/{station_id}',response_class=HTMLResponse)
def station_page(station_id,request:Request,db:Session=Depends(get_db)):
 s=db.get(Station,station_id);rs=db.scalars(select(Report).where(Report.station_id==station_id,Report.is_deleted.is_(False)).order_by(Report.created_at.desc()).limit(20)).all();return templates.TemplateResponse(request,'station.html',{**ctx(request,db),'station':s,'state':aggregate(db,s) if s else None,'reports':rs})
@router.get('/signaler',response_class=HTMLResponse)
def report_page(request:Request,db:Session=Depends(get_db)):return templates.TemplateResponse(request,'report.html',{**ctx(request,db),'stations':db.scalars(select(Station).where(Station.is_active.is_(True)).order_by(Station.name)).all()})
@router.get('/notifications',response_class=HTMLResponse)
def notifications(request:Request,db:Session=Depends(get_db)):
 uid=request.session.get('user_id');subs={x.zone for x in db.scalars(select(ZoneSubscription).where(ZoneSubscription.user_id==uid)).all()} if uid else set();zones=['Buyenzi','Kinindo','Mutanga','Rohero','Kamenge','Gihosha','Muyaga'];recent=db.scalars(select(Report).order_by(Report.created_at.desc()).limit(10)).all();return templates.TemplateResponse(request,'notifications.html',{**ctx(request,db),'zones':zones,'subscribed':subs,'recent':recent})
@router.get('/profil',response_class=HTMLResponse)
def profile(request:Request,db:Session=Depends(get_db)):
 u=ctx(request,db)['user'];rs=db.scalars(select(Report).where(Report.user_id==u.id,Report.is_deleted.is_(False)).order_by(Report.created_at.desc()).limit(20)).all() if u else [];subs=db.scalars(select(ZoneSubscription).where(ZoneSubscription.user_id==u.id)).all() if u else [];return templates.TemplateResponse(request,'profile.html',{**ctx(request,db),'reports':rs,'subscriptions':subs})
