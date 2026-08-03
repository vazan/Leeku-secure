const CLIENT_SECRET_SALT_BYTES = 16;
const CLIENT_SECRET_IV_BYTES = 12;
const CLIENT_SECRET_ITERATIONS = 250000;

export interface ClientSecretEncryptedUpload {
  encryptedFile: File;
  saltBase64: string;
  ivBase64: string;
  iterations: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function deriveClientSecretKey(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  // Copy into a fresh ArrayBuffer-backed view for stricter TS DOM typings.
  const normalizedSalt = new Uint8Array(salt.byteLength);
  normalizedSalt.set(salt);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: normalizedSalt,
      iterations,
    },
    material,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt'],
  );
}

export async function encryptFileForUploadWithSecret(
  file: File,
  secret: string,
): Promise<ClientSecretEncryptedUpload> {
  const trimmedSecret = secret.trim();
  if (trimmedSecret.length < 8) {
    throw new Error('Secret key must contain at least 8 characters.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(CLIENT_SECRET_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(CLIENT_SECRET_IV_BYTES));
  const key = await deriveClientSecretKey(trimmedSecret, salt, CLIENT_SECRET_ITERATIONS);
  const plaintext = await file.arrayBuffer();

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    key,
    plaintext,
  );

  const encryptedFile = new File(
    [encrypted],
    `${file.name}.leekux`,
    { type: 'application/octet-stream' },
  );

  return {
    encryptedFile,
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    iterations: CLIENT_SECRET_ITERATIONS,
  };
}
