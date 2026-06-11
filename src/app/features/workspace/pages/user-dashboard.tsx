import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Camera,
  CalendarDays,
  Copy,
  File,
  FileText,
  Folder,
  LayoutGrid,
  Link2,
  LogOut,
  MoreHorizontal,
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
import type {
  FileMetadata,
  Quota,
  ShareLink,
  SystemLog,
  SystemStats,
  User,
} from "@/app/shared/types";

interface UserDashboardProps {
  user: User;
  token: string;
  onLogout: () => void;
  quotas: Quota[];
  onTriggerRefreshUser: () => void;
}

type View = "home" | "files" | "shared" | "settings" | "admin";

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

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
  const [view, setView] = useState<View>("home");
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminFiles, setAdminFiles] = useState<FileMetadata[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [shareFile, setShareFile] = useState<FileMetadata | null>(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpires, setShareExpires] = useState("");
  const [shareMaxDownloads, setShareMaxDownloads] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [profileUsername, setProfileUsername] = useState(user.username);
  const [profileEmail, setProfileEmail] = useState(user.email);
  const [profilePassword, setProfilePassword] = useState("");
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const activeQuota =
    quotas.find((quota) => quota.id === user.quota_id) || quotas[0];
  const storageLimit = activeQuota?.storage_limit_bytes || 1;
  const storagePercent = Math.min(
    100,
    (user.storage_used / storageLimit) * 100,
  );

  const notify = (message: string) => toast(message);
  const notifyError = (message: string) => toast.error(message);

  const loadWorkspace = async () => {
    const [filesResponse, linksResponse] = await Promise.all([
      fetch("/api/files", { headers: authHeaders(token) }),
      fetch("/api/sharing/links", { headers: authHeaders(token) }),
    ]);
    if (filesResponse.ok) setFiles((await filesResponse.json()).files || []);
    if (linksResponse.ok) setLinks((await linksResponse.json()).links || []);
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
    loadWorkspace().catch(() =>
      notifyError("Could not refresh the workspace."),
    );
    loadAdmin().catch(() => notifyError("Could not refresh admin data."));
  }, []);

  const visibleFiles = useMemo(
    () =>
      files.filter((file) =>
        file.original_name.toLowerCase().includes(search.toLowerCase()),
      ),
    [files, search],
  );

  const uploadFile = (file: globalThis.File) => {
    setUploading(true);
    setUploadProgress(0);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("original_name", file.name);
    formData.append("mime_type", file.type || "application/octet-stream");
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (event) =>
      event.lengthComputable &&
      setUploadProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = async () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        notify("Upload complete.");
        await loadWorkspace();
        onTriggerRefreshUser();
      } else {
        const data = JSON.parse(xhr.responseText || "{}");
        notifyError(data.error || "Upload failed.");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      notifyError("Upload interrupted.");
    };
    xhr.open("POST", "/api/files/upload");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  };

  const downloadFile = async (file: FileMetadata) => {
    const response = await fetch(`/api/files/${file.id}/download`, {
      headers: authHeaders(token),
    });
    if (!response.ok) return notifyError("Download unavailable.");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.original_name;
    anchor.click();
    URL.revokeObjectURL(url);
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
      await loadWorkspace();
      onTriggerRefreshUser();
    } else notifyError("Could not delete the file.");
  };

  const openShare = (file: FileMetadata) => {
    const existing = links.find((link) => link.file_id === file.id);
    setShareFile(file);
    setSharePassword("");
    setShareExpires(existing?.expires_at?.substring(0, 16) || "");
    setShareMaxDownloads(
      existing?.max_downloads ? String(existing.max_downloads) : "",
    );
    setShareUrl(
      existing ? `${window.location.origin}/#f/${existing.public_token}` : "",
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
        is_active: true,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      setShareUrl(`${window.location.origin}/#f/${data.link.public_token}`);
      await loadWorkspace();
      notify("Share link ready.");
    } else notifyError(data.error || "Could not create the share link.");
  };

  const unshareFile = async (link: ShareLink) => {
    const file = files.find((item) => item.id === link.file_id);
    const response = await fetch(`/api/files/${link.file_id}/share`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });
    if (response.ok) {
      notify(`Stopped sharing ${file?.original_name || "file"}.`);
      await loadWorkspace();
    } else {
      notifyError("Could not unshare the file.");
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
    const response = await fetch("/api/users/me/avatar", {
      method: "DELETE",
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

  const navItems: Array<[View, React.ReactNode, string]> = [
    ["home", <LayoutGrid className="h-4 w-4" />, "Home"],
    ["files", <Folder className="h-4 w-4" />, "All files"],
    ["shared", <Share2 className="h-4 w-4" />, "Shared"],
    ["settings", <Settings className="h-4 w-4" />, "Settings"],
  ];
  if (user.role === "Admin")
    navItems.push(["admin", <Shield className="h-4 w-4" />, "Admin"]);

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#17191d]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-[#e1e4e9] bg-white p-5 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#17191d] text-white">
            <Folder className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Leeku</p>
            <p className="text-xs text-[#8a9099]">
              A quiet place for your work
            </p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {navItems.map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${view === id ? "bg-[#f0f2f5] font-medium" : "text-[#676d76] hover:bg-[#f6f7f9]"}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-4 rounded-xl border border-[#e2e5ea] p-3">
            <div className="mb-2 flex justify-between text-xs">
              <span className="text-[#777d86]">Storage</span>
              <span>
                {formatBytes(user.storage_used)} / {formatBytes(storageLimit)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#eceff3]">
              <div
                className="h-full rounded-full bg-[#2f7ee6]"
                style={{ width: `${storagePercent}%` }}
              />
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#676d76] hover:bg-[#f6f7f9]"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-20 items-center gap-4 border-b border-[#e1e4e9] bg-white/95 px-5 sm:pr-64 lg:px-8 lg:pr-72">
          <select
            value={view}
            onChange={(event) => setView(event.target.value as View)}
            className="rounded-lg border border-[#dfe3e8] bg-white px-3 py-2.5 text-sm lg:hidden"
          >
            {navItems.map(([id, , label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0a9]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files"
              className="h-11 w-full rounded-lg border border-[#dfe3e8] bg-[#fafbfc] pl-10 pr-4 text-sm outline-none focus:border-[#aab1bb]"
            />
          </div>
          <label className="flex h-11 shrink-0 cursor-pointer items-center rounded-lg bg-[#2f7ee6] px-4 text-sm font-medium text-white hover:bg-[#276fca]">
            <input
              type="file"
              className="hidden"
              onChange={(event) =>
                event.target.files?.[0] && uploadFile(event.target.files[0])
              }
            />
            Upload file
          </label>
          <div className="absolute right-5 hidden items-center gap-3 sm:flex lg:right-8">
            <ProfileAvatar
              user={user}
              version={avatarVersion}
              className="h-9 w-9 text-sm"
            />
            <div>
              <p className="text-sm font-medium">{user.username}</p>
              <p className="text-xs text-[#8a9099]">{user.role}</p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl p-5 lg:p-8">
          {view === "home" && (
            <div className="mx-auto max-w-5xl space-y-8">
              <div className="text-center">
                <p className="text-sm text-[#858b94]">
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
                  event.dataTransfer.files[0] &&
                    uploadFile(event.dataTransfer.files[0]);
                }}
                className={`rounded-2xl border border-dashed p-8 text-center ${dragging ? "border-[#2f7ee6] bg-[#f2f7fe]" : "border-[#cfd4dc] bg-white"}`}
              >
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#f0f3f7]">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-medium">
                  {uploading
                    ? `Uploading · ${uploadProgress}%`
                    : "Drop a file here to add it to your workspace"}
                </p>
                <p className="mt-1 text-xs text-[#8a9099]">
                  {uploading
                    ? "We will let you know when it is ready."
                    : `One file at a time, up to ${formatBytes(activeQuota?.max_file_size_bytes || 0)}.`}
                </p>
                {uploading && (
                  <div className="mx-auto mt-4 h-1.5 max-w-sm overflow-hidden rounded-full bg-[#edf0f4]">
                    <div
                      className="h-full bg-[#2f7ee6]"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
              <section>
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Recent files</h2>
                    <p className="text-sm text-[#8a9099]">
                      The last things you worked with.
                    </p>
                  </div>
                  <button
                    onClick={() => setView("files")}
                    className="text-sm font-medium text-[#4e5661]"
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
                      onShare={() => openShare(file)}
                      onDelete={() => deleteFile(file)}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          {view === "files" && (
            <section className="mx-auto max-w-5xl">
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                  All files
                </h1>
                <p className="mt-1 text-sm text-[#8a9099]">
                  {visibleFiles.length} items in your workspace.
                </p>
              </div>
              <div className="overflow-hidden rounded-xl border border-[#e0e4e9] bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#e5e8ed] bg-[#fafbfc] text-xs text-[#7d838c]">
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
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf0f3]">
                    {visibleFiles.map((file) => (
                      <tr key={file.id} className="hover:bg-[#fafbfc]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileThumbnail
                              file={file}
                              token={token}
                              className="h-9 w-9 rounded-lg"
                              iconClassName="h-4 w-4"
                            />
                            <div>
                              <p className="max-w-xs truncate font-medium">
                                {file.original_name}
                              </p>
                              <p className="text-xs text-[#9197a0]">
                                {file.status}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-[#69707a] md:table-cell">
                          {fileKind(file)}
                        </td>
                        <td className="hidden px-4 py-3 text-[#69707a] sm:table-cell">
                          {formatBytes(file.size)}
                        </td>
                        <td className="hidden px-4 py-3 text-[#69707a] lg:table-cell">
                          {new Date(file.created_at).toLocaleDateString()}
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
            </section>
          )}

          {view === "shared" && (
            <section className="mx-auto max-w-5xl space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                  Shared links
                </h1>
                <p className="mt-1 text-sm text-[#8a9099]">
                  A simple view of what is available outside your workspace.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {links.map((link) => {
                  const file = files.find((item) => item.id === link.file_id);
                  return (
                    <div
                      key={link.id}
                      className="rounded-xl border border-[#e0e4e9] bg-white p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#f0f3f7]">
                          <Link2 className="h-4 w-4" />
                        </div>
                        <span className="text-xs text-[#8b919a]">
                          {link.is_active ? "Active" : "Paused"}
                        </span>
                      </div>
                      <p className="mt-4 truncate text-sm font-medium">
                        {file?.original_name || "Shared file"}
                      </p>
                      <p className="mt-1 text-xs text-[#8b919a]">
                        {link.download_count}
                        {link.max_downloads
                          ? ` of ${link.max_downloads}`
                          : ""}{" "}
                        downloads
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(
                                `${window.location.origin}/#f/${link.public_token}`,
                              )
                              .then(() => notify("Link copied."))
                          }
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-[#737a84] hover:bg-[#f0f2f5] hover:text-[#20242a]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy link
                        </button>
                        <button
                          type="button"
                          disabled={!link.is_active}
                          onClick={() => unshareFile(link)}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-[#f0f2f5] hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Unshare
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {view === "settings" && (
            <section className="mx-auto max-w-2xl">
              <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                Account settings
              </h1>
              <p className="mt-1 text-sm text-[#8a9099]">
                Keep your sign-in details current.
              </p>
              <form
                onSubmit={saveProfile}
                className="mt-6 space-y-5 rounded-xl border border-[#e0e4e9] bg-white p-6"
              >
                <div className="flex items-center gap-4 border-b border-[#e8ebef] pb-5">
                  <ProfileAvatar
                    user={user}
                    version={avatarVersion}
                    className="h-16 w-16 text-lg"
                  />
                  <div>
                    <p className="text-sm font-medium">Profile picture</p>
                    <p className="mt-1 text-xs text-[#8a9099]">
                      PNG, JPEG, or WebP. Up to 5 MB.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#dfe3e8] px-3 py-2 text-xs font-medium hover:bg-[#f6f7f9]">
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
            </section>
          )}

          {view === "admin" && user.role === "Admin" && (
            <section className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">
                  Admin overview
                </h1>
                <p className="mt-1 text-sm text-[#8a9099]">
                  A concise operational view.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Users", stats?.totalUsers || adminUsers.length],
                  ["Files", stats?.totalFiles || adminFiles.length],
                  ["Uploads today", stats?.uploadsToday || 0],
                  ["Blocked", stats?.blockedFiles || 0],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-[#e0e4e9] bg-white p-5"
                  >
                    <p className="text-sm text-[#818790]">{label}</p>
                    <p className="mt-2 text-3xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <AdminTable
                  title="Recent users"
                  rows={adminUsers
                    .slice(0, 8)
                    .map((item) => [item.username, item.email, item.status])}
                />
                <AdminTable
                  title="Recent activity"
                  rows={logs
                    .slice(0, 8)
                    .map((item) => [
                      item.event_type,
                      item.username || "System",
                      new Date(item.created_at).toLocaleDateString(),
                    ])}
                />
              </div>
            </section>
          )}
        </div>
      </main>

      {shareFile && (
        <ShareDialog
          file={shareFile}
          password={sharePassword}
          expires={shareExpires}
          maxDownloads={shareMaxDownloads}
          url={shareUrl}
          onPassword={setSharePassword}
          onExpires={setShareExpires}
          onMaxDownloads={setShareMaxDownloads}
          onSave={saveShare}
          onClose={() => setShareFile(null)}
          onCopy={() =>
            navigator.clipboard
              .writeText(shareUrl)
              .then(() => notify("Link copied."))
          }
        />
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
      className="rounded-md p-2 text-[#737a84] hover:bg-[#f0f2f5] hover:text-[#20242a]"
    >
      {children}
    </button>
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
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#eef1f5] font-semibold ${className}`}
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
}: {
  file: FileMetadata;
  token: string;
  className: string;
  iconClassName: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isImage = file.mime_type.startsWith("image/");

  useEffect(() => {
    setPreviewUrl(null);
    setFailed(false);
    if (!isImage) return undefined;

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
  }, [file.id, isImage, token]);

  const fallbackIcon = fileKind(file) === "Image" ? (
    <File className={iconClassName} />
  ) : (
    <FileText className={iconClassName} />
  );

  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden bg-[#eef3f9] text-[#69707a] ${className}`}
    >
      {isImage && previewUrl && !failed ? (
        <img
          src={previewUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        fallbackIcon
      )}
    </div>
  );
}

function FileCard({
  file,
  token,
  onDownload,
  onShare,
  onDelete,
}: {
  file: FileMetadata;
  token: string;
  onDownload: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[#e0e4e9] bg-white p-4">
      <div className="relative">
        <button
          type="button"
          onClick={onDownload}
          className="block w-full overflow-hidden rounded-lg text-left"
        >
          <FileThumbnail
            file={file}
            token={token}
            className="h-32 w-full rounded-lg"
            iconClassName="h-8 w-8"
          />
        </button>
        <div className="absolute right-2 top-2">
          <button
            aria-label="File options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-md p-2 text-[#8c929b] hover:bg-[#f2f4f6]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-[#e0e4e9] bg-white py-1 text-sm shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onShare();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f6f7f9]"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDownload}
        className="mt-3 block max-w-full truncate text-left text-sm font-medium"
      >
        {file.original_name}
      </button>
      <p className="mt-1 text-xs text-[#8d939c]">
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
        className="w-full rounded-lg border border-[#dfe3e8] px-3 py-2.5 text-sm outline-none focus:border-[#a9b0ba]"
      />
    </label>
  );
}

function AdminTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<Array<string>>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e0e4e9] bg-white">
      <div className="border-b border-[#e7eaee] px-4 py-3 text-sm font-medium">
        {title}
      </div>
      <div className="divide-y divide-[#edf0f3]">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
            {row.map((cell, cellIndex) => (
              <span
                key={cellIndex}
                className={
                  cellIndex ? "truncate text-[#777e88]" : "truncate font-medium"
                }
              >
                {cell}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareDialog(props: {
  file: FileMetadata;
  password: string;
  expires: string;
  maxDownloads: string;
  url: string;
  onPassword: (value: string) => void;
  onExpires: (value: string) => void;
  onMaxDownloads: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onCopy: () => void;
}) {
  const selectedExpiresDate = parseLocalDateTimeValue(props.expires);
  const selectedExpiresTime = selectedExpiresDate
    ? `${pad2(selectedExpiresDate.getHours())}:${pad2(selectedExpiresDate.getMinutes())}`
    : "23:59";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#dde1e7] bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Share {props.file.original_name}
            </h2>
            <p className="mt-1 text-sm text-[#858b94]">
              Choose how long the link should stay useful.
            </p>
          </div>
          <button
            onClick={props.onClose}
            className="rounded-md p-2 hover:bg-[#f2f4f6]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field
            label="Password"
            type="password"
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
                <div className="border-t border-[#e8ebef] p-3">
                  <label className="block text-xs font-medium text-[#6f7680]">
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
                      className="mt-1 w-full rounded-lg border border-[#dfe3e8] px-3 py-2 text-sm outline-none focus:border-[#a9b0ba]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => props.onExpires("")}
                    className="mt-2 text-xs font-medium text-[#6f7680] hover:text-[#20242a]"
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
        {props.url && (
          <div className="mt-5 flex gap-2">
            <input
              readOnly
              value={props.url}
              className="min-w-0 flex-1 rounded-lg border border-[#dfe3e8] px-3 py-2 text-sm"
            />
            <button
              onClick={props.onCopy}
              className="rounded-lg border border-[#dfe3e8] px-3"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            className="rounded-lg px-4 py-2.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={props.onSave}
            className="rounded-lg bg-[#2f7ee6] px-4 py-2.5 text-sm font-medium text-white"
          >
            Create link
          </button>
        </div>
      </div>
    </div>
  );
}
