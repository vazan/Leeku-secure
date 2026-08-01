import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { getRequest, sql } from '../db.js';
import { decryptColumn, decryptFileStream, unwrapKey } from '../utils/encryption.js';
import { extractSingleFileZip, inspectSingleFileZip } from '../utils/single-file-zip.js';

export const SYSTEM_UPDATE_FOLDER_NAME = '.leeku-desktop-updates';
const inflightDecryptions = new Map<string, Promise<string>>();
const inflightExtractions = new Map<string, Promise<string>>();
const WINDOWS_FILE_LOCK_ERRORS = new Set(['EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY', 'EPERM']);

interface ReleaseFileRow {
  release_id: string;
  version: string;
  id: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: Date;
  original_name_encrypted: Buffer;
  original_name_iv: Buffer;
  original_name_auth_tag: Buffer;
  encrypted_key: Buffer;
  key_iv: Buffer;
  key_auth_tag: Buffer;
  file_iv: Buffer;
  file_auth_tag: Buffer;
}

interface ResolvedFile extends ReleaseFileRow {
  originalName: string;
}

interface ActivationMarker {
  mode: 'draft' | 'active' | 'scheduled';
  activateAt: number;
  createdAt: number;
}

export function createDesktopUpdatesRouter(options: {
  vaultPath: string;
  tempPath: string;
}): express.Router {
  const router = express.Router();
  fs.mkdirSync(options.tempPath, { recursive: true });

  router.get('/api/desktop-updates/:fileName', async (request, response) => {
    try {
      const fileName = String(request.params.fileName);
      if (!fileName || path.basename(fileName) !== fileName) return response.status(404).end();
      const file = await resolveActiveFile(fileName);
      if (!file) return response.status(404).json({ error: 'No active Leeku Desktop artifact matches this file.' });
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader(
        'Cache-Control',
        fileName === 'latest.yml' || fileName === 'latest-linux.yml'
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=31536000, immutable',
      );
      response.type(mimeFromName(fileName));

      // Manifests are intentionally prepared as unique temporary downloads.
      // This is the same decrypt-and-verify path used by "My Leeku Files" and
      // avoids a stale or locked shared cache preventing update discovery.
      if (fileName === 'latest.yml' || fileName === 'latest-linux.yml') {
        const manifestPath = await prepareVerifiedPlaintext(file, options.vaultPath, options.tempPath);
        sendTemporaryFile(response, manifestPath);
        return;
      }

      const encryptedArtifactCache = await ensureDecryptedCache(file, options.vaultPath, options.tempPath);
      const cachePath = fileName.endsWith('.exe')
        ? await ensureExtractedInstallerCache(file, encryptedArtifactCache, fileName, options.tempPath)
        : encryptedArtifactCache;
      sendCachedFile(response, cachePath);
    } catch (error) {
      const code = error instanceof DesktopUpdateServeError ? error.code : 'UPDATE_SERVE_FAILED';
      console.error('[GET desktop update artifact]', {
        fileName: String(request.params.fileName || ''),
        code,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!response.headersSent) {
        response.status(error instanceof DesktopUpdateServeError ? error.status : 500).json({
          error: `Failed to serve the Leeku Desktop update. (${code})`,
          code,
        });
      }
    }
  });

  return router;

  async function resolveActiveFile(requestedName: string): Promise<ResolvedFile | null> {
    const query = await getRequest();
    query.input('rootName', sql.NVarChar(120), SYSTEM_UPDATE_FOLDER_NAME);
    const result = await query.query<ReleaseFileRow>(
      `SELECT release_folder.id AS release_id,release_folder.name AS version,
              f.id,f.stored_path,f.mime_type,f.size_bytes,f.checksum_sha256,f.created_at,
              f.original_name_encrypted,f.original_name_iv,f.original_name_auth_tag,
              k.encrypted_key,k.key_iv,k.key_auth_tag,k.file_iv,k.file_auth_tag
       FROM file_folders update_root
       INNER JOIN users owner ON owner.id=update_root.owner_user_id AND owner.role='Admin'
       INNER JOIN file_folders release_folder
         ON release_folder.parent_folder_id=update_root.id
        AND release_folder.owner_user_id=update_root.owner_user_id
       INNER JOIN files f
         ON f.folder_id=release_folder.id
        AND f.owner_user_id=update_root.owner_user_id
       INNER JOIN file_encryption_keys k ON k.file_id=f.id
       WHERE update_root.parent_folder_id IS NULL
         AND update_root.name=@rootName
         AND COALESCE(f.status,'Available')='Available'
         AND (f.expires_at IS NULL OR f.expires_at>SYSDATETIMEOFFSET())`,
    );
    const files: ResolvedFile[] = result.recordset
      .filter((row) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(row.version))
      .map((row) => ({
        ...row,
        originalName: decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag),
      }));
    const latestMarkers = new Map<string, ActivationMarker>();
    for (const file of files) {
      const marker = parseMarker(file.originalName);
      if (!marker) continue;
      const current = latestMarkers.get(file.release_id);
      if (!current || marker.createdAt > current.createdAt) latestMarkers.set(file.release_id, marker);
    }
    const now = Date.now();
    const activeReleaseId = [...latestMarkers.entries()]
      .filter(([, marker]) => marker.mode !== 'draft' && marker.activateAt <= now)
      .sort((left, right) => right[1].activateAt - left[1].activateAt)[0]?.[0];
    if (!activeReleaseId) return null;
    const version = files.find((file) => file.release_id === activeReleaseId)?.version;
    if (!version || !expectedPublicFileNames(version).has(requestedName)) return null;
    const storedName = requestedName.endsWith('.exe') ? `${requestedName}.zip` : requestedName;
    return files.find((file) => file.release_id === activeReleaseId && file.originalName === storedName) ?? null;
  }
}

