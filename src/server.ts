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
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import sql from 'mssql';
import si from 'systeminformation';

import { getPool, closePool, getRequest } from './server/db.js';
import {
  encryptFile, wrapKey, unwrapKey,
  encryptFileStream, decryptFileStream, computeFileChecksum,
  encryptColumn, decryptColumn, hashColumnForLookup,
  hashPassword, verifyPassword, hashSharePassword, verifySharePassword,
  hashFileSecret, verifyFileSecret, decryptClientProtectedPayload,
  generateSecureToken, validateEncryptionConfig,
} from './server/utils/encryption.js';
import { scanFileBuffer, scanFilePath, heuristicPreScan } from './server/utils/scanner.js';
import {
  startExpiryCleanup, stopExpiryCleanup,
  computeExpiresAt, isValidTtl,
  type ExpiredFileRecord,
} from './server/utils/expiry-cleanup.js';
import { sendVerificationEmail, sendAccountDeletionEmail, validateMxRecord, verifySmtpConnection } from './server/utils/email.js';
import multer from 'multer';
import os from 'os';
import { iisLoggingMiddleware, validateIISLoggingConfig } from './server/middleware/iis-logger.js';
import { createSessionRouter } from './server/routes/sessions.js';
import { createHealthRouter } from './server/routes/health.js';
import { createPublicSharingRouter } from './server/routes/public-sharing.js';
import { validateProductionConfig } from './server/utils/production.js';
import type { Quota, User, FileMetadata, ShareLink, SystemLog, SystemStats } from './app/shared/types/index.js';

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

function removePrivateDownloadSession(downloadId: string): void {
  const session = privateDownloadSessions.get(downloadId);
  if (!session) return;
  privateDownloadSessions.delete(downloadId);
  try {
    if (fs.existsSync(session.tempFile)) fs.unlinkSync(session.tempFile);
  } catch {
    // best-effort cleanup only
  }
}

function sweepPrivateDownloadSessions(): void {
  const now = Date.now();
  for (const [downloadId, session] of privateDownloadSessions.entries()) {
    if (session.expiresAt <= now) {
      removePrivateDownloadSession(downloadId);
    }
  }
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

function detectProfilePictureMime(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function getProfilePictureDirectory(userId: string): string {
  return path.join(PROFILE_PICTURE_PATH, userId, 'avatars');
}

function getProfilePictureFiles(userId: string): string[] {
  const directory = getProfilePictureDirectory(userId);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function getProfilePictureExtension(mimeType: 'image/jpeg' | 'image/png' | 'image/webp'): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

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

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);
app.use('/api/public/share', rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.PUBLIC_SHARE_RATE_LIMIT_RPM || '60', 10),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many shared-link requests. Please wait before trying again.' },
}));

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
     WHERE user_id=@uid AND (expires_at<=SYSDATETIMEOFFSET() OR revoked_at<DATEADD(day,-1,SYSDATETIMEOFFSET()));
     INSERT INTO refresh_tokens (id,user_id,token_hash,expires_at,created_at,revoked_at,ip_address,user_agent)
     VALUES (NEWID(),@uid,@hash,@exp,SYSDATETIMEOFFSET(),NULL,@ip,@ua)`
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

interface ShareRow {
  id: string; file_id: string; public_token: string; password_hash: string | null;
  expires_at: Date | null; max_downloads: number | null; download_count: number;
  is_active: boolean; allow_external_preview: boolean; created_at: Date;
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
       OUTPUT INSERTED.id, INSERTED.email_encrypted, INSERTED.email_iv, INSERTED.email_auth_tag,
              INSERTED.username_encrypted, INSERTED.username_iv, INSERTED.username_auth_tag,
              INSERTED.role, INSERTED.quota_id, INSERTED.storage_used_bytes,
              INSERTED.status, INSERTED.created_at, INSERTED.failed_login_count, INSERTED.locked_until,
              INSERTED.email_verified, INSERTED.email_verification_token, INSERTED.email_verification_expires
       VALUES (@eEnc,@eIv,@eTag,@eHash, @uEnc,@uIv,@uTag,@uHash, @pw, @quota, @vOk, @vTok, @vExp)`
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
      `UPDATE users SET email_verified=1, email_verification_token=NULL, email_verification_expires=NULL WHERE id=@id`
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
       OUTPUT INSERTED.id, INSERTED.email_encrypted, INSERTED.email_iv, INSERTED.email_auth_tag,
              INSERTED.username_encrypted, INSERTED.username_iv, INSERTED.username_auth_tag,
              INSERTED.role, INSERTED.quota_id, INSERTED.storage_used_bytes,
              INSERTED.status, INSERTED.created_at, INSERTED.failed_login_count, INSERTED.locked_until
       WHERE id=@id`
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

const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
});

app.get('/api/users/me/avatar', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  try {
    const avatarPath = getProfilePictureFiles(req.userId!)[0];
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
    const directory = getProfilePictureDirectory(req.userId!);
    fs.mkdirSync(directory, { recursive: true });
    const extension = getProfilePictureExtension(mimeType);
    const filename = `${Date.now()}-${generateSecureToken(8)}.${extension}`;
    fs.writeFileSync(path.join(directory, filename), req.file.buffer);

    for (const oldPicture of getProfilePictureFiles(req.userId!).slice(10)) {
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
    const directory = getProfilePictureDirectory(req.userId!);
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
    let result;
    try {
      result = await request.query<FileRow>(
        `SELECT id, owner_user_id,
                original_name_encrypted, original_name_iv, original_name_auth_tag,
                stored_path, mime_type, size_bytes, encrypted_size_bytes,
                status, checksum_sha256, scan_result, scan_message,
                is_encrypted, leeku_vibe, ttl_hours,
                client_secret_hash,
                expires_at, created_at
        FROM files WHERE owner_user_id=@ownerId AND COALESCE(status,'Available')!='Expired'
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

