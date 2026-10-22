import { ApiProperty } from '@nestjs/swagger';
import { VIDEO_LIMITS } from '../videos.constants';
import { VideoStatusDto } from './video-status.dto';
import { VideoUploadSessionDto } from './video-upload-initialization.dto';

export class VideoUploadPartDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 150 })
  partNumber: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: VIDEO_LIMITS.PART_SIZE_BYTES,
  })
  sizeBytes: number;

  @ApiProperty({
    type: String,
    description: 'ETag observed by storage, including quotes.',
  })
  etag: string;
}

export class VideoUploadResumeSessionDto extends VideoUploadSessionDto {
  @ApiProperty({ type: [VideoUploadPartDto] })
  parts: VideoUploadPartDto[];
}

export class VideoUploadResumeDto {
  @ApiProperty({ type: VideoStatusDto })
  video: VideoStatusDto;

  @ApiProperty({ type: VideoUploadResumeSessionDto })
  upload: VideoUploadResumeSessionDto;
}
