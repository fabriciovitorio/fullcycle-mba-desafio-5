import 'dotenv/config';
import databaseConfig from '../config/database.config';
import { TEST_ENTITIES } from './test-entities';
import { createTestDataSource } from './create-test-data-source';
import { createTestAdminDataSource, ensureTestDatabase } from './test-database';

export default async function setupTestDatabase(): Promise<void> {
  // Capture the application database before each Jest environment redirects DB_NAME.
  process.env.TEST_PROTECTED_DB_NAME ??= databaseConfig().name;
  process.env.TEST_DB_NAME ??= `${databaseConfig().name}_test`;
  const admin = createTestAdminDataSource();
  try {
    await admin.initialize();
    await ensureTestDatabase(admin, process.env.TEST_DB_NAME);
  } finally {
    if (admin.isInitialized) await admin.destroy();
  }

  const dataSource = createTestDataSource(TEST_ENTITIES, {
    migrationsRun: true,
  });
  try {
    await dataSource.initialize();
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
