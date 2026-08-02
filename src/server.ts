/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Main Express Server
 * Integrates: SQL Server 2022, AES-256-GCM encryption, Bitdefender AV,
 * JWT auth, rate limiting, CORS, IIS W3C logging, file expiry cleanup.
 */

import dotenv from 'dotenv';

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import cluster from 'cluster';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import si from 'systeminformation';

import { getPool, closePool, getRequest, sql } from './server/db.js';
import {
  encryptFile, wrapKey, unwrapKey,
  encryptFileStream, decryptFileStream, computeFileChecksum,
  encryptColumn, decryptColumn, hashColumnForLookup,
  hashPassword, verifyPassword, hashSharePassword, verifySharePassword,
  hashFileSecret, verifyFileSecret, decryptClientProtectedPayload, encryptClientProtectedFileInPlace, decryptClientProtectedFileInPlace,
  generateSecureToken, validateEncryptionConfig,
} from './server/utils/encryption.js';
import { scanFileBuffer, scanFilePath, heuristicPreScan } from './server/utils/scanner.js';
import {
  detectProfilePictureMime,
  getLatestProfilePictureFile,
  getProfilePictureDirectory,
  getProfilePictureExtension,
  getProfilePictureFiles,
  resolveProfilePictureUserIdFromToken,
} from './server/utils/profile-picture.js';
import {
  startExpiryCleanup, stopExpiryCleanup,
  computeExpiresAt, isValidTtl,
  type ExpiredFileRecord,
} from './server/utils/expiry-cleanup.js';
import { sendVerificationEmail, sendAccountDeletionEmail, sendQuotaChangeRequestEmail, validateMxRecord, verifySmtpConnection } from './server/utils/email.js';
import multer from 'multer';
import os from 'os';
import { iisLoggingMiddleware, validateIISLoggingConfig } from './server/middleware/iis-logger.js';
import {
  maintenanceModeMiddleware,
  getMaintenanceStatus,
  setMaintenanceStatus,
  getUncShareAutoMaintenanceStatus,
  setUncShareAutoMaintenanceStatus,
} from './server/middleware/maintenance-mode.js';
import { createSessionRouter } from './server/routes/sessions.js';
import { createHealthRouter } from './server/routes/health.js';
import { createPublicSharingRouter } from './server/routes/public-sharing.js';
import { createPublicFolderSharingRouter } from './server/routes/public-folder-sharing.js';
import { createMaintenanceModeRouter } from './server/routes/maintenance-mode.js';
import { createDesktopUpdatesRouter, SYSTEM_UPDATE_FOLDER_NAME } from './server/routes/desktop-updates.js';
import { validateProductionConfig } from './server/utils/production.js';
import type { AdminFileFolder, Quota, User, FileMetadata, FileFolder, FolderShareLink, ShareLink, SystemLog, SystemStats } from './app/shared/types/index.js';

const runtimeDir = (() => {
  const moduleUrl = (import.meta as ImportMeta | undefined)?.url;
  if (moduleUrl) return path.dirname(fileURLToPath(moduleUrl));
  if (typeof __dirname === 'string') return __dirname;
  return process.cwd();
})();
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(runtimeDir, '../.env'),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));

if (envPath) {
  dotenv.config({ path: envPath });
  console.log(`[server] Loaded environment from: ${envPath}`);
} else {
  dotenv.config();
  console.warn('[server] No .env file found in expected locations. Falling back to process-level environment variables.');
}

// ──────────────────────────────────────────────────────────────
// Constants from environment
// ──────────────────────────────────────────────────────────────

const PORT               = parseInt(process.env.PORT || '3000', 10);
const APP_URL            = process.env.APP_URL || `http://localhost:${PORT}`;
const NODE_ENV           = process.env.NODE_ENV || 'development';
const FILE_VAULT         = process.env.FILE_STORAGE_UNC_PATH || path.join(process.cwd(), 'vault');
const UPLOAD_TEMP        = process.env.UPLOAD_TEMP_PATH || path.join(os.tmpdir(), 'leeku-uploads');
const PROFILE_PICTURE_PATH = process.env.PROFILE_PICTURE_PATH || path.join(FILE_VAULT, 'users');
const MAX_LOG_ENTRIES    = parseInt(process.env.MAX_LOG_ENTRIES || '500', 10);
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MS= parseInt(process.env.LOCKOUT_DURATION_MINUTES || '15', 10) * 60_000;
const PROXY_TRUST_HOPS   = parseInt(process.env.PROXY_TRUST_HOPS || '0', 10);
const SMTP_ENABLED       = !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASSWORD;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const JWT_EXPIRY         = parseInt(process.env.JWT_ACCESS_EXPIRY_SECONDS || '900', 10);
const REFRESH_EXPIRY     = parseInt(process.env.JWT_REFRESH_EXPIRY_SECONDS || '604800', 10);
const JWT_ISSUER         = process.env.JWT_ISSUER   || APP_URL;
const JWT_AUDIENCE       = process.env.JWT_AUDIENCE || 'leeku-secure-api';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'leeku_session';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'leeku_refresh';
const CSRF_COOKIE_NAME    = process.env.CSRF_COOKIE_NAME || 'leeku_csrf';
const HTTP_REQUEST_TIMEOUT_MS = parseNonNegativeIntEnv('HTTP_REQUEST_TIMEOUT_MS', 0);
const HTTP_HEADERS_TIMEOUT_MS = parseNonNegativeIntEnv('HTTP_HEADERS_TIMEOUT_MS', 60_000);
const HTTP_KEEP_ALIVE_TIMEOUT_MS = parseNonNegativeIntEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000);
const HTTP_SOCKET_TIMEOUT_MS = parseNonNegativeIntEnv('HTTP_SOCKET_TIMEOUT_MS', 0);
const UNC_SHARE_HEALTHCHECK_INTERVAL_MS = parseNonNegativeIntEnv('UNC_SHARE_HEALTHCHECK_INTERVAL_MS', 5 * 60_000);
const ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT =
  NODE_ENV === 'development' && process.env.ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT !== 'false';

if (!process.env.UPLOAD_TEMP_PATH) {
  console.warn(`[server] UPLOAD_TEMP_PATH is not set. Upload temp files will use fallback path: ${UPLOAD_TEMP}`);
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  console.warn(`[server] Invalid ${name}="${raw}". Using ${fallback}.`);
  return fallback;
}

function buildUniqueTempFilePath(baseDir: string, prefix: string, id: string): string {
  const unique = crypto.randomBytes(8).toString('hex');
  return path.join(baseDir, `${prefix}-${id}-${Date.now()}-${unique}.tmp`);
}

type PrivateDownloadPreparationPhase = 'decrypting' | 'verifying' | 'finalizing' | 'ready' | 'error';

interface PrivateDownloadSession {
  id: string;
  userId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  tempFile: string;
  sizeBytes: number;
  status: 'preparing' | 'ready' | 'error';
  phase: PrivateDownloadPreparationPhase;
  loaded: number;
  total: number;
  expiresAt: number;
  claimed: boolean;
  error?: string;
}

const PRIVATE_DOWNLOAD_SESSION_TTL_MS = 10 * 60_000;
const privateDownloadSessions = new Map<string, PrivateDownloadSession>();

// Track temp files from the direct download path so the sweep can clean them up
const orphanedTempFiles = new Set<string>();

function registerTempFile(tempPath: string): void {
  orphanedTempFiles.add(tempPath);
}

function unregisterTempFile(tempPath: string): void {
  orphanedTempFiles.delete(tempPath);
}

function removePrivateDownloadSession(downloadId: string): void {
  const session = privateDownloadSessions.get(downloadId);
  if (!session) return;
  privateDownloadSessions.delete(downloadId);
  unregisterTempFile(session.tempFile);
  try {
    if (fs.existsSync(session.tempFile)) fs.unlinkSync(session.tempFile);
  } catch {
    // best-effort cleanup only
  }
}

function sweepPrivateDownloadSessions(): void {
  const now = Date.now();
  for (const [id, session] of privateDownloadSessions.entries()) {
    if (now > session.expiresAt) {
      removePrivateDownloadSession(id);
    }
  }

  // Also scan the temp directory for any leeku-dl-*.tmp files older than 30 min
  if (fs.existsSync(UPLOAD_TEMP)) {
    const entries = fs.readdirSync(UPLOAD_TEMP);
    for (const entry of entries) {
      if (entry.startsWith('leeku-dl-') && entry.endsWith('.tmp')) {
        const fullPath = path.join(UPLOAD_TEMP, entry);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > 30 * 60_000) {  // older than 30 min
            fs.unlinkSync(fullPath);
            console.log(`[server] Sweep cleaned up stray temp file: ${entry}`);
          }
        } catch { /* best-effort */ }
      }
    }
  }
}

// ── Periodic sweep of expired download sessions ──
let privateDownloadSweepTimer: ReturnType<typeof setInterval> | null = null;

function startPrivateDownloadSweep(intervalMs: number = 30_000): void {
  if (privateDownloadSweepTimer) return;
  privateDownloadSweepTimer = setInterval(() => {
    sweepPrivateDownloadSessions();
  }, intervalMs);
  // Allow the timer to keep the process alive if it's the only thing running
  if (privateDownloadSweepTimer && typeof privateDownloadSweepTimer === 'object' && 'unref' in privateDownloadSweepTimer) {
    privateDownloadSweepTimer.unref();
  }
}

function stopPrivateDownloadSweep(): void {
  if (privateDownloadSweepTimer) {
    clearInterval(privateDownloadSweepTimer);
    privateDownloadSweepTimer = null;
  }
}

