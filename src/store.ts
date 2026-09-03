import { create } from 'zustand';
import { AlertSettings, DEFAULT_SETTINGS, ProcessDetector } from './alerts/engine';
import { presentAlert, setupNotifications } from './alerts/notifications';
import { dataSource, MockDataSource } from './data';
import { DEVICES, Process, ThermalAlert, ThermalPoint, ThermalProfile } from './data/types';
import * as db from './db/database';

/** The freshness rule from section 5.1 of the design document. */
export type Freshness = 'live' | 'stale' | 'last_recorded';
const LIVE_WINDOW_MS = 2 * 60_000;

interface ProcessState {
  active: ThermalProfile | null;
  lastRecorded: ThermalProfile | null;
  lastPointAt: number | null;
}

interface Store {
  ready: boolean;
  notificationsAllowed: boolean;
  settings: AlertSettings;
  alerts: ThermalAlert[];
  withering: ProcessState;
  fermentation: ProcessState;
  tick: number; // forces "updated N seconds ago" to re-render

  init: () => Promise<void>;
  setSettings: (patch: Partial<AlertSettings>) => void;
  freshnessOf: (p: Process) => Freshness;
  /** Manual override, exposed on the process screen when detection is off. */
  markStart: (p: Process) => void;
  markEnd: (p: Process) => void;
}

const emptyProcess = (): ProcessState => ({ active: null, lastRecorded: null, lastPointAt: null });

export const useStore = create<Store>((set, get) => {
  const detectors: Partial<Record<Process, ProcessDetector>> = {};

  const pushAlert = async (a: ThermalAlert) => {
    await db.saveAlert(a);
    set((s) => ({ alerts: [a, ...s.alerts].slice(0, 100) }));
    const { settings, notificationsAllowed } = get();
    if (!notificationsAllowed) return;
    await presentAlert({
      kind: a.kind,
      title: a.title,
      body: a.body,
      vibrate: settings.vibrate,
      sound: settings.sound,
    });
  };

  const beginProfile = async (process: Process, profile: ThermalProfile) => {
    await db.saveProfile(profile);
    for (const pt of profile.points) await db.savePoint(profile.id, pt);
    set((s) => ({ [process]: { ...s[process], active: profile, lastPointAt: Date.now() } } as any));
    detectors[process]?.announceStart(profile, get().settings);
  };

  const endProfile = async (process: Process, profile: ThermalProfile) => {
    const endedAt = profile.endedAt ?? Date.now();
    await db.closeProfile(profile.id, endedAt);
    detectors[process]?.announceEnd({ ...profile, endedAt }, get().settings);
    set((s) => ({
      [process]: { ...s[process], active: null, lastRecorded: { ...profile, endedAt } },
    } as any));
  };

  const wire = (process: Process) => {
    detectors[process] = new ProcessDetector(process, DEVICES[process].deviceId, pushAlert);

    dataSource.subscribe(process, {
      onPoint: async (pt: ThermalPoint) => {
        const st = get()[process];
        if (st.active) {
          const updated = { ...st.active, points: [...st.active.points, pt] };
          set((s) => ({ [process]: { ...s[process], active: updated, lastPointAt: Date.now() } } as any));
          await db.savePoint(st.active.id, pt);
        } else {
          set((s) => ({ [process]: { ...s[process], lastPointAt: Date.now() } } as any));
        }
        detectors[process]!.onPoint(pt, get()[process].active, get().settings);
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

    init: async () => {
      await db.initDb();
      const allowed = await setupNotifications();

      const [wLast, fLast, alerts] = await Promise.all([
        db.getLastCompleted('withering'),
        db.getLastCompleted('fermentation'),
        db.getAlerts(),
      ]);

      // Nothing cached yet (first launch): seed from the source so the
      // last-recorded fallback has something to show straight away.
      const seed = async (p: Process, cached: ThermalProfile | null) => {
        if (cached) return cached;
        const fromSource = await dataSource.getLastProfile(p);
        if (fromSource) {
          await db.saveProfile(fromSource);
          for (const pt of fromSource.points) await db.savePoint(fromSource.id, pt);
        }
        return fromSource;
      };

      set({
        ready: true,
        notificationsAllowed: allowed,
        alerts,
        withering: { ...emptyProcess(), lastRecorded: await seed('withering', wLast) },
        fermentation: { ...emptyProcess(), lastRecorded: await seed('fermentation', fLast) },
      });

      (['withering', 'fermentation'] as Process[]).forEach(wire);

      setInterval(() => {
        const s = get();
        (['withering', 'fermentation'] as Process[]).forEach((p) =>
          detectors[p]?.checkStale(s[p].active, s.settings),
        );
        set({ tick: get().tick + 1 });
      }, 1000);
    },

    setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

    freshnessOf: (p) => {
      const st = get()[p];
      if (!st.active) return 'last_recorded';
      const age = Date.now() - (st.lastPointAt ?? 0);
      return age < LIVE_WINDOW_MS ? 'live' : 'stale';
    },

    markStart: (p) => {
      if (dataSource instanceof MockDataSource) dataSource.forceStart(p);
    },
    markEnd: (p) => {
      if (dataSource instanceof MockDataSource) dataSource.forceEnd(p);
    },
  };
});
