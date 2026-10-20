import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoProcessingOutbox } from '../videos/entities/video-processing-outbox.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  assertTestDatabase,
  createTestAdminDataSource,
  testDatabaseOptions,
} from '../test/test-database';

import { TEST_ENTITIES as ALL_ENTITIES } from '../test/test-entities';
const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
  'video_processing_outbox',
];

describe('Database migrations (integration)', () => {
  // A separate public schema accommodates immutable migrations that qualify public.
  const database = `migrations_${randomUUID().replaceAll('-', '')}_test`;
  const sentinelId = randomUUID();
  let databaseCreated = false;
  let admin: DataSource;
  let dataSource: DataSource;
  let operational: DataSource;

  async function tableNames(source: DataSource): Promise<string[]> {
    const result = await source.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    return result.map((row) => row.table_name);
  }

  beforeAll(async () => {
    assertTestDatabase(database);
    admin = createTestAdminDataSource();
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    dataSource = createTestDataSource(ALL_ENTITIES, { database });
    await dataSource.initialize();
    operational = createTestDataSource(ALL_ENTITIES);
    await operational.initialize();
    await operational.getRepository(User).insert({
      id: sentinelId,
      email: `migration-${sentinelId}@example.com`,
      password: 'migration-test-sentinel',
    });
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.runMigrations();
  });

  afterAll(async () => {
    try {
      try {
        if (dataSource?.isInitialized) await dataSource.runMigrations();
      } finally {
        if (dataSource?.isInitialized) await dataSource.destroy();
      }
    } finally {
      try {
        if (operational?.isInitialized) {
          try {
            await operational.getRepository(User).delete(sentinelId);
          } finally {
            await operational.destroy();
          }
        }
      } finally {
        if (admin?.isInitialized) {
          try {
            if (databaseCreated)
              await admin.query(`DROP DATABASE "${database}"`);
          } finally {
            await admin.destroy();
          }
        }
      }
    }
  });

  it('should apply all migrations and create all six tables', async () => {
    const ranMigrations = await dataSource.runMigrations();
    expect(ranMigrations).toHaveLength(3);
    expect(await tableNames(dataSource)).toEqual([...MANAGED_TABLES].sort());
  });

  it('should revert only videos/outbox while preserving the earlier tables and migrations', async () => {
    await dataSource.undoLastMigration();
    expect(await tableNames(dataSource)).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
    ]);
    const migrations = await dataSource.query<{ name: string }[]>(
      'SELECT name FROM migrations ORDER BY timestamp',
    );
    expect(migrations.map((row) => row.name)).toEqual([
      'CreateUsersAndChannels1775687773260',
      'CreateAuthTokens1777579850478',
    ]);
    expect(await tableNames(operational)).toEqual([...MANAGED_TABLES].sort());
    expect(
      await operational.getRepository(User).existsBy({ id: sentinelId }),
    ).toBe(true);
  });

  it('should restore the isolated schema after a real SQL failure without changing operational data', async () => {
    await dataSource.undoLastMigration();
    const failedOperation = async (): Promise<void> => {
      try {
        await dataSource.query('SELECT * FROM "videos"');
      } finally {
        await dataSource.runMigrations();
      }
    };
    await expect(failedOperation()).rejects.toThrow('does not exist');
    expect(await dataSource.showMigrations()).toBe(false);
    expect(await tableNames(dataSource)).toEqual([...MANAGED_TABLES].sort());
    expect(await tableNames(operational)).toEqual([...MANAGED_TABLES].sort());
    expect(
      await operational.getRepository(User).existsBy({ id: sentinelId }),
    ).toBe(true);
  });

  it('should preserve existing users and channels across video rollback and reapplication', async () => {
    const user = await dataSource.getRepository(User).save({
      email: `preserved-${sentinelId}@example.com`,
      password: 'preserved-test-only',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Preserved channel',
      nickname: `preserved-${sentinelId}`,
      user_id: user.id,
    });
    await dataSource.undoLastMigration();
    expect(await dataSource.getRepository(User).existsBy({ id: user.id })).toBe(
      true,
    );
    expect(
      await dataSource.getRepository(Channel).existsBy({ id: channel.id }),
    ).toBe(true);
    const applied = await dataSource.runMigrations();
    expect(applied.map((migration) => migration.name)).toEqual([
      'CreateVideos1792367555018',
    ]);
    expect(await dataSource.getRepository(User).existsBy({ id: user.id })).toBe(
      true,
    );
    expect(
      await dataSource.getRepository(Channel).existsBy({ id: channel.id }),
    ).toBe(true);
  });

  it('should retain the earlier auth rollback and SQL failure recovery coverage', async () => {
    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();
    expect(await tableNames(dataSource)).toEqual(['channels', 'users']);
    const failedOperation = async (): Promise<void> => {
      try {
        await dataSource.query('SELECT * FROM "refresh_tokens"');
      } finally {
        await dataSource.runMigrations();
      }
    };
    await expect(failedOperation()).rejects.toThrow('does not exist');
    expect(await dataSource.showMigrations()).toBe(false);
    expect(await tableNames(dataSource)).toEqual([...MANAGED_TABLES].sort());
    expect(await tableNames(operational)).toEqual([...MANAGED_TABLES].sort());
    expect(
      await operational.getRepository(User).existsBy({ id: sentinelId }),
    ).toBe(true);
  });

  it('should have no schema drift between the generated migration and entity metadata', async () => {
    const diff = await dataSource.driver.createSchemaBuilder().log();
    expect(diff.upQueries).toEqual([]);
    expect(diff.downQueries).toEqual([]);
  });

  it.each([
    'streamtube',
    'postgres',
    'unsafe_test"; DROP DATABASE streamtube; --',
  ])(
    'should refuse cleanup and connection helpers for unsafe database %s',
    async (unsafeDatabase) => {
      const unsafeSource = new DataSource({
        ...testDatabaseOptions(),
        database: unsafeDatabase,
      });
      await expect(cleanAllTables(unsafeSource)).rejects.toThrow(
        'dedicated *_test',
      );
      expect(() =>
        createTestDataSource(ALL_ENTITIES, { database: unsafeDatabase }),
      ).toThrow('dedicated *_test');
      expect(
        await operational.getRepository(User).existsBy({ id: sentinelId }),
      ).toBe(true);
    },
  );

  it('should clean the dedicated test database in FK order', async () => {
    const user = await dataSource.getRepository(User).save({
      email: `cleanup-${sentinelId}@example.com`,
      password: 'cleanup-test-sentinel',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Cleanup test',
      nickname: `cleanup-${sentinelId}`,
      user_id: user.id,
    });
    const video = await dataSource.getRepository(Video).save({
      channel_id: channel.id,
      slug: 'a'.repeat(24),
      title: 'Cleanup video',
      original_file_name: 'video.mp4',
      declared_content_type: 'video/mp4',
      declared_size_bytes: '1000',
      source_key: `videos/${sentinelId}/source`,
      upload_expires_at: new Date(),
    });
    await dataSource.getRepository(VideoProcessingOutbox).save({
      video_id: video.id,
      event_type: 'video.upload.completed',
      schema_version: 1,
    });
    await cleanAllTables(dataSource);
    expect(await dataSource.getRepository(User).count()).toBe(0);
    expect(await dataSource.getRepository(Channel).count()).toBe(0);
    expect(await dataSource.getRepository(Video).count()).toBe(0);
    expect(await dataSource.getRepository(VideoProcessingOutbox).count()).toBe(
      0,
    );
    expect(
      await operational.getRepository(User).existsBy({ id: sentinelId }),
    ).toBe(true);
  });
});
