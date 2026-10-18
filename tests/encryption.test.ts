/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Encryption Tests
 * Tests the encryption module in src/server/utils/encryption.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const {
  encryptFile,
  decryptFile,
  wrapKey,
  unwrapKey,
  encryptColumn,
  decryptColumn,
  hashColumnForLookup,
  hashPassword,
  verifyPassword,
  hashSharePassword,
  verifySharePassword,
  hashFileSecret,
  verifyFileSecret,
  decryptClientProtectedPayload,
  generateSecureToken,
  computeChecksum,
} = await import('../src/server/utils/encryption.js');

// Set a test master key
process.env.MASTER_KEY_BASE64 = crypto.randomBytes(32).toString('base64');

test('encryptFile and decryptFile', async () => {
  const plaintext = Buffer.from('Hello, World! This is a test message.');
  const result = encryptFile(plaintext);
  
  assert.ok(result.ciphertext.length > 0);
  assert.strictEqual(result.iv.length, 12);
  assert.strictEqual(result.authTag.length, 16);
  assert.strictEqual(result.key.length, 32);
  
  const decrypted = decryptFile(result.ciphertext, result.key, result.iv, result.authTag);
  assert.strictEqual(decrypted.toString(), 'Hello, World! This is a test message.');
});

test('encryptFile produces different results each time', () => {
  const plaintext = Buffer.from('Same content');
  const result1 = encryptFile(plaintext);
  const result2 = encryptFile(plaintext);
  
  assert.notDeepStrictEqual(result1.ciphertext, result2.ciphertext);
  assert.notDeepStrictEqual(result1.iv, result2.iv);
});

test('decryptFile with wrong auth tag throws', () => {
  const plaintext = Buffer.from('Test');
  const result = encryptFile(plaintext);
  
  // Tamper with auth tag
  const tamperedTag = Buffer.from(result.authTag);
  tamperedTag[0] = (tamperedTag[0] + 1) % 256;
  
  assert.throws(() => {
    decryptFile(result.ciphertext, result.key, result.iv, tamperedTag);
  }, /Unsupported state or unable to authenticate data/);
});

test('wrapKey and unwrapKey', () => {
  const fileKey = crypto.randomBytes(32);
  const wrapped = wrapKey(fileKey);
  
  assert.ok(wrapped.encryptedKey.length > 0);
  assert.strictEqual(wrapped.iv.length, 12);
  assert.strictEqual(wrapped.authTag.length, 16);
  
  const unwrapped = unwrapKey(wrapped.encryptedKey, wrapped.iv, wrapped.authTag);
  assert.deepStrictEqual(unwrapped, fileKey);
});

test('unwrapKey with wrong auth tag throws', () => {
  const fileKey = crypto.randomBytes(32);
  const wrapped = wrapKey(fileKey);
  
  // Tamper with auth tag
  const tamperedTag = Buffer.from(wrapped.authTag);
  tamperedTag[0] = (tamperedTag[0] + 1) % 256;
  
  assert.throws(() => {
    unwrapKey(wrapped.encryptedKey, wrapped.iv, tamperedTag);
  }, /Unsupported state or unable to authenticate data/);
});

test('encryptColumn and decryptColumn', () => {
  const plaintext = 'test@example.com';
  const result = encryptColumn(plaintext);
  
  assert.ok(result.ciphertext.length > 0);
  assert.strictEqual(result.iv.length, 12);
  assert.strictEqual(result.authTag.length, 16);
  
  const decrypted = decryptColumn(result.ciphertext, result.iv, result.authTag);
  assert.strictEqual(decrypted, plaintext);
});

test('encryptColumn with special characters', () => {
  const plaintext = 'test+tag@example.com';
  const result = encryptColumn(plaintext);
  
  const decrypted = decryptColumn(result.ciphertext, result.iv, result.authTag);
  assert.strictEqual(decrypted, plaintext);
});

test('hashColumnForLookup is deterministic', () => {
  const value1 = hashColumnForLookup('Test@Example.com');
  const value2 = hashColumnForLookup('TEST@EXAMPLE.COM');
  const value3 = hashColumnForLookup('  test@example.com  ');
  
  // Same normalized value produces same hash
  assert.strictEqual(value1, value2);
  assert.strictEqual(value1, value3);
  
  // Different values produce different hashes
  assert.notStrictEqual(value1, hashColumnForLookup('different@example.com'));
});

test('hashColumnForLookup returns hex string', () => {
  const hash = hashColumnForLookup('test');
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('hashPassword and verifyPassword', async () => {
  const password = 'MySecureP@ssw0rd!';
  const hash = await hashPassword(password);
  
  assert.ok(hash.startsWith('$argon2id$'));
  assert.ok(hash.length > 50);
  
  const valid = await verifyPassword(password, hash);
  assert.strictEqual(valid, true);
  
  const invalid = await verifyPassword('WrongPassword', hash);
  assert.strictEqual(invalid, false);
});

test('hashSharePassword and verifySharePassword', async () => {
  const password = 'ShareP@ssword!';
  const hash = await hashSharePassword(password);
  
  assert.ok(hash.length > 50);
  
  const valid = await verifySharePassword(password, hash);
  assert.strictEqual(valid, true);
  
  const invalid = await verifySharePassword('WrongPassword', hash);
  assert.strictEqual(invalid, false);
});

test('hashFileSecret and verifyFileSecret', async () => {
  const secret = 'ClientSecretKey123!';
  const hash = await hashFileSecret(secret);
  
  assert.ok(hash.startsWith('$argon2i$'));
  assert.ok(hash.length > 50);
  
  const valid = await verifyFileSecret(secret, hash);
  assert.strictEqual(valid, true);
  
  const invalid = await verifyFileSecret('WrongSecret', hash);
  assert.strictEqual(invalid, false);
});

test('generateSecureToken', () => {
  const token1 = generateSecureToken(16);
  const token2 = generateSecureToken(32);
  
  assert.strictEqual(token1.length, 32); // 16 bytes = 32 hex chars
  assert.strictEqual(token2.length, 64); // 32 bytes = 64 hex chars
  
  // Tokens are unique
  assert.notStrictEqual(token1, token2);
});

test('computeChecksum', () => {
  const data = Buffer.from('Test data for checksum');
  const checksum1 = computeChecksum(data);
  
  const checksum2 = computeChecksum(data);
  
  // Same data produces same checksum
  assert.strictEqual(checksum1, checksum2);
  
  // Different data produces different checksum
  assert.notStrictEqual(checksum1, computeChecksum(Buffer.from('Different data')));
});

test('decryptClientProtectedPayload', () => {
  const secret = 'MySecretKey123';
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const iterations = 100_000;
  
  const plaintext = Buffer.from('Client protected data');
  
  // Encrypt using the same method
  const key = crypto.pbkdf2Sync(secret, salt, iterations, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  cipher.getAuthTag();
  const encryptedWithTag = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  
  const decrypted = decryptClientProtectedPayload(encryptedWithTag, secret, salt, iv, iterations);
  assert.strictEqual(decrypted.toString(), 'Client protected data');
});

test('decryptClientProtectedPayload with wrong secret fails', () => {
  const secret = 'MySecretKey123';
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const iterations = 100_000;
  
  const plaintext = Buffer.from('Test');
  const key = crypto.pbkdf2Sync(secret, salt, iterations, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const encryptedWithTag = Buffer.concat([ciphertext, cipher.getAuthTag()]);
   
  assert.throws(() => {
    decryptClientProtectedPayload(encryptedWithTag, 'WrongSecret', salt, iv, iterations);
  }, /Unsupported state or unable to authenticate data/);
});
