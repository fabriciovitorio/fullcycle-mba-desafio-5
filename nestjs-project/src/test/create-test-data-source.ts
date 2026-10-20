import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1792367555018 } from '../database/migrations/1792367555018-CreateVideos';
import { assertTestDatabase, testDatabaseOptions } from './test-database';

interface TestDataSourceOptions {
  database?: string;
  migrationsRun?: boolean;
}

export function createTestDataSource(
  entities: NonNullable<PostgresConnectionOptions['entities']>,
  options: TestDataSourceOptions = {},
): DataSource {
  const connection = testDatabaseOptions();
  const database = options.database ?? connection.database;
  assertTestDatabase(database);
  return new DataSource({
    ...connection,
    database,
    entities,
    synchronize: false,
    migrations: [
      CreateUsersAndChannels1775687773260,
      CreateAuthTokens1777579850478,
      CreateVideos1792367555018,
    ],
    migrationsRun: options.migrationsRun ?? false,
  });
}

export async function cleanAllTables(dataSource: DataSource): Promise<void> {
  assertTestDatabase(dataSource.options.database);
  await dataSource.query('DELETE FROM "video_processing_outbox"');
  await dataSource.query('DELETE FROM "videos"');
  await dataSource.query('DELETE FROM "refresh_tokens"');
  await dataSource.query('DELETE FROM "verification_tokens"');
  await dataSource.query('DELETE FROM "channels"');
  await dataSource.query('DELETE FROM "users"');
}
