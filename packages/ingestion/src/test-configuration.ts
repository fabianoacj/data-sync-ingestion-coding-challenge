/**
 * Test script for Phase 1: Core Infrastructure
 * Tests configuration loading and database service
 */

import { loadConfig, validateConfig, printConfig } from './services/config.js';
import { DatabaseService } from './services/database.js';

async function testConfiguration() {
  console.log(' Testing Phase 1: Core Infrastructure\n');
  console.log('═══════════════════════════════════════\n');

  // Test 1: Configuration Loading
  console.log('Testing Configuration Loading...');
  try {
    const config = loadConfig();
    validateConfig(config);
    printConfig(config);
    console.log('Configuration loaded and validated\n');
  } catch (error) {
    console.error('Configuration test failed:', error);
    process.exit(1);
  }

  // Test 2: Database Connection
  console.log('Testing Database Connection...');
  const config = loadConfig();
  const db = new DatabaseService(config.database);

  try {
    await db.connect();
    console.log('Database connected successfully\n');
  } catch (error) {
    console.error('Database connection failed:', error);
    console.error('   Make sure PostgreSQL is running and schema is initialized');
    console.error('   Run: docker compose up -d postgres');
    console.error('   Then: cd packages/ingestion && ./test-schema.sh');
    process.exit(1);
  }

  // Test 3: Database Operations
  console.log('Testing Database Operations...');
  try {
    // Get initial counts
    const initialCount = await db.getEventCount();
    console.log(`   Initial event count: ${initialCount}`);

    // Test metadata operations
    await db.setMetadata('test_key', 'test_value');
    const value = await db.getMetadata('test_key');
    if (value !== 'test_value') {
      throw new Error('Metadata read/write failed');
    }
    console.log('    Metadata operations working');

    // Test stats retrieval
    const stats = await db.getIngestionStats();
    console.log(`   Stats: ${stats.total_events} events, ${stats.progress_percent}% complete`);
    console.log('   Statistics retrieval working');

    console.log('Database operations successful\n');
  } catch (error) {
    console.error('Database operations failed:', error);
    await db.disconnect();
    process.exit(1);
  }

  // Test 4: Cursor Management
  console.log('Testing Cursor Management...');
  try {
    const cursorId = await db.createCursor('test_cursor_0', 1);
    console.log(`   Created cursor with ID: ${cursorId}`);

    await db.updateCursorProgress(cursorId, 100);
    console.log('   Updated cursor progress');

    await db.completeCursor(cursorId);
    console.log('   Marked cursor as complete');

    console.log('Cursor management working\n');
  } catch (error) {
    console.error('Cursor management failed:', error);
    await db.disconnect();
    process.exit(1);
  }

  // Test 5: Event Insertion
  console.log('Testing Event Insertion...');
  try {
    const testEvent = {
      id: 'test_event_001',
      eventType: 'test.event',
      data: { test: true, timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    };

    await db.insertEvent(testEvent);
    console.log('   Single event insert working');

    // Test batch insert
    const batchEvents = Array.from({ length: 10 }, (_, i) => ({
      id: `test_batch_${i}`,
      eventType: 'test.batch',
      data: { index: i, test: true },
      timestamp: new Date().toISOString(),
    }));

    const inserted = await db.insertEventsBatch(batchEvents);
    console.log(`   Batch insert working (${inserted} events inserted)`);

    const newCount = await db.getEventCount();
    console.log(`   Total events now: ${newCount}`);

    console.log('Event insertion successful\n');
  } catch (error) {
    console.error('Event insertion failed:', error);
    await db.disconnect();
    process.exit(1);
  }

  // Cleanup
  await db.disconnect();

  console.log('═══════════════════════════════════════');
  console.log('All Phase 1 tests passed!');
  console.log('═══════════════════════════════════════\n');
  console.log('Configuration service working');
  console.log('Database service working');
  console.log('Schema properly initialized');
  console.log('Ready for Phase 2: API Client\n');
}

// Run tests
testConfiguration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
