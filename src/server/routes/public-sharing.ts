import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sql from 'mssql';
import { getRequest } from '../db.js';
import { computeFileChecksum, decryptColumn, decryptFileStream, unwrapKey, verifySharePassword } from '../utils/encryption.js';

interface ShareRow {
  id: string;
  public_token: string;
  password_hash: string | null;
  expires_at: Date | null;
  max_downloads: number | null;
  download_count: number;
  is_active: boolean;
}

export function createPublicSharingRouter(options: {
  vaultPath: string;
  logDownload: (req: express.Request, fileId: string, originalName: string, token: string) => Promise<void>;
}): express.Router {
  const router = express.Router();

  router.get('/:token', async (req, res) => {
    try {
      const request = await getRequest(); request.input('tok', sql.Char(32), req.params.token);
      const result = await request.query<ShareRow & {
        file_status: string; leeku_vibe: string|null; mime_type: string;
        size_bytes: number; file_created_at: Date; stored_path: string;
        original_name_encrypted: Buffer; original_name_iv: Buffer; original_name_auth_tag: Buffer;
        owner_username_encrypted: Buffer; owner_username_iv: Buffer; owner_username_auth_tag: Buffer;
      }>(
        `SELECT sl.id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,
                f.status AS file_status,f.leeku_vibe,f.mime_type,f.size_bytes,f.created_at AS file_created_at,f.stored_path,
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
      res.json({
        token: row.public_token,
        file_name: decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag),
        mime_type: row.mime_type,
        size: row.size_bytes,
        created_at: row.file_created_at?.toISOString(),
        protected: !!row.password_hash,
        uploader: decryptColumn(row.owner_username_encrypted, row.owner_username_iv, row.owner_username_auth_tag),
        leeku_vibe: row.leeku_vibe || '',
        downloads_current: row.download_count,
        downloads_max: row.max_downloads,
      });
    } catch (error) {
      console.error('[GET /api/public/share/:token]', error);
      res.status(500).json({ error: 'Failed to load share info.' });
    }
  });

  router.post('/:token/download', rateLimit({
    windowMs: 15 * 60_000,
    max: parseInt(process.env.PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN || '12', 10),
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many download or password attempts. Please wait before trying again.' },
  }), async (req, res) => {
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
        `SELECT sl.id,sl.public_token,sl.password_hash,sl.expires_at,sl.max_downloads,sl.download_count,sl.is_active,
                f.id AS file_id_join,f.status AS file_status,f.stored_path,f.mime_type,f.checksum_sha256,
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
      const vaultFile = path.join(options.vaultPath, row.stored_path);
      if (!fs.existsSync(vaultFile)) return res.status(410).json({ error: 'Vault file not found.' });
      const tempFile = path.join(os.tmpdir(), `leeku-share-${token}-${Date.now()}.tmp`);
      const fileKey = unwrapKey(row.encrypted_key, row.key_iv, row.key_auth_tag);
      await decryptFileStream(vaultFile, tempFile, fileKey, row.file_iv, row.file_auth_tag);
      if ((await computeFileChecksum(tempFile)) !== row.checksum_sha256) {
        try { fs.unlinkSync(tempFile); } catch {}
        return res.status(500).json({ error: 'File integrity check failed.' });
      }

      const reserve = await getRequest(); reserve.input('id', sql.UniqueIdentifier, row.id);
      const reservation = await reserve.query(
        `UPDATE share_links SET download_count=download_count+1
         WHERE id=@id AND is_active=1 AND (expires_at IS NULL OR expires_at>SYSDATETIMEOFFSET())
           AND (max_downloads IS NULL OR download_count<max_downloads)`
      );
      if (!reservation.rowsAffected[0]) {
        try { fs.unlinkSync(tempFile); } catch {}
        return res.status(410).json({ error: 'Download limit reached or link expired.' });
      }

      const originalName = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      await options.logDownload(req, row.file_id_join, originalName, token);
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${originalName.replace(/"/g, '\\"')}"`);
      res.setHeader('Content-Length', fs.statSync(tempFile).size.toString());
      const stream = fs.createReadStream(tempFile);
      stream.pipe(res);
      stream.on('end', () => { try { fs.unlinkSync(tempFile); } catch {} });
      stream.on('error', () => { try { fs.unlinkSync(tempFile); } catch {} });
    } catch (error) {
      console.error('[POST /api/public/share/:token/download]', error);
      res.status(500).json({ error: 'Download failed.' });
    }
  });

  return router;
}
