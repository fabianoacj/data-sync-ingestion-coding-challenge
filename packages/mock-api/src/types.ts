/**
 * Event data structure matching the real API format
 */
export interface Event {
  id: string;
  eventType: string;
  data: Record<string, any>;
  timestamp: string;
}

/**
 * API response structure for paginated events
 */
export interface EventsResponse {
  data: Event[];
  hasMore: boolean;
  nextCursor: string | null;
}
