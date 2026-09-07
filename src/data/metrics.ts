import { Process, ThermalPoint } from './types';

/**
 * Which rows each tab shows, in order. Adding the weight-scale reading to
 * withering later is one entry here plus one field on ThermalPoint — no screen
 * changes. `tone` picks the colour: 'value' for a plain number, 'state' for
 * something that is on or off.
 */
export interface MetricSpec {
  key: string;
  label: string;
  read: (pt: ThermalPoint) => string | null;
  tone?: 'value' | 'state';
  /** True when a 'state' row is in its active condition, for colouring. */
  active?: (pt: ThermalPoint) => boolean;
}

const num = (v: number | undefined, unit: string, dp = 1) =>
  v == null ? null : `${v.toFixed(dp)} ${unit}`;

export const METRICS: Record<Process, MetricSpec[]> = {
  withering: [
    { key: 'temp', label: 'Temperature', read: (p) => num(p.avg, '°C') },
    { key: 'rh', label: 'Humidity', read: (p) => num(p.rh, '%', 0) },
    {
      key: 'fan',
      label: 'Fan',
      tone: 'state',
      read: (p) => (p.fan == null ? null : p.fan ? 'ON' : 'OFF'),
      active: (p) => p.fan === true,
    },
  ],
  fermentation: [
    { key: 'temp', label: 'Temperature', read: (p) => num(p.avg, '°C') },
    { key: 'rh', label: 'Humidity', read: (p) => num(p.rh, '%', 0) },
    { key: 'ambient', label: 'Ambient temperature', read: (p) => num(p.ambient, '°C') },
    { key: 'moisture', label: 'Moisture', read: (p) => num(p.moisture, '%') },
  ],
};
