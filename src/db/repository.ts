import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  abuseReports,
  actionLogs,
  confirmations,
  reports,
  stationClaims,
  stations,
  telegramPendingBatches,
  users,
  zoneSubscriptions,
} from './schema.ts';
import { getOrCreateUser } from './users.ts';

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME && process.env.SQL_USER);
}

export async function getAllStationsFromDb() {
  try {
    return await db.select().from(stations);
  } catch (error) {
    console.error('Database query failed in getAllStationsFromDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertStationInDb(data: {
  name: string;
  brand?: string | null;
  commune?: string;
  zone: string;
  locationText: string;
  landmark?: string | null;
  fuels?: string;
  isActive?: boolean;
  isVerified?: boolean;
  verifiedLabel?: string | null;
}) {
  try {
    const res = await db
      .insert(stations)
      .values({
        name: data.name,
        brand: data.brand ?? null,
        commune: data.commune || 'Mukaza',
        zone: data.zone,
        locationText: data.locationText,
        landmark: data.landmark ?? null,
        fuels: data.fuels || 'Essence,Diesel',
        isActive: data.isActive !== false,
        isVerified: Boolean(data.isVerified),
        verifiedLabel: data.verifiedLabel ?? null,
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertStationInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function updateStationActiveInDb(stationId: number, isActive: boolean) {
  try {
    const res = await db
      .update(stations)
      .set({ isActive })
      .where(eq(stations.id, stationId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in updateStationActiveInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function updateStationVerificationInDb(
  stationId: number,
  isVerified: boolean,
  verifiedLabel: string | null
) {
  try {
    const res = await db
      .update(stations)
      .set({ isVerified, verifiedLabel })
      .where(eq(stations.id, stationId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in updateStationVerificationInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertReportInDb(data: {
  stationId: number;
  userId: number;
  fuelStatus: string;
  fuelType?: string;
  queueStatus?: string;
  queueBucket?: string | null;
  waitBucket?: string | null;
  comment?: string | null;
  photoPath?: string | null;
  source?: string;
}) {
  try {
    const res = await db
      .insert(reports)
      .values({
        stationId: data.stationId,
        userId: data.userId,
        fuelStatus: data.fuelStatus,
        fuelType: data.fuelType || 'unspecified',
        queueStatus: data.queueStatus || 'unknown',
        queueBucket: data.queueBucket ?? null,
        waitBucket: data.waitBucket ?? null,
        comment: data.comment ?? null,
        photoPath: data.photoPath ?? null,
        source: data.source || 'web',
        isDeleted: false,
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertReportInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function markReportDeletedInDb(reportId: number) {
  try {
    const res = await db
      .update(reports)
      .set({ isDeleted: true })
      .where(eq(reports.id, reportId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in markReportDeletedInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getRecentReportsFromDb() {
  try {
    return await db.select().from(reports).orderBy(desc(reports.createdAt));
  } catch (error) {
    console.error('Database query failed in getRecentReportsFromDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertConfirmationInDb(reportId: number, userId: number, kind: string) {
  try {
    const res = await db
      .insert(confirmations)
      .values({
        reportId,
        userId,
        kind,
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertConfirmationInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertAbuseReportInDb(data: {
  reportId: number;
  reporterId: number;
  reason: string;
  details?: string | null;
}) {
  try {
    const res = await db
      .insert(abuseReports)
      .values({
        reportId: data.reportId,
        reporterId: data.reporterId,
        reason: data.reason,
        details: data.details ?? null,
        status: 'pending',
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertAbuseReportInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function updateAbuseReportInDb(
  abuseId: number,
  status: string,
  actionTaken: string | null
) {
  try {
    const res = await db
      .update(abuseReports)
      .set({ status, actionTaken })
      .where(eq(abuseReports.id, abuseId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in updateAbuseReportInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertStationClaimInDb(data: {
  stationId: number;
  userId: number;
  contactName: string;
  phone: string;
  role: string;
  proofDetails?: string | null;
}) {
  try {
    const res = await db
      .insert(stationClaims)
      .values({
        stationId: data.stationId,
        userId: data.userId,
        contactName: data.contactName,
        phone: data.phone,
        role: data.role,
        proofDetails: data.proofDetails ?? null,
        status: 'pending',
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertStationClaimInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function updateStationClaimInDb(
  claimId: number,
  status: string,
  rejectionReason: string | null = null
) {
  try {
    const res = await db
      .update(stationClaims)
      .set({ status, rejectionReason })
      .where(eq(stationClaims.id, claimId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in updateStationClaimInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function updateUserSuspensionInDb(userId: number, isSuspended: boolean) {
  try {
    const res = await db
      .update(users)
      .set({ isSuspended })
      .where(eq(users.id, userId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in updateUserSuspensionInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertZoneSubscriptionInDb(userId: number, zone: string) {
  try {
    const res = await db
      .insert(zoneSubscriptions)
      .values({
        userId,
        zone,
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertZoneSubscriptionInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function deleteZoneSubscriptionInDb(userId: number, zone: string) {
  try {
    const res = await db
      .delete(zoneSubscriptions)
      .where(and(eq(zoneSubscriptions.userId, userId), eq(zoneSubscriptions.zone, zone)))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in deleteZoneSubscriptionInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertActionLogInDb(data: {
  adminId?: number | null;
  adminName: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
}) {
  try {
    const res = await db
      .insert(actionLogs)
      .values({
        adminId: data.adminId ?? null,
        adminName: data.adminName,
        action: data.action,
        targetType: data.targetType ?? null,
        targetId: data.targetId ? String(data.targetId) : null,
        details: data.details ?? null,
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in insertActionLogInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function saveTelegramPendingBatchInDb(data: {
  id: string;
  chatId: string;
  sourceType: string;
  engine?: string | null;
  decipheredText?: string | null;
  rawInput?: string | null;
  extractedItems: unknown[];
  summaryHtml?: string | null;
  status?: string;
}) {
  try {
    const res = await db
      .insert(telegramPendingBatches)
      .values({
        id: data.id,
        chatId: data.chatId,
        sourceType: data.sourceType,
        engine: data.engine ?? null,
        decipheredText: data.decipheredText ?? null,
        rawInput: data.rawInput ?? null,
        extractedItemsJson: JSON.stringify(data.extractedItems || []),
        summaryHtml: data.summaryHtml ?? null,
        status: data.status || 'pending',
      })
      .onConflictDoUpdate({
        target: telegramPendingBatches.id,
        set: {
          status: data.status || 'pending',
          extractedItemsJson: JSON.stringify(data.extractedItems || []),
        },
      })
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in saveTelegramPendingBatchInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function updateTelegramBatchStatusInDb(batchId: string, status: string) {
  try {
    const res = await db
      .update(telegramPendingBatches)
      .set({
        status,
        resolvedAt: new Date(),
      })
      .where(eq(telegramPendingBatches.id, batchId))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Database query failed in updateTelegramBatchStatusInDb:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getAllDatabaseSnapshots() {
  try {
    const [
      dbUsers,
      dbStations,
      dbReports,
      dbConfirmations,
      dbAbuse,
      dbSubs,
      dbClaims,
      dbLogs,
      dbBatches,
    ] = await Promise.all([
      db.select().from(users),
      db.select().from(stations),
      db.select().from(reports),
      db.select().from(confirmations),
      db.select().from(abuseReports),
      db.select().from(zoneSubscriptions),
      db.select().from(stationClaims),
      db.select().from(actionLogs),
      db.select().from(telegramPendingBatches),
    ]);

    return {
      users: dbUsers,
      stations: dbStations,
      reports: dbReports,
      confirmations: dbConfirmations,
      abuseReports: dbAbuse,
      zoneSubscriptions: dbSubs,
      stationClaims: dbClaims,
      actionLogs: dbLogs,
      telegramPendingBatches: dbBatches,
    };
  } catch (error) {
    console.error('Database query failed in getAllDatabaseSnapshots:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export { getOrCreateUser };

