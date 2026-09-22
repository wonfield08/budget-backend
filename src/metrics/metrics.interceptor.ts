import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    // Use the matched route pattern (e.g. "/transactions/:id"), not the raw URL,
    // to keep the metric's cardinality bounded regardless of how many ids exist.
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path ?? 'unknown';
    const method = req.method;
    const start = process.hrtime.bigint();

    const record = (statusCode: number) => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observeHttpRequest(method, route, statusCode, durationSeconds);
    };

    return next.handle().pipe(
      tap({
        next: () => record(context.switchToHttp().getResponse<Response>().statusCode),
        error: (err: { status?: number }) => record(err?.status ?? 500),
      }),
    );
  }
}