// ── Startup cleanup: remove any stale .tmp files left from a previous crash ──
function cleanupStaleTempFiles(tempDir: string): void {
  try {
    if (!fs.existsSync(tempDir)) return;
    const entries = fs.readdirSync(tempDir);
    for (const entry of entries) {
      if (entry.startsWith('leeku-dl-') && entry.endsWith('.tmp')) {
        const fullPath = path.join(tempDir, entry);
        try {
          fs.unlinkSync(fullPath);
          console.log(`[server] Cleaned up stale temp file: ${entry}`);
        } catch (err) {
          console.warn(`[server] Could not remove stale temp file ${entry}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('[server] Error during stale temp file cleanup:', err);
  }
}

let uncShareMonitorTimer: ReturnType<typeof setInterval> | null = null;
let uncShareMonitorRunning = false;

async function isUncShareAvailable(sharePath: string): Promise<boolean> {
  try {
    await fs.promises.access(sharePath, fs.constants.R_OK);
    await fs.promises.readdir(sharePath);
    return true;
  } catch {
    return false;
  }
}

async function evaluateUncShareHealth(): Promise<void> {
  if (!FILE_VAULT.startsWith('\\\\')) return;
  if (uncShareMonitorRunning) return;
  uncShareMonitorRunning = true;

  try {
    const shareAvailable = await isUncShareAvailable(FILE_VAULT);
    const maintenanceEnabled = await getMaintenanceStatus();
    const autoEnabled = await getUncShareAutoMaintenanceStatus();

    if (!shareAvailable) {
      if (!maintenanceEnabled) {
        await setMaintenanceStatus(true);
        await setUncShareAutoMaintenanceStatus(true);
        console.error(`[maintenance][unc-monitor] UNC share unavailable: ${FILE_VAULT}. Maintenance mode enabled.`);
      }
      return;
    }

    if (autoEnabled) {
      await setMaintenanceStatus(false);
      await setUncShareAutoMaintenanceStatus(false);
      console.log(`[maintenance][unc-monitor] UNC share restored: ${FILE_VAULT}. Maintenance mode disabled.`);
    }
  } catch (error) {
    console.error('[maintenance][unc-monitor] Health check failed:', error);
  } finally {
    uncShareMonitorRunning = false;
  }
}

function startUncShareMonitor(intervalMs: number = UNC_SHARE_HEALTHCHECK_INTERVAL_MS): void {
  if (!FILE_VAULT.startsWith('\\\\')) {
    console.log('[maintenance][unc-monitor] FILE_STORAGE_UNC_PATH is not a UNC path. Monitor disabled.');
    return;
  }
  if (uncShareMonitorTimer) return;

  void evaluateUncShareHealth();
  uncShareMonitorTimer = setInterval(() => {
    void evaluateUncShareHealth();
  }, intervalMs);
  if (uncShareMonitorTimer && typeof uncShareMonitorTimer === 'object' && 'unref' in uncShareMonitorTimer) {
    uncShareMonitorTimer.unref();
  }
  console.log(`[maintenance][unc-monitor] Started. Interval=${intervalMs}ms Path=${FILE_VAULT}`);
}

function stopUncShareMonitor(): void {
  if (!uncShareMonitorTimer) return;
  clearInterval(uncShareMonitorTimer);
  uncShareMonitorTimer = null;
}

function configureHttpServer(server: http.Server): http.Server {
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.setTimeout(HTTP_SOCKET_TIMEOUT_MS);
  console.log('[server] HTTP timeouts configured.', {
    requestTimeoutMs: server.requestTimeout,
    headersTimeoutMs: server.headersTimeout,
    keepAliveTimeoutMs: server.keepAliveTimeout,
    socketTimeoutMs: server.timeout,
  });
  return server;
}

function getJwtSecret(): string {
  const raw = process.env.COOKIE_SECRET_BASE64;
  if (!raw) throw new Error('[server] COOKIE_SECRET_BASE64 must be set in .env');
  return raw;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSessionCookieOptions(): express.CookieOptions {
  return {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: JWT_EXPIRY * 1000,
  };
}

function getRefreshCookieOptions(): express.CookieOptions {
  return {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_EXPIRY * 1000,
  };
}

function setAuthCookie(res: express.Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  res.cookie(CSRF_COOKIE_NAME, generateSecureToken(24), {
    httpOnly: false,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_EXPIRY * 1000,
  });
}

function setRefreshCookie(res: express.Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOptions());
}

function clearAuthCookie(res: express.Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
}

function getCookieValue(req: express.Request, cookieName: string): string {
  const raw = req.headers.cookie || '';
  if (!raw) return '';
  const parts = raw.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === cookieName) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return '';
}

function getOrCreateCsrfToken(req: express.Request, res: express.Response): string {
  const existing = getCookieValue(req, CSRF_COOKIE_NAME);
  if (existing) return existing;
  const token = generateSecureToken(24);
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_EXPIRY * 1000,
  });
  return token;
}

function requireCsrfForCookieSession(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.path.startsWith('/public/')) {
    next();
    return;
  }

  const sessionCookie = getCookieValue(req, SESSION_COOKIE_NAME);
  const refreshCookie = getCookieValue(req, REFRESH_COOKIE_NAME);
  if (!sessionCookie && !refreshCookie) {
    next();
    return;
  }

  const authHeader = String(req.headers['authorization'] || '');
  if (/^Bearer\s+/i.test(authHeader)) {
    next();
    return;
  }

  const csrfCookie = getCookieValue(req, CSRF_COOKIE_NAME);
  const csrfHeader = req.headers['x-csrf-token'];
  const csrfHeaderValue = Array.isArray(csrfHeader) ? csrfHeader[0] : (csrfHeader || '');
  const csrfBodyValue = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
  const provided = String(csrfHeaderValue || csrfBodyValue || '');

  if (!csrfCookie || !provided || provided !== csrfCookie) {
    res.status(403).json({ error: 'CSRF validation failed.' });
    return;
  }

  next();
}

// ──────────────────────────────────────────────────────────────
// Vault directory / UNC share mount
// ──────────────────────────────────────────────────────────────

/**
 * If STORAGE_NET_USE_PATH is set, run `net use` at startup to map
 * the UNC share with the supplied credentials. This is only needed
 * when the Windows service account cannot be pre-configured with
 * persistent credentials for the share.
 *
 * Credentials are read from env vars — never hardcoded.
 */
if (process.env.STORAGE_NET_USE_PATH) {
  const sharePath = process.env.STORAGE_NET_USE_PATH;
  const shareUser = process.env.STORAGE_NET_USE_USER;
  const sharePass = process.env.STORAGE_NET_USE_PASS;
  try {
    const args = [sharePath];
    if (sharePass) args.push(sharePass);
    if (shareUser) args.push(`/user:${shareUser}`);
    args.push('/persistent:no');
    execFileSync('net', ['use', ...args], { stdio: 'pipe' });
    console.log(`[server] UNC share mapped: ${sharePath}`);
  } catch (e: any) {
    // Already mapped or reconnected — not fatal
    const msg = (e.stderr?.toString() || e.message || '').trim();
    if (/already been used|multiple connections/i.test(msg)) {
      console.log(`[server] UNC share already mapped: ${sharePath}`);
    } else {
      console.error(`[server] Failed to map UNC share "${sharePath}": ${msg}`);
    }
  }
}

if (!FILE_VAULT.startsWith('\\\\') && !fs.existsSync(FILE_VAULT)) {
  fs.mkdirSync(FILE_VAULT, { recursive: true });
  console.log(`[server] Created local vault directory: ${FILE_VAULT}`);
}

if (!fs.existsSync(PROFILE_PICTURE_PATH)) {
  fs.mkdirSync(PROFILE_PICTURE_PATH, { recursive: true });
  console.log(`[server] Created profile picture directory: ${PROFILE_PICTURE_PATH}`);
}

// Profile picture helpers are provided by the shared utility module.

// ──────────────────────────────────────────────────────────────
// Gemini AI (optional)
// ──────────────────────────────────────────────────────────────

let genai: GoogleGenAI | null = null;
if (GEMINI_API_KEY && GEMINI_API_KEY !== 'CHANGE_ME') {
  genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  console.log('[server] Gemini AI enabled for leeku_vibe messages.');
}

async function generateLeekuVibe(filename: string, clean: boolean): Promise<string> {
  const fallbacks = clean
    ? [
        'Security scan completed. No threats were detected.',
        'File verified and ready to use.',
        'Upload completed and passed the security scan.',
        'No malicious content was detected.',
      ]
    : [
        'Upload blocked because the security scan detected a potential threat.',
        'File rejected due to suspicious content.',
        'Security scan failed. Upload denied.',
      ];

  if (!genai) {
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  try {
    const prompt = clean
      ? `Write a concise professional status message, at most 80 characters, confirming that "${filename}" passed its security scan.`
      : `Write a concise professional status message, at most 80 characters, explaining that "${filename}" was blocked by its security scan.`;

    const result = await genai.models.generateContent({ model: 'gemini-2.0-flash', contents: prompt });
    const text = result.text?.trim();
    return text || fallbacks[0];
  } catch {
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

// ──────────────────────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────────────────────

const app = express();

// ── Worker-affinity cookie for prepared-download stickiness ──
const CLUSTER_ENABLED = process.env.CLUSTER_ENABLED !== 'false';
if (CLUSTER_ENABLED && cluster.isWorker) {
  app.use((req, res, next) => {
    // Set a cookie on /prepare responses so the next /status and /file calls
    // hint the load balancer. With cluster round-robin, this is best-effort.
    // For production, pair with a reverse proxy that supports sticky sessions.
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (req.path.includes('/download/prepare') && res.statusCode === 202) {
        res.cookie('worker_id', String(cluster.worker!.id), {
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/files',
          maxAge: 15 * 60 * 1000, // 15 minutes
        });
      }
      return originalJson(body);
    } as typeof res.json;
    next();
  });
}

if (PROXY_TRUST_HOPS > 0) app.set('trust proxy', PROXY_TRUST_HOPS);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || APP_URL)
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

validateIISLoggingConfig();
app.use(iisLoggingMiddleware);

// JSON body limit — only used for auth/profile/share endpoints now.
// Uploads go through multipart/form-data (streaming, no memory limits).
// Default: 1 MB is plenty for auth/profile/share JSON payloads.
const uploadBodyLimitMb = parseInt(process.env.MAX_UPLOAD_BODY_MB || '1', 10);
app.use(express.json({ limit: `${uploadBodyLimitMb}mb` }));
app.use(express.urlencoded({ limit: `${uploadBodyLimitMb}mb`, extended: true }));
app.use('/api', requireCsrfForCookieSession);

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_RPM || '20', 10),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait before trying again.' },
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_RATE_LIMIT_RPM || '120', 10),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' },
});

// Upload endpoint gets a much higher limit (300 RPM) so chunked uploads
// don't hit the general API limit. The GET check and POST per chunk
// each count — for a 10 GB file that's ~200 requests.
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 800,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' },
});

app.use('/api/auth', authLimiter);
// Apply general limiter to all /api routes EXCEPT /api/files/upload
app.use('/api', (req, res, next) => {
  if (
    req.path === '/files/upload' || 
    req.path === '/files/upload/' ||
    req.path.startsWith('/public/share')
  ) {
    next();
  } else {
    apiLimiter(req, res, next);
  }
});
// Apply the higher limit just to the upload endpoint
app.use('/api/files/upload', uploadLimiter);

// ──────────────────────────────────────────────────────────────
// JWT helpers
// ──────────────────────────────────────────────────────────────

interface JwtPayload { sub: string; role: string; }

function signToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role } as JwtPayload,
    getJwtSecret(),
    { expiresIn: JWT_EXPIRY, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret(), {
      issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
    }) as JwtPayload;
  } catch { return null; }
}

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getRequestIp(req: express.Request): string {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
    .split(',')[0].trim().substring(0, 45);
}

async function issueRefreshSession(
  userId: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const token = generateSecureToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY * 1000);
  const request = await getRequest();
  request.input('uid', sql.UniqueIdentifier, userId);
  request.input('hash', sql.Char(64), hashRefreshToken(token));
  request.input('exp', sql.DateTimeOffset, expiresAt);
  request.input('ip', sql.NVarChar(45), getRequestIp(req));
  request.input('ua', sql.NVarChar(500), String(req.headers['user-agent'] || '').substring(0, 500) || null);
  await request.query(
    `DELETE FROM refresh_tokens
     WHERE user_id=@uid AND (expires_at<=SYSDATETIMEOFFSET() OR revoked_at<DATEADD(day,-1,SYSDATETIMEOFFSET()));`
  );
  await request.query(
    `INSERT INTO refresh_tokens (id,user_id,token_hash,expires_at,created_at,revoked_at,ip_address,user_agent)
      VALUES (gen_random_uuid(),@uid,@hash,@exp,SYSDATETIMEOFFSET(),NULL,@ip,@ua)`
  );
  setRefreshCookie(res, token);
}

async function revokeRefreshSession(token: string): Promise<void> {
  if (!token) return;
  const request = await getRequest();
  request.input('hash', sql.Char(64), hashRefreshToken(token));
  await request.query(
    `UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,SYSDATETIMEOFFSET()) WHERE token_hash=@hash`
  );
}

async function revokeAllRefreshSessions(userId: string): Promise<void> {
  const request = await getRequest();
  request.input('uid', sql.UniqueIdentifier, userId);
  await request.query(
    `UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,SYSDATETIMEOFFSET())
     WHERE user_id=@uid`
  );
}

async function rotateRefreshSession(
  req: express.Request,
  res: express.Response,
): Promise<{ user: User; accessToken: string } | null> {
  const token = getCookieValue(req, REFRESH_COOKIE_NAME);
  if (!token) return null;

  const request = await getRequest();
  request.input('hash', sql.Char(64), hashRefreshToken(token));
  const result = await request.query<UserRow>(
    `SELECT u.id,u.email_encrypted,u.email_iv,u.email_auth_tag,
            u.username_encrypted,u.username_iv,u.username_auth_tag,
            u.role,u.quota_id,u.storage_used_bytes,u.status,u.created_at,
            u.failed_login_count,u.locked_until
     FROM refresh_tokens rt
     JOIN users u ON u.id=rt.user_id
     WHERE rt.token_hash=@hash AND rt.revoked_at IS NULL
       AND rt.expires_at>SYSDATETIMEOFFSET() AND u.status='Active'`
  );
  if (!result.recordset.length) {
    return null;
  }

  await revokeRefreshSession(token);
  const user = mapUserRow(result.recordset[0]);
  const accessToken = signToken(user.id, user.role);
  setAuthCookie(res, accessToken);
  await issueRefreshSession(user.id, req, res);
  return { user, accessToken };
}

// ──────────────────────────────────────────────────────────────
// SQL row type interfaces
// ──────────────────────────────────────────────────────────────

interface UserRow {
  id: string; email_encrypted: Buffer; email_iv: Buffer; email_auth_tag: Buffer;
  username_encrypted: Buffer; username_iv: Buffer; username_auth_tag: Buffer;
  role: string; quota_id: string; storage_used_bytes: number; status: string;
  created_at: Date; failed_login_count: number; locked_until: Date | null;
  password_hash?: string;
  email_verified?: boolean;
  email_verification_token?: string | null;
  email_verification_expires?: Date | null;
  deletion_token?: string | null;
  deletion_token_expires?: Date | null;
}

interface FileRow {
  id: string; owner_user_id: string;
  folder_id?: string | null; folder_name?: string | null;
  original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
  stored_path: string; mime_type: string; size_bytes: number; encrypted_size_bytes: number;
  status: string; checksum_sha256: string; scan_result: string | null; scan_message: string | null;
  is_encrypted: boolean; leeku_vibe: string | null; ttl_hours: number | null;
  client_secret_hash?: string | null;
  client_crypto_salt?: Buffer | null;
  client_crypto_iv?: Buffer | null;
  client_crypto_iterations?: number | null;
  expires_at: Date | null; created_at: Date;
}

interface FolderRow {
  id: string; owner_user_id: string; parent_folder_id?: string | null; name: string; file_count?: number;
  created_at: Date; updated_at: Date;
}

interface AdminFolderRow extends FolderRow {
  username_encrypted: Buffer;
  username_iv: Buffer;
  username_auth_tag: Buffer;
}

interface ShareRow {
  id: string; file_id: string; public_token: string; password_hash: string | null;
  expires_at: Date | null; max_downloads: number | null; download_count: number;
  is_active: boolean; allow_external_preview: boolean; created_at: Date;
}

interface FolderShareRow {
  id: string; folder_id: string; public_token: string; password_hash: string | null;
  expires_at: Date | null; is_active: boolean; created_at: Date;
}

interface LogRow {
  id: string | number; user_id: string | null; username_snapshot: string | null;
  event_type: string; target_type: string; target_id: string;
  ip_address: string; message: string; created_at: Date;
}

// ──────────────────────────────────────────────────────────────
// Row mappers
// ──────────────────────────────────────────────────────────────

function mapUserRow(row: UserRow): User {
  return {
    id:           row.id,
    email:        decryptColumn(row.email_encrypted, row.email_iv, row.email_auth_tag),
    username:     decryptColumn(row.username_encrypted, row.username_iv, row.username_auth_tag),
    role:         row.role as 'User' | 'Admin',
    quota_id:     row.quota_id,
    storage_used: Number(row.storage_used_bytes),
    status:       row.status as 'Active' | 'Suspended',
    created_at:   row.created_at.toISOString(),
  };
}

function mapFileRow(row: FileRow, ownerUsername: string): FileMetadata {
  return {
    id:             row.id,
    owner_user_id:  row.owner_user_id,
    username:       ownerUsername,
    folder_id:      row.folder_id || null,
    folder_name:    row.folder_name || null,
    original_name:  decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag),
    stored_name:    row.stored_path,
    mime_type:      row.mime_type,
    size:           Number(row.size_bytes),
    has_user_secret: !!row.client_secret_hash,
    encrypted_size: Number(row.encrypted_size_bytes),
    status:         row.status as 'Available' | 'Blocked',
    checksum:       row.checksum_sha256,
    leeku_vibe:     row.leeku_vibe || '',
    is_encrypted:   row.is_encrypted,
    created_at:     row.created_at.toISOString(),
  };
}

function mapFolderRow(row: FolderRow): FileFolder {
  return {
    id:            row.id,
    owner_user_id: row.owner_user_id,
    parent_folder_id: row.parent_folder_id || null,
    name:          row.name,
    file_count:    Number(row.file_count || 0),
    created_at:    row.created_at.toISOString(),
    updated_at:    row.updated_at.toISOString(),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOLDER_DEPTH = 5;

function normalizeFolderName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateFolderName(value: unknown): string | null {
  const name = normalizeFolderName(value);
  if (name.length < 1 || name.length > 120) return null;
  return name;
}

function normalizeNullableFolderId(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  if (value === null || value === '') return null;
  const folderId = String(value).trim();
  if (!folderId) return null;
  return UUID_PATTERN.test(folderId) ? folderId : undefined;
}

function isDuplicateKeyError(err: any): boolean {
  return err?.number === 2601 || err?.number === 2627 || err?.code === '23505';
}

function isAllowedDesktopUpdateFileName(fileName: string, version: string): boolean {
  const windows = `Leeku-Desktop-Setup-${version}.exe`;
  return new Set([
    'latest.yml',
    'latest-linux.yml',
    `${windows}.zip`,
    `${windows}.blockmap`,
    `leeku-desktop-${version}-x86_64.AppImage`,
  ]).has(fileName) || /^leeku-activation--(draft|active|scheduled)--\d+--\d+\.json$/.test(fileName);
}

async function isDesktopUpdateFile(fileId: string): Promise<boolean> {
  const request = await getRequest();
  request.input('fileId', sql.UniqueIdentifier, fileId);
  request.input('systemFolderName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
  const result = await request.query<{ id: string }>(
    `SELECT f.id
     FROM files f
     INNER JOIN file_folders release_folder ON release_folder.id=f.folder_id
     INNER JOIN file_folders update_root ON update_root.id=release_folder.parent_folder_id
     WHERE f.id=@fileId
       AND update_root.parent_folder_id IS NULL
       AND update_root.name=@systemFolderName
     LIMIT 1`
  );
  return result.recordset.length > 0;
}

async function desktopUpdateFolderActivation(
  folderId: string,
  ownerId: string,
): Promise<'draft' | 'active' | 'scheduled' | null> {
  const request = await getRequest();
  request.input('folderId', sql.UniqueIdentifier, folderId);
  request.input('ownerId', sql.UniqueIdentifier, ownerId);
  const result = await request.query<{
    original_name_encrypted: Buffer;
    original_name_iv: Buffer;
    original_name_auth_tag: Buffer;
  }>(
    `SELECT original_name_encrypted, original_name_iv, original_name_auth_tag
     FROM files
     WHERE folder_id=@folderId AND owner_user_id=@ownerId
       AND COALESCE(status,'Available')!='Expired'`
  );
  let latest: { mode: 'draft' | 'active' | 'scheduled'; createdAt: number } | null = null;
  for (const row of result.recordset) {
    try {
      const fileName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      const match = /^leeku-activation--(draft|active|scheduled)--\d+--(\d+)\.json$/.exec(fileName);
      if (!match) continue;
      const createdAt = Number(match[2]);
      if (!Number.isFinite(createdAt)) continue;
      if (!latest || createdAt > latest.createdAt) {
        latest = { mode: match[1] as 'draft' | 'active' | 'scheduled', createdAt };
      }
    } catch {
      // Ignore unrelated or unreadable metadata. A folder without a marker is
      // treated as an incomplete draft so an administrator can clean it up.
    }
  }
  return latest?.mode ?? null;
}

async function getOwnedFolder(folderId: string, ownerId: string): Promise<FolderRow | null> {
  const request = await getRequest();
  request.input('id', sql.UniqueIdentifier, folderId);
  request.input('ownerId', sql.UniqueIdentifier, ownerId);
  const result = await request.query<FolderRow>(
    `SELECT id, owner_user_id, parent_folder_id, name, created_at, updated_at
     FROM file_folders
     WHERE id=@id AND owner_user_id=@ownerId`
  );
  return result.recordset[0] || null;
}

async function getFolderPath(folderId: string, ownerId: string): Promise<string> {
  const request = await getRequest();
  request.input('id', sql.UniqueIdentifier, folderId);
  request.input('ownerId', sql.UniqueIdentifier, ownerId);
  request.input('maxDepth', sql.Int, MAX_FOLDER_DEPTH);
  const result = await request.query<{ name: string; depth: number }>(
    `WITH RECURSIVE folder_chain AS (
       SELECT id, owner_user_id, parent_folder_id, name, 1 AS depth
       FROM file_folders
       WHERE id=@id AND owner_user_id=@ownerId
       UNION ALL
       SELECT parent.id, parent.owner_user_id, parent.parent_folder_id, parent.name, child.depth + 1
       FROM file_folders parent
       INNER JOIN folder_chain child ON child.parent_folder_id=parent.id
       WHERE parent.owner_user_id=@ownerId AND child.depth<@maxDepth
     )
     SELECT name, depth
     FROM folder_chain
     ORDER BY depth DESC`
  );
  return result.recordset.map((row) => row.name).join(' / ');
}

async function findExistingFolderConflict(
  ownerId: string,
  parentFolderId: string | null,
  name: string,
): Promise<{ folder: FolderRow; path: string; hiddenBySystemFilter: boolean } | null> {
  const sameScopeRequest = await getRequest();
  sameScopeRequest.input('ownerId', sql.UniqueIdentifier, ownerId);
  sameScopeRequest.input('parentFolderId', sql.UniqueIdentifier, parentFolderId);
  sameScopeRequest.input('name', sql.NVarChar(120), name);
  const sameScope = await sameScopeRequest.query<FolderRow>(
    `SELECT id, owner_user_id, parent_folder_id, name,
            (SELECT COUNT(*) FROM files WHERE folder_id=file_folders.id AND COALESCE(status,'Available')!='Expired') AS file_count,
            created_at, updated_at
     FROM file_folders
     WHERE owner_user_id=@ownerId
       AND ((@parentFolderId IS NULL AND parent_folder_id IS NULL) OR parent_folder_id=@parentFolderId)
       AND name=@name
     ORDER BY updated_at DESC
     LIMIT 1`
  );

  const legacyScopeRequest = await getRequest();
  legacyScopeRequest.input('ownerId', sql.UniqueIdentifier, ownerId);
  legacyScopeRequest.input('name', sql.NVarChar(120), name);
  const legacyScope = await legacyScopeRequest.query<FolderRow>(
    `SELECT id, owner_user_id, parent_folder_id, name,
            (SELECT COUNT(*) FROM files WHERE folder_id=file_folders.id AND COALESCE(status,'Available')!='Expired') AS file_count,
            created_at, updated_at
     FROM file_folders
     WHERE owner_user_id=@ownerId
       AND name=@name
     ORDER BY updated_at DESC
     LIMIT 1
    `
  );

  const folder = sameScope.recordset[0] || legacyScope.recordset[0];
  if (!folder) return null;

  const parent = folder.parent_folder_id ? await getOwnedFolder(folder.parent_folder_id, ownerId) : null;
  const hiddenBySystemFilter =
    (folder.parent_folder_id === null && folder.name === SYSTEM_UPDATE_FOLDER_NAME) ||
    (parent?.name === SYSTEM_UPDATE_FOLDER_NAME && parent.parent_folder_id === null);
  const path = await getFolderPath(folder.id, ownerId);
  return { folder, path, hiddenBySystemFilter };
}

async function getFolderDepth(folderId: string, ownerId: string): Promise<number> {
  const request = await getRequest();
  request.input('id', sql.UniqueIdentifier, folderId);
  request.input('ownerId', sql.UniqueIdentifier, ownerId);
  request.input('maxDepth', sql.Int, MAX_FOLDER_DEPTH);
  const result = await request.query<{ depth: number }>(
    `WITH RECURSIVE folder_tree AS (
       SELECT id, parent_folder_id, 1 AS depth
       FROM file_folders
       WHERE id=@id AND owner_user_id=@ownerId
       UNION ALL
       SELECT ff.id, ff.parent_folder_id, ft.depth + 1 AS depth
       FROM file_folders ff
       INNER JOIN folder_tree ft ON ff.id=ft.parent_folder_id
       WHERE ff.owner_user_id=@ownerId AND ft.depth<@maxDepth
     )
     SELECT depth FROM folder_tree ORDER BY depth DESC LIMIT 1`
  );
  return Number(result.recordset[0]?.depth || 0);
}

function mapShareRow(row: ShareRow): ShareLink {
  return {
    id:             row.id,
    file_id:        row.file_id,
    public_token:   row.public_token,
    allow_external_preview: !!row.allow_external_preview,
    password:       row.password_hash ? '[protected]' : undefined,
    expires_at:     row.expires_at ? row.expires_at.toISOString() : null,
    max_downloads:  row.max_downloads,
    download_count: row.download_count,
    is_active:      row.is_active,
    created_at:     row.created_at.toISOString(),
  };
}

function mapLogRow(row: LogRow): SystemLog {
  return {
    id:          String(row.id),
    user_id:     row.user_id,
    username:    row.username_snapshot,
    event_type:  row.event_type as SystemLog['event_type'],
    target_type: row.target_type,
    target_id:   row.target_id,
    ip_address:  row.ip_address,
    message:     row.message,
    created_at:  row.created_at.toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// Auth middleware
// ──────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends express.Request {
  user?: User;
  userId?: string;
  authToken?: string;
}

async function authenticateUser(
  req: AuthenticatedRequest, res: express.Response, next: express.NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  const altHeaderToken = req.headers['x-leek-token'] ? String(req.headers['x-leek-token']).trim() : '';
  const cookieToken = getCookieValue(req, SESSION_COOKIE_NAME);

  const candidates = [bearerToken, altHeaderToken, cookieToken].filter(Boolean);
  if (!candidates.length) {
    res.status(401).json({ error: 'Auth credentials missing. Please log in first.' });
    return;
  }

  let payload: JwtPayload | null = null;
  let selectedToken = '';
  for (const t of candidates) {
    const decoded = verifyToken(t);
    if (decoded) {
      payload = decoded;
      selectedToken = t;
      break;
    }
  }

  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token.' });
    return;
  }

  try {
    const request = await getRequest();
    request.input('id', sql.UniqueIdentifier, payload.sub);
    const result = await request.query<UserRow>(
      `SELECT id, email_encrypted, email_iv, email_auth_tag,
              username_encrypted, username_iv, username_auth_tag,
              role, quota_id, storage_used_bytes, status, created_at,
              failed_login_count, locked_until
       FROM users WHERE id = @id AND status = 'Active'`
    );
    if (!result.recordset.length) { res.status(401).json({ error: 'Account not found or suspended.' }); return; }
    req.user   = mapUserRow(result.recordset[0]);
    req.userId = payload.sub;
    req.authToken = selectedToken;
    next();
  } catch (err) {
    console.error('[auth] DB error:', err);
    res.status(500).json({ error: 'Authentication service unavailable.' });
  }
}

function verifyAdmin(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction): void {
  if (req.user?.role !== 'Admin') {
    res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    return;
  }
  next();
}

// ──────────────────────────────────────────────────────────────
// System log helper
// ──────────────────────────────────────────────────────────────

async function logSystemEvent(
  userId: string | null, username: string | null,
  eventType: SystemLog['event_type'], targetType: string, targetId: string,
  req: express.Request, message: string
): Promise<void> {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
    .split(',')[0].trim();
  try {
    const request = await getRequest();
    request.input('userId',    sql.UniqueIdentifier,    userId);
    request.input('username',  sql.NVarChar(200),       username || 'System');
    request.input('eventType', sql.NVarChar(20),        eventType);
    request.input('targetType',sql.NVarChar(50),        targetType);
    request.input('targetId',  sql.NVarChar(100),       targetId.substring(0, 100));
    request.input('ip',        sql.NVarChar(45),        ip);
    request.input('message',   sql.NVarChar(sql.MAX),   message);
    await request.query(
      `INSERT INTO system_logs (user_id, username_snapshot, event_type, target_type, target_id, ip_address, message)
       VALUES (@userId, @username, @eventType, @targetType, @targetId, @ip, @message)`
    );
  } catch (err) { console.error('[logSystemEvent]', err); }
}

// ──────────────────────────────────────────────────────────────
// API: Quotas & Stats
// ──────────────────────────────────────────────────────────────

app.get('/api/quotas', async (req, res) => {
  try {
    const request = await getRequest();
    const result = await request.query<Quota>(
      'SELECT id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes FROM quotas ORDER BY storage_limit_bytes'
    );
    res.json({ quotas: result.recordset.map(q => ({
      ...q,
      storage_limit_bytes: Number(q.storage_limit_bytes),
      max_file_size_bytes: Number(q.max_file_size_bytes),
      daily_upload_limit_bytes: Number(q.daily_upload_limit_bytes),
    })) });
  } catch (err) { console.error('[GET /api/quotas]', err); res.status(500).json({ error: 'Failed to load quotas.' }); }
});

app.get('/api/stats', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req, res) => {
  try {
    const r1 = await getRequest();
    const stats = await r1.query<{ totalUsers: number; totalFiles: number; storageUsedBytes: number; uploadsToday: number; blockedFiles: number }>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE status='Active')                                   AS totalUsers,
         (SELECT COUNT(*) FROM files  WHERE status='Available')                               AS totalFiles,
         (SELECT ISNULL(SUM(storage_used_bytes),0) FROM users WHERE status='Active')          AS storageUsedBytes,
         (SELECT COUNT(*) FROM files  WHERE CAST(created_at AS DATE)=CAST(GETDATE() AS DATE)) AS uploadsToday,
         (SELECT COUNT(*) FROM files  WHERE status='Blocked')                                 AS blockedFiles`
    );
    const r2 = await getRequest();
    const fscans = await r2.query<{ failedScans: number }>(
      "SELECT COUNT(*) AS failedScans FROM system_logs WHERE event_type='Scan' AND message LIKE '%Blocked%'"
    );
    const s = stats.recordset[0];
    // Get real Windows Server system stats
    const [cpuData, memData, diskData] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.fsSize().catch(() => null),
    ]);
    let uptimeSeconds = 0;
    try {
      uptimeSeconds = Math.round(si.time().uptime || 0);
    } catch {}

    const systemStats: SystemStats = {
      ...s,
      failedScans: fscans.recordset[0]?.failedScans || 0,
      cpuUsagePercent: cpuData?.currentLoad || 0,
      memoryUsagePercent: memData ? Math.round((memData.used / memData.total) * 100) : 0,
      memoryUsedMB: memData ? Math.round(memData.used / 1024 / 1024) : 0,
      memoryTotalMB: memData ? Math.round(memData.total / 1024 / 1024) : 0,
      diskUsagePercent: diskData && diskData[0] ? Math.round(((diskData[0].used || 0) / (diskData[0].size || 1)) * 100) : 0,
      diskUsedGB: diskData && diskData[0] ? Math.round((diskData[0].used || 0) / 1024 / 1024 / 1024) : 0,
      diskTotalGB: diskData && diskData[0] ? Math.round((diskData[0].size || 0) / 1024 / 1024 / 1024) : 0,
      uptime: uptimeSeconds,
    };
    res.json(systemStats);
  } catch (err) { console.error('[GET /api/stats]', err); res.status(500).json({ error: 'Failed to compute stats.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Auth — Register
// ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are strictly required!' });

  const emailLower   = email.toLowerCase().trim();
  const usernameTrim = username.trim();
  const emailHash    = hashColumnForLookup(emailLower);
  const usernameHash = hashColumnForLookup(usernameTrim.toLowerCase());

  try {
    // 1. MX record validation
    const mxCheck = await validateMxRecord(emailLower);
    if (!mxCheck.valid) {
      return res.status(400).json({ error: mxCheck.reason || 'Invalid email domain.' });
    }

    // 2. Duplicate check
    const dupReq = await getRequest();
    dupReq.input('eH', sql.Char(64), emailHash);
    dupReq.input('uH', sql.Char(64), usernameHash);
    const dup = await dupReq.query<{ eE: number; uE: number }>(
      `SELECT (SELECT COUNT(*) FROM users WHERE email_hash=@eH)    AS eE,
              (SELECT COUNT(*) FROM users WHERE username_hash=@uH) AS uE`
    );
    if (dup.recordset[0].eE > 0) return res.status(400).json({ error: 'Email already registered!' });
    if (dup.recordset[0].uE > 0) return res.status(400).json({ error: 'Username already taken!' });

    // 3. Generate verification token (if SMTP enabled)
    let verificationToken: string | null = null;
    let verificationExpires: Date | null = null;
    if (SMTP_ENABLED) {
      verificationToken = generateSecureToken(32); // 64-char hex
      verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    }

    // 4. Encrypt & hash
    const encEmail    = encryptColumn(emailLower);
    const encUsername = encryptColumn(usernameTrim);
    const pwHash      = await hashPassword(password);

    // 5. Insert user
    const insReq = await getRequest();
    insReq.input('eEnc',  sql.VarBinary(512),  encEmail.ciphertext);
    insReq.input('eIv',   sql.VarBinary(16),   encEmail.iv);
    insReq.input('eTag',  sql.VarBinary(16),   encEmail.authTag);
    insReq.input('eHash', sql.Char(64),         emailHash);
    insReq.input('uEnc',  sql.VarBinary(512),  encUsername.ciphertext);
    insReq.input('uIv',   sql.VarBinary(16),   encUsername.iv);
    insReq.input('uTag',  sql.VarBinary(16),   encUsername.authTag);
    insReq.input('uHash', sql.Char(64),         usernameHash);
    insReq.input('pw',    sql.NVarChar(512),    pwHash);
    insReq.input('quota', sql.NVarChar(50),     'guest');
    insReq.input('vTok',  sql.Char(64),         verificationToken);
    insReq.input('vExp',  sql.DateTimeOffset,   verificationExpires);
    insReq.input('vOk',   sql.Bit,              SMTP_ENABLED ? 0 : 1);

    const newUser = await insReq.query<UserRow>(
      `INSERT INTO users (
         email_encrypted, email_iv, email_auth_tag, email_hash,
         username_encrypted, username_iv, username_auth_tag, username_hash,
         password_hash, quota_id, email_verified, email_verification_token, email_verification_expires
       )
      VALUES (@eEnc,@eIv,@eTag,@eHash, @uEnc,@uIv,@uTag,@uHash, @pw, @quota, @vOk, @vTok, @vExp)
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until,
        email_verified,email_verification_token,email_verification_expires`
    );

    const row = newUser.recordset[0];
    const user  = mapUserRow(row);

    // 6. Send verification email (async — don't block response)
    if (SMTP_ENABLED && verificationToken) {
      sendVerificationEmail(emailLower, usernameTrim, verificationToken)
        .catch(e => console.error('[email] Failed to send verification:', e.message));
    }

    await logSystemEvent(user.id, user.username, 'Auth', 'User', user.id, req,
      `Registered: ${emailLower}${SMTP_ENABLED ? ' (verification email sent)' : ' (email verification disabled)'}`);

    if (SMTP_ENABLED) {
      // Don't log them in yet — they need to verify email first
      res.json({ success: true, message: 'Account created! Check your email for a verification link.' });
    } else {
      // Dev mode — auto-verified, log them in
      const token = signToken(user.id, user.role);
      setAuthCookie(res, token);
      await issueRefreshSession(user.id, req, res);
      res.json({ user });
    }
  } catch (err) { console.error('[POST /api/auth/register]', err); res.status(500).json({ error: 'Registration failed.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Auth — Verify Email
// ──────────────────────────────────────────────────────────────

app.get('/api/auth/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).send(renderVerificationPage(false, 'Missing verification token.'));
  }

  try {
    const request = await getRequest();
    request.input('tok', sql.Char(64), token);
    const result = await request.query<{ id: string; email_verified: boolean; email_verification_expires: Date | null }>(
      `SELECT id, email_verified, email_verification_expires
       FROM users WHERE email_verification_token = @tok`
    );

    if (!result.recordset.length) {
      return res.status(400).send(renderVerificationPage(false, 'Invalid or expired verification token.'));
    }

    const row = result.recordset[0];

    if (row.email_verified) {
      return res.send(renderVerificationPage(true, 'Your email is already verified. You can now log in.'));
    }

    if (row.email_verification_expires && new Date(row.email_verification_expires) < new Date()) {
      return res.status(400).send(renderVerificationPage(false, 'Verification token has expired. Please register again.'));
    }

    // Mark as verified
    const upReq = await getRequest();
    upReq.input('id', sql.UniqueIdentifier, row.id);
    await upReq.query(
      `UPDATE users SET email_verified=TRUE, email_verification_token=NULL, email_verification_expires=NULL WHERE id=@id`
    );

    await logSystemEvent(row.id, null, 'Auth', 'User', row.id, req, 'Email verified successfully.');
    res.send(renderVerificationPage(true, 'Email verified! You can now log in to your account.'));
  } catch (err) {
    console.error('[GET /api/auth/verify-email]', err);
    res.status(500).send(renderVerificationPage(false, 'Verification failed due to a server error.'));
  }
});

/**
 * Renders a simple HTML page for the email verification result.
 */
function renderVerificationPage(success: boolean, message: string): string {
  const color = success ? '#00F2FF' : '#FF007F';
  const title = success ? 'VERIFICATION SUCCESSFUL' : 'VERIFICATION FAILED';
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeAppUrl = escapeHtml(APP_URL);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Leeku Secure — Email Verification</title>
<style>body{background:#0A0E14;color:#ccc;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:480px;padding:40px;border:3px solid ${color};text-align:center;background:#0F1419}
h1{color:${color};font-size:20px;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px}
p{font-size:13px;line-height:1.6;margin:0 0 24px}
a{display:inline-block;background:#FF007F;color:#fff;padding:12px 28px;font-weight:900;text-transform:uppercase;text-decoration:none;font-size:12px;border:2px solid #00F2FF}
</style></head>
<body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="${safeAppUrl}">GO TO LOGIN</a></div></body></html>`;
}

// ──────────────────────────────────────────────────────────────
// API: Auth — Login
// ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password)
    return res.status(400).json({ error: 'Please enter both login (email or username) and password!' });

  // Determine if login is an email (contains @) or username
  const isEmail = login.includes('@');
  const lookupHash = hashColumnForLookup(login.trim().toLowerCase());
  const lookupField = isEmail ? 'email_hash' : 'username_hash';

  try {
    const request = await getRequest();
    request.input('h', sql.Char(64), lookupHash);
    const result = await request.query<UserRow>(
      `SELECT id, email_encrypted, email_iv, email_auth_tag,
              username_encrypted, username_iv, username_auth_tag,
              password_hash, role, quota_id, storage_used_bytes,
              status, created_at, failed_login_count, locked_until,
              email_verified, email_verification_token, email_verification_expires
       FROM users WHERE ${lookupField} = @h`
    );

    if (!result.recordset.length)
      return res.status(400).json({ error: 'Invalid login or password combination.' });

    const row = result.recordset[0];

    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60_000);
      return res.status(429).json({ error: `Account locked. Try again in ${remaining} minute(s).` });
    }
    if (row.status === 'Suspended')
      return res.status(403).json({ error: 'Account suspended. Contact an administrator.' });

    // Email verification check — only enforced when SMTP is enabled
    if (SMTP_ENABLED && !row.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before logging in. Check your inbox for the verification link.' });
    }

    const valid = await verifyPassword(password, row.password_hash!);
    if (!valid) {
      const newCount = (row.failed_login_count || 0) + 1;
      const lockUntil = newCount >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
      const upReq = await getRequest();
      upReq.input('id', sql.UniqueIdentifier, row.id);
      upReq.input('c',  sql.Int, newCount);
      upReq.input('lu', sql.DateTimeOffset, lockUntil);
      await upReq.query('UPDATE users SET failed_login_count=@c, locked_until=@lu WHERE id=@id');
      if (lockUntil) await logSystemEvent(row.id, null, 'Security', 'User', row.id, req, `Account locked after ${newCount} failed attempts.`);
      return res.status(400).json({ error: 'Invalid login or password combination.' });
    }

    const resetReq = await getRequest();
    resetReq.input('id', sql.UniqueIdentifier, row.id);
    await resetReq.query('UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=SYSDATETIMEOFFSET() WHERE id=@id');

    const user  = mapUserRow(row);
    const token = signToken(user.id, user.role);
    setAuthCookie(res, token);
    await issueRefreshSession(user.id, req, res);
    await logSystemEvent(user.id, user.username, 'Auth', 'User', user.id, req, 'User logged in.');
    res.json({ user });
  } catch (err) { console.error('[POST /api/auth/login]', err); res.status(500).json({ error: 'Login service unavailable.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Auth — Me & Update
// ──────────────────────────────────────────────────────────────

app.get('/api/auth/me', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const csrfToken = getOrCreateCsrfToken(req, res);
  res.json({ user: req.user, csrfToken });
});

app.get('/api/auth/csrf', (req, res) => {
  const csrfToken = getOrCreateCsrfToken(req, res);
  res.json({ csrfToken });
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const session = await rotateRefreshSession(req, res);
    if (!session) return res.status(401).json({ error: 'Refresh session expired. Please log in again.' });
    const csrfToken = getOrCreateCsrfToken(req, res);
    res.json({ user: session.user, csrfToken });
  } catch (err) {
    console.error('[POST /api/auth/refresh]', err);
    res.status(500).json({ error: 'Session refresh unavailable.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    await revokeRefreshSession(getCookieValue(req, REFRESH_COOKIE_NAME));
  } catch (err) {
    console.error('[POST /api/auth/logout] Failed to revoke refresh session:', err);
  } finally {
    clearAuthCookie(res);
  }
  res.json({ success: true });
});

const sessionRouteOptions = {
  authenticate: authenticateUser as express.RequestHandler,
  getCurrentRefreshTokenHash: (req) => {
    const token = getCookieValue(req, REFRESH_COOKIE_NAME);
    return token ? hashRefreshToken(token) : null;
  },
  clearAuth: clearAuthCookie,
};

app.use('/api/auth/sessions', createSessionRouter(sessionRouteOptions));
app.use('/api/users/me/sessions', createSessionRouter(sessionRouteOptions));

app.post('/api/users/me/update', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const { username, email, password } = req.body;
  const userId = req.userId!;
  try {
    const sets: string[] = [];
    const upReq = await getRequest();
    upReq.input('id', sql.UniqueIdentifier, userId);

    if (username !== undefined) {
      const trim = username.trim();
      if (!trim) return res.status(400).json({ error: 'Username cannot be blank.' });
      const h = hashColumnForLookup(trim.toLowerCase());
      const d = await getRequest(); d.input('h', sql.Char(64), h); d.input('id', sql.UniqueIdentifier, userId);
      const dr = await d.query<{c:number}>('SELECT COUNT(*) AS c FROM users WHERE username_hash=@h AND id!=@id');
      if (dr.recordset[0].c) return res.status(400).json({ error: 'Username already taken.' });
      const enc = encryptColumn(trim);
      upReq.input('uEnc', sql.VarBinary(512), enc.ciphertext); upReq.input('uIv', sql.VarBinary(16), enc.iv);
      upReq.input('uTag', sql.VarBinary(16), enc.authTag);     upReq.input('uHash', sql.Char(64), h);
      sets.push('username_encrypted=@uEnc,username_iv=@uIv,username_auth_tag=@uTag,username_hash=@uHash');
    }
    if (email !== undefined) {
      const te = email.toLowerCase().trim();
      if (!te) return res.status(400).json({ error: 'Email cannot be blank.' });
      const h = hashColumnForLookup(te);
      const d = await getRequest(); d.input('h', sql.Char(64), h); d.input('id', sql.UniqueIdentifier, userId);
      const dr = await d.query<{c:number}>('SELECT COUNT(*) AS c FROM users WHERE email_hash=@h AND id!=@id');
      if (dr.recordset[0].c) return res.status(400).json({ error: 'Email already in use.' });
      const enc = encryptColumn(te);
      upReq.input('eEnc', sql.VarBinary(512), enc.ciphertext); upReq.input('eIv', sql.VarBinary(16), enc.iv);
      upReq.input('eTag', sql.VarBinary(16), enc.authTag);     upReq.input('eHash', sql.Char(64), h);
      sets.push('email_encrypted=@eEnc,email_iv=@eIv,email_auth_tag=@eTag,email_hash=@eHash');
    }
    if (password?.trim()) {
      const h = await hashPassword(password.trim());
      upReq.input('pw', sql.NVarChar(512), h); sets.push('password_hash=@pw');
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });

    const updated = await upReq.query<UserRow>(
      `UPDATE users SET ${sets.join(',')}
      WHERE id=@id
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until`
    );
    const user = mapUserRow(updated.recordset[0]);
    if (password?.trim()) {
      await revokeAllRefreshSessions(userId);
      await issueRefreshSession(userId, req, res);
      setAuthCookie(res, signToken(user.id, user.role));
    }
    await logSystemEvent(userId, user.username, 'Auth', 'User', userId, req, 'Updated account details.');
    res.json({ success: true, user });
  } catch (err) { console.error('[POST /api/users/me/update]', err); res.status(500).json({ error: 'Failed to update account.' }); }
});

app.post('/api/users/me/quota-change-request', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const requestedQuotaId = String(req.body?.requested_quota_id || '').trim();
  const note = String(req.body?.note || '').trim();
  const requester = req.user!;

  if (!requestedQuotaId) {
    return res.status(400).json({ error: 'Requested plan is required.' });
  }
  if (requestedQuotaId === requester.quota_id) {
    return res.status(400).json({ error: 'You are already on this plan.' });
  }
  if (!note || note.length < 10 || note.length > 2000) {
    return res.status(400).json({ error: 'Please provide a note between 10 and 2000 characters.' });
  }
  if (!SMTP_ENABLED) {
    return res.status(503).json({ error: 'Quota requests are unavailable because SMTP is not configured.' });
  }

  try {
    const requestedQuotaRequest = await getRequest();
    requestedQuotaRequest.input('id', sql.NVarChar(50), requestedQuotaId);
    const requestedQuotaResult = await requestedQuotaRequest.query<Quota>(
      'SELECT id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes FROM quotas WHERE id=@id'
    );
    if (!requestedQuotaResult.recordset.length) {
      return res.status(404).json({ error: 'Requested plan not found.' });
    }
    const requestedQuota = requestedQuotaResult.recordset[0];

    const currentQuotaRequest = await getRequest();
    currentQuotaRequest.input('id', sql.NVarChar(50), requester.quota_id);
    const currentQuotaResult = await currentQuotaRequest.query<Quota>(
      'SELECT id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes FROM quotas WHERE id=@id'
    );
    const currentQuotaName = currentQuotaResult.recordset[0]?.name || requester.quota_id;

    const adminRequest = await getRequest();
    const adminUsers = await adminRequest.query<UserRow>(
      `SELECT id, email_encrypted, email_iv, email_auth_tag,
              username_encrypted, username_iv, username_auth_tag,
              role, quota_id, storage_used_bytes, status, created_at,
              failed_login_count, locked_until
       FROM users
       WHERE role='Admin' AND status='Active'`
    );

    const adminRecipients = Array.from(new Set(
      adminUsers.recordset
        .map((row) => {
          try {
            return decryptColumn(row.email_encrypted, row.email_iv, row.email_auth_tag).trim();
          } catch (decryptError) {
            console.warn('[POST /api/users/me/quota-change-request] Skipping admin recipient due to invalid encrypted email.', {
              adminId: row.id,
              error: decryptError instanceof Error ? decryptError.message : String(decryptError),
            });
            return '';
          }
        })
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ));

    if (!adminRecipients.length) {
      return res.status(500).json({ error: 'No valid admin recipients are configured.' });
    }

    // Match account registration behavior: send email asynchronously so the
    // user request is accepted even if SMTP has intermittent issues.
    sendQuotaChangeRequestEmail(adminRecipients, {
      requesterUsername: requester.username,
      requesterEmail: requester.email,
      currentPlanName: currentQuotaName,
      requestedPlanName: requestedQuota.name,
      note,
    }).catch((emailError) => {
      console.error('[POST /api/users/me/quota-change-request] SMTP send failed:', emailError);
    });

    await logSystemEvent(
      requester.id,
      requester.username,
      'Admin',
      'QuotaRequest',
      requestedQuota.id,
      req,
      `Requested quota change from "${currentQuotaName}" to "${requestedQuota.name}".`
    );

    res.json({ success: true, message: 'Your quota change request was submitted.' });
  } catch (err) {
    console.error('[POST /api/users/me/quota-change-request]', err);
    res.status(500).json({ error: 'Failed to submit quota change request. Contact support if this continues.' });
  }
});

const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
});

app.get('/api/public/users/:avatarToken/avatar', (req, res) => {
  try {
    const userId = resolveProfilePictureUserIdFromToken(PROFILE_PICTURE_PATH, req.params.avatarToken);
    if (!userId) return res.status(404).end();
    const avatarPath = getLatestProfilePictureFile(PROFILE_PICTURE_PATH, userId);
    if (!avatarPath) return res.status(404).end();
    const picture = fs.readFileSync(avatarPath);
    const mimeType = detectProfilePictureMime(picture);
    if (!mimeType) return res.status(404).end();
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(picture);
  } catch (err) {
    console.error('[GET /api/public/users/:userId/avatar]', err);
    res.status(500).json({ error: 'Could not load profile picture.' });
  }
});

app.get('/api/users/me/avatar', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  try {
    const avatarPath = getLatestProfilePictureFile(PROFILE_PICTURE_PATH, req.userId!);
    if (!avatarPath) return res.status(404).end();
    const picture = fs.readFileSync(avatarPath);
    const mimeType = detectProfilePictureMime(picture);
    if (!mimeType) return res.status(404).end();
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(picture);
  } catch (err) {
    console.error('[GET /api/users/me/avatar]', err);
    res.status(500).json({ error: 'Could not load profile picture.' });
  }
});

app.post('/api/users/me/avatar', authenticateUser as express.RequestHandler, profilePictureUpload.single('avatar'), async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a profile picture to upload.' });
  const mimeType = detectProfilePictureMime(req.file.buffer);
  if (!mimeType) return res.status(400).json({ error: 'Profile pictures must be PNG, JPEG, or WebP.' });

  try {
    const directory = getProfilePictureDirectory(PROFILE_PICTURE_PATH, req.userId!);
    fs.mkdirSync(directory, { recursive: true });
    const extension = getProfilePictureExtension(mimeType);
    const filename = `${Date.now()}-${generateSecureToken(8)}.${extension}`;
    fs.writeFileSync(path.join(directory, filename), req.file.buffer);

    for (const oldPicture of getProfilePictureFiles(PROFILE_PICTURE_PATH, req.userId!).slice(10)) {
      fs.unlinkSync(oldPicture);
    }

    await logSystemEvent(req.userId!, req.user!.username, 'Auth', 'User', req.userId!, req, 'Updated profile picture.');
    res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/users/me/avatar]', err);
    res.status(500).json({ error: 'Could not save profile picture.' });
  }
});

const removeProfilePicture = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const directory = getProfilePictureDirectory(PROFILE_PICTURE_PATH, req.userId!);
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
    await logSystemEvent(req.userId!, req.user!.username, 'Auth', 'User', req.userId!, req, 'Removed profile picture.');
    res.json({ success: true });
  } catch (err) {
    console.error('[remove profile picture]', err);
    res.status(500).json({ error: 'Could not remove profile picture.' });
  }
};

app.delete('/api/users/me/avatar', authenticateUser as express.RequestHandler, removeProfilePicture);
app.post('/api/users/me/avatar/remove', authenticateUser as express.RequestHandler, removeProfilePicture);

// ──────────────────────────────────────────────────────────────
// API: User — Request Account Deletion (Step 1: generate token & email)
// ──────────────────────────────────────────────────────────────

app.post('/api/users/me/delete-request', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const username = req.user!.username;
  try {
    // Get the user's email (decrypted) for sending the confirmation
    const userReq = await getRequest();
    userReq.input('id', sql.UniqueIdentifier, userId);
    const userResult = await userReq.query<UserRow>(
      `SELECT id, email_encrypted, email_iv, email_auth_tag,
              username_encrypted, username_iv, username_auth_tag,
              role, quota_id, storage_used_bytes, status, created_at,
              failed_login_count, locked_until
       FROM users WHERE id = @id AND status = 'Active'`
    );
    if (!userResult.recordset.length) return res.status(404).json({ error: 'Account not found.' });

    const row = userResult.recordset[0];
    const email = decryptColumn(row.email_encrypted, row.email_iv, row.email_auth_tag);

    // Generate deletion token (valid for 1 hour)
    const deletionToken = generateSecureToken(32); // 64-char hex
    const deletionExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const updReq = await getRequest();
    updReq.input('id', sql.UniqueIdentifier, userId);
    updReq.input('tok', sql.Char(64), deletionToken);
    updReq.input('exp', sql.DateTimeOffset, deletionExpires);
    await updReq.query(
      `UPDATE users SET deletion_token=@tok, deletion_token_expires=@exp WHERE id=@id`
    );

    // Send confirmation email (async — don't block response)
    if (SMTP_ENABLED) {
      sendAccountDeletionEmail(email, username, deletionToken)
        .catch(e => console.error('[email] Failed to send deletion confirmation:', e.message));
      res.json({ success: true, message: 'A confirmation email has been sent. Please check your inbox to finalize account deletion.' });
    } else {
      // Dev mode — return the confirmation URL directly
      const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
      res.json({
        success: true,
        message: 'SMTP not configured. Use the confirmation URL below to finalize deletion.',
        confirmationUrl: `${appUrl}/api/users/me/delete-confirm?token=${encodeURIComponent(deletionToken)}`,
      });
    }

    await logSystemEvent(userId, username, 'Security', 'User', userId, req, 'Requested account deletion — confirmation email sent.');
  } catch (err) { console.error('[POST /api/users/me/delete-request]', err); res.status(500).json({ error: 'Failed to initiate account deletion.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: User — Confirm Account Deletion (Step 2: verify token & cascade delete)
// ──────────────────────────────────────────────────────────────

app.get('/api/users/me/delete-confirm', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).send(renderDeletionPage(false, 'Missing deletion confirmation token.'));
  }

  try {
    const request = await getRequest();
    request.input('tok', sql.Char(64), token);
    const result = await request.query<UserRow>(
      `SELECT id, email_encrypted, email_iv, email_auth_tag,
              username_encrypted, username_iv, username_auth_tag,
              role, quota_id, storage_used_bytes, status, created_at,
              failed_login_count, locked_until, deletion_token, deletion_token_expires
       FROM users WHERE deletion_token = @tok`
    );

    if (!result.recordset.length) {
      return res.status(400).send(renderDeletionPage(false, 'Invalid or already-used deletion token.'));
    }

    const row = result.recordset[0];

    if (row.deletion_token_expires && new Date(row.deletion_token_expires) < new Date()) {
      // Clean up expired token
      const clReq = await getRequest();
      clReq.input('id', sql.UniqueIdentifier, row.id);
      await clReq.query(`UPDATE users SET deletion_token=NULL, deletion_token_expires=NULL WHERE id=@id`);
      return res.status(400).send(renderDeletionPage(false, 'Deletion confirmation token has expired. Please request a new one from your account settings.'));
    }

    const csrfToken = getOrCreateCsrfToken(req, res);
    res.send(renderDeletionConfirmPage(token, csrfToken));
  } catch (err) {
    console.error('[GET /api/users/me/delete-confirm]', err);
    res.status(500).send(renderDeletionPage(false, 'Account deletion confirmation failed due to a server error.'));
  }
});

app.post('/api/users/me/delete-confirm', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).send(renderDeletionPage(false, 'Missing deletion confirmation token.'));
  }

  try {
    const request = await getRequest();
    request.input('tok', sql.Char(64), token);
    const result = await request.query<UserRow>(
      `SELECT id, email_encrypted, email_iv, email_auth_tag,
              username_encrypted, username_iv, username_auth_tag,
              role, quota_id, storage_used_bytes, status, created_at,
              failed_login_count, locked_until, deletion_token, deletion_token_expires
       FROM users WHERE deletion_token = @tok`
    );

    if (!result.recordset.length) {
      return res.status(400).send(renderDeletionPage(false, 'Invalid or already-used deletion token.'));
    }

    const row = result.recordset[0];

    if (row.deletion_token_expires && new Date(row.deletion_token_expires) < new Date()) {
      // Clean up expired token
      const clReq = await getRequest();
      clReq.input('id', sql.UniqueIdentifier, row.id);
      await clReq.query(`UPDATE users SET deletion_token=NULL, deletion_token_expires=NULL WHERE id=@id`);
      return res.status(400).send(renderDeletionPage(false, 'Deletion confirmation token has expired. Please request a new one from your account settings.'));
    }

    const username = decryptColumn(row.username_encrypted, row.username_iv, row.username_auth_tag);
    const email = decryptColumn(row.email_encrypted, row.email_iv, row.email_auth_tag);

    // Log before deletion (this log entry will survive since system_logs has no FK to users)
    await logSystemEvent(row.id, username, 'Security', 'User', row.id, req,
      `Account permanently deleted: ${email}. All files, share links, and keys cascaded.`);

    // Fetch vault file paths BEFORE deleting the user (files cascade on user delete)
    const vaultPathsToDelete: string[] = [];
    try {
      const fpReq = await getRequest();
      fpReq.input('uid', sql.UniqueIdentifier, row.id);
      const fpResult = await fpReq.query<{ stored_path: string }>(
        `SELECT stored_path FROM files WHERE owner_user_id=@uid`
      );
      for (const f of fpResult.recordset) {
        vaultPathsToDelete.push(f.stored_path);
      }
    } catch (e) {
      console.warn('[delete-confirm] Could not fetch file paths before deletion:', (e as Error).message);
    }

    // Cascade delete the user — CASCADE on files → file_encryption_keys, share_links, refresh_tokens
    const delReq = await getRequest();
    delReq.input('id', sql.UniqueIdentifier, row.id);
    await delReq.query(`DELETE FROM users WHERE id=@id`);

    // Clean up vault files from disk
    for (const storedPath of vaultPathsToDelete) {
      try {
        const vaultPath = path.join(FILE_VAULT, storedPath);
        if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);
      } catch (e) { /* file may already be gone */ }
    }

    console.log(`[account-deletion] User "${username}" (${email}) and all associated data permanently deleted.`);
    res.send(renderDeletionPage(true, `Your account (${username}) and all associated files have been permanently deleted. Goodbye!`));
  } catch (err) {
    console.error('[POST /api/users/me/delete-confirm]', err);
    res.status(500).send(renderDeletionPage(false, 'Account deletion failed due to a server error.'));
  }
});

function renderDeletionConfirmPage(token: string, csrfToken: string): string {
  const safeToken = escapeHtml(token);
  const safeCsrfToken = escapeHtml(csrfToken);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Leeku Secure — Confirm Account Deletion</title>
<style>body{background:#0A0E14;color:#ccc;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:520px;padding:40px;border:3px solid #FF007F;text-align:center;background:#0F1419}
h1{color:#FF007F;font-size:20px;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px}
p{font-size:13px;line-height:1.6;margin:0 0 24px}
button{display:inline-block;background:#FF007F;color:#fff;padding:12px 28px;font-weight:900;text-transform:uppercase;text-decoration:none;font-size:12px;border:2px solid #00F2FF;cursor:pointer}
a{display:inline-block;color:#00F2FF;text-decoration:none;font-size:12px;margin-top:16px}
</style></head>
<body><div class="card">
  <h1>CONFIRM ACCOUNT DELETION</h1>
  <p>This action is permanent and will remove your account, files, share links, and encryption keys.</p>
  <form method="POST" action="/api/users/me/delete-confirm">
    <input type="hidden" name="token" value="${safeToken}" />
    <input type="hidden" name="_csrf" value="${safeCsrfToken}" />
    <button type="submit">Delete Account Permanently</button>
  </form>
  <a href="/">Cancel and return</a>
</div></body></html>`;
}

function mapFolderShareRow(row: FolderShareRow): FolderShareLink {
  return {
    id: row.id,
    folder_id: row.folder_id,
    public_token: row.public_token,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Renders a simple HTML page for the account deletion result.
 */
function renderDeletionPage(success: boolean, message: string): string {
  const color = success ? '#00F2FF' : '#FF007F';
  const title = success ? 'ACCOUNT DELETED' : 'DELETION FAILED';
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Leeku Secure — Account Deletion</title>
<style>body{background:#0A0E14;color:#ccc;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:480px;padding:40px;border:3px solid ${color};text-align:center;background:#0F1419}
h1{color:${color};font-size:20px;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px}
p{font-size:13px;line-height:1.6;margin:0 0 24px}
a{display:inline-block;background:#FF007F;color:#fff;padding:12px 28px;font-weight:900;text-transform:uppercase;text-decoration:none;font-size:12px;border:2px solid #00F2FF}
</style></head>
<body><div class="card">
  <h1>${safeTitle}</h1>
  <p>${safeMessage}</p>
  <a href="/">Return to Leeku Secure</a>
</div></body></html>`;
}

// ──────────────────────────────────────────────────────────────
// API: Files — List
// ──────────────────────────────────────────────────────────────

app.get('/api/files', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const request = await getRequest();
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    request.input('includeSystem', sql.Bit, req.user?.role === 'Admin' && req.query.include_system === '1' ? 1 : 0);
    request.input('systemFolderName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
    let result;
    try {
      result = await request.query<FileRow>(
        `SELECT id, owner_user_id,
                folder_id, folder_name,
                original_name_encrypted, original_name_iv, original_name_auth_tag,
                stored_path, mime_type, size_bytes, encrypted_size_bytes,
                status, checksum_sha256, scan_result, scan_message,
                is_encrypted, leeku_vibe, ttl_hours,
                client_secret_hash,
                expires_at, created_at
        FROM (
          SELECT f.*, ff.name AS folder_name
          FROM files f
          LEFT JOIN file_folders ff ON f.folder_id=ff.id
          WHERE f.owner_user_id=@ownerId AND COALESCE(f.status,'Available')!='Expired'
            AND (
              @includeSystem=TRUE OR NOT EXISTS (
                SELECT 1
                FROM file_folders candidate
                LEFT JOIN file_folders parent ON parent.id=candidate.parent_folder_id
                WHERE candidate.id=f.folder_id
                  AND (
                    (candidate.parent_folder_id IS NULL AND candidate.name=@systemFolderName)
                    OR (parent.parent_folder_id IS NULL AND parent.name=@systemFolderName)
                  )
              )
            )
        ) files
         ORDER BY created_at DESC`
      );
    } catch (queryErr: any) {
      const isMissingSecretColumn =
        queryErr?.number === 207 &&
        typeof queryErr?.message === 'string' &&
        queryErr.message.includes('client_secret_hash');
      if (!isMissingSecretColumn) throw queryErr;

      console.warn('[GET /api/files] client_secret_hash column missing, using legacy query fallback.');
      result = await request.query<FileRow>(
        `SELECT id, owner_user_id,
                NULL AS folder_id, NULL AS folder_name,
                original_name_encrypted, original_name_iv, original_name_auth_tag,
                stored_path, mime_type, size_bytes, encrypted_size_bytes,
                status, checksum_sha256, scan_result, scan_message,
                is_encrypted, leeku_vibe, ttl_hours,
                expires_at, created_at
        FROM files WHERE owner_user_id=@ownerId AND COALESCE(status,'Available')!='Expired'
         ORDER BY created_at DESC`
      );
    }
    res.json({ files: result.recordset.map(r => mapFileRow(r, req.user!.username)) });
  } catch (err) { console.error('[GET /api/files]', err); res.status(500).json({ error: 'Failed to load files.' }); }
});

app.get('/api/file-folders', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const request = await getRequest();
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    request.input('includeSystem', sql.Bit, req.user?.role === 'Admin' && req.query.include_system === '1' ? 1 : 0);
    request.input('systemFolderName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
    const result = await request.query<FolderRow>(
      `SELECT ff.id, ff.owner_user_id, ff.parent_folder_id, ff.name, ff.created_at, ff.updated_at,
              COUNT(f.id) AS file_count
       FROM file_folders ff
       LEFT JOIN files f ON f.folder_id=ff.id AND COALESCE(f.status,'Available')!='Expired'
       WHERE ff.owner_user_id=@ownerId
         AND (
           @includeSystem=TRUE OR NOT (
             (ff.parent_folder_id IS NULL AND ff.name=@systemFolderName)
             OR ff.parent_folder_id IN (
               SELECT id FROM file_folders
               WHERE owner_user_id=@ownerId AND parent_folder_id IS NULL AND name=@systemFolderName
             )
           )
         )
       GROUP BY ff.id, ff.owner_user_id, ff.parent_folder_id, ff.name, ff.created_at, ff.updated_at
       ORDER BY ff.parent_folder_id ASC, ff.name ASC`
    );
    res.json({ folders: result.recordset.map(mapFolderRow) });
  } catch (err) { console.error('[GET /api/file-folders]', err); res.status(500).json({ error: 'Failed to load folders.' }); }
});

app.post('/api/file-folders', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const name = validateFolderName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Folder name must be between 1 and 120 characters.' });
  const parentFolderId = normalizeNullableFolderId(req.body?.parent_folder_id);
  if (parentFolderId === undefined) return res.status(400).json({ error: 'Invalid parent folder id.' });
  if (name === SYSTEM_UPDATE_FOLDER_NAME && (req.user?.role !== 'Admin' || parentFolderId !== null)) {
    return res.status(403).json({ error: 'The Leeku Desktop update folder is reserved for administrators.' });
  }
  try {
    let parentFolder: FolderRow | null = null;
    if (parentFolderId) {
      parentFolder = await getOwnedFolder(parentFolderId, req.userId!);
      if (!parentFolder) return res.status(404).json({ error: 'Parent folder not found.' });
      if (parentFolder.name === SYSTEM_UPDATE_FOLDER_NAME && parentFolder.parent_folder_id === null) {
        if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Administrator access is required.' });
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(name)) {
          return res.status(400).json({ error: 'Update folders must use a semantic version such as 1.2.0.' });
        }
      } else if (parentFolder.parent_folder_id) {
        const grandParent = await getOwnedFolder(parentFolder.parent_folder_id, req.userId!);
        if (grandParent?.name === SYSTEM_UPDATE_FOLDER_NAME && grandParent.parent_folder_id === null) {
          return res.status(400).json({ error: 'Update release folders cannot contain subfolders.' });
        }
      }
      const depth = await getFolderDepth(parentFolderId, req.userId!);
      if (depth >= MAX_FOLDER_DEPTH) {
        return res.status(400).json({ error: `Maximum folder depth is ${MAX_FOLDER_DEPTH}.` });
      }
    }

    const request = await getRequest();
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    request.input('parentFolderId', sql.UniqueIdentifier, parentFolderId);
    request.input('name', sql.NVarChar(120), name);
    const result = await request.query<FolderRow>(
      `INSERT INTO file_folders (owner_user_id, parent_folder_id, name)
       VALUES (@ownerId, @parentFolderId, @name)
       RETURNING id,owner_user_id,parent_folder_id,name,0 AS file_count,created_at,updated_at`
    );
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'Folder', result.recordset[0].id, req, `Created folder "${name}".`);
    res.status(201).json({ folder: mapFolderRow(result.recordset[0]) });
  } catch (err: any) {
    if (isDuplicateKeyError(err)) {
      const existing = await findExistingFolderConflict(req.userId!, parentFolderId, name);
      return res.status(409).json({
        error: 'A folder with that name already exists.',
        existing_folder: existing ? mapFolderRow(existing.folder) : null,
        existing_folder_path: existing?.path || null,
        existing_folder_hidden_by_system_filter: existing?.hiddenBySystemFilter || false,
      });
    }
    console.error('[POST /api/file-folders]', err); res.status(500).json({ error: 'Failed to create folder.' });
  }
});

app.post('/api/file-folders/:id/rename', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const folderId = req.params.id;
  if (!UUID_PATTERN.test(folderId)) return res.status(400).json({ error: 'Invalid folder id.' });
  const name = validateFolderName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Folder name must be between 1 and 120 characters.' });
  try {
    const folder = await getOwnedFolder(folderId, req.userId!);
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });
    const parent = folder.parent_folder_id ? await getOwnedFolder(folder.parent_folder_id, req.userId!) : null;
    if (folder.name === SYSTEM_UPDATE_FOLDER_NAME || parent?.name === SYSTEM_UPDATE_FOLDER_NAME) {
      return res.status(403).json({ error: 'The system update folder structure cannot be renamed.' });
    }
    const request = await getRequest();
    request.input('id', sql.UniqueIdentifier, folderId);
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    request.input('name', sql.NVarChar(120), name);
    const result = await request.query<FolderRow>(
          `WITH updated AS (
        UPDATE file_folders
        SET name=@name, updated_at=CURRENT_TIMESTAMP
        WHERE id=@id AND owner_user_id=@ownerId
        RETURNING id,owner_user_id,parent_folder_id,name,created_at,updated_at
      )
      SELECT updated.*,
        (SELECT COUNT(*) FROM files WHERE folder_id=updated.id AND COALESCE(status,'Available')!='Expired') AS file_count
      FROM updated`
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'Folder not found.' });
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'Folder', folderId, req, `Renamed folder to "${name}".`);
    res.json({ folder: mapFolderRow(result.recordset[0]) });
  } catch (err: any) {
    if (isDuplicateKeyError(err)) return res.status(409).json({ error: 'A folder with that name already exists.' });
    console.error('[POST /api/file-folders/:id/rename]', err); res.status(500).json({ error: 'Failed to rename folder.' });
  }
});

app.post('/api/file-folders/:id/delete', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const folderId = req.params.id;
  if (!UUID_PATTERN.test(folderId)) return res.status(400).json({ error: 'Invalid folder id.' });
  const deleteFiles = !!req.body?.delete_files;
  try {
    const folder = await getOwnedFolder(folderId, req.userId!);
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });
    const parent = folder.parent_folder_id ? await getOwnedFolder(folder.parent_folder_id, req.userId!) : null;
    if (folder.name === SYSTEM_UPDATE_FOLDER_NAME && folder.parent_folder_id === null) {
      return res.status(403).json({ error: 'The desktop update system root cannot be deleted.' });
    }
    if (parent?.name === SYSTEM_UPDATE_FOLDER_NAME && parent.parent_folder_id === null) {
      if (req.user?.role !== 'Admin') {
        return res.status(403).json({ error: 'Administrator access is required.' });
      }
      if (!deleteFiles) {
        return res.status(400).json({ error: 'Draft update folders must be deleted together with their files.' });
      }
      const activation = await desktopUpdateFolderActivation(folder.id, req.userId!);
      if (activation && activation !== 'draft') {
        return res.status(409).json({ error: 'Only draft desktop updates can be deleted.' });
      }
    }

    if (!deleteFiles) {
      const moveReq = await getRequest();
      moveReq.input('folderId', sql.UniqueIdentifier, folderId);
      moveReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
      moveReq.input('maxDepth', sql.Int, MAX_FOLDER_DEPTH);
      await moveReq.query(
        `WITH RECURSIVE folder_tree AS (
           SELECT id,0 AS depth FROM file_folders WHERE id=@folderId AND owner_user_id=@ownerId
           UNION ALL
           SELECT ff.id,ft.depth+1
           FROM file_folders ff
           INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ff.owner_user_id=@ownerId AND ft.depth<@maxDepth
         )
         UPDATE files
         SET folder_id=NULL
         WHERE owner_user_id=@ownerId AND folder_id IN (SELECT id FROM folder_tree)`
      );
    } else {
      const filesReq = await getRequest();
      filesReq.input('folderId', sql.UniqueIdentifier, folderId);
      filesReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
      filesReq.input('maxDepth', sql.Int, MAX_FOLDER_DEPTH);
      const folderFiles = await filesReq.query<{id:string;stored_path:string;size_bytes:number;status:string}>(
        `WITH RECURSIVE folder_tree AS (
           SELECT id,0 AS depth FROM file_folders WHERE id=@folderId AND owner_user_id=@ownerId
           UNION ALL
           SELECT ff.id,ft.depth+1
           FROM file_folders ff
           INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ff.owner_user_id=@ownerId AND ft.depth<@maxDepth
         )
         SELECT id, stored_path, size_bytes, status
         FROM files
         WHERE owner_user_id=@ownerId AND folder_id IN (SELECT id FROM folder_tree)`
      );
      for (const file of folderFiles.recordset) {
        const vaultPath = path.join(FILE_VAULT, file.stored_path);
        try { if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath); } catch {}
      }
      const storageToRemove = folderFiles.recordset
        .filter((file) => file.status === 'Available')
        .reduce((total, file) => total + Number(file.size_bytes || 0), 0);
      const deleteReq = await getRequest();
      deleteReq.input('folderId', sql.UniqueIdentifier, folderId);
      deleteReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
      deleteReq.input('maxDepth', sql.Int, MAX_FOLDER_DEPTH);
      await deleteReq.query(
        `WITH RECURSIVE folder_tree AS (
           SELECT id,0 AS depth FROM file_folders WHERE id=@folderId AND owner_user_id=@ownerId
           UNION ALL
           SELECT ff.id,ft.depth+1
           FROM file_folders ff
           INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ff.owner_user_id=@ownerId AND ft.depth<@maxDepth
         )
         DELETE FROM files
         WHERE owner_user_id=@ownerId AND folder_id IN (SELECT id FROM folder_tree)`
      );
      if (storageToRemove > 0) {
        const storageReq = await getRequest();
        storageReq.input('sz', sql.BigInt, storageToRemove);
        storageReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
        await storageReq.query('UPDATE users SET storage_used_bytes=CASE WHEN storage_used_bytes-@sz<0 THEN 0 ELSE storage_used_bytes-@sz END WHERE id=@ownerId');
      }
    }

    const deleteFolderReq = await getRequest();
    deleteFolderReq.input('id', sql.UniqueIdentifier, folderId);
    deleteFolderReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
    deleteFolderReq.input('maxDepth', sql.Int, MAX_FOLDER_DEPTH);
    await deleteFolderReq.query(
      `WITH RECURSIVE folder_tree AS (
         SELECT id,0 AS depth FROM file_folders WHERE id=@id AND owner_user_id=@ownerId
         UNION ALL
         SELECT ff.id,ft.depth+1
         FROM file_folders ff
         INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
         WHERE ff.owner_user_id=@ownerId AND ft.depth<@maxDepth
       )
       DELETE FROM file_folders
       WHERE id IN (SELECT id FROM folder_tree)`
    );
    await logSystemEvent(req.userId!, req.user!.username, 'Delete', 'Folder', folderId, req, deleteFiles ? `Deleted folder tree "${folder.name}" and its files.` : `Deleted folder tree "${folder.name}" and moved files to All Files root.`);
    res.json({ success: true });
  } catch (err) { console.error('[POST /api/file-folders/:id/delete]', err); res.status(500).json({ error: 'Failed to delete folder.' }); }
});

app.post('/api/files/:id/folder', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  if (!UUID_PATTERN.test(fileId)) return res.status(400).json({ error: 'Invalid file id.' });
  const folderId = normalizeNullableFolderId(req.body?.folder_id);
  if (folderId === undefined) return res.status(400).json({ error: 'Invalid folder id.' });
  try {
    if (await isDesktopUpdateFile(fileId)) {
      return res.status(403).json({ error: 'Desktop update artifacts cannot be moved manually.' });
    }
    let folderName: string | null = null;
    if (folderId) {
      const folder = await getOwnedFolder(folderId, req.userId!);
      if (!folder) return res.status(404).json({ error: 'Folder not found.' });
      const parent = folder.parent_folder_id ? await getOwnedFolder(folder.parent_folder_id, req.userId!) : null;
      if (folder.name === SYSTEM_UPDATE_FOLDER_NAME || parent?.name === SYSTEM_UPDATE_FOLDER_NAME) {
        return res.status(403).json({ error: 'Files cannot be moved manually into the system update folder.' });
      }
      folderName = folder.name;
    }
    const request = await getRequest();
    request.input('id', sql.UniqueIdentifier, fileId);
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    request.input('folderId', sql.UniqueIdentifier, folderId);
    const result = await request.query<FileRow>(
      `UPDATE files
       SET folder_id=@folderId
      WHERE id=@id AND owner_user_id=@ownerId
      RETURNING id,owner_user_id,folder_id,
           original_name_encrypted,original_name_iv,original_name_auth_tag,
           stored_path,mime_type,size_bytes,encrypted_size_bytes,
           status,checksum_sha256,scan_result,scan_message,
           is_encrypted,leeku_vibe,ttl_hours,client_secret_hash,
           expires_at,created_at`
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'File not found.' });
    const row = result.recordset[0];
    row.folder_name = folderName;
    res.json({ file: mapFileRow(row, req.user!.username) });
  } catch (err) { console.error('[POST /api/files/:id/folder]', err); res.status(500).json({ error: 'Failed to move file.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Files — Upload
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// Maintenance mode check function
// ──────────────────────────────────────────────────────────────

async function checkMaintenanceMode(
  operationType: 'upload' | 'download' | 'delete',
  req: express.Request, res: express.Response
): Promise<boolean> {
  const isMaintenanceEnabled = await getMaintenanceStatus();
  if (isMaintenanceEnabled) {
    res.status(503).json({
      error: 'System is under maintenance. Please try again later.',
      maintenance_mode: true,
    });
    return true; // Operation blocked
  }
  return false; // Operation allowed
}

// ──────────────────────────────────────────────────────────────
// Multer — multipart upload middleware (streaming, no memory limits)
// ──────────────────────────────────────────────────────────────

// Ensure ALL temp directories exist before any upload middleware runs
if (!fs.existsSync(UPLOAD_TEMP)) {
  fs.mkdirSync(UPLOAD_TEMP, { recursive: true });
  console.log(`[server] Created upload temp directory: ${UPLOAD_TEMP}`);
}

const CHUNK_UPLOAD_TEMP = path.join(UPLOAD_TEMP, 'chunk-uploads');
const RESUMABLE_CHUNK_DIR = path.join(UPLOAD_TEMP, 'chunks');

for (const dir of [CHUNK_UPLOAD_TEMP, RESUMABLE_CHUNK_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[server] Created directory: ${dir}`);
  }
}

// Multer instance for full (non-resumable) file uploads — no size limit;
// quota checks enforce size server-side.
const upload = multer({
  dest: UPLOAD_TEMP,
  limits: {
    // No fileSize limit — quota checks handle the limit server-side.
    // Must be omitted (not 0) in multer v2.x — 0 rejects ALL non-empty files.
    files: 1,
  },
});

// Multer instance for individual Resumable.js chunks — each chunk ≤ 55 MB.
// We allow a small overhead so that boundary / headers don't cause rejection.
const CHUNK_MAX_BYTES = 55 * 1024 * 1024;
const chunkUpload = multer({
  dest: CHUNK_UPLOAD_TEMP,
  limits: {
    files: 1,
    fileSize: CHUNK_MAX_BYTES,
  },
});

// ── Resumable.js protocol helpers ──────────────────────────────

/**
 * Returns the on-disk path where a single resumable chunk is stored.
 */
function chunkPath(identifier: string, chunkNumber: number): string {
  return path.join(RESUMABLE_CHUNK_DIR, identifier, String(chunkNumber));
}

/**
 * Returns the directory that holds all chunks for a given identifier.
 */
function chunkDir(identifier: string): string {
  return path.join(RESUMABLE_CHUNK_DIR, identifier);
}

/**
 * Count how many chunks have already been persisted for `identifier`.
 */
function countReceivedChunks(identifier: string): number {
  const dir = chunkDir(identifier);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (/^\d+$/.test(entry)) count++;
  }
  return count;
}

/**
 * Merge all chunks (1 … totalChunks) into a single temporary file.
 * Cleans up the chunk directory afterwards.
 * Returns the path to the merged file.
 */
function mergeChunks(identifier: string, totalChunks: number): string {
  const dir = chunkDir(identifier);
  const mergedPath = path.join(UPLOAD_TEMP, `merged_${identifier}`);

  const fdOut = fs.openSync(mergedPath, 'w');
  try {
    for (let i = 1; i <= totalChunks; i++) {
      const cp = path.join(dir, String(i));
      if (!fs.existsSync(cp)) {
        throw new Error(`Missing chunk ${i} of ${totalChunks} for identifier "${identifier}".`);
      }
      const data = fs.readFileSync(cp);
      fs.writeSync(fdOut, data);
      fs.unlinkSync(cp); // clean up chunk after appending
    }
  } finally {
    fs.closeSync(fdOut);
  }

  // Remove empty chunk directory
  try { fs.rmdirSync(dir); } catch { /* best effort */ }

  return mergedPath;
}

/**
 * Middleware: forwards to chunk multer for Resumable.js uploads,
 * or to regular multer for direct (non-resumable) uploads.
 */
const receiveUploadOrChunk: express.RequestHandler = (req, res, next) => {
  const isResumable = !!req.query.resumableIdentifier;

  if (isResumable) {
    chunkUpload.single('file')(req, res, (error: unknown) => {
      if (!error) { next(); return; }

      const message = error instanceof Error ? error.message : String(error);

      if (message === 'Request aborted' || req.destroyed || req.aborted) {
        console.warn('[upload] Chunk upload aborted before completion.', {
          ip: getRequestIp(req),
          contentLength: req.headers['content-length'] ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        });
        if (!res.headersSent && !res.writableEnded && !req.destroyed) {
          res.status(499).json({ error: 'Upload connection closed before the chunk finished sending.' });
        }
        return;
      }

      // Return JSON instead of next(error) so the client gets a parseable error
      console.error('[upload] Chunk upload error:', message);
      if (!res.headersSent && !res.writableEnded) {
        res.status(400).json({ error: `Chunk upload failed: ${message}` });
      }
    });
    return;
  }

  // Non-resumable (legacy) upload
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) { next(); return; }

    const message = error instanceof Error ? error.message : String(error);

    if (message === 'Request aborted' || req.destroyed || req.aborted) {
      console.warn('[upload] Multipart request aborted before the file finished streaming.', {
        ip: getRequestIp(req),
        contentLength: req.headers['content-length'] ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      if (!res.headersSent && !res.writableEnded && !req.destroyed) {
        res.status(499).json({ error: 'Upload connection closed before the file finished sending.' });
      }
      return;
    }

    next(error);
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/files/upload — Resumable.js chunk existence check
// ──────────────────────────────────────────────────────────────
// If the chunk file exists and is non-empty we return 200 (skip),
// otherwise 204 (upload needed).
app.get('/api/files/upload', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const identifier  = req.query.resumableIdentifier as string | undefined;
  const chunkNumber = req.query.resumableChunkNumber as string | undefined;

  if (!identifier || !chunkNumber) {
    return res.status(400).json({ error: 'Missing "resumableIdentifier" or "resumableChunkNumber" query parameter.' });
  }

  const cp = chunkPath(identifier, parseInt(chunkNumber, 10));
  if (fs.existsSync(cp) && fs.statSync(cp).size > 0) {
    return res.status(200).end(); // chunk already present — skip
  }
  return res.status(204).end();   // chunk missing — please upload
});

// ──────────────────────────────────────────────────────────────
// POST /api/files/upload — File upload (resumable or direct)
// ──────────────────────────────────────────────────────────────

app.post(
  '/api/files/upload',
  authenticateUser as express.RequestHandler,
  receiveUploadOrChunk,
  async (req: AuthenticatedRequest, res) => {

    const isResumable = !!req.query.resumableIdentifier;

    // ═══════════════════════════════════════════════════════════
    // RESUMABLE.JS — chunk upload
    // ═══════════════════════════════════════════════════════════
    if (isResumable) {
      const identifier   = req.query.resumableIdentifier as string;
      const chunkNumber  = parseInt(req.query.resumableChunkNumber  as string, 10);
      const totalChunks  = parseInt(req.query.resumableTotalChunks  as string, 10);
      const totalSize    = parseInt(req.query.resumableTotalSize    as string, 10);
      const originalName = (req.query.resumableFilename as string) || 'upload';
      const mimeType     = (req.query.resumableType     as string) || 'application/octet-stream';

      if (!identifier || isNaN(chunkNumber) || isNaN(totalChunks)) {
        return res.status(400).json({ error: 'Invalid or missing resumable upload parameters.' });
      }

      const multerFile = req.file;
      if (!multerFile) {
        return res.status(400).json({ error: 'No chunk file attached. Use multipart/form-data with field name "file".' });
      }

      // ── Persist the chunk ──────────────────────────────────
      const dir = chunkDir(identifier);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const destPath = chunkPath(identifier, chunkNumber);
      try {
        fs.renameSync(multerFile.path, destPath);
      } catch (renameErr) {
        // Fallback: copy + delete if rename crosses device boundaries
        fs.copyFileSync(multerFile.path, destPath);
        try { fs.unlinkSync(multerFile.path); } catch { /* best effort */ }
      }

      // ── Check whether all chunks have arrived ──────────────
      const received = countReceivedChunks(identifier);

      if (received < totalChunks) {
        // Still waiting for more chunks — acknowledge this one
        console.info('[upload] Chunk received (waiting for more).', {
          userId: req.user!.id,
          identifier,
          chunkNumber,
          received,
          totalChunks,
        });
        return res.json({
          success: true,
          done: false,
          chunk: chunkNumber,
          received,
          total: totalChunks,
        });
      }

      // ── All chunks received — merge them into one temp file ─
      console.info('[upload] All chunks received — merging.', {
        userId: req.user!.id,
        identifier,
        totalChunks,
        totalSize,
      });

      let mergedPath: string;
      try {
        mergedPath = mergeChunks(identifier, totalChunks);
      } catch (mergeErr) {
        console.error('[upload] Failed to merge chunks.', {
          userId: req.user!.id,
          identifier,
          error: mergeErr instanceof Error ? mergeErr.message : String(mergeErr),
        });
        return res.status(500).json({ error: 'Failed to assemble file chunks. Please try again.' });
      }

      // ── Synthesise a multer-compatible file object ─────────
      const mergedStat = fs.statSync(mergedPath);
      req.file = {
        fieldname: 'file',
        originalname: originalName,
        encoding: '7bit',
        mimetype: mimeType,
        destination: UPLOAD_TEMP,
        filename: `merged_${identifier}`,
        path: mergedPath,
        size: mergedStat.size,
      } as Express.Multer.File;

      // Inject body parameters so the downstream code treats it like a regular upload
      req.body = req.body || {};
      req.body.original_name = originalName;
      req.body.mime_type     = mimeType;
      req.body.ttl_hours     = (req.query.ttl_hours as string) || null;
      req.body.upload_secret_key = (req.query.upload_secret_key as string) || req.body.upload_secret_key;
      req.body.upload_secret_salt_b64 = (req.query.upload_secret_salt_b64 as string) || req.body.upload_secret_salt_b64;
      req.body.upload_secret_iv_b64 = (req.query.upload_secret_iv_b64 as string) || req.body.upload_secret_iv_b64;
      req.body.upload_secret_iterations = (req.query.upload_secret_iterations as string) || req.body.upload_secret_iterations;
      req.body.folder_id = (req.query.folder_id as string) || req.body.folder_id;

      // Fall through to the shared processing pipeline below
    }

    // ═══════════════════════════════════════════════════════════
    // SHARED FILE PROCESSING PIPELINE (resumable & direct)
    // ═══════════════════════════════════════════════════════════

    const multerFile = req.file;
    if (!multerFile) return res.status(400).json({ error: 'No file attached. Use multipart/form-data with field name "file".' });

    // Check maintenance mode before proceeding with upload
    if (await checkMaintenanceMode('upload', req as AuthenticatedRequest, res)) return;

    const original_name = req.body.original_name || multerFile.originalname;
    const mime_type     = req.body.mime_type     || multerFile.mimetype || 'application/octet-stream';
    const ttl_hours     = req.body.ttl_hours     || null;
    const size          = multerFile.size;
    const tempFilePath  = multerFile.path;

    const user = req.user!;
  let uploadFolder: FolderRow | null = null;
    let currentStage = 'quota_lookup';
    let vaultFilePath: string | null = null;
    const streamsProgress = String(req.headers.accept || '').includes('application/x-ndjson');
    const processingTotal = 1000;
    let progressStreamStarted = false;

    const sendUploadProgress = (payload: Record<string, unknown>) => {
      if (!streamsProgress || res.writableEnded) return;
      if (!progressStreamStarted) {
        progressStreamStarted = true;
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }
      res.write(`${JSON.stringify(payload)}\n`);
    };

    let uploadSecretHash: string | null = null;
    let uploadSecretSalt: Buffer | null = null;
    let uploadSecretIv: Buffer | null = null;
    let uploadSecretIterations: number | null = null;
    let payloadAlreadyClientProtected = false;

    const finishUploadError = (statusCode: number, message: string) => {
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
      if (vaultFilePath) try { if (fs.existsSync(vaultFilePath)) fs.unlinkSync(vaultFilePath); } catch {}
      if (progressStreamStarted) {
        sendUploadProgress({ type: 'error', error: message });
        res.end();
        return;
      }
      cleanupAndRespond(res, tempFilePath, statusCode, message);
    };

    try {
      console.info('[upload] Upload received.', {
        userId: user.id,
        username: user.username,
        originalName: original_name,
        mimeType: mime_type,
        declaredSize: size,
        ttlHours: ttl_hours ?? null,
        hasUploadSecret: (req.body.upload_secret_key || '').length > 0,
        tempPath: tempFilePath,
        isResumable,
      });

      currentStage = 'validate_folder';
      const requestedFolderId = normalizeNullableFolderId(req.body.folder_id);
      if (requestedFolderId === undefined) return finishUploadError(400, 'Invalid folder id.');
      if (requestedFolderId) {
        uploadFolder = await getOwnedFolder(requestedFolderId, req.userId!);
        if (!uploadFolder) return finishUploadError(404, 'Folder not found.');
        if (uploadFolder.name === SYSTEM_UPDATE_FOLDER_NAME && uploadFolder.parent_folder_id === null) {
          return finishUploadError(400, 'Files must be uploaded into a version folder, not the update root.');
        }
        if (uploadFolder.parent_folder_id) {
          const updateRoot = await getOwnedFolder(uploadFolder.parent_folder_id, req.userId!);
          if (updateRoot?.name === SYSTEM_UPDATE_FOLDER_NAME && updateRoot.parent_folder_id === null) {
            if (req.user?.role !== 'Admin') return finishUploadError(403, 'Administrator access is required.');
            if (!isAllowedDesktopUpdateFileName(String(original_name), uploadFolder.name)) {
              return finishUploadError(400, 'Only Leeku Desktop update artifacts and activation markers are allowed in this folder.');
            }
          }
        }
      }

      // ── Optional client-side file secret metadata ─────────────
      currentStage = 'validate_upload_secret';
      const uploadSecretRaw = typeof req.body.upload_secret_key === 'string' ? req.body.upload_secret_key.trim() : '';
      const uploadSecretSaltB64 = typeof req.body.upload_secret_salt_b64 === 'string' ? req.body.upload_secret_salt_b64 : '';
      const uploadSecretIvB64 = typeof req.body.upload_secret_iv_b64 === 'string' ? req.body.upload_secret_iv_b64 : '';
      const uploadSecretIterationsRaw = typeof req.body.upload_secret_iterations === 'string' ? req.body.upload_secret_iterations : '';
      const hasClientMeta = !!(uploadSecretSaltB64 || uploadSecretIvB64 || uploadSecretIterationsRaw);
      if (uploadSecretRaw.length > 0) {
        if (uploadSecretRaw.length < 8) return finishUploadError(400, 'Secret key must contain at least 8 characters.');
        if (hasClientMeta) {
          if (!uploadSecretSaltB64 || !uploadSecretIvB64 || !uploadSecretIterationsRaw) {
            return finishUploadError(400, 'Incomplete client encryption metadata for secret-protected upload.');
          }
          const parsedIterations = Number(uploadSecretIterationsRaw);
          if (!Number.isInteger(parsedIterations) || parsedIterations < 100000 || parsedIterations > 1000000) return finishUploadError(400, 'Invalid client encryption iteration count.');
          const parsedSalt = Buffer.from(uploadSecretSaltB64, 'base64');
          const parsedIv   = Buffer.from(uploadSecretIvB64,   'base64');
          if (parsedSalt.length !== 16 || parsedIv.length !== 12) return finishUploadError(400, 'Invalid client encryption salt or IV.');
          uploadSecretIterations = parsedIterations;
          uploadSecretSalt = parsedSalt;
          uploadSecretIv   = parsedIv;
          payloadAlreadyClientProtected = true;
        }
        uploadSecretHash = await hashFileSecret(uploadSecretRaw);
      } else if (hasClientMeta) {
        return finishUploadError(400, 'Secret metadata provided without a secret key.');
      }

      // ── Quota checks ──────────────────────────────────────────
      currentStage = 'quota_lookup';
      const qReq = await getRequest();
      qReq.input('qid', sql.NVarChar(50), user.quota_id);
      const qRes = await qReq.query<Quota>('SELECT id,name,storage_limit_bytes,max_file_size_bytes,max_files,daily_upload_limit_bytes FROM quotas WHERE id=@qid');
      const quota = qRes.recordset[0];
      if (!quota) return cleanupAndRespond(res, tempFilePath, 400, 'Quota tier not found.');

      if (size > quota.max_file_size_bytes) {
        console.warn('[upload] Rejected by max file size quota.', { userId: user.id, originalName: original_name, declaredSize: size, maxFileSizeBytes: quota.max_file_size_bytes });
        return cleanupAndRespond(res, tempFilePath, 400, `File too large. Tier "${quota.name}" allows ${Math.round(quota.max_file_size_bytes/1024/1024)}MB per file.`);
      }

      const cntReq = await getRequest();
      cntReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
      const cntRes = await cntReq.query<{cnt:number;used:number}>(
        "SELECT COUNT(*) AS cnt, ISNULL(SUM(size_bytes),0) AS used FROM files WHERE owner_user_id=@ownerId AND status='Available'"
      );
      const { cnt, used } = cntRes.recordset[0];
      if (cnt >= quota.max_files) {
        console.warn('[upload] Rejected by file count quota.', { userId: user.id, fileCount: cnt, maxFiles: quota.max_files });
        return cleanupAndRespond(res, tempFilePath, 400, `File count limit reached (${quota.max_files} files).`);
      }
      if (Number(used) + size > Number(quota.storage_limit_bytes)) {
        console.warn('[upload] Rejected by storage quota.', { userId: user.id, usedBytes: used, incomingSize: size, storageLimitBytes: quota.storage_limit_bytes });
        return cleanupAndRespond(res, tempFilePath, 400, `Storage full. ${Math.round(used/1024/1024)}MB / ${Math.round(quota.storage_limit_bytes/1024/1024)}MB used.`);
      }

      // ── Heuristic pre-scan (extension-based, no file I/O) ─────
      currentStage = 'heuristic_scan';
      const heuristic = heuristicPreScan(original_name, mime_type);
      if (heuristic !== null && !heuristic.clean) {
        console.warn('[upload] Rejected by heuristic pre-scan.', { userId: user.id, originalName: original_name, threats: heuristic.threats });
        const vibe = await generateLeekuVibe(original_name, false);
        const threatDetail = heuristic.threats.length > 0 ? heuristic.threats.join('; ') : 'unknown';
        const logMsg = `Heuristic block: "${original_name}" — ${heuristic.message} [Flags: ${threatDetail}]`;
        await logSystemEvent(user.id, user.username, 'Scan', 'File', original_name, req, logMsg);
        return cleanupAndRespond(res, tempFilePath, 422, heuristic.message || vibe);
      }

      // ── Bitdefender scan (reads the temp file directly from disk) ──
      currentStage = 'bitdefender_scan';
      sendUploadProgress({
        type: 'processing',
        phase: 'Scanning file',
        loaded: 50,
        total: processingTotal,
      });
      const scanResult = await scanFilePath(tempFilePath, size);
      sendUploadProgress({
        type: 'processing',
        phase: 'Scan complete',
        loaded: 250,
        total: processingTotal,
      });
      console.info('[upload] Scan completed.', { userId: user.id, originalName: original_name, scanStatus: scanResult.status, scanDurationMs: scanResult.scanDurationMs });
      const acceptedWithoutScanner =
        scanResult.status === 'Unavailable' && ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT;

      if (!scanResult.clean && !acceptedWithoutScanner) {
        console.warn('[upload] Rejected by Bitdefender scan.', { userId: user.id, originalName: original_name, scanStatus: scanResult.status });
        const vibe = await generateLeekuVibe(original_name, false);
        await logSystemEvent(user.id, user.username, 'Scan', 'File', 'rejected', req, `AV block: "${original_name}" — ${scanResult.message}`);
        return finishUploadError(422, vibe || scanResult.message);
      }
      if (acceptedWithoutScanner) {
        console.warn('[upload] Bitdefender unavailable; accepting upload because NODE_ENV=development.', {
          userId: user.id,
          originalName: original_name,
        });
      }
      const persistedScanResult = acceptedWithoutScanner ? 'Clean' : scanResult.status;
      const persistedScanMessage = acceptedWithoutScanner
        ? `Development bypass: Bitdefender scanner unavailable; file was not scanned. ${scanResult.message}`
        : scanResult.message;

      if (uploadSecretHash && !payloadAlreadyClientProtected) {
        currentStage = 'secret_protect_fallback';
        uploadSecretIterations = 250000;
        uploadSecretSalt = crypto.randomBytes(16);
        uploadSecretIv = crypto.randomBytes(12);
        sendUploadProgress({
          type: 'processing',
          phase: 'Applying secret-key protection',
          loaded: 255,
          total: processingTotal,
        });
        await encryptClientProtectedFileInPlace(
          tempFilePath,
          uploadSecretRaw,
          uploadSecretSalt,
          uploadSecretIv,
          uploadSecretIterations,
        );
      }

      // ── Stream-encrypt directly to vault (constant memory) ─────
      currentStage = 'encrypt_file';
      const vaultFileName = generateSecureToken(16) + '.vault';
      vaultFilePath = path.join(FILE_VAULT, vaultFileName);

      sendUploadProgress({
        type: 'processing',
        phase: 'Encrypting file',
        loaded: 260,
        total: processingTotal,
      });
      const encryptResult = await encryptFileStream(tempFilePath, vaultFilePath, ({ processedBytes }) => {
        const encryptedProgress = size > 0 ? Math.min(1, processedBytes / size) : 1;
        sendUploadProgress({
          type: 'processing',
          phase: 'Encrypting file',
          loaded: 260 + Math.round(encryptedProgress * 620),
          total: processingTotal,
        });
      });
      const wrapped = wrapKey(encryptResult.key);
      sendUploadProgress({
        type: 'processing',
        phase: 'Encryption complete',
        loaded: 900,
        total: processingTotal,
      });
      console.info('[upload] Stream-encrypted to vault.', { userId: user.id, originalName: original_name, vaultFileName, encryptedSizeBytes: encryptResult.encryptedSize });

      // ── Clean up the temp file ────────────────────────────
      try { fs.unlinkSync(tempFilePath); } catch (e) { /* best effort */ }

      // ── Prepare metadata & insert DB records ──────────────────
      currentStage = 'prepare_metadata';
      const ttlH      = isValidTtl(Number(ttl_hours)) ? Number(ttl_hours) as any : null;
      const expiresAt = ttlH ? computeExpiresAt(ttlH) : null;
      const encName   = encryptColumn(original_name);
      const leekuVibe = await generateLeekuVibe(original_name, true);

      currentStage = 'insert_file_record';
      sendUploadProgress({
        type: 'processing',
        phase: 'Saving file record',
        loaded: 940,
        total: processingTotal,
      });
      const fileReq = await getRequest();
      fileReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
      fileReq.input('nEnc',   sql.VarBinary(2048), encName.ciphertext);
      fileReq.input('nIv',    sql.VarBinary(16),   encName.iv);
      fileReq.input('nTag',   sql.VarBinary(16),   encName.authTag);
      fileReq.input('spath',  sql.NVarChar(1000),  vaultFileName);
      fileReq.input('mime',   sql.NVarChar(255),   mime_type);
      fileReq.input('sz',     sql.BigInt,          size);
      fileReq.input('esz',    sql.BigInt,          encryptResult.encryptedSize);
      fileReq.input('chk',    sql.Char(64),        encryptResult.checksum);
      fileReq.input('scan',   sql.NVarChar(20),    persistedScanResult);
      fileReq.input('smsg',   sql.NVarChar(sql.MAX), persistedScanMessage);
      fileReq.input('vibe',   sql.NVarChar(500),   leekuVibe);
      fileReq.input('ttl',    sql.Int,             ttlH);
      fileReq.input('exp',    sql.DateTimeOffset,  expiresAt);
      fileReq.input('clientSecretHash', sql.NVarChar(512), uploadSecretHash);
      fileReq.input('clientCryptoSalt', sql.VarBinary(32), uploadSecretSalt);
      fileReq.input('clientCryptoIv',   sql.VarBinary(16), uploadSecretIv);
      fileReq.input('clientCryptoIterations', sql.Int, uploadSecretIterations);
       fileReq.input('folderId', sql.UniqueIdentifier, uploadFolder?.id || null);

      const fileResult = await fileReq.query<FileRow>(
        `INSERT INTO files (
         owner_user_id, folder_id, original_name_encrypted, original_name_iv, original_name_auth_tag,
           stored_path, mime_type, size_bytes, encrypted_size_bytes,
           checksum_sha256, scan_result, scan_message, scanned_at,
           leeku_vibe, ttl_hours,
           client_secret_hash, client_crypto_salt, client_crypto_iv, client_crypto_iterations,
           expires_at, is_encrypted
         )
        VALUES (@ownerId,@folderId,@nEnc,@nIv,@nTag, @spath,@mime,@sz,@esz, @chk,@scan,@smsg,SYSDATETIMEOFFSET(), @vibe,@ttl,
                 @clientSecretHash,@clientCryptoSalt,@clientCryptoIv,@clientCryptoIterations,
                 @exp,TRUE)
        RETURNING id,owner_user_id,folder_id,
          original_name_encrypted,original_name_iv,original_name_auth_tag,
          stored_path,mime_type,size_bytes,encrypted_size_bytes,status,checksum_sha256,scan_result,scan_message,
          is_encrypted,leeku_vibe,ttl_hours,
          client_secret_hash,client_crypto_salt,client_crypto_iv,client_crypto_iterations,
          expires_at,created_at`
      );
      const newFile = fileResult.recordset[0];
                newFile.folder_name = uploadFolder?.name || null;
      console.info('[upload] File record inserted.', { userId: user.id, originalName: original_name, fileId: newFile.id });

      currentStage = 'insert_key_record';
      sendUploadProgress({
        type: 'processing',
        phase: 'Saving encryption keys',
        loaded: 970,
        total: processingTotal,
      });
      const keyReq = await getRequest();
      keyReq.input('fid',   sql.UniqueIdentifier, newFile.id);
      keyReq.input('encK',  sql.VarBinary(64),    wrapped.encryptedKey);
      keyReq.input('kIv',   sql.VarBinary(16),    wrapped.iv);
      keyReq.input('kTag',  sql.VarBinary(16),    wrapped.authTag);
      keyReq.input('fIv',   sql.VarBinary(16),    encryptResult.iv);
      keyReq.input('fTag',  sql.VarBinary(16),    encryptResult.authTag);
      await keyReq.query(
        'INSERT INTO file_encryption_keys (file_id,encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag) VALUES (@fid,@encK,@kIv,@kTag,@fIv,@fTag)'
      );

      currentStage = 'update_storage_usage';
      const storageReq = await getRequest();
      storageReq.input('sz', sql.BigInt, size); storageReq.input('id', sql.UniqueIdentifier, req.userId!);
      await storageReq.query('UPDATE users SET storage_used_bytes=storage_used_bytes+@sz WHERE id=@id');

      currentStage = 'log_upload_event';
      await logSystemEvent(user.id, user.username, 'Upload', 'File', newFile.id, req,
        `Uploaded "${original_name}" (${Math.round(size/1024)}KB). Scan: ${acceptedWithoutScanner ? 'development bypass (Bitdefender unavailable)' : scanResult.status}.`);

      const mappedFile = mapFileRow(newFile, user.username);
      console.info('[upload] Upload completed successfully.', {
        userId: user.id, username: user.username, originalName: original_name,
        fileId: newFile.id, scanStatus: scanResult.status, storedScanResult: persistedScanResult, storedPath: newFile.stored_path,
      });

      if (progressStreamStarted) {
        sendUploadProgress({
          type: 'complete',
          phase: 'Complete',
          loaded: processingTotal,
          total: processingTotal,
          success: true,
          message: 'File approved and encrypted!',
          file: mappedFile,
        });
        res.end();
        return;
      }
      res.json({ success: true, message: 'File approved and encrypted!', file: mappedFile });
    } catch (err) {
      console.error('[POST /api/files/upload] Upload failed.', {
        userId: user.id, username: user.username, originalName: original_name,
        stage: currentStage, vaultFilePath,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Clean up: delete vault file and temp upload file
      if (vaultFilePath) try { if (fs.existsSync(vaultFilePath)) fs.unlinkSync(vaultFilePath); } catch {}
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
      if (progressStreamStarted) {
        sendUploadProgress({ type: 'error', error: 'Upload failed. Please try again.' });
        res.end();
        return;
      }
      res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
  }
);

/**
 * Helper: clean up the temp upload file and send an error response.
 */
function cleanupAndRespond(
  res: express.Response, tempFilePath: string,
  statusCode: number, message: string
): void {
  try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
  res.status(statusCode).json({ error: message });
}

// ──────────────────────────────────────────────────────────────
// API: Files — Delete
// ──────────────────────────────────────────────────────────────

app.post('/api/files/:id/delete', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  
  // Check maintenance mode before proceeding
  if (await checkMaintenanceMode('delete', req, res)) return;
  
  try {
    const fileReq = await getRequest();
    fileReq.input('id', sql.UniqueIdentifier, fileId);
    const fileResult = await fileReq.query<FileRow>(
      `SELECT id,owner_user_id,original_name_encrypted,original_name_iv,original_name_auth_tag,
              stored_path,size_bytes,status,mime_type,encrypted_size_bytes,checksum_sha256,
              scan_result,scan_message,is_encrypted,leeku_vibe,ttl_hours,expires_at,created_at
       FROM files WHERE id=@id`
    );
    if (!fileResult.recordset.length) return res.status(404).json({ error: 'File not found.' });
    const file = fileResult.recordset[0];
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'You do not have permission to delete this file.' });
    if (await isDesktopUpdateFile(fileId) && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'Administrator access is required for desktop update artifacts.' });

    const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
    const vaultPath = path.join(FILE_VAULT, file.stored_path);
    if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);

    const delReq = await getRequest();
    delReq.input('id', sql.UniqueIdentifier, fileId);
    await delReq.query('DELETE FROM files WHERE id=@id');

    if (file.status === 'Available') {
      const sReq = await getRequest();
      sReq.input('sz', sql.BigInt, file.size_bytes); sReq.input('uid', sql.UniqueIdentifier, file.owner_user_id);
      await sReq.query('UPDATE users SET storage_used_bytes=CASE WHEN storage_used_bytes-@sz<0 THEN 0 ELSE storage_used_bytes-@sz END WHERE id=@uid');
    }

    await logSystemEvent(req.userId!, req.user!.username, 'Delete', 'File', fileId, req, `Deleted "${originalName}".`);
    res.json({ success: true, message: 'File deleted from vault.' });
  } catch (err) { console.error('[DELETE /api/files/:id]', err); res.status(500).json({ error: 'Failed to delete file.' }); }
});

app.get('/api/files/:id/preview', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  try {
    const fileReq = await getRequest();
    fileReq.input('id', sql.UniqueIdentifier, fileId);
    const fileResult = await fileReq.query<FileRow>(
      `SELECT id,owner_user_id,original_name_encrypted,original_name_iv,original_name_auth_tag,
              stored_path,size_bytes,status,mime_type,encrypted_size_bytes,checksum_sha256,
              scan_result,scan_message,is_encrypted,leeku_vibe,ttl_hours,expires_at,created_at
       FROM files WHERE id=@id`
    );
    if (!fileResult.recordset.length) return res.status(404).json({ error: 'File not found.' });
    const file = fileResult.recordset[0];
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'You do not have permission to preview this file.' });
    if (await isDesktopUpdateFile(fileId) && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'Administrator access is required for desktop update artifacts.' });
    if (file.status === 'Blocked')
      return res.status(410).json({ error: 'Blocked files cannot be previewed.' });
    if (file.client_secret_hash)
      return res.status(403).json({ error: 'This file requires its secret key and cannot be previewed inline.' });
    const previewable = file.mime_type.startsWith('image/') || file.mime_type === 'video/mp4';
    if (!previewable)
      return res.status(415).json({ error: 'Preview is only available for images and MP4 videos.' });

    const vaultPath = path.join(FILE_VAULT, file.stored_path);
    if (!fs.existsSync(vaultPath)) return res.status(410).json({ error: 'Vault file not found.' });

    const keyReq = await getRequest();
    keyReq.input('fid', sql.UniqueIdentifier, fileId);
    const keyRes = await keyReq.query<{ encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer }>(
      'SELECT encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag FROM file_encryption_keys WHERE file_id=@fid'
    );
    if (!keyRes.recordset.length) return res.status(500).json({ error: 'Encryption key not found.' });

    const keyRow = keyRes.recordset[0];
    const fileKey = unwrapKey(keyRow.encrypted_key, keyRow.key_iv, keyRow.key_auth_tag);
    const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
    const safeName = originalName.replace(/"/g, '\\"');

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Content-Length', String(file.size_bytes));
    res.setHeader('Cache-Control', 'private, max-age=300');

    const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, keyRow.file_iv, { authTagLength: 16 });
    decipher.setAuthTag(keyRow.file_auth_tag);

    const encryptedStream = fs.createReadStream(vaultPath, { highWaterMark: 64 * 1024 });
    const abortStream = (error: unknown) => {
      console.error('[GET /api/files/:id/preview] stream error', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Preview failed.' });
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    };

    encryptedStream.on('error', abortStream);
    decipher.on('error', abortStream);
    res.on('close', () => {
      encryptedStream.destroy();
      decipher.destroy();
    });

    encryptedStream.pipe(decipher).pipe(res);
  } catch (err) { console.error('[GET /api/files/:id/preview]', err); res.status(500).json({ error: 'Preview failed.' }); }
});

app.get('/api/files/:id/download', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  let tempPath: string | null = null;
  let tempFileCleaned = false;

  const cleanupTemp = () => {
    if (tempFileCleaned) return;
    tempFileCleaned = true;
    if (tempPath) {
      unregisterTempFile(tempPath);
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    }
  };

  try {
    const fileReq = await getRequest();
    fileReq.input('id', sql.UniqueIdentifier, fileId);
    const fileResult = await fileReq.query<FileRow>(
      `SELECT id,owner_user_id,original_name_encrypted,original_name_iv,original_name_auth_tag,
      stored_path,size_bytes,status,mime_type,encrypted_size_bytes,checksum_sha256,
      scan_result,scan_message,is_encrypted,leeku_vibe,ttl_hours,
      client_secret_hash,client_crypto_salt,client_crypto_iv,client_crypto_iterations,
      expires_at,created_at
      FROM files WHERE id=@id`
    );
    if (!fileResult.recordset.length) { cleanupTemp(); return res.status(404).json({ error: 'File not found.' }); }
    const file = fileResult.recordset[0];
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      { cleanupTemp(); return res.status(403).json({ error: 'You do not have permission to download this file.' }); }
    if (await isDesktopUpdateFile(fileId) && req.user!.role !== 'Admin')
      { cleanupTemp(); return res.status(403).json({ error: 'Administrator access is required for desktop update artifacts.' }); }
    if (file.status === 'Blocked')
      { cleanupTemp(); return res.status(410).json({ error: 'Blocked files cannot be downloaded.' }); }

    const vaultPath = path.join(FILE_VAULT, file.stored_path);
    if (!fs.existsSync(vaultPath)) { cleanupTemp(); return res.status(410).json({ error: 'Vault file not found.' }); }

    const keyReq = await getRequest();
    keyReq.input('fid', sql.UniqueIdentifier, fileId);
    const keyRes = await keyReq.query<{ encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer }>(
      'SELECT encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag FROM file_encryption_keys WHERE file_id=@fid'
    );
    if (!keyRes.recordset.length) { cleanupTemp(); return res.status(500).json({ error: 'Encryption key not found.' }); }

    const keyRow = keyRes.recordset[0];
    const fileKey = unwrapKey(keyRow.encrypted_key, keyRow.key_iv, keyRow.key_auth_tag);
    const secretHeaderRaw = req.headers['x-file-secret'];
    const providedSecret = Array.isArray(secretHeaderRaw)
    ? String(secretHeaderRaw[0] || '').trim()
    : String(secretHeaderRaw || '').trim();
    if (file.client_secret_hash) {
      if (!providedSecret) { cleanupTemp(); return res.status(403).json({ error: 'This file requires a secret key to download.' }); }
      if (!(await verifyFileSecret(providedSecret, file.client_secret_hash)))
        { cleanupTemp(); return res.status(403).json({ error: 'Incorrect secret key.' }); }
    }

    // ── Streaming decrypt to temp file (avoids 2 GiB Buffer limit) ──
    tempPath = buildUniqueTempFilePath(UPLOAD_TEMP, 'leeku-dl', fileId);
    // Register the temp file so the periodic sweep can find it if cleanup is missed
    registerTempFile(tempPath);

    const hash = crypto.createHash('sha256');
    await decryptFileStream(vaultPath, tempPath, fileKey, keyRow.file_iv, keyRow.file_auth_tag, undefined, hash);

    // If the client disconnected during decryption, stop here (cleanupTemp already called via req.close)
    if (tempFileCleaned) return;

    // Verify checksum via streaming (constant memory)
    const actualChecksum = hash.digest('hex');
    if (actualChecksum !== file.checksum_sha256) {
      cleanupTemp();
      return res.status(500).json({ error: 'File integrity check failed.' });
    }

    if (file.client_secret_hash) {
      if (!file.client_crypto_salt || !file.client_crypto_iv || !file.client_crypto_iterations) {
        cleanupTemp();
        return res.status(500).json({ error: 'Secret-key metadata is missing for this file.' });
      }
      try {
        await decryptClientProtectedFileInPlace(
          tempPath, providedSecret,
          file.client_crypto_salt, file.client_crypto_iv, file.client_crypto_iterations,
        );
      } catch {
        cleanupTemp();
        return res.status(403).json({ error: 'Incorrect secret key.' });
      }
    }

    const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
    const safeName = originalName.replace(/\"/g, '\\"');
    const stat = fs.statSync(tempPath);

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', stat.size.toString());
    await logSystemEvent(req.userId!, req.user!.username, 'Download', 'File', fileId, req, `Direct download of "${originalName}".`);

    const readStream = fs.createReadStream(tempPath);
    readStream.pipe(res);
    readStream.on('end',   cleanupTemp);
    readStream.on('error', cleanupTemp);
    res.on('finish',       cleanupTemp);
    res.on('close',        cleanupTemp);
  } catch (err) {
    cleanupTemp();
    console.error('[GET /api/files/:id/download]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
  }
});

app.post('/api/files/:id/download/prepare', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  sweepPrivateDownloadSessions();
  
  // Check maintenance mode before proceeding
  if (await checkMaintenanceMode('download', req, res)) return;
  
  const fileId = req.params.id;
  try {
    const fileReq = await getRequest();
    fileReq.input('id', sql.UniqueIdentifier, fileId);
    const fileResult = await fileReq.query<FileRow>(
      `SELECT id,owner_user_id,original_name_encrypted,original_name_iv,original_name_auth_tag,
              stored_path,size_bytes,status,mime_type,encrypted_size_bytes,checksum_sha256,
              scan_result,scan_message,is_encrypted,leeku_vibe,ttl_hours,
              client_secret_hash,client_crypto_salt,client_crypto_iv,client_crypto_iterations,
              expires_at,created_at
       FROM files WHERE id=@id`
    );
    if (!fileResult.recordset.length) return res.status(404).json({ error: 'File not found.' });

    const file = fileResult.recordset[0];
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin') {
      return res.status(403).json({ error: 'You do not have permission to download this file.' });
    }
    if (await isDesktopUpdateFile(fileId) && req.user!.role !== 'Admin') {
      return res.status(403).json({ error: 'Administrator access is required for desktop update artifacts.' });
    }
    if (file.status === 'Blocked') {
      return res.status(410).json({ error: 'Blocked files cannot be downloaded.' });
    }

    const vaultPath = path.join(FILE_VAULT, file.stored_path);
    if (!fs.existsSync(vaultPath)) return res.status(410).json({ error: 'Vault file not found.' });

    const keyReq = await getRequest();
    keyReq.input('fid', sql.UniqueIdentifier, fileId);
    const keyRes = await keyReq.query<{ encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer }>(
      'SELECT encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag FROM file_encryption_keys WHERE file_id=@fid'
    );
    if (!keyRes.recordset.length) return res.status(500).json({ error: 'Encryption key not found.' });

    const secretHeaderRaw = req.headers['x-file-secret'];
    const providedSecret = Array.isArray(secretHeaderRaw)
      ? String(secretHeaderRaw[0] || '').trim()
      : String(secretHeaderRaw || '').trim();
    if (file.client_secret_hash) {
      if (!providedSecret) return res.status(403).json({ error: 'This file requires a secret key to download.' });
      if (!(await verifyFileSecret(providedSecret, file.client_secret_hash))) {
        return res.status(403).json({ error: 'Incorrect secret key.' });
      }
    }

    const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
    const tempFile = buildUniqueTempFilePath(UPLOAD_TEMP, 'leeku-dl', fileId);
    registerTempFile(tempFile);
    const encryptedSize = Number(file.encrypted_size_bytes || 0) || fs.statSync(vaultPath).size;
    const sessionId = crypto.randomUUID();
    const session: PrivateDownloadSession = {
      id: sessionId,
      userId: req.userId!,
      fileId,
      originalName,
      mimeType: file.mime_type || 'application/octet-stream',
      tempFile,
      sizeBytes: Number(file.size_bytes || 0),
      status: 'preparing',
      phase: 'decrypting',
      loaded: 0,
      total: encryptedSize,
      expiresAt: Date.now() + PRIVATE_DOWNLOAD_SESSION_TTL_MS,
      claimed: false,
    };
    privateDownloadSessions.set(sessionId, session);
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    if (clientDisconnected) {
      removePrivateDownloadSession(sessionId);
      return;
    }

    const current = privateDownloadSessions.get(sessionId);

    const keyRow = keyRes.recordset[0];
    const fileKey = unwrapKey(keyRow.encrypted_key, keyRow.key_iv, keyRow.key_auth_tag);

    void (async () => {
      try {
        const hash = crypto.createHash('sha256');

        await decryptFileStream(vaultPath, tempFile, fileKey, keyRow.file_iv, keyRow.file_auth_tag, ({ processedBytes, totalBytes }) => {
          const current = privateDownloadSessions.get(sessionId);
          if (!current) return;
          current.phase = 'decrypting';
          current.loaded = processedBytes;
          current.total = totalBytes;
          current.expiresAt = Date.now() + PRIVATE_DOWNLOAD_SESSION_TTL_MS;
        }, hash);   // ← pass hash into decryptFileStream

        const current = privateDownloadSessions.get(sessionId);
        if (!current) return;
        current.phase = 'verifying';
        current.loaded = 0;
        current.total = current.sizeBytes || 1;

        // ── Checksum already computed during decryption — just compare ──
        const checksum = hash.digest('hex');

        if (checksum !== file.checksum_sha256) {
          throw new Error('File integrity check failed.');
        }

        current.loaded = current.sizeBytes;
        current.total = current.sizeBytes;

        if (file.client_secret_hash) {
          if (!file.client_crypto_salt || !file.client_crypto_iv || !file.client_crypto_iterations) {
            throw new Error('Secret-key metadata is missing for this file.');
          }

          const active = privateDownloadSessions.get(sessionId);
          if (!active) return;
          active.phase = 'finalizing';
          active.loaded = 0;
          active.total = 1;

          await decryptClientProtectedFileInPlace(
            tempFile,
            providedSecret,
            file.client_crypto_salt,
            file.client_crypto_iv,
            file.client_crypto_iterations,
          );
          active.loaded = 1;
          active.total = 1;
        }

        const ready = privateDownloadSessions.get(sessionId);
        if (!ready) return;
        ready.status = 'ready';
        ready.phase = 'ready';
        ready.loaded = ready.sizeBytes;
        ready.total = ready.sizeBytes;
        ready.expiresAt = Date.now() + PRIVATE_DOWNLOAD_SESSION_TTL_MS;
      } catch (error) {
        const failed = privateDownloadSessions.get(sessionId);
        if (failed) {
          failed.status = 'error';
          failed.phase = 'error';
          failed.error = error instanceof Error ? error.message : 'Download failed.';
          failed.expiresAt = Date.now() + 30_000;
        }
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
      }
    })();

    res.status(202).json({
      download_id: sessionId,
      status_url: `/api/files/${fileId}/download/${sessionId}/status`,
      file_url: `/api/files/${fileId}/download/${sessionId}/file`,
    });
  } catch (err) {
    console.error('[POST /api/files/:id/download/prepare]', err);
    res.status(500).json({ error: 'Download failed.' });
  }
});

app.get('/api/files/:id/download/:downloadId/status', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  sweepPrivateDownloadSessions();
  const { id: fileId, downloadId } = req.params;
  const session = privateDownloadSessions.get(downloadId);
  if (!session || session.fileId !== fileId || session.userId !== req.userId) {
    return res.status(404).json({ error: 'Download session not found. Wait a few seconds.' });
  }

  res.json({
    status: session.status,
    phase: session.phase,
    loaded: session.loaded,
    total: session.total,
    size: session.sizeBytes,
    error: session.error || null,
    file_url: session.status === 'ready'
      ? `/api/files/${fileId}/download/${downloadId}/file`
      : null,
  });
});

app.get('/api/files/:id/download/:downloadId/file', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  sweepPrivateDownloadSessions();
  const { id: fileId, downloadId } = req.params;
  const session = privateDownloadSessions.get(downloadId);
  if (!session || session.fileId !== fileId || session.userId !== req.userId) {
    return res.status(404).json({ error: 'Download session not found. Wait a few seconds.' });
  }
  if (session.status === 'error') {
    const errorMessage = session.error || 'Download failed.';
    removePrivateDownloadSession(downloadId);
    return res.status(500).json({ error: errorMessage });
  }
  if (session.status !== 'ready') {
    return res.status(409).json({ error: 'Download is still being prepared.' });
  }
  if (session.claimed) {
    return res.status(409).json({ error: 'This download session has already been used.' });
  }

  session.claimed = true;

  // Listen for early client disconnect before the stream is set up
  let streamPiped = false;
  req.on('close', () => {
    removePrivateDownloadSession(downloadId);
  });

  try {
    const safeName = session.originalName.replace(/\"/g, '\\"');
    const stat = fs.statSync(session.tempFile);

    res.setHeader('Content-Type', session.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', stat.size.toString());
    await logSystemEvent(req.userId!, req.user!.username, 'Download', 'File', fileId, req, `Direct download of "${session.originalName}".`);

    const readStream = fs.createReadStream(session.tempFile);
    streamPiped = true;
    readStream.pipe(res);
    readStream.on('end', () => removePrivateDownloadSession(downloadId));
    readStream.on('error', () => removePrivateDownloadSession(downloadId));
    res.on('finish', () => removePrivateDownloadSession(downloadId));
    res.on('close', () => removePrivateDownloadSession(downloadId));
  } catch (err) {
    session.claimed = false;
    console.error('[GET /api/files/:id/download/:downloadId/file]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// API: Share Links
// ──────────────────────────────────────────────────────────────

app.get('/api/sharing/links', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const request = await getRequest();
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    request.input('systemFolderName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
    const result = await request.query<ShareRow & { stored_path: string }>(
      `SELECT sl.id,sl.file_id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,sl.created_at,f.stored_path
       FROM share_links sl
       INNER JOIN files f ON sl.file_id=f.id
       WHERE f.owner_user_id=@ownerId
         AND NOT EXISTS (
           SELECT 1
           FROM file_folders release_folder
           INNER JOIN file_folders update_root ON update_root.id=release_folder.parent_folder_id
           WHERE release_folder.id=f.folder_id
             AND update_root.parent_folder_id IS NULL
             AND update_root.name=@systemFolderName
         )
       ORDER BY sl.created_at DESC`
    );
    const folderRequest = await getRequest();
    folderRequest.input('ownerId', sql.UniqueIdentifier, req.userId!);
    folderRequest.input('systemFolderName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
    const folderResult = await folderRequest.query<FolderShareRow>(
      `SELECT fsl.id,fsl.folder_id,fsl.public_token,fsl.password_hash,fsl.expires_at,fsl.is_active,fsl.created_at
       FROM folder_share_links fsl
       INNER JOIN file_folders ff ON ff.id=fsl.folder_id
       WHERE ff.owner_user_id=@ownerId
         AND NOT EXISTS (
           SELECT 1 FROM file_folders system_root
           WHERE system_root.owner_user_id=@ownerId
             AND system_root.parent_folder_id IS NULL
             AND system_root.name=@systemFolderName
             AND (system_root.id=ff.id OR system_root.id=ff.parent_folder_id)
         )
       ORDER BY fsl.created_at DESC`,
    );
    res.json({
      links: result.recordset.map((row) => ({
        ...mapShareRow(row),
        is_available: fs.existsSync(path.join(FILE_VAULT, row.stored_path)),
      })),
      folder_links: folderResult.recordset.map(mapFolderShareRow),
    });
  } catch (err) { console.error('[GET /api/sharing/links]', err); res.status(500).json({ error: 'Failed to load share links.' }); }
});

const removeSharingLink = async (req: AuthenticatedRequest, res: express.Response) => {
  const linkId = req.params.id;
  try {
    const findRequest = await getRequest();
    findRequest.input('id', sql.UniqueIdentifier, linkId);
    const result = await findRequest.query<{file_id:string;owner_user_id:string}>(
      `SELECT sl.file_id,f.owner_user_id
       FROM share_links sl INNER JOIN files f ON sl.file_id=f.id
       WHERE sl.id=@id`
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'Share link not found.' });
    const link = result.recordset[0];
    if (link.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'Only the file owner can remove share links.' });

    const deleteRequest = await getRequest();
    deleteRequest.input('id', sql.UniqueIdentifier, linkId);
    await deleteRequest.query('DELETE FROM share_links WHERE id=@id');

    await logSystemEvent(req.userId!, req.user!.username, 'Delete', 'ShareLink', linkId, req, `Removed share link for file ${link.file_id}.`);
    res.json({ success: true });
  } catch (err) { console.error('[remove sharing link]', err); res.status(500).json({ error: 'Failed to remove share link.' }); }
};

// Keep DELETE for API clients, and provide POST for IIS installations that filter DELETE verbs.
app.delete('/api/sharing/links/:id', authenticateUser as express.RequestHandler, removeSharingLink);
app.post('/api/sharing/links/:id/remove', authenticateUser as express.RequestHandler, removeSharingLink);

app.post('/api/sharing/folder-links/:id/remove', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const findRequest = await getRequest();
    findRequest.input('id', sql.UniqueIdentifier, req.params.id);
    const result = await findRequest.query<{ folder_id: string; owner_user_id: string }>(
      `SELECT fsl.folder_id,ff.owner_user_id
       FROM folder_share_links fsl
       INNER JOIN file_folders ff ON ff.id=fsl.folder_id
       WHERE fsl.id=@id`,
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'Folder share link not found.' });
    const link = result.recordset[0];
    if (link.owner_user_id !== req.userId && req.user!.role !== 'Admin') {
      return res.status(403).json({ error: 'Only the folder owner can remove share links.' });
    }
    const deleteRequest = await getRequest();
    deleteRequest.input('id', sql.UniqueIdentifier, req.params.id);
    await deleteRequest.query('DELETE FROM folder_share_links WHERE id=@id');
    await logSystemEvent(req.userId!, req.user!.username, 'Delete', 'FolderShareLink', req.params.id, req, `Removed share link for folder ${link.folder_id}.`);
    res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/sharing/folder-links/:id/remove]', err);
    res.status(500).json({ error: 'Failed to remove folder share link.' });
  }
});

