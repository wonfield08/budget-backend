import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  private readonly httpRequestDuration: client.Histogram<string>;
  private readonly httpRequestsTotal: client.Counter<string>;

  constructor() {
    client.collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
  }

  observeHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestDuration.observe(labels, durationSeconds);
    this.httpRequestsTotal.inc(labels);
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
