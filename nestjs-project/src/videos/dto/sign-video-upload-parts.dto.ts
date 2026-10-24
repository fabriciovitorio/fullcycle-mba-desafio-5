import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { VIDEO_LIMITS } from '../videos.constants';

export class SignVideoUploadPartsDto {
  /** Distinct part numbers (1–50 per request), each within this upload's part count. */
  @ApiProperty({
    type: 'array',
    items: { type: 'integer', minimum: 1 },
    maxItems: VIDEO_LIMITS.MAX_PARTS_PER_REQUEST,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VIDEO_LIMITS.MAX_PARTS_PER_REQUEST)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
