import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getRequest, sql } from '../db.js';
import {
  computeFileChecksum,
  decryptClientProtectedFileInPlace,
  decryptColumn,
  decryptFileStream,
  unwrapKey,
  verifyFileSecret,
  verifySharePassword,
} from '../utils/encryption.js';
import { getPublicProfilePictureUrl } from '../utils/profile-picture.js';
import { getTextPreviewKind, TEXT_PREVIEW_MAX_BYTES } from '../utils/text-preview.js';

interface ShareRow {
  id: string;
  owner_user_id: string;
  public_token: string;
  password_hash: string | null;
  expires_at: Date | null;
  max_downloads: number | null;
  download_count: number;
  is_active: boolean;
  allow_external_preview: boolean;
}

type DownloadPreparationPhase = 'decrypting' | 'verifying' | 'finalizing' | 'ready' | 'error';

interface PublicDownloadSession {
  id: string;
  token: string;
  shareId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  tempFile: string;
  sizeBytes: number;
  status: 'preparing' | 'ready' | 'error';
  phase: DownloadPreparationPhase;
  loaded: number;
  total: number;
  expiresAt: number;
  claimed: boolean;
  error?: string;
}

function getSingleParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function createPublicSharingRouter(options: {
  vaultPath: string;
  tempPath: string;
  profilePictureRoot?: string;
  logDownload: (req: express.Request, fileId: string, originalName: string, token: string) => Promise<void>;
}): express.Router {
  const router = express.Router();
  const FACEBOOK_APP_ID = String(process.env.FACEBOOK_APP_ID || process.env.FB_APP_ID || '').trim();
  const EMBED_CACHE_PREFIX = 'leeku-embed-cache';
  const EMBED_CACHE_TTL_MS = (() => {
    const fallback = 30 * 60_000;
    const raw = process.env.PUBLIC_SHARE_EMBED_CACHE_TTL_MS;
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 60_000) return Math.floor(parsed);
    console.warn(`[public-sharing] Invalid PUBLIC_SHARE_EMBED_CACHE_TTL_MS="${raw}". Using ${fallback}.`);
    return fallback;
  })();
  const EMBED_CACHE_SWEEP_INTERVAL_MS = 60_000;
  const DOWNLOAD_SESSION_TTL_MS = 10 * 60_000;
  const embedCacheInflight = new Map<string, Promise<string>>();
  const downloadSessions = new Map<string, PublicDownloadSession>();
  let lastEmbedCacheSweep = 0;

  if (!fs.existsSync(options.tempPath)) {
    fs.mkdirSync(options.tempPath, { recursive: true });
  }

  const buildUniqueTempFilePath = (prefix: string, id: string): string => {
    const unique = crypto.randomBytes(8).toString('hex');
    return path.join(options.tempPath, `${prefix}-${id}-${Date.now()}-${unique}.tmp`);
  };

  const getEmbedCachePath = (token: string, fileId: string): string => {
    const key = crypto.createHash('sha256').update(`${token}:${fileId}`).digest('hex').slice(0, 24);
    return path.join(options.tempPath, `${EMBED_CACHE_PREFIX}-${key}.tmp`);
  };

  const sweepEmbedCache = () => {
    const now = Date.now();
    if (now - lastEmbedCacheSweep < EMBED_CACHE_SWEEP_INTERVAL_MS) return;
    lastEmbedCacheSweep = now;

    try {
      const entries = fs.readdirSync(options.tempPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.startsWith(EMBED_CACHE_PREFIX)) continue;

        const fullPath = path.join(options.tempPath, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > EMBED_CACHE_TTL_MS) {
            fs.unlinkSync(fullPath);
          }
        } catch {
          // best-effort cleanup only
        }
      }
    } catch {
      // best-effort cleanup only
    }
  };

  const removeDownloadSession = (downloadId: string) => {
    const session = downloadSessions.get(downloadId);
    if (!session) return;
    downloadSessions.delete(downloadId);
    try {
      if (fs.existsSync(session.tempFile)) fs.unlinkSync(session.tempFile);
    } catch {
      // best-effort cleanup only
    }
  };

  const sweepDownloadSessions = () => {
    const now = Date.now();
    for (const [downloadId, session] of downloadSessions.entries()) {
      if (session.expiresAt <= now) {
        removeDownloadSession(downloadId);
      }
    }
  };

  const ensureEmbedCacheFile = async (
    cachePath: string,
    cacheKey: string,
    vaultFile: string,
    fileKey: Buffer,
    fileIv: Buffer,
    fileAuthTag: Buffer,
    expectedSize: number,
    expectedChecksum: string,
  ): Promise<string> => {
    if (fs.existsSync(cachePath)) {
      try {
        const stat = fs.statSync(cachePath);
        if (stat.size === expectedSize) return cachePath;
      } catch {
        // continue and regenerate
      }
    }

    const inflight = embedCacheInflight.get(cacheKey);
    if (inflight) return inflight;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildPromise = (async () => {
  const partPath = `${cachePath}.part-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await decryptFileStream(vaultFile, partPath, fileKey, fileIv, fileAuthTag);
    const checksum = await computeFileChecksum(partPath);
    if (checksum !== expectedChecksum) {
      throw new Error('File integrity check failed.');
    }

    await sleep(100);

    let finalized = false;
    let lastFinalizeError: unknown = null;

    for (let attempt = 0; attempt < 8 && !finalized; attempt += 1) {
      if (attempt > 0) {
        const backoffMs = Math.min(1000, 50 * Math.pow(2, attempt - 1));
        await sleep(backoffMs);
      }

      try {
        // 1. Prioritize checking if another thread already created the file
        if (fs.existsSync(cachePath)) {
          try { fs.unlinkSync(partPath); } catch (_) {}
          
          // WINDOWS LOCK CHECK: Ensure the other thread is done writing before we read it
          let isLocked = true;
          for (let readAttempt = 0; readAttempt < 15; readAttempt++) {
            try {
              const handle = fs.openSync(cachePath, 'r');
              fs.closeSync(handle);
              isLocked = false;
              break; 
            } catch (lockErr: any) {
              if (['EPERM', 'EACCES', 'EBUSY'].includes(lockErr.code)) {
                await sleep(150); 
              } else {
                break;
              }
            }
          }
          
          finalized = true;
          break; 
        }

        // 2. Try the atomic swap if it doesn't exist yet
        fs.renameSync(partPath, cachePath);
        finalized = true;
        break;

      } catch (err: any) {
        lastFinalizeError = err;
        const windowsLockingCodes = ['EPERM', 'EEXIST', 'EACCES', 'EBUSY', 'ENOTEMPTY'];

        if (windowsLockingCodes.includes(err.code)) {
          console.log(`[Cache Sync] Handled concurrent write collision for: ${partPath} (${err.code})`);
          
          if (fs.existsSync(partPath)) {
            try { fs.unlinkSync(partPath); } catch (_) {}
          }
          
          // WINDOWS LOCK CHECK FOR COLLISION: Wait until the winning thread finishes writing
          let isLocked = true;
          for (let readAttempt = 0; readAttempt < 15; readAttempt++) {
            try {
              const handle = fs.openSync(cachePath, 'r');
              fs.closeSync(handle);
              isLocked = false;
              break; 
            } catch (lockErr: any) {
              if (['EPERM', 'EACCES', 'EBUSY'].includes(lockErr.code)) {
                await sleep(150); 
              } else {
                break;
              }
            }
          }
          
          finalized = true; 
          break; 
        }
        
        throw err; 
      }
    }

    if (!finalized) {
      const message =
        lastFinalizeError instanceof Error
          ? lastFinalizeError.message
          : String(lastFinalizeError ?? 'unknown error');
      throw new Error(`Failed to finalize embed cache file: ${message}`);
    }

    return cachePath;
  } finally {
    // This finally block is now perfectly paired to the root try block on line 5
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
  }
})();


    embedCacheInflight.set(cacheKey, buildPromise);
    try {
      return await buildPromise;
    } finally {
      embedCacheInflight.delete(cacheKey);
    }
  };

  router.get('/:token', async (req, res) => {
    try {
      const request = await getRequest(); request.input('tok', sql.Char(32), getSingleParam(req.params.token));
      const result = await request.query<ShareRow & {
        file_status: string; leeku_vibe: string|null; mime_type: string;
        size_bytes: number; file_created_at: Date; stored_path: string;
        client_secret_hash: string | null;
        original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
        owner_username_encrypted: Buffer; owner_username_iv: Buffer; owner_username_auth_tag: Buffer;
      }>(
        `SELECT sl.id,u.id AS owner_user_id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,
                f.status AS file_status,f.leeku_vibe,f.mime_type,f.size_bytes,f.created_at AS file_created_at,f.stored_path,f.client_secret_hash,
                f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
                u.username_encrypted AS owner_username_encrypted,u.username_iv AS owner_username_iv,u.username_auth_tag AS owner_username_auth_tag
         FROM share_links sl
         INNER JOIN files f ON sl.file_id=f.id
         INNER JOIN users u ON f.owner_user_id=u.id
         WHERE sl.public_token=@tok`
      );
      const row = result.recordset[0];
      if (!row) return res.status(404).json({ error: 'Share link not found.' });
      if (!row.is_active) return res.status(404).json({ error: 'Share link inactive.' });
      if (row.file_status === 'Blocked') return res.status(410).json({ error: 'File has been blocked.' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Share link has expired.' });
      if (row.max_downloads && row.download_count >= row.max_downloads) return res.status(410).json({ error: 'Download limit reached.' });
      if (!fs.existsSync(path.join(options.vaultPath, row.stored_path))) return res.status(410).json({ error: 'The shared file is no longer available.' });
      const fileName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      const previewKind = getTextPreviewKind(fileName, row.mime_type || '');
      res.json({
        token: row.public_token,
        file_name: fileName,
        mime_type: row.mime_type,
        size: row.size_bytes,
        created_at: row.file_created_at?.toISOString(),
        protected: !!row.password_hash,
        requires_secret_key: !!row.client_secret_hash,
        allow_external_preview: !!row.allow_external_preview,
        uploader: decryptColumn(row.owner_username_encrypted, row.owner_username_iv, row.owner_username_auth_tag),
        leeku_vibe: row.leeku_vibe || '',
        downloads_current: row.download_count,
        downloads_max: row.max_downloads,
        preview_kind: previewKind,
        preview_available: !!previewKind && row.size_bytes <= TEXT_PREVIEW_MAX_BYTES,
        preview_max_bytes: TEXT_PREVIEW_MAX_BYTES,
      });
    } catch (error) {
      console.error('[GET /api/public/share/:token]', error);
      res.status(500).json({ error: 'Failed to load share info.' });
    }
  });

  router.post('/:token/preview', rateLimit({
    windowMs: 15 * 60_000,
    max: parseInt(process.env.PUBLIC_SHARE_PREVIEW_ATTEMPTS_PER_15_MIN || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many preview or password attempts. Please wait before trying again.' },
  }), async (req, res) => {
    const token = getSingleParam(req.params.token);
    const { password, secret_key } = req.body;
    let tempFile = '';

    try {
      const request = await getRequest();
      request.input('tok', sql.Char(32), token);
      const result = await request.query<ShareRow & {
        file_status: string; stored_path: string; mime_type: string; size_bytes: number;
        client_secret_hash: string | null; client_crypto_salt: Buffer | null; client_crypto_iv: Buffer | null; client_crypto_iterations: number | null;
        original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
        checksum_sha256: string; file_id_join: string;
        encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer;
      }>(
        `SELECT sl.id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,
                f.id AS file_id_join,f.status AS file_status,f.stored_path,f.mime_type,f.size_bytes,f.checksum_sha256,
                f.client_secret_hash,f.client_crypto_salt,f.client_crypto_iv,f.client_crypto_iterations,
                f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
                k.encrypted_key,k.key_iv,k.key_auth_tag,k.file_iv,k.file_auth_tag
         FROM share_links sl
         INNER JOIN files f ON sl.file_id=f.id
         INNER JOIN file_encryption_keys k ON f.id=k.file_id
         WHERE sl.public_token=@tok`,
      );
      const row = result.recordset[0];
      if (!row) return res.status(404).json({ error: 'Share link not found.' });
      if (!row.is_active) return res.status(404).json({ error: 'Share link inactive.' });
      if (row.file_status === 'Blocked') return res.status(410).json({ error: 'File has been blocked.' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired.' });
      if (row.max_downloads && row.download_count >= row.max_downloads) return res.status(410).json({ error: 'Download limit reached.' });

      const originalName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      const previewKind = getTextPreviewKind(originalName, row.mime_type || '');
      if (!previewKind) return res.status(415).json({ error: 'Preview is only available for text and CSV files.' });
      if (Number(row.size_bytes || 0) > TEXT_PREVIEW_MAX_BYTES) {
        return res.status(413).json({ error: 'This file is larger than the 5 MB preview limit.' });
      }
      if (row.password_hash && (!password || !(await verifySharePassword(password, row.password_hash)))) {
        return res.status(403).json({ error: password ? 'Incorrect vault password.' : 'Password required.' });
      }
      const providedSecret = typeof secret_key === 'string' ? secret_key.trim() : '';
      if (row.client_secret_hash) {
        if (!providedSecret) return res.status(403).json({ error: 'Secret key required.' });
        if (!(await verifyFileSecret(providedSecret, row.client_secret_hash))) {
          return res.status(403).json({ error: 'Incorrect secret key.' });
        }
      }

      const vaultFile = path.join(options.vaultPath, row.stored_path);
      if (!fs.existsSync(vaultFile)) return res.status(410).json({ error: 'Vault file not found.' });
      tempFile = buildUniqueTempFilePath('leeku-preview', token);
      const fileKey = unwrapKey(row.encrypted_key, row.key_iv, row.key_auth_tag);
      const hash = crypto.createHash('sha256');
      await decryptFileStream(vaultFile, tempFile, fileKey, row.file_iv, row.file_auth_tag, undefined, hash);
      if (hash.digest('hex') !== row.checksum_sha256) throw new Error('File integrity check failed.');

      if (row.client_secret_hash) {
        if (!row.client_crypto_salt || !row.client_crypto_iv || !row.client_crypto_iterations) {
          throw new Error('Secret-key metadata is missing for this file.');
        }
        await decryptClientProtectedFileInPlace(
          tempFile,
          providedSecret,
          row.client_crypto_salt,
          row.client_crypto_iv,
          row.client_crypto_iterations,
        );
      }

      const previewSize = fs.statSync(tempFile).size;
      if (previewSize > TEXT_PREVIEW_MAX_BYTES) {
        return res.status(413).json({ error: 'This file is larger than the 5 MB preview limit.' });
      }
      const content = await fs.promises.readFile(tempFile, 'utf8');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.json({ kind: previewKind, content });
    } catch (error) {
      console.error('[POST /api/public/share/:token/preview]', error);
      return res.status(500).json({ error: 'Preview failed.' });
    } finally {
      if (tempFile) {
        try { await fs.promises.unlink(tempFile); } catch {}
      }
    }
  });

  // ── Helpers for OG metadata pages (Discord embeds) ──
  const ogFormatBytes = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(
      Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
      units.length - 1,
    );
    return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  };

  const resolveOgImageUrl = (baseUrl: string): string | null => {
    try {
      const assetsDir = path.join(process.cwd(), 'dist', 'assets');
      const entries = fs.readdirSync(assetsDir, { withFileTypes: true });
      const mascotAsset = entries.find(
        (entry) => entry.isFile() && /^leeku_mascot-.*\.png$/i.test(entry.name),
      );
      if (!mascotAsset) return null;
      return `${baseUrl}/assets/${encodeURIComponent(mascotAsset.name)}`;
    } catch {
      return null;
    }
  };

  const resolveProfilePictureOgImageUrl = (baseUrl: string, userId: string | null | undefined): string | null => {
    if (!userId || !options.profilePictureRoot) return null;
    return getPublicProfilePictureUrl(baseUrl, options.profilePictureRoot, userId);
  };

  const ogErrorHtml = (label: string): string => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${label}</title></head><body><p>${label}</p></body></html>`;

  const buildShareOgHtml = async (
    req: express.Request,
    res: express.Response,
    token: string,
    baseUrl: string,
  ): Promise<void> => {
    const request = await getRequest();
    request.input('tok', sql.Char(32), token);
    const result = await request.query<ShareRow & {
      file_status: string; mime_type: string;
      size_bytes: number; file_created_at: Date; stored_path: string;
      original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
      owner_username_encrypted: Buffer; owner_username_iv: Buffer; owner_username_auth_tag: Buffer;
    }>(
      `SELECT sl.id,u.id AS owner_user_id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,
              f.status AS file_status,f.mime_type,f.size_bytes,f.created_at AS file_created_at,f.stored_path,
              f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
              u.username_encrypted AS owner_username_encrypted,u.username_iv AS owner_username_iv,u.username_auth_tag AS owner_username_auth_tag
       FROM share_links sl
       INNER JOIN files f ON sl.file_id=f.id
       INNER JOIN users u ON f.owner_user_id=u.id
       WHERE sl.public_token=@tok`
    );
    const row = result.recordset[0];
    if (!row) { res.status(404).type('html').send(ogErrorHtml('Not Found')); return; }
    if (!row.is_active) { res.status(404).type('html').send(ogErrorHtml('Not Found')); return; }
    if (row.file_status === 'Blocked') { res.status(410).type('html').send(ogErrorHtml('Unavailable')); return; }
    if (row.expires_at && new Date(row.expires_at) < new Date()) { res.status(410).type('html').send(ogErrorHtml('Expired')); return; }
    if (row.max_downloads && row.download_count >= row.max_downloads) { res.status(410).type('html').send(ogErrorHtml('Expired')); return; }

    const fileName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
    const uploader = decryptColumn(row.owner_username_encrypted, row.owner_username_iv, row.owner_username_auth_tag);
    const sizeLabel = ogFormatBytes(row.size_bytes);
    const appUrl = `${baseUrl}/#f/${token}`;
    // Use a non-fragment URL for social crawlers (Messenger/Facebook may ignore hash-only URLs).
    const previewUrl = `${baseUrl}/s/${token}`;

    const esc = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;');
    const safeFileName = esc(fileName);
    const safeUploader = esc(uploader);
    const safeAppUrl = esc(appUrl);
    const safePreviewUrl = esc(previewUrl);
    const profileImageUrl = resolveProfilePictureOgImageUrl(baseUrl, row.owner_user_id);
    const ogImageUrl = profileImageUrl || resolveOgImageUrl(baseUrl);
    const safeOgImageUrl = ogImageUrl ? esc(ogImageUrl) : null;
    const ogTitle = `${safeFileName} - Shared by ${safeUploader}`;
    const ogDescription = `${safeFileName} · ${sizeLabel} · Shared by ${safeUploader}`;
    const ua = String(req.get('user-agent') || '').toLowerCase();
    const isCrawlerUa =
      ua.includes('facebookexternalhit') ||
      ua.includes('facebot') ||
      ua.includes('meta-externalagent') ||
      ua.includes('meta-externalfetcher') ||
      ua.includes('metaexternalagent') ||
      ua.includes('metaexternalfetcher') ||
      ua.includes('discordbot') ||
      ua.includes('twitterbot') ||
      ua.includes('slackbot') ||
      ua.includes('linkedinbot') ||
      ua.includes('whatsapp');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ogTitle}</title>
<meta property="og:title" content="${ogTitle}" />
<meta property="og:description" content="${ogDescription}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${safePreviewUrl}" />
<meta property="og:site_name" content="Leeku Secure" />
<meta property="og:locale" content="en_US" />
${FACEBOOK_APP_ID ? `<meta property="fb:app_id" content="${esc(FACEBOOK_APP_ID)}" />` : ''}
${safeOgImageUrl ? `<meta property="og:image" content="${safeOgImageUrl}" />` : ''}
${safeOgImageUrl ? `<meta property="og:image:secure_url" content="${safeOgImageUrl}" />` : ''}
${safeOgImageUrl ? '<meta property="og:image:type" content="image/png" />' : ''}
${safeOgImageUrl ? '<meta property="og:image:width" content="380" />' : ''}
${safeOgImageUrl ? '<meta property="og:image:height" content="380" />' : ''}
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${ogTitle}" />
<meta name="twitter:description" content="${ogDescription}" />
${safeOgImageUrl ? `<meta name="twitter:image" content="${safeOgImageUrl}" />` : ''}
<link rel="canonical" href="${safePreviewUrl}" />
${isCrawlerUa ? '' : `<script>window.location.replace(${JSON.stringify(appUrl)});</script>`}
</head>
<body>
<p><a href="${safeAppUrl}">${safeFileName}</a></p>
<p>Shared by ${safeUploader} · ${sizeLabel}</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.send(html);
  };

  // ── /:token/og route (works at /api/public/share/TOKEN/og) ──
  router.get('/:token/og', async (req, res) => {
    const protocol = req.protocol || 'https';
    const host = req.get('host') || 'leeks.miku.rip';
    const baseUrl = `${protocol}://${host}`;
    try {
      await buildShareOgHtml(req, res, getSingleParam(req.params.token), baseUrl);
    } catch (error) {
      console.error('[GET /:token/og]', error);
      if (!res.headersSent) {
        res.status(500).type('html').send(ogErrorHtml('Internal Error'));
      }
    }
  });

  // ── /s/:token vanity route (for Discord embed URLs like domain.com/s/TOKEN) ──
  router.get('/s/:token', async (req, res) => {
    const protocol = req.protocol || 'https';
    const host = req.get('host') || 'leeks.miku.rip';
    const baseUrl = `${protocol}://${host}`;
    try {
      await buildShareOgHtml(req, res, getSingleParam(req.params.token), baseUrl);
    } catch (error) {
      console.error('[GET /s/:token]', error);
      if (!res.headersSent) {
        res.status(500).type('html').send(ogErrorHtml('Internal Error'));
      }
    }
  });

  router.post('/:token/download', rateLimit({
    windowMs: 15 * 60_000,
    max: parseInt(process.env.PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN || '12', 10),
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many download or password attempts. Please wait before trying again.' },
  }), async (req, res) => {
    sweepDownloadSessions();
    const token = getSingleParam(req.params.token);
    const { password, secret_key } = req.body;
    try {
      const request = await getRequest(); request.input('tok', sql.Char(32), token);
      const result = await request.query<ShareRow & {
        file_status: string; stored_path: string;
        size_bytes: number; encrypted_size_bytes: number | null;
        client_secret_hash: string | null; client_crypto_salt: Buffer | null; client_crypto_iv: Buffer | null; client_crypto_iterations: number | null;
        original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
        mime_type: string; checksum_sha256: string; file_id_join: string;
        encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer;
      }>(
        `SELECT sl.id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,
          f.id AS file_id_join,f.status AS file_status,f.stored_path,f.mime_type,f.size_bytes,f.encrypted_size_bytes,f.checksum_sha256,
                f.client_secret_hash,f.client_crypto_salt,f.client_crypto_iv,f.client_crypto_iterations,
                f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
                k.encrypted_key,k.key_iv,k.key_auth_tag,k.file_iv,k.file_auth_tag
         FROM share_links sl
         INNER JOIN files f ON sl.file_id=f.id
         INNER JOIN file_encryption_keys k ON f.id=k.file_id
         WHERE sl.public_token=@tok`
      );
      const row = result.recordset[0];
      if (!row) return res.status(404).json({ error: 'Share link not found.' });
      if (!row.is_active) return res.status(404).json({ error: 'Share link inactive.' });
      if (row.file_status === 'Blocked') return res.status(410).json({ error: 'File has been blocked.' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired.' });
      if (row.max_downloads && row.download_count >= row.max_downloads) return res.status(410).json({ error: 'Download limit reached.' });
      if (row.password_hash && (!password || !(await verifySharePassword(password, row.password_hash)))) {
        return res.status(403).json({ error: password ? 'Incorrect vault password.' : 'Password required.' });
      }
      if (row.client_secret_hash) {
        const providedSecret = typeof secret_key === 'string' ? secret_key.trim() : '';
        if (!providedSecret) return res.status(403).json({ error: 'Secret key required.' });
        if (!(await verifyFileSecret(providedSecret, row.client_secret_hash))) {
          return res.status(403).json({ error: 'Incorrect secret key.' });
        }
      }
      const vaultFile = path.join(options.vaultPath, row.stored_path);
      if (!fs.existsSync(vaultFile)) return res.status(410).json({ error: 'Vault file not found.' });
      const fileKey = unwrapKey(row.encrypted_key, row.key_iv, row.key_auth_tag);
      const originalName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      const tempFile = buildUniqueTempFilePath('leeku-share', token);
      const encryptedSize = Number(row.encrypted_size_bytes || 0) || fs.statSync(vaultFile).size;
      const sessionId = crypto.randomUUID();
      const session: PublicDownloadSession = {
        id: sessionId,
        token,
        shareId: row.id,
        fileId: row.file_id_join,
        originalName,
        mimeType: row.mime_type || 'application/octet-stream',
        tempFile,
        sizeBytes: Number(row.size_bytes || 0),
        status: 'preparing',
        phase: 'decrypting',
        loaded: 0,
        total: encryptedSize,
        expiresAt: Date.now() + DOWNLOAD_SESSION_TTL_MS,
        claimed: false,
      };
      downloadSessions.set(sessionId, session);

      void (async () => {
        try {
            const hash = crypto.createHash('sha256');

            await decryptFileStream(vaultFile, tempFile, fileKey, row.file_iv, row.file_auth_tag, ({ processedBytes, totalBytes }) => {
                const current = downloadSessions.get(sessionId);
                if (!current) return;
                current.phase = 'decrypting';
                current.loaded = processedBytes;
                current.total = totalBytes;
                current.expiresAt = Date.now() + DOWNLOAD_SESSION_TTL_MS;
            }, hash);   // ← pass hash into decryptFileStream

            const current = downloadSessions.get(sessionId);
            if (!current) return;
            current.phase = 'verifying';
            current.loaded = 0;
            current.total = current.sizeBytes || 1;

            // ── Checksum already computed during decryption — just compare ──
            const checksum = hash.digest('hex');
            if (checksum !== row.checksum_sha256) {
                throw new Error('File integrity check failed.');
            }

            current.loaded = current.sizeBytes;
            current.total = current.sizeBytes;


          if (row.client_secret_hash) {
            if (!row.client_crypto_salt || !row.client_crypto_iv || !row.client_crypto_iterations) {
                throw new Error('Secret-key metadata is missing for this file.');
            }

            const active = downloadSessions.get(sessionId);
            if (!active) return;
            active.phase = 'finalizing';
            active.loaded = 0;
            active.total = 1;
            const providedSecret = typeof secret_key === 'string' ? secret_key.trim() : '';
            await decryptClientProtectedFileInPlace(
              tempFile,
                providedSecret,
                row.client_crypto_salt,
                row.client_crypto_iv,
                row.client_crypto_iterations,
            );

            active.loaded = 1;
            active.total = 1;
        }

          const ready = downloadSessions.get(sessionId);
          if (!ready) return;
          ready.status = 'ready';
          ready.phase = 'ready';
          ready.loaded = ready.sizeBytes;
          ready.total = ready.sizeBytes;
          ready.expiresAt = Date.now() + DOWNLOAD_SESSION_TTL_MS;
        } catch (error) {
          const failed = downloadSessions.get(sessionId);
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
        status_url: `/api/public/share/${token}/download/${sessionId}/status`,
        file_url: `/api/public/share/${token}/download/${sessionId}/file`,
      });
    } catch (error) {
      console.error('[POST /api/public/share/:token/download]', error);
      res.status(500).json({ error: 'Download failed.' });
    }
  });

  router.get('/:token/download/:downloadId/status', async (req, res) => {
    sweepDownloadSessions();
    const { token, downloadId } = req.params;
    const session = downloadSessions.get(downloadId);
    if (!session || session.token !== token) {
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
        ? `/api/public/share/${token}/download/${downloadId}/file`
        : null,
    });
  });

  router.get('/:token/download/:downloadId/file', async (req, res) => {
    sweepDownloadSessions();
    const { token, downloadId } = req.params;
    const session = downloadSessions.get(downloadId);
    if (!session || session.token !== token) {
      return res.status(404).json({ error: 'Download session not found.' });
    }
    if (session.status === 'error') {
      const errorMessage = session.error || 'Download failed.';
      removeDownloadSession(downloadId);
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
      const reserve = await getRequest(); reserve.input('id', sql.UniqueIdentifier, session.shareId);
      const reservation = await reserve.query(
        `UPDATE share_links SET download_count=download_count+1
         WHERE id=@id AND is_active=TRUE AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)
           AND (max_downloads IS NULL OR download_count<max_downloads)`
      );
      if (!reservation.rowsAffected[0]) {
        removeDownloadSession(downloadId);
        return res.status(410).json({ error: 'Download limit reached or link expired.' });
      }

      await options.logDownload(req, session.fileId, session.originalName, token);

      let fileSize = '0';
      try {
        fileSize = fs.statSync(session.tempFile).size.toString();
      } catch (statErr) {
        console.error('[Download] Failed to stat prepared file:', statErr instanceof Error ? statErr.message : statErr);
        removeDownloadSession(downloadId);
        return res.status(500).send('File access error.');
      }

      res.setHeader('Content-Type', session.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${session.originalName.replace(/"/g, '\\"')}"`);
      res.setHeader('Content-Length', fileSize);

      const stream = fs.createReadStream(session.tempFile);
      stream.on('error', (streamErr) => {
        console.error('[Stream Error] Prevented crash on prepared public file:', streamErr instanceof Error ? streamErr.message : streamErr);
        stream.destroy();
        removeDownloadSession(downloadId);
        if (!res.headersSent) {
          res.status(503).send('Media stream temporary lock. Please try again.');
        }
      });

      stream.pipe(res);
      stream.on('end', () => removeDownloadSession(downloadId));
      res.on('finish', () => removeDownloadSession(downloadId));
      res.on('close', () => removeDownloadSession(downloadId));
    } catch (error) {
      session.claimed = false;
      console.error('[GET /api/public/share/:token/download/:downloadId/file]', error);
      return res.status(500).json({ error: 'Download failed.' });
    }
  });

  router.get('/:token/embed', async (req, res) => {
    const token = getSingleParam(req.params.token);
    try {
      const request = await getRequest();
      request.input('tok', sql.Char(32), token);
      const result = await request.query<ShareRow & {
        file_status: string; stored_path: string;
        client_secret_hash: string | null;
        original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
        mime_type: string; size_bytes: number; checksum_sha256: string; file_id_join: string;
        encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer;
      }>(
        `SELECT sl.id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,sl.allow_external_preview,
                f.id AS file_id_join,f.status AS file_status,f.stored_path,f.mime_type,f.size_bytes,f.checksum_sha256,
                f.client_secret_hash,
                f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
                k.encrypted_key,k.key_iv,k.key_auth_tag,k.file_iv,k.file_auth_tag
         FROM share_links sl
         INNER JOIN files f ON sl.file_id=f.id
         INNER JOIN file_encryption_keys k ON f.id=k.file_id
         WHERE sl.public_token=@tok`
      );
      const row = result.recordset[0];
      if (!row) return res.status(404).json({ error: 'Share link not found.' });
      if (!row.is_active) return res.status(404).json({ error: 'Share link inactive.' });
      if (!row.allow_external_preview) {
        return res.status(403).json({ error: 'External preview is not enabled for this share link.' });
      }
      if (row.file_status === 'Blocked') return res.status(410).json({ error: 'File has been blocked.' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired.' });
      if (row.max_downloads && row.download_count >= row.max_downloads) return res.status(410).json({ error: 'Download limit reached.' });
      if (!row.mime_type.startsWith('image/') && !row.mime_type.startsWith('video/')) {
        return res.status(400).json({ error: 'Only image and video files support external preview.' });
      }
      if (row.password_hash) {
        return res.status(403).json({ error: 'Password-protected shares cannot be used for external preview.' });
      }
      if (row.client_secret_hash) {
        return res.status(403).json({ error: 'Secret-key-protected files cannot be used for external preview.' });
      }

      const vaultFile = path.join(options.vaultPath, row.stored_path);
      if (!fs.existsSync(vaultFile)) return res.status(410).json({ error: 'Vault file not found.' });

      const reserve = await getRequest(); reserve.input('id', sql.UniqueIdentifier, row.id);
      const reservation = await reserve.query(
        `UPDATE share_links SET download_count=download_count+1
         WHERE id=@id AND is_active=TRUE AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)
           AND (max_downloads IS NULL OR download_count<max_downloads)`
      );
      if (!reservation.rowsAffected[0]) return res.status(410).json({ error: 'Download limit reached or link expired.' });

      const fileKey = unwrapKey(row.encrypted_key, row.key_iv, row.key_auth_tag);
      const originalName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      await options.logDownload(req, row.file_id_join, originalName, token);

      sweepEmbedCache();
      const cachePath = getEmbedCachePath(token, row.file_id_join);
      const cacheKey = `${token}:${row.file_id_join}`;
      
      await ensureEmbedCacheFile(
        cachePath,
        cacheKey,
        vaultFile,
        fileKey,
        row.file_iv,
        row.file_auth_tag,
        row.size_bytes,
        row.checksum_sha256,
      );

      // ==========================================
      // CRITICAL WINDOWS FIX: SAFE FILE DESCRIPTOR OPEN
      // ==========================================
      let fileHandle: fs.promises.FileHandle | null = null;
      let fileSize = 0;

      try {
        // Open the file in read-only mode. If locked, this throws a caught error instead of crashing.
        fileHandle = await fs.promises.open(cachePath, 'r');
        const stat = await fileHandle.stat();
        fileSize = stat.size;
      } catch (lockErr: any) {
        console.error('[Embed Lock] Safe open failed or file locked:', lockErr.message);
        if (fileHandle) await fileHandle.close().catch(() => {});
        
        if (!res.headersSent) {
          res.status(503).setHeader('Retry-After', '1');
          return res.json({ error: 'Video cache temporarily locked. Please refresh.' });
        }
        return;
      }

      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';

      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${originalName.replace(/"/g, '\\"')}"`);
      res.setHeader('Accept-Ranges', 'bytes');

      // ------------------------------------------
      // CASE 1: Handle HTTP Range Requests (Seeking/Buffering)
      // ------------------------------------------
      if (rangeHeader.startsWith('bytes=')) {
        const [startRaw, endRaw] = rangeHeader.slice(6).split('-');
        const start = Number(startRaw);
        const end = endRaw ? Number(endRaw) : fileSize - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileSize) {
          await fileHandle.close().catch(() => {});
          res.status(416);
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          return res.json({ error: 'Requested range is not satisfiable.' });
        }

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', String(end - start + 1));

        // Create stream using the safe, pre-verified file descriptor
        const stream = fs.createReadStream('', { fd: fileHandle.fd, start, end });
        
        stream.on('error', (streamErr) => {
          console.error('[Stream Error] Range stream failed mid-flight:', streamErr.message);
          stream.destroy();
        });

        // Ensure the system file handle closes when the stream finishes or user disconnects
        res.on('close', async () => { if (fileHandle) await fileHandle.close().catch(() => {}); });
        res.on('finish', async () => { if (fileHandle) await fileHandle.close().catch(() => {}); });

        stream.pipe(res);
        return;
      }

      // ------------------------------------------
      // CASE 2: Handle Full File Request
      // ------------------------------------------
      res.setHeader('Content-Length', String(fileSize));
      
      // Create stream using the safe, pre-verified file descriptor
      const stream = fs.createReadStream('', { fd: fileHandle.fd });

      stream.on('error', (streamErr) => {
        console.error('[Stream Error] Full stream failed mid-flight:', streamErr.message);
        stream.destroy();
      });

      // Ensure the system file handle closes when the stream finishes or user disconnects
      res.on('close', async () => { if (fileHandle) await fileHandle.close().catch(() => {}); });
      res.on('finish', async () => { if (fileHandle) await fileHandle.close().catch(() => {}); });

      stream.pipe(res);
      return;

    } catch (error) {
      console.error('[GET /api/public/share/:token/embed]', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'External preview failed.' });
      }
    }

  });

  return router;
}
