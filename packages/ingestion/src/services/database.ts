/**
 * Database Service
 * Handles all PostgreSQL interactions including:
 * - Connection pooling
 * - Batch inserts
 * - Cursor tracking
 * - Progress monitoring
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import type {
  Event,
  IngestedEvent,
  CursorRecord,
  MetadataRecord,
  IngestionStats,
  DatabaseConfig,
} from '../types/event.js';
import { DatabaseError } from '../types/event.js';

export class DatabaseService {
  private pool: Pool;
  private isConnected: boolean = false;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    try {
      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      this.isConnected = true;
      console.log(' Database connected successfully');
    } catch (error) {
      this.isConnected = false;
      throw new DatabaseError(
        `Failed to connect to database: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error as Error
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error closing database connection:', error);
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  // ============================================================================
  // Event Insertion
  // ============================================================================

  /**
   * Insert a single event (use batch methods for better performance)
   */
  async insertEvent(event: Event): Promise<void> {
    const query = `
      INSERT INTO ingested_events (id, event_type, event_data, timestamp)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
    `;

    try {
      await this.pool.query(query, [
        event.id,
        event.eventType,
        event.data,
        event.timestamp,
      ]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to insert event ${event.id}`,
        error as Error
      );
    }
  }

  /**
   * Batch insert events for optimal performance
   * Uses a single query with multiple value sets
   */
  async insertEventsBatch(events: Event[]): Promise<number> {
    if (events.length === 0) return 0;

    try {
      // Build VALUES clause
      const values: any[] = [];
      const placeholders: string[] = [];

      events.forEach((event, index) => {
        const offset = index * 4;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
        );
        values.push(event.id, event.eventType, event.data, event.timestamp);
      });

      const query = `
        INSERT INTO ingested_events (id, event_type, event_data, timestamp)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (id) DO NOTHING
      `;

      const result = await this.pool.query(query, values);
      return result.rowCount || 0;
    } catch (error) {
      throw new DatabaseError(
        `Failed to batch insert ${events.length} events`,
        error as Error
      );
    }
  }

  /**
   * High-performance bulk insert using COPY (fastest method)
   * Note: Requires careful formatting
   */
  async bulkInsertEvents(events: Event[]): Promise<void> {
    if (events.length === 0) return;

    const client = await this.pool.connect();

    try {
      // Start a transaction
      await client.query('BEGIN');

      // Create temporary table
      await client.query(`
        CREATE TEMP TABLE temp_events (
          id VARCHAR(255),
          event_type VARCHAR(100),
          event_data JSONB,
          timestamp TIMESTAMPTZ
        )
      `);

      // Prepare CSV data
      const csvData = events
        .map((e) => {
          return `${e.id}\t${e.eventType}\t${JSON.stringify(e.data)}\t${e.timestamp}`;
        })
        .join('\n');

      // Use COPY for ultra-fast insert
      await client.query(`
        COPY temp_events (id, event_type, event_data, timestamp)
        FROM STDIN
        WITH (FORMAT text, DELIMITER E'\\t')
      `);

      // Insert from temp table to main table (with deduplication)
      await client.query(`
        INSERT INTO ingested_events (id, event_type, event_data, timestamp)
        SELECT id, event_type, event_data, timestamp
        FROM temp_events
        ON CONFLICT (id) DO NOTHING
      `);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new DatabaseError(
        `Failed to bulk insert ${events.length} events`,
        error as Error
      );
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Cursor Management
  // ============================================================================

  async createCursor(
    cursorValue: string,
    workerId?: number
  ): Promise<number> {
    const query = `
      INSERT INTO ingestion_cursors (cursor_value, worker_id)
      VALUES ($1, $2)
      RETURNING cursor_id
    `;

    try {
      const result = await this.pool.query(query, [cursorValue, workerId]);
      return result.rows[0].cursor_id;
    } catch (error) {
      throw new DatabaseError(
        `Failed to create cursor ${cursorValue}`,
        error as Error
      );
    }
  }

  async updateCursorProgress(
    cursorId: number,
    eventsFetched: number
  ): Promise<void> {
    const query = `
      UPDATE ingestion_cursors
      SET events_fetched = events_fetched + $1
      WHERE cursor_id = $2
    `;

    try {
      await this.pool.query(query, [eventsFetched, cursorId]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to update cursor ${cursorId}`,
        error as Error
      );
    }
  }

  async completeCursor(cursorId: number): Promise<void> {
    const query = `
      UPDATE ingestion_cursors
      SET is_completed = TRUE,
          completed_at = NOW()
      WHERE cursor_id = $1
    `;

    try {
      await this.pool.query(query, [cursorId]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to complete cursor ${cursorId}`,
        error as Error
      );
    }
  }

  async recordCursorError(
    cursorId: number,
    errorMessage: string
  ): Promise<void> {
    const query = `
      UPDATE ingestion_cursors
      SET error_count = error_count + 1,
          last_error = $1
      WHERE cursor_id = $2
    `;

    try {
      await this.pool.query(query, [errorMessage, cursorId]);
    } catch (error) {
      console.error('Failed to record cursor error:', error);
    }
  }

  async getIncompleteCursors(): Promise<CursorRecord[]> {
    const query = `
      SELECT cursor_id, cursor_value, worker_id, events_fetched, started_at
      FROM ingestion_cursors
      WHERE is_completed = FALSE
      ORDER BY started_at ASC
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      throw new DatabaseError('Failed to get incomplete cursors', error as Error);
    }
  }

  // ============================================================================
  // Metadata Management
  // ============================================================================

  async getMetadata(key: string): Promise<string | null> {
    const query = 'SELECT value FROM ingestion_metadata WHERE key = $1';

    try {
      const result = await this.pool.query(query, [key]);
      return result.rows.length > 0 ? result.rows[0].value : null;
    } catch (error) {
      throw new DatabaseError(`Failed to get metadata ${key}`, error as Error);
    }
  }

  async setMetadata(key: string, value: string): Promise<void> {
    const query = `
      INSERT INTO ingestion_metadata (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = $2, updated_at = NOW()
    `;

    try {
      await this.pool.query(query, [key, value]);
    } catch (error) {
      throw new DatabaseError(`Failed to set metadata ${key}`, error as Error);
    }
  }

  // ============================================================================
  // Statistics & Monitoring
  // ============================================================================

  async getEventCount(): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM ingested_events';

    try {
      const result = await this.pool.query(query);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      throw new DatabaseError('Failed to get event count', error as Error);
    }
  }

  async getProgressPercent(): Promise<number> {
    const query = 'SELECT get_progress_percent() as percent';

    try {
      const result = await this.pool.query(query);
      return parseFloat(result.rows[0].percent || '0');
    } catch (error) {
      return 0;
    }
  }

  async getIngestionStats(): Promise<IngestionStats> {
    const query = 'SELECT * FROM get_ingestion_stats()';

    try {
      const result = await this.pool.query(query);
      return result.rows[0];
    } catch (error) {
      throw new DatabaseError('Failed to get ingestion stats', error as Error);
    }
  }

  async getTopEventTypes(limit: number = 10): Promise<Array<{ event_type: string; count: number; percentage: number }>> {
    const query = `
      SELECT event_type, COUNT(*) as count,
             ROUND((COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM ingested_events)::NUMERIC) * 100, 2) as percentage
      FROM ingested_events
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT $1
    `;

    try {
      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      throw new DatabaseError('Failed to get top event types', error as Error);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Execute a raw SQL query (use with caution)
   */
  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    try {
      return await this.pool.query(sql, params);
    } catch (error) {
      throw new DatabaseError('Query execution failed', error as Error);
    }
  }

  /**
   * Get a client from the pool for transactions
   */
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }
}
