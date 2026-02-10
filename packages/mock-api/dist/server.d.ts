/**
 * Express server that simulates the DataSync Analytics API
 * Features:
 * - Rate limiting (100 requests/minute)
 * - Cursor-based pagination
 * - 3 million events served on-the-fly
 */
/**
 * Create and configure Express app
 */
export declare function createServer(): import("express-serve-static-core").Express;
