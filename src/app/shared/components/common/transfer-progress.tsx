import { useEffect, useState } from "react";
import { ArrowDownToLine, Check, LockKeyhole, Upload } from "lucide-react";

export interface TransferState {
  direction: "upload" | "download";
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  phaseLabel?: string;
  processingLoaded?: number;
  processingTotal?: number;
  processingStartedAt?: number;
  processing?: boolean;
  complete?: boolean;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1) return "Calculating";
  const rounded = Math.ceil(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export default function TransferProgress({
  transfer,
  onCancel,
}: {
  transfer: TransferState;
  onCancel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (transfer.complete) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [transfer.complete]);

  const activeLoaded = transfer.processing
    ? (transfer.processingLoaded ?? 0)
    : transfer.loaded;
  const activeTotal = transfer.processing
    ? (transfer.processingTotal ?? 0)
    : transfer.total;
  const activeStartedAt = transfer.processing
    ? (transfer.processingStartedAt ?? transfer.startedAt)
    : transfer.startedAt;
  const percent =
    activeTotal > 0
      ? Math.min(100, Math.round((activeLoaded / activeTotal) * 100))
      : 0;
  const elapsedSeconds = Math.max((now - activeStartedAt) / 1000, 1);
  const speed = activeLoaded / elapsedSeconds;
  const etaSeconds =
    activeTotal > 0 && activeLoaded > 0 && speed > 0
      ? Math.max(0, (activeTotal - activeLoaded) / speed)
      : Number.NaN;
  const label = transfer.complete
    ? "Transfer complete"
    : transfer.processing
      ? transfer.phaseLabel || "Securing file"
      : transfer.direction === "upload"
        ? "Uploading securely"
        : "Decrypting and downloading";
  const Icon = transfer.complete
    ? Check
    : transfer.processing
      ? LockKeyhole
      : transfer.direction === "upload"
        ? Upload
        : ArrowDownToLine;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <p className="truncate text-sm font-medium">{transfer.name}</p>
            <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
              {transfer.complete ? "100%" : activeTotal ? `${percent}%` : "Starting"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4 text-xs text-[var(--text-faint)]">
            <span>{label}</span>
            {!transfer.complete && activeLoaded > 0 && (
              <span className="shrink-0">
                {transfer.processing ? "ETA " : `${formatBytes(speed)}/s · ETA `}
                {formatDuration(etaSeconds)}
              </span>
            )}
          </div>
        </div>
        {onCancel && !transfer.processing && !transfer.complete && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-[color-mix(in_srgb,var(--error-linear)_42%,transparent)] px-3 py-2 text-xs font-medium text-[var(--error-linear)] hover:bg-[color-mix(in_srgb,var(--error-linear)_12%,transparent)]"
          >
            Stop upload
          </button>
        )}
      </div>
      <div className="h-1 bg-[var(--bg-hover)]">
        <div
          className="h-full bg-[var(--accent-linear)] transition-[width] duration-150"
          style={{ width: `${transfer.complete ? 100 : Math.max(percent, activeLoaded ? 2 : 0)}%` }}
        />
      </div>
      <div className="flex justify-between px-4 py-2 font-mono text-[0.68rem] text-[var(--text-faint)]">
        <span>
          {transfer.processing
            ? `${percent}% processing`
            : formatBytes(transfer.loaded)}
        </span>
        <span>
          {transfer.processing
            ? `ETA ${formatDuration(etaSeconds)}`
            : transfer.total
              ? formatBytes(transfer.total)
              : "Calculating size"}
        </span>
      </div>
    </div>
  );
}
