/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maintenance Mode Routes
 * Endpoints for checking and toggling maintenance mode (admin only)
 */

import express from 'express';
import { getMaintenanceStatus, setMaintenanceStatus } from '../middleware/maintenance-mode.js';
import type { SystemLog } from '../../app/shared/types/index.js';

export function createMaintenanceModeRouter(options: {
  authenticateUser: express.RequestHandler;
  verifyAdmin: express.RequestHandler;
  logSystemEvent: (userId: string, username: string, event: SystemLog['event_type'], target: string, targetId: string, req: express.Request, msg: string) => Promise<void>;
}): express.Router {
  const router = express.Router();

  /**
   * GET /api/admin/maintenance/status
   * Public endpoint - returns current maintenance mode status
   * Accessible by anyone (used to display banners)
   */
  router.get('/status', async (req, res) => {
    try {
      const isMaintenanceEnabled = await getMaintenanceStatus();
      res.json({ maintenance_mode: isMaintenanceEnabled });
    } catch (error) {
      console.error('[GET /api/admin/maintenance-status]', error);
      res.status(500).json({ error: 'Could not check maintenance status.' });
    }
  });

  /**
   * POST /api/admin/maintenance-toggle
   * Admin-only endpoint - toggle maintenance mode
   * Request body: { enabled: boolean }
   */
  router.post('/toggle', options.authenticateUser, options.verifyAdmin, async (req: any, res) => {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled field must be a boolean.' });
      }

      const newStatus = await setMaintenanceStatus(enabled);
      
      // Log the change
      await options.logSystemEvent(
        req.userId,
        req.user?.username || 'System',
        'Admin',
        'System',
        'MaintenanceMode',
        req,
        `Maintenance mode ${newStatus ? 'ENABLED' : 'DISABLED'}`
      );

      res.json({
        success: true,
        maintenance_mode: newStatus,
        message: newStatus
          ? 'Maintenance mode enabled. File uploads, downloads, and modifications are blocked.'
          : 'Maintenance mode disabled. Normal operations resumed.'
      });
    } catch (error) {
      console.error('[POST /api/admin/maintenance-toggle]', error);
      res.status(500).json({ error: 'Could not update maintenance status.' });
    }
  });

  return router;
}
