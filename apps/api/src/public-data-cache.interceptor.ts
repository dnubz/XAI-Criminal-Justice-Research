import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { map, Observable } from 'rxjs';
@Injectable()
export class PublicDataCacheInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const response = context.switchToHttp().getResponse<Response>();
        const request = context.switchToHttp().getRequest<Request>();
        return next.handle().pipe(map((body: unknown) => {
            if (request.path.endsWith('/health')) {
                response.setHeader('Cache-Control', 'no-store');
                return body;
            }
            const serialized = JSON.stringify(body);
            const etag = `"${createHash('sha256').update(serialized).digest('hex')}"`;
            response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
            response.setHeader('ETag', etag);
            if (request.headers['if-none-match'] === etag)
                response.status(304);
            return body;
        }));
    }
}
