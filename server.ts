/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Main Express Server
 * Integrates: SQL Server 2022, AES-256-GCM encryption, Bitdefender AV,
 * JWT auth, rate limiting, CORS, IIS W3C logging, file expiry cleanup.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import sql from 'mssql';
import si from 'systeminformation';

import { getPool, closePool, getRequest } from './src/lib/database.js';
import {
  encryptFile, decryptFile, wrapKey, unwrapKey,
  encryptColumn, decryptColumn, hashColumnForLookup,
  hashPassword, verifyPassword, hashSharePassword, verifySharePassword,
  generateSecureToken, computeChecksum, validateEncryptionConfig,
} from './src/lib/encryption.js';
import { scanFileBuffer, heuristicPreScan } from './src/lib/scanner.js';
import {
  startExpiryCleanup, stopExpiryCleanup,
  computeExpiresAt, isValidTtl,
  type ExpiredFileRecord,
} from './src/lib/expiry-cleanup.js';
import { sendVerificationEmail, sendAccountDeletionEmail, validateMxRecord, verifySmtpConnection } from './src/lib/email.js';
import { iisLoggingMiddleware, validateIISLoggingConfig } from './src/lib/iis-logger.js';
import type { Quota, User, FileMetadata, ShareLink, SystemLog, SystemStats } from './src/types.js';

// ──────────────────────────────────────────────────────────────
// Constants from environment
// ──────────────────────────────────────────────────────────────

const PORT               = parseInt(process.env.PORT || '3000', 10);
const APP_URL            = process.env.APP_URL || `http://localhost:${PORT}`;
const NODE_ENV           = process.env.NODE_ENV || 'development';
const FILE_VAULT         = process.env.FILE_STORAGE_UNC_PATH || path.join(process.cwd(), 'vault');
const MAX_LOG_ENTRIES    = parseInt(process.env.MAX_LOG_ENTRIES || '500', 10);
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MS= parseInt(process.env.LOCKOUT_DURATION_MINUTES || '15', 10) * 60_000;
const PROXY_TRUST_HOPS   = parseInt(process.env.PROXY_TRUST_HOPS || '0', 10);
const SMTP_ENABLED       = !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASSWORD;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const JWT_EXPIRY         = parseInt(process.env.JWT_ACCESS_EXPIRY_SECONDS || '900', 10);
const JWT_ISSUER         = process.env.JWT_ISSUER   || APP_URL;
const JWT_AUDIENCE       = process.env.JWT_AUDIENCE || 'leeku-secure-api';

function getJwtSecret(): string {
  const raw = process.env.COOKIE_SECRET_BASE64;
  if (!raw) throw new Error('[server] COOKIE_SECRET_BASE64 must be set in .env');
  return raw;
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
        'Clean file. Leeku approves.',
        'No malware detected. Surprisingly.',
        'Passed digital health exam. Safe inside the virtual container.',
        'Your file has been blessed by the leek guardian. Zero goblins.',
      ]
    : [
        'Cursed bytes detected. Upload denied.',
        'Digital goblins found in payload. Rejected.',
        'Leeku found something suspicious. Access denied.',
      ];

  if (!genai) {
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  try {
    const prompt = clean
      ? `Generate a short, funny, cyber-kawaii one-liner (max 80 chars) saying a file named "${filename}" passed security scan. Be witty and use Vocaloid/anime references. No hashtags.`
      : `Generate a short, funny, cyber-kawaii one-liner (max 80 chars) saying a file named "${filename}" was blocked. Be dramatic and use Vocaloid/anime references. No hashtags.`;

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

// JSON body limit — base64 encoding inflates binary data by ~33%.
// For a 700MB file the JSON body is ~933MB. Set MAX_UPLOAD_BODY_MB
// in .env to match your largest expected upload × 1.4 (headroom).
// Default: 2048 MB (2 GB) — Node.js max Buffer is ~4 GB on 64-bit.
// For files larger than ~1.5 GB, a streaming/chunked upload approach
// is required instead of base64 JSON (see upload architecture docs).
const uploadBodyLimitMb = parseInt(process.env.MAX_UPLOAD_BODY_MB || '2048', 10);
app.use(express.json({ limit: `${uploadBodyLimitMb}mb` }));
app.use(express.urlencoded({ limit: `${uploadBodyLimitMb}mb`, extended: true }));

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
  expires_at: Date | null; created_at: Date;
}

interface ShareRow {
  id: string; file_id: string; public_token: string; password_hash: string | null;
  expires_at: Date | null; max_downloads: number | null; download_count: number;
  is_active: boolean; created_at: Date;
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
    storage_used: row.storage_used_bytes,
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
    size:           row.size_bytes,
    encrypted_size: row.encrypted_size_bytes,
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
}

async function authenticateUser(
  req: AuthenticatedRequest, res: express.Response, next: express.NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  let token = '';
  if (authHeader?.startsWith('Bearer ')) token = authHeader.substring(7).trim();
  else if (req.headers['x-leek-token'])  token = String(req.headers['x-leek-token']).trim();

  if (!token) { res.status(401).json({ error: 'Auth credentials missing. Please log in first.' }); return; }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'Invalid or expired session token.' }); return; }

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
    res.json({ quotas: result.recordset });
  } catch (err) { console.error('[GET /api/quotas]', err); res.status(500).json({ error: 'Failed to load quotas.' }); }
});

