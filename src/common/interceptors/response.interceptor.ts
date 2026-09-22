import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<unknown> {
    // /metrics must stay plain Prometheus text, not the {success,data} JSON envelope.
    const req = context.switchToHttp().getRequest<Request>();
    if (req.path === '/metrics') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
      })),
    );
  }
}
