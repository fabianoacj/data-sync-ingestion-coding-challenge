/**
 * API Client Service
 * Handles HTTP requests to the DataSync Analytics API
 * Features:
 * - Rate limit tracking and handling
 * - Automatic retries with exponential backoff
 * - Cursor-based pagination
 * - Error handling and logging
 */

import axios, { AxiosInstance, AxiosError, AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import type { Event, APIResponse, APIConfig } from '../types/event.js';
import { RateLimitError, APIError } from '../types/event.js';

/**
 * Rate limit state tracker
 */
interface RateLimitState {
  remaining: number;
  limit: number;
  resetTime: number; // Unix timestamp
  lastChecked: number; // Unix timestamp
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
}

/**
 * API Client for DataSync Analytics
 */
export class APIClient {
  private client: AxiosInstance;
  private config: APIConfig;
  private rateLimitState: RateLimitState;
  private retryConfig: RetryConfig;

  constructor(config: APIConfig) {
    this.config = config;
    
    // Create axios instance with default configuration
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
      },
    });

    // Initialize rate limit state
    this.rateLimitState = {
      remaining: 100, // Default, will be updated from headers
      limit: 100,
      resetTime: Date.now() + 60000,
      lastChecked: Date.now(),
    };

    // Configure retry behavior
    this.retryConfig = {
      maxRetries: config.retries || 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
    };

    // Add response interceptor to track rate limits
    this.client.interceptors.response.use(
      (response) => {
        this.updateRateLimitState(response.headers);
        return response;
      },
      (error) => {
        if (error.response) {
          this.updateRateLimitState(error.response.headers);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Update rate limit state from response headers
   */
  private updateRateLimitState(headers: AxiosResponseHeaders | RawAxiosResponseHeaders): void {
    const remaining = headers['x-ratelimit-remaining'];
    const limit = headers['x-ratelimit-limit'];
    const reset = headers['x-ratelimit-reset'];

    if (remaining !== undefined && typeof remaining === 'string') {
      this.rateLimitState.remaining = parseInt(remaining, 10);
    }
    if (limit !== undefined && typeof limit === 'string') {
      this.rateLimitState.limit = parseInt(limit, 10);
    }
    if (reset !== undefined && typeof reset === 'string') {
      this.rateLimitState.resetTime = parseInt(reset, 10) * 1000; // Convert to ms
    }
    this.rateLimitState.lastChecked = Date.now();
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): RateLimitState {
    return { ...this.rateLimitState };
  }

  /**
   * Check if we should wait before making next request
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    
    // If rate limit is exhausted, wait until reset
    if (this.rateLimitState.remaining <= 0) {
      const waitTime = this.rateLimitState.resetTime - now;
      if (waitTime > 0) {
        console.log(`Rate limit exhausted. Waiting ${Math.ceil(waitTime / 1000)}s until reset...`);
        await this.sleep(waitTime);
      }
    }

    // If we're close to the limit, add a small delay to avoid hitting it
    if (this.rateLimitState.remaining <= 5 && this.rateLimitState.remaining > 0) {
      await this.sleep(1000); // 1 second buffer
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(2, attempt),
      this.retryConfig.maxDelay
    );
    // Add jitter to avoid thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Fetch events from API with cursor-based pagination
   * @param cursor Optional cursor for pagination (null for first page)
   * @param pageSize Number of events to fetch per page
   * @returns API response with events and next cursor
   */
  async fetchEvents(
    cursor: string | null = null,
    pageSize: number = 1000
  ): Promise<APIResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Check rate limit before making request
        await this.checkRateLimit();

        // Build query parameters
        const params: Record<string, string | number> = {
          limit: pageSize,
        };
        if (cursor) {
          params.cursor = cursor;
        }

        // Make API request
        const response = await this.client.get<APIResponse>('/events', {
          params,
        });

        // Validate response
        if (!response.data || !Array.isArray(response.data.data)) {
          throw new APIError('Invalid API response format');
        }

        return response.data;
      } catch (error) {
        lastError = this.handleError(error);

        // Don't retry on rate limit errors - we'll wait and try again
        if (lastError instanceof RateLimitError) {
          const waitTime = this.rateLimitState.resetTime - Date.now();
          if (waitTime > 0) {
            console.log(`Rate limit hit. Waiting ${Math.ceil(waitTime / 1000)}s...`);
            await this.sleep(waitTime);
            continue; // Retry after waiting
          }
        }

        // Don't retry on client errors (4xx except 429)
        if (lastError instanceof APIError && lastError.message.includes('4')) {
          throw lastError;
        }

        // Retry on network errors and 5xx errors
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          console.log(`Request failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}). Retrying in ${delay}ms...`);
          await this.sleep(delay);
        } else {
          throw lastError;
        }
      }
    }

    throw lastError || new APIError('Max retries exceeded');
  }

  /**
   * Handle and classify errors
   */
  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      // Rate limit error
      if (axiosError.response?.status === 429) {
        return new RateLimitError('Rate limit exceeded');
      }

      // Client errors (4xx)
      if (axiosError.response?.status && axiosError.response.status >= 400 && axiosError.response.status < 500) {
        return new APIError(`Client error: ${axiosError.response.status} ${axiosError.response.statusText}`);
      }

      // Server errors (5xx)
      if (axiosError.response?.status && axiosError.response.status >= 500) {
        return new APIError(`Server error: ${axiosError.response.status} ${axiosError.response.statusText}`);
      }

      // Network errors
      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        return new APIError(`Timeout: ${axiosError.message}`);
      }

      return new APIError(`Network error: ${axiosError.message}`);
    }

    if (error instanceof Error) {
      return error;
    }

    return new APIError('Unknown error occurred');
  }

  /**
   * Fetch all events using pagination
   * Generator function for memory efficiency
   * @param pageSize Events per page
   */
  async *fetchAllEvents(pageSize: number = 1000): AsyncGenerator<Event[], void, unknown> {
    let cursor: string | null = null;
    let pageCount = 0;
    let totalEvents = 0;

    do {
      const response = await this.fetchEvents(cursor, pageSize);
      
      if (response.data.length > 0) {
        pageCount++;
        totalEvents += response.data.length;
        yield response.data;
      }

      cursor = response.nextCursor || null;

      // Log progress
      if (pageCount % 10 === 0) {
        console.log(`Fetched ${pageCount} pages (${totalEvents} events total)`);
      }
    } while (cursor !== null);

    console.log(`Completed fetching all events: ${totalEvents} total across ${pageCount} pages`);
  }

  /**
   * Test API connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.fetchEvents(null, 1);
      console.log(`API connection successful. First event ID: ${response.data[0]?.id || 'none'}`);
      return true;
    } catch (error) {
      console.error('API connection failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }
}
