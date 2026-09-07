import { MockDataSource } from './mockDataSource';
import { ThingsBoardDataSource } from './thingsboardDataSource';
import { DataSource } from './types';

/** The one switch. Set true once src/data/credentials.ts is filled in. */
const USE_LIVE_DATA = true;

export const dataSource: DataSource = USE_LIVE_DATA
  ? new ThingsBoardDataSource()
  : new MockDataSource();

export const isMock = !USE_LIVE_DATA;
export { MockDataSource, ThingsBoardDataSource };
export * from './types';
