/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — IIS W3C Extended Log Format Logger
 *
 * On Windows Server 2022 with IIS, logs HTTP requests in the W3C Extended
 * Log Format (.log files) for integration with IIS analytics tools,
 * compliance reporting, and performance analysis in IIS Manager.
 *
 * Log location (default):
 *   C:\inetpub\logs\LogFiles\W3SVC{IIS_SITE_ID}\leeku_secure_2026-06-07.log
 *
 * Format example:
 *   #Software: Leeku Secure
 *   #Version: 1.0
 *   #Date: 2026-06-07 10:30:45
 *   #Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port...
 *   2026-06-07 10:30:45 192.168.1.100 POST /api/files/upload - 443 user@example.com...
 *
 * Environment variables:
 *   IIS_LOGS_ENABLED        — enable/disable IIS logging (default: false)
 *   IIS_SITE_ID             — IIS site number (default: 1)
 *   IIS_LOGS_PATH           — custom log directory (optional)
 *   IIS_LOG_FIELDS          — space-separated W3C fields (default: common set)
 *   IIS_LOGS_DAILY_ROLLOVER — create new log per day (default: true)
 */

import fs from 'fs';
import path from 'path';
import express from 'express';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface IISLogConfig {
  enabled:        boolean;
  siteId:         number;
  logPath:        string;
  fields:         string[];
  dailyRollover:  boolean;
}

export interface IISLogContext {
  /** Request timestamp */
  timestamp:      Date;
  /** HTTP method (GET, POST, etc.) */
  method:         string;
  /** Request URI path (without query string) */
  path:           string;
  /** Query string */
  query:          string;
  /** Server port */
  port:           number;
  /** Authenticated username or '-' */
  username:       string;
  /** Client IP address */
  clientIp:       string;
  /** User-Agent header */
  userAgent:      string;
  /** HTTP response status code */
  statusCode:     number;
  /** Response body size (bytes) */
  responseBytes:  number;
  /** Request body size (bytes) */
  requestBytes:   number;
  /** Request duration (milliseconds) */
  duration:       number;
}

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

function getConfig(): IISLogConfig {
  const enabled = process.env.IIS_LOGS_ENABLED === 'true';

  if (!enabled) {
    return {
      enabled: false,
      siteId: 1,
      logPath: '',
      fields: [],
      dailyRollover: true,
    };
  }

  const siteId = parseInt(process.env.IIS_SITE_ID || '1', 10);

  let logPath = process.env.IIS_LOGS_PATH || '';
  if (!logPath) {
    logPath = `C:\\inetpub\\logs\\LogFiles\\W3SVC${siteId}`;
  }

  const defaultFields = [
    'date', 'time', 's-ip', 'cs-method', 'cs-uri-stem', 'cs-uri-query',
    's-port', 'cs-username', 'c-ip', 'cs(User-Agent)', 'sc-status',
    'sc-bytes', 'cs-bytes', 'time-taken',
  ];

  const fieldsStr = process.env.IIS_LOG_FIELDS || '';
  const fields = fieldsStr.trim() ? fieldsStr.split(/\s+/) : defaultFields;

  const dailyRollover = process.env.IIS_LOGS_DAILY_ROLLOVER !== 'false';

  return { enabled, siteId, logPath, fields, dailyRollover };
}

// ──────────────────────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────────────────────

let config = getConfig();
let currentLogFile = '';
let currentLogDate = '';

/**
 * Derives the log filename based on today's date.
 * Format: leeku_secure_YYYY-MM-DD.log
 *
 * @returns Filename (e.g. "leeku_secure_2026-06-07.log")
 */
function getLogFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `leeku_secure_${yyyy}-${mm}-${dd}.log`;
}

/**
 * Returns the full path to the log file for today.
 */
function getLogFilePath(): string {
  const filename = getLogFilename();
  return path.join(config.logPath, filename);
}

/**
 * Ensures the log directory exists.
 */
function ensureLogDirectory(): void {
  try {
    if (!fs.existsSync(config.logPath)) {
      fs.mkdirSync(config.logPath, { recursive: true });
    }
  } catch (err) {
    console.error('[iis-logger] Failed to create log directory:', err);
  }
}

/**
 * Writes the W3C Extended Log header to a new log file.
 */
function writeLogHeader(filePath: string): void {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString().split('T')[1].split('.')[0];

    const header = [
      '#Software: Leeku Secure',
      '#Version: 1.0',
      `#Date: ${dateStr} ${timeStr}`,
      `#Fields: ${config.fields.join(' ')}`,
      '',
    ].join('\r\n');

    fs.appendFile(filePath, header, 'utf-8', (err) => {
      if (err) {
        console.error('[iis-logger] Failed to append log header:', err);
      }
    });
  } catch (err) {
    console.error('[iis-logger] Failed to write log header:', err);
  }
}

