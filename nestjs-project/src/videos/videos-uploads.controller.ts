import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { SignVideoUploadPartsDto } from './dto/sign-video-upload-parts.dto';
import { VideoUploadPermissionsDto } from './dto/video-upload-permissions.dto';
import { VideoUploadCompletionDto } from './dto/video-upload-completion.dto';
import { VideoUploadCompletionService } from './video-upload-completion.service';
import { VideoStatusDto } from './dto/video-status.dto';

@ApiTags('videos')
@Controller('videos')
export class VideosUploadsController {
  constructor(
    private readonly uploads: VideoUploadsService,
    private readonly completion: VideoUploadCompletionService,
  ) {}

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

  @Get(':id/status')
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
    summary: 'Get the owner video status',
    description:
      'Returns the private status in any video state, including draft, processing, ready and error. Only the owner can read it. Returns safe error codes without storage keys, upload IDs or processing diagnostics; does not depend on Redis.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current private video status',
    type: VideoStatusDto,
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
    status: 429,
    description: 'Control limit exceeded (120 requests per minute)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async status(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VideoStatusDto> {
    return this.completion.getStatus(user.sub, id);
  }

  @Post(':id/upload/parts')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: VIDEO_HTTP_RATE_LIMITS.CONTROL,
      ttl: VIDEO_HTTP_RATE_LIMITS.WINDOW_MS,
    },
  })
  @ApiBearerAuth('access-token')
  @ApiConsumes('application/json')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Video owned by the authenticated user channel.',
  })
  @ApiOperation({
    summary: 'Authorize video upload parts',
    description:
      'Issues temporary direct-to-storage PUT permissions for 1–50 unique part numbers within the owner draft session. Expected lengths are calculated by the server. URLs expire within 15 minutes and never after the session; send binary bytes directly to storage with the returned headers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Temporary upload permissions for the requested parts',
    type: VideoUploadPermissionsDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_ERROR: invalid UUID, duplicate/invalid/out-of-range parts or batch outside 1–50',
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
    status: 413,
    description: 'JSON control body exceeds 64KiB',
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
      'STORAGE_UNAVAILABLE: storage operation or signing could not be confirmed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SignVideoUploadPartsDto,
  ): Promise<VideoUploadPermissionsDto> {
    return this.uploads.signParts(user.sub, id, input.partNumbers);
  }

  @Delete(':id/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({
    default: {
      limit: VIDEO_HTTP_RATE_LIMITS.ABORT,
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
    summary: 'Abort a video upload',
    description:
      'Aborts the owner draft multipart session and retains the video with UPLOAD_ABORTED. Repeated abort returns the same empty 204. Accepts no request body; does not delete a video. Already completed source objects are reconciled instead of incorrectly confirming abort.',
  })
  @ApiResponse({
    status: 204,
    description: 'Upload aborted, or already aborted; no response body',
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: invalid UUID or request body supplied',
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
    status: 413,
    description: 'JSON control body exceeds 64KiB',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Abort limit exceeded (10 requests per minute)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description:
      'STORAGE_UNAVAILABLE: storage operation could not be confirmed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abort(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ): Promise<void> {
    if (
      request.body !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding']
    ) {
      throw new BadRequestException('Request body must be absent');
    }
    await this.completion.abort(user.sub, id);
  }

  @Post(':id/upload/completion')
  @HttpCode(HttpStatus.ACCEPTED)
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
    summary: 'Complete a video upload',
    description:
      'Confirms authoritative storage parts and atomically persists processing with one outbox intention. Accepts no request body or client sizes/ETags. Repeated processing returns 202; an already ready video returns 200 without repeating processing.',
  })
  @ApiResponse({
    status: 202,
    description:
      'Upload completed and processing accepted, or processing replay',
    type: VideoUploadCompletionDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Already ready; identity and published data preserved',
    type: VideoUploadCompletionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: invalid UUID or request body supplied',
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
    description:
      'UPLOAD_INCOMPLETE, UPLOAD_SIZE_MISMATCH, UPLOAD_OPERATION_IN_PROGRESS or INVALID_VIDEO_STATE',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 410,
    description:
      'UPLOAD_EXPIRED: expired session without a recoverable completed source',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'JSON control body exceeds 64KiB',
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
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<VideoUploadCompletionDto> {
    // HTTP framing checks also reject bodies skipped by JSON parsing (e.g. text).
    if (
      request.body !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding']
    ) {
      throw new BadRequestException('Request body must be absent');
    }
    const result = await this.completion.complete(user.sub, id);
    response.status(
      result.video.status === 'ready' ? HttpStatus.OK : HttpStatus.ACCEPTED,
    );
    return result;
  }
}
