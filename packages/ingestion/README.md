# Event Ingestion Service

High-performance TypeScript service for ingesting 3 million events from the DataSync Analytics API into PostgreSQL.

## Features

- **Parallel Processing**: Multiple workers fetching concurrently
- **Batch Inserts**: Optimized database writes
- **Resumability**: Crash recovery with cursor tracking
- **Rate Limit Handling**: Automatic retry with backoff
- **Progress Monitoring**: Real-time statistics and ETA
- **Type Safety**: Full TypeScript coverage

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Docker (optional)

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# For local testing, use .env.local defaults
```

### Initialize Database

```bash
# Start PostgreSQL (if using Docker)
docker compose up -d postgres

# Run schema initialization (creates empty tables)
./init-tables.sh
```

**Note**: The database tables are created empty. Your application will populate metadata on first run.

### Test Infrastructure

```bash
# Phase 1: Test configuration and database
npm run test:configuration

# Phase 2: Test API client and pagination
npm run test:phase2
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `API_BASE_URL` | DataSync API endpoint | `http://mock-api:3000/api/v1` |
| `API_KEY` | API authentication key | - |
| `WORKER_CONCURRENCY` | Number of parallel workers | `10` |
| `PAGE_SIZE` | Events per API request | `1000` |
| `BATCH_SIZE` | Events per DB insert | `500` |
| `LOG_INTERVAL` | Progress logging interval (ms) | `5000` |

### Environment Files

- `.env` - Active configuration
- `.env.example` - Template with documentation

## Implementation Phases

### Phase 0: Mock API Server (Complete)
Mock API serving 3M events with rate limiting for safe testing.

### Phase 1: Core Infrastructure (Complete)
- Database schema with deduplication
- Type definitions and error classes
- Configuration service
- Database service with connection pooling

### Phase 2: API Client (Complete)
- HTTP client with axios
- Rate limit tracking (100 req/min)
- Cursor-based pagination
- Retry logic with exponential backoff
- Error handling and classification

### Phase 3: Worker Pool (Next)
- Parallel worker implementation
- Progress tracking and logging
- Resumability support

## Architecture

```
src/
├── index.ts              # Application entry point
├── test-configuration.ts # Phase 1 tests
├── test-phase2.ts        # Phase 2 tests
├── services/
│   ├── config.ts         # Configuration management (Phase 1)
│   ├── database.ts       # Database operations (Phase 1)
│   └── api-client.ts     # HTTP client with pagination (Phase 2)
├── types/
│   └── event.ts          # TypeScript definitions
└── utils/
```

## Database Schema

### Tables

**ingested_events**: Main events table
- Primary key on `id` for deduplication
- JSONB column for event data
- Indexed on `timestamp` and `event_type`

**ingestion_cursors**: Cursor tracking for resumability
- Tracks worker progress
- Supports crash recovery

**ingestion_metadata**: Configuration and statistics
- Key-value store for runtime data

### Helper Functions

- `get_ingested_count()` - Total events count
- `get_progress_percent()` - Completion percentage
- `get_incomplete_cursors()` - Cursors needing processing
- `complete_cursor(id)` - Mark cursor complete
- `get_ingestion_stats()` - Comprehensive statistics

### Views

- `v_ingestion_progress` - Real-time progress
- `v_top_event_types` - Event type distribution

## Development

### Build

```bash
npm run build
```

### Run

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### Testing

```bash
# Test Phase 1 (Infrastructure)
npm run test:configuration

# Test with mock API
API_BASE_URL=http://localhost:3000/api/v1 npm run dev
```

## Performance

### Target Metrics

- **Minimum**: 3M events in 180 minutes (16,667/min)
- **Competitive**: 3M events in 30 minutes (100,000/min)
- **Optimal**: 3M events in 15 minutes (200,000/min)

### Optimization Strategies

1. **Parallel Workers**: 10-20 concurrent fetchers
2. **Large Page Sizes**: Up to 10,000 events per request
3. **Batch Inserts**: 500-1000 events per transaction
4. **Connection Pooling**: Match pool size to workers
5. **Rate Limit Awareness**: Respect API limits

## Resumability

The service automatically handles crashes:

1. Cursors tracked in database
2. On restart, resume from incomplete cursors
3. Duplicate events ignored via PRIMARY KEY
4. No data loss guaranteed

## Monitoring

### Progress Logs

```
[2026-02-09T12:00:00.000Z] Progress: 500,000/3,000,000 (16.67%) | Rate: 1,234/sec | ETA: 33m 45s
```

### Database Queries

```sql
-- Current progress
SELECT * FROM v_ingestion_progress;

-- Top event types
SELECT * FROM v_top_event_types;

-- Statistics
SELECT * FROM get_ingestion_stats();
```

## Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Check connection
psql -h localhost -p 5434 -U postgres -d ingestion -c '\conninfo'
```

### Schema Not Initialized

```bash
# Run schema setup
cd packages/ingestion
./test-schema.sh
```

### Rate Limiting

Adjust `WORKER_CONCURRENCY` and `PAGE_SIZE` based on API limits:

```bash
# Conservative (avoid rate limits)
WORKER_CONCURRENCY=5 PAGE_SIZE=500

# Aggressive (maximize throughput)
WORKER_CONCURRENCY=20 PAGE_SIZE=10000
```

## Next Steps

- **Phase 2**: API Client with rate limiting
- **Phase 3**: Worker pool and progress tracking
- **Phase 4**: Main orchestration and Docker integration

## License

ISC
