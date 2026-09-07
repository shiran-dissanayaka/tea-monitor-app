import { ThingsBoardDataSource } from './thingsboardDataSource';
import { DataSource } from './types';

/** Live readings from ThingsBoard. There is no sample-data path. */
export const dataSource: DataSource = new ThingsBoardDataSource();

export { ThingsBoardDataSource };
export * from './types';
