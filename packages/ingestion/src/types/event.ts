/**
 * Type definitions for events and API responses
 */

export interface Event {
  id: string;
  eventType: string;
  data: Record<string, any>;
  timestamp: string;
}

export interface APIResponse {
  data: Event[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface WorkerConfig {
  concurrency: number;
  pageSize: number;
  batchSize: number;
}

export interface DiscoveryResults {
  rateLimits: {
    maxRequests: number;
    windowMs: number;
  };
  optimalPageSize: number;
  maxConcurrency: number;
  recommendedStrategy: string;
}
