import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1792367555018 implements MigrationInterface {
  name = 'CreateVideos1792367555018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "slug" character varying(24) NOT NULL, "title" character varying(200) NOT NULL, "original_file_name" character varying(255) NOT NULL, "declared_content_type" character varying(100) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'draft', "declared_size_bytes" bigint NOT NULL, "actual_size_bytes" bigint, "source_key" character varying(512) NOT NULL, "playback_key" character varying(512), "thumbnail_key" character varying(512), "upload_id" text, "upload_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "upload_operation" character varying(16), "operation_token" uuid, "operation_expires_at" TIMESTAMP WITH TIME ZONE, "duration_seconds" double precision, "metadata" jsonb, "processing_attempts" integer NOT NULL DEFAULT '0', "processing_token" uuid, "processing_lease_until" TIMESTAMP WITH TIME ZONE, "error_code" character varying(64), "error_message" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_videos_source_key" UNIQUE ("source_key"), CONSTRAINT "UQ_videos_slug" UNIQUE ("slug"), CONSTRAINT "CK_videos_error" CHECK ("status" <> 'error' OR ("error_code" IS NOT NULL AND char_length(btrim("error_code")) > 0)), CONSTRAINT "CK_videos_ready" CHECK ("status" <> 'ready' OR (
  "actual_size_bytes" IS NOT NULL AND "duration_seconds" IS NOT NULL
  AND "metadata" IS NOT NULL AND "playback_key" IS NOT NULL
  AND char_length("playback_key") > 0 AND "thumbnail_key" IS NOT NULL
  AND char_length("thumbnail_key") > 0
)), CONSTRAINT "CK_videos_metadata" CHECK ("metadata" IS NULL OR (
  jsonb_typeof("metadata") = 'object'
  AND "metadata" ?& ARRAY['container', 'videoCodec', 'audioCodec', 'width', 'height', 'frameRate']
  AND "metadata" - ARRAY['container', 'videoCodec', 'audioCodec', 'width', 'height', 'frameRate'] = '{}'::jsonb
  AND jsonb_typeof("metadata"->'container') = 'string'
  AND jsonb_typeof("metadata"->'videoCodec') = 'string'
  AND jsonb_typeof("metadata"->'audioCodec') IN ('string', 'null')
  AND CASE WHEN jsonb_typeof("metadata"->'width') = 'number'
    THEN ("metadata"->>'width')::numeric > 0 AND ("metadata"->>'width')::numeric = trunc(("metadata"->>'width')::numeric) ELSE false END
  AND CASE WHEN jsonb_typeof("metadata"->'height') = 'number'
    THEN ("metadata"->>'height')::numeric > 0 AND ("metadata"->>'height')::numeric = trunc(("metadata"->>'height')::numeric) ELSE false END
  AND CASE WHEN jsonb_typeof("metadata"->'frameRate') = 'number'
    THEN ("metadata"->>'frameRate')::numeric > 0 AND ("metadata"->>'frameRate')::numeric <= 1.7976931348623157e308::numeric
    ELSE jsonb_typeof("metadata"->'frameRate') = 'null' END
)), CONSTRAINT "CK_videos_duration" CHECK ("duration_seconds" IS NULL OR ("duration_seconds" > 0 AND "duration_seconds" < 'Infinity'::double precision)), CONSTRAINT "CK_videos_processing_attempts" CHECK ("processing_attempts" >= 0), CONSTRAINT "CK_videos_upload_operation" CHECK ("upload_operation" IS NULL OR "upload_operation" IN ('initializing', 'completing', 'aborting')), CONSTRAINT "CK_videos_actual_size" CHECK ("actual_size_bytes" IS NULL OR "actual_size_bytes" = "declared_size_bytes"), CONSTRAINT "CK_videos_declared_size" CHECK ("declared_size_bytes" BETWEEN 1 AND 10000000000), CONSTRAINT "CK_videos_status" CHECK ("status" IN ('draft', 'processing', 'ready', 'error')), CONSTRAINT "CK_videos_title" CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 200), CONSTRAINT "CK_videos_slug" CHECK ("slug" ~ '^[0-9a-f]{24}$'), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_processing_lease_until" ON "videos" ("status", "processing_lease_until") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_upload_expires_at" ON "videos" ("status", "upload_expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_created_at" ON "videos" ("channel_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "video_processing_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "video_id" uuid NOT NULL, "event_type" character varying(64) NOT NULL, "schema_version" integer NOT NULL, "dispatched_at" TIMESTAMP WITH TIME ZONE, "dispatch_attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "locked_until" TIMESTAMP WITH TIME ZONE, "lock_token" uuid, "last_error" character varying(255), "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_b5164922ea5553e56eeb637863" UNIQUE ("video_id"), CONSTRAINT "CK_video_processing_outbox_dispatch_attempts" CHECK ("dispatch_attempts" >= 0), CONSTRAINT "CK_video_processing_outbox_schema_version" CHECK ("schema_version" = 1), CONSTRAINT "CK_video_processing_outbox_event_type" CHECK ("event_type" = 'video.upload.completed'), CONSTRAINT "PK_39dcfd3c9dbeb68310241a09b72" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_processing_outbox_next_attempt_at" ON "video_processing_outbox" ("next_attempt_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_processing_outbox" ADD CONSTRAINT "FK_video_processing_outbox_video" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_processing_outbox" DROP CONSTRAINT "FK_video_processing_outbox_video"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_video_processing_outbox_next_attempt_at"`,
    );
    await queryRunner.query(`DROP TABLE "video_processing_outbox"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_channel_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_status_upload_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_status_processing_lease_until"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
