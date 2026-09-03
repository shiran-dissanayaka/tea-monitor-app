import { MockDataSource } from './mockDataSource';
import { DataSource } from './types';

/** The one switch. Everything else in the app is source-agnostic. */
export const dataSource: DataSource = new MockDataSource();
export const isMock = dataSource instanceof MockDataSource;
export { MockDataSource };
export * from './types';
