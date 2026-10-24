import { randomUUID } from 'node:crypto';
import { createConnection, createServer, type Socket } from 'node:net';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import queueConfig from '../config/queue.config';
import { VIDEO_QUEUE } from '../videos/videos.constants';
import { VideoQueueModule } from '../videos/queue/video-queue.module';
import { VideoOutboxDispatcherModule } from '../videos/queue/video-outbox-dispatcher.module';
import type { VideoProcessingJob } from '../videos/queue/video-queue.constants';
import { VideosRepository } from '../videos/videos.repository';
import { createTestDataSource } from './create-test-data-source';
import { TEST_ENTITIES } from './test-entities';
import { createVideoFixture } from './video-persistence.fixture';

// Real TCP fault boundary: Redis itself stays isolated/running; no SDK mocks.
export async function createRedisGate(initiallyOpen = true) {
  const config = queueConfig();
  const sockets = new Set<Socket>();
  let open = initiallyOpen;
  const server = createServer((incoming) => {
    if (!open) {
      incoming.destroy();
      return;
    }
    const outgoing = createConnection({
      host: config.connection.host,
      port: config.connection.port,
    });
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.on('error', () => socket.destroy());
      socket.on('close', () => {
        sockets.delete(socket);
        incoming.destroy();
        outgoing.destroy();
      });
    }
    incoming.pipe(outgoing).pipe(incoming);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP port');
  return {
    host: 'nestjs-api',
    port: address.port,
    block() {
      open = false;
      for (const socket of sockets) socket.destroy();
    },
    restore() {
      open = true;
    },
    async close() {
      open = false;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function createVideoQueueFixture(
  options: {
    dispatcher?: boolean;
    gate?: Awaited<ReturnType<typeof createRedisGate>>;
  } = {},
) {
  const config = queueConfig();
  if (!config.prefix.includes('test'))
    throw new Error('Expected isolated test queue prefix');
  config.prefix = `${config.prefix}-${randomUUID()}`;
  if (options.gate)
    config.connection = {
      ...config.connection,
      host: options.gate.host,
      port: options.gate.port,
    };
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [queueConfig],
      }),
      ...(options.dispatcher
        ? [
            TypeOrmModule.forRoot(createTestDataSource(TEST_ENTITIES).options),
            VideoOutboxDispatcherModule,
          ]
        : [VideoQueueModule]),
    ],
  })
    .overrideProvider(queueConfig.KEY)
    .useValue(config)
    .compile();
  // compile only: integration tests drive dispatch explicitly, no timer races.
  const queue = module.get<Queue<VideoProcessingJob>>(
    getQueueToken(VIDEO_QUEUE.NAME),
  );
  return {
    module,
    queue,
    config,
    async close() {
      try {
        await queue.obliterate({ force: true });
      } finally {
        await module.close();
      }
    },
  };
}

export async function createDispatchVideo(
  module: Awaited<ReturnType<typeof createVideoQueueFixture>>['module'],
) {
  const source = module.get(DataSource);
  const row = await createVideoFixture(source);
  const videos = module.get(VideosRepository);
  const claim = await videos.claimUpload(
    row.id,
    row.channel_id,
    'completing',
    60_000,
  );
  if (
    !claim ||
    !(await videos.completeUpload(
      row.id,
      row.channel_id,
      claim.token,
      row.declared_size_bytes,
    ))
  )
    throw new Error('Expected completed upload with transactional outbox');
  return row;
}

export async function waitForQueue(
  queue: Queue<VideoProcessingJob>,
): Promise<void> {
  // Real readiness bounded by test timeout; production uses its own bounded gate.
  await queue.waitUntilReady();
  const client = await queue.client;
  if (client.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off('ready', ready);
        reject(new Error('Redis did not reconnect'));
      }, 10_000);
      function ready() {
        clearTimeout(timer);
        resolve();
      }
      client.once('ready', ready);
    });
  }
}
