/**
 * Express server that simulates the DataSync Analytics API
 * Features:
 * - Rate limiting (100 requests/minute)
 * - Cursor-based pagination
 * - 3 million events served on-the-fly
 */

import express from 'express';
import cors from 'cors';
import type { Event, EventsResponse } from './types.js';

const TOTAL_EVENTS = 3_000_000;
const MAX_EVENTS_PER_PAGE = 10000;
const RATE_LIMIT = 100; // requests per minute
const RATE_WINDOW_MS = 60_000; // 1 minute

// Event type distribution
const EVENT_TYPES = [
  'user.signup',
  'user.login',
  'user.logout',
  'purchase.completed',
  'purchase.refunded',
  'page.view',
  'button.click',
  'form.submit',
  'api.call',
  'error.occurred',
];

// Rate limiting state
let requestCount = 0;
let windowStart = Date.now();

/**
 * Generate a single event deterministically
 */
function generateEvent(index: number): Event {
  const userId = `user_${Math.floor(index / 50)
    .toString()
    .padStart(6, '0')}`;
  const sessionId = `session_${Math.floor(index / 10)
    .toString()
    .padStart(7, '0')}`;

  const eventType = EVENT_TYPES[index % EVENT_TYPES.length];

  // Timestamp distributed over past 30 days
  const daysAgo = Math.floor((index / TOTAL_EVENTS) * 30);
  const timestamp = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000 - (index % 86400) * 1000
  );

  const data: Record<string, any> = {
    userId,
    sessionId,
    source: ['web', 'mobile', 'api'][index % 3],
    version: '1.0',
  };

  // Add event-specific fields
  if (eventType.startsWith('purchase')) {
    data.amount = Math.floor(Math.random() * 500) + 10;
    data.currency = 'USD';
    data.items = Math.floor(Math.random() * 5) + 1;
  } else if (eventType === 'page.view') {
    data.path = `/page/${index % 100}`;
    data.duration = Math.floor(Math.random() * 300);
  }

  return {
    id: `event_${index.toString().padStart(7, '0')}`,
    eventType,
    data,
    timestamp: timestamp.toISOString(),
  };
}

/**
 * Get paginated events based on cursor
 */
function getEventsPage(cursor: string | undefined, limit: number): EventsResponse {
  const startIndex = cursor ? parseInt(cursor.split('_')[1], 10) : 0;

  if (isNaN(startIndex) || startIndex < 0 || startIndex >= TOTAL_EVENTS) {
    return {
      data: [],
      hasMore: false,
      nextCursor: null,
    };
  }

  const actualLimit = Math.min(limit, MAX_EVENTS_PER_PAGE);
  const endIndex = Math.min(startIndex + actualLimit, TOTAL_EVENTS);

  const events: Event[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    events.push(generateEvent(i));
  }

  const nextIndex = startIndex + events.length;
  const hasMore = nextIndex < TOTAL_EVENTS;

  return {
    data: events,
    hasMore,
    nextCursor: hasMore ? `cursor_${nextIndex}` : null,
  };
}

/**
 * Rate limiting middleware
 */
function rateLimitMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const now = Date.now();

  // Reset window if needed
  if (now - windowStart >= RATE_WINDOW_MS) {
    requestCount = 0;
    windowStart = now;
  }

  requestCount++;

  // Set rate limit headers
  const remaining = Math.max(0, RATE_LIMIT - requestCount);
  const resetTime = windowStart + RATE_WINDOW_MS;

  res.set({
    'X-RateLimit-Limit': RATE_LIMIT.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': Math.floor(resetTime / 1000).toString(),
  });

  // Check if over limit
  if (requestCount > RATE_LIMIT) {
    const retryAfter = Math.ceil((resetTime - now) / 1000);
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests. Please retry after ${retryAfter} seconds.`,
      retryAfter,
    });
    return;
  }

  next();
}

/**
 * Create and configure Express app
 */
export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Apply rate limiting to API routes
  app.use('/api', rateLimitMiddleware);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', totalEvents: TOTAL_EVENTS });
  });

  // Main events endpoint
  app.get('/api/v1/events', (req, res) => {
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt((req.query.limit as string) || '100', 10);

    // Simulate some network latency (10-50ms)
    const latency = Math.floor(Math.random() * 40) + 10;

    setTimeout(() => {
      try {
        const response = getEventsPage(cursor, limit);
        res.json(response);
      } catch (error) {
        res.status(500).json({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, latency);
  });

  // Stats endpoint (not rate limited)
  app.get('/stats', (req, res) => {
    res.json({
      totalEvents: TOTAL_EVENTS,
      maxPageSize: MAX_EVENTS_PER_PAGE,
      rateLimit: {
        maxRequests: RATE_LIMIT,
        windowMs: RATE_WINDOW_MS,
        current: requestCount,
        remaining: Math.max(0, RATE_LIMIT - requestCount),
      },
    });
  });

  return app;
}