app.post('/api/file-folders/:id/share', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const folderId = req.params.id;
  if (!UUID_PATTERN.test(folderId)) return res.status(400).json({ error: 'Invalid folder id.' });
  const { password, expires_at, is_active } = req.body || {};
  try {
    const folder = await getOwnedFolder(folderId, req.userId!);
    if (!folder && req.user!.role !== 'Admin') return res.status(404).json({ error: 'Folder not found.' });
    const folderRequest = await getRequest();
    folderRequest.input('id', sql.UniqueIdentifier, folderId);
    const folderResult = await folderRequest.query<FolderRow>(
      'SELECT id,owner_user_id,parent_folder_id,name,created_at,updated_at FROM file_folders WHERE id=@id',
    );
    const targetFolder = folderResult.recordset[0];
    if (!targetFolder) return res.status(404).json({ error: 'Folder not found.' });
    if (targetFolder.owner_user_id !== req.userId && req.user!.role !== 'Admin') {
      return res.status(403).json({ error: 'Only the folder owner can manage share links.' });
    }

    const systemRequest = await getRequest();
    systemRequest.input('folderId', sql.UniqueIdentifier, folderId);
    systemRequest.input('systemFolderName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
    const systemResult = await systemRequest.query<{ is_system: number }>(
      `WITH RECURSIVE ancestors AS (
         SELECT id,parent_folder_id,name,0 AS depth FROM file_folders WHERE id=@folderId
         UNION ALL
         SELECT ff.id,ff.parent_folder_id,ff.name,a.depth+1 FROM file_folders ff INNER JOIN ancestors a ON ff.id=a.parent_folder_id
         WHERE a.depth<5
       )
       SELECT COUNT(*) AS is_system FROM ancestors WHERE parent_folder_id IS NULL AND name=@systemFolderName`,
    );
    if (Number(systemResult.recordset[0]?.is_system || 0) > 0) {
      return res.status(403).json({ error: 'Desktop update folders cannot be shared.' });
    }

    const existingRequest = await getRequest();
    existingRequest.input('folderId', sql.UniqueIdentifier, folderId);
    const existing = await existingRequest.query<FolderShareRow>(
      'SELECT id,folder_id,public_token,password_hash,expires_at,is_active,created_at FROM folder_share_links WHERE folder_id=@folderId',
    );
    let shareRow: FolderShareRow;
    if (!existing.recordset.length) {
      const insertRequest = await getRequest();
      insertRequest.input('folderId', sql.UniqueIdentifier, folderId);
      insertRequest.input('token', sql.Char(32), generateSecureToken(16));
      insertRequest.input('passwordHash', sql.NVarChar(256), password ? await hashSharePassword(password) : null);
      insertRequest.input('expiresAt', sql.DateTimeOffset, expires_at || null);
      insertRequest.input('active', sql.Bit, is_active === false ? 0 : 1);
      const inserted = await insertRequest.query<FolderShareRow>(
        `INSERT INTO folder_share_links (folder_id,public_token,password_hash,expires_at,is_active)
         VALUES (@folderId,@token,@passwordHash,@expiresAt,@active)
         RETURNING id,folder_id,public_token,password_hash,expires_at,is_active,created_at`,
      );
      shareRow = inserted.recordset[0];
    } else {
      shareRow = existing.recordset[0];
      const sets: string[] = [];
      const updateRequest = await getRequest();
      updateRequest.input('id', sql.UniqueIdentifier, shareRow.id);
      if (is_active === true && !shareRow.is_active) {
        updateRequest.input('token', sql.Char(32), generateSecureToken(16));
        sets.push('public_token=@token');
      }
      if (password !== undefined) {
        updateRequest.input('passwordHash', sql.NVarChar(256), password ? await hashSharePassword(password) : null);
        sets.push('password_hash=@passwordHash');
      }
      if (expires_at !== undefined) {
        updateRequest.input('expiresAt', sql.DateTimeOffset, expires_at || null);
        sets.push('expires_at=@expiresAt');
      }
      if (is_active !== undefined) {
        updateRequest.input('active', sql.Bit, is_active ? 1 : 0);
        sets.push('is_active=@active');
      }
      if (sets.length) {
        const updated = await updateRequest.query<FolderShareRow>(
          `UPDATE folder_share_links SET ${sets.join(',')}
           WHERE id=@id
           RETURNING id,folder_id,public_token,password_hash,expires_at,is_active,created_at`,
        );
        shareRow = updated.recordset[0];
      }
    }
    await logSystemEvent(req.userId!, req.user!.username, 'Link', 'FolderShareLink', shareRow.id, req, `Configured share for folder ${folderId}.`);
    res.json({ success: true, link: mapFolderShareRow(shareRow) });
  } catch (err) {
    console.error('[POST /api/file-folders/:id/share]', err);
    res.status(500).json({ error: 'Failed to configure folder share link.' });
  }
});

