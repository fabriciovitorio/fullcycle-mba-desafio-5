import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  NotContains,
} from 'class-validator';
import { VIDEO_LIMITS } from '../videos.constants';

export class CreateVideoUploadDto {
  /** Video title, trimmed before validation (1–200 characters). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  title: string;

  /** Original file name; no NUL, slash, backslash, CR or LF (1–255 characters). */
  @IsString()
  @Length(1, 255)
  @Matches(/^[^/\\\r\n]+$/)
  @NotContains('\u0000')
  fileName: string;

  /** Declared MIME type. Actual video content is validated during processing. */
  @IsString()
  @IsIn(['video/mp4'])
  contentType: 'video/mp4';

  /** Declared file size in bytes; maximum 10GB (decimal). */
  @ApiProperty({ type: 'integer' })
  @IsInt()
  @Min(1)
  @Max(VIDEO_LIMITS.MAX_SIZE_BYTES)
  sizeBytes: number;
}
