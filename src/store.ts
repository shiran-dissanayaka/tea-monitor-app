import { AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { AlertSettings, backfillAlerts, DEFAULT_SETTINGS, ProcessDetector } from './alerts/engine';
import { presentAlert, setupNotifications } from './alerts/notifications';
import { dataSource } from './data';
import { DEVICES, Process, ThermalAlert, ThermalPoint, ThermalProfile } from './data/types';
import * as db from './db/database';
import { listenForPush } from './push/pushListener';

export type Freshness = 'live' | 'stale' | 'last_recorded';
const LIVE_WINDOW_MS = 2 * 60_000;
const PROCESSES: Process[] = ['withering', 'fermentation'];

const uid = () => Math.random().toString(36).slice(2, 10);

interface ProcessState {
  active: ThermalProfile | null;
  lastRecorded: ThermalProfile | null;
  latest: ThermalPoint | null;
  lastPointAt: number | null;
  error: string | null;
}

interface Store {
  ready: boolean;
  notificationsAllowed: boolean;
  settings: AlertSettings;
  alerts: ThermalAlert[];
  withering: ProcessState;
  fermentation: ProcessState;
  tick: number;
  syncing: boolean;

  init: () => Promise<void>;
  setSettings: (patch: Partial<AlertSettings>) => void;
  freshnessOf: (p: Process) => Freshness;
  markStart: (p: Process) => void;
  markEnd: (p: Process) => void;
  refresh: () => Promise<void>;
  reloadAlerts: () => Promise<void>;
}

const emptyProcess = (): ProcessState => ({
  active: null,
  lastRecorded: null,
  latest: null,
  lastPointAt: null,
  error: null,
});

export const useStore = create<Store>((set, get) => {
  const detectors: Partial<Record<Process, ProcessDetector>> = {};

  const patch = (process: Process, p: Partial<ProcessState>) =>
    set((s) => ({ [process]: { ...s[process], ...p } } as any));

  const reloadAlerts = async () => set({ alerts: await db.getAlerts() });

  /**
   * Every alert goes through here, whether the app detected it or the server
   * pushed it. The first to claim the event notifies; the second is recorded in
   * history and stays silent, so the phone buzzes once.
   */
  const pushAlert = async (a: ThermalAlert) => {
    await db.saveAlert(a);
    set((s) => ({ alerts: [a, ...s.alerts].slice(0, 200) }));

    const shouldNotify = await db.claimDelivery(`${a.process}:${a.kind}`);
    if (!shouldNotify) return;

    const { settings, notificationsAllowed } = get();
    await presentAlert({
      kind: a.kind,
      title: a.title,
      body: a.body,
      vibrate: settings.vibrate,
      sound: settings.sound,
      banners: notificationsAllowed,
    });
  };

  const beginProfile = async (process: Process, profile: ThermalProfile) => {
    await db.saveProfile(profile);
    await db.savePoints(profile.id, profile.points);
    patch(process, { active: profile, lastPointAt: Date.now() });
    detectors[process]?.announceStart(profile, get().settings);
  };

  const endProfile = async (process: Process, profile: ThermalProfile) => {
    const endedAt = profile.endedAt ?? Date.now();
    await db.closeProfile(profile.id, endedAt);
    detectors[process]?.announceEnd({ ...profile, endedAt }, get().settings);
    patch(process, { active: null, lastRecorded: { ...profile, endedAt } });
  };

  const openProfile = (process: Process, seed: ThermalPoint): ThermalProfile => ({
    id: uid(),
    process,
    deviceId: DEVICES[process].deviceId,
    location: DEVICES[process].location,
    startedAt: seed.t,
    endedAt: null,
    points: [seed],
  });

  /**
   * Reconstruct what happened while the app was closed. Backfilled alerts are
   * written to history with their original timestamps and never buzz — a
   * notification for something six hours old is noise.
   */
  const backfill = async (process: Process) => {
    const source = dataSource as typeof dataSource & {
      getRecentRuns?: (p: Process, hours?: number) => Promise<ThermalProfile[]>;
    };
    if (!source.getRecentRuns) return;

    const runs = await source.getRecentRuns(process);
    const fresh: ThermalAlert[] = [];

    for (const run of runs) {
      if (await db.hasProfile(run.id)) continue;
      await db.saveProfile(run);
      await db.savePoints(run.id, run.points);
      fresh.push(...backfillAlerts(run));
    }

    if (fresh.length) {
      await db.saveAlerts(fresh);
      await reloadAlerts();
    }

    const open = runs.find((r) => r.endedAt == null) ?? null;
    const done = runs.filter((r) => r.endedAt != null);
    patch(process, {
      active: open,
      lastRecorded: done[done.length - 1] ?? get()[process].lastRecorded,
      ...(open ? { lastPointAt: Date.now() } : {}),
    });
  };

  const syncAll = async () => {
    if (get().syncing) return;
    set({ syncing: true });
    for (const p of PROCESSES) {
      try {
        await backfill(p);
        const source = dataSource as typeof dataSource & {
          getLatestPoint?: (x: Process) => Promise<ThermalPoint | null>;
        };
        if (!get()[p].active && source.getLatestPoint) {
          const latest = await source.getLatestPoint(p);
          if (latest) patch(p, { latest, lastPointAt: Date.now() });
        }
        patch(p, { error: null });
      } catch (e) {
        patch(p, { error: e instanceof Error ? e.message : 'Could not load readings.' });
      }
    }
    set({ syncing: false });
  };

  const wire = (process: Process) => {
    detectors[process] = new ProcessDetector(process, DEVICES[process].deviceId, pushAlert);

    dataSource.subscribe(process, {
      onError: (message: string) => patch(process, { error: message }),

      onPoint: async (pt: ThermalPoint) => {
        const st = get()[process];
        patch(process, { latest: pt, lastPointAt: Date.now(), error: null });

        if (st.active) {
          patch(process, { active: { ...st.active, points: [...st.active.points, pt] } });
          await db.savePoint(st.active.id, pt);
        }

        const verdict = detectors[process]!.onPoint(pt, get()[process].active, get().settings);
        if (verdict === 'start' && !get()[process].active) {
          await beginProfile(process, openProfile(process, pt));
        } else if (verdict === 'end') {
          const active = get()[process].active;
          if (active) await endProfile(process, active);
        }
      },

      onProfileStart: (p) => beginProfile(process, p),
      onProfileEnd: (p) => endProfile(process, p),
    });
  };

  return {
    ready: false,
    notificationsAllowed: false,
    settings: DEFAULT_SETTINGS,
    alerts: [],
    withering: emptyProcess(),
    fermentation: emptyProcess(),
    tick: 0,
    syncing: false,

    init: async () => {
      await db.initDb();
      const allowed = await setupNotifications();
      const alerts = await db.getAlerts();

      set({ ready: true, notificationsAllowed: allowed, alerts });

      for (const p of PROCESSES) {
        patch(p, { lastRecorded: await db.getLastCompleted(p) });
      }

      syncAll();
      PROCESSES.forEach(wire);

      // A push that lands while the app is open claims its event, so the app's
      // own detector will not raise the same alert a second time.
      listenForPush(() => {
        reloadAlerts();
      });

      AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active') syncAll();
      });

      setInterval(() => {
        const s = get();
        PROCESSES.forEach((p) => detectors[p]?.checkStale(s[p].active, s.settings));
        set({ tick: get().tick + 1 });
      }, 1000);
    },

    refresh: syncAll,
    reloadAlerts,

    setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),

    freshnessOf: (p) => {
      const st = get()[p];
      if (!st.active) return 'last_recorded';
      const age = Date.now() - (st.lastPointAt ?? 0);
      return age < LIVE_WINDOW_MS ? 'live' : 'stale';
    },

    markStart: (p) => {
      const st = get()[p];
      if (st.active) return;
      const seed = st.latest ?? st.lastRecorded?.points.slice(-1)[0];
      const pt: ThermalPoint = seed
        ? { ...seed, t: Date.now() }
        : { t: Date.now(), min: 0, avg: 0, max: 0 };
      beginProfile(p, openProfile(p, pt));
    },
    markEnd: (p) => {
      const active = get()[p].active;
      if (active) endProfile(p, active);
    },
  };
});
