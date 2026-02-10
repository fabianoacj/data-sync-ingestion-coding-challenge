-- ============================================================================
-- Event Ingestion Database Schema
-- ============================================================================
-- This schema supports:
-- - Deduplication via primary key on event ID
-- - Progress tracking for resumability
-- - Cursor management for parallel workers
-- - Metadata for monitoring and statistics
-- ============================================================================

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS ingested_events CASCADE;
DROP TABLE IF EXISTS ingestion_cursors CASCADE;
DROP TABLE IF EXISTS ingestion_metadata CASCADE;

-- ============================================================================
-- Main Events Table
-- ============================================================================
-- Stores all ingested events with deduplication
CREATE TABLE ingested_events (
    id VARCHAR(255) PRIMARY KEY,                -- Event ID (unique, from API)
    event_type VARCHAR(100) NOT NULL,           -- Event type (user.signup, etc.)
    event_data JSONB NOT NULL,                  -- Event payload as JSON
    timestamp TIMESTAMPTZ NOT NULL,             -- Event timestamp
    created_at TIMESTAMPTZ DEFAULT NOW(),       -- When we ingested it
    
    -- Indexes for common queries
    CONSTRAINT valid_event_id CHECK (id != '')
);

-- Indexes for performance
CREATE INDEX idx_events_timestamp ON ingested_events(timestamp);
CREATE INDEX idx_events_type ON ingested_events(event_type);
CREATE INDEX idx_events_created_at ON ingested_events(created_at);

-- GIN index for JSONB queries (optional, for analytics)
CREATE INDEX idx_events_data ON ingested_events USING GIN (event_data);

-- ============================================================================
-- Cursor Tracking Table
-- ============================================================================
-- Tracks which cursors have been processed for resumability
-- Each worker maintains its own cursor state
CREATE TABLE ingestion_cursors (
    cursor_id SERIAL PRIMARY KEY,
    cursor_value TEXT NOT NULL,                 -- Cursor string (e.g., "cursor_1000")
    worker_id INTEGER,                          -- Which worker is processing this
    events_fetched INTEGER DEFAULT 0,           -- Events fetched for this cursor
    started_at TIMESTAMPTZ DEFAULT NOW(),       -- When cursor processing started
    completed_at TIMESTAMPTZ,                   -- When cursor was completed (NULL = in progress)
    is_completed BOOLEAN DEFAULT FALSE,         -- Completion flag
    error_count INTEGER DEFAULT 0,              -- Number of errors encountered
    last_error TEXT,                            -- Last error message (if any)
    
    -- Constraints
    CONSTRAINT valid_cursor_value CHECK (cursor_value != ''),
    CONSTRAINT valid_events_count CHECK (events_fetched >= 0)
);

-- Indexes for cursor queries
CREATE INDEX idx_cursors_completed ON ingestion_cursors(is_completed);
CREATE INDEX idx_cursors_worker ON ingestion_cursors(worker_id);
CREATE INDEX idx_cursors_started ON ingestion_cursors(started_at);

-- ============================================================================
-- Metadata Table
-- ============================================================================
-- Stores configuration and runtime statistics
-- Key-value store for flexible metadata
CREATE TABLE ingestion_metadata (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_key CHECK (key != '')
);

-- ============================================================================
-- Initial Metadata Setup
-- ============================================================================
-- Note: No initial data is inserted. 
-- Your application should populate metadata on first run as needed.

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to get total ingested events count
CREATE OR REPLACE FUNCTION get_ingested_count() RETURNS BIGINT AS $$
    SELECT COUNT(*) FROM ingested_events;
$$ LANGUAGE SQL;

-- Function to get progress percentage
CREATE OR REPLACE FUNCTION get_progress_percent() RETURNS NUMERIC AS $$
    SELECT ROUND(
        (COUNT(*)::NUMERIC / 3000000::NUMERIC) * 100, 
        2
    ) FROM ingested_events;
$$ LANGUAGE SQL;

