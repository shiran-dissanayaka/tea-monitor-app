export type Process = 'withering' | 'fermentation';

/**
 * One reading. The three temperature fields come from the thermal camera; the
 * rest come from the other sensors on the bed. Everything beyond min/avg/max is
 * optional, so a device that does not report humidity simply omits it and the
 * screen leaves that row blank rather than showing a wrong number.
 */
export interface ThermalPoint {
  t: number; // epoch ms
  min: number;
  avg: number;
  max: number;
  /** Relative humidity, percent. */
  rh?: number;
  /** Withering fan running. */
  fan?: boolean;
  /** Shed air temperature, °C, as distinct from the bed. */
  ambient?: number;
  /** Leaf moisture content, percent. */
  moisture?: number;
  /** Still published by the camera, no longer shown on screen. */
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
    },
    deviceId?: string,
  ): () => void;
}

export const DEVICES: Record<Process, { deviceId: string; location: string }> = {
  withering: { deviceId: 'thm-w-01', location: 'Trough 3, upper deck' },
  fermentation: { deviceId: 'thm-f-01', location: 'Bed 1, ground floor' },
};

export const PROCESS_LABEL: Record<Process, string> = {
  withering: 'Withering',
  fermentation: 'Fermentation',
};
