import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Camera,
  CalendarDays,
  Copy,
  Folder,
  FolderPlus,
  LayoutGrid,
  Link2,
  Lock,
  LogOut,
  MoreHorizontal,
  Play,
  Search,
  Settings,
  Share2,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/shared/components/ui/button";
import { Calendar } from "@/app/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/shared/components/ui/popover";
import { MaintenanceModeBanner } from "@/app/shared/components/maintenance-mode-banner";
import type {
  FileFolder,
  FileMetadata,
  Quota,
  ShareLink,
  SystemLog,
  SystemStats,
  User,
} from "@/app/shared/types";
import SessionManager from "@/app/features/files/components/session-manager";
import ThemeSettings from "@/app/features/files/components/theme-settings";
import AdminWorkspace from "@/app/features/files/components/admin-workspace";
import DashboardSidebar, {
  type DashboardNavItem,
  type DashboardView,
} from "@/app/features/files/components/dashboard-sidebar";
import TransferProgress, {
  type TransferState,
} from "@/app/shared/components/common/transfer-progress";
import FileTypeIcon, {
  getFileTypeBadge,
} from "@/app/shared/components/common/file-type-icon";
import { downloadWithProgress } from "@/app/shared/utils/download-with-progress";

interface UserDashboardProps {
  user: User;
  token: string;
  onLogout: () => void;
  quotas: Quota[];
  onTriggerRefreshUser: () => void;
}

const getCsrfToken = () =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith("leeku_csrf="))
    ?.split("=")[1] || "";

const authHeaders = (_token: string) => ({ "X-CSRF-Token": getCsrfToken() });