-- Function to get incomplete cursors
CREATE OR REPLACE FUNCTION get_incomplete_cursors() RETURNS TABLE(
    cursor_id INTEGER,
    cursor_value TEXT,
    worker_id INTEGER,
    started_at TIMESTAMPTZ
) AS $$
    SELECT cursor_id, cursor_value, worker_id, started_at
    FROM ingestion_cursors
    WHERE is_completed = FALSE
    ORDER BY started_at ASC;
$$ LANGUAGE SQL;

-- Function to mark cursor as completed
CREATE OR REPLACE FUNCTION complete_cursor(p_cursor_id INTEGER) RETURNS VOID AS $$
    UPDATE ingestion_cursors
    SET is_completed = TRUE,
        completed_at = NOW()
    WHERE cursor_id = p_cursor_id;
$$ LANGUAGE SQL;

-- Function to get ingestion statistics
CREATE OR REPLACE FUNCTION get_ingestion_stats() RETURNS TABLE(
    total_events BIGINT,
    progress_percent NUMERIC,
    total_cursors BIGINT,
    completed_cursors BIGINT,
    in_progress_cursors BIGINT,
    failed_cursors BIGINT,
    elapsed_time INTERVAL
) AS $$
    SELECT 
        COUNT(*) as total_events,
        ROUND((COUNT(*)::NUMERIC / 3000000::NUMERIC) * 100, 2) as progress_percent,
        (SELECT COUNT(*) FROM ingestion_cursors) as total_cursors,
        (SELECT COUNT(*) FROM ingestion_cursors WHERE is_completed = TRUE) as completed_cursors,
        (SELECT COUNT(*) FROM ingestion_cursors WHERE is_completed = FALSE AND completed_at IS NULL) as in_progress_cursors,
        (SELECT COUNT(*) FROM ingestion_cursors WHERE error_count > 0) as failed_cursors,
        NOW() - (SELECT value::TIMESTAMPTZ FROM ingestion_metadata WHERE key = 'ingestion_started_at') as elapsed_time
    FROM ingested_events;
$$ LANGUAGE SQL;

-- ============================================================================
-- Views for Monitoring
-- ============================================================================

-- View: Current ingestion progress
CREATE OR REPLACE VIEW v_ingestion_progress AS
SELECT 
    get_ingested_count() as events_ingested,
    get_progress_percent() as progress_percent,
    (SELECT COUNT(*) FROM ingestion_cursors WHERE is_completed = FALSE) as active_cursors,
    (SELECT COUNT(*) FROM ingestion_cursors WHERE is_completed = TRUE) as completed_cursors,
    (SELECT value FROM ingestion_metadata WHERE key = 'ingestion_status') as status,
    NOW() - (SELECT value::TIMESTAMPTZ FROM ingestion_metadata WHERE key = 'ingestion_started_at') as elapsed_time;

-- View: Top event types
CREATE OR REPLACE VIEW v_top_event_types AS
SELECT 
    event_type,
    COUNT(*) as count,
    ROUND((COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM ingested_events)::NUMERIC) * 100, 2) as percentage
FROM ingested_events
GROUP BY event_type
ORDER BY count DESC;

-- ============================================================================
-- Grant Permissions (for production environments)
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE ON ingested_events TO ingestion_user;
-- GRANT SELECT, INSERT, UPDATE ON ingestion_cursors TO ingestion_user;
-- GRANT SELECT, INSERT, UPDATE ON ingestion_metadata TO ingestion_user;
-- GRANT USAGE, SELECT ON SEQUENCE ingestion_cursors_cursor_id_seq TO ingestion_user;

-- ============================================================================
-- Verify Schema
-- ============================================================================
-- Check that all tables were created
DO $$
BEGIN
    RAISE NOTICE 'Schema setup complete!';
    RAISE NOTICE 'Tables: %', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE');
    RAISE NOTICE 'Views: %', (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public');
    RAISE NOTICE 'Functions: %', (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'));
END $$;
