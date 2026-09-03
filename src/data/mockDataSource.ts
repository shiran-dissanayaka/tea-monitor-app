import { DataSource, DEVICES, Process, ThermalPoint, ThermalProfile } from './types';

/**
 * Generates curves that look like tea processing rather than noise.
 * Simulated time is compressed so a run finishes inside a demo.
 */
const TICK_MS = 1500;
const SPEED = 2.2; // simulated minutes per tick
const IDLE_TICKS = 12;
const DROPOUT_CHANCE = 0.012;

type Curve = {
  durationMin: number;
  avg: (t: number) => number;
  spread: (t: number) => number;
  /** Relative humidity, percent. */
  rh: (t: number) => number;
  ambient?: (t: number) => number;
  /** Leaf moisture content, percent. */
  moisture?: (t: number) => number;
};

const CURVES: Record<Process, Curve> = {
  // Trough follows air temperature: falls through the night, climbs at dawn.
  // Humidity falls steadily as the fans drive moisture out of the leaf.
  withering: {
    durationMin: 14 * 60,
    avg: (t) => {
      const h = t / 60;
      let v = 27.4 - 4.6 * Math.pow(Math.sin((Math.PI * Math.min(h, 11)) / 11), 1.3);
      v += 0.9 * Math.exp(-Math.pow(h - 12.4, 2) / 2.2);
      return v;
    },
    spread: (t) => 1.35 + 0.35 * Math.sin(t / 126),
    rh: (t) => 86 - 19 * (t / (14 * 60)) + 2.5 * Math.sin(t / 95),
  },
  // Oxidation exotherm: climbs, peaks about two thirds through.
  // The bed is kept humid; leaf moisture falls slowly through the run.
  fermentation: {
    durationMin: 96,
    avg: (t) => 24.2 + 4.4 / (1 + Math.exp(-(t - 34) / 11)) - 1.5 / (1 + Math.exp(-(t - 74) / 7)),
    spread: (t) => 0.55 + (0.5 * t) / 96,
    rh: (t) => 95.5 - 6 * (t / 96) + 0.8 * Math.sin(t / 17),
    ambient: (t) => 25.1 + 1.2 * Math.sin(t / 40),
    moisture: (t) => 71.5 - 5.5 * (t / 96),
  },
};

/** Fans cycle: roughly 45 simulated minutes on, 12 off. */
const fanOn = (t: number) => t % 57 < 45;

const gauss = (sd: number) => {
  const u = 1 - Math.random();
  const v = Math.random();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Handlers = {
  onPoint: (p: ThermalPoint) => void;
  onProfileStart?: (p: ThermalProfile) => void;
  onProfileEnd?: (p: ThermalProfile) => void;
};

class Runner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private subs = new Set<Handlers>();
  private simMinutes = 0;
  private idleLeft = 4;
  private profile: ThermalProfile | null = null;
  private last: ThermalProfile | null = null;

  constructor(private process: Process) {
    this.last = this.synthesiseCompletedRun();
  }

  get active() {
    return this.profile;
  }
  get lastCompleted() {
    return this.last;
  }

  subscribe(h: Handlers) {
    this.subs.add(h);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return () => {
      this.subs.delete(h);
      if (this.subs.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  forceStart() {
    if (!this.profile) this.begin();
  }
  forceEnd() {
    if (this.profile) this.finish();
  }

  private makePoint(minsIn: number, at: number): ThermalPoint {
    const c = CURVES[this.process];
    const a = c.avg(minsIn) + gauss(0.09);
    const s = c.spread(minsIn);

    const pt: ThermalPoint = {
      t: at,
      min: +(a - s * (0.9 + Math.random() * 0.2)).toFixed(2),
      avg: +a.toFixed(2),
      max: +(a + s * (0.85 + Math.random() * 0.25)).toFixed(2),
      rh: +clamp(c.rh(minsIn) + gauss(0.5), 20, 100).toFixed(1),
      zones: {
        fl: +(a - s * 0.55).toFixed(2),
        fr: +(a - s * 0.15).toFixed(2),
        bl: +(a + s * 0.2).toFixed(2),
        br: +(a + s * 0.5).toFixed(2),
      },
    };

    if (this.process === 'withering') {
      pt.fan = fanOn(minsIn);
    }
    if (c.ambient) pt.ambient = +(c.ambient(minsIn) + gauss(0.15)).toFixed(2);
    if (c.moisture) pt.moisture = +clamp(c.moisture(minsIn) + gauss(0.2), 0, 100).toFixed(2);

    return pt;
  }

  private begin() {
    const d = DEVICES[this.process];
    this.simMinutes = 0;
    this.profile = {
      id: uid(),
      process: this.process,
      deviceId: d.deviceId,
      location: d.location,
      startedAt: Date.now(),
      endedAt: null,
      points: [this.makePoint(0, Date.now())],
    };
    this.subs.forEach((h) => h.onProfileStart?.(this.profile!));
    this.subs.forEach((h) => h.onPoint(this.profile!.points[0]));
  }

  private finish() {
    if (!this.profile) return;
    this.profile.endedAt = Date.now();
    this.last = this.profile;
    this.subs.forEach((h) => h.onProfileEnd?.(this.profile!));
    this.profile = null;
    this.idleLeft = IDLE_TICKS;
  }

  private tick() {
    if (!this.profile) {
      if (--this.idleLeft <= 0) this.begin();
      return;
    }
    this.simMinutes += SPEED;
    if (this.simMinutes >= CURVES[this.process].durationMin) {
      this.finish();
      return;
    }
    if (Math.random() < DROPOUT_CHANCE) return;
    const pt = this.makePoint(this.simMinutes, Date.now());
    this.profile.points.push(pt);
    this.subs.forEach((h) => h.onPoint(pt));
  }

  /** A finished run, so the last-recorded fallback has something on first launch. */
  private synthesiseCompletedRun(): ThermalProfile {
    const c = CURVES[this.process];
    const d = DEVICES[this.process];
    const n = 90;
    const endedAt = Date.now() - 105 * 60_000;
    const startedAt = endedAt - c.durationMin * 60_000;
    const points: ThermalPoint[] = [];
    for (let i = 0; i < n; i++) {
      const mins = (i / (n - 1)) * c.durationMin;
      points.push(this.makePoint(mins, startedAt + mins * 60_000));
    }
    return {
      id: uid(),
      process: this.process,
      deviceId: d.deviceId,
      location: d.location,
      startedAt,
      endedAt,
      points,
    };
  }
}

export class MockDataSource implements DataSource {
  readonly name = 'Sample data';
  private runners: Record<Process, Runner> = {
    withering: new Runner('withering'),
    fermentation: new Runner('fermentation'),
  };

  async getActiveProfile(p: Process) {
    return this.runners[p].active;
  }
  async getLastProfile(p: Process) {
    return this.runners[p].lastCompleted;
  }
  subscribe(p: Process, h: Handlers) {
    return this.runners[p].subscribe(h);
  }

  forceStart(p: Process) {
    this.runners[p].forceStart();
  }
  forceEnd(p: Process) {
    this.runners[p].forceEnd();
  }
}
