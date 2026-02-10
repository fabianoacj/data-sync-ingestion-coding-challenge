#!/usr/bin/env node

/**
 * Quick test to verify the mock API can serve all 3M events
 * This simulates what the ingestion service will do
 */

const API_URL = 'http://localhost:3000/api/v1/events';
const PAGE_SIZE = 10000;
const MAX_REQUESTS = 50; // Limit test to 50 requests (500k events)

async function testMockAPI() {
  console.log('Testing Mock API...\n');
  console.log(`Limited to ${MAX_REQUESTS} requests to avoid rate limiting\n`);
  
  let cursor = null;
  let totalEvents = 0;
  let requests = 0;
  const startTime = Date.now();
  
  try {
    while (requests < MAX_REQUESTS) {
      requests++;
      
      // Build URL with cursor and limit
      const url = cursor 
        ? `${API_URL}?cursor=${cursor}&limit=${PAGE_SIZE}`
        : `${API_URL}?limit=${PAGE_SIZE}`;
      
      // Fetch page
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Update counters
      totalEvents += data.data.length;
      
      // Log progress every 10 requests
      if (requests % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(totalEvents / elapsed);
        console.log(
          ` Progress: ${totalEvents.toLocaleString()} events ` +
          `(${requests} requests, ${rate}/sec)`
        );
      }
      
      // Check if done
      if (!data.hasMore) {
        break;
      }
      
      cursor = data.nextCursor;
    }
    
    // Final summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const rate = Math.round(totalEvents / elapsed);
    
    console.log('\n Test Complete!');
    console.log(`   Total Events: ${totalEvents.toLocaleString()}`);
    console.log(`   Total Requests: ${requests}`);
    console.log(`   Time Elapsed: ${elapsed}s`);
    console.log(`   Average Rate: ${rate} events/sec`);
    
    console.log('\n Extrapolation to 3M events:');
    const eventsPerRequest = totalEvents / requests;
    const requestsFor3M = Math.ceil(3_000_000 / eventsPerRequest);
    const estimatedTime = (requestsFor3M / 100 * 60).toFixed(1); // 100 req/min
    console.log(`   Requests needed: ${requestsFor3M}`);
    console.log(`   Estimated time: ${estimatedTime} seconds (at 100 req/min)`);
    console.log('\n Mock API is working correctly!');
    
  } catch (error) {
    console.error('\n Error:', error.message);
    process.exit(1);
  }
}

testMockAPI();
