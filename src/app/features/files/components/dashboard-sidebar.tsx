import type { ReactNode } from "react";
import { Folder, FolderOpen, ChevronRight, ChevronDown, LogOut } from "lucide-react";
import type { User, FileFolder } from "@/app/shared/types";
import { useMemo, useState, useEffect } from "react";

export type DashboardView = "home" | "files" | "shared" | "settings" | "admin";
export type DashboardNavItem = [DashboardView, ReactNode, string];

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default function DashboardSidebar({
  user,
  view,
  navItems,
  storageLimit,
  folders,
  onView,
  onLogout,
  folderPath,
  onNavigateFolder,
}: {
  user: User;
  view: DashboardView;
  navItems: DashboardNavItem[];
  storageLimit: number;
  folders: FileFolder[];
  onView: (view: DashboardView) => void;
  onLogout: () => void;
  folderPath: FileFolder[];
  onNavigateFolder: (folderId: string | null) => void;
}) {
  const storagePercent = Math.min(100, (user.storage_used / storageLimit) * 100);

  // Get root folders (no parent) for sidebar display
  const rootFolders = useMemo(() => {
    return folders.filter((folder) => !folder.parent_folder_id).sort((a, b) => a.name.localeCompare(b.name));
  }, [folders]);

  // Track expanded folders (for tree view)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Expand all folders in the current path when folderPath changes
  useEffect(() => {
    if (folderPath.length > 0) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        // Add all folders in the path to expanded (except the last one which is the current folder)
        for (let i = 0; i < folderPath.length - 1; i++) {
          next.add(folderPath[i].id);
        }
        return next;
      });
    }
  }, [folderPath]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // Get the currently active folder id (last in path)
  const activeFolderId = useMemo(() => {
    if (folderPath.length === 0) return null;
    return folderPath[folderPath.length - 1]?.id || null;
  }, [folderPath]);

  // Recursively render folder tree with indentation and expand/collapse
  const renderFolderNode = (folder: FileFolder, depth: number) => {
    const isExpanded = expandedFolders.has(folder.id);
    const hasChildren = folders.some((f) => f.parent_folder_id === folder.id);

    return (
      <div key={folder.id}>
        <button
          onClick={() => {
            toggleFolder(folder.id);
            onNavigateFolder(folder.id);
          }}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            activeFolderId === folder.id
              ? "bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
          style={{ paddingLeft: `${depth * 0.75 + 0.75}rem` }}
        >
          <span className="min-w-[1rem] text-center">
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )
            ) : (
              <span className="w-3.5" />
            )}
          </span>
          <span className="min-w-[1rem]">
            {isExpanded ? (
              <FolderOpen className="h-4 w-4" />
            ) : (
              <Folder className="h-4 w-4" />
            )}
          </span>
          <span className="truncate">{folder.name}</span>
        </button>
        {isExpanded && hasChildren && (
          <div className="space-y-1">
            {folders
              .filter((f) => f.parent_folder_id === folder.id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((childFolder) => renderFolderNode(childFolder, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      data-dashboard-sidebar
      className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 lg:flex lg:flex-col"
    >
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
      <nav className="mt-8 space-y-1">
        {navItems.map(([id, icon, label]) => (
          <button
            key={id}
            onClick={() => onView(id)}
            aria-current={view === id ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${view === id ? "bg-[var(--bg-hover)] font-medium" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"}`}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
        <div className="mt-6 border-t border-[var(--border-subtle)] pt-4">
          <h3 className="mb-3 px-3 text-xs font-semibold uppercase text-[var(--text-muted)]">
            Folders
          </h3>
          <div className="space-y-1">
            {/* All Files root - only show when not already at root level */}
            <button
              onClick={() => onNavigateFolder(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                folderPath.length === 0
                  ? "bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Folder className="h-4 w-4" />
              <span>All Files</span>
            </button>
            {/* Render folder tree starting from root folders */}
            {rootFolders.map((folder) => renderFolderNode(folder, 0))}
          </div>
        </div>
      </div>
      <div className="mt-6 border-t border-[var(--border-subtle)] pt-4 shrink-0">
        <div className="mb-4 rounded-xl border border-[var(--border-subtle)] p-3">
          <div className="mb-2 text-xs">
            <span className="text-[var(--text-muted)]">Storage</span>
            <span className="mt-1 block text-[var(--text-secondary)]">
              {formatBytes(user.storage_used)} / {formatBytes(storageLimit)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              className="h-full rounded-full bg-[var(--accent-linear)]"
              style={{ width: `${storagePercent}%` }}
            />
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}
