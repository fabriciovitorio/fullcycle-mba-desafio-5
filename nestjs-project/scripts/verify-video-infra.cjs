// Infrastructure probe, run only inside the isolated test Compose project.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Queue } = require('bullmq');
const { Client } = require('pg');

async function main() {
  const mode = process.argv[2];
  assert(
    ['seed', 'verify', 'cleanup'].includes(mode),
    'Expected seed, verify or cleanup',
  );
  assert.equal(process.env.DB_NAME, 'streamtube_test');
  assert.equal(process.env.STORAGE_BUCKET, 'streamtube-test-videos');
  assert.equal(process.env.VIDEO_QUEUE_PREFIX, 'streamtube-test');
  assert.equal(process.env.STORAGE_ENDPOINT, 'http://minio:9000');
  assert.equal(process.env.REDIS_HOST, 'redis');
  const bucket = process.env.STORAGE_BUCKET;
  const key = 'infra-check/persistence.txt';
  const content = 'SI-03.2.2 persistent private object';
  const jobId = 'infra-check-persistence';
  const origin = process.env.STORAGE_CORS_ORIGIN;
  assert(origin && origin !== '*', 'An explicit CORS origin is required');
  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY,
      secretAccessKey: process.env.STORAGE_SECRET_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const queue = new Queue('video-processing', {
    prefix: process.env.VIDEO_QUEUE_PREFIX,
    connection: {
      host: 'redis',
      port: 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    },
  });
  const db = new Client({
    host: 'db',
    port: 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  });
  try {
    await db.connect();
    const database = await db.query('SELECT current_database() AS name');
    assert.equal(database.rows[0].name, 'streamtube_test');
    assert.equal((await fetch('http://mailpit:8025/api/v1/info')).status, 200);
    assert.equal(
      (await fetch('http://minio:9000/minio/health/ready')).status,
      200,
    );
    const redis = await queue.client;
    assert.equal(await redis.ping(), 'PONG');
    assert.deepEqual(await redis.config('GET', 'appendonly'), [
      'appendonly',
      'yes',
    ]);
    assert.deepEqual(await redis.config('GET', 'maxmemory-policy'), [
      'maxmemory-policy',
      'noeviction',
    ]);
    assert.notEqual(process.getuid(), 0);
    for (const binary of ['ffmpeg', 'ffprobe']) {
      assert(
        execFileSync(binary, ['-version'], { encoding: 'utf8' }).startsWith(
          binary + ' version',
        ),
      );
    }
    if (mode === 'cleanup') {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      const job = await queue.getJob(jobId);
      if (job) await job.remove();
      console.log(JSON.stringify({ mode, cleanup: 'passed' }));
      return;
    }
    if (mode === 'seed') {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: content }),
      );
      await queue.add('infra-probe', { proof: content }, { jobId });
    }
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    assert.equal(await object.Body.transformToString(), content);
    const unsigned = await fetch(`http://minio:9000/${bucket}/${key}`);
    assert.equal(
      unsigned.status,
      403,
      'Known private object must reject unsigned GET',
    );
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const signed = await getSignedUrl(s3, command, { expiresIn: 60 });
    const response = await fetch(signed, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), content);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const exposed = response.headers
      .get('access-control-expose-headers')
      .toLowerCase();
    for (const header of [
      'etag',
      'content-range',
      'accept-ranges',
      'content-length',
    ])
      assert(exposed.includes(header));
    for (const method of ['GET', 'HEAD', 'PUT']) {
      const preflight = await fetch(`http://minio:9000/${bucket}/${key}`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'content-type,x-amz-checksum-crc32',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get('access-control-allow-origin'),
        origin,
      );
      assert(
        preflight.headers.get('access-control-allow-methods').includes(method),
      );
      assert(
        preflight.headers
          .get('access-control-allow-headers')
          .toLowerCase()
          .includes('x-amz-checksum-crc32'),
      );
    }
    const denied = await fetch(signed, {
      headers: { Origin: 'http://not-allowed.invalid' },
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    await denied.arrayBuffer();
    const job = await queue.getJob(jobId);
    assert(job, 'Real BullMQ job must survive restart');
    assert.deepEqual(job.data, { proof: content });
    assert.equal(await job.getState(), 'waiting');
    console.log(
      JSON.stringify({
        mode,
        database: database.rows[0].name,
        mailpit: 'ready',
        minio: 'ready',
        redis: 'PONG',
        appendonly: true,
        evictionPolicy: 'noeviction',
        objectIntact: true,
        unsignedGet: 403,
        cors: 'passed',
        bullmqJobState: 'waiting',
        nonRoot: true,
        ffmpeg: 'available',
        ffprobe: 'available',
      }),
    );
  } finally {
    await db.end();
    await queue.close();
    s3.destroy();
  }
}
main().catch((error) => {
  // Never dump SDK request objects or signed URLs.
  console.error(error.name + ': ' + error.message);
  process.exitCode = 1;
});
