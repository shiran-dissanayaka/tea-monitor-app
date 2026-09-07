import { TB } from './config';
import { DataSource, DEVICES, Process, ThermalPoint, ThermalProfile } from './types';

/**
 * Live readings from ThingsBoard.
 *
 * History is sliced into actual runs rather than returned as one long stretch:
 * withering uses WTH_SessionActive, fermentation uses the gap between the bed
 * and ambient. Without this, the "last recorded profile" would be hours of
 * idle ambient readings drawn as if they were a run.
 */

type TsResponse = Record<string, { ts: number; value: string }[]>;

const numOrUndef = (v: string | undefined) => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const boolFrom = (v: string | undefined) => {
  if (v == null) return undefined;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === 'on') return true;
  if (s === 'false' || s === 'off') return false;
  const n = Number(v);
  return Number.isFinite(n) ? n !== 0 : undefined;
};

/** Thrown with a message meant to be shown on screen, not just logged. */
export class FeedError extends Error {}

export class ThingsBoardDataSource implements DataSource {
  readonly name = 'Factory feed';

  private jwt: string | null = null;
  private sockets = new Map<Process, WebSocket>();

  // ---------- auth ----------

  private async login(): Promise<string> {
    if (!TB.username || !TB.password) {
      throw new FeedError('No login configured. Fill in src/data/credentials.ts.');
    }
    let res: Response;
    try {
      res = await fetch(`${TB.host}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: TB.username, password: TB.password }),
      });
    } catch {
      throw new FeedError('Cannot reach the server. Check the phone is online.');
    }
    if (res.status === 401) throw new FeedError('Login rejected. Check the username and password.');
    if (!res.ok) throw new FeedError(`Login failed (${res.status}).`);
    const body = await res.json();
    this.jwt = body.token;
    return this.jwt!;
  }

  private async token(): Promise<string> {
    return this.jwt ?? (await this.login());
  }

  private async authed(url: string): Promise<Response> {
    let jwt = await this.token();
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'X-Authorization': `Bearer ${jwt}` } });
    } catch {
      throw new FeedError('Cannot reach the server. Check the phone is online.');
    }
    if (res.status === 401) {
      // Token expires after a couple of hours; log in again and retry once.
      this.jwt = null;
      jwt = await this.token();
      res = await fetch(url, { headers: { 'X-Authorization': `Bearer ${jwt}` } });
    }
    return res;
  }

  // ---------- mapping ----------

  private toPoint(process: Process, at: number, raw: Record<string, string>): ThermalPoint | null {
    const k = TB.keys[process];
    const temp = numOrUndef(raw[k.temp]);
    if (temp == null) return null;

    const pt: ThermalPoint = { t: at, min: temp, avg: temp, max: temp, rh: numOrUndef(raw[k.rh]) };

    if (k.ambient) pt.ambient = numOrUndef(raw[k.ambient]);
    if (k.moisture) pt.moisture = numOrUndef(raw[k.moisture]);
    if (k.weight) pt.weight = numOrUndef(raw[k.weight]);
    if (k.airflow) {
      const flow = numOrUndef(raw[k.airflow]);
      pt.airflow = flow;
      if (flow != null) pt.fan = flow > 0; // node reports flow, not a switch
    }
    if (k.session) pt.sessionActive = boolFrom(raw[k.session]);

    return pt;
  }

  // ---------- history ----------

  private async fetchHistory(process: Process, hours: number): Promise<ThermalPoint[]> {
    const deviceId = TB.deviceIds[process];
    if (!deviceId) throw new FeedError(`No device id configured for ${process}.`);

    const endTs = Date.now();
    const startTs = endTs - hours * 3_600_000;
    const keyList = Object.values(TB.keys[process]).join(',');
    const url =
      `${TB.host}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries` +
      `?keys=${encodeURIComponent(keyList)}&startTs=${startTs}&endTs=${endTs}` +
      `&limit=50000&orderBy=ASC`;

    const res = await this.authed(url);
    if (res.status === 403) throw new FeedError('This account cannot read that device.');
    if (!res.ok) throw new FeedError(`Could not load readings (${res.status}).`);

    const data: TsResponse = await res.json();
    if (Object.keys(data).length === 0) return [];

    // Each key has its own timestamps; bucket to the second so readings
    // published together land in one point.
    const buckets = new Map<number, Record<string, string>>();
    for (const [key, series] of Object.entries(data)) {
      for (const { ts, value } of series) {
        const bucket = Math.round(ts / 1000) * 1000;
        const row = buckets.get(bucket) ?? {};
        row[key] = value;
        buckets.set(bucket, row);
      }
    }

    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, row]) => this.toPoint(process, ts, row))
      .filter((p): p is ThermalPoint => p !== null);
  }

  /** True when this reading looks like part of a run. */
  private inRun(process: Process, p: ThermalPoint): boolean {
    if (p.sessionActive != null) return p.sessionActive;
    if (p.ambient != null) return p.avg - p.ambient >= TB.fermentRunGap;
    return false;
  }

  /** Splits a history window into runs, discarding idle stretches. */
  private slice(process: Process, points: ThermalPoint[]): ThermalPoint[][] {
    const runs: ThermalPoint[][] = [];
    let current: ThermalPoint[] = [];
    for (const p of points) {
      if (this.inRun(process, p)) {
        current.push(p);
      } else if (current.length) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length) runs.push(current);

    const minMs = TB.minRunMinutes * 60_000;
    return runs.filter((r) => r.length > 1 && r[r.length - 1].t - r[0].t >= minMs);
  }

  private profileFrom(process: Process, points: ThermalPoint[], open: boolean): ThermalProfile {
    return {
      id: `tb-${process}-${points[0].t}`,
      process,
      deviceId: TB.deviceIds[process],
      location: DEVICES[process].location,
      startedAt: points[0].t,
      endedAt: open ? null : points[points.length - 1].t,
      points,
    };
  }

  // ---------- DataSource ----------

  async getActiveProfile(process: Process): Promise<ThermalProfile | null> {
    const points = await this.fetchHistory(process, TB.historyHours);
    if (points.length === 0) return null;

    const newest = points[points.length - 1];
    // A run is only active if the newest reading is both recent and in-run.
    if (Date.now() - newest.t > 15 * 60_000) return null;
    if (!this.inRun(process, newest)) return null;

    const runs = this.slice(process, points);
    const last = runs[runs.length - 1];
    if (!last || last[last.length - 1].t !== newest.t) return null;
    return this.profileFrom(process, last, true);
  }

  async getLastProfile(process: Process): Promise<ThermalProfile | null> {
    const points = await this.fetchHistory(process, TB.historyHours);
    const runs = this.slice(process, points);
    const done = runs.filter((r) => !this.inRun(process, r[r.length - 1]) || r !== runs[runs.length - 1]);
    const last = done[done.length - 1] ?? null;
    return last ? this.profileFrom(process, last, false) : null;
  }

  /** Most recent reading regardless of whether a run is on, for the value boxes. */
  async getLatestPoint(process: Process): Promise<ThermalPoint | null> {
    const points = await this.fetchHistory(process, 2);
    return points.length ? points[points.length - 1] : null;
  }

  subscribe(
    process: Process,
    handlers: { onPoint: (p: ThermalPoint) => void; onError?: (m: string) => void },
  ): () => void {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    /** Latest value per key, so a frame carrying only humidity still yields a full point. */
    const latest: Record<string, string> = {};

    const connect = async () => {
      if (closed) return;
      try {
        const jwt = await this.token();
        const ws = new WebSocket(`${TB.wsHost}/api/ws/plugins/telemetry?token=${jwt}`);
        this.sockets.set(process, ws);

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              tsSubCmds: [
                {
                  entityType: 'DEVICE',
                  entityId: TB.deviceIds[process],
                  scope: 'LATEST_TELEMETRY',
                  cmdId: process === 'withering' ? 1 : 2,
                },
              ],
              historyCmds: [],
              attrSubCmds: [],
            }),
          );
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string);
            if (!msg.data) return;
            let at = Date.now();
            let changed = false;
            for (const [key, entries] of Object.entries(
              msg.data as Record<string, [number, string][]>,
            )) {
              const newest = entries[entries.length - 1];
              if (!newest) continue;
              at = newest[0];
              latest[key] = newest[1];
              changed = true;
            }
            if (!changed) return;
            const pt = this.toPoint(process, at, latest);
            if (pt) handlers.onPoint(pt);
          } catch {
            // malformed frame, ignore
          }
        };

        // Dropped sockets are normal on mobile. Reconnect quietly; the screen
        // shows "stale" meanwhile, which is the honest state.
        ws.onclose = () => {
          if (!closed) retry = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
      } catch (e) {
        handlers.onError?.(e instanceof FeedError ? e.message : 'Live connection failed.');
        if (!closed) retry = setTimeout(connect, 10_000);
      }
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      this.sockets.get(process)?.close();
      this.sockets.delete(process);
    };
  }
}
