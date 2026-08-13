/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Quota {
  id: string;
  name: string;
  storage_limit_bytes: number;
  max_file_size_bytes: number;
  max_files: number;
  daily_upload_limit_bytes: number;
}

export interface User {
  id: string;
  email: string;
  username: string;
  role: 'User' | 'Admin';
  quota_id: string;
  storage_used: number;
  files_used?: number;
  status: 'Active' | 'Suspended';
  created_at: string;
}

export interface FileMetadata {
  id: string;
  owner_user_id: string;
  username: string;
  folder_id: string | null;
  folder_name: string | null;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  encrypted_size: number;
  status: 'Available' | 'Blocked';
  checksum: string;
  leeku_vibe: string; // Funny approve comments
  is_encrypted: boolean;
  has_user_secret: boolean;
  preview_kind: 'text' | 'csv' | null;
  preview_available: boolean;
  preview_max_bytes: number;
  created_at: string;
}

export interface FileFolder {
  id: string;
  owner_user_id: string;
  parent_folder_id: string | null;
  name: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminFileFolder extends FileFolder {
  username: string;
}

export interface ShareLink {
  id: string;
  file_id: string;
  public_token: string;
  allow_external_preview?: boolean;
  allow_decrypted_external_preview?: boolean;
  password?: string; // Optional password
  expires_at: string | null; // expiration date
  max_downloads: number | null;
  download_count: number;
  is_active: boolean;
  is_available?: boolean;
  created_at: string;
}

export interface FolderShareLink {
  id: string;
  folder_id: string;
  public_token: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ActiveSession {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  is_current: boolean;
}

export interface SystemLog {
  id: string;
  user_id: string | null;
  username: string | null;
  event_type: 'Upload' | 'Scan' | 'Delete' | 'Download' | 'Link' | 'Admin' | 'Security' | 'Auth';
  target_type: string;
  target_id: string;
  ip_address: string;
  message: string;
  created_at: string;
}

export interface SystemStats {
  totalUsers: number;
  totalFiles: number;
  storageUsedBytes: number;
  uploadsToday: number;
  blockedFiles: number;
  failedScans: number;
  // Windows Server 2022 System Health
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  memoryUsedMB?: number;
  memoryTotalMB?: number;
  diskUsagePercent?: number;
  diskUsedGB?: number;
  diskTotalGB?: number;
  uptime?: number;
}
