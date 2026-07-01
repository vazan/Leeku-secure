/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maintenance Mode Banner Component
 * Displays a prominent banner when the system is in maintenance mode
 */

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

interface MaintenanceStatusResponse {
  maintenance_mode: boolean;
}

/**
 * MaintenanceModeBanner Component
 * Fetches and displays maintenance mode status
 * Auto-refreshes status every 10 seconds
 */
export function MaintenanceModeBanner(): ReactElement | null {
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMaintenanceStatus = async () => {
      try {
        const response = await fetch('/api/admin/maintenance/status');
        if (response.ok) {
          const data: MaintenanceStatusResponse = await response.json();
          setIsMaintenanceMode(data.maintenance_mode);
        }
      } catch (error) {
        console.error('[MaintenanceModeBanner] Failed to fetch status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Fetch immediately
    fetchMaintenanceStatus();

    // Poll every 10 seconds
    const interval = setInterval(fetchMaintenanceStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading || !isMaintenanceMode) {
    return null;
  }

  return (
    <div className="w-full bg-gradient-to-r from-red-900 via-red-800 to-red-900 text-white shadow-2xl border-b-4 border-red-600">
      <div className="max-w-full px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center gap-3 text-center">
          <div className="flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 animate-pulse">
              <svg
                className="h-5 w-5 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold">System Under Maintenance</h3>
            <p className="text-sm text-red-100 mt-1">
              The system is currently under maintenance. File uploads, downloads, and modifications are temporarily disabled.
              Please try again later.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MaintenanceModeBanner;
