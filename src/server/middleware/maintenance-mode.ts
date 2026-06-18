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
const BOOTSTRAP_SQL = `
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'system_config' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE [dbo].[system_config](
    [key]        [nvarchar](100)  NOT NULL,
    [value]      [nvarchar](max)  NOT NULL,
    [updated_at] [datetimeoffset](7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT [PK_system_config] PRIMARY KEY CLUSTERED ([key] ASC)
  );
  INSERT INTO [dbo].[system_config] ([key],[value]) VALUES (N'maintenance_mode', N'0');
END
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
      MERGE [dbo].[system_config] AS target
      USING (SELECT N'maintenance_mode' AS [key]) AS src ON target.[key] = src.[key]
      WHEN MATCHED THEN
        UPDATE SET [value] = @val, [updated_at] = SYSDATETIMEOFFSET()
      WHEN NOT MATCHED THEN
        INSERT ([key],[value]) VALUES (N'maintenance_mode', @val);
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
