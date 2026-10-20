import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Video } from './video.entity';

@Entity('video_processing_outbox')
@Index('IDX_video_processing_outbox_next_attempt_at', ['next_attempt_at'])
@Check(
  'CK_video_processing_outbox_event_type',
  `"event_type" = 'video.upload.completed'`,
)
@Check('CK_video_processing_outbox_schema_version', '"schema_version" = 1')
@Check(
  'CK_video_processing_outbox_dispatch_attempts',
  '"dispatch_attempts" >= 0',
)
export class VideoProcessingOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  video_id: string;

  @Column({ type: 'varchar', length: 64 })
  event_type: 'video.upload.completed';

  @Column({ type: 'integer' })
  schema_version: 1;

  @Column({ type: 'timestamptz', nullable: true })
  dispatched_at: Date | null;

  @Column({ type: 'integer', default: 0 })
  dispatch_attempts: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  next_attempt_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  locked_until: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lock_token: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  last_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToOne(() => Video, (video) => video.processingOutbox, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'video_id',
    foreignKeyConstraintName: 'FK_video_processing_outbox_video',
  })
  video: Relation<Video>;
}