/**
 * Logs an HTTP request in W3C Extended Log Format.
 * @param ctx The request context with method, status, duration, etc.
 */
export function logRequest(ctx: IISLogContext): void {
  if (!config.enabled) return;

  try {
    ensureLogDirectory();

    const logFile = getLogFilePath();
    const logDate = getLogFilename();

    // If day has changed and daily rollover is enabled, reset current log file
    if (config.dailyRollover && currentLogDate !== logDate) {
      currentLogFile = logFile;
      currentLogDate = logDate;

      // Write header if this is a new file
      if (!fs.existsSync(logFile)) {
        writeLogHeader(logFile);
      }
    }

    // Format each field according to W3C spec
    const values = config.fields.map((field) => {
      switch (field) {
        case 'date':
          return ctx.timestamp.toISOString().split('T')[0];
        case 'time':
          return ctx.timestamp.toISOString().split('T')[1].split('.')[0];
        case 's-ip':
          return 'localhost'; // server IP — we could extract from request if needed
        case 'cs-method':
          return ctx.method;
        case 'cs-uri-stem':
          return ctx.path;
        case 'cs-uri-query':
          return ctx.query || '-';
        case 's-port':
          return String(ctx.port);
        case 'cs-username':
          return ctx.username || '-';
        case 'c-ip':
          return ctx.clientIp;
        case 'cs(User-Agent)':
          return ctx.userAgent || '-';
        case 'sc-status':
          return String(ctx.statusCode);
        case 'sc-bytes':
          return String(ctx.responseBytes);
        case 'cs-bytes':
          return String(ctx.requestBytes);
        case 'time-taken':
          return String(ctx.duration);
        default:
          return '-';
      }
    });

    const logLine = values.join(' ');
    fs.appendFile(logFile, logLine + '\r\n', 'utf-8', (err) => {
      if (err) {
        console.error('[iis-logger] Failed to append request log:', err);
      }
    });
  } catch (err) {
    console.error('[iis-logger] Failed to write request log:', err);
  }
}

/**
 * Express middleware to capture request/response metrics and log to IIS format.
 * Place this BEFORE other middleware so it wraps the entire request/response cycle.
 */
export function iisLoggingMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!config.enabled) {
    return next();
  }

  const startTime = Date.now();

  // Capture original response.end to log after headers are sent
  const originalEnd = res.end;
  let responseBytes = 0;

  // Track response size by hooking write/end
  const originalWrite = res.write;
  res.write = function (...args: any[]): boolean {
    if (args[0]) {
      responseBytes += Buffer.byteLength(args[0]);
    }
    return originalWrite.apply(res, args);
  };

  res.end = function (...args: any[]): express.Response {
    if (args[0]) {
      responseBytes += Buffer.byteLength(args[0]);
    }

    // Log the request
    const duration = Date.now() - startTime;
    const clientIp = String(
      req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1'
    ).split(',')[0].trim();
    const username = (req as any).user?.username || '-';

    const userAgent = req.headers['user-agent'] || '';
    const requestBytes = req.get('content-length') ? parseInt(req.get('content-length')!, 10) : 0;

    logRequest({
      timestamp:    new Date(),
      method:       req.method,
      path:         req.path,
      query:        req.url.split('?')[1] || '',
      port:         parseInt(process.env.PORT || '3000', 10),
      username,
      clientIp,
      userAgent,
      statusCode:   res.statusCode,
      responseBytes,
      requestBytes,
      duration,
    });

    return originalEnd.apply(res, args);
  };

  next();
}

/**
 * Validates the IIS logging configuration on startup.
 */
export function validateIISLoggingConfig(): void {
  if (!config.enabled) {
    console.log('[iis-logger] IIS W3C Extended Log Format logging is disabled.');
    return;
  }

  try {
    ensureLogDirectory();
    const testFile = path.join(config.logPath, '.leeku-test');
    fs.writeFileSync(testFile, 'test', 'utf-8');
    fs.unlinkSync(testFile);
    console.log(`[iis-logger] IIS logging enabled. Path: ${config.logPath}`);
  } catch (err) {
    console.error(
      `[iis-logger] Failed to write to IIS log directory: ${config.logPath}. Error:`,
      err
    );
    console.error('[iis-logger] Disabling IIS logging.');
    config.enabled = false;
  }
}
