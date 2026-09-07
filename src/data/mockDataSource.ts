import { DataSource, DEVICES, Process, ThermalPoint, ThermalProfile } from './types';

/**
 * Sample data shaped like the real nodes: one temperature sensor per bed, so
 * min, avg and max are equal and the chart draws a plain line — exactly what
 * the live feed will look like.
 */
const TICK_MS = 1500;
const SPEED = 2.2; // simulated minutes per tick
const IDLE_TICKS = 12;
const DROPOUT_CHANCE = 0.012;

type Curve = {
  durationMin: number;
  temp: (t: number) => number;
  rh: (t: number) => number;
  ambient?: (t: number) => number;
  moisture?: (t: number) => number;
  weight?: (t: number) => number;
  airflow?: (t: number) => number;
  /** Withering nodes publish their own run flag. */
  session?: boolean;
};

const CURVES: Record<Process, Curve> = {
  withering: {
    durationMin: 14 * 60,
    session: true,
    temp: (t) => {
      const h = t / 60;
      let v = 27.4 - 4.6 * Math.pow(Math.sin((Math.PI * Math.min(h, 11)) / 11), 1.3);
      v += 0.9 * Math.exp(-Math.pow(h - 12.4, 2) / 2.2);
      return v;
    },
    rh: (t) => 86 - 19 * (t / (14 * 60)) + 2.5 * Math.sin(t / 95),
    // Leaf loses roughly a third of its weight over a full wither.
    weight: (t) => 248 - 82 * (t / (14 * 60)),
    // Fans cycle: about 45 simulated minutes on, 12 off.
    airflow: (t) => (t % 57 < 45 ? 6.1 + 0.4 * Math.sin(t / 9) : 0),
  },
  fermentation: {
    durationMin: 96,
    // Oxidation exotherm: the bed climbs above ambient, peaks, then eases.
    temp: (t) => 29.9 + 3.1 / (1 + Math.exp(-(t - 30) / 10)) - 1.2 / (1 + Math.exp(-(t - 74) / 7)),
    rh: (t) => 82 - 4 * (t / 96) + 0.8 * Math.sin(t / 17),
    ambient: (t) => 29.8 + 0.5 * Math.sin(t / 40),
    moisture: (t) => 13.5 - 2.2 * (t / 96),
  },
};

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

  private makePoint(minsIn: number, at: number, running = true): ThermalPoint {
    const c = CURVES[this.process];
    const temp = +(c.temp(minsIn) + gauss(0.09)).toFixed(2);

    const pt: ThermalPoint = {
      t: at,
      min: temp,
      avg: temp,
      max: temp,
      rh: +clamp(c.rh(minsIn) + gauss(0.5), 20, 100).toFixed(1),
    };

    if (c.ambient) pt.ambient = +(c.ambient(minsIn) + gauss(0.12)).toFixed(2);
    if (c.moisture) pt.moisture = +clamp(c.moisture(minsIn) + gauss(0.15), 0, 100).toFixed(2);
    if (c.weight) pt.weight = +clamp(c.weight(minsIn) + gauss(0.4), 0, 1000).toFixed(1);
    if (c.airflow) {
      const flow = running ? +Math.max(0, c.airflow(minsIn)).toFixed(2) : 0;
      pt.airflow = flow;
      pt.fan = flow > 0;
    }
    if (c.session) pt.sessionActive = running;

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
      // Idle readings still arrive from a real node: ambient temperature, fans
      // off, session flag clear. The detector needs to see them.
      this.subs.forEach((h) => h.onPoint(this.makePoint(0, Date.now(), false)));
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
