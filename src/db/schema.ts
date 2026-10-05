import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  reputationScore: text('reputation_score').default('5.0').notNull(),
  badge: text('badge').default('Contributeur').notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  isSuspended: boolean('is_suspended').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const stations = pgTable('stations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand'),
  commune: text('commune').default('Mukaza').notNull(),
  zone: text('zone').notNull(),
  locationText: text('location_text').notNull(),
  landmark: text('landmark'),
  fuels: text('fuels').default('Essence,Diesel').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  isVerified: boolean('is_verified').default(false).notNull(),
  verifiedLabel: text('verified_label'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  stationId: integer('station_id')
    .references(() => stations.id)
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  fuelStatus: text('fuel_status').notNull(),
  fuelType: text('fuel_type').default('unspecified').notNull(),
  queueStatus: text('queue_status').default('unknown').notNull(),
  queueBucket: text('queue_bucket'),
  waitBucket: text('wait_bucket'),
  comment: text('comment'),
  photoPath: text('photo_path'),
  source: text('source').default('web').notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const confirmations = pgTable('confirmations', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => reports.id)
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  kind: text('kind').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const abuseReports = pgTable('abuse_reports', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => reports.id)
    .notNull(),
  reporterId: integer('reporter_id')
    .references(() => users.id)
    .notNull(),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status').default('pending').notNull(),
  actionTaken: text('action_taken'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const zoneSubscriptions = pgTable('zone_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  zone: text('zone').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const stationClaims = pgTable('station_claims', {
  id: serial('id').primaryKey(),
  stationId: integer('station_id')
    .references(() => stations.id)
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  contactName: text('contact_name').notNull(),
  phone: text('phone').notNull(),
  role: text('role').notNull(),
  proofDetails: text('proof_details'),
  status: text('status').default('pending').notNull(),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const actionLogs = pgTable('action_logs', {
  id: serial('id').primaryKey(),
  adminId: integer('admin_id'),
  adminName: text('admin_name').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const telegramPendingBatches = pgTable('telegram_pending_batches', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  sourceType: text('source_type').default('text').notNull(),
  engine: text('engine'),
  decipheredText: text('deciphered_text'),
  rawInput: text('raw_input'),
  extractedItemsJson: text('extracted_items_json').notNull(),
  summaryHtml: text('summary_html'),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const usersRelations = relations(users, ({ many }) => ({
  reports: many(reports),
  confirmations: many(confirmations),
  zoneSubscriptions: many(zoneSubscriptions),
}));

export const stationsRelations = relations(stations, ({ many }) => ({
  reports: many(reports),
  claims: many(stationClaims),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  station: one(stations, {
    fields: [reports.stationId],
    references: [stations.id],
  }),
  author: one(users, {
    fields: [reports.userId],
    references: [users.id],
  }),
  confirmations: many(confirmations),
}));
