import { DataSource, Process, ThermalPoint, ThermalProfile } from './types';

/**
 * Not wired up yet. This file is the entire migration from sample data to the
 * factory feed: implement these three methods against ThingsBoard and change
 * ACTIVE_SOURCE in ./index.ts. No screen changes.
 *
 * History  GET  {host}/api/plugins/telemetry/DEVICE/{id}/values/timeseries
 * Live     WSS  {host}/api/ws/plugins/telemetry?token={jwt}
 *
 * Note: the customer-level login only reaches device endpoints, not tenant
 * ones, so device ids are configured rather than discovered by listing.
 */
export class ThingsBoardDataSource implements DataSource {
  readonly name = 'Factory feed';

  constructor(private cfg: { host: string; token: string }) {}

  async getActiveProfile(_p: Process, _deviceId?: string): Promise<ThermalProfile | null> {
    throw new Error('ThingsBoardDataSource is not implemented yet');
  }
  async getLastProfile(_p: Process, _deviceId?: string): Promise<ThermalProfile | null> {
    throw new Error('ThingsBoardDataSource is not implemented yet');
  }
  subscribe(
    _p: Process,
    _h: { onPoint: (pt: ThermalPoint) => void },
    _deviceId?: string,
  ): () => void {
    throw new Error('ThingsBoardDataSource is not implemented yet');
  }
}
