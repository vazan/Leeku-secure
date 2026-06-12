import express from 'express';
import fs from 'fs';
import { getRequest } from '../db.js';
import { isScannerAvailable } from '../utils/scanner.js';

export function createHealthRouter(vaultPath: string, production: boolean): express.Router {
  const router = express.Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/ready', async (_req, res) => {
    const checks = { database: false, vault: false, scanner: isScannerAvailable() };
    try {
      const request = await getRequest();
      await request.query('SELECT 1 AS ready');
      checks.database = true;
    } catch {}
    try {
      fs.accessSync(vaultPath, fs.constants.R_OK | fs.constants.W_OK);
      checks.vault = true;
    } catch {}

    const ready = checks.database && checks.vault && (!production || checks.scanner);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
  });

  return router;
}