app.post('/api/files/:id/share', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  const { password, expires_at, max_downloads, is_active, allow_external_preview } = req.body;
  try {
    const fReq = await getRequest(); fReq.input('id', sql.UniqueIdentifier, fileId);
    const fRes = await fReq.query<{owner_user_id:string;status:string;stored_path:string;mime_type:string;client_secret_hash:string|null}>(
      'SELECT owner_user_id,status,stored_path,mime_type,client_secret_hash FROM files WHERE id=@id'
    );
    if (!fRes.recordset.length) return res.status(404).json({ error: 'File not found.' });
    const file = fRes.recordset[0];
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'Only the file owner can manage share links.' });
    if (await isDesktopUpdateFile(fileId))
      return res.status(403).json({ error: 'Desktop update artifacts cannot be shared.' });
    if (file.status === 'Blocked') return res.status(400).json({ error: 'Blocked files cannot be shared.' });
    if (!fs.existsSync(path.join(FILE_VAULT, file.stored_path)))
      return res.status(410).json({ error: 'This file is no longer available in the vault.' });

    const exReq = await getRequest(); exReq.input('fid', sql.UniqueIdentifier, fileId);
    const existing = await exReq.query<ShareRow>(
      'SELECT id,file_id,public_token,password_hash,expires_at,max_downloads,download_count,is_active,allow_external_preview,created_at FROM share_links WHERE file_id=@fid'
    );

    let shareRow: ShareRow;
    if (!existing.recordset.length) {
      const allowExternalPreview = !!allow_external_preview;
      if (allowExternalPreview) {
        if (!file.mime_type.startsWith('image/') && !file.mime_type.startsWith('video/'))
          return res.status(400).json({ error: 'External preview is only supported for image and video files.' });
        if (password)
          return res.status(400).json({ error: 'External preview links cannot use a share password.' });
        if (file.client_secret_hash)
          return res.status(400).json({ error: 'Files protected with a secret key cannot use external preview.' });
      }
      const token = generateSecureToken(16);
      const pwH   = password ? await hashSharePassword(password) : null;
      const insReq = await getRequest();
      insReq.input('fid',   sql.UniqueIdentifier, fileId);
      insReq.input('tok',   sql.Char(32),         token);
      insReq.input('pwH',   sql.NVarChar(256),    pwH);
      insReq.input('exp',   sql.DateTimeOffset,   expires_at || null);
      insReq.input('md',    sql.Int,              max_downloads ? Number(max_downloads) : null);
      insReq.input('act',   sql.Bit,              is_active !== undefined ? (is_active ? 1 : 0) : 1);
      insReq.input('allowExternalPreview', sql.Bit, allowExternalPreview ? 1 : 0);
      const insRes = await insReq.query<ShareRow>(
        `INSERT INTO share_links (file_id,public_token,password_hash,expires_at,max_downloads,is_active,allow_external_preview)
        VALUES (@fid,@tok,@pwH,@exp,@md,@act,@allowExternalPreview)
        RETURNING id,file_id,public_token,password_hash,expires_at,max_downloads,download_count,is_active,allow_external_preview,created_at`
      );
      shareRow = insRes.recordset[0];
    } else {
      shareRow = existing.recordset[0];
      const sets: string[] = [];
      const upReq = await getRequest(); upReq.input('id', sql.UniqueIdentifier, shareRow.id);
      const nextPasswordProtected =
        password !== undefined ? !!password : !!shareRow.password_hash;
      const nextAllowExternalPreview =
        allow_external_preview !== undefined
          ? !!allow_external_preview
          : !!shareRow.allow_external_preview;
      const nextMaxDownloads =
        max_downloads !== undefined
          ? (max_downloads ? Number(max_downloads) : null)
          : shareRow.max_downloads;
      if (nextAllowExternalPreview) {
        if (!file.mime_type.startsWith('image/') && !file.mime_type.startsWith('video/'))
          return res.status(400).json({ error: 'External preview is only supported for image and video files.' });
        if (nextPasswordProtected)
          return res.status(400).json({ error: 'External preview links cannot use a share password.' });
        if (file.client_secret_hash)
          return res.status(400).json({ error: 'Files protected with a secret key cannot use external preview.' });
      }
      if (
        (is_active === true && !shareRow.is_active) ||
        (max_downloads !== undefined && nextMaxDownloads !== shareRow.max_downloads)
      ) {
        upReq.input('newToken', sql.Char(32), generateSecureToken(16));
        sets.push('public_token=@newToken', 'download_count=0');
      }
      if (password !== undefined) { upReq.input('pw', sql.NVarChar(256), password ? await hashSharePassword(password) : null); sets.push('password_hash=@pw'); }
      if (expires_at !== undefined) { upReq.input('exp', sql.DateTimeOffset, expires_at||null); sets.push('expires_at=@exp'); }
      if (max_downloads !== undefined) { upReq.input('md', sql.Int, nextMaxDownloads); sets.push('max_downloads=@md'); }
      if (is_active !== undefined) { upReq.input('act', sql.Bit, is_active ? 1 : 0); sets.push('is_active=@act'); }
      if (allow_external_preview !== undefined) {
        upReq.input('allowExternalPreview', sql.Bit, allow_external_preview ? 1 : 0);
        sets.push('allow_external_preview=@allowExternalPreview');
      }
      if (sets.length) {
        const upRes = await upReq.query<ShareRow>(
          `UPDATE share_links SET ${sets.join(',')}
            WHERE id=@id
            RETURNING id,file_id,public_token,password_hash,expires_at,max_downloads,download_count,is_active,allow_external_preview,created_at`
        );
        shareRow = upRes.recordset[0];
      }
    }

    await logSystemEvent(req.userId!, req.user!.username, 'Link', 'ShareLink', shareRow.id, req, `Configured share for file ${fileId}.`);
    res.json({ success: true, link: mapShareRow(shareRow) });
  } catch (err) { console.error('[POST /api/files/:id/share]', err); res.status(500).json({ error: 'Failed to configure share link.' }); }
});

