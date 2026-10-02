from fastapi import APIRouter,Depends,HTTPException,Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.config import settings
router=APIRouter(prefix='/api/auth')
def current_user(request:Request,db:Session=Depends(get_db)):
    u=db.get(User,request.session.get('user_id'))
    if not u or u.is_suspended: raise HTTPException(401,'Connexion requise')
    return u
@router.post('/google')
def google(payload:dict,request:Request,db:Session=Depends(get_db)):
    cred=payload.get('credential','')
    if settings.google_client_id:
        from google.oauth2 import id_token
        from google.auth.transport import requests as gr
        try:i=id_token.verify_oauth2_token(cred,gr.Request(),settings.google_client_id); sub=i['sub']; name=i.get('name') or 'Utilisateur'; email=i.get('email')
        except Exception as e:raise HTTPException(401,'Jeton Google invalide') from e
    else:
        if not cred.startswith('mock:'):raise HTTPException(503,'Google Sign-In non configuré')
        _,sub,*rest=cred.split(':');name=rest[0] if rest else 'Utilisateur';email=None
    u=db.scalar(select(User).where(User.google_sub==sub)) or User(google_sub=sub,name=name,email=email)
    if u.id is None:db.add(u)
    else:u.name=name;u.email=email
    db.commit();db.refresh(u);request.session['user_id']=u.id;return {'ok':True,'user':{'id':u.id,'name':u.name}}
@router.post('/logout')
def logout(request:Request):request.session.clear();return {'ok':True}
@router.delete('/account')
def delete_account(request:Request,db:Session=Depends(get_db)):
    u=current_user(request,db);u.name='Compte supprimé';u.email=None;u.google_sub=f'deleted-{u.id}-{u.google_sub}';u.is_suspended=True;db.commit();request.session.clear();return {'ok':True}