app.get('/api/stats', async (req, res) => {
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
    const [cpuData, memData, diskData, osData] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.fsSize().catch(() => null),
      si.osInfo().catch(() => null),
    ]);

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
      uptime: osData ? Math.round(osData.uptime || 0) : 0,
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
      res.json({ token, user });
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
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Leeku Secure — Email Verification</title>
<style>body{background:#0A0E14;color:#ccc;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:480px;padding:40px;border:3px solid ${color};text-align:center;background:#0F1419}
h1{color:${color};font-size:20px;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px}
p{font-size:13px;line-height:1.6;margin:0 0 24px}
a{display:inline-block;background:#FF007F;color:#fff;padding:12px 28px;font-weight:900;text-transform:uppercase;text-decoration:none;font-size:12px;border:2px solid #00F2FF}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><a href="${APP_URL}">GO TO LOGIN</a></div></body></html>`;
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
    await logSystemEvent(user.id, user.username, 'Auth', 'User', user.id, req, 'User logged in.');
    res.json({ token, user });
  } catch (err) { console.error('[POST /api/auth/login]', err); res.status(500).json({ error: 'Login service unavailable.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Auth — Me & Update
// ──────────────────────────────────────────────────────────────

app.get('/api/auth/me', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

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
    await logSystemEvent(userId, user.username, 'Auth', 'User', userId, req, 'Updated account details.');
    res.json({ success: true, user });
  } catch (err) { console.error('[POST /api/users/me/update]', err); res.status(500).json({ error: 'Failed to update account.' }); }
});

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
    console.error('[GET /api/users/me/delete-confirm]', err);
    res.status(500).send(renderDeletionPage(false, 'Account deletion failed due to a server error.'));
  }
});

/**
 * Renders a simple HTML page for the account deletion result.
 */
