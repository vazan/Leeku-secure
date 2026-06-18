import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Lock,
} from "lucide-react";
import ErrorScreen from "@/app/shared/components/common/error-screen";
import FileTypeIcon from "@/app/shared/components/common/file-type-icon";
import TransferProgress, {
  type TransferState,
} from "@/app/shared/components/common/transfer-progress";

interface PublicDownloadPageProps {
  token: string;
  onGoHome: () => void;
}
interface PublicFileMeta {
  file_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  protected: boolean;
  requires_secret_key: boolean;
  allow_external_preview?: boolean;
  uploader: string;
  downloads_current: number;
  downloads_max: number | null;
}

interface PreparedDownloadStartResponse {
  download_id: string;
  status_url: string;
  file_url: string;
}

interface PreparedDownloadStatus {
  status: "preparing" | "ready" | "error";
  phase: "decrypting" | "verifying" | "finalizing" | "ready" | "error";
  loaded: number;
  total: number;
  size: number;
  error: string | null;
  file_url: string | null;
}

const preparationPhaseLabel: Record<PreparedDownloadStatus["phase"], string> = {
  decrypting: "Decrypting file",
  verifying: "Verifying integrity",
  finalizing: "Unlocking secure content",
  ready: "Starting download",
  error: "Download failed",
};

const formatBytes = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });

async function readJsonError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

async function waitForPreparedDownload(
  statusUrl: string,
  signal: AbortSignal,
  onStatus: (status: PreparedDownloadStatus) => void,
) {
  while (true) {
    const response = await fetch(statusUrl, { signal });
    if (!response.ok) {
      throw new Error(await readJsonError(response, "Download unavailable."));
    }

    const status = (await response.json()) as PreparedDownloadStatus;
    onStatus(status);

    if (status.status === "error") {
      throw new Error(status.error || "Download unavailable.");
    }

    if (status.status === "ready" && status.file_url) {
      return status.file_url;
    }

    await pause(500, signal);
  }
}

export default function PublicDownloadPage({
  token,
  onGoHome,
}: PublicDownloadPageProps) {
  const [meta, setMeta] = useState<PublicFileMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const doneTimerRef = useRef<number | null>(null);
  const downloadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/public/share/${token}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "This link is no longer available.");
        setMeta(data);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(
    () => () => {
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
      downloadControllerRef.current?.abort();
    },
    [],
  );

  const download = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!meta) return;

    downloadControllerRef.current?.abort();
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const startedAt = Date.now();

    setError("");
    setDone(false);
    setDownloading(true);
    if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    setTransfer({
      direction: "download",
      name: meta.file_name,
      loaded: 0,
      total: meta.size,
      startedAt,
      processing: true,
      processingLoaded: 0,
      processingTotal: meta.size,
      processingStartedAt: startedAt,
      phaseLabel: preparationPhaseLabel.decrypting,
    });

    try {
      const startResponse = await fetch(`/api/public/share/${token}/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: password || undefined,
          secret_key: secretKey || undefined,
        }),
        signal: controller.signal,
      });
      if (!startResponse.ok) {
        throw new Error(
          await readJsonError(startResponse, "Download unavailable."),
        );
      }

      const startData =
        (await startResponse.json()) as PreparedDownloadStartResponse;
      const fileUrl = await waitForPreparedDownload(
        startData.status_url,
        controller.signal,
        (status) => {
          setTransfer({
            direction: "download",
            name: meta.file_name,
            loaded: 0,
            total: meta.size,
            startedAt,
            processing: true,
            processingLoaded: status.loaded,
            processingTotal: status.total || status.size || meta.size,
            processingStartedAt: startedAt,
            phaseLabel: preparationPhaseLabel[status.phase],
          });
        },
      );

      setTransfer({
        direction: "download",
        name: meta.file_name,
        loaded: 0,
        total: meta.size,
        startedAt,
      });

      // ── Direct browser download (streams to disk, no RAM usage) ──
      const anchor = document.createElement('a');
      anchor.href = fileUrl;
      anchor.download = meta.file_name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      

      setTransfer({
        direction: "download",
        name: meta.file_name,
        loaded: meta.size,
        total: meta.size,
        startedAt,
        complete: true,
      });
      setDone(true);
      setDownloading(false);
      doneTimerRef.current = window.setTimeout(() => {
        setTransfer((current: TransferState | null) =>
          current?.startedAt === startedAt ? null : current,
        );
      }, 1800);
    } catch (reason) {
      setTransfer(null);
      setDone(false);
      setDownloading(false);
      setError(
        reason instanceof Error ? reason.message : "Download unavailable.",
      );
    } finally {
      if (downloadControllerRef.current === controller) {
        downloadControllerRef.current = null;
      }
    }
  };

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg-primary)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  if (!meta) return <ErrorScreen code={404} onGoBack={onGoHome} />;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-5 py-6">
      <div className="mx-auto max-w-xl">
        <button
          onClick={onGoHome}
          className="flex items-center gap-2 text-sm text-[var(--text-muted)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="mt-16 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-7 shadow-[var(--shadow-panel)]">
          <div 
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-10 h-10 bg-[#00F2FF] rounded-sm rotate-12 flex items-center justify-center border-2 border-[#FF007F] font-display font-black text-[#0A0E14] text-xl leading-none shadow-[0_0_15px_rgba(0,242,255,0.4)] group-hover:scale-115 transition-transform duration-300">
              L
            </div>
            <div>
              <span className="font-display font-black text-2xl tracking-tighter italic text-[#00F2FF] uppercase group-hover:text-white transition-colors">
                Leeks.<span className="text-[#FF007F]">miku</span>.rip
              </span>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-gray-500 font-bold">Miku Bunker Secure</span>
            </div>
          </div>
          <div className="mt-10 flex items-start gap-4">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-[var(--bg-hover)]">
              <FileTypeIcon
                fileName={meta.file_name}
                mimeType={meta.mime_type}
                className="h-5 w-5"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="break-all text-xl font-semibold leading-snug">
                {meta.file_name}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {formatBytes(meta.size)} · Shared by {meta.uploader}
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-[var(--bg-muted)] p-4 text-sm">
            <div>
              <p className="text-xs text-[var(--text-faint)]">Added</p>
              <p className="mt-1">
                {new Date(meta.created_at).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-faint)]">Downloads</p>
              <p className="mt-1">
                {meta.downloads_current}
                {meta.downloads_max ? ` of ${meta.downloads_max}` : ""}
              </p>
            </div>
          </div>
          {transfer && (
            <div className="mt-6">
              <TransferProgress
                transfer={transfer}
                onCancel={
                  transfer.complete
                    ? undefined
                    : () => downloadControllerRef.current?.abort()
                }
              />
            </div>
          )}
          <form
            onSubmit={download}
            className="mt-6 space-y-4"
          >
            {meta.protected && (
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Lock className="h-4 w-4" />
                  Password
                </span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-linear)]"
                />
              </label>
            )}
            {meta.requires_secret_key && (
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Lock className="h-4 w-4" />
                  Secret key
                </span>
                <input
                  required
                  type="password"
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-linear)]"
                />
              </label>
            )}
            {error && (
              <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3 text-sm text-[var(--text-muted)]">
                {error}
              </p>
            )}
            {done && (
              <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Check className="h-4 w-4" />
                Your browser download has started.
              </p>
            )}
            <button
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-linear)] px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-linear-bright)]"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? "Preparing download" : "Download file"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
