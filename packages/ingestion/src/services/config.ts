/**
 * Configuration Service
 * Loads and validates environment variables
 * Provides type-safe configuration throughout the application
 */

import { config as loadEnv } from 'dotenv';
import type { AppConfig, DatabaseConfig, APIConfig, WorkerConfig } from '../types/event.js';

// Load environment variables from .env file
loadEnv();

/**
 * Parse environment variable as integer with default value
 */
function parseIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse environment variable as string with default value
 */
function parseStringEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Validate required environment variable
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Build database configuration from environment
 */
function buildDatabaseConfig(): DatabaseConfig {
  // Support both DATABASE_URL and individual variables
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Parse DATABASE_URL (format: postgresql://user:password@host:port/database)
    try {
      const url = new URL(databaseUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '5432', 10),
        database: url.pathname.slice(1), // Remove leading /
        user: url.username,
        password: url.password,
        max: parseIntEnv('DB_POOL_MAX', 20),
        idleTimeoutMillis: parseIntEnv('DB_IDLE_TIMEOUT', 30000),
        connectionTimeoutMillis: parseIntEnv('DB_CONNECT_TIMEOUT', 2000),
      };
    } catch (error) {
      throw new Error(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fall back to individual variables
  return {
    host: parseStringEnv('DB_HOST', 'localhost'),
    port: parseIntEnv('DB_PORT', 5432),
    database: parseStringEnv('DB_NAME', 'ingestion'),
    user: parseStringEnv('DB_USER', 'postgres'),
    password: parseStringEnv('DB_PASSWORD', 'postgres'),
    max: parseIntEnv('DB_POOL_MAX', 20),
    idleTimeoutMillis: parseIntEnv('DB_IDLE_TIMEOUT', 30000),
    connectionTimeoutMillis: parseIntEnv('DB_CONNECT_TIMEOUT', 2000),
  };
}

/**
 * Build API configuration from environment
 */
function buildAPIConfig(): APIConfig {
  return {
    baseUrl: parseStringEnv(
      'API_BASE_URL',
      'http://mock-api:3000/api/v1'
    ),
    apiKey: process.env.API_KEY, // Optional - some APIs don't require it
    timeout: parseIntEnv('API_TIMEOUT', 30000),
    retries: parseIntEnv('API_RETRIES', 3),
  };
}

/**
 * Build worker configuration from environment
 */
function buildWorkerConfig(): WorkerConfig {
  return {
    concurrency: parseIntEnv('WORKER_CONCURRENCY', 10),
    pageSize: parseIntEnv('PAGE_SIZE', 1000),
    batchSize: parseIntEnv('BATCH_SIZE', 500),
  };
}

/**
 * Build complete application configuration
 */
export function loadConfig(): AppConfig {
  const config: AppConfig = {
    database: buildDatabaseConfig(),
    api: buildAPIConfig(),
    worker: buildWorkerConfig(),
    logInterval: parseIntEnv('LOG_INTERVAL', 5000),
  };

  return config;
}

/**
 * Validate configuration and log warnings
 */
export function validateConfig(config: AppConfig): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Database validation
  if (!config.database.host) {
    errors.push('Database host is required');
  }
  if (config.database.port < 1 || config.database.port > 65535) {
    errors.push('Database port must be between 1 and 65535');
  }
  if (!config.database.database) {
    errors.push('Database name is required');
  }

  // API validation
  if (!config.api.baseUrl) {
    errors.push('API base URL is required');
  }
  if (!config.api.baseUrl.startsWith('http')) {
    errors.push('API base URL must start with http:// or https://');
  }

  // Worker validation
  if (config.worker.concurrency < 1) {
    warnings.push('Worker concurrency is less than 1, setting to 1');
    config.worker.concurrency = 1;
  }
  if (config.worker.concurrency > 100) {
    warnings.push('Worker concurrency is very high (>100), may cause rate limiting');
  }
  if (config.worker.pageSize < 1) {
    errors.push('Page size must be at least 1');
  }
  if (config.worker.pageSize > 10000) {
    warnings.push('Page size is very large (>10000), may not be supported by API');
  }
  if (config.worker.batchSize < 1) {
    errors.push('Batch size must be at least 1');
  }
  if (config.worker.batchSize > config.worker.pageSize) {
    warnings.push('Batch size is larger than page size, will be capped');
  }

  // Log warnings
  if (warnings.length > 0) {
    console.warn('Configuration warnings:');
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
  }

  // Throw on errors
  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((error) => console.error(`  - ${error}`));
    throw new Error('Invalid configuration');
  }
}

/**
 * Print configuration (safe - hides sensitive data)
 */
export function printConfig(config: AppConfig): void {
  console.log(' Configuration:');
  console.log('   Database:');
  console.log(`      Host: ${config.database.host}`);
  console.log(`      Port: ${config.database.port}`);
  console.log(`      Database: ${config.database.database}`);
  console.log(`      User: ${config.database.user}`);
  console.log(`      Pool Size: ${config.database.max}`);
  console.log('   API:');
  console.log(`      Base URL: ${config.api.baseUrl}`);
  console.log(`      API Key: ${config.api.apiKey ? '***' + config.api.apiKey.slice(-4) : 'Not set'}`);
  console.log(`      Timeout: ${config.api.timeout}ms`);
  console.log('   Worker:');
  console.log(`      Concurrency: ${config.worker.concurrency}`);
  console.log(`      Page Size: ${config.worker.pageSize}`);
  console.log(`      Batch Size: ${config.worker.batchSize}`);
  console.log('   Logging:');
  console.log(`      Log Interval: ${config.logInterval}ms`);
  console.log('');
}

/**
 * Get environment name
 */
export function getEnvironment(): string {
  return process.env.NODE_ENV || 'development';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getEnvironment() === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getEnvironment() === 'production';
}