function renderDeletionPage(success: boolean, message: string): string {
  const color = success ? '#00F2FF' : '#FF007F';
  const title = success ? 'ACCOUNT DELETED' : 'DELETION FAILED';
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
  <h1>${title}</h1>
  <p>${message}</p>
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
    const result = await request.query<FileRow>(
      `SELECT id, owner_user_id,
              original_name_encrypted, original_name_iv, original_name_auth_tag,
              stored_path, mime_type, size_bytes, encrypted_size_bytes,
              status, checksum_sha256, scan_result, scan_message,
              is_encrypted, leeku_vibe, ttl_hours, expires_at, created_at
       FROM files WHERE owner_user_id=@ownerId AND status!='Expired'
       ORDER BY created_at DESC`
    );
    res.json({ files: result.recordset.map(r => mapFileRow(r, req.user!.username)) });
  } catch (err) { console.error('[GET /api/files]', err); res.status(500).json({ error: 'Failed to load files.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Files — Upload
// ──────────────────────────────────────────────────────────────

app.post('/api/files/upload', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const { original_name, mime_type, content, size, ttl_hours } = req.body;
  if (!original_name || !mime_type || !content || size === undefined)
    return res.status(400).json({ error: 'Incomplete file metadata or payload.' });

  const user = req.user!;
  let currentStage = 'quota_lookup';
  let vaultFilePath: string | null = null;
  try {
    console.info('[upload] Request received.', {
      userId: user.id,
      username: user.username,
      originalName: original_name,
      mimeType: mime_type,
      declaredSize: size,
      ttlHours: ttl_hours ?? null,
      contentLength: typeof content === 'string' ? content.length : null,
    });

    const qReq = await getRequest();
    qReq.input('qid', sql.NVarChar(50), user.quota_id);
    const qRes = await qReq.query<Quota>('SELECT id,name,storage_limit_bytes,max_file_size_bytes,max_files,daily_upload_limit_bytes FROM quotas WHERE id=@qid');
    const quota = qRes.recordset[0];
    if (!quota) return res.status(400).json({ error: 'Quota tier not found.' });

    if (size > quota.max_file_size_bytes) {
      console.warn('[upload] Rejected by max file size quota.', {
        userId: user.id,
        originalName: original_name,
        declaredSize: size,
        maxFileSizeBytes: quota.max_file_size_bytes,
        quotaId: quota.id,
      });
      return res.status(400).json({ error: `File too large. Tier "${quota.name}" allows ${Math.round(quota.max_file_size_bytes/1024/1024)}MB per file.` });
    }

    const cntReq = await getRequest();
    cntReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
    const cntRes = await cntReq.query<{cnt:number;used:number}>(
      "SELECT COUNT(*) AS cnt, ISNULL(SUM(size_bytes),0) AS used FROM files WHERE owner_user_id=@ownerId AND status='Available'"
    );
    const { cnt, used } = cntRes.recordset[0];
    if (cnt >= quota.max_files) {
      console.warn('[upload] Rejected by file count quota.', {
        userId: user.id,
        originalName: original_name,
        fileCount: cnt,
        maxFiles: quota.max_files,
        quotaId: quota.id,
      });
      return res.status(400).json({ error: `File count limit reached (${quota.max_files} files).` });
    }
    if (used + size > quota.storage_limit_bytes) {
      console.warn('[upload] Rejected by storage quota.', {
        userId: user.id,
        originalName: original_name,
        usedBytes: used,
        incomingSize: size,
        storageLimitBytes: quota.storage_limit_bytes,
        quotaId: quota.id,
      });
      return res.status(400).json({ error: `Storage full. ${Math.round(used/1024/1024)}MB / ${Math.round(quota.storage_limit_bytes/1024/1024)}MB used.` });
    }

    currentStage = 'base64_decode';
    const fileBytes = Buffer.from(content, 'base64');
    console.info('[upload] Payload decoded.', {
      userId: user.id,
      originalName: original_name,
      declaredSize: size,
      decodedBytes: fileBytes.length,
      mimeType: mime_type,
    });

    // Heuristic pre-scan
    currentStage = 'heuristic_scan';
    const heuristic = heuristicPreScan(original_name, mime_type);
    if (heuristic !== null && !heuristic.clean) {
      console.warn('[upload] Rejected by heuristic pre-scan.', {
        userId: user.id,
        originalName: original_name,
        mimeType: mime_type,
        heuristicStatus: heuristic.status,
        heuristicMessage: heuristic.message,
      });
      const vibe = await generateLeekuVibe(original_name, false);
      await logSystemEvent(user.id, user.username, 'Scan', 'File', 'rejected', req, `Heuristic block: "${original_name}" — ${heuristic.message}`);
      return res.status(422).json({ error: heuristic.message || vibe });
    }

    // Bitdefender scan
    currentStage = 'bitdefender_scan';
    const scanResult = await scanFileBuffer(fileBytes, mime_type);
    console.info('[upload] Scan completed.', {
      userId: user.id,
      originalName: original_name,
      scanStatus: scanResult.status,
      scanClean: scanResult.clean,
      scanDurationMs: scanResult.scanDurationMs,
      threatCount: scanResult.threats.length,
      scanMessage: scanResult.message,
    });
    if (!scanResult.clean && scanResult.status !== 'Unavailable') {
      console.warn('[upload] Rejected by Bitdefender scan.', {
        userId: user.id,
        originalName: original_name,
        scanStatus: scanResult.status,
        scanDurationMs: scanResult.scanDurationMs,
        threatCount: scanResult.threats.length,
        scanMessage: scanResult.message,
      });
      const vibe = await generateLeekuVibe(original_name, false);
      await logSystemEvent(user.id, user.username, 'Scan', 'File', 'rejected', req, `AV block: "${original_name}" — ${scanResult.message}`);
      return res.status(422).json({ error: vibe || scanResult.message });
    }

    // Encrypt
    currentStage = 'encrypt_file';
    const checksum  = computeChecksum(fileBytes);
    const encrypted = encryptFile(fileBytes);
    const wrapped   = wrapKey(encrypted.key);

    const vaultFileName = generateSecureToken(16) + '.vault';
    vaultFilePath = path.join(FILE_VAULT, vaultFileName);
    currentStage = 'write_vault';
    fs.writeFileSync(vaultFilePath, encrypted.ciphertext);
    console.info('[upload] Encrypted file written to vault.', {
      userId: user.id,
      originalName: original_name,
      vaultFileName,
      encryptedSizeBytes: encrypted.ciphertext.length,
      vaultPath: vaultFilePath,
    });

    currentStage = 'prepare_metadata';
    const ttlH     = isValidTtl(Number(ttl_hours)) ? Number(ttl_hours) as any : null;
    const expiresAt= ttlH ? computeExpiresAt(ttlH) : null;
    const encName  = encryptColumn(original_name);
    const leekuVibe= await generateLeekuVibe(original_name, true);

    currentStage = 'insert_file_record';
    const fileReq = await getRequest();
    fileReq.input('ownerId', sql.UniqueIdentifier, req.userId!);
    fileReq.input('nEnc',   sql.VarBinary(2048), encName.ciphertext);
    fileReq.input('nIv',    sql.VarBinary(16),   encName.iv);
    fileReq.input('nTag',   sql.VarBinary(16),   encName.authTag);
    fileReq.input('spath',  sql.NVarChar(1000),  vaultFileName);
    fileReq.input('mime',   sql.NVarChar(255),   mime_type);
    fileReq.input('sz',     sql.BigInt,          size);
    fileReq.input('esz',    sql.BigInt,          encrypted.ciphertext.length);
    fileReq.input('chk',    sql.Char(64),        checksum);
    fileReq.input('scan',   sql.NVarChar(20),    scanResult.status === 'Unavailable' ? null : scanResult.status);
    fileReq.input('smsg',   sql.NVarChar(sql.MAX), scanResult.message);
    fileReq.input('vibe',   sql.NVarChar(500),   leekuVibe);
    fileReq.input('ttl',    sql.Int,             ttlH);
    fileReq.input('exp',    sql.DateTimeOffset,  expiresAt);

    const fileResult = await fileReq.query<FileRow>(
      `INSERT INTO files (
         owner_user_id, original_name_encrypted, original_name_iv, original_name_auth_tag,
         stored_path, mime_type, size_bytes, encrypted_size_bytes,
         checksum_sha256, scan_result, scan_message, scanned_at,
         leeku_vibe, ttl_hours, expires_at, is_encrypted
       )
       OUTPUT INSERTED.id, INSERTED.owner_user_id,
              INSERTED.original_name_encrypted, INSERTED.original_name_iv, INSERTED.original_name_auth_tag,
              INSERTED.stored_path, INSERTED.mime_type, INSERTED.size_bytes, INSERTED.encrypted_size_bytes,
              INSERTED.status, INSERTED.checksum_sha256, INSERTED.scan_result, INSERTED.scan_message,
              INSERTED.is_encrypted, INSERTED.leeku_vibe, INSERTED.ttl_hours, INSERTED.expires_at, INSERTED.created_at
       VALUES (@ownerId,@nEnc,@nIv,@nTag, @spath,@mime,@sz,@esz, @chk,@scan,@smsg,SYSDATETIMEOFFSET(), @vibe,@ttl,@exp,1)`
    );
    const newFile = fileResult.recordset[0];
    console.info('[upload] File record inserted.', {
      userId: user.id,
      originalName: original_name,
      fileId: newFile.id,
      scanStatus: scanResult.status,
    });

    currentStage = 'insert_key_record';
    const keyReq = await getRequest();
    keyReq.input('fid',   sql.UniqueIdentifier, newFile.id);
    keyReq.input('encK',  sql.VarBinary(64),    wrapped.encryptedKey);
    keyReq.input('kIv',   sql.VarBinary(16),    wrapped.iv);
    keyReq.input('kTag',  sql.VarBinary(16),    wrapped.authTag);
    keyReq.input('fIv',   sql.VarBinary(16),    encrypted.iv);
    keyReq.input('fTag',  sql.VarBinary(16),    encrypted.authTag);
    await keyReq.query(
      'INSERT INTO file_encryption_keys (file_id,encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag) VALUES (@fid,@encK,@kIv,@kTag,@fIv,@fTag)'
    );

    currentStage = 'update_storage_usage';
    const storageReq = await getRequest();
    storageReq.input('sz', sql.BigInt, size); storageReq.input('id', sql.UniqueIdentifier, req.userId!);
    await storageReq.query('UPDATE users SET storage_used_bytes=storage_used_bytes+@sz WHERE id=@id');

    currentStage = 'log_upload_event';
    await logSystemEvent(user.id, user.username, 'Upload', 'File', newFile.id, req,
      `Uploaded "${original_name}" (${Math.round(size/1024)}KB). Scan: ${scanResult.status}.`);

    console.info('[upload] Upload completed successfully.', {
      userId: user.id,
      username: user.username,
      originalName: original_name,
      fileId: newFile.id,
      scanStatus: scanResult.status,
      storedPath: newFile.stored_path,
    });

    res.json({ success: true, message: 'File approved and encrypted!', file: mapFileRow(newFile, user.username) });
  } catch (err) {
    console.error('[POST /api/files/upload] Upload failed.', {
      userId: user.id,
      username: user.username,
      originalName: original_name,
      mimeType: mime_type,
      declaredSize: size,
      stage: currentStage,
      vaultFilePath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

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

app.get('/api/files/:id/download', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
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

    const encBytes = fs.readFileSync(vaultPath);
    const keyRow = keyRes.recordset[0];
    const fileKey = unwrapKey(keyRow.encrypted_key, keyRow.key_iv, keyRow.key_auth_tag);
    const plainBytes = decryptFile(encBytes, fileKey, keyRow.file_iv, keyRow.file_auth_tag);

    if (computeChecksum(plainBytes) !== file.checksum_sha256)
      return res.status(500).json({ error: 'File integrity check failed.' });

    const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
    const safeName = originalName.replace(/"/g, '\\"');

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', plainBytes.length.toString());
    await logSystemEvent(req.userId!, req.user!.username, 'Download', 'File', fileId, req, `Direct download of "${originalName}".`);
    res.send(plainBytes);
  } catch (err) { console.error('[GET /api/files/:id/download]', err); res.status(500).json({ error: 'Download failed.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Share Links
// ──────────────────────────────────────────────────────────────

app.get('/api/sharing/links', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const request = await getRequest();
    request.input('ownerId', sql.UniqueIdentifier, req.userId!);
    const result = await request.query<ShareRow>(
      `SELECT sl.id,sl.file_id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.created_at
       FROM share_links sl INNER JOIN files f ON sl.file_id=f.id
       WHERE f.owner_user_id=@ownerId ORDER BY sl.created_at DESC`
    );
    res.json({ links: result.recordset.map(mapShareRow) });
  } catch (err) { console.error('[GET /api/sharing/links]', err); res.status(500).json({ error: 'Failed to load share links.' }); }
});

app.post('/api/files/:id/share', authenticateUser as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  const { password, expires_at, max_downloads, is_active } = req.body;
  try {
    const fReq = await getRequest(); fReq.input('id', sql.UniqueIdentifier, fileId);
    const fRes = await fReq.query<{owner_user_id:string;status:string}>('SELECT owner_user_id,status FROM files WHERE id=@id');
    if (!fRes.recordset.length) return res.status(404).json({ error: 'File not found.' });
    const file = fRes.recordset[0];
    if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
      return res.status(403).json({ error: 'Only the file owner can manage share links.' });
    if (file.status === 'Blocked') return res.status(400).json({ error: 'Blocked files cannot be shared.' });

    const exReq = await getRequest(); exReq.input('fid', sql.UniqueIdentifier, fileId);
    const existing = await exReq.query<ShareRow>(
      'SELECT id,file_id,public_token,password_hash,expires_at,max_downloads,download_count,is_active,created_at FROM share_links WHERE file_id=@fid'
    );

    let shareRow: ShareRow;
    if (!existing.recordset.length) {
      const token = generateSecureToken(16);
      const pwH   = password ? await hashSharePassword(password) : null;
      const insReq = await getRequest();
      insReq.input('fid',   sql.UniqueIdentifier, fileId);
      insReq.input('tok',   sql.Char(32),         token);
      insReq.input('pwH',   sql.NVarChar(256),    pwH);
      insReq.input('exp',   sql.DateTimeOffset,   expires_at || null);
      insReq.input('md',    sql.Int,              max_downloads ? Number(max_downloads) : null);
      insReq.input('act',   sql.Bit,              is_active !== undefined ? (is_active ? 1 : 0) : 1);
      const insRes = await insReq.query<ShareRow>(
        `INSERT INTO share_links (file_id,public_token,password_hash,expires_at,max_downloads,is_active)
         OUTPUT INSERTED.id,INSERTED.file_id,INSERTED.public_token,INSERTED.password_hash,
                INSERTED.expires_at,INSERTED.max_downloads,INSERTED.download_count,INSERTED.is_active,INSERTED.created_at
         VALUES (@fid,@tok,@pwH,@exp,@md,@act)`
      );
      shareRow = insRes.recordset[0];
    } else {
      shareRow = existing.recordset[0];
      const sets: string[] = [];
      const upReq = await getRequest(); upReq.input('id', sql.UniqueIdentifier, shareRow.id);
      if (password !== undefined) { upReq.input('pw', sql.NVarChar(256), password ? await hashSharePassword(password) : null); sets.push('password_hash=@pw'); }
      if (expires_at !== undefined) { upReq.input('exp', sql.DateTimeOffset, expires_at||null); sets.push('expires_at=@exp'); }
      if (max_downloads !== undefined) { upReq.input('md', sql.Int, max_downloads ? Number(max_downloads) : null); sets.push('max_downloads=@md'); }
      if (is_active !== undefined) { upReq.input('act', sql.Bit, is_active ? 1 : 0); sets.push('is_active=@act'); }
      if (sets.length) {
        const upRes = await upReq.query<ShareRow>(
          `UPDATE share_links SET ${sets.join(',')}
           OUTPUT INSERTED.id,INSERTED.file_id,INSERTED.public_token,INSERTED.password_hash,
                  INSERTED.expires_at,INSERTED.max_downloads,INSERTED.download_count,INSERTED.is_active,INSERTED.created_at
           WHERE id=@id`
        );
        shareRow = upRes.recordset[0];
      }
    }

    await logSystemEvent(req.userId!, req.user!.username, 'Link', 'ShareLink', shareRow.id, req, `Configured share for file ${fileId}.`);
    res.json({ success: true, link: mapShareRow(shareRow) });
  } catch (err) { console.error('[POST /api/files/:id/share]', err); res.status(500).json({ error: 'Failed to configure share link.' }); }
});

// ──────────────────────────────────────────────────────────────
// API: Public Download
// ──────────────────────────────────────────────────────────────

app.get('/api/public/share/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const request = await getRequest(); request.input('tok', sql.Char(32), token);
    const result = await request.query<ShareRow & {
      file_status: string; leeku_vibe: string|null; mime_type: string;
      size_bytes: number; file_created_at: Date;
      owner_username_encrypted: Buffer; owner_username_iv: Buffer; owner_username_auth_tag: Buffer;
    }>(
      `SELECT sl.id,sl.file_id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.created_at,
              f.status AS file_status,f.leeku_vibe,f.mime_type,f.size_bytes,f.created_at AS file_created_at,
              u.username_encrypted AS owner_username_encrypted, u.username_iv AS owner_username_iv, u.username_auth_tag AS owner_username_auth_tag
       FROM share_links sl
       INNER JOIN files f ON sl.file_id=f.id
       INNER JOIN users u ON f.owner_user_id=u.id
       WHERE sl.public_token=@tok`
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'Share link not found.' });
    const row = result.recordset[0];
    if (!row.is_active)                                                    return res.status(404).json({ error: 'Share link inactive.' });
    if (row.file_status === 'Blocked')                                     return res.status(410).json({ error: 'File has been blocked.' });
    if (row.expires_at && new Date(row.expires_at) < new Date())           return res.status(410).json({ error: 'Share link has expired.' });
    if (row.max_downloads && row.download_count >= row.max_downloads)      return res.status(410).json({ error: 'Download limit reached.' });

    const ownerUsername = decryptColumn(row.owner_username_encrypted, row.owner_username_iv, row.owner_username_auth_tag);
    res.json({
      token: row.public_token, mime_type: row.mime_type, size: row.size_bytes,
      created_at: row.file_created_at?.toISOString(), protected: !!row.password_hash,
      uploader: ownerUsername, leeku_vibe: row.leeku_vibe||'',
      downloads_current: row.download_count, downloads_max: row.max_downloads,
    });
  } catch (err) { console.error('[GET /api/public/share/:token]', err); res.status(500).json({ error: 'Failed to load share info.' }); }
});

app.post('/api/public/share/:token/download', async (req, res) => {
  const token = req.params.token;
  const { password } = req.body;
  try {
    const request = await getRequest(); request.input('tok', sql.Char(32), token);
    const result = await request.query<ShareRow & {
      file_status: string; stored_path: string;
      original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
      mime_type: string; checksum_sha256: string; file_id_join: string;
      encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer;
    }>(
      `SELECT sl.id,sl.file_id AS file_id_join,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.created_at,
              f.status AS file_status,f.stored_path,f.mime_type,f.checksum_sha256,
              f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
              k.encrypted_key,k.key_iv,k.key_auth_tag,k.file_iv,k.file_auth_tag
       FROM share_links sl
       INNER JOIN files f ON sl.file_id=f.id
       INNER JOIN file_encryption_keys k ON f.id=k.file_id
       WHERE sl.public_token=@tok`
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'Share link not found.' });
    const row = result.recordset[0];
    if (!row.is_active)                                               return res.status(404).json({ error: 'Share link inactive.' });
    if (row.file_status === 'Blocked')                                return res.status(410).json({ error: 'File has been blocked.' });
    if (row.expires_at && new Date(row.expires_at) < new Date())      return res.status(410).json({ error: 'Link expired.' });
    if (row.max_downloads && row.download_count >= row.max_downloads) return res.status(410).json({ error: 'Download limit reached.' });

    if (row.password_hash) {
      if (!password) return res.status(403).json({ error: 'Password required.' });
      const valid = await verifySharePassword(password, row.password_hash);
      if (!valid) return res.status(403).json({ error: 'Incorrect vault password.' });
    }

    const vaultPath = path.join(FILE_VAULT, row.stored_path);
    if (!fs.existsSync(vaultPath)) return res.status(410).json({ error: 'Vault file not found.' });

    const encBytes  = fs.readFileSync(vaultPath);
    const fileKey   = unwrapKey(row.encrypted_key, row.key_iv, row.key_auth_tag);
    const plainBytes= decryptFile(encBytes, fileKey, row.file_iv, row.file_auth_tag);

    if (computeChecksum(plainBytes) !== row.checksum_sha256)
      return res.status(500).json({ error: 'File integrity check failed.' });

    const dlReq = await getRequest(); dlReq.input('id', sql.UniqueIdentifier, row.id);
    await dlReq.query('UPDATE share_links SET download_count=download_count+1 WHERE id=@id');

    const originalName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
    await logSystemEvent(null, 'Anonymous', 'Download', 'File', row.file_id_join, req,
      `Anonymous download of "${originalName}" via token ${token}.`);

    res.json({ original_name: originalName, mime_type: row.mime_type, content: plainBytes.toString('base64') });
  } catch (err) { console.error('[POST /api/public/share/:token/download]', err); res.status(500).json({ error: 'Download failed.' }); }
});

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

async function bootstrap() {
  // 1. Validate master encryption key
  validateEncryptionConfig();

  // 2. Connect SQL Server
  await getPool();
  console.log('[server] SQL Server connection pool ready.');

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
    https.createServer(sslOptions, app).listen(sslPort, '0.0.0.0', () => {
      console.log(`[server] Leeks.miku.rip HTTPS port ${sslPort}`);
    });
  } else {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] Leeks.miku.rip http://0.0.0.0:${PORT}`);
    });
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