app.use('/api/public/share', createPublicSharingRouter({
  vaultPath: FILE_VAULT,
  tempPath: UPLOAD_TEMP,
  profilePictureRoot: PROFILE_PICTURE_PATH,
  logDownload: (req, fileId, originalName, token) =>
    logSystemEvent(null, 'Anonymous', 'Download', 'File', fileId, req, `Anonymous download of "${originalName}" via token ${token}.`),
}));

app.use('/api/public/folder', createPublicFolderSharingRouter({
  vaultPath: FILE_VAULT,
  tempPath: UPLOAD_TEMP,
  profilePictureRoot: PROFILE_PICTURE_PATH,
  logDownload: (req, fileId, originalName, token) =>
    logSystemEvent(null, 'Anonymous', 'Download', 'File', fileId, req, `Anonymous folder-share download of "${originalName}" via token ${token}.`),
}));

app.use(createDesktopUpdatesRouter({
  vaultPath: FILE_VAULT,
  tempPath: UPLOAD_TEMP,
}));

// ──────────────────────────────────────────────────────────────
// API: Admin
// ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req, res) => {
  try {
    const request = await getRequest();
    const result = await request.query<UserRow>(
      `SELECT id,email_encrypted,email_iv,email_auth_tag,username_encrypted,username_iv,username_auth_tag,
              role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.recordset.map(mapUserRow) });
  } catch (err) { console.error('[GET /api/admin/users]', err); res.status(500).json({ error: 'Failed to load users.' }); }
});

app.post('/api/admin/users/create-dummy', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const usernameRaw = String(req.body?.username || '').trim();
  const passwordRaw = String(req.body?.password || '').trim();
  const requestedQuotaId = String(req.body?.quota_id || 'guest').trim() || 'guest';

  if (!usernameRaw || usernameRaw.length < 3 || usernameRaw.length > 64) {
    return res.status(400).json({ error: 'Username must be between 3 and 64 characters.' });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(usernameRaw)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, dot, underscore, and hyphen.' });
  }
  if (!passwordRaw || passwordRaw.length < 8 || passwordRaw.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  const username = usernameRaw;
  const email = `${username.toLowerCase()}@dummy.local`;
  const usernameHash = hashColumnForLookup(username.toLowerCase());
  const emailHash = hashColumnForLookup(email);

  try {
    const quotaCheckReq = await getRequest();
    quotaCheckReq.input('qid', sql.NVarChar(50), requestedQuotaId);
    const quotaCheck = await quotaCheckReq.query<{ c: number }>('SELECT COUNT(*) AS c FROM quotas WHERE id=@qid');
    if (!quotaCheck.recordset[0].c) {
      return res.status(400).json({ error: 'Quota tier not found.' });
    }

    const dupReq = await getRequest();
    dupReq.input('uH', sql.Char(64), usernameHash);
    dupReq.input('eH', sql.Char(64), emailHash);
    const dup = await dupReq.query<{ usernameExists: number; emailExists: number }>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE username_hash=@uH) AS usernameExists,
         (SELECT COUNT(*) FROM users WHERE email_hash=@eH) AS emailExists`
    );
    if (dup.recordset[0].usernameExists > 0) {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    if (dup.recordset[0].emailExists > 0) {
      return res.status(400).json({ error: 'Dummy email already exists for this username.' });
    }

    const encEmail = encryptColumn(email);
    const encUsername = encryptColumn(username);
    const passwordHash = await hashPassword(passwordRaw);

    const insertReq = await getRequest();
    insertReq.input('eEnc', sql.VarBinary(512), encEmail.ciphertext);
    insertReq.input('eIv', sql.VarBinary(16), encEmail.iv);
    insertReq.input('eTag', sql.VarBinary(16), encEmail.authTag);
    insertReq.input('eHash', sql.Char(64), emailHash);
    insertReq.input('uEnc', sql.VarBinary(512), encUsername.ciphertext);
    insertReq.input('uIv', sql.VarBinary(16), encUsername.iv);
    insertReq.input('uTag', sql.VarBinary(16), encUsername.authTag);
    insertReq.input('uHash', sql.Char(64), usernameHash);
    insertReq.input('pw', sql.NVarChar(512), passwordHash);
    insertReq.input('quota', sql.NVarChar(50), requestedQuotaId);

    const created = await insertReq.query<UserRow>(
      `INSERT INTO users (
         email_encrypted, email_iv, email_auth_tag, email_hash,
         username_encrypted, username_iv, username_auth_tag, username_hash,
         password_hash, quota_id, role, status,
         email_verified, email_verification_token, email_verification_expires
       )
      VALUES (@eEnc,@eIv,@eTag,@eHash, @uEnc,@uIv,@uTag,@uHash, @pw,@quota, N'User', N'Active', TRUE, NULL, NULL)
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until`
    );

    const user = mapUserRow(created.recordset[0]);
    await logSystemEvent(
      req.userId!,
      req.user!.username,
      'Admin',
      'User',
      user.id,
      req,
      `Created dummy account "${username}" (${email}).`
    );

    res.json({ success: true, user });
  } catch (err) {
    console.error('[POST /api/admin/users/create-dummy]', err);
    res.status(500).json({ error: 'Failed to create dummy user account.' });
  }
});

