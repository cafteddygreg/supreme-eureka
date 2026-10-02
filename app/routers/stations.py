from fastapi import APIRouter,Depends,HTTPException
from sqlalchemy import or_,select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Station
from app.services.aggregator import aggregate
router=APIRouter(prefix='/api/stations')
@router.get('')
def stations(q:str='',db:Session=Depends(get_db)):
    s=select(Station).where(Station.is_active.is_(True))
    if q:term=f'%{q}%';s=s.where(or_(Station.name.ilike(term),Station.zone.ilike(term),Station.brand.ilike(term)))
    return [{'id':x.id,'name':x.name,'brand':x.brand,'zone':x.zone,'location':x.location_text,'state':aggregate(db,x)} for x in db.scalars(s.limit(30)).all()]
@router.get('/{station_id}')
def station(station_id:int,db:Session=Depends(get_db)):
    x=db.get(Station,station_id)
    if not x or not x.is_active:raise HTTPException(404,'Station introuvable')
    return {'id':x.id,'name':x.name,'brand':x.brand,'zone':x.zone,'location':x.location_text,'landmark':x.landmark,'state':aggregate(db,x)}
@router.post('')
def create_station(payload:dict,db:Session=Depends(get_db)):
    x=Station(name=payload['name'],brand=payload.get('brand'),zone=payload['zone'],location_text=payload['location_text'],landmark=payload.get('landmark'),fuels=payload.get('fuels','Essence,Diesel'));db.add(x);db.commit();db.refresh(x);return {'ok':True,'station_id':x.id}
