import { assertTestDatabase } from './test-database';
import { TEST_STORAGE_ENV } from './video-environment.fixture';

const database = process.env.TEST_DB_NAME;
assertTestDatabase(database);
// Runs before AppModule imports in both Jest configurations. dotenv never overrides it.
process.env.DB_NAME = database;
process.env.DB_HOST ??= 'db';
for (const [key, value] of Object.entries(TEST_STORAGE_ENV)) {
  process.env[key] ??= value;
}
process.env.VIDEO_QUEUE_PREFIX ??= 'streamtube-test';
