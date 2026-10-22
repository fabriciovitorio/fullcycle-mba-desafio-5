import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { assertTestDatabase } from '../test/test-database';
import { VideoUploadsService } from './video-uploads.service';
import { VideoUploadCompletionService } from './video-upload-completion.service';
import { VideosUploadsController } from './videos-uploads.controller';

describe('VideosModule (integration)', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });
  afterAll(async () => {
    await module?.close();
  });

  it('should resolve the real upload HTTP composition against the migrated test database', async () => {
    const source = module.get(DataSource);
    const rows = await source.query<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    assertTestDatabase(rows[0].current_database);
    expect(source.options.synchronize).toBe(false);
    expect(
      await source.query<{ table: string | null }[]>(
        "SELECT to_regclass('public.videos')::text AS table",
      ),
    ).toEqual([{ table: 'videos' }]);
    expect(module.get(VideosUploadsController)).toBeInstanceOf(
      VideosUploadsController,
    );
    expect(module.get(VideoUploadsService)).toBeInstanceOf(VideoUploadsService);
    expect(module.get(VideoUploadCompletionService)).toBeInstanceOf(
      VideoUploadCompletionService,
    );
    expect(module.get<StoragePort>(STORAGE)).toBeDefined();
  });
});
