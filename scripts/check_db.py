from app.database import init_db,SessionLocal
from app.models import Station
init_db();d=SessionLocal();print('Database OK -',d.query(Station).count(),'stations');d.close()
