import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { getRequest, sql } from '../db.js';
import {
  decryptClientProtectedFileInPlace,
  decryptColumn,
  decryptFileStream,
  unwrapKey,
  verifyFileSecret,
  verifySharePassword,
} from '../utils/encryption.js';
import { getPublicProfilePictureUrl } from '../utils/profile-picture.js';

interface FolderShareRow {
  id: string;
  owner_user_id: string;
  folder_id: string;
  public_token: string;
  password_hash: string | null;
  expires_at: Date | null;
  is_active: boolean;
  folder_name: string;
  owner_username_encrypted: Buffer;
  owner_username_iv: Buffer;
  owner_username_auth_tag: Buffer;
}

interface FolderDownloadSession {
  id: string;
  accessToken: string;
  token: string;
  shareId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  tempFile: string;
  sizeBytes: number;
  status: 'preparing' | 'ready' | 'error';
  phase: 'decrypting' | 'verifying' | 'finalizing' | 'ready' | 'error';
  loaded: number;
  total: number;
  expiresAt: number;
  claimed: boolean;
  error?: string;
}

interface FolderManifestRow {
  item_type: 'folder' | 'file';
  id: string;
  parent_id: string | null;
  name: string | null;
  original_name_encrypted: Buffer | null;
  original_name_iv: Buffer | null;
  original_name_auth_tag: Buffer | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: Date;
  client_secret_hash: string | null;
  stored_path: string | null;
}

const DOWNLOAD_SESSION_TTL_MS = 10 * 60_000;