app.post('/api/admin/users/:id/reset-password', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const userId = req.params.id;
  const newPassword = String(req.body?.password || '').trim();
  if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  try {
    const findReq = await getRequest();
    findReq.input('id', sql.UniqueIdentifier, userId);
    const found = await findReq.query<UserRow>(
      `SELECT id,email_encrypted,email_iv,email_auth_tag,username_encrypted,username_iv,username_auth_tag,
              role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until
       FROM users WHERE id=@id`
    );
    if (!found.recordset.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const passwordHash = await hashPassword(newPassword);
    const updateReq = await getRequest();
    updateReq.input('id', sql.UniqueIdentifier, userId);
    updateReq.input('pw', sql.NVarChar(512), passwordHash);
    const updated = await updateReq.query<UserRow>(
      `UPDATE users
       SET password_hash=@pw, failed_login_count=0, locked_until=NULL
      WHERE id=@id
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until`
    );
    const user = mapUserRow(updated.recordset[0]);

    await revokeAllRefreshSessions(userId);

    await logSystemEvent(
      req.userId!,
      req.user!.username,
      'Security',
      'User',
      userId,
      req,
      `Admin reset password for "${user.username}".`
    );

    res.json({ success: true, user });
  } catch (err) {
    console.error('[POST /api/admin/users/:id/reset-password]', err);
    res.status(500).json({ error: 'Failed to reset user password.' });
  }
});

