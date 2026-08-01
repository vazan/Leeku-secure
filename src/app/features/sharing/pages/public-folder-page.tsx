import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Folder, Loader2, Lock } from "lucide-react";
import ErrorScreen from "@/app/shared/components/common/error-screen";
import FileTypeIcon from "@/app/shared/components/common/file-type-icon";

interface PublicFolderPageProps {
  token: string;
  onGoHome: () => void;
}

interface FolderMeta {
  folder_name: string;
  uploader: string;
  protected: boolean;
  expires_at: string | null;
  folder_count: number;
  file_count: number;
  total_size: number;
}

interface SharedFolder {
  id: string;
  parent_folder_id: string | null;
  name: string;
  created_at: string;
}

interface SharedFile {
  id: string;
  folder_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  requires_secret_key: boolean;
}

interface FolderManifest {
  root_folder_id: string;
  folders: SharedFolder[];
  files: SharedFile[];
}

interface DownloadStatus {
  status: "preparing" | "ready" | "error";
  phase: "decrypting" | "verifying" | "finalizing" | "ready" | "error";
  error: string | null;
  file_url: string | null;
}

const formatBytes = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const readError = async (response: Response, fallback: string) => {
  try {
    return (await response.json()).error || fallback;
  } catch {
    return fallback;
  }
};

export default function PublicFolderPage({ token, onGoHome }: PublicFolderPageProps) {
  const [meta, setMeta] = useState<FolderMeta | null>(null);
  const [manifest, setManifest] = useState<FolderManifest | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadManifest = async (folderPassword: string) => {
    setUnlocking(true);
    setError("");
    try {
      const response = await fetch(`/api/public/folder/${token}/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: folderPassword || undefined }),
      });
      if (!response.ok) throw new Error(await readError(response, "Folder contents are unavailable."));
      const data = (await response.json()) as FolderManifest;
      setManifest(data);
      setActiveFolderId(data.root_folder_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Folder contents are unavailable.");
    } finally {
      setUnlocking(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/public/folder/${token}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "This folder link is no longer available."));
        const data = (await response.json()) as FolderMeta;
        setMeta(data);
        document.title = `${data.folder_name} - Shared by ${data.uploader}`;
        if (!data.protected) await loadManifest("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This folder link is no longer available."))
      .finally(() => setLoading(false));
  }, [token]);

  const folderById = useMemo(
    () => new Map((manifest?.folders || []).map((folder) => [folder.id, folder] as const)),
    [manifest],
  );
  const path = useMemo(() => {
    if (!manifest || !activeFolderId) return [] as SharedFolder[];
    const result: SharedFolder[] = [];
    const seen = new Set<string>();
    let currentId: string | null = activeFolderId;
    while (currentId && currentId !== manifest.root_folder_id && !seen.has(currentId)) {
      seen.add(currentId);
      const folder = folderById.get(currentId);
      if (!folder) break;
      result.unshift(folder);
      currentId = folder.parent_folder_id;
    }
    return result;
  }, [activeFolderId, folderById, manifest]);
  const visibleFolders = (manifest?.folders || []).filter((folder) => folder.parent_folder_id === activeFolderId);
  const visibleFiles = (manifest?.files || []).filter((file) => file.folder_id === activeFolderId);

  const downloadFile = async (file: SharedFile) => {
    let secretKey = "";
    if (file.requires_secret_key) {
      secretKey = window.prompt(`Enter the secret key for ${file.original_name}`)?.trim() || "";
      if (!secretKey) return;
    }
    setDownloadingId(file.id);
    setError("");
    try {
      const response = await fetch(`/api/public/folder/${token}/files/${file.id}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || undefined, secret_key: secretKey || undefined }),
      });
      if (!response.ok) throw new Error(await readError(response, "Download unavailable."));
      const start = await response.json() as { status_url: string };
      let fileUrl = "";
      while (!fileUrl) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const statusResponse = await fetch(start.status_url);
        if (!statusResponse.ok) throw new Error(await readError(statusResponse, "Download unavailable."));
        const status = await statusResponse.json() as DownloadStatus;
        if (status.status === "error") throw new Error(status.error || "Download unavailable.");
        if (status.status === "ready" && status.file_url) fileUrl = status.file_url;
      }
      const anchor = document.createElement("a");
      anchor.href = fileUrl;
      anchor.download = file.original_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download unavailable.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <div className="grid min-h-screen place-items-center bg-[var(--bg-primary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!meta) return <ErrorScreen code={404} onGoBack={onGoHome} />;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <button onClick={onGoHome} className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <header className="mt-10 border-b border-[var(--border-subtle)] pb-6">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[var(--bg-hover)]"><Folder className="h-6 w-6" /></span>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold">{meta.folder_name}</h1>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {meta.file_count} file{meta.file_count === 1 ? "" : "s"} · {formatBytes(meta.total_size)} · Shared by {meta.uploader}
              </p>
            </div>
          </div>
        </header>

        {!manifest && meta.protected && (
          <form onSubmit={(event) => { event.preventDefault(); void loadManifest(password); }} className="mx-auto mt-12 max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6">
            <label className="block text-sm font-medium"><span className="mb-2 flex items-center gap-2"><Lock className="h-4 w-4" /> Password</span>
              <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 outline-none focus:border-[var(--accent-linear)]" />
            </label>
            <button disabled={unlocking} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-linear)] px-4 py-3 text-sm font-medium text-[var(--accent-contrast)]">
              {unlocking && <Loader2 className="h-4 w-4 animate-spin" />} Open folder
            </button>
          </form>
        )}

        {manifest && (
          <main className="mt-6">
            <nav className="mb-5 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
              <button onClick={() => setActiveFolderId(manifest.root_folder_id)} className="hover:text-[var(--text-primary)]">{meta.folder_name}</button>
              {path.map((folder) => <React.Fragment key={folder.id}><span>/</span><button onClick={() => setActiveFolderId(folder.id)} className="hover:text-[var(--text-primary)]">{folder.name}</button></React.Fragment>)}
            </nav>
            {visibleFolders.length > 0 && <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleFolders.map((folder) => (
              <button key={folder.id} onClick={() => setActiveFolderId(folder.id)} className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-left hover:bg-[var(--bg-hover)]">
                <Folder className="h-5 w-5 shrink-0 text-[var(--text-muted)]" /><span className="truncate text-sm font-medium">{folder.name}</span>
              </button>
            ))}</div>}
            <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              {visibleFiles.map((file) => (
                <div key={file.id} className="grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0 sm:px-4">
                  <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)]">
                    <FileTypeIcon fileName={file.original_name} mimeType={file.mime_type} className="h-5 w-5" showBadge={false} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]" title={file.original_name}>{file.original_name}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{formatBytes(file.size)}{file.requires_secret_key ? " · Secret key required" : ""}</p>
                  </div>
                  <button title="Download" aria-label={`Download ${file.original_name}`} disabled={downloadingId === file.id} onClick={() => void downloadFile(file)} className="grid h-10 w-10 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50">
                    {downloadingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </button>
                </div>
              ))}
              {visibleFiles.length === 0 && <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No files in this folder.</p>}
            </div>
          </main>
        )}
        {error && <p className="mx-auto mt-5 max-w-xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3 text-sm text-[var(--text-muted)]">{error}</p>}
      </div>
    </div>
  );
}