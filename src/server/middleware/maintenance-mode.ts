/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maintenance Mode Middleware
 * Caches maintenance status to avoid DB hits on every request
 */

import sql from 'mssql';
import { getRequest } from '../db.js';

let maintenanceCachedStatus: boolean | null = null;
let maintenanceCacheTTL: number = 0;
const CACHE_DURATION_MS = 5000; // Cache for 5 seconds

/**
 * Get current maintenance mode status
 */
export async function getMaintenanceStatus(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (maintenanceCachedStatus !== null && now < maintenanceCacheTTL) {
    return maintenanceCachedStatus;
  }

  try {
    const request = await getRequest();
    const result = await request.query<{ is_maintenance_enabled: boolean }>(
      `SELECT CAST(ISNULL((SELECT [value] FROM [dbo].[system_config] 
       WHERE [key] = N'maintenance_mode'), N'false') AS BIT) AS is_maintenance_enabled`
    );

    const status = result.recordset[0]?.is_maintenance_enabled ?? false;
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
    const request = await getRequest();
    request.input('enabled', sql.Bit, enabled ? 1 : 0);
    const result = await request.query<{ is_maintenance_enabled: boolean }>(
      `EXEC [dbo].[sp_ToggleMaintenanceMode] @enabled`
    );

    const status = result.recordset[0]?.is_maintenance_enabled ?? false;
    
    // Invalidate cache
    maintenanceCachedStatus = status;
    maintenanceCacheTTL = Date.now() + CACHE_DURATION_MS;
    
    return status;
  } catch (error) {
    console.error('[setMaintenanceStatus] Error updating maintenance status:', error);
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
