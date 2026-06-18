/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin Maintenance Mode Control
 * Allows admins to enable/disable maintenance mode
 */

import { useState } from 'react';
import { AlertCircle, Check, AlertTriangle } from 'lucide-react';

interface MaintenanceModeControlProps {
  currentStatus: boolean;
  onStatusChange?: (newStatus: boolean) => void;
}

const getCsrfToken = () =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith("leeku_csrf="))
    ?.split("=")[1] || "";

export function MaintenanceModeControl({
  currentStatus,
  onStatusChange,
}: MaintenanceModeControlProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleToggle = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/admin/maintenance/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({ enabled: !currentStatus }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle maintenance mode');
      }

      const data = await response.json();
      setSuccess(data.message);
      onStatusChange?.(data.maintenance_mode);

      // Clear success message after 5 seconds
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          Maintenance Mode
        </h3>
        <p className="mt-2 text-sm text-gray-400">
          When enabled, users cannot upload, download, or modify files. Only read operations and admin access are allowed.
        </p>
      </div>

      <div className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-between rounded-lg bg-gray-800 p-4">
          <div>
            <p className="text-sm font-medium text-gray-300">Current Status</p>
            <p className="mt-1 text-lg font-bold">
              {currentStatus ? (
                <span className="flex items-center gap-2 text-red-400">
                  <AlertCircle className="h-5 w-5" />
                  MAINTENANCE MODE ACTIVE
                </span>
              ) : (
                <span className="flex items-center gap-2 text-green-400">
                  <Check className="h-5 w-5" />
                  Normal Operations
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Error Messages */}
        {error && (
          <div className="rounded-lg bg-red-900/50 border border-red-700 p-4">
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* Success Messages */}
        {success && (
          <div className="rounded-lg bg-green-900/50 border border-green-700 p-4">
            <p className="text-sm text-green-200">{success}</p>
          </div>
        )}

        {/* Toggle Button */}
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`w-full rounded-lg px-4 py-3 font-semibold text-white transition-colors ${
            currentStatus
              ? 'bg-green-600 hover:bg-green-700 disabled:bg-gray-600'
              : 'bg-red-600 hover:bg-red-700 disabled:bg-gray-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isLoading ? (
            'Updating...'
          ) : currentStatus ? (
            'DISABLE Maintenance Mode'
          ) : (
            'ENABLE Maintenance Mode'
          )}
        </button>

        {/* Warning */}
        {!currentStatus && (
          <div className="rounded-lg bg-blue-900/50 border border-blue-700 p-4">
            <p className="text-sm text-blue-200">
              ℹ️ Maintenance mode allows you to perform system updates or maintenance without disrupting users. 
              All file operations will be blocked while enabled.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default MaintenanceModeControl;