app.post('/api/admin/users/:id/suspend', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const userId = req.params.id;
  try {
    const uReq = await getRequest(); uReq.input('id', sql.UniqueIdentifier, userId);
    const uRes = await uReq.query<UserRow>(
      'SELECT id,email_encrypted,email_iv,email_auth_tag,username_encrypted,username_iv,username_auth_tag,role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until FROM users WHERE id=@id'
    );
    if (!uRes.recordset.length) return res.status(404).json({ error: 'User not found.' });
    const row = uRes.recordset[0];
    if (row.role === 'Admin' && req.userId !== userId)
      return res.status(403).json({ error: 'Cannot suspend another admin.' });

    const newStatus = row.status === 'Active' ? 'Suspended' : 'Active';
    const upReq = await getRequest(); upReq.input('s', sql.NVarChar(20), newStatus); upReq.input('id', sql.UniqueIdentifier, userId);
    const updated = await upReq.query<UserRow>(
      `UPDATE users SET status=@s
      WHERE id=@id
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until`
    );
    const user = mapUserRow(updated.recordset[0]);
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'User', userId, req, `Toggled status of "${user.username}" to ${newStatus}.`);
    res.json({ success: true, user });
  } catch (err) { console.error('[POST /api/admin/users/:id/suspend]', err); res.status(500).json({ error: 'Failed to update user.' }); }
});

app.post('/api/admin/users/:id/quota', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const { quota_id } = req.body; const userId = req.params.id;
  try {
    const qC = await getRequest(); qC.input('qid', sql.NVarChar(50), quota_id);
    const qR = await qC.query<{c:number}>('SELECT COUNT(*) AS c FROM quotas WHERE id=@qid');
    if (!qR.recordset[0].c) return res.status(400).json({ error: 'Quota tier not found.' });

    const upReq = await getRequest(); upReq.input('q', sql.NVarChar(50), quota_id); upReq.input('id', sql.UniqueIdentifier, userId);
    const updated = await upReq.query<UserRow>(
      `UPDATE users SET quota_id=@q
      WHERE id=@id
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until`
    );
    if (!updated.recordset.length) return res.status(404).json({ error: 'User not found.' });
    const user = mapUserRow(updated.recordset[0]);
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'User', userId, req, `Changed quota of "${user.username}" to "${quota_id}".`);
    res.json({ success: true, user });
  } catch (err) { console.error('[POST /api/admin/users/:id/quota]', err); res.status(500).json({ error: 'Failed to update quota.' }); }
});

app.post('/api/admin/users/:id/edit', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const userId = req.params.id; const { username, email, role, status, password } = req.body;
  try {
    const sets: string[] = []; const upReq = await getRequest(); upReq.input('id', sql.UniqueIdentifier, userId);
    if (username !== undefined) {
      const t = username.trim(); const h = hashColumnForLookup(t.toLowerCase());
      const d = await getRequest(); d.input('h', sql.Char(64), h); d.input('id', sql.UniqueIdentifier, userId);
      const dr = await d.query<{c:number}>('SELECT COUNT(*) AS c FROM users WHERE username_hash=@h AND id!=@id');
      if (dr.recordset[0].c) return res.status(400).json({ error: 'Username already taken.' });
      const enc = encryptColumn(t);
      upReq.input('uE', sql.VarBinary(512), enc.ciphertext); upReq.input('uI', sql.VarBinary(16), enc.iv);
      upReq.input('uT', sql.VarBinary(16), enc.authTag); upReq.input('uH', sql.Char(64), h);
      sets.push('username_encrypted=@uE,username_iv=@uI,username_auth_tag=@uT,username_hash=@uH');
    }
    if (email !== undefined) {
      const te = email.toLowerCase().trim(); const h = hashColumnForLookup(te);
      const d = await getRequest(); d.input('h', sql.Char(64), h); d.input('id', sql.UniqueIdentifier, userId);
      const dr = await d.query<{c:number}>('SELECT COUNT(*) AS c FROM users WHERE email_hash=@h AND id!=@id');
      if (dr.recordset[0].c) return res.status(400).json({ error: 'Email already in use.' });
      const enc = encryptColumn(te);
      upReq.input('eE', sql.VarBinary(512), enc.ciphertext); upReq.input('eI', sql.VarBinary(16), enc.iv);
      upReq.input('eT', sql.VarBinary(16), enc.authTag); upReq.input('eH', sql.Char(64), h);
      sets.push('email_encrypted=@eE,email_iv=@eI,email_auth_tag=@eT,email_hash=@eH');
    }
    if (role && ['Admin','User'].includes(role)) { upReq.input('role', sql.NVarChar(10), role); sets.push('role=@role'); }
    if (status && ['Active','Suspended'].includes(status)) { upReq.input('st', sql.NVarChar(20), status); sets.push('status=@st'); }
    if (password?.trim()) { const h = await hashPassword(password.trim()); upReq.input('pw', sql.NVarChar(512), h); sets.push('password_hash=@pw'); }
    if (!sets.length) return res.status(400).json({ error: 'No changes to apply.' });

    const updated = await upReq.query<UserRow>(
      `UPDATE users SET ${sets.join(',')}
      WHERE id=@id
      RETURNING id,email_encrypted,email_iv,email_auth_tag,
        username_encrypted,username_iv,username_auth_tag,
        role,quota_id,storage_used_bytes,status,created_at,failed_login_count,locked_until`
    );
    if (!updated.recordset.length) return res.status(404).json({ error: 'User not found.' });
    const user = mapUserRow(updated.recordset[0]);
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'User', userId, req, `Admin edited "${user.username}".`);
    res.json({ success: true, user });
  } catch (err) { console.error('[POST /api/admin/users/:id/edit]', err); res.status(500).json({ error: 'Failed to edit user.' }); }
});

app.get('/api/admin/files', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req, res) => {
  try {
    const request = await getRequest();
    const result = await request.query<FileRow & {username_encrypted:Buffer;username_iv:Buffer;username_auth_tag:Buffer}>(
      `SELECT f.id,f.owner_user_id,f.folder_id,ff.name AS folder_name,f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
              f.stored_path,f.mime_type,f.size_bytes,f.encrypted_size_bytes,f.status,f.checksum_sha256,
              f.scan_result,f.scan_message,f.is_encrypted,f.leeku_vibe,f.ttl_hours,f.expires_at,f.created_at,
              u.username_encrypted,u.username_iv,u.username_auth_tag
       FROM files f
       INNER JOIN users u ON f.owner_user_id=u.id
       LEFT JOIN file_folders ff ON f.folder_id=ff.id
       ORDER BY f.created_at DESC`
    );
    res.json({ files: result.recordset.map(r => mapFileRow(r, decryptColumn(r.username_encrypted, r.username_iv, r.username_auth_tag))) });
  } catch (err) { console.error('[GET /api/admin/files]', err); res.status(500).json({ error: 'Failed to load files.' }); }
});

app.get('/api/admin/file-folders', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req, res) => {
  try {
    const request = await getRequest();
    const result = await request.query<AdminFolderRow>(
      `SELECT ff.id, ff.owner_user_id, ff.parent_folder_id, ff.name, ff.created_at, ff.updated_at,
              COUNT(f.id) AS file_count,
              u.username_encrypted, u.username_iv, u.username_auth_tag
       FROM file_folders ff
       INNER JOIN users u ON u.id=ff.owner_user_id
       LEFT JOIN files f ON f.folder_id=ff.id AND COALESCE(f.status,'Available')!='Expired'
       GROUP BY ff.id, ff.owner_user_id, ff.parent_folder_id, ff.name, ff.created_at, ff.updated_at,
                u.username_encrypted, u.username_iv, u.username_auth_tag
       ORDER BY ff.owner_user_id ASC, ff.parent_folder_id ASC, ff.name ASC`
    );
    const folders: AdminFileFolder[] = result.recordset.map((row) => ({
      ...mapFolderRow(row),
      username: decryptColumn(row.username_encrypted, row.username_iv, row.username_auth_tag),
    }));
    res.json({ folders });
  } catch (err) {
    console.error('[GET /api/admin/file-folders]', err);
    res.status(500).json({ error: 'Failed to load folders.' });
  }
});

app.post('/api/admin/file-folders/:id/delete', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const folderId = req.params.id;
  if (!UUID_PATTERN.test(folderId)) return res.status(400).json({ error: 'Invalid folder id.' });
  const deleteFiles = !!req.body?.delete_files;

  try {
    const folderReq = await getRequest();
    folderReq.input('id', sql.UniqueIdentifier, folderId);
    const folderResult = await folderReq.query<FolderRow>(
      `SELECT id, owner_user_id, parent_folder_id, name, created_at, updated_at
       FROM file_folders
       WHERE id=@id`
    );
    const folder = folderResult.recordset[0];
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });

    const ownerId = folder.owner_user_id;
    const parent = folder.parent_folder_id ? await getOwnedFolder(folder.parent_folder_id, ownerId) : null;
    if (folder.name === SYSTEM_UPDATE_FOLDER_NAME && folder.parent_folder_id === null) {
      return res.status(403).json({ error: 'The desktop update system root cannot be deleted.' });
    }
    if (parent?.name === SYSTEM_UPDATE_FOLDER_NAME && parent.parent_folder_id === null) {
      if (!deleteFiles) {
        return res.status(400).json({ error: 'Draft update folders must be deleted together with their files.' });
      }
      const activation = await desktopUpdateFolderActivation(folder.id, ownerId);
      if (activation && activation !== 'draft') {
        return res.status(409).json({ error: 'Only draft desktop updates can be deleted.' });
      }
    }

    if (!deleteFiles) {
      const moveReq = await getRequest();
      moveReq.input('folderId', sql.UniqueIdentifier, folderId);
      moveReq.input('ownerId', sql.UniqueIdentifier, ownerId);
      await moveReq.query(
        `;WITH folder_tree AS (
           SELECT id FROM file_folders WHERE id=@folderId AND owner_user_id=@ownerId
           UNION ALL
           SELECT ff.id
           FROM file_folders ff
           INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ff.owner_user_id=@ownerId
         )
         UPDATE files
         SET folder_id=NULL
         WHERE owner_user_id=@ownerId AND folder_id IN (SELECT id FROM folder_tree) OPTION (MAXRECURSION 100)`
      );
    } else {
      const filesReq = await getRequest();
      filesReq.input('folderId', sql.UniqueIdentifier, folderId);
      filesReq.input('ownerId', sql.UniqueIdentifier, ownerId);
      const folderFiles = await filesReq.query<{id:string;stored_path:string;size_bytes:number;status:string}>(
        `;WITH folder_tree AS (
           SELECT id FROM file_folders WHERE id=@folderId AND owner_user_id=@ownerId
           UNION ALL
           SELECT ff.id
           FROM file_folders ff
           INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ff.owner_user_id=@ownerId
         )
         SELECT id, stored_path, size_bytes, status
         FROM files
         WHERE owner_user_id=@ownerId AND folder_id IN (SELECT id FROM folder_tree) OPTION (MAXRECURSION 100)`
      );

      for (const file of folderFiles.recordset) {
        const vaultPath = path.join(FILE_VAULT, file.stored_path);
        try { if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath); } catch {}
      }

      const storageToRemove = folderFiles.recordset
        .filter((file) => file.status === 'Available')
        .reduce((total, file) => total + Number(file.size_bytes || 0), 0);

      const deleteReq = await getRequest();
      deleteReq.input('folderId', sql.UniqueIdentifier, folderId);
      deleteReq.input('ownerId', sql.UniqueIdentifier, ownerId);
      await deleteReq.query(
        `;WITH folder_tree AS (
           SELECT id FROM file_folders WHERE id=@folderId AND owner_user_id=@ownerId
           UNION ALL
           SELECT ff.id
           FROM file_folders ff
           INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ff.owner_user_id=@ownerId
         )
         DELETE FROM files
         WHERE owner_user_id=@ownerId AND folder_id IN (SELECT id FROM folder_tree) OPTION (MAXRECURSION 100)`
      );

      if (storageToRemove > 0) {
        const storageReq = await getRequest();
        storageReq.input('sz', sql.BigInt, storageToRemove);
        storageReq.input('ownerId', sql.UniqueIdentifier, ownerId);
        await storageReq.query('UPDATE users SET storage_used_bytes=CASE WHEN storage_used_bytes-@sz<0 THEN 0 ELSE storage_used_bytes-@sz END WHERE id=@ownerId');
      }
    }

    const deleteFolderReq = await getRequest();
    deleteFolderReq.input('id', sql.UniqueIdentifier, folderId);
    deleteFolderReq.input('ownerId', sql.UniqueIdentifier, ownerId);
    await deleteFolderReq.query(
      `;WITH folder_tree AS (
         SELECT id FROM file_folders WHERE id=@id AND owner_user_id=@ownerId
         UNION ALL
         SELECT ff.id
         FROM file_folders ff
         INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
         WHERE ff.owner_user_id=@ownerId
       )
       DELETE ff
       FROM file_folders ff
       INNER JOIN folder_tree ft ON ff.id=ft.id OPTION (MAXRECURSION 100)`
    );

    await logSystemEvent(
      req.userId!,
      req.user!.username,
      'Delete',
      'Folder',
      folderId,
      req,
      deleteFiles
        ? `Admin deleted folder tree "${folder.name}" and its files.`
        : `Admin deleted folder tree "${folder.name}" and moved files to owner root.`,
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/admin/file-folders/:id/delete]', err);
    res.status(500).json({ error: 'Failed to delete folder.' });
  }
});

