import { create } from 'zustand';
import { AlertSettings, DEFAULT_SETTINGS, ProcessDetector } from './alerts/engine';
import { presentAlert, setupNotifications } from './alerts/notifications';
import { dataSource } from './data';
import { DEVICES, Process, ThermalAlert, ThermalPoint, ThermalProfile } from './data/types';
import * as db from './db/database';

export type Freshness = 'live' | 'stale' | 'last_recorded';
const LIVE_WINDOW_MS = 2 * 60_000;

const uid = () => Math.random().toString(36).slice(2, 10);

interface ProcessState {
  active: ThermalProfile | null;
  lastRecorded: ThermalProfile | null;
  /** Newest reading, run or no run. Drives the value boxes. */
  latest: ThermalPoint | null;
  lastPointAt: number | null;
  /** Shown on screen when the feed is misbehaving. */
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

  init: () => Promise<void>;
  setSettings: (patch: Partial<AlertSettings>) => void;
  freshnessOf: (p: Process) => Freshness;
  markStart: (p: Process) => void;
  markEnd: (p: Process) => void;
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

  const pushAlert = async (a: ThermalAlert) => {
    await db.saveAlert(a);
    set((s) => ({ alerts: [a, ...s.alerts].slice(0, 100) }));
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
    for (const pt of profile.points) await db.savePoint(profile.id, pt);
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

  const wire = (process: Process) => {
    detectors[process] = new ProcessDetector(process, DEVICES[process].deviceId, pushAlert);

    dataSource.subscribe(process, {
      onError: (message: string) => patch(process, { error: message }),

      onPoint: async (pt: ThermalPoint) => {
        const st = get()[process];

        // The value boxes always show the newest reading, even with no run on.
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

    init: async () => {
      await db.initDb();
      const allowed = await setupNotifications();
      const alerts = await db.getAlerts();

      set({ ready: true, notificationsAllowed: allowed, alerts });

      for (const p of ['withering', 'fermentation'] as Process[]) {
        const cached = await db.getLastCompleted(p);
        patch(p, { lastRecorded: cached });

        // Fetch in the background so a slow or failing server does not block
        // the app from opening. Failures land on screen, not in a log.
        (async () => {
          try {
            const [active, last] = await Promise.all([
              dataSource.getActiveProfile(p),
              dataSource.getLastProfile(p),
            ]);
            if (active) {
              await db.saveProfile(active);
              for (const pt of active.points) await db.savePoint(active.id, pt);
              patch(p, { active, latest: active.points[active.points.length - 1] });
            }
            if (last) {
              await db.saveProfile(last);
              for (const pt of last.points) await db.savePoint(last.id, pt);
              patch(p, { lastRecorded: last });
            }
            const anyGetLatest = dataSource as unknown as {
              getLatestPoint?: (x: Process) => Promise<ThermalPoint | null>;
            };
            if (!active && anyGetLatest.getLatestPoint) {
              const latest = await anyGetLatest.getLatestPoint(p);
              if (latest) patch(p, { latest, lastPointAt: Date.now() });
            }
            patch(p, { error: null });
          } catch (e) {
            patch(p, { error: e instanceof Error ? e.message : 'Could not load readings.' });
          }
        })();

        wire(p);
      }

      setInterval(() => {
        const s = get();
        (['withering', 'fermentation'] as Process[]).forEach((p) =>
          detectors[p]?.checkStale(s[p].active, s.settings),
        );
        set({ tick: get().tick + 1 });
      }, 1000);
    },

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
