"""
Script de peuplement initial (Seed) des stations-service officielles de Bujumbura.
Conforme à PROJECT.md Sec 3 & Sec 14 :
- Données vérifiées via INSBU 2021, Ordonnance 2016, Mapcarta, RPA 2025
- Stations par quartiers et communes (Mukaza, Muha, Ntahangwa)
- Repères textuels concrets
- Carburants vendus
"""

from app.database import SessionLocal, engine, Base
from app.models import Station

BUJUMBURA_INITIAL_STATIONS = [
    # MUKAZA (Centre, Rohero, Buyenzi, Bwiza)
    {"name": "Kimoil Fuel Stop", "brand": "Kimoil", "zone": "Bujumbura", "commune": "Bujumbura", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Brasserie", "brand": "InterPetrol", "zone": "Mukaza", "commune": "Mukaza", "landmarks": "Près de l'hôpital CENTRE DE SOINS BRARUDI", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "STATION VIP", "brand": "VIP", "zone": "Mukaza", "commune": "Mukaza", "landmarks": "Près de Regideso Dir. Commerciale", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Station King Star", "brand": "King Star", "zone": "Mukaza", "commune": "Mukaza", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Musée Vivant", "brand": "InterPetrol", "zone": "Mukaza", "commune": "Mukaza", "landmarks": "Près du Musée Vivant", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Energy Marché Central", "brand": "InterPetrol", "zone": "Centre-Ville", "commune": "Mukaza", "landmarks": "Près du Marché Central", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},

    # MUHA (Kinindo, Kanyosha, Musaga, Kibenga, Kizingwe, Ruziba, Aupare)
    {"name": "Yakeime Oil Kinindo", "brand": "Yakeime", "zone": "Kinindo", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Delta Kibenga", "brand": "Delta", "zone": "Kibenga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Kibenga", "brand": "InterPetrol", "zone": "Kibenga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Station Safari City Kanyosha", "brand": "Safari City", "zone": "Kanyosha", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Mogas Ex-King Star Kanyosha", "brand": "Mogas", "zone": "Kanyosha", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Energy Kanyosha", "brand": "InterPetrol", "zone": "Kanyosha", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Mezzo Oil Kanyosha", "brand": "Mezzo Oil", "zone": "Kanyosha", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Kobil Kizingwe", "brand": "Kobil", "zone": "Kizingwe", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Safali Oil Kizingwe", "brand": "Safali Oil", "zone": "Kizingwe", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Station Noe Ruziba", "brand": "Noe", "zone": "Ruziba", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Geprotis Ruziba", "brand": "Geprotis", "zone": "Ruziba", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Mega Oil Ruziba", "brand": "Mega Oil", "zone": "Ruziba", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Station Gare du Sud", "brand": "Gare du Sud", "zone": "Gare du Sud", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Mogas Aupare", "brand": "Mogas", "zone": "Aupare", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Station Quick Service Musaga", "brand": "Quick Service", "zone": "Musaga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Energy Musaga", "brand": "InterPetrol", "zone": "Musaga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Lybajas Musaga", "brand": "Lybajas", "zone": "Musaga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Safari Oil Musaga", "brand": "Safari Oil", "zone": "Musaga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Petro Muha de Musaga", "brand": "Petro Muha", "zone": "Musaga", "commune": "Muha", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},

    # NTAHANGWA (Kigobe, Cibitoke, Kanyaru, Kamenge)
    {"name": "Kigobe City Oil", "brand": "City Oil", "zone": "Kigobe", "commune": "Ntahangwa", "landmarks": "Boulevard du 28 Novembre", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "InterPetrol Cibitoke", "brand": "InterPetrol", "zone": "Cibitoke", "commune": "Ntahangwa", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
    {"name": "Kobil Kanyaru", "brand": "Kobil", "zone": "Kanyaru", "commune": "Ntahangwa", "landmarks": "", "fuels_sold": ["Essence", "Gasoil"], "is_active": True},
]

def seed_stations(db=None):
    close_after = False
    if db is None:
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        close_after = True

    try:
        # Supprimer les anciennes stations (données erronées)
        db.query(Station).delete()
        db.commit()

        # Ajouter les nouvelles stations vérifiées
        count = 0
        for data in BUJUMBURA_INITIAL_STATIONS:
            exists = db.query(Station).filter(
                Station.name == data["name"],
                Station.zone == data["zone"]
            ).first()
            if not exists:
                st = Station(**data)
                db.add(st)
                count += 1
        db.commit()
        return count
    finally:
        if close_after:
            db.close()

if __name__ == "__main__":
    added = seed_stations()
    print(f"Seed terminé : {added} stations ajoutées.")
