import { PayloadTooLargeException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { HTTP_LIMITS } from './http.constants';

export function configureHttpBody(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: HTTP_LIMITS.CONTROL_JSON_BYTES });
  app.use(
    (
      error: unknown,
      _request: Request,
      _response: Response,
      next: NextFunction,
    ) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        next(new PayloadTooLargeException('JSON control body exceeds 64KiB'));
        return;
      }
      next(error);
    },
  );
}