app.post('/api/admin/files/:id/block', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  try {
    const fReq = await getRequest(); fReq.input('id', sql.UniqueIdentifier, fileId);
    const fRes = await fReq.query<{status:string;size_bytes:number;owner_user_id:string}>('SELECT status,size_bytes,owner_user_id FROM files WHERE id=@id');
    if (!fRes.recordset.length) return res.status(404).json({ error: 'File not found.' });
    const f = fRes.recordset[0];
    const newStatus = f.status === 'Available' ? 'Blocked' : 'Available';
    const upReq = await getRequest(); upReq.input('s', sql.NVarChar(20), newStatus); upReq.input('id', sql.UniqueIdentifier, fileId);
    await upReq.query('UPDATE files SET status=@s WHERE id=@id');

    const sReq = await getRequest(); sReq.input('sz', sql.BigInt, f.size_bytes); sReq.input('uid', sql.UniqueIdentifier, f.owner_user_id);
    if (newStatus === 'Blocked')
      await sReq.query('UPDATE users SET storage_used_bytes=CASE WHEN storage_used_bytes-@sz<0 THEN 0 ELSE storage_used_bytes-@sz END WHERE id=@uid');
    else
      await sReq.query('UPDATE users SET storage_used_bytes=storage_used_bytes+@sz WHERE id=@uid');

    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'File', fileId, req, `File status changed to ${newStatus}.`);
    res.json({ success: true, file: { id: fileId, status: newStatus } });
  } catch (err) { console.error('[POST /api/admin/files/:id/block]', err); res.status(500).json({ error: 'Failed to update file status.' }); }
});

app.get('/api/admin/logs', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req, res) => {
  try {
    const request = await getRequest(); request.input('top', sql.Int, MAX_LOG_ENTRIES);
    const result = await request.query<LogRow>(
      'SELECT TOP (@top) id,user_id,username_snapshot,event_type,target_type,target_id,ip_address,message,created_at FROM system_logs ORDER BY created_at DESC'
    );
    res.json({ logs: result.recordset.map(mapLogRow) });
  } catch (err) { console.error('[GET /api/admin/logs]', err); res.status(500).json({ error: 'Failed to load logs.' }); }
});

app.get('/api/admin/logs/security', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req, res) => {
  try {
    const request = await getRequest();
    request.input('top', sql.Int, MAX_LOG_ENTRIES);
    const result = await request.query<LogRow>(
      `SELECT TOP (@top)
         id,user_id,username_snapshot,event_type,target_type,target_id,ip_address,message,created_at
       FROM system_logs
       WHERE LOWER(LTRIM(RTRIM(event_type))) IN ('security', 'scan')
          OR message LIKE '%reject%'
          OR message LIKE '%blocked%'
          OR message LIKE '%malware%'
          OR message LIKE '%threat%'
          OR message LIKE '%lock%'
          OR message LIKE '%failed login%'
       ORDER BY created_at DESC`
    );
    res.json({ logs: result.recordset.map(mapLogRow) });
  } catch (err) {
    console.error('[GET /api/admin/logs/security]', err);
    res.status(500).json({ error: 'Failed to load security logs.' });
  }
});

app.post('/api/admin/quotas', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const { id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes } = req.body;
  if (!id || !name || !storage_limit_bytes || !max_file_size_bytes || !max_files || !daily_upload_limit_bytes)
    return res.status(400).json({ error: 'All quota fields are required.' });
  try {
    const request = await getRequest();
    request.input('id', sql.NVarChar(50), id); request.input('name', sql.NVarChar(100), name);
    request.input('sl', sql.BigInt, Number(storage_limit_bytes)); request.input('mf', sql.BigInt, Number(max_file_size_bytes));
    request.input('mfi', sql.Int, Number(max_files)); request.input('dl', sql.BigInt, Number(daily_upload_limit_bytes));
    await request.query(
      `INSERT INTO quotas (id,name,storage_limit_bytes,max_file_size_bytes,max_files,daily_upload_limit_bytes)
       VALUES (@id,@name,@sl,@mf,@mfi,@dl)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name,
         storage_limit_bytes=EXCLUDED.storage_limit_bytes,
         max_file_size_bytes=EXCLUDED.max_file_size_bytes,
         max_files=EXCLUDED.max_files,
         daily_upload_limit_bytes=EXCLUDED.daily_upload_limit_bytes`
    );
    const allReq = await getRequest();
    const allQuotas = await allReq.query<Quota>('SELECT id,name,storage_limit_bytes,max_file_size_bytes,max_files,daily_upload_limit_bytes FROM quotas ORDER BY storage_limit_bytes');
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'Quota', id, req, `Saved quota tier "${name}".`);
    res.json({ success: true, quotas: allQuotas.recordset });
  } catch (err) { console.error('[POST /api/admin/quotas]', err); res.status(500).json({ error: 'Failed to save quota.' }); }
});

app.post('/api/admin/quotas/:id/delete', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const quotaId = req.params.id; const { migrate_to_quota_id } = req.body;
  try {
    const qC = await getRequest(); qC.input('id', sql.NVarChar(50), quotaId);
    const qR = await qC.query<{c:number}>('SELECT COUNT(*) AS c FROM quotas WHERE id=@id');
    if (!qR.recordset[0].c) return res.status(404).json({ error: 'Quota tier not found.' });

    const tC = await getRequest(); const tR = await tC.query<{c:number}>('SELECT COUNT(*) AS c FROM quotas');
    if (tR.recordset[0].c <= 1) return res.status(400).json({ error: 'Cannot delete the last quota tier.' });

    const uC = await getRequest(); uC.input('qid', sql.NVarChar(50), quotaId);
    const uR = await uC.query<{c:number}>('SELECT COUNT(*) AS c FROM users WHERE quota_id=@qid');
    if (uR.recordset[0].c > 0) {
      if (!migrate_to_quota_id) return res.status(400).json({ error: 'Migration required', needs_migration: true, attached_count: uR.recordset[0].c });
      const mReq = await getRequest(); mReq.input('to', sql.NVarChar(50), migrate_to_quota_id); mReq.input('from', sql.NVarChar(50), quotaId);
      await mReq.query('UPDATE users SET quota_id=@to WHERE quota_id=@from');
    }

    const dReq = await getRequest(); dReq.input('id', sql.NVarChar(50), quotaId);
    await dReq.query('DELETE FROM quotas WHERE id=@id');

    const allReq = await getRequest();
    const allQuotas = await allReq.query<Quota>('SELECT id,name,storage_limit_bytes,max_file_size_bytes,max_files,daily_upload_limit_bytes FROM quotas ORDER BY storage_limit_bytes');
    await logSystemEvent(req.userId!, req.user!.username, 'Admin', 'Quota', quotaId, req, `Deleted quota tier "${quotaId}".`);
    res.json({ success: true, quotas: allQuotas.recordset });
  } catch (err) { console.error('[POST /api/admin/quotas/:id/delete]', err); res.status(500).json({ error: 'Failed to delete quota.' }); }
});

// ──────────────────────────────────────────────────────────────
// Expiry cleanup callbacks
// ──────────────────────────────────────────────────────────────

async function getExpiredFiles(): Promise<ExpiredFileRecord[]> {
  const request = await getRequest();
  const result = await request.query<{
    id: string; stored_path: string; owner_user_id: string;
    original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
    expires_at: Date; size_bytes: number;
  }>(
    `SELECT id,stored_path,owner_user_id,original_name_encrypted,original_name_iv,original_name_auth_tag,expires_at,size_bytes
     FROM files WHERE expires_at IS NOT NULL AND expires_at<=SYSDATETIMEOFFSET() AND status='Available'`
  );
  return result.recordset.map(r => ({
    id:           r.id,
    storedPath:   path.join(FILE_VAULT, r.stored_path),
    ownerId:      r.owner_user_id,
    originalName: decryptColumn(r.original_name_encrypted, r.original_name_iv, r.original_name_auth_tag),
    expiresAt:    r.expires_at.toISOString(),
    sizeBytes:    r.size_bytes,
  }));
}

async function markFilesExpired(fileIds: string[]): Promise<void> {
  for (const fileId of fileIds) {
    const r = await getRequest(); r.input('id', sql.UniqueIdentifier, fileId);
    await r.query("UPDATE files SET status='Expired',deleted_at=SYSDATETIMEOFFSET() WHERE id=@id");
    const s = await getRequest(); s.input('id', sql.UniqueIdentifier, fileId);
    await s.query(`UPDATE users SET storage_used_bytes=CASE WHEN storage_used_bytes-(SELECT size_bytes FROM files WHERE id=@id)<0 THEN 0 ELSE storage_used_bytes-(SELECT size_bytes FROM files WHERE id=@id) END WHERE id=(SELECT owner_user_id FROM files WHERE id=@id)`);
  }
}

async function logExpiredFile(file: ExpiredFileRecord): Promise<void> {
  const r = await getRequest();
  r.input('uid', sql.UniqueIdentifier, file.ownerId); r.input('usr', sql.NVarChar(200), 'System');
  r.input('et',  sql.NVarChar(20),  'Delete');        r.input('tt',  sql.NVarChar(50),  'File');
  r.input('tid', sql.NVarChar(100), file.id);          r.input('ip',  sql.NVarChar(45),  '127.0.0.1');
  r.input('msg', sql.NVarChar(sql.MAX), `File "${file.originalName}" auto-deleted after TTL expiry (${file.expiresAt}).`);
  await r.query('INSERT INTO system_logs (user_id,username_snapshot,event_type,target_type,target_id,ip_address,message) VALUES (@uid,@usr,@et,@tt,@tid,@ip,@msg)');
}

// ──────────────────────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────────────────────

async function ensureOptionalFileSecretColumns(): Promise<void> {
  const addSecretHash = await getRequest();
  await addSecretHash.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS client_secret_hash TEXT');
  const addSalt = await getRequest();
  await addSalt.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS client_crypto_salt BYTEA');
  const addIv = await getRequest();
  await addIv.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS client_crypto_iv BYTEA');
  const addIterations = await getRequest();
  await addIterations.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS client_crypto_iterations INTEGER');
}

async function ensureOptionalShareLinkColumns(): Promise<void> {
  const request = await getRequest();
  await request.query(
    'ALTER TABLE share_links ADD COLUMN IF NOT EXISTS allow_external_preview BOOLEAN NOT NULL DEFAULT FALSE'
  );
}

async function ensureFileFolderSchema(): Promise<void> {
  const createFolders = await getRequest();
  await createFolders.query(`
    CREATE TABLE IF NOT EXISTS file_folders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_folder_id UUID NULL,
      name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const addParentFolderId = await getRequest();
  await addParentFolderId.query('ALTER TABLE file_folders ADD COLUMN IF NOT EXISTS parent_folder_id UUID');

  const addParentFk = await getRequest();
  await addParentFk.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_file_folders_parent'
      ) THEN
        ALTER TABLE file_folders
          ADD CONSTRAINT fk_file_folders_parent
          FOREIGN KEY (parent_folder_id) REFERENCES file_folders(id) ON DELETE NO ACTION;
      END IF;
    END $$;
  `);

  const renameUnique = await getRequest();
  await renameUnique.query(`
    DO $$
    DECLARE legacy_constraint_name TEXT;
    DECLARE legacy_unique_index_name TEXT;
    BEGIN
      FOR legacy_constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        INNER JOIN pg_class t ON t.oid=c.conrelid
        INNER JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE t.relname='file_folders'
          AND n.nspname=current_schema()
          AND c.contype='u'
          AND pg_get_constraintdef(c.oid) ILIKE 'UNIQUE (owner_user_id, name)%'
      LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', current_schema(), 'file_folders', legacy_constraint_name);
      END LOOP;

      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_file_folders_owner_name'
      ) THEN
        ALTER TABLE file_folders DROP CONSTRAINT uq_file_folders_owner_name;
      END IF;

      FOR legacy_unique_index_name IN
        SELECT idx.relname
        FROM pg_class idx
        INNER JOIN pg_index i ON i.indexrelid=idx.oid
        INNER JOIN pg_class tbl ON tbl.oid=i.indrelid
        INNER JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
        LEFT JOIN pg_constraint c ON c.conindid=idx.oid
        WHERE tbl.relname='file_folders'
          AND ns.nspname=current_schema()
          AND i.indisunique
          AND c.oid IS NULL
          AND idx.relname NOT IN ('uq_file_folders_owner_root_name', 'uq_file_folders_owner_parent_name')
          AND (
            pg_get_indexdef(idx.oid) ILIKE '%(owner_user_id, name)%'
            OR pg_get_indexdef(idx.oid) ILIKE '%(owner_user_id, parent_folder_id, name)%'
          )
      LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), legacy_unique_index_name);
      END LOOP;

      ALTER TABLE file_folders DROP CONSTRAINT IF EXISTS uq_file_folders_owner_parent_name;
    END $$;
  `);

  const validateFolderNameUniqueness = await getRequest();
  await validateFolderNameUniqueness.query(`
    DO $$
    DECLARE root_duplicate_count INTEGER;
    DECLARE nested_duplicate_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO root_duplicate_count
      FROM (
        SELECT owner_user_id,name FROM file_folders
        WHERE parent_folder_id IS NULL
        GROUP BY owner_user_id,name HAVING COUNT(*)>1
      ) roots;
      SELECT COUNT(*) INTO nested_duplicate_count
      FROM (
        SELECT owner_user_id,parent_folder_id,name FROM file_folders
        WHERE parent_folder_id IS NOT NULL
        GROUP BY owner_user_id,parent_folder_id,name HAVING COUNT(*)>1
      ) nested;
      IF root_duplicate_count>0 OR nested_duplicate_count>0 THEN
        RAISE EXCEPTION
          'Cannot enforce folder name uniqueness: % root and % nested duplicate group(s) exist.',
          root_duplicate_count,nested_duplicate_count;
      END IF;
    END $$;
  `);
  const rootFolderUniqueIndex = await getRequest();
  await rootFolderUniqueIndex.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_file_folders_owner_root_name ON file_folders (owner_user_id, name) WHERE parent_folder_id IS NULL'
  );
  const nestedFolderUniqueIndex = await getRequest();
  await nestedFolderUniqueIndex.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_file_folders_owner_parent_name ON file_folders (owner_user_id, parent_folder_id, name) WHERE parent_folder_id IS NOT NULL'
  );

  const addFolderId = await getRequest();
  await addFolderId.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS folder_id UUID');
  const addFk = await getRequest();
  await addFk.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_files_file_folders'
      ) THEN
        ALTER TABLE files
          ADD CONSTRAINT fk_files_file_folders
          FOREIGN KEY (folder_id) REFERENCES file_folders(id) ON DELETE NO ACTION;
      END IF;
    END $$;
  `);
  const dropLegacyFolderOwnerIndex = await getRequest();
  await dropLegacyFolderOwnerIndex.query('DROP INDEX IF EXISTS ix_file_folders_owner');
  const folderOwnerParentIndex = await getRequest();
  await folderOwnerParentIndex.query('CREATE INDEX IF NOT EXISTS ix_file_folders_owner_parent ON file_folders (owner_user_id, parent_folder_id, name)');
  const fileFolderIndex = await getRequest();
  await fileFolderIndex.query('CREATE INDEX IF NOT EXISTS ix_files_folder_id ON files (folder_id, owner_user_id)');
}

async function ensureFolderShareLinkSchema(): Promise<void> {
  const createFolderShares = await getRequest();
  await createFolderShares.query(`
    CREATE TABLE IF NOT EXISTS folder_share_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      folder_id UUID NOT NULL UNIQUE REFERENCES file_folders(id) ON DELETE CASCADE,
      public_token CHAR(32) NOT NULL UNIQUE,
      password_hash VARCHAR(256) NULL,
      expires_at TIMESTAMPTZ NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const activeExpiryIndex = await getRequest();
  await activeExpiryIndex.query(
    'CREATE INDEX IF NOT EXISTS ix_folder_share_links_active_expiry ON folder_share_links (is_active, expires_at) INCLUDE (folder_id, public_token)'
  );
}

async function bootstrap() {
  // 1. Validate production requirements and master encryption key
  validateProductionConfig();
  validateEncryptionConfig();

  // 2. Connect PostgreSQL
  await getPool();
  console.log('[server] PostgreSQL connection pool ready.');

  // 2b. Lightweight schema migration for optional user-provided file secrets.
  await ensureOptionalFileSecretColumns();
  await ensureOptionalShareLinkColumns();
  await ensureFileFolderSchema();
  await ensureFolderShareLinkSchema();

  app.use('/api/health', createHealthRouter(FILE_VAULT, NODE_ENV === 'production'));

  app.use('/api/admin/maintenance', createMaintenanceModeRouter({
    authenticateUser: authenticateUser as express.RequestHandler,
    verifyAdmin: verifyAdmin as express.RequestHandler,
    logSystemEvent,
  }));

  // 3. Validate IIS logging config
  validateIISLoggingConfig();

  // 5. Verify SMTP connection (if configured)
  if (SMTP_ENABLED) {
    try {
      await verifySmtpConnection();
      console.log('[server] SMTP email verification is enabled.');
    } catch (err: any) {
      console.error('[server] SMTP connection failed — email verification will not work:', err.message);
    }
  } else {
    console.log('[server] SMTP not configured — email verification disabled.');
  }

  // 6. Start expiry cleanup
  startExpiryCleanup(getExpiredFiles, markFilesExpired, logExpiredFile);

  // 6b. Clean up stale download temp files from previous crashes
  cleanupStaleTempFiles(UPLOAD_TEMP);

  // 6c. Start periodic sweep of expired download sessions
  startPrivateDownloadSweep();

  // 6d. Start UNC share health monitor (auto-maintenance toggle)
  startUncShareMonitor();

  // 7. Share link vanity path (Discord embeds) & SPA fallback
  const distPath = path.join(process.cwd(), 'dist');

  // Serve an explicit robots policy. Without this, SPA fallback returns HTML for /robots.txt,
  // which can confuse social unfurl crawlers and lead to missing link previews.
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send([
      'User-agent: *',
      'Allow: /',
      '',
      'User-agent: facebookexternalhit',
      'Allow: /s/',
      'Allow: /d/',
      'Allow: /api/public/share/',
      'Allow: /api/public/folder/',
      '',
      'User-agent: facebot',
      'Allow: /s/',
      'Allow: /d/',
      'Allow: /api/public/share/',
      'Allow: /api/public/folder/',
      '',
      'User-agent: meta-externalagent',
      'Allow: /s/',
      'Allow: /d/',
      'Allow: /api/public/share/',
      'Allow: /api/public/folder/',
      '',
      'User-agent: meta-externalfetcher',
      'Allow: /s/',
      'Allow: /d/',
      'Allow: /api/public/share/',
      'Allow: /api/public/folder/',
      '',
      'User-agent: discordbot',
      'Allow: /s/',
      'Allow: /api/public/share/',
      'Allow: /d/',
      'Allow: /api/public/folder/',
    ].join('\n'));
  });

  app.use(express.static(distPath));

  // Vanity path for share links — internally dispatch to OG HTML handler (no redirect hop for crawlers).
  app.get('/s/:token', (req, res, next) => {
    req.url = `/api/public/share/${req.params.token}/og`;
    (app as unknown as { _router: { handle: express.RequestHandler } })._router.handle(req, res, next);
  });

  // Vanity path for folder share links — internally dispatch to folder OG HTML handler.
  app.get('/d/:token', (req, res, next) => {
    req.url = `/api/public/folder/${req.params.token}/og`;
    (app as unknown as { _router: { handle: express.RequestHandler } })._router.handle(req, res, next);
  });

  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  
  // 8. HTTP or HTTPS
  const sslEnabled = process.env.SSL_ENABLED === 'true';
  if (sslEnabled) {
    let sslOptions: https.ServerOptions = {};
    const pfxPath = process.env.SSL_PFX_PATH;
    if (pfxPath && fs.existsSync(pfxPath)) {
      sslOptions.pfx        = fs.readFileSync(pfxPath);
      sslOptions.passphrase = process.env.SSL_PFX_PASSPHRASE || '';
    } else {
      const certPath = process.env.SSL_CERT_PATH;
      const keyPath  = process.env.SSL_KEY_PATH;
      if (!certPath || !keyPath) throw new Error('[server] SSL_CERT_PATH and SSL_KEY_PATH required when SSL_ENABLED=true.');
      sslOptions.cert = fs.readFileSync(certPath);
      sslOptions.key  = fs.readFileSync(keyPath);
      if (process.env.SSL_CA_PATH && fs.existsSync(process.env.SSL_CA_PATH))
        sslOptions.ca = fs.readFileSync(process.env.SSL_CA_PATH);
    }
    sslOptions.minVersion = (process.env.SSL_MIN_VERSION as any) || 'TLSv1.2';
    if (process.env.SSL_CIPHERS?.trim()) sslOptions.ciphers = process.env.SSL_CIPHERS;

    const sslPort = parseInt(process.env.SSL_PORT || '443', 10);
    configureHttpServer(https.createServer(sslOptions, app)).listen(sslPort, '0.0.0.0', () => {
      const tag = CLUSTER_ENABLED ? `(worker ${process.pid})` : '';
      console.log(`[server] HTTPS port ${sslPort} ${tag}`);
    });
  } else {
    configureHttpServer(app.listen(PORT, '0.0.0.0', () => {
      const tag = CLUSTER_ENABLED ? `(worker ${process.pid})` : '';
      console.log(`[server] http://0.0.0.0:${PORT} ${tag}`);
    }));
  }

  // 9. Graceful shutdown (worker process)
  const shutdown = async (sig: string) => {
    console.log(`[server] ${sig} — shutting down worker ${process.pid}.`);
    stopPrivateDownloadSweep();
    stopUncShareMonitor();
    sweepPrivateDownloadSessions();
    stopExpiryCleanup();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));  

}

// ── Primary / Worker fork ───────────────────────────────

if (CLUSTER_ENABLED && cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`[server] Primary ${process.pid} is running`);
  console.log(`[server] Forking ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[server] Worker ${worker.process.pid} died (code=${code}, signal=${signal}). Restarting...`);
    cluster.fork();
  });

  // Graceful shutdown of all workers on SIGTERM/SIGINT
  const shutdownCluster = (sig: string) => {
    console.log(`[server] ${sig} received — shutting down all workers.`);
    for (const id in cluster.workers) {
      cluster.workers[id]?.kill();
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdownCluster('SIGTERM'));
  process.on('SIGINT',  () => shutdownCluster('SIGINT'));
} else {
  // ── Worker (or single-process fallback) ────────────────
  const workerLabel = CLUSTER_ENABLED
    ? `Worker ${process.pid} started`
    : `Single-process ${process.pid} started (CLUSTER_ENABLED=false)`;
  console.log(`[server] ${workerLabel}`);

  bootstrap().catch(err => {
    console.error('[server] Fatal startup error:', err);
    process.exit(1);
  });
}
