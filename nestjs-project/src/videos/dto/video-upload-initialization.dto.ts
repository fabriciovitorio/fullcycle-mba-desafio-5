import { ApiProperty } from '@nestjs/swagger';
import { VIDEO_LIMITS } from '../videos.constants';
import { VideoStatusDto } from './video-status.dto';

export class VideoUploadSessionDto {
  @ApiProperty({ type: Number, enum: [VIDEO_LIMITS.PART_SIZE_BYTES] })
  partSizeBytes: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 150 })
  partCount: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;
}

export class VideoUploadInitializationDto {
  @ApiProperty({ type: VideoStatusDto })
  video: VideoStatusDto;

  @ApiProperty({ type: VideoUploadSessionDto })
  upload: VideoUploadSessionDto;
}
