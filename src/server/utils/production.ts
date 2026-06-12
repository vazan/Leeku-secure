import fs from 'fs';
import { isScannerAvailable } from './scanner.js';

const PLACEHOLDER_PATTERN = /CHANGE_ME|GENERATE_WITH|localhost/i;

export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const required = [
    'APP_URL',
    'ALLOWED_ORIGINS',
    'MASTER_KEY_BASE64',
    'COOKIE_SECRET_BASE64',
    'DB_SERVER',
    'DB_USER',
    'DB_PASSWORD',
    'FILE_STORAGE_UNC_PATH',
  ];
  const missing = required.filter((key) => {
    const value = process.env[key];
    return !value || PLACEHOLDER_PATTERN.test(value);
  });
  if (missing.length) {
    throw new Error(`[production] Missing or placeholder configuration: ${missing.join(', ')}`);
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