async function ensureDecryptedCache(file: ResolvedFile, vaultPath: string, tempPath: string): Promise<string> {
  const cachePath = path.join(tempPath, `leeku-desktop-update-${file.id}-${file.checksum_sha256}.cache`);
  if (await isValidCache(cachePath, file.size_bytes)) return cachePath;
  const existing = inflightDecryptions.get(cachePath);
  if (existing) return existing;
  const work = (async () => {
    const partial = await prepareVerifiedPlaintext(file, vaultPath, tempPath);
    try {
      return await finalizeCacheFile(partial, cachePath, file.size_bytes, 'UPDATE_CACHE_FINALIZE_FAILED');
    } finally {
      await fs.promises.rm(partial, { force: true }).catch(() => undefined);
    }
  })();
  inflightDecryptions.set(cachePath, work);
  try { return await work; }
  finally { inflightDecryptions.delete(cachePath); }
}

function parseMarker(fileName: string): ActivationMarker | null {
  const match = /^leeku-activation--(draft|active|scheduled)--(\d+)--(\d+)\.json$/.exec(fileName);
  if (!match) return null;
  const activateAt = Number(match[2]);
  const createdAt = Number(match[3]);
  if (!Number.isFinite(activateAt) || !Number.isFinite(createdAt)) return null;
  return { mode: match[1] as ActivationMarker['mode'], activateAt, createdAt };
}

async function ensureExtractedInstallerCache(
  file: ResolvedFile,
  zipCachePath: string,
  installerName: string,
  tempPath: string,
): Promise<string> {
  const entry = await inspectSingleFileZip(zipCachePath, installerName);
  const cachePath = path.join(tempPath, `leeku-desktop-update-${file.id}-${file.checksum_sha256}-${installerName}.cache`);
  if (await isValidCache(cachePath, entry.uncompressedSize)) return cachePath;
  const existing = inflightExtractions.get(cachePath);
  if (existing) return existing;
  const work = (async () => {
    const partial = `${cachePath}.${crypto.randomUUID()}.part`;
    try {
      await extractSingleFileZip(zipCachePath, partial, installerName);
      return await finalizeCacheFile(
        partial,
        cachePath,
        entry.uncompressedSize,
        'UPDATE_INSTALLER_CACHE_FINALIZE_FAILED',
      );
    } finally {
      await fs.promises.rm(partial, { force: true }).catch(() => undefined);
    }
  })();
  inflightExtractions.set(cachePath, work);
  try { return await work; }
  finally { inflightExtractions.delete(cachePath); }
}

function expectedPublicFileNames(version: string): Set<string> {
  const windows = `Leeku-Desktop-Setup-${version}.exe`;
  return new Set([
    'latest.yml',
    'latest-linux.yml',
    windows,
    `${windows}.blockmap`,
    `leeku-desktop-${version}-x86_64.AppImage`,
  ]);
}

async function isValidCache(filePath: string, expectedSize: number): Promise<boolean> {
  try { return (await fs.promises.stat(filePath)).size === Number(expectedSize); }
  catch { return false; }
}

function mimeFromName(fileName: string): string {
  if (fileName.endsWith('.yml')) return 'application/yaml';
  if (fileName.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  return 'application/octet-stream';
}

class DesktopUpdateServeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DesktopUpdateServeError';
  }
}

