import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../test/create-test-data-source';
import { ChannelsModule } from './channels.module';

import { TEST_ENTITIES as ALL_ENTITIES } from '../test/test-entities';

describe('ChannelsModule', () => {
  it('should compile with TypeOrmModule.forFeature([Channel]) and ChannelsService', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        ChannelsModule,
      ],
    }).compile();

    try {
      expect(module).toBeDefined();
      const dataSource = module.get(DataSource);
      const [connection] = await dataSource.query<{ database: string }[]>(
        'SELECT current_database() AS database',
      );
      expect(connection.database).toBe(process.env.TEST_DB_NAME);
      expect(connection.database).not.toBe(process.env.TEST_PROTECTED_DB_NAME);
      expect(dataSource.options.synchronize).toBe(false);
      expect(await dataSource.showMigrations()).toBe(false);
    } finally {
      await module.close();
    }
  }, 30000);
});