export function createPublicFolderSharingRouter(options: {
  vaultPath: string;
  tempPath: string;
  profilePictureRoot?: string;
  logDownload: (req: express.Request, fileId: string, originalName: string, token: string) => Promise<void>;
}): express.Router {
  const router = express.Router();
  const FACEBOOK_APP_ID = String(process.env.FACEBOOK_APP_ID || process.env.FB_APP_ID || '').trim();
  const downloadSessions = new Map<string, FolderDownloadSession>();

  if (!fs.existsSync(options.tempPath)) fs.mkdirSync(options.tempPath, { recursive: true });

  const removeSession = (downloadId: string) => {
    const session = downloadSessions.get(downloadId);
    if (!session) return;
    downloadSessions.delete(downloadId);
    try { if (fs.existsSync(session.tempFile)) fs.unlinkSync(session.tempFile); } catch {}
  };

  const sweepSessions = () => {
    const now = Date.now();
    for (const [downloadId, session] of downloadSessions) {
      if (session.expiresAt <= now) removeSession(downloadId);
    }
  };

  const loadShare = async (token: string): Promise<FolderShareRow | null> => {
    const request = await getRequest();
    request.input('token', sql.Char(32), token);
    const result = await request.query<FolderShareRow>(
      `SELECT fsl.id,u.id AS owner_user_id,fsl.folder_id,fsl.public_token,fsl.password_hash,fsl.expires_at,fsl.is_active,
              ff.name AS folder_name,
              u.username_encrypted AS owner_username_encrypted,u.username_iv AS owner_username_iv,u.username_auth_tag AS owner_username_auth_tag
       FROM folder_share_links fsl
       INNER JOIN file_folders ff ON ff.id=fsl.folder_id
       INNER JOIN users u ON u.id=ff.owner_user_id
       WHERE fsl.public_token=@token`,
    );
    return result.recordset[0] || null;
  };

  const validateShare = (row: FolderShareRow | null, res: express.Response): row is FolderShareRow => {
    if (!row || !row.is_active) {
      res.status(404).json({ error: 'Folder share link not found.' });
      return false;
    }
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      res.status(410).json({ error: 'Folder share link has expired.' });
      return false;
    }
    return true;
  };

  const verifyPassword = async (row: FolderShareRow, password: unknown) => {
    if (!row.password_hash) return true;
    return typeof password === 'string' && !!password && verifySharePassword(password, row.password_hash);
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

  const buildFolderShareOgHtml = async (
    req: express.Request,
    res: express.Response,
    token: string,
    baseUrl: string,
  ): Promise<void> => {
    const row = await loadShare(token);
    if (!row) {
      res.status(404).type('html').send(ogErrorHtml('Not Found'));
      return;
    }
    if (!row.is_active) {
      res.status(404).type('html').send(ogErrorHtml('Not Found'));
      return;
    }
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      res.status(410).type('html').send(ogErrorHtml('Expired'));
      return;
    }

    const countsRequest = await getRequest();
    countsRequest.input('folderId', sql.UniqueIdentifier, row.folder_id);
    const counts = await countsRequest.query<{ stored_path: string | null }>(
      `WITH RECURSIVE folder_tree AS (
         SELECT id,0 AS depth FROM file_folders WHERE id=@folderId
         UNION ALL
         SELECT ff.id,ft.depth+1 FROM file_folders ff INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
         WHERE ft.depth<5
       )
      SELECT f.stored_path
       FROM files f WHERE f.folder_id IN (SELECT id FROM folder_tree)
         AND COALESCE(f.status,'Available')='Available'
         AND (f.expires_at IS NULL OR f.expires_at>CURRENT_TIMESTAMP)`,
    );

    const fileCount = counts.recordset.filter(
      (file: { stored_path: string | null }) =>
        file.stored_path && fs.existsSync(path.join(options.vaultPath, file.stored_path)),
    ).length;
    const uploader = decryptColumn(row.owner_username_encrypted, row.owner_username_iv, row.owner_username_auth_tag);
    const appUrl = `${baseUrl}/#d/${token}`;
    const previewUrl = `${baseUrl}/d/${token}`;

    const esc = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;');
    const safeFolderName = esc(row.folder_name);
    const safeUploader = esc(uploader);
    const safeAppUrl = esc(appUrl);
    const safePreviewUrl = esc(previewUrl);
    const profileImageUrl = resolveProfilePictureOgImageUrl(baseUrl, row.owner_user_id);
    const ogImageUrl = profileImageUrl || resolveOgImageUrl(baseUrl);
    const safeOgImageUrl = ogImageUrl ? esc(ogImageUrl) : null;
    const ogTitle = `${safeFolderName} - Shared by ${safeUploader}`;
    const ogDescription = `${safeFolderName} · ${fileCount} file${fileCount === 1 ? '' : 's'} · Shared by ${safeUploader}`;

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
<p><a href="${safeAppUrl}">${safeFolderName}</a></p>
<p>${fileCount} file${fileCount === 1 ? '' : 's'} · Shared by ${safeUploader}</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.send(html);
  };

  router.get('/:token/og', async (req, res) => {
    const protocol = req.protocol || 'https';
    const host = req.get('host') || 'leeks.miku.rip';
    const baseUrl = `${protocol}://${host}`;
    try {
      await buildFolderShareOgHtml(req, res, req.params.token, baseUrl);
    } catch (error) {
      console.error('[GET /api/public/folder/:token/og]', error);
      if (!res.headersSent) {
        res.status(500).type('html').send(ogErrorHtml('Internal Error'));
      }
    }
  });

  router.get('/:token', async (req, res) => {
    try {
      const row = await loadShare(req.params.token);
      if (!validateShare(row, res)) return;
      const folderCountRequest = await getRequest();
      folderCountRequest.input('folderId', sql.UniqueIdentifier, row.folder_id);
      const folderCountResult = await folderCountRequest.query<{ folder_count: number }>(
        `WITH RECURSIVE folder_tree AS (
          SELECT id,0 AS depth FROM file_folders WHERE id=@folderId
          UNION ALL
          SELECT ff.id,ft.depth+1 FROM file_folders ff INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
          WHERE ft.depth<5
        )
        SELECT COUNT(*) - 1 AS folder_count FROM folder_tree`,
      );
      const countsRequest = await getRequest();
      countsRequest.input('folderId', sql.UniqueIdentifier, row.folder_id);
      const counts = await countsRequest.query<{ stored_path: string | null; size_bytes: number | null }>(
        `WITH RECURSIVE folder_tree AS (
           SELECT id,0 AS depth FROM file_folders WHERE id=@folderId
           UNION ALL
           SELECT ff.id,ft.depth+1 FROM file_folders ff INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
           WHERE ft.depth<5
         )
        SELECT f.stored_path,f.size_bytes
         FROM files f WHERE f.folder_id IN (SELECT id FROM folder_tree)
           AND COALESCE(f.status,'Available')='Available'
           AND (f.expires_at IS NULL OR f.expires_at>CURRENT_TIMESTAMP)`,
      );
      const availableFiles = counts.recordset.filter(
        (file: { stored_path: string | null }) => file.stored_path && fs.existsSync(path.join(options.vaultPath, file.stored_path)),
      );
      res.json({
        folder_name: row.folder_name,
        uploader: decryptColumn(row.owner_username_encrypted, row.owner_username_iv, row.owner_username_auth_tag),
        protected: !!row.password_hash,
        expires_at: row.expires_at?.toISOString() || null,
        folder_count: Number(folderCountResult.recordset[0]?.folder_count || 0),
        file_count: availableFiles.length,
        total_size: availableFiles.reduce((total: number, file: { size_bytes: number | null }) => total + Number(file.size_bytes || 0), 0),
      });
    } catch (error) {
      console.error('[GET /api/public/folder/:token]', error);
      res.status(500).json({ error: 'Failed to load folder share.' });
    }
  });

  router.post('/:token/manifest', rateLimit({
    windowMs: 15 * 60_000,
    max: parseInt(process.env.PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN || '12', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password attempts. Please wait before trying again.' },
  }), async (req, res) => {
    try {
      const row = await loadShare(req.params.token);
      if (!validateShare(row, res)) return;
      if (!(await verifyPassword(row, req.body?.password))) {
        return res.status(403).json({ error: req.body?.password ? 'Incorrect folder password.' : 'Password required.' });
      }

      const request = await getRequest();
      request.input('folderId', sql.UniqueIdentifier, row.folder_id);
      const result = await request.query<FolderManifestRow>(
          `WITH RECURSIVE folder_tree AS (
            SELECT id,parent_folder_id,name,created_at,0 AS depth FROM file_folders WHERE id=@folderId
           UNION ALL
            SELECT ff.id,ff.parent_folder_id,ff.name,ff.created_at,ft.depth+1
           FROM file_folders ff INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
            WHERE ft.depth<5
         )
         SELECT 'folder' AS item_type,id,parent_folder_id AS parent_id,name,
                NULL AS original_name_encrypted,NULL AS original_name_iv,NULL AS original_name_auth_tag,
                NULL AS mime_type,NULL AS size_bytes,created_at,NULL AS client_secret_hash,NULL AS stored_path
         FROM folder_tree WHERE id<>@folderId
         UNION ALL
         SELECT 'file',f.id,f.folder_id,NULL,
                f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
                f.mime_type,f.size_bytes,f.created_at,f.client_secret_hash,f.stored_path
         FROM files f
         WHERE f.folder_id IN (SELECT id FROM folder_tree)
           AND COALESCE(f.status,'Available')='Available'
           AND (f.expires_at IS NULL OR f.expires_at>CURRENT_TIMESTAMP)`,
      );

      const folders = result.recordset
        .filter((item: FolderManifestRow) => item.item_type === 'folder')
        .map((item: FolderManifestRow) => ({ id: item.id, parent_folder_id: item.parent_id, name: item.name, created_at: item.created_at }));
      const files = result.recordset
        .filter((item: FolderManifestRow) => item.item_type === 'file' && item.stored_path && fs.existsSync(path.join(options.vaultPath, item.stored_path)))
        .map((item: FolderManifestRow) => ({
          id: item.id,
          folder_id: item.parent_id,
          original_name: decryptColumn(item.original_name_encrypted!, item.original_name_iv!, item.original_name_auth_tag!),
          mime_type: item.mime_type || 'application/octet-stream',
          size: Number(item.size_bytes || 0),
          created_at: item.created_at,
          requires_secret_key: !!item.client_secret_hash,
        }));
      res.json({ root_folder_id: row.folder_id, folders, files });
    } catch (error) {
      console.error('[POST /api/public/folder/:token/manifest]', error);
      res.status(500).json({ error: 'Failed to load shared folder contents.' });
    }
  });

  router.post('/:token/files/:fileId/download', rateLimit({
    windowMs: 15 * 60_000,
    max: parseInt(process.env.PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN || '12', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many download or password attempts. Please wait before trying again.' },
  }), async (req, res) => {
    sweepSessions();
    try {
      const row = await loadShare(req.params.token);
      if (!validateShare(row, res)) return;
      if (!(await verifyPassword(row, req.body?.password))) {
        return res.status(403).json({ error: req.body?.password ? 'Incorrect folder password.' : 'Password required.' });
      }

      const request = await getRequest();
      request.input('folderId', sql.UniqueIdentifier, row.folder_id);
      request.input('fileId', sql.UniqueIdentifier, req.params.fileId);
      const result = await request.query<{
        id: string; stored_path: string; mime_type: string; size_bytes: number; encrypted_size_bytes: number | null;
        checksum_sha256: string; client_secret_hash: string | null; client_crypto_salt: Buffer | null;
        client_crypto_iv: Buffer | null; client_crypto_iterations: number | null;
        original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
        encrypted_key: Buffer; key_iv: Buffer; key_auth_tag: Buffer; file_iv: Buffer; file_auth_tag: Buffer;
      }>(
          `WITH RECURSIVE folder_tree AS (
            SELECT id,0 AS depth FROM file_folders WHERE id=@folderId
           UNION ALL
            SELECT ff.id,ft.depth+1 FROM file_folders ff INNER JOIN folder_tree ft ON ff.parent_folder_id=ft.id
            WHERE ft.depth<5
         )
         SELECT f.id,f.stored_path,f.mime_type,f.size_bytes,f.encrypted_size_bytes,f.checksum_sha256,
                f.client_secret_hash,f.client_crypto_salt,f.client_crypto_iv,f.client_crypto_iterations,
                f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
                k.encrypted_key,k.key_iv,k.key_auth_tag,k.file_iv,k.file_auth_tag
         FROM files f INNER JOIN file_encryption_keys k ON k.file_id=f.id
         WHERE f.id=@fileId AND f.folder_id IN (SELECT id FROM folder_tree)
           AND COALESCE(f.status,'Available')='Available'
           AND (f.expires_at IS NULL OR f.expires_at>CURRENT_TIMESTAMP)`,
      );
      const file = result.recordset[0];
      if (!file) return res.status(404).json({ error: 'File is not part of this shared folder.' });
      const secretKey = typeof req.body?.secret_key === 'string' ? req.body.secret_key.trim() : '';
      if (file.client_secret_hash && (!secretKey || !(await verifyFileSecret(secretKey, file.client_secret_hash)))) {
        return res.status(403).json({ error: secretKey ? 'Incorrect secret key.' : 'Secret key required.' });
      }
      const vaultFile = path.join(options.vaultPath, file.stored_path);
      if (!fs.existsSync(vaultFile)) return res.status(410).json({ error: 'Vault file not found.' });

      const sessionId = crypto.randomUUID();
      const accessToken = crypto.randomBytes(32).toString('base64url');
      const originalName = decryptColumn(file.original_name_encrypted, file.original_name_iv, file.original_name_auth_tag);
      const tempFile = path.join(options.tempPath, `leeku-folder-share-${sessionId}-${crypto.randomBytes(6).toString('hex')}.tmp`);
      const encryptedSize = Number(file.encrypted_size_bytes || 0) || fs.statSync(vaultFile).size;
      const session: FolderDownloadSession = {
        id: sessionId, accessToken, token: req.params.token, shareId: row.id, fileId: file.id, originalName,
        mimeType: file.mime_type || 'application/octet-stream', tempFile, sizeBytes: Number(file.size_bytes || 0),
        status: 'preparing', phase: 'decrypting', loaded: 0, total: encryptedSize,
        expiresAt: Date.now() + DOWNLOAD_SESSION_TTL_MS, claimed: false,
      };
      downloadSessions.set(sessionId, session);

      void (async () => {
        try {
          const hash = crypto.createHash('sha256');
          const fileKey = unwrapKey(file.encrypted_key, file.key_iv, file.key_auth_tag);
          await decryptFileStream(vaultFile, tempFile, fileKey, file.file_iv, file.file_auth_tag, ({ processedBytes, totalBytes }) => {
            const current = downloadSessions.get(sessionId);
            if (!current) return;
            current.loaded = processedBytes;
            current.total = totalBytes;
            current.expiresAt = Date.now() + DOWNLOAD_SESSION_TTL_MS;
          }, hash);
          const current = downloadSessions.get(sessionId);
          if (!current) return;
          current.phase = 'verifying';
          current.loaded = 0;
          current.total = current.sizeBytes || 1;
          if (hash.digest('hex') !== file.checksum_sha256) throw new Error('File integrity check failed.');
          if (file.client_secret_hash) {
            if (!file.client_crypto_salt || !file.client_crypto_iv || !file.client_crypto_iterations) {
              throw new Error('Secret-key metadata is missing for this file.');
            }
            current.phase = 'finalizing';
            await decryptClientProtectedFileInPlace(tempFile, secretKey, file.client_crypto_salt, file.client_crypto_iv, file.client_crypto_iterations);
          }
          current.status = 'ready';
          current.phase = 'ready';
          current.loaded = current.sizeBytes;
          current.total = current.sizeBytes;
          current.expiresAt = Date.now() + DOWNLOAD_SESSION_TTL_MS;
        } catch (error) {
          const current = downloadSessions.get(sessionId);
          if (current) {
            current.status = 'error';
            current.phase = 'error';
            current.error = error instanceof Error ? error.message : 'Download failed.';
            current.expiresAt = Date.now() + 30_000;
          }
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
        }
      })();

      res.status(202).json({
        download_id: sessionId,
        status_url: `/api/public/folder/${req.params.token}/download/${sessionId}/status?access_token=${encodeURIComponent(accessToken)}`,
        file_url: `/api/public/folder/${req.params.token}/download/${sessionId}/file?access_token=${encodeURIComponent(accessToken)}`,
      });
    } catch (error) {
      console.error('[POST /api/public/folder/:token/files/:fileId/download]', error);
      res.status(500).json({ error: 'Download failed.' });
    }
  });

  router.get('/:token/download/:downloadId/status', (req, res) => {
    sweepSessions();
    const session = downloadSessions.get(req.params.downloadId);
    if (!session || session.token !== req.params.token || req.query.access_token !== session.accessToken) {
      return res.status(404).json({ error: 'Download session not found.' });
    }
    res.json({
      status: session.status, phase: session.phase, loaded: session.loaded, total: session.total,
      size: session.sizeBytes, error: session.error || null,
      file_url: session.status === 'ready'
        ? `/api/public/folder/${session.token}/download/${session.id}/file?access_token=${encodeURIComponent(session.accessToken)}`
        : null,
    });
  });

  router.get('/:token/download/:downloadId/file', async (req, res) => {
    sweepSessions();
    const session = downloadSessions.get(req.params.downloadId);
    if (!session || session.token !== req.params.token || req.query.access_token !== session.accessToken) {
      return res.status(404).json({ error: 'Download session not found.' });
    }
    if (session.status === 'error') {
      const message = session.error || 'Download failed.';
      removeSession(session.id);
      return res.status(500).json({ error: message });
    }
    if (session.status !== 'ready') return res.status(409).json({ error: 'Download is still being prepared.' });
    if (session.claimed) return res.status(409).json({ error: 'This download session has already been used.' });
    session.claimed = true;
    try {
      const request = await getRequest();
      request.input('id', sql.UniqueIdentifier, session.shareId);
      const active = await request.query<{ id: string }>(
        'SELECT id FROM folder_share_links WHERE id=@id AND is_active=TRUE AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)',
      );
      if (!active.recordset.length) {
        removeSession(session.id);
        return res.status(410).json({ error: 'Folder share link has expired or been removed.' });
      }
      await options.logDownload(req, session.fileId, session.originalName, session.token);
      const size = fs.statSync(session.tempFile).size;
      res.setHeader('Content-Type', session.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${session.originalName.replace(/"/g, '\\"')}"`);
      res.setHeader('Content-Length', String(size));
      const stream = fs.createReadStream(session.tempFile);
      stream.pipe(res);
      stream.on('end', () => removeSession(session.id));
      stream.on('error', () => removeSession(session.id));
      res.on('finish', () => removeSession(session.id));
      res.on('close', () => removeSession(session.id));
    } catch (error) {
      session.claimed = false;
      console.error('[GET /api/public/folder/:token/download/:downloadId/file]', error);
      if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
    }
  });

  return router;
}