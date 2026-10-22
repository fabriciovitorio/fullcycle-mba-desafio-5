import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { AppModule } from '../../src/app.module';
import { ChannelsService } from '../../src/channels/channels.service';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { configureHttpBody } from '../../src/common/configure-http-body';
import { User } from '../../src/users/entities/user.entity';
import { Video } from '../../src/videos/entities/video.entity';
import { cleanAllTables } from '../../src/test/create-test-data-source';
import { createStorageFixture } from '../../src/test/storage.fixture';

export async function createVideosHttpFixture() {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  configureHttpBody(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  const source = module.get(DataSource);
  const storage = await createStorageFixture();
  const throttler = module.get<ThrottlerStorageService>(ThrottlerStorage);

  async function owner(withChannel = true) {
    const user = await source.getRepository(User).save({
      email: `http-video-${randomUUID()}@example.com`,
      password: 'fixture-only; login is not used',
      is_confirmed: true,
    });
    const channel = withChannel
      ? await module.get(ChannelsService).createChannel(user.id, user.email)
      : null;
    const token = await module
      .get(JwtService)
      .signAsync({ sub: user.id, email: user.email });
    return { user, channel, token };
  }

  async function clean(): Promise<void> {
    // Serial suite owns rows and associated keys in the isolated test resources.
    for (const video of await source.getRepository(Video).find()) {
      const uploads = await storage.client.send(
        new ListMultipartUploadsCommand({
          Bucket: storage.config.bucket,
          Prefix: video.source_key,
        }),
      );
      if (uploads.IsTruncated)
        throw new Error('Unexpected fixture multipart pagination');
      for (const upload of uploads.Uploads ?? []) {
        if (upload.Key === video.source_key)
          await storage.client.send(
            new AbortMultipartUploadCommand({
              Bucket: storage.config.bucket,
              Key: video.source_key,
              UploadId: upload.UploadId,
            }),
          );
      }
      await storage.client.send(
        new DeleteObjectCommand({
          Bucket: storage.config.bucket,
          Key: video.source_key,
        }),
      );
    }
    await cleanAllTables(source);
    throttler.storage.clear();
  }

  async function close(): Promise<void> {
    try {
      await storage.cleanup();
    } finally {
      await app.close();
    }
  }

  return { app, module, source, storage, throttler, owner, clean, close };
}

export type VideosHttpFixture = Awaited<
  ReturnType<typeof createVideosHttpFixture>
>;