async function prepareVerifiedPlaintext(
  file: ResolvedFile,
  vaultPath: string,
  tempPath: string,
): Promise<string> {
  const vaultFile = resolveVaultArtifactPath(vaultPath, file.stored_path);
  if (!vaultFile || !fs.existsSync(vaultFile)) {
    throw new DesktopUpdateServeError(
      'UPDATE_ARTIFACT_MISSING',
      `The update artifact ${file.id} is missing from the Leeku vault (stored path: ${file.stored_path}).`,
      410,
    );
  }

  const temporaryPath = path.join(
    tempPath,
    `leeku-desktop-update-${file.id}-${Date.now()}-${crypto.randomUUID()}.tmp`,
  );
  try {
    const key = unwrapKey(file.encrypted_key, file.key_iv, file.key_auth_tag);
    const hash = crypto.createHash('sha256');
    await decryptFileStream(vaultFile, temporaryPath, key, file.file_iv, file.file_auth_tag, undefined, hash);
    const checksum = hash.digest('hex');
    if (checksum !== file.checksum_sha256 || !await isValidCache(temporaryPath, file.size_bytes)) {
      throw new DesktopUpdateServeError(
        'UPDATE_ARTIFACT_INTEGRITY_FAILED',
        'The update artifact failed its Leeku integrity check.',
      );
    }
    return temporaryPath;
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof DesktopUpdateServeError) throw error;
    throw new DesktopUpdateServeError(
      'UPDATE_ARTIFACT_DECRYPTION_FAILED',
      'The update artifact could not be decrypted with its Leeku encryption metadata.',
      500,
      { cause: error },
    );
  }
}

export function resolveVaultArtifactPath(vaultPath: string, storedPath: string): string | null {
  // Existing Leeku downloads use path.join(FILE_VAULT, stored_path). Some
  // historical rows contain a leading slash, which path.join treats as a
  // vault-relative name but path.resolve incorrectly moves to the drive root.
  const relativeStoredPath = String(storedPath || '').replace(/^[\\/]+/, '');
  if (!relativeStoredPath || /^[A-Za-z]:/.test(relativeStoredPath)) return null;

  const normalized = path.normalize(relativeStoredPath);
  if (
    path.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
  ) {
    return null;
  }

  const vaultRoot = path.resolve(vaultPath);
  const candidate = path.join(vaultRoot, normalized);
  const relativeToRoot = path.relative(vaultRoot, candidate);
  if (
    !relativeToRoot
    || relativeToRoot === '..'
    || relativeToRoot.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }
  return candidate;
}

async function finalizeCacheFile(
  temporaryPath: string,
  cachePath: string,
  expectedSize: number,
  errorCode: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await isValidCache(cachePath, expectedSize)) return cachePath;
    try {
      await fs.promises.rm(cachePath, { force: true });
      await fs.promises.rename(temporaryPath, cachePath);
      if (await isValidCache(cachePath, expectedSize)) return cachePath;
      lastError = new Error('The finalized cache has an unexpected size.');
    } catch (error) {
      lastError = error;
      const code = isNodeError(error) ? error.code : undefined;
      if (code && !WINDOWS_FILE_LOCK_ERRORS.has(code)) break;
    }
    await delay(Math.min(1_000, 50 * (2 ** attempt)));
  }

  if (await isValidCache(cachePath, expectedSize)) return cachePath;
  throw new DesktopUpdateServeError(
    errorCode,
    'Could not finalize the Leeku Desktop update cache.',
    500,
    { cause: lastError },
  );
}

function sendTemporaryFile(response: express.Response, filePath: string): void {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void fs.promises.rm(filePath, { force: true }).catch(() => undefined);
  };
  response.once('finish', cleanup);
  response.once('close', cleanup);
  response.sendFile(filePath, (error) => {
    if (!error) return;
    cleanup();
    console.error('[GET desktop update manifest] sendFile failed', {
      message: error.message,
      code: isNodeError(error) ? error.code : undefined,
    });
    if (!response.headersSent) {
      response.status(500).json({
        error: 'Failed to serve the Leeku Desktop update. (UPDATE_MANIFEST_SEND_FAILED)',
        code: 'UPDATE_MANIFEST_SEND_FAILED',
      });
    } else {
      response.destroy(error);
    }
  });
}

function sendCachedFile(response: express.Response, filePath: string): void {
  response.sendFile(filePath, (error) => {
    if (!error) return;
    console.error('[GET desktop update artifact] sendFile failed', {
      message: error.message,
      code: isNodeError(error) ? error.code : undefined,
    });
    if (!response.headersSent) {
      response.status(500).json({
        error: 'Failed to serve the Leeku Desktop update. (UPDATE_ARTIFACT_SEND_FAILED)',
        code: 'UPDATE_ARTIFACT_SEND_FAILED',
      });
    } else {
      response.destroy(error);
    }
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
