import fs from 'fs';
import { isScannerAvailable } from './scanner.js';

const PLACEHOLDER_PATTERN = /CHANGE_ME|GENERATE_WITH/i;
const PUBLIC_URL_KEYS = new Set(['APP_URL', 'ALLOWED_ORIGINS']);

export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const required = [
    'APP_URL',
    'ALLOWED_ORIGINS',
    'MASTER_KEY_BASE64',
    'DB_SERVER',
    'DB_USER',
    'DB_PASSWORD',
    'FILE_STORAGE_UNC_PATH',
    'UPLOAD_TEMP_PATH',
  ];
  const missing = required.filter((key) => {
    const value = process.env[key];
    return !value
      || PLACEHOLDER_PATTERN.test(value)
      || (PUBLIC_URL_KEYS.has(key) && /localhost/i.test(value));
  });
  if (missing.length) {
    throw new Error(`[production] Missing or placeholder configuration: ${missing.join(', ')}`);
  }
  // POURQUOI : session tokens are RS256-signed, so both PEM key files must exist
  // and be readable at boot. Fail fast here (before listen) with an actionable
  // message instead of a silent outage or a login-time error. Private key must be
  // readable by the Node service account; public key is low sensitivity.
  for (const keyPath of [process.env.JWT_PRIVATE_KEY_PATH, process.env.JWT_PUBLIC_KEY_PATH]) {
    if (!keyPath) {
      throw new Error('[production] JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH are required (RS256).');
    }
    try {
      fs.accessSync(keyPath, fs.constants.R_OK);
    } catch {
      throw new Error(`[production] Cannot read JWT key file at "${keyPath}". Check the path and service-account ACLs.`);
    }
  }
  if (!isScannerAvailable()) {
    throw new Error('[production] Bitdefender CLI is required. Set BITDEFENDER_SCAN_CLI_PATH to a readable scanner executable.');
  }
  if (process.env.COOKIE_SECURE === 'false') {
    throw new Error('[production] COOKIE_SECURE cannot be false.');
  }
  const vault = process.env.FILE_STORAGE_UNC_PATH!;
  fs.accessSync(vault, fs.constants.R_OK | fs.constants.W_OK);
}
