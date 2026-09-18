import * as SQLite from 'expo-sqlite';
import { Process, ThermalAlert, ThermalPoint, ThermalProfile } from '../data/types';

let db: SQLite.SQLiteDatabase | null = null;
const RETAIN_DAYS = 30;

/** How long one event stays claimed, so a push and a local detection of the
 *  same run start cannot both buzz the phone. Runs last hours, so nothing
 *  legitimate repeats inside this window. */
const CLAIM_WINDOW_MS = 15 * 60_000;

const ADDED_COLUMNS = ['rh REAL', 'fan INTEGER', 'ambient REAL', 'moisture REAL', 'weight REAL', 'session INTEGER'];

export async function initDb() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('thermal-live.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY NOT NULL,
      process TEXT NOT NULL,
      device_id TEXT NOT NULL,
      location TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS points (
      profile_id TEXT NOT NULL,
      t INTEGER NOT NULL,
      min REAL NOT NULL, avg REAL NOT NULL, max REAL NOT NULL,
      fl REAL, fr REAL, bl REAL, br REAL,
      rh REAL, fan INTEGER, ambient REAL, moisture REAL, weight REAL, session INTEGER,
      PRIMARY KEY (profile_id, t)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL, process TEXT NOT NULL, device_id TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivered (
      key TEXT PRIMARY KEY NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_proc ON profiles(process, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_at ON alerts(at DESC);
  `);

  for (const col of ADDED_COLUMNS) {
    try {
      await db.execAsync(`ALTER TABLE points ADD COLUMN ${col};`);
    } catch {
      // column already exists
    }
  }

  await prune();
  return db;
}

const need = () => {
  if (!db) throw new Error('initDb() has not run');
  return db;
};

/**
 * Claims an event for notification. Returns true if the caller should notify,
 * false if something already did within the window.
 */
export async function claimDelivery(key: string, windowMs = CLAIM_WINDOW_MS) {
  const now = Date.now();
  const row = await need().getFirstAsync<{ at: number }>(
    `SELECT at FROM delivered WHERE key = ? LIMIT 1`,
    [key],
  );
  if (row && now - row.at < windowMs) return false;
  await need().runAsync(
    `INSERT OR REPLACE INTO delivered (key, at) VALUES (?, ?)`,
    [key, now],
  );
  return true;
}

export async function saveProfile(p: ThermalProfile) {
  await need().runAsync(
    `INSERT OR REPLACE INTO profiles (id, process, device_id, location, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [p.id, p.process, p.deviceId, p.location, p.startedAt, p.endedAt],
  );
}

/** Used by backfill to skip runs already stored. */
export async function hasProfile(id: string) {
  const row = await need().getFirstAsync<{ id: string }>(
    `SELECT id FROM profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  return row != null;
}

export async function savePoint(profileId: string, pt: ThermalPoint) {
  const z = pt.zones;
  await need().runAsync(
    `INSERT OR REPLACE INTO points
       (profile_id, t, min, avg, max, fl, fr, bl, br, rh, fan, ambient, moisture, weight, session)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profileId, pt.t, pt.min, pt.avg, pt.max,
      z?.fl ?? null, z?.fr ?? null, z?.bl ?? null, z?.br ?? null,
      pt.rh ?? null,
      pt.fan == null ? null : pt.fan ? 1 : 0,
      pt.ambient ?? null,
      pt.moisture ?? null,
      pt.weight ?? null,
      pt.sessionActive == null ? null : pt.sessionActive ? 1 : 0,
    ],
  );
}

/** One transaction per run keeps backfill fast; point-by-point writes crawl. */
export async function savePoints(profileId: string, points: ThermalPoint[]) {
  await need().withTransactionAsync(async () => {
    for (const pt of points) await savePoint(profileId, pt);
  });
}

export async function closeProfile(id: string, endedAt: number) {
  await need().runAsync(`UPDATE profiles SET ended_at = ? WHERE id = ?`, [endedAt, id]);
}

type Row = {
  id: string; process: string; device_id: string; location: string;
  started_at: number; ended_at: number | null;
};

async function hydrate(row: Row): Promise<ThermalProfile> {
  const pts = await need().getAllAsync<any>(
    `SELECT t, min, avg, max, fl, fr, bl, br, rh, fan, ambient, moisture, weight, session
     FROM points WHERE profile_id = ? ORDER BY t ASC`,
    [row.id],
  );
  return {
    id: row.id,
    process: row.process as Process,
    deviceId: row.device_id,
    location: row.location,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    points: pts.map((p) => ({
      t: p.t, min: p.min, avg: p.avg, max: p.max,
      rh: p.rh ?? undefined,
      fan: p.fan == null ? undefined : p.fan === 1,
      ambient: p.ambient ?? undefined,
      moisture: p.moisture ?? undefined,
      weight: p.weight ?? undefined,
      sessionActive: p.session == null ? undefined : p.session === 1,
      zones: p.fl == null ? undefined : { fl: p.fl, fr: p.fr, bl: p.bl, br: p.br },
    })),
  };
}

export async function getLastCompleted(process: Process): Promise<ThermalProfile | null> {
  const row = await need().getFirstAsync<Row>(
    `SELECT * FROM profiles WHERE process = ? AND ended_at IS NOT NULL
     ORDER BY ended_at DESC LIMIT 1`,
    [process],
  );
  return row ? hydrate(row) : null;
}

export async function getRecentProfiles(process: Process, limit = 10) {
  const rows = await need().getAllAsync<Row>(
    `SELECT * FROM profiles WHERE process = ? ORDER BY started_at DESC LIMIT ?`,
    [process, limit],
  );
  return Promise.all(rows.map(hydrate));
}

export async function saveAlert(a: ThermalAlert) {
  await need().runAsync(
    `INSERT OR REPLACE INTO alerts (id, kind, process, device_id, title, body, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.kind, a.process, a.deviceId, a.title, a.body, a.at],
  );
}

export async function saveAlerts(list: ThermalAlert[]) {
  await need().withTransactionAsync(async () => {
    for (const a of list) await saveAlert(a);
  });
}

export async function getAlerts(limit = 200): Promise<ThermalAlert[]> {
  const rows = await need().getAllAsync<any>(
    `SELECT * FROM alerts ORDER BY at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, process: r.process, deviceId: r.device_id,
    title: r.title, body: r.body, at: r.at,
  }));
}

async function prune() {
  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
  await need().execAsync(`
    DELETE FROM points WHERE profile_id IN (SELECT id FROM profiles WHERE started_at < ${cutoff});
    DELETE FROM profiles WHERE started_at < ${cutoff};
    DELETE FROM alerts WHERE at < ${cutoff};
    DELETE FROM delivered WHERE at < ${Date.now() - 86_400_000};
  `);
}
