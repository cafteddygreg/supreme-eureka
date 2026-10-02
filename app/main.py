from pathlib import Path
from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles
from app.config import settings
from app.database import init_db
from app.routers import web,auth,stations,reports,notifications,admin
app=FastAPI(title='Igitoro Live',version='1.0.0')
app.add_middleware(SessionMiddleware,secret_key=settings.secret_key)
Path(settings.upload_dir).mkdir(parents=True,exist_ok=True)
app.mount('/static',StaticFiles(directory=str(Path(__file__).resolve().parent / 'static')),name='static')
for r in [web.router,auth.router,stations.router,reports.router,notifications.router,admin.router]:app.include_router(r)
@app.on_event('startup')
def startup():init_db()
@app.get('/health')
def health():return {'status':'ok'}
