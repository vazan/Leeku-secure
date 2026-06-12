import { useEffect, useMemo, useState } from "react";
import { Activity, Database, Plus, Server, ShieldAlert, Terminal, Users } from "lucide-react";
import { toast } from "sonner";
import type { FileMetadata, Quota, SystemLog, SystemStats, User } from "@/app/shared/types";

type AdminTab = "overview" | "users" | "files" | "quotas" | "logs" | "security" | "health";

const tabs: Array<[AdminTab, string]> = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["files", "Files"],
  ["quotas", "Quotas"],
  ["logs", "Logs"],
  ["security", "Security Events"],
  ["health", "System Health"],
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
  logs,
  stats,
  quotas,
  onReload,
}: {
  users: User[];
  files: FileMetadata[];
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

  useEffect(() => setLocalQuotas(quotas), [quotas]);

  const securityLogs = useMemo(
    () =>
      logs.filter(
        (log) =>
          log.event_type === "Security" ||
          log.event_type === "Scan" ||
          /reject|blocked|malware|threat/i.test(log.message),
      ),
    [logs],
  );

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
        <AdminPanel title="File management" meta={`${files.length} files`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead><tr>{["Filename", "Owner", "Size", "Status", "Actions"].map((label) => <th key={label} className="bg-[var(--admin-header)] px-4 py-3 text-[var(--text-muted)]">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {files.map((file) => (
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
  return <label><span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span><input required type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" /></label>;
}

function AdminNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <AdminInput label={label} type="number" value={String(value)} onChange={(next) => onChange(Number(next))} />;
}

function AdminSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[var(--text-primary)]">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function LogPanel({ title, logs, security = false }: { title: string; logs: SystemLog[]; security?: boolean }) {
  return <AdminPanel title={title} accent={security ? "pink" : "cyan"}><div className="max-h-[520px] space-y-3 overflow-y-auto border border-[var(--border-subtle)] bg-[var(--admin-surface)] p-4">{logs.length ? logs.map((log) => <div key={log.id} className="border-b border-[var(--border-subtle)] pb-3 text-xs"><div className={`mb-1 flex justify-between ${security ? "text-[var(--admin-critical)]" : "text-[var(--text-muted)]"}`}><span>{new Date(log.created_at).toLocaleString()} | IP: {log.ip_address}</span><span>[{security ? "Threat detected" : log.event_type}]</span></div><p className={security ? "text-[var(--admin-critical)]" : "text-[var(--text-secondary)]"}><strong>@{log.username || "System"}:</strong> {log.message}</p></div>) : <p className="py-8 text-center text-xs text-[var(--text-muted)]">No matching events.</p>}</div></AdminPanel>;
}

function HealthMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="border border-[var(--border-subtle)] bg-[var(--admin-surface)] p-4"><div className="mb-3 h-4 w-4 text-[var(--admin-info)]">{icon}</div><span className="text-xs text-[var(--text-muted)]">{label}</span><strong className="mt-1 block text-xl text-[var(--text-primary)]">{value}</strong></div>;
}