// ──────────────────────────────────────────────────────────────
// API: Files — Upload
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// Multer — multipart upload middleware (streaming, no memory limits)
// ──────────────────────────────────────────────────────────────

if (!fs.existsSync(UPLOAD_TEMP)) {
  fs.mkdirSync(UPLOAD_TEMP, { recursive: true });
  console.log(`[server] Created upload temp directory: ${UPLOAD_TEMP}`);
}

const upload = multer({
  dest: UPLOAD_TEMP,
  limits: {
    // No fileSize limit — quota checks handle the limit server-side.
    // Must be omitted (not 0) in multer v2.x — 0 rejects ALL non-empty files.
    files: 1,
  },
});

const receiveUpload: express.RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Request aborted' || req.destroyed || req.aborted) {
      console.warn('[upload] Multipart request aborted before the file finished streaming.', {
        ip: getRequestIp(req),
        contentLength: req.headers['content-length'] || null,
        userAgent: req.headers['user-agent'] || null,
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
// API: Files — Upload (multipart/form-data, streaming)
// ──────────────────────────────────────────────────────────────

app.post('/api/files/upload', authenticateUser as express.RequestHandler, receiveUpload, async (req: AuthenticatedRequest, res) => {
  const multerFile = req.file;
  if (!multerFile) return res.status(400).json({ error: 'No file attached. Use multipart/form-data with field name "file".' });

  const original_name = req.body.original_name || multerFile.originalname;
  const mime_type     = req.body.mime_type     || multerFile.mimetype || 'application/octet-stream';
  const ttl_hours     = req.body.ttl_hours     || null;
  const size          = multerFile.size;
  const tempFilePath  = multerFile.path; // on-disk temp file from multer

  const user = req.user!;
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
    console.info('[upload] Multipart upload received.', {
      userId: user.id,
      username: user.username,
      originalName: original_name,
      mimeType: mime_type,
      declaredSize: size,
      ttlHours: ttl_hours ?? null,
      hasUploadSecret: (req.body.upload_secret_key || '').length > 0,
      tempPath: tempFilePath,
    });

    // ── Optional client-side file secret metadata ─────────────
    currentStage = 'validate_upload_secret';
    const uploadSecretRaw = typeof req.body.upload_secret_key === 'string' ? req.body.upload_secret_key.trim() : '';
    const uploadSecretSaltB64 = typeof req.body.upload_secret_salt_b64 === 'string' ? req.body.upload_secret_salt_b64 : '';
    const uploadSecretIvB64 = typeof req.body.upload_secret_iv_b64 === 'string' ? req.body.upload_secret_iv_b64 : '';
    const uploadSecretIterationsRaw = typeof req.body.upload_secret_iterations === 'string' ? req.body.upload_secret_iterations : '';
    if (uploadSecretRaw.length > 0) {
      if (uploadSecretRaw.length < 8) return finishUploadError(400, 'Secret key must contain at least 8 characters.');
      if (!uploadSecretSaltB64 || !uploadSecretIvB64 || !uploadSecretIterationsRaw) return finishUploadError(400, 'Missing client encryption metadata for secret-protected upload.');
      const parsedIterations = Number(uploadSecretIterationsRaw);
      if (!Number.isInteger(parsedIterations) || parsedIterations < 100000 || parsedIterations > 1000000) return finishUploadError(400, 'Invalid client encryption iteration count.');
      const parsedSalt = Buffer.from(uploadSecretSaltB64, 'base64');
      const parsedIv   = Buffer.from(uploadSecretIvB64,   'base64');
      if (parsedSalt.length !== 16 || parsedIv.length !== 12) return finishUploadError(400, 'Invalid client encryption salt or IV.');
      uploadSecretIterations = parsedIterations;
      uploadSecretSalt = parsedSalt;
      uploadSecretIv   = parsedIv;
      uploadSecretHash = await hashFileSecret(uploadSecretRaw);
    } else if (uploadSecretSaltB64 || uploadSecretIvB64 || uploadSecretIterationsRaw) {
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

    // ── Clean up the multer temp file ─────────────────────────
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

    const fileResult = await fileReq.query<FileRow>(
      `INSERT INTO files (
         owner_user_id, original_name_encrypted, original_name_iv, original_name_auth_tag,
         stored_path, mime_type, size_bytes, encrypted_size_bytes,
         checksum_sha256, scan_result, scan_message, scanned_at,
         leeku_vibe, ttl_hours,
         client_secret_hash, client_crypto_salt, client_crypto_iv, client_crypto_iterations,
         expires_at, is_encrypted
       )
       OUTPUT INSERTED.id, INSERTED.owner_user_id,
              INSERTED.original_name_encrypted, INSERTED.original_name_iv, INSERTED.original_name_auth_tag,
              INSERTED.stored_path, INSERTED.mime_type, INSERTED.size_bytes, INSERTED.encrypted_size_bytes,
              INSERTED.status, INSERTED.checksum_sha256, INSERTED.scan_result, INSERTED.scan_message,
              INSERTED.is_encrypted, INSERTED.leeku_vibe, INSERTED.ttl_hours,
              INSERTED.client_secret_hash, INSERTED.client_crypto_salt, INSERTED.client_crypto_iv, INSERTED.client_crypto_iterations,
              INSERTED.expires_at, INSERTED.created_at
       VALUES (@ownerId,@nEnc,@nIv,@nTag, @spath,@mime,@sz,@esz, @chk,@scan,@smsg,SYSDATETIMEOFFSET(), @vibe,@ttl,
               @clientSecretHash,@clientCryptoSalt,@clientCryptoIv,@clientCryptoIterations,
               @exp,1)`
    );
    const newFile = fileResult.recordset[0];
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
    // Clean up: delete vault file if created AND temp upload file
    if (vaultFilePath) try { if (fs.existsSync(vaultFilePath)) fs.unlinkSync(vaultFilePath); } catch {}
    try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
    if (progressStreamStarted) {
      sendUploadProgress({ type: 'error', error: 'Upload failed. Please try again.' });
      res.end();
      return;
    }
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

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
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'You do not have permission to download this file.' });
    if (file.status === 'Blocked')
      return res.status(410).json({ error: 'Blocked files cannot be downloaded.' });

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
    const secretHeaderRaw = req.headers['x-file-secret'];
    const providedSecret = Array.isArray(secretHeaderRaw)
      ? String(secretHeaderRaw[0] || '').trim()
      : String(secretHeaderRaw || '').trim();
    if (file.client_secret_hash) {
      if (!providedSecret) return res.status(403).json({ error: 'This file requires a secret key to download.' });
      if (!(await verifyFileSecret(providedSecret, file.client_secret_hash)))
        return res.status(403).json({ error: 'Incorrect secret key.' });
    }

    // ── Streaming decrypt to temp file (avoids 2 GiB Buffer limit) ──
    const tempPath = buildUniqueTempFilePath(UPLOAD_TEMP, 'leeku-dl', fileId);
    await decryptFileStream(vaultPath, tempPath, fileKey, keyRow.file_iv, keyRow.file_auth_tag);

    // Verify checksum via streaming (constant memory)
    const actualChecksum = await computeFileChecksum(tempPath);
    if (actualChecksum !== file.checksum_sha256) {
      try { fs.unlinkSync(tempPath); } catch {}
      return res.status(500).json({ error: 'File integrity check failed.' });
    }

    if (file.client_secret_hash) {
      if (!file.client_crypto_salt || !file.client_crypto_iv || !file.client_crypto_iterations) {
        try { fs.unlinkSync(tempPath); } catch {}
        return res.status(500).json({ error: 'Secret-key metadata is missing for this file.' });
      }
      const protectedPayload = fs.readFileSync(tempPath);
      try {
        const plaintext = decryptClientProtectedPayload(
          protectedPayload, providedSecret,
          file.client_crypto_salt, file.client_crypto_iv, file.client_crypto_iterations,
        );
        fs.writeFileSync(tempPath, plaintext);
      } catch {
        try { fs.unlinkSync(tempPath); } catch {}
        return res.status(403).json({ error: 'Incorrect secret key.' });
      }
    }

    const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
    const safeName = originalName.replace(/"/g, '\\"');
    const stat = fs.statSync(tempPath);

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', stat.size.toString());
    await logSystemEvent(req.userId!, req.user!.username, 'Download', 'File', fileId, req, `Direct download of "${originalName}".`);

    const readStream = fs.createReadStream(tempPath);
    readStream.pipe(res);
    readStream.on('end',    () => { try { fs.unlinkSync(tempPath); } catch {} });
    readStream.on('error',  () => { try { fs.unlinkSync(tempPath); } catch {} });
    res.on('finish',        () => { try { fs.unlinkSync(tempPath); } catch {} });
    res.on('close',         () => { try { fs.unlinkSync(tempPath); } catch {} });
  } catch (err) { console.error('[GET /api/files/:id/download]', err); res.status(500).json({ error: 'Download failed.' }); }
});

app.post('/api/files/:id/download/prepare', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  sweepPrivateDownloadSessions();
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

    const keyRow = keyRes.recordset[0];
    const fileKey = unwrapKey(keyRow.encrypted_key, keyRow.key_iv, keyRow.key_auth_tag);

    void (async () => {
      try {
        await decryptFileStream(vaultPath, tempFile, fileKey, keyRow.file_iv, keyRow.file_auth_tag, ({ processedBytes, totalBytes }) => {
          const current = privateDownloadSessions.get(sessionId);
          if (!current) return;
          current.phase = 'decrypting';
          current.loaded = processedBytes;
          current.total = totalBytes;
          current.expiresAt = Date.now() + PRIVATE_DOWNLOAD_SESSION_TTL_MS;
        });

        const current = privateDownloadSessions.get(sessionId);
        if (!current) return;
        current.phase = 'verifying';
        current.loaded = 0;
        current.total = current.sizeBytes || 1;

        const checksum = await computeFileChecksum(tempFile, ({ processedBytes, totalBytes }) => {
          const active = privateDownloadSessions.get(sessionId);
          if (!active) return;
          active.phase = 'verifying';
          active.loaded = processedBytes;
          active.total = totalBytes;
          active.expiresAt = Date.now() + PRIVATE_DOWNLOAD_SESSION_TTL_MS;
        });
        if (checksum !== file.checksum_sha256) {
          throw new Error('File integrity check failed.');
        }

        if (file.client_secret_hash) {
          if (!file.client_crypto_salt || !file.client_crypto_iv || !file.client_crypto_iterations) {
            throw new Error('Secret-key metadata is missing for this file.');
          }

          const active = privateDownloadSessions.get(sessionId);
          if (!active) return;
          active.phase = 'finalizing';
          active.loaded = 0;
          active.total = 1;

          const protectedPayload = fs.readFileSync(tempFile);
          const plaintext = decryptClientProtectedPayload(
            protectedPayload,
            providedSecret,
            file.client_crypto_salt,
            file.client_crypto_iv,
            file.client_crypto_iterations,
          );
          fs.writeFileSync(tempFile, plaintext);
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
    return res.status(404).json({ error: 'Download session not found.' });
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
    return res.status(404).json({ error: 'Download session not found.' });
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

  try {
    const safeName = session.originalName.replace(/"/g, '\\"');
    const stat = fs.statSync(session.tempFile);

    res.setHeader('Content-Type', session.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', stat.size.toString());
    await logSystemEvent(req.userId!, req.user!.username, 'Download', 'File', fileId, req, `Direct download of "${session.originalName}".`);

    const readStream = fs.createReadStream(session.tempFile);
    readStream.pipe(res);
    readStream.on('end', () => removePrivateDownloadSession(downloadId));
    readStream.on('error', () => removePrivateDownloadSession(downloadId));
    res.on('finish', () => removePrivateDownloadSession(downloadId));
    res.on('close', () => removePrivateDownloadSession(downloadId));
  } catch (err) {
    session.claimed = false;
    console.error('[GET /api/files/:id/download/:downloadId/file]', err);
    res.status(500).json({ error: 'Download failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// API: Share Links
// ──────────────────────────────────────────────────────────────

app.get('/api/sharing/links', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const request = await getRequest();
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    const result = await request.query<ShareRow & { stored_path: string }>(
      `SELECT sl.id,sl.file_id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,sl.created_at,f.stored_path
       FROM share_links sl INNER JOIN files f ON sl.file_id=f.id
       WHERE f.owner_user_id=@ownerId ORDER BY sl.created_at DESC`
    );
    res.json({
      links: result.recordset.map((row) => ({
        ...mapShareRow(row),
        is_available: fs.existsSync(path.join(FILE_VAULT, row.stored_path)),
      })),
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
         OUTPUT INSERTED.id,INSERTED.file_id,INSERTED.public_token,INSERTED.password_hash,
                INSERTED.expires_at,INSERTED.max_downloads,INSERTED.download_count,INSERTED.is_active,INSERTED.allow_external_preview,INSERTED.created_at
         VALUES (@fid,@tok,@pwH,@exp,@md,@act,@allowExternalPreview)`
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
      if (nextAllowExternalPreview) {
        if (!file.mime_type.startsWith('image/') && !file.mime_type.startsWith('video/'))
          return res.status(400).json({ error: 'External preview is only supported for image and video files.' });
        if (nextPasswordProtected)
          return res.status(400).json({ error: 'External preview links cannot use a share password.' });
        if (file.client_secret_hash)
          return res.status(400).json({ error: 'Files protected with a secret key cannot use external preview.' });
      }
      if (is_active === true && !shareRow.is_active) {
        upReq.input('newToken', sql.Char(32), generateSecureToken(16));
        sets.push('public_token=@newToken', 'download_count=0');
      }
      if (password !== undefined) { upReq.input('pw', sql.NVarChar(256), password ? await hashSharePassword(password) : null); sets.push('password_hash=@pw'); }
      if (expires_at !== undefined) { upReq.input('exp', sql.DateTimeOffset, expires_at||null); sets.push('expires_at=@exp'); }
      if (max_downloads !== undefined) { upReq.input('md', sql.Int, max_downloads ? Number(max_downloads) : null); sets.push('max_downloads=@md'); }
      if (is_active !== undefined) { upReq.input('act', sql.Bit, is_active ? 1 : 0); sets.push('is_active=@act'); }
      if (allow_external_preview !== undefined) {
        upReq.input('allowExternalPreview', sql.Bit, allow_external_preview ? 1 : 0);
        sets.push('allow_external_preview=@allowExternalPreview');
      }
      if (sets.length) {
        const upRes = await upReq.query<ShareRow>(
          `UPDATE share_links SET ${sets.join(',')}
           OUTPUT INSERTED.id,INSERTED.file_id,INSERTED.public_token,INSERTED.password_hash,
                  INSERTED.expires_at,INSERTED.max_downloads,INSERTED.download_count,INSERTED.is_active,INSERTED.allow_external_preview,INSERTED.created_at
           WHERE id=@id`
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
  logDownload: (req, fileId, originalName, token) =>
    logSystemEvent(null, 'Anonymous', 'Download', 'File', fileId, req, `Anonymous download of "${originalName}" via token ${token}.`),
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
       OUTPUT INSERTED.id,INSERTED.email_encrypted,INSERTED.email_iv,INSERTED.email_auth_tag,
              INSERTED.username_encrypted,INSERTED.username_iv,INSERTED.username_auth_tag,
              INSERTED.role,INSERTED.quota_id,INSERTED.storage_used_bytes,INSERTED.status,INSERTED.created_at,INSERTED.failed_login_count,INSERTED.locked_until
       WHERE id=@id`
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
       OUTPUT INSERTED.id,INSERTED.email_encrypted,INSERTED.email_iv,INSERTED.email_auth_tag,
              INSERTED.username_encrypted,INSERTED.username_iv,INSERTED.username_auth_tag,
              INSERTED.role,INSERTED.quota_id,INSERTED.storage_used_bytes,INSERTED.status,INSERTED.created_at,INSERTED.failed_login_count,INSERTED.locked_until
       WHERE id=@id`
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
       OUTPUT INSERTED.id,INSERTED.email_encrypted,INSERTED.email_iv,INSERTED.email_auth_tag,
              INSERTED.username_encrypted,INSERTED.username_iv,INSERTED.username_auth_tag,
              INSERTED.role,INSERTED.quota_id,INSERTED.storage_used_bytes,INSERTED.status,INSERTED.created_at,INSERTED.failed_login_count,INSERTED.locked_until
       WHERE id=@id`
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
      `SELECT f.id,f.owner_user_id,f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
              f.stored_path,f.mime_type,f.size_bytes,f.encrypted_size_bytes,f.status,f.checksum_sha256,
              f.scan_result,f.scan_message,f.is_encrypted,f.leeku_vibe,f.ttl_hours,f.expires_at,f.created_at,
              u.username_encrypted,u.username_iv,u.username_auth_tag
       FROM files f INNER JOIN users u ON f.owner_user_id=u.id ORDER BY f.created_at DESC`
    );
    res.json({ files: result.recordset.map(r => mapFileRow(r, decryptColumn(r.username_encrypted, r.username_iv, r.username_auth_tag))) });
  } catch (err) { console.error('[GET /api/admin/files]', err); res.status(500).json({ error: 'Failed to load files.' }); }
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
      `MERGE quotas AS target USING (SELECT @id AS id) AS src ON target.id=src.id
       WHEN MATCHED THEN UPDATE SET name=@name,storage_limit_bytes=@sl,max_file_size_bytes=@mf,max_files=@mfi,daily_upload_limit_bytes=@dl
       WHEN NOT MATCHED THEN INSERT (id,name,storage_limit_bytes,max_file_size_bytes,max_files,daily_upload_limit_bytes) VALUES (@id,@name,@sl,@mf,@mfi,@dl);`
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
  const request = await getRequest();
  await request.query(`
    IF COL_LENGTH('files', 'client_secret_hash') IS NULL
      ALTER TABLE files ADD client_secret_hash NVARCHAR(512) NULL;
    IF COL_LENGTH('files', 'client_crypto_salt') IS NULL
      ALTER TABLE files ADD client_crypto_salt VARBINARY(32) NULL;
    IF COL_LENGTH('files', 'client_crypto_iv') IS NULL
      ALTER TABLE files ADD client_crypto_iv VARBINARY(16) NULL;
    IF COL_LENGTH('files', 'client_crypto_iterations') IS NULL
      ALTER TABLE files ADD client_crypto_iterations INT NULL;
  `);
}

async function ensureOptionalShareLinkColumns(): Promise<void> {
  const request = await getRequest();
  await request.query(`
    IF COL_LENGTH('share_links', 'allow_external_preview') IS NULL
      ALTER TABLE share_links ADD allow_external_preview BIT NOT NULL CONSTRAINT DF_share_links_allow_external_preview DEFAULT(0);
  `);
}

async function bootstrap() {
  // 1. Validate production requirements and master encryption key
  validateProductionConfig();
  validateEncryptionConfig();

  // 2. Connect SQL Server
  await getPool();
  console.log('[server] SQL Server connection pool ready.');

  // 2b. Lightweight schema migration for optional user-provided file secrets.
  await ensureOptionalFileSecretColumns();
  await ensureOptionalShareLinkColumns();

  app.use('/api/health', createHealthRouter(FILE_VAULT, NODE_ENV === 'production'));

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

  // 7. Static files & SPA fallback
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
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
      console.log(`[server] Leeks.miku.rip HTTPS port ${sslPort}`);
    });
  } else {
    configureHttpServer(app.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] Leeks.miku.rip http://0.0.0.0:${PORT}`);
    }));
  }

  // 7. Graceful shutdown
  const shutdown = async (sig: string) => {
    console.log(`[server] ${sig} — shutting down.`);
    stopExpiryCleanup();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch(err => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
