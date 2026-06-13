/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Encryption Module
 *
 * Encryption stack (Windows Server 2022 best-practice):
 *
 *   File contents  : AES-256-GCM with a unique random key + IV per file.
 *   File keys      : Wrapped (encrypted) with a HKDF-derived sub-key from
 *                    the master key held in MASTER_KEY_BASE64.
 *   Passwords      : Argon2id (memory: 64 MiB, 3 iterations, 4 threads).
 *   Share passwords: bcrypt (cost factor 12).
 *   PII columns    : AES-256-GCM with a separate HKDF sub-key.
 *   Lookup hashes  : HMAC-SHA256 of normalised value (for DB index lookups
 *                    without storing plaintext).
 *
 * Key derivation hierarchy:
 *   MASTER_KEY_BASE64  (env — 32 random bytes, base64)
 *       └─ HKDF("leeku-file-key-wrapping-v1")  → file key wrapping
 *       └─ HKDF("leeku-column-encryption-v1")  → email / username columns
 *       └─ HKDF("leeku-column-hmac-v1")        → HMAC lookup hashes
 *
 * Required packages (install via npm):
 *   npm install argon2 bcryptjs
 *   npm install --save-dev @types/bcryptjs
 */

import crypto from 'crypto';
import fs from 'fs';
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

const ALGORITHM   = 'aes-256-gcm' as const;
const KEY_LENGTH  = 32;  // 256 bits
const IV_LENGTH   = 12;  // 96 bits — recommended for AES-GCM
const TAG_LENGTH  = 16;  // 128 bits — maximum GCM auth tag

/** Argon2id parameters (OWASP recommended minimum for 2024) */
const ARGON2_OPTIONS: argon2.Options = {
  type:        argon2.argon2id,
  memoryCost:  65536,   // 64 MiB
  timeCost:    3,       // 3 iterations
  parallelism: 4,
};

/** Argon2i parameters dedicated to optional per-file secret keys. */
const ARGON2_FILE_SECRET_OPTIONS: argon2.Options = {
  type:        argon2.argon2i,
  memoryCost:  65536,
  timeCost:    3,
  parallelism: 4,
};

const BCRYPT_ROUNDS = 12;
const CLIENT_FILE_SECRET_KEY_LENGTH = 32;

// ──────────────────────────────────────────────────────────────
// Internal: Master key & HKDF sub-key derivation
// ──────────────────────────────────────────────────────────────

