import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import databaseConfig from '../config/database.config';

export function assertTestDatabase(
  database: unknown,
): asserts database is string {
  if (
    typeof database !== 'string' ||
    !/^[a-z][a-z0-9_]*_test$/.test(database) ||
    database.length > 63 ||
    database === process.env.TEST_PROTECTED_DB_NAME
  ) {
    throw new Error(
      'Refusing database operation outside a dedicated *_test database',
    );
  }
}

export function testDatabaseOptions(): PostgresConnectionOptions {
  const database = process.env.TEST_DB_NAME;
  assertTestDatabase(database);
  const config = databaseConfig();
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'db',
    port: config.port,
    username: config.username,
    password: config.password,
    database,
    schema: 'public',
    synchronize: false,
  };
}

export function createTestAdminDataSource(): DataSource {
  return new DataSource({ ...testDatabaseOptions(), database: 'postgres' });
}

export async function ensureTestDatabase(
  admin: DataSource,
  database: string,
): Promise<void> {
  assertTestDatabase(database);
  const existing = await admin.query<{ datname: string }[]>(
    'SELECT datname FROM pg_database WHERE datname = $1',
    [database],
  );
  if (existing.length === 0) {
    await admin.query(`CREATE DATABASE "${database}"`);
  }
}
