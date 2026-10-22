import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import { VideoUploadInitializationDto } from './dto/video-upload-initialization.dto';
import { VideoUploadsService } from './video-uploads.service';
import { VideoUploadResumeDto } from './dto/video-upload-resume.dto';
import { VIDEO_HTTP_RATE_LIMITS } from './videos.constants';

@ApiTags('videos')
@Controller('videos')
export class VideosUploadsController {
  constructor(private readonly uploads: VideoUploadsService) {}

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({
    default: {
      limit: VIDEO_HTTP_RATE_LIMITS.CREATE,
      ttl: VIDEO_HTTP_RATE_LIMITS.WINDOW_MS,
    },
  })
  @ApiBearerAuth('access-token')
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Initialize a video upload',
    description:
      'Creates a draft in the authenticated user channel and persists a direct multipart upload session. Accepts JSON control data only; video bytes are sent directly to storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft and upload session created',
    type: VideoUploadInitializationDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: invalid or unknown input fields',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'CHANNEL_NOT_FOUND: authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'UPLOAD_OPERATION_IN_PROGRESS: initialization ownership could not be confirmed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'JSON control body exceeds 64KiB',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Creation limit exceeded (10 requests per minute)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'STORAGE_UNAVAILABLE or VIDEO_ID_GENERATION_FAILED',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() input: CreateVideoUploadDto,
  ): Promise<VideoUploadInitializationDto> {
    return this.uploads.initialize(user.sub, input);
  }

  @Get(':id/upload')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: VIDEO_HTTP_RATE_LIMITS.CONTROL,
      ttl: VIDEO_HTTP_RATE_LIMITS.WINDOW_MS,
    },
  })
  @ApiBearerAuth('access-token')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Video owned by the authenticated user channel.',
  })
  @ApiOperation({
    summary: 'Resume a video upload',
    description:
      'Returns the owner draft and the parts currently present in storage. Preserves the video identity, multipart session and absolute expiry; does not create a session or processing intention.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current draft session and authoritative uploaded parts',
    type: VideoUploadResumeDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: id must be a UUID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: absent video or different owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'INVALID_VIDEO_STATE or UPLOAD_OPERATION_IN_PROGRESS',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 410,
    description:
      'UPLOAD_EXPIRED: expired session without a recoverable completed source',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Control limit exceeded (120 requests per minute)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description:
      'STORAGE_UNAVAILABLE: storage operation could not be confirmed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async resume(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VideoUploadResumeDto> {
    return this.uploads.resume(user.sub, id);
  }
}
