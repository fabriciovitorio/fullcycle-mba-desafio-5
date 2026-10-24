import { ApiProperty } from '@nestjs/swagger';
import { VideoStatusDto } from './video-status.dto';

export class VideoUploadCompletionDto {
  @ApiProperty({ type: VideoStatusDto })
  video: VideoStatusDto;
}
