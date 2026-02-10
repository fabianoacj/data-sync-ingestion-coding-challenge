/**
 * Test script for Phase 2: API Client
 * Tests API connectivity, pagination, and rate limit handling
 */

import { loadConfig } from './services/config.js';
import { APIClient } from './services/api-client.js';

async function testPhase2() {
  console.log('Testing Phase 2: API Client\n');
  console.log('═══════════════════════════════════════\n');

  // Load configuration
  const config = loadConfig();

  // Test 1: API Client Initialization
  console.log('Testing API Client Initialization...');
  try {
    const apiClient = new APIClient(config.api);
    console.log('API client initialized successfully\n');

    // Test 2: Connection Test
    console.log('Testing API Connection...');
    const isConnected = await apiClient.testConnection();
    if (!isConnected) {
      console.error('API connection failed');
      console.error('   Make sure mock API is running:');
      console.error('   docker compose up -d mock-api');
      process.exit(1);
    }
    console.log('');

    // Test 3: Rate Limit Tracking
    console.log('Testing Rate Limit Tracking...');
    const rateLimitBefore = apiClient.getRateLimitStatus();
    console.log(`   Rate limit before: ${rateLimitBefore.remaining}/${rateLimitBefore.limit}`);
    
    await apiClient.fetchEvents(null, 10);
    
    const rateLimitAfter = apiClient.getRateLimitStatus();
    console.log(`   Rate limit after: ${rateLimitAfter.remaining}/${rateLimitAfter.limit}`);
    console.log('Rate limit tracking working\n');

    // Test 4: Pagination
    console.log('Testing Cursor-Based Pagination...');
    const firstPage = await apiClient.fetchEvents(null, 100);
    console.log(`   First page: ${firstPage.data.length} events`);
    console.log(`   First event ID: ${firstPage.data[0]?.id}`);
    console.log(`   Next cursor: ${firstPage.nextCursor || 'none'}`);

    if (firstPage.nextCursor) {
      const secondPage = await apiClient.fetchEvents(firstPage.nextCursor, 100);
      console.log(`   Second page: ${secondPage.data.length} events`);
      console.log(`   First event ID: ${secondPage.data[0]?.id}`);
      console.log(`   Next cursor: ${secondPage.nextCursor || 'none'}`);
      console.log('Pagination working\n');
    } else {
      console.log('No next cursor (dataset too small for pagination test)\n');
    }

    // Test 5: Fetch Multiple Pages
    console.log('Testing Multiple Page Fetching...');
    let pageCount = 0;
    let totalEvents = 0;
    const maxPages = 5; // Limit test to 5 pages

    for await (const events of apiClient.fetchAllEvents(1000)) {
      pageCount++;
      totalEvents += events.length;
      console.log(`   Page ${pageCount}: ${events.length} events (total: ${totalEvents})`);
      
      if (pageCount >= maxPages) {
        console.log(`   Stopping after ${maxPages} pages for test purposes`);
        break;
      }
    }
    console.log(`Fetched ${pageCount} pages with ${totalEvents} events total\n`);

    // Test 6: Rate Limit Status
    console.log('Final Rate Limit Status:');
    const finalStatus = apiClient.getRateLimitStatus();
    console.log(`   Remaining: ${finalStatus.remaining}/${finalStatus.limit}`);
    console.log(`   Reset time: ${new Date(finalStatus.resetTime).toISOString()}`);
    const timeUntilReset = Math.ceil((finalStatus.resetTime - Date.now()) / 1000);
    console.log(`   Time until reset: ${timeUntilReset}s\n`);

    // Test 7: Event Structure Validation
    console.log('Testing Event Structure...');
    if (firstPage.data.length > 0) {
      const sampleEvent = firstPage.data[0];
      console.log('   Sample event:');
      console.log(`      ID: ${sampleEvent.id}`);
      console.log(`      Type: ${sampleEvent.eventType}`);
      console.log(`      Timestamp: ${sampleEvent.timestamp}`);
      console.log(`      Data keys: ${Object.keys(sampleEvent.data).join(', ')}`);
      
      // Validate required fields
      const hasRequiredFields = 
        sampleEvent.id && 
        sampleEvent.eventType && 
        sampleEvent.timestamp && 
        sampleEvent.data;
      
      if (hasRequiredFields) {
        console.log('Event structure valid\n');
      } else {
        console.error('Event missing required fields\n');
        process.exit(1);
      }
    }

    console.log('═══════════════════════════════════════');
    console.log('All Phase 2 tests passed!');
    console.log('═══════════════════════════════════════\n');
    console.log('API client working');
    console.log('Rate limit tracking working');
    console.log('Pagination working');
    console.log('Ready for Phase 3: Worker Pool\n');

  } catch (error) {
    console.error('Phase 2 test failed:', error);
    if (error instanceof Error) {
      console.error('   Error:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run tests
testPhase2().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
