import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VIDEO_LIMITS } from '../videos.constants';
import { VideoProcessingOutbox } from './video-processing-outbox.entity';

export type VideoStatus = 'draft' | 'processing' | 'ready' | 'error';
export type VideoUploadOperation = 'initializing' | 'completing' | 'aborting';

export interface VideoMetadata {
  container: string;
  videoCodec: string;
  audioCodec: string | null;
  width: number;
  height: number;
  frameRate: number | null;
}

@Entity('videos')
@Unique('UQ_videos_slug', ['slug'])
@Unique('UQ_videos_source_key', ['source_key'])
@Index('IDX_videos_channel_created_at', ['channel_id', 'created_at'])
@Index('IDX_videos_status_upload_expires_at', ['status', 'upload_expires_at'])
@Index('IDX_videos_status_processing_lease_until', [
  'status',
  'processing_lease_until',
])
@Check('CK_videos_slug', `"slug" ~ '^[0-9a-f]{24}$'`)
@Check(
  'CK_videos_title',
  `"title" = btrim("title") AND char_length("title") BETWEEN 1 AND 200`,
)
@Check(
  'CK_videos_status',
  `"status" IN ('draft', 'processing', 'ready', 'error')`,
)
@Check(
  'CK_videos_declared_size',
  `"declared_size_bytes" BETWEEN 1 AND ${VIDEO_LIMITS.MAX_SIZE_BYTES}`,
)
@Check(
  'CK_videos_actual_size',
  `"actual_size_bytes" IS NULL OR "actual_size_bytes" = "declared_size_bytes"`,
)
@Check(
  'CK_videos_upload_operation',
  `"upload_operation" IS NULL OR "upload_operation" IN ('initializing', 'completing', 'aborting')`,
)
@Check('CK_videos_processing_attempts', '"processing_attempts" >= 0')
@Check(
  'CK_videos_duration',
  `"duration_seconds" IS NULL OR ("duration_seconds" > 0 AND "duration_seconds" < 'Infinity'::double precision)`,
)
@Check(
  'CK_videos_metadata',
  `"metadata" IS NULL OR (
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
)`,
)
@Check(
  'CK_videos_ready',
  `"status" <> 'ready' OR (
  "actual_size_bytes" IS NOT NULL AND "duration_seconds" IS NOT NULL
  AND "metadata" IS NOT NULL AND "playback_key" IS NOT NULL
  AND char_length("playback_key") > 0 AND "thumbnail_key" IS NOT NULL
  AND char_length("thumbnail_key") > 0
)`,
)
@Check(
  'CK_videos_error',
  `"status" <> 'error' OR ("error_code" IS NOT NULL AND char_length(btrim("error_code")) > 0)`,
)
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 24 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  original_file_name: string;

  @Column({ type: 'varchar', length: 100 })
  declared_content_type: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: VideoStatus;

  // PostgreSQL bigint is represented as a string; API conversion requires bounds checks.
  @Column({ type: 'bigint' })
  declared_size_bytes: string;

  @Column({ type: 'bigint', nullable: true })
  actual_size_bytes: string | null;

  @Column({ type: 'varchar', length: 512 })
  source_key: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  playback_key: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  upload_id: string | null;

  @Column({ type: 'timestamptz' })
  upload_expires_at: Date;

  @Column({ type: 'varchar', length: 16, nullable: true })
  upload_operation: VideoUploadOperation | null;

  @Column({ type: 'uuid', nullable: true })
  operation_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  operation_expires_at: Date | null;

  @Column({ type: 'double precision', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: VideoMetadata | null;

  @Column({ type: 'integer', default: 0 })
  processing_attempts: number;

  @Column({ type: 'uuid', nullable: true })
  processing_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processing_lease_until: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error_message: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'channel_id',
    foreignKeyConstraintName: 'FK_videos_channel',
  })
  channel: Relation<Channel>;

  @OneToOne(() => VideoProcessingOutbox, (outbox) => outbox.video)
  processingOutbox: Relation<VideoProcessingOutbox> | null;
}
