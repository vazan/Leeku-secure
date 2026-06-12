import { ArrowDownToLine, Check, LockKeyhole, Upload } from "lucide-react";

export interface TransferState {
  direction: "upload" | "download";
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
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

export default function TransferProgress({
  transfer,
  onCancel,
}: {
  transfer: TransferState;
  onCancel?: () => void;
}) {
  const percent =
    transfer.total > 0
      ? Math.min(100, Math.round((transfer.loaded / transfer.total) * 100))
      : 0;
  const elapsedSeconds = Math.max((Date.now() - transfer.startedAt) / 1000, 1);
  const speed = transfer.loaded / elapsedSeconds;
  const label = transfer.complete
    ? "Transfer complete"
    : transfer.processing
      ? "Securing file"
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
          <Icon className={`h-4 w-4 ${transfer.processing ? "animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <p className="truncate text-sm font-medium">{transfer.name}</p>
            <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
              {transfer.processing ? "Processing" : transfer.complete ? "100%" : transfer.total ? `${percent}%` : "Starting"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4 text-xs text-[var(--text-faint)]">
            <span>{label}</span>
            {!transfer.processing && !transfer.complete && transfer.loaded > 0 && (
              <span className="shrink-0">{formatBytes(speed)}/s</span>
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
          className={`h-full bg-[var(--accent-linear)] transition-[width] duration-150 ${!transfer.total || transfer.processing ? "animate-pulse" : ""}`}
          style={{ width: `${transfer.processing || transfer.complete ? 100 : Math.max(percent, transfer.loaded ? 2 : 0)}%` }}
        />
      </div>
      <div className="flex justify-between px-4 py-2 font-mono text-[0.68rem] text-[var(--text-faint)]">
        <span>{formatBytes(transfer.loaded)}</span>
        <span>{transfer.total ? formatBytes(transfer.total) : "Calculating size"}</span>
      </div>
    </div>
  );
}
