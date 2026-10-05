import 'dotenv/config';
import { db, pool } from './index.ts';
import { ensureDatabaseTablesExist, isPostgresConfigured } from './repository.ts';
import { confirmations, reports, stations, users } from './schema.ts';
import { getOrCreateUser } from './users.ts';

export const initialBujumburaStations = [
  // Mukaza
  {
    name: 'Kimoil Fuel Stop',
    brand: 'Kimoil',
    zone: 'Centre-Ville',
    commune: 'Mukaza',
    locationText: "Boulevard de l'Uprona, Centre-Ville",
    landmark: "Boulevard de l'Uprona",
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: true,
    verifiedLabel: 'Station vérifiée',
  },
  {
    name: 'InterPetrol Brasserie',
    brand: 'InterPetrol',
    zone: 'Ngagara',
    commune: 'Mukaza',
    locationText: 'Mukaza, Bujumbura',
    landmark: "Près de l'hôpital CENTRE DE SOINS BRARUDI",
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'STATION VIP',
    brand: 'VIP',
    zone: 'Rohero',
    commune: 'Mukaza',
    locationText: 'Rohero, Mukaza',
    landmark: 'Près de Regideso Dir. Commerciale',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Station King Star',
    brand: 'King Star',
    zone: 'Rohero',
    commune: 'Mukaza',
    locationText: 'Avenue de la JRR, Rohero',
    landmark: 'Avenue de la JRR',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'InterPetrol Musée Vivant',
    brand: 'InterPetrol',
    zone: 'Rohero',
    commune: 'Mukaza',
    locationText: 'Rohero, Mukaza',
    landmark: 'Près du Musée Vivant',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'InterPetrol Energy Marché Central',
    brand: 'InterPetrol',
    zone: 'Centre-Ville',
    commune: 'Mukaza',
    locationText: 'Centre-Ville, Mukaza',
    landmark: 'Près du Marché Central',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },

  // Muha
  {
    name: 'Yakeime Oil Kinindo',
    brand: 'Yakeime',
    zone: 'Kinindo',
    commune: 'Muha',
    locationText: 'Kinindo, Muha',
    landmark: 'Avenue du Large',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Delta Kibenga',
    brand: 'Delta',
    zone: 'Kibenga',
    commune: 'Muha',
    locationText: 'Kibenga, Muha',
    landmark: 'Route Nationale 3',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'InterPetrol Kibenga',
    brand: 'InterPetrol',
    zone: 'Kibenga',
    commune: 'Muha',
    locationText: 'Kibenga, Muha',
    landmark: 'RN3 près du pont Kanyosha',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Station Safari City Kanyosha',
    brand: 'Safari City',
    zone: 'Kanyosha',
    commune: 'Muha',
    locationText: 'Kanyosha, Muha',
    landmark: 'Avenue Gisyo',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Mogas Ex-King Star Kanyosha',
    brand: 'Mogas',
    zone: 'Kanyosha',
    commune: 'Muha',
    locationText: 'Kanyosha, Muha',
    landmark: 'RN3 Kanyosha',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'InterPetrol Energy Kanyosha',
    brand: 'InterPetrol',
    zone: 'Kanyosha',
    commune: 'Muha',
    locationText: 'Kanyosha, Muha',
    landmark: 'Près du marché de Kanyosha',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Mezzo Oil Kanyosha',
    brand: 'Mezzo Oil',
    zone: 'Kanyosha',
    commune: 'Muha',
    locationText: 'Kanyosha, Muha',
    landmark: 'Avenue de la paix Kanyosha',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Kobil Kizingwe',
    brand: 'Kobil',
    zone: 'Kizingwe',
    commune: 'Muha',
    locationText: 'Kizingwe, Muha',
    landmark: 'Avenue Kizingwe',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Safali Oil Kizingwe',
    brand: 'Safali Oil',
    zone: 'Kizingwe',
    commune: 'Muha',
    locationText: 'Kizingwe, Muha',
    landmark: "Près de l'école fondamentale de Kizingwe",
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Station Noe Ruziba',
    brand: 'Noe',
    zone: 'Ruziba',
    commune: 'Muha',
    locationText: 'Ruziba, Muha',
    landmark: 'RN3 axe Bujumbura-Rumonge',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Geprotis Ruziba',
    brand: 'Geprotis',
    zone: 'Ruziba',
    commune: 'Muha',
    locationText: 'Ruziba Rural, Muha',
    landmark: 'Ruziba Rural',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Mega Oil Ruziba',
    brand: 'Mega Oil',
    zone: 'Ruziba',
    commune: 'Muha',
    locationText: 'Ruziba, Muha',
    landmark: 'Près du poste de police de Ruziba',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Station Gare du Sud',
    brand: 'Gare du Sud',
    zone: 'Gare du Sud',
    commune: 'Muha',
    locationText: 'Gare du Sud, Muha',
    landmark: 'Terminus des bus Gare du Sud',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Mogas Aupare',
    brand: 'Mogas',
    zone: 'Aupare',
    commune: 'Muha',
    locationText: 'Aupare, Muha',
    landmark: 'Quartier Aupare',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Station Quick Service Musaga',
    brand: 'Quick Service',
    zone: 'Musaga',
    commune: 'Muha',
    locationText: 'Musaga, Muha',
    landmark: 'Boulevard de la Liberté',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'InterPetrol Energy Musaga',
    brand: 'InterPetrol',
    zone: 'Musaga',
    commune: 'Muha',
    locationText: 'Musaga, Muha',
    landmark: 'Avenue du Large vers Musaga',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Lybajas Musaga',
    brand: 'Lybajas',
    zone: 'Musaga',
    commune: 'Muha',
    locationText: 'Musaga, Muha',
    landmark: 'Avenue Kiriri',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Safari Oil Musaga',
    brand: 'Safari Oil',
    zone: 'Musaga',
    commune: 'Muha',
    locationText: 'Musaga, Muha',
    landmark: 'Entrée Musaga',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Petro Muha de Musaga',
    brand: 'Petro Muha',
    zone: 'Musaga',
    commune: 'Muha',
    locationText: 'Musaga, Muha',
    landmark: 'Rond-point Musaga',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },

  // Ntahangwa
  {
    name: 'Kigobe City Oil',
    brand: 'City Oil',
    zone: 'Kigobe',
    commune: 'Ntahangwa',
    locationText: 'Kigobe, Ntahangwa',
    landmark: 'Boulevard du 28 Novembre',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'InterPetrol Cibitoke',
    brand: 'InterPetrol',
    zone: 'Cibitoke',
    commune: 'Ntahangwa',
    locationText: 'Cibitoke, Ntahangwa',
    landmark: 'Boulevard du 28 Novembre angle 10ème',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
  {
    name: 'Kobil Kanyaru',
    brand: 'Kobil',
    zone: 'Kanyaru',
    commune: 'Ntahangwa',
    locationText: 'Kanyaru, Ntahangwa',
    landmark: 'RN1 sortie nord',
    fuels: 'Essence,Diesel',
    isActive: true,
    isVerified: false,
  },
];

export async function runSeed() {
  if (!isPostgresConfigured()) {
    console.error(
      '❌ PostgreSQL is not configured. Set DATABASE_URL (Railway) or SQL_HOST/SQL_USER/SQL_PASSWORD/SQL_DB_NAME (Cloud SQL).'
    );
    process.exit(1);
  }

  console.log('🌱 Ensuring PostgreSQL tables exist...');
  await ensureDatabaseTablesExist();

  const adminUser = await getOrCreateUser(
    'seed-admin-bujumbura',
    'admin@igitoro.bi',
    'Équipe Igitoro Live',
    true
  );

  const existingStations = await db.select().from(stations);
  const existingByName = new Map(
    existingStations.map((s) => [s.name.trim().toLowerCase(), s])
  );

  let insertedStationsCount = 0;
  for (const st of initialBujumburaStations) {
    const key = st.name.trim().toLowerCase();
    if (!existingByName.has(key)) {
      const [created] = await db
        .insert(stations)
        .values({
          name: st.name,
          brand: st.brand,
          commune: st.commune,
          zone: st.zone,
          locationText: st.locationText,
          landmark: st.landmark,
          fuels: st.fuels,
          isActive: st.isActive,
          isVerified: st.isVerified,
          verifiedLabel: st.verifiedLabel ?? null,
        })
        .returning();
      existingByName.set(key, created);
      insertedStationsCount++;
    }
  }

  const allStations = await db.select().from(stations);
  const existingReports = await db.select().from(reports);

  let insertedReportsCount = 0;
  if (existingReports.length < 4 && allStations.length > 0) {
    const sampleReports = [
      {
        stationName: 'Kimoil Fuel Stop',
        fuelStatus: 'distribution',
        fuelType: 'both',
        queueStatus: 'short',
        queueBucket: '10-30',
        comment: 'Pompes en service pour essence et mazout. Service fluide.',
      },
      {
        stationName: 'InterPetrol Brasserie',
        fuelStatus: 'distribution',
        fuelType: 'essence',
        queueStatus: 'moderate',
        queueBucket: '30-60',
        comment: 'Distribution essence en cours près de la Brarudi.',
      },
      {
        stationName: 'Yakeime Oil Kinindo',
        fuelStatus: 'starting',
        fuelType: 'mazout',
        queueStatus: 'short',
        queueBucket: '10-30',
        comment: 'Déchargement du camion citerne terminé, mise en route.',
      },
      {
        stationName: 'InterPetrol Energy Marché Central',
        fuelStatus: 'no_fuel',
        fuelType: 'unspecified',
        queueStatus: 'none',
        queueBucket: 'unknown',
        comment: 'Pas de distribution ce matin.',
      },
      {
        stationName: 'Kigobe City Oil',
        fuelStatus: 'distribution',
        fuelType: 'essence',
        queueStatus: 'short',
        queueBucket: '10-30',
        comment: 'Essence disponible sur le Boulevard du 28 Novembre.',
      },
    ];

    for (const sample of sampleReports) {
      const targetStation = allStations.find(
        (s) => s.name.toLowerCase() === sample.stationName.toLowerCase()
      );
      if (!targetStation) continue;

      const alreadyHasReport = existingReports.some(
        (r) => r.stationId === targetStation.id && !r.isDeleted
      );
      if (alreadyHasReport) continue;

      const [newReport] = await db
        .insert(reports)
        .values({
          stationId: targetStation.id,
          userId: adminUser.id,
          fuelStatus: sample.fuelStatus,
          fuelType: sample.fuelType,
          queueStatus: sample.queueStatus,
          queueBucket: sample.queueBucket,
          comment: sample.comment,
          source: 'seed',
          isDeleted: false,
        })
        .returning();

      await db.insert(confirmations).values({
        reportId: newReport.id,
        userId: adminUser.id,
        kind: 'confirm',
      });
      insertedReportsCount++;
    }
  }

  console.log(
    `✅ Seed terminé avec succès : ${allStations.length} stations au total (${insertedStationsCount} nouvelles insérées), ${insertedReportsCount} nouveaux signalements initiaux ajoutés.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Erreur lors du seed :', err);
      await pool.end();
      process.exit(1);
    });
}
