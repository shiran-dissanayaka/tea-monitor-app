export type Process = 'withering' | 'fermentation';

/**
 * One reading.
 *
 * min/avg/max: the withering and fermentation nodes carry a single temperature
 * sensor, so all three are equal and the chart draws a plain line. The 32x24
 * grid lives on the separate Thermal_Camera device; if that is ever merged in,
 * min and max diverge and the shaded band reappears with no code change.
 */
export interface ThermalPoint {
  t: number; // epoch ms
  min: number;
  avg: number;
  max: number;
  /** Relative humidity, percent. */
  rh?: number;
  /** Withering fan running, derived from air flow being non-zero. */
  fan?: boolean;
  /** Air flow reading itself. */
  airflow?: number;
  /** Shed air temperature, °C, measured separately from the bed. */
  ambient?: number;
  /** Leaf moisture content, percent. */
  moisture?: number;
  /** Trough load cell total, kg. */
  weight?: number;
  /** Hardware's own run flag, when the node publishes one. */
  sessionActive?: boolean;
  /** Quadrant averages from the thermal camera, when present. */
  zones?: { fl: number; fr: number; bl: number; br: number };
}

export interface ThermalProfile {
  id: string;
  process: Process;
  deviceId: string;
  location: string;
  startedAt: number;
  endedAt: number | null;
  points: ThermalPoint[];
}

export type AlertKind = 'started' | 'ended' | 'out_of_band' | 'data_stopped' | 'data_resumed';

export interface ThermalAlert {
  id: string;
  kind: AlertKind;
  process: Process;
  deviceId: string;
  title: string;
  body: string;
  at: number;
}

/**
 * Nothing above this line knows where readings come from. Implementing this
 * interface is all it takes to add another source.
 */
export interface DataSource {
  readonly name: string;
  getActiveProfile(process: Process, deviceId?: string): Promise<ThermalProfile | null>;
  getLastProfile(process: Process, deviceId?: string): Promise<ThermalProfile | null>;
  subscribe(
    process: Process,
    handlers: {
      onPoint: (p: ThermalPoint) => void;
      onProfileStart?: (p: ThermalProfile) => void;
      onProfileEnd?: (p: ThermalProfile) => void;
      onError?: (message: string) => void;
    },
    deviceId?: string,
  ): () => void;
}

export const DEVICES: Record<Process, { deviceId: string; location: string }> = {
  withering: { deviceId: 'Withering_Node2', location: 'Withering trough' },
  fermentation: { deviceId: 'Fermentation_Node1', location: 'Fermentation bed' },
};

export const PROCESS_LABEL: Record<Process, string> = {
  withering: 'Withering',
  fermentation: 'Fermentation',
};

/** True when the readings carry a real pixel spread worth shading. */
export const hasBand = (points: ThermalPoint[]) => points.some((p) => p.max - p.min > 0.05);
