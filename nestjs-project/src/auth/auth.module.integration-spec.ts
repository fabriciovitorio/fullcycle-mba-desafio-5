import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { AuthModule } from './auth.module';

import { TEST_ENTITIES as ALL_ENTITIES } from '../test/test-entities';

describe('AuthModule', () => {
  it('should compile successfully with JwtModule, TypeOrmModule, UsersModule, and MailModule', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, authConfig, mailConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        AuthModule,
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
