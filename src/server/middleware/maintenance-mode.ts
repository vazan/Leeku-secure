/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maintenance Mode Middleware
 * Caches maintenance status to avoid DB hits on every request
 */

import { getRequest, sql } from '../db.js';

let maintenanceCachedStatus: boolean | null = null;
let maintenanceCacheTTL: number = 0;
const CACHE_DURATION_MS = 5000; // Cache for 5 seconds

/**
 * Get current maintenance mode status
 */
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS system_config (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_config ("key", "value")
VALUES ('maintenance_mode', '0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO system_config ("key", "value")
VALUES ('maintenance_auto_unc_share', '0')
ON CONFLICT ("key") DO NOTHING;
`;

async function ensureTable(): Promise<void> {
  const request = await getRequest();
  await request.query(BOOTSTRAP_SQL);
}

export async function getMaintenanceStatus(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (maintenanceCachedStatus !== null && now < maintenanceCacheTTL) {
    return maintenanceCachedStatus;
  }

  try {
    await ensureTable();
    const request = await getRequest();
    const result = await request.query<{ v: string }>(
      `SELECT [value] AS v FROM [dbo].[system_config] WHERE [key] = N'maintenance_mode'`
    );

    const raw = result.recordset[0]?.v ?? '0';
    const status = raw === '1' || raw.toLowerCase() === 'true';
    maintenanceCachedStatus = status;
    maintenanceCacheTTL = now + CACHE_DURATION_MS;
    
    return status;
  } catch (error) {
    console.error('[getMaintenanceStatus] Error fetching maintenance status:', error);
    // Default to false on error to allow operations
    return false;
  }
}

/**
 * Set maintenance mode status
 */
export async function setMaintenanceStatus(enabled: boolean): Promise<boolean> {
  try {
    await ensureTable();
    const request = await getRequest();
    request.input('val', sql.NVarChar, enabled ? '1' : '0');
    await request.query(`
      INSERT INTO system_config ("key", "value", updated_at)
      VALUES ('maintenance_mode', @val, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value",
          updated_at = CURRENT_TIMESTAMP
    `);

    // Invalidate cache
    maintenanceCachedStatus = enabled;
    maintenanceCacheTTL = Date.now() + CACHE_DURATION_MS;
    
    return enabled;
  } catch (error) {
    console.error('[setMaintenanceStatus] Error updating maintenance status:', error);
    throw error;
  }
}

/**
 * Get whether maintenance mode was auto-enabled by the UNC share monitor.
 */
export async function getUncShareAutoMaintenanceStatus(): Promise<boolean> {
  try {
    await ensureTable();
    const request = await getRequest();
    const result = await request.query<{ v: string }>(
      `SELECT [value] AS v FROM [dbo].[system_config] WHERE [key] = N'maintenance_auto_unc_share'`
    );
    const raw = result.recordset[0]?.v ?? '0';
    return raw === '1' || raw.toLowerCase() === 'true';
  } catch (error) {
    console.error('[getUncShareAutoMaintenanceStatus] Error fetching UNC auto-maintenance status:', error);
    return false;
  }
}

/**
 * Set whether maintenance mode is currently auto-managed by UNC share monitor.
 */
export async function setUncShareAutoMaintenanceStatus(enabled: boolean): Promise<void> {
  try {
    await ensureTable();
    const request = await getRequest();
    request.input('val', sql.NVarChar, enabled ? '1' : '0');
    await request.query(`
      INSERT INTO system_config ("key", "value", updated_at)
      VALUES ('maintenance_auto_unc_share', @val, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value",
          updated_at = CURRENT_TIMESTAMP
    `);
  } catch (error) {
    console.error('[setUncShareAutoMaintenanceStatus] Error updating UNC auto-maintenance status:', error);
    throw error;
  }
}

/**
 * Invalidate maintenance status cache
 */
export function invalidateMaintenanceCache(): void {
  maintenanceCachedStatus = null;
  maintenanceCacheTTL = 0;
}

/**
 * Middleware to check maintenance mode and block certain operations
 * Options:
 *   - blockTypes: array of operation types to block ('upload', 'download', 'delete', 'modify')
 */
export function maintenanceModeMiddleware(
  blockTypes: ('upload' | 'download' | 'delete' | 'modify')[]
): (req: any, res: any, next: any) => Promise<void> {
  return async (req, res, next) => {
    const isMaintenanceEnabled = await getMaintenanceStatus();

    if (isMaintenanceEnabled) {
      const operationType = (req as any).maintenanceOperationType;
      if (operationType && blockTypes.includes(operationType)) {
        return res.status(503).json({
          error: 'System is under maintenance. Please try again later.',
          maintenance_mode: true,
        });
      }
    }

    next();
  };
}
