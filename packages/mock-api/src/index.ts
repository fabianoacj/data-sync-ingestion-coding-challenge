/**
 * Main entry point for Mock API Server
 */

import { createServer } from './server.js';

const PORT = process.env.PORT || 3000;

const app = createServer();

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  Mock DataSync Analytics API Server                       ║
╠═══════════════════════════════════════════════════════════╣
║  Status:        Running                                   ║
║  Port:          ${PORT}                                      ║
║  Total Events:  3,000,000                                 ║
║  Rate Limit:    100 requests/minute                       ║
║  Max Page Size: 10,000 events                             ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    GET /health           - Health check                   ║
║    GET /stats            - API statistics                 ║
║    GET /api/v1/events    - Paginated events               ║
║                                                           ║
║  Query Parameters:                                        ║
║    ?cursor=<cursor>      - Pagination cursor              ║
║    ?limit=<number>       - Events per page (max 10,000)   ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});
