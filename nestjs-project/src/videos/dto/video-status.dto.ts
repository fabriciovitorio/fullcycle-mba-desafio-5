import { ApiProperty } from '@nestjs/swagger';
import type { VideoUploadStatus } from '../video-uploads.types';

export class VideoStatusDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, pattern: '^[a-f0-9]{24}$' })
  slug: string;

  @ApiProperty({ enum: ['draft', 'processing', 'ready', 'error'] })
  status: VideoUploadStatus['status'];

  @ApiProperty({ type: String, nullable: true, required: true })
  errorCode: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
