/**
 * Type definitions for events and API responses
 */

// ============================================================================
// Event Types
// ============================================================================

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

// ============================================================================
// Database Types
// ============================================================================

export interface IngestedEvent {
  id: string;
  event_type: string;
  event_data: Record<string, any>;
  timestamp: Date;
  created_at?: Date;
}

export interface CursorRecord {
  cursor_id?: number;
  cursor_value: string;
  worker_id?: number;
  events_fetched?: number;
  started_at?: Date;
  completed_at?: Date | null;
  is_completed?: boolean;
  error_count?: number;
  last_error?: string | null;
}

export interface MetadataRecord {
  key: string;
  value: string;
  updated_at?: Date;
}

export interface IngestionStats {
  total_events: number;
  progress_percent: number;
  total_cursors: number;
  completed_cursors: number;
  in_progress_cursors: number;
  failed_cursors: number;
  elapsed_time: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface WorkerConfig {
  concurrency: number;
  pageSize: number;
  batchSize: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface APIConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
}

export interface AppConfig {
  database: DatabaseConfig;
  api: APIConfig;
  worker: WorkerConfig;
  logInterval?: number;
}

// ============================================================================
// Discovery Types
// ============================================================================

export interface RateLimitInfo {
  maxRequests: number;
  windowMs: number;
  remaining?: number;
  resetAt?: number;
}

export interface DiscoveryResults {
  rateLimits: RateLimitInfo;
  optimalPageSize: number;
  maxConcurrency: number;
  recommendedStrategy: string;
  estimatedTime?: number;
}

// ============================================================================
// Progress Tracking Types
// ============================================================================

export interface ProgressSnapshot {
  eventsIngested: number;
  progressPercent: number;
  activeCursors: number;
  completedCursors: number;
  rate: number; // events per second
  eta: string; // estimated time to completion
  elapsedTime: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class IngestionError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

export class RateLimitError extends IngestionError {
  constructor(
    message: string,
    public retryAfter: number
  ) {
    super(message, 'RATE_LIMIT', 429, true);
    this.name = 'RateLimitError';
  }
}

export class DatabaseError extends IngestionError {
  constructor(message: string, public originalError?: Error) {
    super(message, 'DATABASE_ERROR', undefined, false);
    this.name = 'DatabaseError';
  }
}