/** Returns the master key buffer from the MASTER_KEY_BASE64 env var. */
function getMasterKey(): Buffer {
  const raw = process.env.MASTER_KEY_BASE64;
  if (!raw) {
    throw new Error('[encryption] MASTER_KEY_BASE64 is not set. Cannot start application.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length < KEY_LENGTH) {
    throw new Error(
      `[encryption] MASTER_KEY_BASE64 must decode to at least ${KEY_LENGTH} bytes. Got ${key.length}.`
    );
  }
  return key;
}

/**
 * Derives a deterministic 256-bit sub-key from the master key using
 * HKDF-SHA256. Each purpose string produces an independent sub-key.
 */
function deriveSubKey(purpose: string): Buffer {
  const master = getMasterKey();
  // hkdfSync returns an ArrayBuffer; convert to Buffer
  const derived = crypto.hkdfSync(
    'sha256',
    master,
    Buffer.alloc(32),   // zero-filled salt (master key already has full entropy)
    Buffer.from(purpose, 'utf8'),
    KEY_LENGTH
  );
  return Buffer.from(derived);
}

// ──────────────────────────────────────────────────────────────
// File Content Encryption  (AES-256-GCM, unique key per file)
// ──────────────────────────────────────────────────────────────

export interface EncryptFileResult {
  /** Encrypted file bytes. Concatenate iv + authTag + ciphertext when writing to disk. */
  ciphertext: Buffer;
  /** Random 12-byte IV used for this file. Store in DB (file_encryption_keys.file_iv). */
  iv:         Buffer;
  /** 16-byte GCM authentication tag. Store in DB (file_encryption_keys.file_auth_tag). */
  authTag:    Buffer;
  /** Random 32-byte AES-256 key for this file. Wrap before storing (see wrapKey). */
  key:        Buffer;
}

/**
 * Encrypts a file's plaintext bytes with AES-256-GCM.
 * Generates a unique random key and IV for each call.
 */
export function encryptFile(plaintext: Buffer): EncryptFileResult {
  const key    = crypto.randomBytes(KEY_LENGTH);
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  return { ciphertext, iv, authTag, key };
}

/**
 * Decrypts file bytes using the stored key, IV, and auth tag.
 * Throws if the auth tag does not match (data tampered or wrong key).
 */
export function decryptFile(
  ciphertext: Buffer,
  key:        Buffer,
  iv:         Buffer,
  authTag:    Buffer
): Buffer {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ──────────────────────────────────────────────────────────────
// Key Wrapping  (protect per-file keys with the master sub-key)
// ──────────────────────────────────────────────────────────────

export interface WrappedKey {
  /** The per-file AES key, encrypted with the wrapping sub-key. */
  encryptedKey: Buffer;
  /** Random IV used for the wrapping operation. Store in DB. */
  iv:           Buffer;
  /** GCM auth tag for the wrapping operation. Store in DB. */
  authTag:      Buffer;
}

/** Encrypts a per-file key with the HKDF-derived key-wrapping sub-key. */
export function wrapKey(fileKey: Buffer): WrappedKey {
  const wrappingKey = deriveSubKey('leeku-file-key-wrapping-v1');
  const iv          = crypto.randomBytes(IV_LENGTH);
  const cipher      = crypto.createCipheriv(ALGORITHM, wrappingKey, iv, { authTagLength: TAG_LENGTH });

  const encryptedKey = Buffer.concat([cipher.update(fileKey), cipher.final()]);
  const authTag      = cipher.getAuthTag();

  return { encryptedKey, iv, authTag };
}

/** Decrypts a wrapped per-file key. Throws on auth failure. */
export function unwrapKey(encryptedKey: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const wrappingKey = deriveSubKey('leeku-file-key-wrapping-v1');
  const decipher    = crypto.createDecipheriv(ALGORITHM, wrappingKey, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
}

// ──────────────────────────────────────────────────────────────
// Column-Level Encryption  (email, username)
// ──────────────────────────────────────────────────────────────

export interface EncryptedColumn {
  ciphertext: Buffer;
  iv:         Buffer;
  authTag:    Buffer;
}

/** Encrypts a UTF-8 string for storage in an encrypted DB column. */
export function encryptColumn(plaintext: string): EncryptedColumn {
  const key    = deriveSubKey('leeku-column-encryption-v1');
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  return { ciphertext, iv, authTag };
}

/** Decrypts a column value. Throws on auth failure. */
export function decryptColumn(ciphertext: Buffer, iv: Buffer, authTag: Buffer): string {
  const key      = deriveSubKey('leeku-column-encryption-v1');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Produces a deterministic HMAC-SHA256 of the normalised value.
 * Used for indexed DB lookups (e.g., find user by email) without
 * exposing plaintext to the database engine.
 */
export function hashColumnForLookup(value: string): string {
  const key = deriveSubKey('leeku-column-hmac-v1');
  return crypto
    .createHmac('sha256', key)
    .update(value.toLowerCase().trim(), 'utf8')
    .digest('hex');
}

// ──────────────────────────────────────────────────────────────
// Password Hashing  (Argon2id)
// ──────────────────────────────────────────────────────────────

/** Hashes a user password with Argon2id. Returns the full PHC string. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 * Returns false instead of throwing on mismatch.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Share Link Password Hashing  (bcrypt)
// ──────────────────────────────────────────────────────────────

/** Hashes a share link password with bcrypt (cost factor 12). */
export async function hashSharePassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verifies a share link password against its bcrypt hash. */
export async function verifySharePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ──────────────────────────────────────────────────────────────
// Optional File Secret Key Hashing (Argon2i)
// ──────────────────────────────────────────────────────────────

/** Hashes an optional per-file secret key with Argon2i. */
export async function hashFileSecret(secret: string): Promise<string> {
  return argon2.hash(secret, ARGON2_FILE_SECRET_OPTIONS);
}

/** Verifies a per-file secret key against its Argon2i hash. */
export async function verifyFileSecret(secret: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}

/**
 * Decrypts bytes that were encrypted client-side with:
 *   AES-256-GCM + PBKDF2-SHA256(secret, salt, iterations)
 * The input buffer must contain ciphertext with the 16-byte auth tag appended.
 */
export function decryptClientProtectedPayload(
  encryptedWithTag: Buffer,
  secret: string,
  salt: Buffer,
  iv: Buffer,
  iterations: number,
): Buffer {
  if (encryptedWithTag.length <= TAG_LENGTH) {
    throw new Error('Invalid encrypted payload.');
  }
  if (iterations < 100_000 || iterations > 1_000_000) {
    throw new Error('Invalid key-derivation iteration count.');
  }

  const authTag = encryptedWithTag.subarray(encryptedWithTag.length - TAG_LENGTH);
  const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - TAG_LENGTH);
  const key = crypto.pbkdf2Sync(
    secret,
    salt,
    iterations,
    CLIENT_FILE_SECRET_KEY_LENGTH,
    'sha256'
  );

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ──────────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random token as a hex string.
 * @param byteLength Number of random bytes (output length = byteLength * 2 hex chars).
 */
export function generateSecureToken(byteLength: number = 16): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Computes a SHA-256 checksum of a buffer.
 * Stored with every file and verified on each download to detect corruption.
 */
export function computeChecksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export interface StreamProgress {
  processedBytes: number;
  totalBytes: number;
}

/**
 * Computes a SHA-256 checksum of a file on disk via streaming.
 * Uses constant memory regardless of file size.
 */
export function computeFileChecksum(
  filePath: string,
  onProgress?: (progress: StreamProgress) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const totalBytes = fs.statSync(filePath).size;
    let processedBytes = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
      processedBytes += Buffer.byteLength(chunk);
      onProgress?.({ processedBytes, totalBytes });
    });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ──────────────────────────────────────────────────────────────
// Streaming File Encryption / Decryption  (AES-256-GCM on disk)
// ──────────────────────────────────────────────────────────────
// For files larger than ~1 GB, these avoid loading the entire
// file into a Node.js Buffer by using ReadStream / WriteStream
// with crypto Cipher/Decipher in pipeline mode.
// ──────────────────────────────────────────────────────────────

export interface EncryptFileStreamResult {
  /** Random 12-byte IV used for this file. Store in DB (file_encryption_keys.file_iv). */
  iv:         Buffer;
  /** 16-byte GCM authentication tag. Store in DB (file_encryption_keys.file_auth_tag). */
  authTag:    Buffer;
  /** Random 32-byte AES-256 key for this file. Wrap before storing (see wrapKey). */
  key:        Buffer;
  /** SHA-256 of the plaintext (computed during encryption). */
  checksum:   string;
  /** Size of the encrypted file in bytes. */
  encryptedSize: number;
}

/**
 * Encrypts a plaintext file on disk to a ciphertext file using AES-256-GCM.
 * Memory usage is constant (~64KB chunk size) regardless of file size.
 *
 * @param srcPath  Absolute path to the plaintext file.
 * @param destPath Absolute path where the encrypted file will be written.
 * @returns        The key, IV, auth tag, plaintext checksum, and encrypted size.
 */
export function encryptFileStream(
  srcPath:  string,
  destPath: string,
  onProgress?: (progress: StreamProgress) => void,
): Promise<EncryptFileStreamResult> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(KEY_LENGTH);
    const iv  = crypto.randomBytes(IV_LENGTH);
    const checksum = crypto.createHash('sha256');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    const totalBytes = fs.statSync(srcPath).size;

    const readStream  = fs.createReadStream(srcPath,  { highWaterMark: 64 * 1024 });
    const writeStream = fs.createWriteStream(destPath);

    let encryptedSize = 0;
    let processedBytes = 0;

    readStream.on('data', (chunk) => {
      checksum.update(chunk);
      processedBytes += Buffer.byteLength(chunk);
      onProgress?.({ processedBytes, totalBytes });
    });

    cipher.on('data', (chunk) => {
      encryptedSize += Buffer.byteLength(chunk);
    });

    readStream
      .pipe(cipher)
      .pipe(writeStream)
      .on('finish', () => {
        try {
          const authTag = cipher.getAuthTag();
          resolve({
            iv, authTag, key,
            checksum: checksum.digest('hex'),
            encryptedSize,
          });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

/**
 * Decrypts a ciphertext file on disk to a plaintext file using AES-256-GCM.
 * Verifies the GCM auth tag — rejects if the data was tampered with.
 *
 * @param srcPath  Absolute path to the encrypted file.
 * @param destPath Absolute path where the decrypted file will be written.
 * @param key      The 32-byte AES-256 key.
 * @param iv       The 12-byte IV used during encryption.
 * @param authTag  The 16-byte GCM auth tag from encryption.
 */
export function decryptFileStream(
  srcPath:  string,
  destPath: string,
  key:      Buffer,
  iv:       Buffer,
  authTag:  Buffer,
  onProgress?: (progress: StreamProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const totalBytes = fs.statSync(srcPath).size;

    const readStream  = fs.createReadStream(srcPath,  { highWaterMark: 64 * 1024 });
    const writeStream = fs.createWriteStream(destPath);
    let processedBytes = 0;

    readStream.on('data', (chunk) => {
      processedBytes += Buffer.byteLength(chunk);
      onProgress?.({ processedBytes, totalBytes });
    });

    readStream
      .pipe(decipher)
      .pipe(writeStream)
      .on('finish', resolve)
      .on('error', reject);
  });
}

/**
 * Validates that the MASTER_KEY_BASE64 env var is present and long enough.
 * Call once at application startup to fail fast before serving requests.
 */
export function validateEncryptionConfig(): void {
  getMasterKey(); // throws with a clear message if not set or too short
  console.log('[encryption] Master key validated. All sub-keys will be derived on demand.');
}
