#!/bin/bash

# Initialize database schema WITHOUT inserting initial data
# This creates tables, indexes, functions, and views only

set -e  # Exit on error

echo "  Database Schema Initialization (Tables Only)"
echo "=================================================="

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-assignment-postgres}"
DB_NAME="${DB_NAME:-ingestion}"
DB_USER="${DB_USER:-postgres}"

SCHEMA_FILE="schema.sql"

# Check if schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo " Error: $SCHEMA_FILE not found"
    exit 1
fi

echo ""
echo " Configuration:"
echo "   Container: $CONTAINER_NAME"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo ""

# Check if Docker container is running
echo " Checking Docker container..."
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo " Error: Container '$CONTAINER_NAME' is not running"
    echo "   Start it with: docker compose up -d postgres"
    exit 1
fi
echo " Container is running"

# Wait for PostgreSQL to be ready
echo ""
echo " Waiting for PostgreSQL..."
for i in {1..30}; do
    if docker exec $CONTAINER_NAME pg_isready -U $DB_USER > /dev/null 2>&1; then
        echo " PostgreSQL is ready"
        break
    fi
    echo -n "."
    sleep 1
    if [ $i -eq 30 ]; then
        echo ""
        echo " PostgreSQL not available after 30 seconds"
        exit 1
    fi
done

echo ""
echo " Creating tables (without initial data)..."

# Filter out the INSERT INTO ingestion_metadata section
# Apply everything except the initial data insert
docker exec -i $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME << 'EOSQL'
-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS ingested_events CASCADE;
DROP TABLE IF EXISTS ingestion_cursors CASCADE;
DROP TABLE IF EXISTS ingestion_metadata CASCADE;

-- Main Events Table
CREATE TABLE ingested_events (
    id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_event_id CHECK (id != '')
);

CREATE INDEX idx_events_timestamp ON ingested_events(timestamp);
CREATE INDEX idx_events_type ON ingested_events(event_type);
CREATE INDEX idx_events_created_at ON ingested_events(created_at);
CREATE INDEX idx_events_data ON ingested_events USING GIN (event_data);

-- Cursor Tracking Table
CREATE TABLE ingestion_cursors (
    cursor_id SERIAL PRIMARY KEY,
    cursor_value TEXT NOT NULL,
    worker_id INTEGER,
    events_fetched INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    is_completed BOOLEAN DEFAULT FALSE,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    CONSTRAINT valid_cursor_value CHECK (cursor_value != ''),
    CONSTRAINT valid_events_count CHECK (events_fetched >= 0)
);

CREATE INDEX idx_cursors_completed ON ingestion_cursors(is_completed);
CREATE INDEX idx_cursors_worker ON ingestion_cursors(worker_id);
CREATE INDEX idx_cursors_started ON ingestion_cursors(started_at);

-- Metadata Table
CREATE TABLE ingestion_metadata (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_key CHECK (key != '')
);

-- Helper Functions
CREATE OR REPLACE FUNCTION get_ingested_count() RETURNS BIGINT AS $$
    SELECT COUNT(*) FROM ingested_events;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION get_progress_percent() RETURNS NUMERIC AS $$
    SELECT ROUND(
        (COUNT(*)::NUMERIC / 3000000::NUMERIC) * 100, 
        2
    ) FROM ingested_events;
$$ LANGUAGE SQL;

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

CREATE OR REPLACE FUNCTION complete_cursor(p_cursor_id INTEGER) RETURNS VOID AS $$
    UPDATE ingestion_cursors
    SET is_completed = TRUE,
        completed_at = NOW()
    WHERE cursor_id = p_cursor_id;
$$ LANGUAGE SQL;

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

-- Views
CREATE OR REPLACE VIEW v_ingestion_progress AS
SELECT 
    get_ingested_count() as events_ingested,
    get_progress_percent() as progress_percent,
    (SELECT COUNT(*) FROM ingestion_cursors WHERE is_completed = FALSE) as active_cursors,
    (SELECT COUNT(*) FROM ingestion_cursors WHERE is_completed = TRUE) as completed_cursors,
    (SELECT value FROM ingestion_metadata WHERE key = 'ingestion_status') as status,
    NOW() - (SELECT value::TIMESTAMPTZ FROM ingestion_metadata WHERE key = 'ingestion_started_at') as elapsed_time;

CREATE OR REPLACE VIEW v_top_event_types AS
SELECT 
    event_type,
    COUNT(*) as count,
    ROUND((COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM ingested_events)::NUMERIC) * 100, 2) as percentage
FROM ingested_events
GROUP BY event_type
ORDER BY count DESC;
EOSQL

echo ""
echo " Schema created successfully (empty tables)!"
echo ""

# Quick verification
echo " Verification:"
TABLE_COUNT=$(docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo "   Tables created: $TABLE_COUNT"

METADATA_COUNT=$(docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -t -c \
    "SELECT COUNT(*) FROM ingestion_metadata;")
echo "   Metadata records: $METADATA_COUNT (empty)"

echo ""
echo " Database ready for ingestion (no initial data)"
echo ""
echo " Note: No initial metadata inserted."
echo "   Your application should set required metadata on first run."