type UploadStreamEvent = {
  type?: "processing" | "complete" | "error";
  phase?: string;
  loaded?: number;
  total?: number;
  success?: boolean;
  message?: string;
  error?: string;
};

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
  headers: Record<string, string>,
  signal: AbortSignal,
  onStatus: (status: PreparedDownloadStatus) => void,
) {
  while (true) {
    const response = await fetch(statusUrl, { headers, signal });
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

const dashboardViews: DashboardView[] = [
  "home",
  "files",
  "shared",
  "settings",
  "admin",
];

function getSavedDashboardView(user: User): DashboardView {
  const hashView = window.location.hash.match(/^#dashboard\/([^/]+)$/)?.[1];
  if (
    dashboardViews.includes(hashView as DashboardView) &&
    (hashView !== "admin" || user.role === "Admin")
  ) {
    return hashView as DashboardView;
  }
  if (window.location.hash === "#dashboard") return "home";
  const savedView = localStorage.getItem(`dashboard-view:${user.id}`);
  if (
    dashboardViews.includes(savedView as DashboardView) &&
    (savedView !== "admin" || user.role === "Admin")
  ) {
    return savedView as DashboardView;
  }
  return "home";
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

function fileKind(file: FileMetadata) {
  if (file.mime_type.includes("image")) return "Image";
  if (file.mime_type.includes("video")) return "Video";
  if (file.mime_type.includes("pdf")) return "PDF";
  if (file.mime_type.includes("zip") || file.mime_type.includes("compressed"))
    return "Archive";
  return "Document";
}

function supportsExternalPreview(file: FileMetadata) {
  return (
    file.mime_type.startsWith("image/") || file.mime_type.startsWith("video/")
  );
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseLocalDateTimeValue(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function combineDateAndTime(date: Date, time: string) {
  const [hours = "23", minutes = "59"] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hours), Number(minutes), 0, 0);
  return toLocalDateTimeValue(next);
}

export default function UserDashboard({
  user,
  token,
  onLogout,
  quotas,
  onTriggerRefreshUser,
}: UserDashboardProps) {
  const [view, setView] = useState<DashboardView>(() =>
    getSavedDashboardView(user),
  );
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminFiles, setAdminFiles] = useState<FileMetadata[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSecretKey, setUploadSecretKey] = useState("");
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shareFile, setShareFile] = useState<FileMetadata | null>(null);
  const [videoFile, setVideoFile] = useState<FileMetadata | null>(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpires, setShareExpires] = useState("");
  const [shareMaxDownloads, setShareMaxDownloads] = useState("");
  const [shareAllowExternalPreview, setShareAllowExternalPreview] =
    useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [profileUsername, setProfileUsername] = useState(user.username);
  const [profileEmail, setProfileEmail] = useState(user.email);
  const [profilePassword, setProfilePassword] = useState("");
  const [quotaRequestTarget, setQuotaRequestTarget] = useState("");
  const [quotaRequestNote, setQuotaRequestNote] = useState("");
  const [quotaRequestSubmitting, setQuotaRequestSubmitting] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const uploadRequestRef = React.useRef<XMLHttpRequest | null>(null);
  const uploadStoppedRef = React.useRef(false);
  const dropzoneFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const resumableUploadRef = React.useRef<{
    file: globalThis.File;
    targetFile: globalThis.File;
    identifier: string;
    totalChunks: number;
    chunkSize: number;
    currentChunk: number;
    aborted: boolean;
    activeXhr: XMLHttpRequest | null;
  } | null>(null);
  const downloadRequestRef = React.useRef<AbortController | null>(null);

  const activeQuota =
    quotas.find((quota) => quota.id === user.quota_id) || quotas[0];
  const storageLimit = activeQuota?.storage_limit_bytes || 1;
  const maxFiles = activeQuota?.max_files || 0;
  const filesLeft = Math.max(maxFiles - files.length, 0);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder] as const)),
    [folders],
  );
  const activeFolder = activeFolderId ? folderById.get(activeFolderId) || null : null;

  const folderPath = useMemo(() => {
    if (!activeFolderId) return [] as FileFolder[];
    const chain: FileFolder[] = [];
    const seen = new Set<string>();
    let currentId: string | null = activeFolderId;
    while (currentId) {
      if (seen.has(currentId)) break;
      seen.add(currentId);
      const current = folderById.get(currentId);
      if (!current) break;
      chain.push(current);
      currentId = current.parent_folder_id || null;
    }
    return chain.reverse();
  }, [activeFolderId, folderById]);

  const activeFolderDepth = folderPath.length;

  const uploadFolderOptions = useMemo(() => {
    const toPathLabel = (folder: FileFolder) => {
      const names = [folder.name];
      const seen = new Set<string>([folder.id]);
      let parentId = folder.parent_folder_id || null;
      while (parentId) {
        if (seen.has(parentId)) break;
        seen.add(parentId);
        const parent = folderById.get(parentId);
        if (!parent) break;
        names.unshift(parent.name);
        parentId = parent.parent_folder_id || null;
      }
      return names.join(" / ");
    };

    return folders
      .map((folder) => ({ id: folder.id, label: toPathLabel(folder) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folderById, folders]);

  const notify = (message: string) => toast(message);
  const notifyError = (message: string) => toast.error(message);

  const openUploadFilePicker = () => {
    if (uploading) return;
    if (dropzoneFileInputRef.current) {
      // Reset before opening so re-selecting the same file still triggers change,
      // without invalidating the selected File reference in Firefox.
      dropzoneFileInputRef.current.value = "";
    }
    dropzoneFileInputRef.current?.click();
  };

  const uploadFiles = async (selectedFiles: globalThis.File[]) => {
    const filesToUpload = selectedFiles.filter((file): file is globalThis.File => !!file);
    if (!filesToUpload.length) return;

    if (uploading || uploadRequestRef.current || resumableUploadRef.current) {
      notifyError("An upload is already running.");
      return;
    }

    for (const file of filesToUpload) {
      if (uploadStoppedRef.current) break;
      await uploadFile(file);
      if (uploadStoppedRef.current) break;
    }
  };

  const loadFilesAndLinks = async () => {
    const [filesResponse, linksResponse, foldersResponse] = await Promise.all([
      fetch("/api/files", { headers: authHeaders(token) }),
      fetch("/api/sharing/links", { headers: authHeaders(token) }),
      fetch("/api/file-folders", { headers: authHeaders(token) }),
    ]);
    if (filesResponse.ok) {
      setFiles((await filesResponse.json()).files || []);
    } else {
      let message = "Could not load your files.";
      try {
        const payload = await filesResponse.json();
        message = payload?.error || message;
      } catch {
        // Keep generic message when response is not JSON.
      }
      notifyError(message);
    }

    if (linksResponse.ok) {
      setLinks((await linksResponse.json()).links || []);
    } else {
      let message = "Could not load sharing links.";
      try {
        const payload = await linksResponse.json();
        message = payload?.error || message;
      } catch {
        // Keep generic message when response is not JSON.
      }
      notifyError(message);
    }

    if (foldersResponse.ok) {
      const nextFolders = ((await foldersResponse.json()).folders || []) as FileFolder[];
      setFolders(nextFolders);
      setActiveFolderId((current) =>
        current && !nextFolders.some((folder) => folder.id === current) ? null : current,
      );
      setUploadTargetFolderId((current) =>
        current && !nextFolders.some((folder) => folder.id === current) ? null : current,
      );
    } else {
      let message = "Could not load folders.";
      try {
        const payload = await foldersResponse.json();
        message = payload?.error || message;
      } catch {
        // Keep generic message when response is not JSON.
      }
      notifyError(message);
    }
  };

  const loadAdmin = async () => {
    if (user.role !== "Admin") return;
    const headers = authHeaders(token);
    const [usersResponse, filesResponse, logsResponse, statsResponse] =
      await Promise.all([
        fetch("/api/admin/users", { headers }),
        fetch("/api/admin/files", { headers }),
        fetch("/api/admin/logs", { headers }),
        fetch("/api/stats"),
      ]);
    if (usersResponse.ok)
      setAdminUsers((await usersResponse.json()).users || []);
    if (filesResponse.ok)
      setAdminFiles((await filesResponse.json()).files || []);
    if (logsResponse.ok) setLogs((await logsResponse.json()).logs || []);
    if (statsResponse.ok) setStats(await statsResponse.json());
  };

  useEffect(() => {
    loadFilesAndLinks().catch(() =>
      notifyError("Could not refresh your files."),
    );
    loadAdmin().catch(() => notifyError("Could not refresh admin data."));
  }, []);

  useEffect(() => {
    localStorage.setItem(`dashboard-view:${user.id}`, view);
  }, [user.id, view]);

  useEffect(() => {
    const syncDashboardView = () => {
      const hashView = window.location.hash.match(/^#dashboard\/([^/]+)$/)?.[1];
      if (
        dashboardViews.includes(hashView as DashboardView) &&
        (hashView !== "admin" || user.role === "Admin")
      ) {
        setView(hashView as DashboardView);
      } else if (window.location.hash === "#dashboard") {
        setView("home");
      } else if (window.location.hash === "") {
        setView(getSavedDashboardView(user));
      }
    };
    window.addEventListener("hashchange", syncDashboardView);
    return () => window.removeEventListener("hashchange", syncDashboardView);
  }, [user.role]);

  const navigateDashboard = (nextView: DashboardView) => {
    const nextHash = nextView === "home" ? "#dashboard" : `#dashboard/${nextView}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    setView(nextView);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const currentFolderFiles = useMemo(
    () => files.filter((file) => (activeFolderId ? file.folder_id === activeFolderId : !file.folder_id)),
    [activeFolderId, files],
  );

  const visibleFiles = useMemo(() => {
    if (!normalizedSearch) return currentFolderFiles;
    return currentFolderFiles.filter((file) =>
      file.original_name.toLowerCase().includes(normalizedSearch),
    );
  }, [currentFolderFiles, normalizedSearch]);

  const visibleFolders = useMemo(() => {
    const children = folders.filter(
      (folder) => (folder.parent_folder_id || null) === activeFolderId,
    );
    if (!normalizedSearch) return children;
    return children.filter((folder) =>
      folder.name.toLowerCase().includes(normalizedSearch),
    );
  }, [activeFolderId, folders, normalizedSearch]);

  useEffect(() => {
    if (!uploading) return undefined;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue =
        "An upload is still running. Leaving this page will stop it.";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [uploading]);

  const stopUpload = () => {
    uploadStoppedRef.current = true;
    // Abort active chunk XHR if resumable upload is in progress
    if (resumableUploadRef.current?.activeXhr) {
      resumableUploadRef.current.activeXhr.abort();
      resumableUploadRef.current.aborted = true;
    }
    uploadRequestRef.current?.abort();
  };

  const RESUMABLE_CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB

  const generateResumableIdentifier = (file: globalThis.File): string => {
    // Deterministic hash from file properties
    const parts = [file.name, file.size, file.lastModified, file.type].join("-");
    let hash = 0;
    for (let i = 0; i < parts.length; i++) {
      hash = ((hash << 5) - hash) + parts.charCodeAt(i);
      hash |= 0;
    }
    return (hash >>> 0).toString(36) + "-" + Date.now().toString(36);
  };

  const uploadFile = async (file: globalThis.File): Promise<boolean> => {
    console.log("[uploadFile] called with", file.name, file.size, "RESUMABLE_CHUNK_SIZE:", RESUMABLE_CHUNK_SIZE);
    console.log("[uploadFile] FILE_IS_LARGE?", file.size > RESUMABLE_CHUNK_SIZE);
    if (uploadRequestRef.current || resumableUploadRef.current) {
      notifyError("An upload is already running.");
      return false;
    }

    const startedAt = Date.now();
    const selectedFileSize = file.size;
    uploadStoppedRef.current = false;
    setUploading(true);
    setUploadProgress(0);
    setTransfer({
      direction: "upload",
      name: file.name,
      loaded: 0,
      total: selectedFileSize,
      startedAt,
    });

    // ── Secret key handling ───────────────────────────────────
    const secretMeta: Record<string, string> = {};
    let uploadTargetFile: globalThis.File = file;
    try {
      if (uploadSecretKey.trim()) {
        const trimmedSecret = uploadSecretKey.trim();
        if (trimmedSecret.length < 8) {
          throw new Error("Secret key must contain at least 8 characters.");
        }

        secretMeta.upload_secret_key = trimmedSecret;
      }
    } catch (reason) {
      setUploading(false);
      setTransfer(null);
      notifyError(reason instanceof Error ? reason.message : "Could not encrypt the file with your secret key.");
      return false;
    }

    const FILE_IS_LARGE = selectedFileSize > RESUMABLE_CHUNK_SIZE;
    const uploadFolderId =
      view === "files" ? activeFolderId : uploadTargetFolderId;

    // ═════════════════════════════════════════════════════════
    // LARGE FILES → Resumable.js chunked upload (50 MB each)
    // ═════════════════════════════════════════════════════════
    if (FILE_IS_LARGE) {
      const identifier = generateResumableIdentifier(file);
      const totalChunks = Math.max(1, Math.ceil(selectedFileSize / RESUMABLE_CHUNK_SIZE));
      const totalSize = selectedFileSize;

      // Build a query string for secret metadata (appended to every chunk request)
      const secretParams = new URLSearchParams();
      if (secretMeta.upload_secret_key) {
        secretParams.set("upload_secret_key", secretMeta.upload_secret_key);
      }
      if (secretMeta.upload_secret_salt_b64 && secretMeta.upload_secret_iv_b64 && secretMeta.upload_secret_iterations) {
        secretParams.set("upload_secret_salt_b64", secretMeta.upload_secret_salt_b64);
        secretParams.set("upload_secret_iv_b64", secretMeta.upload_secret_iv_b64);
        secretParams.set("upload_secret_iterations", secretMeta.upload_secret_iterations);
      }
      if (uploadFolderId) {
        secretParams.set("folder_id", uploadFolderId);
      }

      resumableUploadRef.current = {
        file,
        targetFile: uploadTargetFile,
        identifier,
        totalChunks,
        chunkSize: RESUMABLE_CHUNK_SIZE,
        currentChunk: 1,
        aborted: false,
        activeXhr: null,
      };

      let totalBytesUploaded = 0;

      try {
        for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
          if (resumableUploadRef.current.aborted) {
            throw new Error("Upload aborted.");
          }

          const start = (chunkNumber - 1) * RESUMABLE_CHUNK_SIZE;
          const end = Math.min(chunkNumber * RESUMABLE_CHUNK_SIZE, selectedFileSize);
          const chunkBlob = uploadTargetFile.slice(start, end);
          const expectedChunkBytes = end - start;
          if (chunkBlob.size !== expectedChunkBytes) {
            throw new Error("Upload source changed while reading file. Please re-select the file and retry.");
          }

          // ── Check if chunk already exists (GET) ──────────
          const checkUrl =
            `/api/files/upload` +
            `?resumableIdentifier=${encodeURIComponent(identifier)}` +
            `&resumableChunkNumber=${chunkNumber}`;

          const checkResp = await fetch(checkUrl, {
            headers: { "X-CSRF-Token": getCsrfToken() },
          });

          if (checkResp.status === 200) {
            // Chunk already exists — skip
            totalBytesUploaded += chunkBlob.size;
            resumableUploadRef.current.currentChunk = chunkNumber + 1;
            updateProgress(file, totalBytesUploaded, selectedFileSize, startedAt, chunkNumber, totalChunks);
            continue;
          }

          // ── Upload chunk (POST) ───────────────────────────
          const uploadUrl =
            `/api/files/upload` +
            `?resumableIdentifier=${encodeURIComponent(identifier)}` +
            `&resumableChunkNumber=${chunkNumber}` +
            `&resumableTotalChunks=${totalChunks}` +
            `&resumableTotalSize=${totalSize}` +
            `&resumableFilename=${encodeURIComponent(file.name)}` +
            `&resumableType=${encodeURIComponent(file.type || 'application/octet-stream')}` +
            (secretParams.toString() ? `&${secretParams.toString()}` : '');

            const chunkResult = await new Promise<{
              success?: boolean;
              done?: boolean;
              error?: string;
              responseText?: string;
              status?: number;
            }>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              resumableUploadRef.current!.activeXhr = xhr;

              const chunkFormData = new FormData();
              chunkFormData.append("file", chunkBlob, file.name);

              let ndjsonCursor = 0;
              let ndjsonBuffer = "";

              // ── NDJSON streaming: read encryption progress live ──
              const readNdjsonStream = () => {
                const chunk = xhr.responseText.slice(ndjsonCursor);
                ndjsonCursor = xhr.responseText.length;
                if (!chunk) return;
                ndjsonBuffer += chunk;
                const lines = ndjsonBuffer.split("\n");
                ndjsonBuffer = lines.pop() || "";
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const event = JSON.parse(line) as UploadStreamEvent;
                    if (event.type === "processing" && chunkNumber === totalChunks) {
                      setTransfer({
                        direction: "upload",
                        name: file.name,
                        loaded: selectedFileSize,
                        total: selectedFileSize,
                        startedAt,
                        processing: true,
                        processingStartedAt: Date.now(),
                        processingLoaded: event.loaded ?? 0,
                        processingTotal: event.total ?? 0,
                        phaseLabel: event.phase || "Processing...",
                      });
                    }
                  } catch {
                    // ignore
                  }
                }
              };

              xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                  const chunkLoaded = totalBytesUploaded + event.loaded;
                  const pct = Math.round((chunkLoaded / selectedFileSize) * 100);
                  setUploadProgress(pct);
                  setTransfer({
                    direction: "upload",
                    name: file.name,
                    loaded: chunkLoaded,
                    total: selectedFileSize,
                    startedAt,
                    phaseLabel: `Uploading chunk ${chunkNumber}/${totalChunks} (${Math.round(event.loaded / 1024 / 1024)} MB)`,
                  });
                }
              };

              // ← NEW: read NDJSON progressively as data arrives
              xhr.onreadystatechange = () => {
                if (xhr.readyState === XMLHttpRequest.LOADING || xhr.readyState === XMLHttpRequest.DONE) {
                  readNdjsonStream();
                }
              };

              xhr.onload = () => {
                resumableUploadRef.current!.activeXhr = null;
                resolve({
                  status: xhr.status,
                  responseText: xhr.responseText,
                  ...(xhr.status >= 200 && xhr.status < 300
                  ? (() => {
                    try {
                      return JSON.parse(xhr.responseText);
                    } catch {
                      return { done: true, responseText: xhr.responseText };
                    }
                  })()
                  : (() => {
                    try {
                      return { error: JSON.parse(xhr.responseText).error || "Chunk upload failed." };
                    } catch {
                      return { error: "Chunk upload failed." };
                    }
                  })()),
                });
              };

              xhr.onerror = () => reject(new Error("Network error during chunk upload."));
              xhr.onabort = () => reject(new Error("Upload aborted."));

              xhr.open("POST", uploadUrl);
              xhr.setRequestHeader("X-CSRF-Token", getCsrfToken());
              xhr.setRequestHeader("Accept", "application/x-ndjson");
              xhr.send(chunkFormData);
            });

            if (chunkResult.error) {
              throw new Error(chunkResult.error);
            }

            totalBytesUploaded += chunkBlob.size;
            resumableUploadRef.current.currentChunk = chunkNumber + 1;

            // The NDJSON was already streamed live via onreadystatechange above.
            // No need to parse responseText again here.
        }

        // ── All chunks uploaded successfully ──────────────────
        setUploading(false);
        setUploadProgress(100);
        setTransfer({
          direction: "upload",
          name: file.name,
          loaded: selectedFileSize,
          total: selectedFileSize,
          startedAt,
          complete: true,
        });
        window.setTimeout(
          () => setTransfer((current) => (current?.startedAt === startedAt ? null : current)),
          1800,
        );
        notify("Upload complete.");
        await loadFilesAndLinks();
        onTriggerRefreshUser();
        return true;
      } catch (err) {
        setUploading(false);
        setUploadProgress(0);
        setTransfer(null);
        const msg = err instanceof Error ? err.message : "Upload failed.";
        if (msg !== "Upload aborted.") {
          notifyError(msg);
        }
        return false;
      } finally {
        resumableUploadRef.current = null;
        uploadRequestRef.current = null;
      }
    }

    // ═════════════════════════════════════════════════════════
    // SMALL FILES (≤ 50 MB) → Direct upload (existing XHR flow)
    // ═════════════════════════════════════════════════════════
    const formData = new FormData();

    // Append secret metadata if present
    if (secretMeta.upload_secret_key) {
      formData.append("upload_secret_key", secretMeta.upload_secret_key);
    }
    if (secretMeta.upload_secret_salt_b64 && secretMeta.upload_secret_iv_b64 && secretMeta.upload_secret_iterations) {
      formData.append("upload_secret_salt_b64", secretMeta.upload_secret_salt_b64);
      formData.append("upload_secret_iv_b64", secretMeta.upload_secret_iv_b64);
      formData.append("upload_secret_iterations", secretMeta.upload_secret_iterations);
    }

    formData.append("file", uploadTargetFile);
    formData.append("original_name", file.name);
    formData.append("mime_type", file.type || "application/octet-stream");
    if (uploadFolderId) formData.append("folder_id", uploadFolderId);
    return await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      uploadRequestRef.current = xhr;
      let responseCursor = 0;
      let responseBuffer = "";
      let processingStartedAt = 0;
      let uploadStreamError = "";
      let uploadStreamComplete = false;
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const handleStreamEvent = (event: UploadStreamEvent) => {
        if (event.type === "processing") {
          processingStartedAt ||= Date.now();
          setTransfer({
            direction: "upload",
            name: file.name,
            loaded: file.size,
            total: file.size,
            startedAt,
            processing: true,
            processingStartedAt,
            processingLoaded: event.loaded ?? 0,
            processingTotal: event.total ?? 1000,
            phaseLabel: event.phase || "Securing file",
          });
          return;
        }
        if (event.type === "complete") {
          uploadStreamComplete = true;
          setTransfer({
            direction: "upload",
            name: file.name,
            loaded: file.size,
            total: file.size,
            startedAt,
            complete: true,
          });
          return;
        }
        if (event.type === "error") {
          uploadStreamError = event.error || "Upload failed.";
        }
      };

      const readUploadStream = () => {
        const chunk = xhr.responseText.slice(responseCursor);
        responseCursor = xhr.responseText.length;
        if (!chunk) return;
        responseBuffer += chunk;
        const lines = responseBuffer.split("\n");
        responseBuffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleStreamEvent(JSON.parse(line) as UploadStreamEvent);
          } catch {
            // Non-streaming JSON responses are handled when the request finishes.
          }
        }
      };

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
        setTransfer({
          direction: "upload",
          name: file.name,
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : file.size,
          startedAt,
        });
      };
      xhr.upload.onload = () =>
        setTransfer({
          direction: "upload",
          name: file.name,
          loaded: file.size,
          total: file.size,
          startedAt,
          processing: true,
          processingStartedAt: Date.now(),
          processingLoaded: 0,
          processingTotal: 1000,
          phaseLabel: "Preparing scan",
        });
      xhr.onprogress = readUploadStream;
      xhr.onload = () => {
        void (async () => {
          readUploadStream();
          setUploading(false);
          uploadRequestRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            if (uploadStreamError) {
              setTransfer(null);
              notifyError(uploadStreamError);
              finish(false);
              return;
            }
            if (!uploadStreamComplete) {
              setTransfer({
                direction: "upload",
                name: file.name,
                loaded: file.size,
                total: file.size,
                startedAt,
                complete: true,
              });
            }
            window.setTimeout(
              () =>
                setTransfer((current) =>
                  current?.startedAt === startedAt ? null : current,
                ),
              1800,
            );
            notify("Upload complete.");
            try {
              await loadFilesAndLinks();
              onTriggerRefreshUser();
            } catch {
              // Keep the queue moving even if the refresh fails.
            }
            finish(true);
          } else {
            setTransfer(null);
            let data: { error?: string } = {};
            try {
              data = JSON.parse(xhr.responseText || "{}");
            } catch {
              data = {};
            }
            notifyError(data.error || "Upload failed.");
            finish(false);
          }
        })();
      };
      xhr.onabort = () => {
        setUploading(false);
        setUploadProgress(0);
        setTransfer(null);
        uploadRequestRef.current = null;
        if (uploadStoppedRef.current) notify("Upload stopped.");
        else notifyError("Upload interrupted.");
        finish(false);
      };
      xhr.onerror = () => {
        setUploading(false);
        setUploadProgress(0);
        setTransfer(null);
        uploadRequestRef.current = null;
        notifyError("Upload interrupted.");
        finish(false);
      };
      xhr.open("POST", "/api/files/upload");
      xhr.setRequestHeader("Accept", "application/x-ndjson");
      xhr.setRequestHeader("X-CSRF-Token", getCsrfToken());
      xhr.send(formData);
    });
  };

  // ── Helper: update progress bar during resumable upload ──────
  const updateProgress = (
    file: globalThis.File,
    loadedBytes: number,
    totalBytes: number,
    startedAt: number,
    chunkNumber: number,
    totalChunks: number,
  ) => {
    const pct = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
    setUploadProgress(pct);
    setTransfer({
      direction: "upload",
      name: file.name,
      loaded: loadedBytes,
      total: totalBytes,
      startedAt,
      phaseLabel: `Uploading chunk ${chunkNumber}/${totalChunks}`,
    });
  };

  const downloadFile = async (file: FileMetadata) => {
    const secretKey = file.has_user_secret
      ? window.prompt(`Enter the secret key for "${file.original_name}"`)?.trim() || ""
      : "";
    if (file.has_user_secret && !secretKey) {
      notifyError("Download cancelled. This file requires its secret key.");
      return;
    }
    downloadRequestRef.current?.abort();
    const controller = new AbortController();
    downloadRequestRef.current = controller;
    const startedAt = Date.now();
    setTransfer({
      direction: "download",
      name: file.original_name,
      loaded: 0,
      total: file.size,
      startedAt,
      processing: true,
      processingLoaded: 0,
      processingTotal: file.size,
      processingStartedAt: startedAt,
      phaseLabel: preparationPhaseLabel.decrypting,
    });
    try {
      const requestHeaders = {
        ...authHeaders(token),
        ...(secretKey ? { "X-File-Secret": secretKey } : {}),
      };
      const startResponse = await fetch(`/api/files/${file.id}/download/prepare`, {
        method: "POST",
        headers: {
          ...requestHeaders,
        },
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
        authHeaders(token),
        controller.signal,
        (status) => {
          setTransfer({
            direction: "download",
            name: file.original_name,
            loaded: 0,
            total: file.size,
            startedAt,
            processing: true,
            processingLoaded: status.loaded,
            processingTotal: status.total || status.size || file.size,
            processingStartedAt: startedAt,
            phaseLabel: preparationPhaseLabel[status.phase],
          });
        },
      );

      setTransfer({
        direction: "download",
        name: file.original_name,
        loaded: 0,
        total: file.size,
        startedAt,
      });

      // ── Direct browser download (streams to disk, no RAM usage) ──
      const anchor = document.createElement('a');
      anchor.href = fileUrl;
      anchor.download = file.original_name;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTransfer({
        direction: "download",
        name: file.original_name,
        loaded: file.size,
        total: file.size,
        startedAt,
        complete: true,
      });
      window.setTimeout(
        () =>
          setTransfer((current) =>
            current?.startedAt === startedAt ? null : current,
          ),
        1800,
      );
      
    } catch (reason) {
      setTransfer(null);
      notifyError(reason instanceof Error ? reason.message : "Download unavailable.");
    } finally {
      if (downloadRequestRef.current === controller) {
        downloadRequestRef.current = null;
      }
    }
  };

  const deleteFile = async (file: FileMetadata) => {
    if (
      !window.confirm(`Delete "${file.original_name}"? This cannot be undone.`)
    )
      return;
    const response = await fetch(`/api/files/${file.id}/delete`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (response.ok) {
      notify("File deleted.");
      await loadFilesAndLinks();
      onTriggerRefreshUser();
    } else notifyError("Could not delete the file.");
  };

  const createFolder = async () => {
    if (activeFolderDepth >= 5) {
      notifyError("Maximum folder depth is 5.");
      return;
    }
    const name = window.prompt("Folder name")?.trim();
    if (!name) return;
    const response = await fetch("/api/file-folders", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_folder_id: activeFolderId }),
    });
    const data = await response.json();
    if (response.ok) {
      setFolders((current) => [...current, data.folder].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveFolderId(data.folder.id);
      notify("Folder created.");
    } else notifyError(data.error || "Could not create folder.");
  };

  const renameFolder = async (folder: FileFolder) => {
    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name || name === folder.name) return;
    const response = await fetch(`/api/file-folders/${folder.id}/rename`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    if (response.ok) {
      setFolders((current) => current.map((item) => (item.id === folder.id ? data.folder : item)).sort((a, b) => a.name.localeCompare(b.name)));
      notify("Folder renamed.");
    } else notifyError(data.error || "Could not rename folder.");
  };

  const deleteFolder = async (folder: FileFolder) => {
    if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
    const deleteFiles = window.confirm(
      `Delete all files inside "${folder.name}" too?\n\nOK deletes the files. Cancel deletes only the folder and moves files back to All Files.`,
    );
    const response = await fetch(`/api/file-folders/${folder.id}/delete`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ delete_files: deleteFiles }),
    });
    if (response.ok) {
      notify(deleteFiles ? "Folder and files deleted." : "Folder deleted. Files moved to All Files.");
      setActiveFolderId(folder.parent_folder_id || null);
      await loadFilesAndLinks();
      onTriggerRefreshUser();
    } else notifyError((await response.json()).error || "Could not delete folder.");
  };

  const moveFileToFolder = async (file: FileMetadata, folderId: string | null) => {
    const response = await fetch(`/api/files/${file.id}/folder`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: folderId }),
    });
    const data = await response.json();
    if (response.ok) {
      setFiles((current) => current.map((item) => (item.id === file.id ? data.file : item)));
      setFolders((current) =>
        current.map((folder) => ({
          ...folder,
          file_count: files
            .map((item) => (item.id === file.id ? data.file : item))
            .filter((item) => item.folder_id === folder.id).length,
        })),
      );
      notify(folderId ? "File moved to folder." : "File moved to All Files.");
    } else notifyError(data.error || "Could not move file.");
  };

  const toShareUrl = (publicToken: string, allowExternalPreview: boolean) =>
    allowExternalPreview
      ? `${window.location.origin}/api/public/share/${publicToken}/embed`
      : `${window.location.origin}/s/${publicToken}`;

  const openShare = (file: FileMetadata) => {
    const existing = links.find((link) => link.file_id === file.id);
    const allowExternalPreview =
      !!existing?.allow_external_preview && supportsExternalPreview(file);
    setShareFile(file);
    setSharePassword("");
    setShareExpires(existing?.expires_at?.substring(0, 16) || "");
    setShareMaxDownloads(
      existing?.max_downloads ? String(existing.max_downloads) : "",
    );
    setShareAllowExternalPreview(allowExternalPreview);
    setShareUrl(
      existing
        ? toShareUrl(existing.public_token, allowExternalPreview)
        : "",
    );
  };

  const saveShare = async () => {
    if (!shareFile) return;
    const response = await fetch(`/api/files/${shareFile.id}/share`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        password: sharePassword || undefined,
        expires_at: shareExpires ? new Date(shareExpires).toISOString() : null,
        max_downloads: shareMaxDownloads ? Number(shareMaxDownloads) : null,
        allow_external_preview: shareAllowExternalPreview,
        is_active: true,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      setShareUrl(toShareUrl(data.link.public_token, shareAllowExternalPreview));
      await loadFilesAndLinks();
      notify("Share link ready.");
    } else notifyError(data.error || "Could not create the share link.");
  };

  const removeSharedLink = async (link: ShareLink) => {
    const file = files.find((item) => item.id === link.file_id);
    if (
      !window.confirm(
        `Remove the shared link for "${file?.original_name || "this file"}"? This cannot be undone.`,
      )
    )
      return;
    const response = await fetch(`/api/sharing/links/${link.id}/remove`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (response.ok) {
      setLinks((current) => current.filter((item) => item.id !== link.id));
      notify(`Removed shared link for ${file?.original_name || "file"}.`);
    } else {
      notifyError(
        (await response.json()).error || "Could not remove the shared link.",
      );
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/users/me/update", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        username: profileUsername,
        email: profileEmail,
        password: profilePassword || undefined,
      }),
    });
    if (response.ok) {
      setProfilePassword("");
      onTriggerRefreshUser();
      toast.success("Profile updated.");
    } else
      notifyError((await response.json()).error || "Could not update profile.");
  };

  useEffect(() => {
    const firstAlternative = quotas.find((quota) => quota.id !== user.quota_id)?.id || "";
    setQuotaRequestTarget((current) => {
      if (current && current !== user.quota_id) return current;
      return firstAlternative;
    });
  }, [quotas, user.quota_id]);

  const submitQuotaRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quotaRequestTarget) {
      notifyError("Choose the plan you want to request.");
      return;
    }
    if (quotaRequestNote.trim().length < 10) {
      notifyError("Please add a short reason (at least 10 characters).");
      return;
    }

    setQuotaRequestSubmitting(true);
    try {
      const response = await fetch("/api/users/me/quota-change-request", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_quota_id: quotaRequestTarget,
          note: quotaRequestNote,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        notifyError(payload.error || "Could not submit your quota request.");
        return;
      }

      setQuotaRequestNote("");
      notify(payload.message || "Quota request sent to admins.");
    } catch {
      notifyError("Could not submit your quota request.");
    } finally {
      setQuotaRequestSubmitting(false);
    }
  };

  const uploadAvatar = async (file: globalThis.File) => {
    setAvatarUploading(true);
    const formData = new FormData();
    formData.append("avatar", file);
    try {
      const response = await fetch("/api/users/me/avatar", {
        method: "POST",
        headers: authHeaders(token),
        body: formData,
      });
      if (response.ok) {
        setAvatarVersion(Date.now());
        notify("Profile picture updated.");
      } else {
        notifyError(
          (await response.json()).error || "Could not update profile picture.",
        );
      }
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeAvatar = async () => {
    const response = await fetch("/api/users/me/avatar/remove", {
      method: "POST",
      headers: authHeaders(token),
    });
    if (response.ok) {
      setAvatarVersion(Date.now());
      notify("Profile picture removed.");
    } else {
      notifyError(
        (await response.json()).error || "Could not remove profile picture.",
      );
    }
  };

  const [isReadOnly, setIsReadOnly] = useState(true);
  const [password, setPassword] = useState('');

  const navItems: DashboardNavItem[] = [
    ["home", <LayoutGrid className="h-4 w-4" />, "Home"],
    ["files", <Folder className="h-4 w-4" />, "All files"],
    ["shared", <Share2 className="h-4 w-4" />, "Shared"],
    ["settings", <Settings className="h-4 w-4" />, "Settings"],
  ];
  if (user.role === "Admin")
    navItems.push(["admin", <Shield className="h-4 w-4" />, "Admin"]);

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <MaintenanceModeBanner />
      <DashboardSidebar
        user={user}
        view={view}
        navItems={navItems}
        storageLimit={storageLimit}
        onView={navigateDashboard}
        onLogout={onLogout}
      />

      <main className="min-w-0 overflow-x-hidden lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-20 min-w-0 flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-panel)_92%,transparent)] px-3 py-3 backdrop-blur-[var(--blur-header)] sm:h-20 sm:flex-nowrap sm:px-5 sm:pr-64 lg:px-8 lg:pr-72">
          <select
            value={view}
            onChange={(event) =>
              navigateDashboard(event.target.value as DashboardView)
            }
            className="h-11 w-[8.5rem] shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 text-sm lg:hidden"
          >
            {navItems.map(([id, , label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {(view === "files" || view === "home") && (
            <>
              <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--accent-linear)] px-0 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-linear-bright)] sm:w-auto sm:rounded-full sm:px-5">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files || []);
                    event.target.value = "";
                    void uploadFiles(selectedFiles);
                  }}
                />
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Upload files</span>
              </label>
            </>
          )}
          <div className="relative order-3 min-w-0 w-full sm:order-none sm:max-w-xl">
          {view === "files" && (
            <>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search files"
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] pl-10 pr-4 text-sm outline-none focus:border-[var(--accent-linear)]"
              />
            </>
          )}
          </div>
          <button
            type="button"
            aria-label="Log out"
            title="Log out"
            onClick={onLogout}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <div className="absolute right-5 hidden items-center gap-3 sm:flex lg:right-8">
            <ProfileAvatar
              user={user}
              version={avatarVersion}
              className="h-9 w-9 text-sm"
            />
            <div>
              <p className="text-sm font-medium">{user.username}</p>
              <p className="text-xs text-[var(--text-muted)]">{user.role}</p>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full min-w-0 max-w-7xl overflow-x-hidden px-3 py-5 sm:p-5 lg:p-8">
          {transfer && (
            <div className="mx-auto mb-6 max-w-5xl">
              <TransferProgress
                transfer={transfer}
                onCancel={
                  transfer.direction === "upload"
                    ? stopUpload
                    : transfer.direction === "download"
                      ? () => downloadRequestRef.current?.abort()
                      : undefined
                }
              />
            </div>
          )}
          {view === "home" && (
            <div className="mx-auto max-w-5xl space-y-8">
              <div className="text-center">
                <p className="text-sm text-[var(--text-muted)]">
                  Good to see you, {user.username}.
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">
                  Keep the important things close.
                </h1>
              </div>
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void uploadFiles(Array.from(event.dataTransfer.files || []));
                }}
                className={`rounded-2xl border border-dashed p-8 text-center ${dragging ? "border-[var(--accent-linear)] bg-[color-mix(in_srgb,var(--accent-linear)_14%,transparent)]" : "border-[var(--border-subtle)] bg-[var(--bg-panel)]"}`}
              >
                <input
                  ref={dropzoneFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files || []);
                    event.target.value = "";
                    void uploadFiles(selectedFiles);
                  }}
                />
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[var(--bg-hover)]">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-medium">
                  {uploading
                    ? `Uploading · ${uploadProgress}%`
                    : "Drop files here to upload them securely"}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {uploading
                    ? "We will let you know when it is ready."
                    : `Files will upload one at a time.`}
                </p>
                {!uploading && (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    or{" "}
                    <button
                      type="button"
                      onClick={openUploadFilePicker}
                      className="font-semibold text-[var(--accent-linear)] underline-offset-4 hover:underline"
                    >
                      Browse files
                    </button>
                  </p>
                )}
                {!uploading && (
                  <div
                    aria-hidden="true"
                    className="mx-auto mt-3 h-px w-full max-w-md bg-[var(--border-subtle)]/70"
                  />
                )}
                <div className="mx-auto mt-4 w-full max-w-md text-left" onFocusCapture={() => setIsReadOnly(false)} onBlurCapture={() => setIsReadOnly(true)}>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                    Upload secret key
                  </label>
                  <p className="mb-2 text-xs text-[var(--text-faint)]">
                    Optional: add a secret key for an extra encryption layer.
                  </p>
                  <input
                    type={isReadOnly ? "text" : "password"}
                    value={uploadSecretKey}
                    onChange={(event) => setUploadSecretKey(event.target.value)}
                    placeholder="Ex.: Leeku-secret-1"
                    className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 text-sm outline-none focus:border-[var(--accent-linear)]"
                  />
                  <label className="mb-1 mt-3 block text-xs font-medium text-[var(--text-muted)]">
                    Upload folder
                  </label>
                  <select
                    value={uploadTargetFolderId || ""}
                    onChange={(event) =>
                      setUploadTargetFolderId(event.target.value || null)
                    }
                    disabled={uploading}
                    className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--accent-linear)] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <option value="">Root Folder</option>
                    {uploadFolderOptions.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.label}
                      </option>
                    ))}
                  </select>
                  <div className="mt-3 rounded-lg border border-[var(--accent-linear)]/30 bg-[color-mix(in_srgb,var(--accent-linear)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] shadow-sm">
                    {filesLeft} file{filesLeft === 1 ? "" : "s"} left in your quota. <br/> Maximum file size: {formatBytes(activeQuota?.max_file_size_bytes || 0)}.
                  </div>
                </div>
              </div>
              <section>
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Recent files</h2>
                    <p className="text-sm text-[var(--text-muted)]">
                      Your most recently uploaded files.
                    </p>
                  </div>
                  <button
                    onClick={() => navigateDashboard("files")}
                    className="text-sm font-medium text-[var(--text-secondary)]"
                  >
                    See all
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {files.slice(0, 4).map((file) => (
                    <FileCard
                      key={file.id}
                      file={file}
                      token={token}
                      onDownload={() => downloadFile(file)}
                      onOpenVideo={() => setVideoFile(file)}
                      onShare={() => openShare(file)}
                      onDelete={() => deleteFile(file)}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          {view === "files" && (
            <section className="mx-auto w-full min-w-0 max-w-5xl overflow-x-hidden">
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                  {activeFolder ? activeFolder.name : "All files"}
                </h1>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {currentFolderFiles.length} file{currentFolderFiles.length === 1 ? "" : "s"} {activeFolder ? "in this folder" : "in All Files root"}.
                  {normalizedSearch && (
                    <>
                      {" "}
                      ({visibleFiles.length} matching "{search.trim()}")
                    </>
                  )}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {activeFolder && (
                    <button
                      type="button"
                      onClick={() =>
                        setActiveFolderId(activeFolder.parent_folder_id || null)
                      }
                      className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={createFolder}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    {activeFolder ? "New sub-folder" : "New folder"}
                  </button>
                  {activeFolder && (
                    <>
                      <button
                        type="button"
                        onClick={() => renameFolder(activeFolder)}
                        className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      >
                        Rename folder
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFolder(activeFolder)}
                        className="rounded-lg border border-[color-mix(in_srgb,var(--error-linear)_42%,transparent)] px-3 py-2 text-xs font-medium text-[var(--error-linear)] hover:bg-[color-mix(in_srgb,var(--error-linear)_12%,transparent)]"
                      >
                        Delete folder
                      </button>
                    </>
                  )}
                </div>
                {folderPath.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-1 text-xs text-[var(--text-muted)]">
                    <button
                      type="button"
                      onClick={() => setActiveFolderId(null)}
                      className="hover:text-[var(--text-primary)]"
                    >
                      All Files
                    </button>
                    {folderPath.map((folder) => (
                      <React.Fragment key={folder.id}>
                        <span>/</span>
                        <button
                          type="button"
                          onClick={() => setActiveFolderId(folder.id)}
                          className="max-w-[10rem] truncate hover:text-[var(--text-primary)]"
                        >
                          {folder.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              {visibleFolders.length > 0 && (
                <div className="mb-6 grid w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setActiveFolderId(folder.id)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-left shadow-[var(--shadow-hairline)] hover:bg-[var(--bg-hover)]"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-muted)]">
                        <Folder className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{folder.name}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {folder.file_count} file{folder.file_count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {visibleFiles.length === 0 ? (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-8 text-center shadow-[var(--shadow-hairline)]">
                  <p className="text-sm font-medium">No matching files</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Try another search or upload a file.
                  </p>
                </div>
              ) : (
                <div className="grid w-full min-w-0 gap-3 sm:hidden">
                  {visibleFiles.map((file) => (
                    <div
                      key={file.id}
                      className="w-full min-w-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-[var(--shadow-hairline)]"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <FileThumbnail
                          file={file}
                          token={token}
                          className="h-11 w-11 rounded-lg"
                          iconClassName="h-5 w-5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 items-start gap-1 text-sm font-medium leading-5">
                            <span className="truncate">{file.original_name}</span>
                            {file.has_user_secret && (
                              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" aria-label="Secret key required" />
                            )}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-4 text-[var(--text-muted)]">
                            <span className="max-w-full truncate">{fileKind(file)}</span>
                            <span className="shrink-0">{formatBytes(file.size)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-4 text-[var(--text-faint)]">
                            <span className="capitalize">{file.status}</span>
                            <span>{new Date(file.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid w-full min-w-0 gap-2 min-[380px]:grid-cols-2">
                        <FileActionButton
                          label="Download"
                          onClick={() => downloadFile(file)}
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                        </FileActionButton>
                        <FileActionButton
                          label="Share"
                          onClick={() => openShare(file)}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </FileActionButton>
                        <FileActionButton
                          label="Delete"
                          destructive
                          onClick={() => deleteFile(file)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </FileActionButton>
                      </div>
                      <MoveFileSelect
                        file={file}
                        folders={folders}
                        onMove={moveFileToFolder}
                      />
                    </div>
                  ))}
                </div>
              )}
              {visibleFiles.length > 0 && (
              <div className="hidden overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-[var(--shadow-hairline)] sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-xs text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="hidden px-4 py-3 font-medium md:table-cell">
                        Type
                      </th>
                      <th className="hidden px-4 py-3 font-medium sm:table-cell">
                        Size
                      </th>
                      <th className="hidden px-4 py-3 font-medium lg:table-cell">
                        Added
                      </th>
                      <th className="hidden px-4 py-3 font-medium md:table-cell">
                        Folder
                      </th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {visibleFiles.map((file) => (
                      <tr key={file.id} className="hover:bg-[var(--bg-muted)]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileThumbnail
                              file={file}
                              token={token}
                              className="h-9 w-9 rounded-lg"
                              iconClassName="h-4 w-4"
                            />
                            <div>
                              <p className="flex max-w-xs items-center gap-1 truncate font-medium">
                                <span className="truncate">{file.original_name}</span>
                                {file.has_user_secret && (
                                  <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" aria-label="Secret key required" />
                                )}
                              </p>
                              <p className="text-xs text-[var(--text-faint)]">
                                {file.status}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-[var(--text-muted)] md:table-cell">
                          {fileKind(file)}
                        </td>
                        <td className="hidden px-4 py-3 text-[var(--text-muted)] sm:table-cell">
                          {formatBytes(file.size)}
                        </td>
                        <td className="hidden px-4 py-3 text-[var(--text-muted)] lg:table-cell">
                          {new Date(file.created_at).toLocaleDateString()}
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <MoveFileSelect
                            file={file}
                            folders={folders}
                            onMove={moveFileToFolder}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <IconButton
                              label="Download"
                              onClick={() => downloadFile(file)}
                            >
                              <ArrowDownToLine className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label="Share"
                              onClick={() => openShare(file)}
                            >
                              <Share2 className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label="Delete"
                              onClick={() => deleteFile(file)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </section>
          )}

          {view === "shared" && (
            <section className="mx-auto max-w-5xl space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                  Shared links
                </h1>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Files currently available through shared links.
                </p>
              </div>
              {links.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--bg-hover)] text-[var(--text-muted)]">
                    <Link2 className="h-4 w-4" />
                  </div>
                  <p className="mt-4 text-sm font-medium">No shared links</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Share a file to create a link.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {links.map((link) => {
                    const file = files.find((item) => item.id === link.file_id);
                    return (
                      <div
                        key={link.id}
                        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-[var(--shadow-hairline)]"
                      >
                        <div className="flex items-start justify-between">
                          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--bg-hover)]">
                            <Link2 className="h-4 w-4" />
                          </div>
                          <span className="text-xs text-[var(--text-muted)]">
                            {link.is_available === false
                              ? "Unavailable"
                              : link.is_active
                                ? "Active"
                                : "Paused"}
                          </span>
                        </div>
                        <p className="mt-4 truncate text-sm font-medium">
                          {file?.original_name || "Shared file"}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {link.download_count}
                          {link.max_downloads
                            ? ` of ${link.max_downloads}`
                            : ""}{" "}
                          downloads
                        </p>
                        <div className="mt-4 flex flex-nowrap items-center gap-1">
                          <button
                            type="button"
                            disabled={link.is_available === false}
                            onClick={() =>
                              navigator.clipboard
                                .writeText(
                                  toShareUrl(
                                    link.public_token,
                                    !!link.allow_external_preview,
                                  ),
                                )
                                .then(() => notify("Link copied."))
                            }
                            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium tracking-normal text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy link
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSharedLink(link)}
                            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium tracking-normal text-[var(--error-linear)] hover:bg-[var(--bg-hover)] hover:text-[var(--error-linear)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove shared link
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {view === "settings" && (
            <section className="mx-auto max-w-2xl">
              <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                Account settings
              </h1>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Keep your sign-in details current.
              </p>
              <form
                onSubmit={saveProfile}
                className="mt-6 space-y-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-hairline)]"
              >
                <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-5">
                  <ProfileAvatar
                    user={user}
                    version={avatarVersion}
                    className="h-16 w-16 text-lg"
                  />
                  <div>
                    <p className="text-sm font-medium">Profile picture</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      PNG, JPEG, or WebP. Up to 5 MB.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-[var(--border-subtle)] px-2.5 text-[0.8rem] font-medium hover:bg-[var(--bg-hover)]">
                        <Camera className="h-3.5 w-3.5" />
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={avatarUploading}
                          onChange={(event) =>
                            event.target.files?.[0] &&
                            uploadAvatar(event.target.files[0])
                          }
                        />
                        {avatarUploading ? "Uploading..." : "Choose picture"}
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={removeAvatar}
                      >
                        Remove picture
                      </Button>
                    </div>
                  </div>
                </div>
                <Field
                  label="Username"
                  value={profileUsername}
                  onChange={setProfileUsername}
                />
                <Field
                  label="Email"
                  type="email"
                  value={profileEmail}
                  onChange={setProfileEmail}
                />
                <Field
                  label="New password"
                  type="password"
                  value={profilePassword}
                  onChange={setProfilePassword}
                  placeholder="Leave blank to keep your current password"
                />
                <Button type="submit" size="lg">
                  Save changes
                </Button>
              </form>
              <form
                onSubmit={submitQuotaRequest}
                className="mt-6 space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-hairline)]"
              >
                <div>
                  <h2 className="text-lg font-semibold">Request a quota upgrade</h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Send a plan change request to project admins.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium">Requested plan</span>
                  <select
                    value={quotaRequestTarget}
                    onChange={(event) => setQuotaRequestTarget(event.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-linear)]"
                    required
                  >
                    {!quotas.some((quota) => quota.id !== user.quota_id) && (
                      <option value="">No alternate plan available</option>
                    )}
                    {quotas
                      .filter((quota) => quota.id !== user.quota_id)
                      .map((quota) => (
                        <option key={quota.id} value={quota.id}>
                          {quota.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium">Why do you need this plan?</span>
                  <textarea
                    value={quotaRequestNote}
                    onChange={(event) => setQuotaRequestNote(event.target.value)}
                    minLength={10}
                    maxLength={2000}
                    required
                    rows={4}
                    placeholder="Describe your usage and why you need this upgrade."
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent-linear)]"
                  />
                </label>
                <Button
                  type="submit"
                  size="lg"
                  disabled={
                    quotaRequestSubmitting ||
                    !quotaRequestTarget ||
                    !quotas.some((quota) => quota.id !== user.quota_id)
                  }
                >
                  {quotaRequestSubmitting ? "Sending request..." : "Send quota request"}
                </Button>
              </form>
              <ThemeSettings />
              <SessionManager />
            </section>
          )}

          {view === "admin" && user.role === "Admin" && (
            <AdminWorkspace
              users={adminUsers}
              files={adminFiles}
              logs={logs}
              stats={stats}
              quotas={quotas}
              onReload={loadAdmin}
            />
          )}
        </div>
      </main>

      {shareFile && (
        <ShareDialog
          file={shareFile}
          password={sharePassword}
          expires={shareExpires}
          maxDownloads={shareMaxDownloads}
          allowExternalPreview={shareAllowExternalPreview}
          url={shareUrl}
          onPassword={setSharePassword}
          onExpires={setShareExpires}
          onMaxDownloads={setShareMaxDownloads}
          onAllowExternalPreview={setShareAllowExternalPreview}
          onSave={saveShare}
          onClose={() => setShareFile(null)}
          onCopy={() =>
            navigator.clipboard
              .writeText(shareUrl)
              .then(() => notify("Link copied."))
          }
        />
      )}
      {videoFile && (
        <VideoPlayer file={videoFile} onClose={() => setVideoFile(null)} />
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-2 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  );
}

function FileActionButton({
  label,
  destructive = false,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium ${
        destructive
          ? "border-[color-mix(in_srgb,var(--error-linear)_42%,transparent)] text-[var(--error-linear)] hover:bg-[color-mix(in_srgb,var(--error-linear)_12%,transparent)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  );
}

function MoveFileSelect({
  file,
  folders,
  onMove,
}: {
  file: FileMetadata;
  folders: FileFolder[];
  onMove: (file: FileMetadata, folderId: string | null) => void;
}) {
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder] as const)),
    [folders],
  );

  const folderOptions = useMemo(() => {
    const toPathLabel = (folder: FileFolder) => {
      const names = [folder.name];
      const seen = new Set<string>([folder.id]);
      let parentId = folder.parent_folder_id || null;
      while (parentId) {
        if (seen.has(parentId)) break;
        seen.add(parentId);
        const parent = folderById.get(parentId);
        if (!parent) break;
        names.unshift(parent.name);
        parentId = parent.parent_folder_id || null;
      }
      return names.join(" / ");
    };

    return folders
      .map((folder) => ({ id: folder.id, label: toPathLabel(folder) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folderById, folders]);

  return (
    <label className="mt-3 block text-xs text-[var(--text-muted)] sm:mt-0">
      <span className="sr-only">Move {file.original_name}</span>
      <select
        value={file.folder_id || ""}
        onChange={(event) => onMove(file, event.target.value || null)}
        className="h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-secondary)] outline-none focus:border-[var(--accent-linear)] md:w-40"
      >
        <option value="">All Files root</option>
        {folderOptions.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileAvatar({
  user,
  version,
  className,
}: {
  user: User;
  version: number;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [version]);

  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--bg-hover)] font-semibold ${className}`}
    >
      {!failed ? (
        <img
          src={`/api/users/me/avatar?v=${version}`}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        user.username.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function FileThumbnail({
  file,
  token,
  className,
  iconClassName,
  onOpenVideo,
  interactiveVideo = false,
  showTypeBadge = true,
}: {
  file: FileMetadata;
  token: string;
  className: string;
  iconClassName: string;
  onOpenVideo?: () => void;
  interactiveVideo?: boolean;
  showTypeBadge?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hovering, setHovering] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const isImage = file.mime_type.startsWith("image/");
  const isMp4 = file.mime_type === "video/mp4";
  const isPreviewable = isImage || isMp4;

  useEffect(() => {
    setPreviewUrl(null);
    setFailed(false);
    setPlaying(false);
    if (!isPreviewable) return undefined;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    fetch(`/api/files/${file.id}/preview`, {
      headers: authHeaders(token),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Preview unavailable.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          console.warn("[thumbnail] Preview unavailable.", {
            fileId: file.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, isPreviewable, token]);

  const playVideo = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    try {
      await video.play();
    } catch {
      video.muted = true;
      try {
        await video.play();
      } catch {
        setPlaying(false);
      }
    }
  };

  const stopVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    video.muted = true;
    setPlaying(false);
  };

  return (
    <div
      role={isMp4 && interactiveVideo && onOpenVideo ? "button" : undefined}
      tabIndex={isMp4 && interactiveVideo && onOpenVideo ? 0 : undefined}
      aria-label={isMp4 && interactiveVideo && onOpenVideo ? `Play ${file.original_name}` : undefined}
      className={`group/preview relative grid shrink-0 place-items-center overflow-hidden bg-[var(--bg-hover)] text-[var(--text-muted)] ${isMp4 && interactiveVideo && onOpenVideo ? "cursor-pointer" : ""} ${className}`}
      onClick={isMp4 && interactiveVideo ? onOpenVideo : undefined}
      onKeyDown={
        isMp4 && interactiveVideo && onOpenVideo
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenVideo();
              }
            }
          : undefined
      }
      onPointerEnter={
        isMp4 && interactiveVideo
          ? () => {
              setHovering(true);
              void playVideo();
            }
          : undefined
      }
      onPointerLeave={
        isMp4 && interactiveVideo
          ? () => {
              setHovering(false);
              stopVideo();
            }
          : undefined
      }
    >
      {isImage && previewUrl && !failed ? (
        <img
          src={previewUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : isMp4 && previewUrl && !failed ? (
        <>
          <video
            ref={videoRef}
            src={previewUrl}
            preload="auto"
            playsInline
            loop
            muted
            className="h-full w-full object-cover"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onCanPlay={() => {
              if (hovering) void playVideo();
            }}
            onError={() => setFailed(true)}
          />
          {interactiveVideo && (
            <span
              className={`pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-150 ${playing ? "opacity-0" : "opacity-100"}`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-black/70 text-white shadow-[var(--shadow-panel)] backdrop-blur-sm">
                <Play className="ml-0.5 h-4 w-4 fill-current" />
              </span>
            </span>
          )}
        </>
      ) : (
        <FileTypeIcon
          fileName={file.original_name}
          mimeType={file.mime_type}
          className={iconClassName}
          showBadge={showTypeBadge}
        />
      )}
    </div>
  );
}

function FileCard({
  file,
  token,
  onDownload,
  onOpenVideo,
  onShare,
  onDelete,
}: {
  file: FileMetadata;
  token: string;
  onDownload: () => void;
  onOpenVideo: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-[var(--shadow-hairline)]">
      <div className="relative">
        <FileThumbnail
          file={file}
          token={token}
          className="h-32 w-full rounded-lg"
          iconClassName="h-8 w-8"
          onOpenVideo={onOpenVideo}
          interactiveVideo
          showTypeBadge={false}
        />
        <span className="pointer-events-none absolute left-2 top-2 flex h-8 min-w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-elevated)_78%,transparent)] px-2 text-[10px] font-semibold leading-none text-[var(--text-secondary)] shadow-[var(--shadow-hairline)] backdrop-blur-sm">
          {getFileTypeBadge(file.original_name)}
        </span>
        <div ref={menuRef} className="absolute right-2 top-2">
          <button
            aria-label="File options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-md bg-[var(--bg-elevated)] p-2 text-[var(--text-secondary)] shadow-[var(--shadow-hairline)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] py-1 text-sm shadow-[var(--shadow-panel)]">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onShare();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--error-linear)] hover:bg-[color-mix(in_srgb,var(--error-linear)_12%,transparent)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <p className="min-w-0 flex flex-1 items-center gap-1 truncate text-sm font-medium">
          <span className="truncate">{file.original_name}</span>
          {file.has_user_secret && (
            <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" aria-label="Secret key required" />
          )}
        </p>
        <IconButton label={`Download ${file.original_name}`} onClick={onDownload}>
          <ArrowDownToLine className="h-4 w-4" />
        </IconButton>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {formatBytes(file.size)} ·{" "}
        {new Date(file.created_at).toLocaleDateString()}
      </p>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent-linear)]"
      />
    </label>
  );
}

function VideoPlayer({
  file,
  onClose,
}: {
  file: FileMetadata;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 p-4 backdrop-blur-md"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-4 text-white">
        <p className="min-w-0 truncate text-sm font-medium">{file.original_name}</p>
        <button
          type="button"
          aria-label="Close video"
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <video
        src={`/api/files/${file.id}/preview`}
        controls
        autoPlay
        playsInline
        className="min-h-0 w-full flex-1 object-contain"
      />
    </div>
  );
}

function ShareDialog(props: {
  file: FileMetadata;
  password: string;
  expires: string;
  maxDownloads: string;
  allowExternalPreview: boolean;
  url: string;
  onPassword: (value: string) => void;
  onExpires: (value: string) => void;
  onMaxDownloads: (value: string) => void;
  onAllowExternalPreview: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  onCopy: () => void;
}) {
  const selectedExpiresDate = parseLocalDateTimeValue(props.expires);
  const selectedExpiresTime = selectedExpiresDate
    ? `${pad2(selectedExpiresDate.getHours())}:${pad2(selectedExpiresDate.getMinutes())}`
    : "23:59";

  const [isReadOnly, setIsReadOnly] = useState(true);
  const [password, setPassword] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-panel)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Share {props.file.original_name}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Choose how long the link should stay useful.
            </p>
          </div>
          <button
            onClick={props.onClose}
            className="rounded-md p-2 hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2" onFocusCapture={() => setIsReadOnly(false)} onBlurCapture={() => setIsReadOnly(true)}>
          <Field
            label="Password"
            type={isReadOnly ? "text" : "password"}
            value={props.password}
            onChange={props.onPassword}
            placeholder="Optional"
          />
          <div>
            <span className="mb-2 block text-sm font-medium">Expires</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-[42px] w-full justify-start px-3 font-normal"
                >
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {selectedExpiresDate
                    ? selectedExpiresDate.toLocaleDateString()
                    : "No expiration"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedExpiresDate}
                  onSelect={(date) =>
                    props.onExpires(
                      date ? combineDateAndTime(date, selectedExpiresTime) : "",
                    )
                  }
                  disabled={{ before: new Date() }}
                  captionLayout="dropdown"
                />
                <div className="border-t border-[var(--border-subtle)] p-3">
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Time
                    <input
                      type="time"
                      value={selectedExpiresTime}
                      onChange={(event) => {
                        const date = selectedExpiresDate || new Date();
                        props.onExpires(
                          combineDateAndTime(date, event.target.value),
                        );
                      }}
                      className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-linear)]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => props.onExpires("")}
                    className="mt-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Clear expiration
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <Field
            label="Download limit"
            value={props.maxDownloads}
            onChange={props.onMaxDownloads}
            placeholder="Optional"
          />
        </div>
        {supportsExternalPreview(props.file) && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3 text-sm">
            <input
              type="checkbox"
              checked={props.allowExternalPreview}
              onChange={(event) =>
                props.onAllowExternalPreview(event.target.checked)
              }
              className="mt-0.5 h-4 w-4 rounded border-[var(--border-subtle)]"
            />
            <span>
              <span className="block font-medium text-[var(--text-primary)]">
                Allow external preview
              </span>
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                Generates a media embed link for image/video playback outside Leeku.
              </span>
            </span>
          </label>
        )}
        {props.url && (
          <div className="mt-5 flex gap-2">
            <input
              readOnly
              value={props.url}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <button
              onClick={props.onCopy}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 hover:bg-[var(--bg-hover)]"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            className="rounded-lg px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            onClick={props.onSave}
            className="rounded-lg bg-[var(--accent-linear)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-linear-bright)]"
          >
            Create link
          </button>
        </div>
      </div>
    </div>
  );
}