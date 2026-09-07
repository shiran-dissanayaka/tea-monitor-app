import { CREDENTIALS } from './credentials';
import { Process } from './types';

/** ThingsBoard connection. Key names and UUIDs confirmed against the live server. */
export const TB = {
  host: 'https://thingsboard.smartteanexus.org',
  wsHost: 'wss://thingsboard.smartteanexus.org',

  get username() {
    return CREDENTIALS.username;
  },
  get password() {
    return CREDENTIALS.password;
  },

  deviceIds: {
    withering: '033589a0-2760-11f1-a25a-23a32b4b6a2c',    // Withering_Node2
    fermentation: 'ee2e8a40-3261-11f1-a25a-23a32b4b6a2c', // Fermentation_Node1
  } as Record<Process, string>,

  keys: {
    withering: {
      temp: 'WTH_Temperature',
      rh: 'WTH_Humidity',
      airflow: 'WTH_AirFlow',
      weight: 'WTH_LoadCell_Total',
      session: 'WTH_SessionActive',
    },
    fermentation: {
      temp: 'FRM_Temperature',
      rh: 'FRM_Humidity',
      ambient: 'FRM_TempAmbient',
      moisture: 'FRM_Moisture',
    },
  } as Record<Process, Record<string, string>>,

  /** How far back to search for completed runs. */
  historyHours: 48,

  /**
   * Slicing history into runs. Withering uses its session flag; fermentation
   * has none, so a run is a stretch where the bed sits this far above ambient.
   * Keep in step with fermentStartGap in Settings.
   */
  fermentRunGap: 1.5,
  /** Ignore blips shorter than this when slicing. */
  minRunMinutes: 10,
};
