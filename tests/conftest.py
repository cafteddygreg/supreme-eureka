import os;os.environ['DATABASE_URL']='sqlite://'
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from app.database import Base,get_db
from app.main import app
from app.models import User,Station
engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool);Session=sessionmaker(bind=engine)
@pytest.fixture
def db():
 Base.metadata.drop_all(engine);Base.metadata.create_all(engine);d=Session();yield d;d.close()
@pytest.fixture
def client(db):
 app.dependency_overrides[get_db]=lambda:db
 with TestClient(app) as c:yield c
 app.dependency_overrides.clear()
@pytest.fixture
def user(db):
 u=User(google_sub='test',name='Test');db.add(u);db.commit();db.refresh(u);return u
@pytest.fixture
def station(db):
 s=Station(name='Station Test',zone='Kinindo',location_text='Kinindo');db.add(s);db.commit();db.refresh(s);return s
@pytest.fixture
def auth_client(client,user):
 r=client.post('/api/auth/google',json={'credential':'mock:test:Test'})
 assert r.status_code==200
 return client
