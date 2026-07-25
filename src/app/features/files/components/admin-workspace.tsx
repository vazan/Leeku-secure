import { useEffect, useMemo, useState } from "react";
import { Activity, Database, Folder, FolderOpen, Plus, Server, ShieldAlert, Terminal, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { MaintenanceModeControl } from "@/app/shared/components/maintenance-mode-control";
import type { AdminFileFolder, FileMetadata, Quota, SystemLog, SystemStats, User } from "@/app/shared/types";

type AdminTab = "overview" | "users" | "files" | "quotas" | "logs" | "security" | "health" | "maintenance";

const tabs: Array<[AdminTab, string]> = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["files", "Files"],
  ["quotas", "Quotas"],
  ["logs", "Logs"],
  ["security", "Security Events"],
  ["health", "System Health"],
  ["maintenance", "Maintenance"],
];

const getCsrfToken = () =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith("leeku_csrf="))
    ?.split("=")[1] || "";

const adminHeaders = (json = false) => ({
  "X-CSRF-Token": getCsrfToken(),
  ...(json ? { "Content-Type": "application/json" } : {}),
});

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export default function AdminWorkspace({
  users,
  files,
  folders,
  logs,
  stats,
  quotas,
  onReload,
}: {
  users: User[];
  files: FileMetadata[];
  folders: AdminFileFolder[];
  logs: SystemLog[];
  stats: SystemStats | null;
  quotas: Quota[];
  onReload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [localQuotas, setLocalQuotas] = useState(quotas);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUser, setEditUser] = useState({ username: "", email: "", role: "User", status: "Active", password: "" });
  const [quotaDraft, setQuotaDraft] = useState({
    id: "",
    name: "",
    storage_limit_mb: 500,
    max_file_size_mb: 50,
    max_files: 25,
    daily_upload_limit_mb: 100,
  });
  const [maintenanceStatus, setMaintenanceStatus] = useState(false);
  const [loadingMaintenance, setLoadingMaintenance] = useState(false);
  const [securityLogs, setSecurityLogs] = useState<SystemLog[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [createDummyDraft, setCreateDummyDraft] = useState({
    username: "",
    password: "",
    quota_id: "guest",
  });

  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  const folderPath = useMemo(() => {
    if (!activeFolderId) return [] as AdminFileFolder[];
    const chain: AdminFileFolder[] = [];
    const seen = new Set<string>();
    let currentId: string | null = activeFolderId;
    while (currentId) {
      if (seen.has(currentId)) break;
      seen.add(currentId);
      const current = folderById.get(currentId);
      if (!current) break;
      chain.unshift(current);
      currentId = current.parent_folder_id || null;
    }
    return chain;
  }, [activeFolderId, folderById]);

  const visibleFolders = useMemo(
    () => folders.filter((folder) => (folder.parent_folder_id || null) === activeFolderId),
    [activeFolderId, folders],
  );

  const visibleFiles = useMemo(
    () => files.filter((file) => (file.folder_id || null) === activeFolderId),
    [activeFolderId, files],
  );

  useEffect(() => {
    setActiveFolderId((current) =>
      current && !folders.some((folder) => folder.id === current) ? null : current,
    );
  }, [folders]);

  useEffect(() => {
    // Load maintenance status on mount
    const fetchMaintenanceStatus = async () => {
      try {
        const response = await fetch('/api/admin/maintenance/status');
        const data = await response.json();
        setMaintenanceStatus(data.maintenance_mode);
      } catch (error) {
        console.error('Failed to fetch maintenance status:', error);
      }
    };
    fetchMaintenanceStatus();
  }, []);

  useEffect(() => setLocalQuotas(quotas), [quotas]);

  const loadSecurityLogs = async () => {
    try {
      const response = await fetch('/api/admin/logs/security', { headers: adminHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load security logs.');
      setSecurityLogs(data.logs || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load security logs.');
    }
  };

  useEffect(() => {
    loadSecurityLogs().catch(() => undefined);
  }, []);

  const post = async (url: string, body?: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: adminHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Administrative action failed.");
    return data;
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
      await onReload();
      await loadSecurityLogs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Administrative action failed.");
    }
  };

  const startEditUser = (target: User) => {
    setEditingUser(target);
    setEditUser({
      username: target.username,
      email: target.email,
      role: target.role,
      status: target.status,
      password: "",
    });
  };

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    await runAction(
      () =>
        post(`/api/admin/users/${editingUser.id}/edit`, {
          ...editUser,
          password: editUser.password || undefined,
        }),
      "Account properties updated.",
    );
    setEditingUser(null);
  };

  const createDummyUser = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = createDummyDraft.username.trim();
    const password = createDummyDraft.password.trim();
    if (!username || !password) {
      toast.error("Username and password are required.");
      return;
    }

    await runAction(
      () =>
        post('/api/admin/users/create-dummy', {
          username,
          password,
          quota_id: createDummyDraft.quota_id || 'guest',
        }),
      'Dummy user account created.',
    );
    setCreateDummyDraft({
      username: "",
      password: "",
      quota_id: createDummyDraft.quota_id || "guest",
    });
  };

  const promptResetPassword = async (target: User) => {
    const nextPassword = window.prompt(`Set a new password for "${target.username}" (minimum 8 characters):`);
    if (!nextPassword) return;
    if (nextPassword.trim().length < 8) {
      toast.error("Password must contain at least 8 characters.");
      return;
    }

    await runAction(
      () =>
        post(`/api/admin/users/${target.id}/reset-password`, {
          password: nextPassword,
        }),
      "Password reset successfully.",
    );
  };

  const saveQuota = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const data = await post("/api/admin/quotas", {
        id: quotaDraft.id.trim().toLowerCase(),
        name: quotaDraft.name.trim(),
        storage_limit_bytes: quotaDraft.storage_limit_mb * 1024 * 1024,
        max_file_size_bytes: quotaDraft.max_file_size_mb * 1024 * 1024,
        max_files: quotaDraft.max_files,
        daily_upload_limit_bytes: quotaDraft.daily_upload_limit_mb * 1024 * 1024,
      });
      setLocalQuotas(data.quotas || []);
      setQuotaDraft({ id: "", name: "", storage_limit_mb: 500, max_file_size_mb: 50, max_files: 25, daily_upload_limit_mb: 100 });
      toast.success("Quota saved.");
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save quota.");
    }
  };

  const deleteQuota = async (quota: Quota) => {
    if (!window.confirm(`Delete quota "${quota.name}"?`)) return;
    let migrateToQuotaId: string | undefined;
    if (users.some((target) => target.quota_id === quota.id)) {
      migrateToQuotaId = localQuotas.find((target) => target.id !== quota.id)?.id;
      if (!migrateToQuotaId) return toast.error("No migration quota is available.");
    }
    try {
      const data = await post(`/api/admin/quotas/${quota.id}/delete`, {
        migrate_to_quota_id: migrateToQuotaId,
      });
      setLocalQuotas(data.quotas || []);
      toast.success("Quota deleted.");
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete quota.");
    }
  };

  const deleteFolder = async (folder: AdminFileFolder) => {
    if (!window.confirm(`Delete folder "${folder.name}" and its subfolders?`)) return;
    const deleteFiles = window.confirm(
      "Press OK to delete files inside the folder tree. Press Cancel to keep files and move them to the owner's root.",
    );
    await runAction(
      () => post(`/api/admin/file-folders/${folder.id}/delete`, { delete_files: deleteFiles }),
      deleteFiles
        ? "Folder tree and files deleted."
        : "Folder tree deleted and files moved to owner root.",
    );
  };

  return (
    <section className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-semibold text-[var(--accent-linear)]">
          <Terminal className="h-7 w-7 text-[var(--admin-info)]" />
          Administration
        </h1>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Practical system monitoring, audits, and configurations.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-3">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border px-5 py-2.5 ${tab === id ? "border-[var(--accent-linear)] bg-[var(--accent-linear)] text-[var(--accent-contrast)]" : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total users" value={`${stats?.totalUsers ?? users.length} registered`} color="cyan" />
            <StatCard label="Total files" value={`${stats?.totalFiles ?? files.length} stored`} color="pink" />
            <StatCard label="Storage used" value={formatBytes(stats?.storageUsedBytes || 0)} color="green" />
            <StatCard label="Blocked threats" value={`${(stats?.blockedFiles || 0) + (stats?.failedScans || 0)} blocked`} color="orange" />
          </div>
          <AdminPanel title="System overview" accent="purple">
            <p className="max-w-4xl text-sm leading-7 text-[var(--text-secondary)]">
              Review user accounts, stored files, quota limits, audit logs, security events, and
              system health from the sections above.
            </p>
          </AdminPanel>
        </div>
      )}

      {tab === "users" && (
        <AdminPanel title="User accounts" meta={`${users.length} accounts`}>
          <form onSubmit={createDummyUser} className="mb-5 grid gap-4 border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 md:grid-cols-2">
            <AdminInput
              label="Dummy username"
              value={createDummyDraft.username}
              onChange={(value) => setCreateDummyDraft({ ...createDummyDraft, username: value })}
            />
            <AdminInput
              label="Initial password"
              type="password"
              value={createDummyDraft.password}
              onChange={(value) => setCreateDummyDraft({ ...createDummyDraft, password: value })}
            />
            <AdminSelect
              label="Initial quota"
              value={createDummyDraft.quota_id}
              options={localQuotas.map((quota) => quota.id)}
              onChange={(value) => setCreateDummyDraft({ ...createDummyDraft, quota_id: value })}
            />
            <div className="flex items-end justify-end">
              <AdminButton type="submit" tone="green">Create dummy account</AdminButton>
            </div>
            <p className="md:col-span-2 text-xs text-[var(--text-muted)]">
              New account email is auto-assigned as username@dummy.local.
            </p>
          </form>

          {editingUser && (
            <form onSubmit={saveUser} className="mb-5 grid gap-4 border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 md:grid-cols-2">
              <AdminInput label="Username" value={editUser.username} onChange={(value) => setEditUser({ ...editUser, username: value })} />
              <AdminInput label="Email" type="email" value={editUser.email} onChange={(value) => setEditUser({ ...editUser, email: value })} />
              <AdminSelect label="Role" value={editUser.role} options={["User", "Admin"]} onChange={(value) => setEditUser({ ...editUser, role: value })} />
              <AdminSelect label="Status" value={editUser.status} options={["Active", "Suspended"]} onChange={(value) => setEditUser({ ...editUser, status: value })} />
              <AdminInput label="New password (optional)" type="password" value={editUser.password} onChange={(value) => setEditUser({ ...editUser, password: value })} />
              <div className="flex items-end justify-end gap-2">
                <AdminButton onClick={() => setEditingUser(null)}>Cancel</AdminButton>
                <AdminButton type="submit" tone="cyan">Save account</AdminButton>
              </div>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead><tr>{["Uploader details", "Role", "Assign quota tier", "Consumption", "Status", "Actions"].map((label) => <th key={label} className="bg-[var(--admin-header)] px-4 py-3 text-[var(--text-muted)]">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {users.map((target) => (
                  <tr key={target.id}>
                    <td className="px-4 py-3"><strong className="block">@{target.username}</strong><span className="text-[var(--text-muted)]">{target.email}</span></td>
                    <td className="px-4 py-3"><StatusBadge tone={target.role === "Admin" ? "pink" : "muted"}>{target.role}</StatusBadge></td>
                    <td className="px-4 py-3">
                      <select value={target.quota_id} onChange={(event) => runAction(() => post(`/api/admin/users/${target.id}/quota`, { quota_id: event.target.value }), "Quota updated.")} className="border border-[var(--border-subtle)] bg-[var(--admin-surface)] px-2 py-2 text-[var(--text-primary)]">
                        {localQuotas.map((quota) => <option key={quota.id} value={quota.id}>{quota.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">{formatBytes(target.storage_used)}</td>
                    <td className="px-4 py-3"><StatusBadge tone={target.status === "Active" ? "green" : "pink"}>{target.status}</StatusBadge></td>
                    <td className="space-x-2 px-4 py-3 text-right">
                      <AdminButton tone="cyan" onClick={() => startEditUser(target)}>Edit info</AdminButton>
                      <AdminButton tone="green" onClick={() => promptResetPassword(target)}>Reset password</AdminButton>
                      <AdminButton
                        tone="pink"
                        onClick={() =>
                          window.confirm(`Toggle account lock for "${target.username}"?`) &&
                          runAction(() => post(`/api/admin/users/${target.id}/suspend`), "Account status updated.")
                        }
                      >
                        Toggle lock
                      </AdminButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminPanel>
      )}

      {tab === "files" && (
        <AdminPanel title="File management" meta={`${files.length} files | ${folders.length} folders`}>
          <div className="mb-5 flex flex-wrap items-center gap-2 border border-[var(--border-subtle)] bg-[var(--admin-surface)] px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setActiveFolderId(null)}
              className={`border px-2 py-1 ${activeFolderId ? "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]" : "border-[var(--admin-border-info)] text-[var(--admin-info)]"}`}
            >
              All folders
            </button>
            {folderPath.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setActiveFolderId(folder.id)}
                className={`border px-2 py-1 ${folder.id === activeFolderId ? "border-[var(--admin-border-info)] text-[var(--admin-info)]" : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"}`}
              >
                {folder.name}
              </button>
            ))}
          </div>

          <div className="mb-5 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Folders</h3>
            {visibleFolders.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleFolders.map((folder) => (
                  <div key={folder.id} className="border border-[var(--border-subtle)] bg-[var(--admin-surface)] p-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveFolderId(folder.id)}
                      className="w-full text-left"
                    >
                      <span className="mb-2 inline-flex items-center gap-2 text-[var(--admin-info)]">
                        {(folder.parent_folder_id || null) === activeFolderId ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                        <strong>{folder.name}</strong>
                      </span>
                      <span className="block text-[var(--text-muted)]">Owner: @{folder.username}</span>
                      <span className="block text-[var(--text-muted)]">{folder.file_count} file(s)</span>
                    </button>
                    <div className="mt-3 flex justify-end">
                      <AdminButton tone="pink" onClick={() => deleteFolder(folder)}>Delete folder</AdminButton>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="border border-dashed border-[var(--border-subtle)] px-3 py-2 text-[var(--text-muted)]">
                No subfolders at this level.
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead><tr>{["Filename", "Owner", "Size", "Status", "Actions"].map((label) => <th key={label} className="bg-[var(--admin-header)] px-4 py-3 text-[var(--text-muted)]">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {visibleFiles.map((file) => (
                  <tr key={file.id}>
                    <td className="max-w-xs px-4 py-3"><strong className="block truncate">{file.original_name}</strong><span className="text-[var(--text-muted)]">{file.mime_type}</span></td>
                    <td className="px-4 py-3 text-[var(--admin-info)]">@{file.username}</td>
                    <td className="px-4 py-3">{formatBytes(file.size)}</td>
                    <td className="px-4 py-3"><StatusBadge tone={file.status === "Available" ? "green" : "pink"}>{file.status === "Available" ? "Available" : "Blocked"}</StatusBadge></td>
                    <td className="space-x-2 px-4 py-3 text-right">
                      <AdminButton
                        tone={file.status === "Available" ? "pink" : "green"}
                        onClick={() =>
                          window.confirm(`${file.status === "Available" ? "Block" : "Approve"} "${file.original_name}"?`) &&
                          runAction(() => post(`/api/admin/files/${file.id}/block`), "File status updated.")
                        }
                      >
                        {file.status === "Available" ? "Block" : "Approve"}
                      </AdminButton>
                      <AdminButton tone="pink" onClick={() => window.confirm(`Permanently delete "${file.original_name}"?`) && runAction(() => post(`/api/files/${file.id}/delete`), "File deleted.")}>Delete</AdminButton>
                    </td>
                  </tr>
                ))}
                {!visibleFiles.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                      No files in this folder.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminPanel>
      )}

      {tab === "quotas" && (
        <AdminPanel title="Storage quotas" accent="pink">
          <form onSubmit={saveQuota} className="grid gap-4 border-b border-[var(--border-subtle)] pb-6 md:grid-cols-3">
            <AdminInput label="Quota ID" value={quotaDraft.id} onChange={(value) => setQuotaDraft({ ...quotaDraft, id: value })} />
            <AdminInput label="Display name" value={quotaDraft.name} onChange={(value) => setQuotaDraft({ ...quotaDraft, name: value })} />
            <AdminNumber label="Storage limit (MB)" value={quotaDraft.storage_limit_mb} onChange={(value) => setQuotaDraft({ ...quotaDraft, storage_limit_mb: value })} />
            <AdminNumber label="Maximum file size (MB)" value={quotaDraft.max_file_size_mb} onChange={(value) => setQuotaDraft({ ...quotaDraft, max_file_size_mb: value })} />
            <AdminNumber label="Maximum file count" value={quotaDraft.max_files} onChange={(value) => setQuotaDraft({ ...quotaDraft, max_files: value })} />
            <AdminNumber label="Daily upload limit (MB)" value={quotaDraft.daily_upload_limit_mb} onChange={(value) => setQuotaDraft({ ...quotaDraft, daily_upload_limit_mb: value })} />
            <div className="md:col-span-3 flex justify-end"><AdminButton type="submit" tone="pink"><Plus className="h-3.5 w-3.5" />Save quota</AdminButton></div>
          </form>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead><tr>{["ID & name", "Total storage", "Single file cap", "Max files", "Daily bandwidth", "Attached accounts", "Actions"].map((label) => <th key={label} className="bg-[var(--admin-header)] px-4 py-3 text-[var(--text-muted)]">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {localQuotas.map((quota) => (
                  <tr key={quota.id}>
                    <td className="px-4 py-3 text-[var(--admin-info)]"><strong className="block">{quota.name}</strong><span className="text-[var(--text-muted)]">ID: {quota.id}</span></td>
                    <td className="px-4 py-3">{formatBytes(quota.storage_limit_bytes)}</td>
                    <td className="px-4 py-3">{formatBytes(quota.max_file_size_bytes)}</td>
                    <td className="px-4 py-3">{quota.max_files} files</td>
                    <td className="px-4 py-3">{formatBytes(quota.daily_upload_limit_bytes)}</td>
                    <td className="px-4 py-3"><StatusBadge tone="green">{users.filter((target) => target.quota_id === quota.id).length} accounts</StatusBadge></td>
                    <td className="space-x-2 px-4 py-3 text-right">
                      <AdminButton tone="cyan" onClick={() => setQuotaDraft({ id: quota.id, name: quota.name, storage_limit_mb: Math.round(quota.storage_limit_bytes / 1048576), max_file_size_mb: Math.round(quota.max_file_size_bytes / 1048576), max_files: quota.max_files, daily_upload_limit_mb: Math.round(quota.daily_upload_limit_bytes / 1048576) })}>Edit</AdminButton>
                      <AdminButton tone="pink" onClick={() => deleteQuota(quota)}>Delete</AdminButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminPanel>
      )}

      {tab === "logs" && <LogPanel title="Audit logs" logs={logs} />}
      {tab === "security" && <LogPanel title="Security events" logs={securityLogs} security />}
      {tab === "health" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <AdminPanel title="System resource usage">
            <div className="grid gap-4 sm:grid-cols-2">
              <HealthMetric icon={<Activity />} label="CPU load" value={`${Math.round(stats?.cpuUsagePercent || 0)}%`} />
              <HealthMetric icon={<Database />} label="Memory usage" value={`${stats?.memoryUsagePercent || 0}%`} />
              <HealthMetric icon={<Server />} label="Disk usage" value={`${stats?.diskUsagePercent || 0}%`} />
              <HealthMetric icon={<Users />} label="Uptime" value={formatUptime(stats?.uptime)} />
            </div>
          </AdminPanel>
          <AdminPanel title="System details" accent="pink">
            <p className="text-sm leading-7 text-[var(--text-secondary)]">
              Memory: {formatBytes((stats?.memoryUsedMB || 0) * 1048576)} / {formatBytes((stats?.memoryTotalMB || 0) * 1048576)}
              <br />Disk: {stats?.diskUsedGB || 0} GB / {stats?.diskTotalGB || 0} GB
              <br />Failed scans: {stats?.failedScans || 0}
              <br />Blocked files: {stats?.blockedFiles || 0}
            </p>
          </AdminPanel>
        </div>
      )}
      {tab === "maintenance" && (
        <div className="grid gap-6">
          <MaintenanceModeControl 
            currentStatus={maintenanceStatus}
            onStatusChange={(newStatus) => {
              setMaintenanceStatus(newStatus);
              onReload();
            }}
          />
        </div>
      )}
    </section>
  );
}

function AdminPanel({ title, meta, accent = "cyan", children }: { title: string; meta?: string; accent?: "cyan" | "pink" | "purple"; children: React.ReactNode }) {
  const accents = { cyan: "border-[var(--admin-border-info)]", pink: "border-[var(--admin-border-critical)]", purple: "border-[var(--admin-border-secondary)]" };
  return <div className={`border-2 bg-[var(--bg-panel)] p-6 shadow-[var(--admin-panel-shadow)] ${accents[accent]}`}><div className="mb-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3"><h2 className="text-sm font-semibold">{title}</h2>{meta && <span className="text-xs text-[var(--text-muted)]">{meta}</span>}</div>{children}</div>;
}

function StatCard({ label, value, color }: { label: string; value: string; color: "cyan" | "pink" | "green" | "orange" }) {
  const colors = { cyan: "border-[var(--admin-border-info)]", pink: "border-[var(--admin-border-critical)]", green: "border-[var(--admin-border-success)]", orange: "border-[var(--admin-border-warning)]" };
  return <div className={`border-2 bg-[var(--bg-panel)] p-5 shadow-[var(--admin-panel-shadow)] ${colors[color]}`}><span className="text-xs text-[var(--text-muted)]">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>;
}

function AdminButton({ children, tone = "muted", type = "button", onClick }: { children: React.ReactNode; tone?: "muted" | "cyan" | "pink" | "green"; type?: "button" | "submit"; onClick?: () => void }) {
  const tones = { muted: "border-[var(--border-subtle)] text-[var(--text-muted)]", cyan: "border-[var(--admin-border-info)] text-[var(--admin-info)]", pink: "border-[var(--admin-border-critical)] text-[var(--admin-critical)]", green: "border-[var(--admin-border-success)] text-[var(--admin-success)]" };
  return <button type={type} onClick={onClick} className={`inline-flex items-center gap-1.5 border px-3 py-2 hover:bg-[var(--bg-hover)] ${tones[tone]}`}>{children}</button>;
}

function StatusBadge({ tone, children }: { tone: "green" | "pink" | "muted"; children: React.ReactNode }) {
  const tones = { green: "border-[var(--admin-border-success)] text-[var(--admin-success)]", pink: "border-[var(--admin-border-critical)] text-[var(--admin-critical)]", muted: "border-[var(--border-subtle)] text-[var(--text-muted)]" };
  return <span className={`inline-flex border px-2 py-1 text-[10px] font-bold uppercase ${tones[tone]}`}>{children}</span>;
}

function AdminInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label><span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" /></label>;
}

function AdminNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <AdminInput label={label} type="number" value={String(value)} onChange={(next) => onChange(Number(next))} />;
}

function AdminSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[var(--text-primary)]">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function LogPanel({ title, logs, security = false }: { title: string; logs: SystemLog[]; security?: boolean }) {
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);

  const emptyMessage = security
    ? "No security events found yet. Trigger a scan block, lockout, or other security action to populate this view."
    : "No matching events.";
  return <AdminPanel title={title} accent={security ? "pink" : "cyan"}><div className="space-y-3"><div className="max-h-[520px] space-y-3 overflow-y-auto border border-[var(--border-subtle)] bg-[var(--admin-surface)] p-4">{logs.length ? logs.map((log) => <button key={log.id} type="button" onClick={() => setSelectedLog(log)} className="w-full border-b border-[var(--border-subtle)] pb-3 text-left text-xs hover:bg-[var(--bg-hover)]"><div className={`mb-1 flex justify-between ${security ? "text-[var(--admin-critical)]" : "text-[var(--text-muted)]"}`}><span>{new Date(log.created_at).toLocaleString()} | IP: {log.ip_address}</span>{!security && <span>[{log.event_type}]</span>}</div><p className={security ? "text-[var(--admin-critical)]" : "text-[var(--text-secondary)]"}><strong>@{log.username || "System"}:</strong> {log.message}</p></button>) : <p className="py-8 text-center text-xs text-[var(--text-muted)]">{emptyMessage}</p>}</div></div>{selectedLog && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedLog(null); }}><div className="w-full max-w-2xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5" onPointerDown={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3"><h3 className="text-sm font-semibold">Log details</h3><button type="button" onClick={() => setSelectedLog(null)} className="border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">Close</button></div><div className="grid gap-2 text-xs text-[var(--text-secondary)]"><p><strong>ID:</strong> {selectedLog.id}</p><p><strong>Event type:</strong> {selectedLog.event_type}</p><p><strong>Target type:</strong> {selectedLog.target_type}</p><p><strong>Target ID:</strong> {selectedLog.target_id}</p><p><strong>User:</strong> @{selectedLog.username || "System"}</p><p><strong>User ID:</strong> {selectedLog.user_id || "N/A"}</p><p><strong>IP:</strong> {selectedLog.ip_address}</p><p><strong>Created:</strong> {new Date(selectedLog.created_at).toLocaleString()}</p><p className="mt-2 whitespace-pre-wrap border border-[var(--border-subtle)] bg-[var(--admin-surface)] p-3"><strong>Message:</strong><br />{selectedLog.message}</p></div></div></div>}</AdminPanel>;
}

function HealthMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="border border-[var(--border-subtle)] bg-[var(--admin-surface)] p-4"><div className="mb-3 h-4 w-4 text-[var(--admin-info)]">{icon}</div><span className="text-xs text-[var(--text-muted)]">{label}</span><strong className="mt-1 block text-xl text-[var(--text-primary)]">{value}</strong></div>;
}
