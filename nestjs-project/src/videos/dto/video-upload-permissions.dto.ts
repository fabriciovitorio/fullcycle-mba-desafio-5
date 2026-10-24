import { ApiProperty } from '@nestjs/swagger';

export class VideoUploadPartHeadersDto {
  @ApiProperty({
    type: String,
    pattern: '^[1-9][0-9]*$',
    description: 'Exact byte length required by the signed PUT.',
  })
  'Content-Length': string;
}

export class VideoUploadPartPermissionDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 150 })
  partNumber: number;

  @ApiProperty({
    type: String,
    format: 'uri',
    description:
      'Temporary PUT permission at the configured storage origin. Use unchanged.',
  })
  url: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Expires within 900 seconds and no later than the upload session.',
  })
  expiresAt: Date;

  @ApiProperty({ type: VideoUploadPartHeadersDto })
  headers: VideoUploadPartHeadersDto;
}

export class VideoUploadPermissionsDto {
  @ApiProperty({
    type: [VideoUploadPartPermissionDto],
    minItems: 1,
    maxItems: 50,
  })
  parts: VideoUploadPartPermissionDto[];
}
