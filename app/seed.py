from app.database import SessionLocal,init_db
from app.models import Station
N=[('Cobil Mutanga','Cobil','Mutanga'),('Cobil Kigobe','Cobil','Kigobe'),('Cobil Kamenge','Cobil','Kamenge'),('Kobil Buyenzi','Kobil','Buyenzi'),('Kobil Rohero','Kobil','Rohero'),('Engen Kinindo','Engen','Kinindo'),('Engen Gihosha','Engen','Gihosha'),('Station Mutanga',None,'Mutanga'),('Station Rohero',None,'Rohero'),('Station Kinindo',None,'Kinindo'),('Station Buyenzi',None,'Buyenzi'),('Station Gihosha',None,'Gihosha')]
def seed():
 init_db();db=SessionLocal()
 if not db.query(Station).count():
  for n,b,z in N:db.add(Station(name=n,brand=b,zone=z,location_text=f'{z}, Bujumbura',landmark=f'quartier {z}'))
  db.commit()
 db.close()
if __name__=='__main__':seed()
