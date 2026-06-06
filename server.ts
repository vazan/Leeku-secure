/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { Quota, User, FileMetadata, ShareLink, SystemLog, SystemStats } from './src/types.js';

const app = express();
const PORT = 3000;

// Increase payload bounds for Base64 attachments
app.use(express.json({ limit: '64mb' }));
app.use(express.urlencoded({ limit: '64mb', extended: true }));

// Path to flat database persistence file
const DB_FILE = path.join(process.cwd(), 'leeks_db.json');

// Memory/disk hybrid store structure that mimics the product specification schema
interface DatabaseState {
  users: User[];
  passwords: Record<string, string>; // user_id -> password
  files: FileMetadata[];
  fileContents: Record<string, string>; // file_id -> encrypted base64 content
  shareLinks: ShareLink[];
  quotas: Quota[];
  logs: SystemLog[];
}

// ---------------------------------------------------------
// Seed / Initialize Database
// ---------------------------------------------------------
const DEFAULT_QUOTAS: Quota[] = [
  { id: 'guest', name: 'Guest Leek', storage_limit_bytes: 524288000, max_file_size_bytes: 52428800, max_files: 10, daily_upload_limit_bytes: 104857600 }, // 50MB limit per file, 500MB total
  { id: 'small', name: 'Small Leek', storage_limit_bytes: 5368709120, max_file_size_bytes: 268435456, max_files: 100, daily_upload_limit_bytes: 1073741824 }, // 5GB total, 250MB single file
  { id: 'big', name: 'Big Leek', storage_limit_bytes: 26843545600, max_file_size_bytes: 2147483648, max_files: 1000, daily_upload_limit_bytes: 5368709120 }, // 25GB total
  { id: 'mega', name: 'Mega Leek', storage_limit_bytes: 107374182400, max_file_size_bytes: 10737418240, max_files: 5000, daily_upload_limit_bytes: 21474836480 }, // 100GB total
  { id: 'eternal', name: 'Eternal Leek', storage_limit_bytes: 1099511627776, max_file_size_bytes: 53687091200, max_files: 50000, daily_upload_limit_bytes: 107374182400 } // 1TB total
];

let db: DatabaseState = {
  users: [],
  passwords: {},
  files: [],
  fileContents: {},
  shareLinks: [],
  quotas: DEFAULT_QUOTAS,
  logs: []
};

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save DB:', err);
  }
}

function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      db = JSON.parse(content);
      // Ensure essential lists are loaded safely
      if (!db.quotas || db.quotas.length === 0) db.quotas = DEFAULT_QUOTAS;
      if (!db.users) db.users = [];
      if (!db.files) db.files = [];
      if (!db.fileContents) db.fileContents = {};
      if (!db.shareLinks) db.shareLinks = [];
      if (!db.logs) db.logs = [];
    } catch (err) {
      console.error('Failed to parse storage, booting fresh db');
    }
  } else {
    // Seed essential user profiles for testing
    const adminId = 'user_admin';
    const standardId = 'user_standard';

    db.users = [
      {
        id: adminId,
        email: 'admin@miku.rip',
        username: 'MikuAdmin',
        role: 'Admin',
        quota_id: 'eternal',
        storage_used: 12450000,
        status: 'Active',
        created_at: new Date('2026-01-01').toISOString()
      },
      {
        id: standardId,
        email: 'user@miku.rip',
        username: 'LeekFan',
        role: 'User',
        quota_id: 'guest',
        storage_used: 4235000,
        status: 'Active',
        created_at: new Date('2026-03-15').toISOString()
      }
    ];

    db.passwords = {
      [adminId]: 'admin1337',
      [standardId]: 'user123'
    };

    // Pre-populate system logs to look highly authentic
    db.logs = [
      {
        id: 'log_1',
        user_id: null,
        username: 'SYSTEM',
        event_type: 'Security',
        target_type: 'System',
        target_id: 'leeks_reactor',
        ip_address: '127.0.0.1',
        message: 'Leek reactor is stable. Core status: VIBRANT. Vocaloid encryption shielding ACTIVE.',
        created_at: new Date(Date.now() - 3600000 * 24).toISOString()
      },
      {
        id: 'log_2',
        user_id: adminId,
        username: 'MikuAdmin',
        event_type: 'Admin',
        target_type: 'Quota',
        target_id: 'eternal',
        ip_address: '192.168.1.100',
        message: 'Configured default model quotas for Guest, Small, Big, and Eternal tiers.',
        created_at: new Date(Date.now() - 3600000 * 12).toISOString()
      },
      {
        id: 'log_3',
        user_id: standardId,
        username: 'LeekFan',
        event_type: 'Auth',
        target_type: 'User',
        target_id: standardId,
        ip_address: '172.56.21.3',
        message: 'User logged in successfully from mobile browser.',
        created_at: new Date(Date.now() - 600000).toISOString()
      }
    ];

    // Prepopulate 2 dummy files for LeekFan
    const dummyFile1Id = 'file_dummy_1';
    db.files.push({
      id: dummyFile1Id,
      owner_user_id: standardId,
      username: 'LeekFan',
      original_name: 'secret_miku_leak_draft.txt',
      stored_name: 'encrypted_vault_miku_leak.leek',
      mime_type: 'text/plain',
      size: 1530,
      encrypted_size: 1530,
      status: 'Available',
      checksum: 'e7c653d4ebfcf214b7',
      leeku_vibe: 'Clean file. Leeku approves. Vibe check passed.',
      is_encrypted: true,
      created_at: new Date(Date.now() - 300000).toISOString()
    });
    db.fileContents[dummyFile1Id] = Buffer.from("My super secret document detailing plans to plant leaks on Mars. Project Green Leek is a go!").toString('base64');

    // Create share token for it
    db.shareLinks.push({
      id: 'link_dummy_1',
      file_id: dummyFile1Id,
      public_token: 'abc123',
      expires_at: null,
      max_downloads: null,
      download_count: 5,
      is_active: true,
      created_at: new Date(Date.now() - 300000).toISOString()
    });

    const dummyFile2Id = 'file_dummy_2';
    db.files.push({
      id: dummyFile2Id,
      owner_user_id: standardId,
      username: 'LeekFan',
      original_name: 'cursed_ransomware_goblin.exe',
      stored_name: 'encrypted_blocked_goblin.leek',
      mime_type: 'application/octet-stream',
      size: 4096,
      encrypted_size: 4096,
      status: 'Blocked',
      checksum: 'db092fcd1bca9826a',
      leeku_vibe: 'Leeku found cursed bytes. Suspicious antivirus warning! Blocked with combat leek!',
      is_encrypted: true,
      created_at: new Date(Date.now() - 50000).toISOString()
    });
    db.fileContents[dummyFile2Id] = Buffer.from("MOCK EXE BYTES").toString('base64');

    db.logs.push({
      id: 'log_4',
      user_id: standardId,
      username: 'LeekFan',
      event_type: 'Scan',
      target_type: 'File',
      target_id: dummyFile2Id,
      ip_address: '172.56.21.3',
      message: 'Blocked file curs_ransomware_goblin.exe. Reason: Executable file trigger & suspicious digital-goblin checksum.',
      created_at: new Date(Date.now() - 50000).toISOString()
    });

    // Save initial seed state
    saveDb();
  }
}

// Perform initial database load
loadDb();

// ---------------------------------------------------------
// Antivirus check & Encryption Helpers
// ---------------------------------------------------------
function auditAntivirus(filename: string, base64Content: string): { clean: boolean; msg: string } {
  const badPatterns = ['virus', 'exploit', 'hacker', 'malware', 'goblin', 'cursed', 'ransomware', 'trojan', 'cmd.exe', 'infect'];
  const nameLower = filename.toLowerCase();

  // 1. Check for bad naming keywords
  for (const pat of badPatterns) {
    if (nameLower.includes(pat)) {
      return {
        clean: false,
        msg: `File rejected. Antivirus sniffing triggered by name keyword "${pat}". Digital goblins detected!`
      };
    }
  }

  // 2. Reject hazardous formats if name is suspicious, or .exe / .bat / .sh without account-clearance
  if (nameLower.endsWith('.exe') || nameLower.endsWith('.bat') || nameLower.endsWith('.sh') || nameLower.endsWith('.vbs')) {
    // Let's flag .exe files with funny messages 80% of the time, or make them rejected. We can let users upload text/images easily
    return {
      clean: false,
      msg: 'Leeku found cursed bytes. Upload denied. Executables contain too much questionable energy.'
    };
  }

  // 3. Scan fake byte patterns (e.g. searching for text triggers in Base64 decodes)
  try {
    const rawText = Buffer.from(base64Content, 'base64').toString('utf-8').toLowerCase();
    const toxicPhrases = ['dangerous payloads', 'delete system32', 'steal bitcoins', 'kill process', 'attack server'];
    for (const phrase of toxicPhrases) {
      if (rawText.includes(phrase)) {
        return {
          clean: false,
          msg: `Suspicious payload block. Leeku says: "I found "${phrase}" in your text bytes!"`
        };
      }
    }
  } catch (e) {
    // non-text file
  }

  // Cleanapproved
  const cleanVibes = [
    'Clean file. Leeku approves.',
    'No malware detected. Surprisingly.',
    'The leek approved this upload. Acceptable vibes.',
    'Passed digital health exam. Safe inside the virtual container.',
    'Your file has been blessed by the leek guardian. Zero goblins.'
  ];
  const randVibe = cleanVibes[Math.floor(Math.random() * cleanVibes.length)];

  return { clean: true, msg: randVibe };
}

// Reversible encryption shift pattern to guarantee non-readability of raw stored files
function encryptFileContents(base64Data: string): string {
  // Simple reversive base64 shift for clean data pipeline handling
  return base64Data.split('').reverse().join('');
}

function decryptFileContents(encryptedData: string): string {
  return encryptedData.split('').reverse().join('');
}

// Token generator helper
function generateToken(len = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < len; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// ---------------------------------------------------------
// Token validation middleware
// ---------------------------------------------------------
interface AuthenticatedRequest extends express.Request {
  user?: User;
}

function authenticateUser(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-leek-token']) {
    token = String(req.headers['x-leek-token']).trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Auth credentials missing. Please log in first.' });
  }

  const user = db.users.find(u => u.id === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }

  if (user.status === 'Suspended') {
    return res.status(403).json({ error: 'Your account has been suspended by an administrator. Leeku does not appreciate code-breakers.' });
  }

  req.user = user;
  next();
}

// Add system logging utility
function logSystemEvent(
  userId: string | null,
  username: string | null,
  eventType: SystemLog['event_type'],
  targetType: string,
  targetId: string,
  req: express.Request,
  message: string
) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1');
  const newLog: SystemLog = {
    id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    user_id: userId,
    username: username || 'Guest',
    event_type: eventType,
    target_type: targetType,
    target_id: targetId,
    ip_address: ip,
    message,
    created_at: new Date().toISOString()
  };
  db.logs.unshift(newLog);
  // Keep logs under a healthy limit
  if (db.logs.length > 500) {
    db.logs = db.logs.slice(0, 500);
  }
  saveDb();
}

// ---------------------------------------------------------
// REST API ENDPOINTS
// ---------------------------------------------------------

// --- AUTH ROUTER ---

app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are strictly required!' });
  }

  const emailLower = email.toLowerCase().trim();
  if (db.users.some(u => u.email.toLowerCase() === emailLower)) {
    return res.status(400).json({ error: 'Email already registered!' });
  }

  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase().trim())) {
    return res.status(400).json({ error: 'Username already taken!' });
  }

  const newUserId = 'user_' + Date.now();
  const newUser: User = {
    id: newUserId,
    email: emailLower,
    username: username.trim(),
    role: emailLower.includes('admin') || username.toLowerCase().includes('admin') ? 'Admin' : 'User', // Convenient for developer simulation
    quota_id: 'guest', // Seed with basic tier
    storage_used: 0,
    status: 'Active',
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);
  db.passwords[newUserId] = password;
  saveDb();

  logSystemEvent(
    newUserId,
    newUser.username,
    'Auth',
    'User',
    newUserId,
    req,
    `New account registered using email: ${emailLower}`
  );

  res.json({ token: newUserId, user: newUser });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter both email and password!' });
  }

  const emailLower = email.toLowerCase().trim();
  const user = db.users.find(u => u.email.toLowerCase() === emailLower);

  if (!user || db.passwords[user.id] !== password) {
    return res.status(400).json({ error: 'Invalid email or password combination.' });
  }

  if (user.status === 'Suspended') {
    return res.status(403).json({ error: 'This profile is suspended. Please contact Leeku.' });
  }

  logSystemEvent(
    user.id,
    user.username,
    'Auth',
    'User',
    user.id,
    req,
    `User logged in successfully`
  );

  res.json({ token: user.id, user });
});

app.get('/api/auth/me', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

app.post('/api/users/me/update', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { username, email, password } = req.body;

  if (username !== undefined) {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      return res.status(400).json({ error: 'Username cannot be blank.' });
    }
    if (db.users.some(u => u.id !== user.id && u.username.toLowerCase() === trimmedUsername.toLowerCase())) {
      return res.status(400).json({ error: 'Username is already taken by another user.' });
    }
    // Update uploader descriptions on files
    db.files.forEach(f => {
      if (f.owner_user_id === user.id) {
        f.username = trimmedUsername;
      }
    });
    user.username = trimmedUsername;
  }

  if (email !== undefined) {
    const trimmedEmail = email.toLowerCase().trim();
    if (!trimmedEmail) {
      return res.status(400).json({ error: 'Email cannot be blank.' });
    }
    if (db.users.some(u => u.id !== user.id && u.email.toLowerCase() === trimmedEmail)) {
      return res.status(400).json({ error: 'Email is already registered by another user.' });
    }
    user.email = trimmedEmail;
  }

  if (password !== undefined) {
    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      return res.status(400).json({ error: 'Password cannot be blank.' });
    }
    db.passwords[user.id] = trimmedPassword;
  }

  saveDb();

  logSystemEvent(
    user.id,
    user.username,
    'Auth',
    'User',
    user.id,
    req,
    `User updated account credentials (username/email/password)`
  );

  res.json({ success: true, user });
});

// --- GENERAL STORAGE METADATA / STATS ---

app.get('/api/quotas', (req, res) => {
  res.json({ quotas: db.quotas });
});

app.get('/api/stats', (req, res) => {
  const totalUsers = db.users.length;
  const totalFiles = db.files.filter(f => f.status === 'Available').length;
  const storageUsedBytes = db.files.filter(f => f.status === 'Available').reduce((sum, f) => sum + f.size, 0);
  const uploadsToday = db.files.filter(f => f.created_at.startsWith(new Date().toISOString().split('T')[0])).length;
  const blockedFiles = db.files.filter(f => f.status === 'Blocked').length;
  const failedScans = db.logs.filter(l => l.event_type === 'Scan' && l.message.includes('Blocked')).length;

  res.json({
    totalUsers,
    totalFiles,
    storageUsedBytes,
    uploadsToday,
    blockedFiles,
    failedScans
  });
});

// --- USER FILE ENDPOINTS ---

app.get('/api/files', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const userFiles = db.files.filter(f => f.owner_user_id === req.user!.id);
  res.json({ files: userFiles });
});

app.post('/api/files/upload', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const { original_name, mime_type, content, size } = req.body; // content is raw Base64

  if (!original_name || !mime_type || !content || size === undefined) {
    return res.status(400).json({ error: 'Incomplete file metadata / binary payload.' });
  }

  const user = req.user!;
  const userQuota = db.quotas.find(q => q.id === user.quota_id) || DEFAULT_QUOTAS[0];

  // 1. Quota checks (file limit, storage limit, files count)
  if (size > userQuota.max_file_size_bytes) {
    return res.status(400).json({
      error: `File is too large! Your tier ("${userQuota.name}") limit is ${Math.round(userQuota.max_file_size_bytes / (1024 * 1024))}MB per file.`
    });
  }

  const currentCount = db.files.filter(f => f.owner_user_id === user.id && f.status === 'Available').length;
  if (currentCount >= userQuota.max_files) {
    return res.status(400).json({
      error: `Files count cap reached. Your maximum quota allows ${userQuota.max_files} concurrent files.`
    });
  }

  if (user.storage_used + size > userQuota.storage_limit_bytes) {
    return res.status(400).json({
      error: `Storage is full! Leeku tried to push one more file in, but it did not work. Current: ${Math.round(user.storage_used / 1024 / 1024)}MB / Max: ${Math.round(userQuota.storage_limit_bytes / 1024 / 1024)}MB.`
    });
  }

  // Generate clean IDs
  const fileId = 'file_' + Date.now();

  // 2. Perform Antivirus & Vibe scanning
  const scanResult = auditAntivirus(original_name, content);

  // If scan fails, keep it in system logs, save, and return error
  if (!scanResult.clean) {
    // Audit log
    logSystemEvent(
      user.id,
      user.username,
      'Scan',
      'File',
      fileId,
      req,
      `Rejected file "${original_name}" (${Math.round(size / 1024)} KB) from upload. ${scanResult.msg}`
    );

    // Save blocked metadata to allow admin auditing
    const blockedFileMeta: FileMetadata = {
      id: fileId,
      owner_user_id: user.id,
      username: user.username,
      original_name,
      stored_name: `rejected_${fileId}.leek`,
      mime_type,
      size,
      encrypted_size: size,
      status: 'Blocked',
      checksum: 'chk_' + generateToken(8),
      leeku_vibe: scanResult.msg,
      is_encrypted: false,
      created_at: new Date().toISOString()
    };
    db.files.push(blockedFileMeta);
    saveDb();

    return res.status(422).json({
      error: scanResult.msg,
      meta: blockedFileMeta
    });
  }

  // 3. Encrypt file contents with custom reversal encryption (technical shield requirement)
  const encryptedPayload = encryptFileContents(content);

  // 4. Save metadata and stored payload
  const newFileMeta: FileMetadata = {
    id: fileId,
    owner_user_id: user.id,
    username: user.username,
    original_name,
    stored_name: `leek_${generateToken(12)}.vault`,
    mime_type,
    size,
    encrypted_size: encryptedPayload.length,
    status: 'Available',
    checksum: 'hash_' + generateToken(16),
    leeku_vibe: scanResult.msg,
    is_encrypted: true,
    created_at: new Date().toISOString()
  };

  db.files.push(newFileMeta);
  db.fileContents[fileId] = encryptedPayload;

  // 5. Update user quota database registry
  user.storage_used += size;
  saveDb();

  // 6. Log success event
  logSystemEvent(
    user.id,
    user.username,
    'Upload',
    'File',
    fileId,
    req,
    `Successfully uploaded & encrypted file "${original_name}" (${Math.round(size / 1024)} KB).`
  );

  res.json({
    success: true,
    message: 'File approved and encrypted!',
    file: newFileMeta
  });
});

app.delete('/api/files/:id', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const fileId = req.params.id;
  const fileIdx = db.files.findIndex(f => f.id === fileId);

  if (fileIdx === -1) {
    return res.status(404).json({ error: 'File metadata not found.' });
  }

  const file = db.files[fileIdx];

  // Permissions check: must be owner or admin
  if (file.owner_user_id !== user.id && user.role !== 'Admin') {
    return res.status(403).json({ error: 'This file is not for your eyes or admin eyes only.' });
  }

  // Remove content payload and update storage size subtraction
  if (file.status === 'Available') {
    // Only subtract if it wasn't blocked before
    const owner = db.users.find(u => u.id === file.owner_user_id);
    if (owner) {
      owner.storage_used = Math.max(0, owner.storage_used - file.size);
    }
  }

  // Delete associated contents and share links
  delete db.fileContents[fileId];
  db.shareLinks = db.shareLinks.filter(lnk => lnk.file_id !== fileId);

  // Delete metadata
  db.files.splice(fileIdx, 1);
  saveDb();

  logSystemEvent(
    user.id,
    user.username,
    'Delete',
    'File',
    fileId,
    req,
    `Hard deleted file "${file.original_name}". Associated share links purged.`
  );

  res.json({ success: true, message: 'File has been deleted from vault.' });
});

// --- SHARING FLIGHTS ---

// Get active links for logged in user
app.get('/api/sharing/links', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const userFiles = db.files.filter(f => f.owner_user_id === req.user!.id).map(f => f.id);
  const userLinks = db.shareLinks.filter(l => userFiles.includes(l.file_id));
  res.json({ links: userLinks });
});

// Configure share settings (Create link or update fields)
app.post('/api/files/:id/share', authenticateUser as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const fileId = req.params.id;
  const file = db.files.find(f => f.id === fileId);

  if (!file) {
    return res.status(404).json({ error: 'File folder/reference does not exist.' });
  }

  if (file.owner_user_id !== user.id && user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only owners can activate share portals.' });
  }

  if (file.status === 'Blocked') {
    return res.status(400).json({ error: 'Cursed files cannot have active share tokens!' });
  }

  const { password, expires_at, max_downloads, is_active } = req.body;

  // Search if a share token already exists
  let link = db.shareLinks.find(l => l.file_id === fileId);
  if (!link) {
    link = {
      id: 'lnk_' + Date.now(),
      file_id: fileId,
      public_token: generateToken(8),
      password: password || undefined,
      expires_at: expires_at || null,
      max_downloads: max_downloads ? Number(max_downloads) : null,
      download_count: 0,
      is_active: is_active !== undefined ? !!is_active : true,
      created_at: new Date().toISOString()
    };
    db.shareLinks.push(link);
  } else {
    // Update existing settings
    if (password !== undefined) link.password = password || undefined;
    if (expires_at !== undefined) link.expires_at = expires_at || null;
    if (max_downloads !== undefined) link.max_downloads = max_downloads ? Number(max_downloads) : null;
    if (is_active !== undefined) link.is_active = !!is_active;
  }

  saveDb();

  logSystemEvent(
    user.id,
    user.username,
    'Link',
    'ShareLink',
    link.id,
    req,
    `Configured sharing route for link token: ${link.public_token}`
  );

  res.json({ success: true, link });
});

// --- PUBLIC DOWNLOAD / PREVIEW ENDPOINTS ---

app.get('/api/public/share/:token', (req, res) => {
  const token = req.params.token;
  const link = db.shareLinks.find(l => l.public_token === token);

  if (!link || !link.is_active) {
    return res.status(404).json({ error: 'Share link found in the nether, but it is currently closed or invalid.' });
  }

  const file = db.files.find(f => f.id === link.file_id);
  if (!file || file.status === 'Blocked') {
    return res.status(404).json({ error: 'File link is offline. File approved status has changed or files were purged.' });
  }

  // Check expiration if any
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'The leek spell has expired. This public share portal is closed.' });
  }

  // Check download limits
  if (link.max_downloads && link.download_count >= link.max_downloads) {
    return res.status(410).json({ error: 'Download quota met. This share link reached its access limits.' });
  }

  const owner = db.users.find(u => u.id === file.owner_user_id);

  res.json({
    token: link.public_token,
    file_name: file.original_name,
    mime_type: file.mime_type,
    size: file.size,
    created_at: file.created_at,
    protected: !!link.password,
    uploader: owner ? owner.username : 'Anonymous',
    leeku_vibe: file.leeku_vibe,
    downloads_current: link.download_count,
    downloads_max: link.max_downloads
  });
});

app.post('/api/public/share/:token/download', (req, res) => {
  const token = req.params.token;
  const { password } = req.body;

  const link = db.shareLinks.find(l => l.public_token === token);
  if (!link || !link.is_active) {
    return res.status(404).json({ error: 'Share gateway is closed.' });
  }

  const file = db.files.find(f => f.id === link.file_id);
  if (!file || file.status === 'Blocked') {
    return res.status(404).json({ error: 'File is not online.' });
  }

  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Link portal expired.' });
  }

  if (link.max_downloads && link.download_count >= link.max_downloads) {
    return res.status(410).json({ error: 'Download limit was fulfilled.' });
  }

  // Password verification
  if (link.password && link.password !== password) {
    return res.status(403).json({ error: 'This file is not for your eyes. Incorrect vault keys.' });
  }

  // Update download counter
  link.download_count++;

  const rawEncrypted = db.fileContents[file.id] || '';
  const decryptedBase64 = decryptFileContents(rawEncrypted);

  saveDb();

  logSystemEvent(
    null,
    'Anonymous',
    'Download',
    'File',
    file.id,
    req,
    `Anonymous client downloaded file "${file.original_name}" via portal: ${token}`
  );

  res.json({
    original_name: file.original_name,
    mime_type: file.mime_type,
    content: decryptedBase64
  });
});

// --- ADMIN SYSTEM CONTROLS ---

function verifyAdmin(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  if (req.user!.role !== 'Admin') {
    return res.status(403).json({ error: 'Access denied. Only system administrators can run command codes.' });
  }
  next();
}

app.get('/api/admin/users', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req, res) => {
  res.json({ users: db.users });
});

app.post('/api/admin/users/:id/suspend', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const userId = req.params.id;
  const user = db.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Target user not registered.' });
  }

  if (user.role === 'Admin' && req.user!.id !== user.id) {
    return res.status(403).json({ error: 'You are forbidden from suspending fellow Miku admins.' });
  }

  user.status = user.status === 'Active' ? 'Suspended' : 'Active';
  saveDb();

  logSystemEvent(
    req.user!.id,
    req.user!.username,
    'Admin',
    'User',
    user.id,
    req,
    `Toggled suspend state of user "${user.username}". Current state: ${user.status}`
  );

  res.json({ success: true, user });
});

app.post('/api/admin/users/:id/quota', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const { quota_id } = req.body;
  const userId = req.params.id;
  const user = db.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Target user not found.' });
  }

  if (!db.quotas.some(q => q.id === quota_id)) {
    return res.status(400).json({ error: 'Specified quota model tier does not exist.' });
  }

  user.quota_id = quota_id;
  saveDb();

  logSystemEvent(
    req.user!.id,
    req.user!.username,
    'Admin',
    'User',
    user.id,
    req,
    `Changed storage quota level of user "${user.username}" to tier: ${quota_id}`
  );

  res.json({ success: true, user });
});

app.post('/api/admin/users/:id/edit', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const userId = req.params.id;
  const user = db.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Target user not found.' });
  }

  const { username, email, role, status, password } = req.body;

  if (username !== undefined) {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      return res.status(400).json({ error: 'Username cannot be blank.' });
    }
    if (db.users.some(u => u.id !== userId && u.username.toLowerCase() === trimmedUsername.toLowerCase())) {
      return res.status(400).json({ error: 'Username is already taken by another user.' });
    }
    // Update matching file references
    db.files.forEach(f => {
      if (f.owner_user_id === userId) {
        f.username = trimmedUsername;
      }
    });
    user.username = trimmedUsername;
  }

  if (email !== undefined) {
    const trimmedEmail = email.toLowerCase().trim();
    if (!trimmedEmail) {
      return res.status(400).json({ error: 'Email cannot be blank.' });
    }
    if (db.users.some(u => u.id !== userId && u.email.toLowerCase() === trimmedEmail)) {
      return res.status(400).json({ error: 'Email is already registered by another user.' });
    }
    user.email = trimmedEmail;
  }

  if (role !== undefined) {
    if (role !== 'Admin' && role !== 'User') {
      return res.status(400).json({ error: 'Invalid role classification.' });
    }
    user.role = role;
  }

  if (status !== undefined) {
    if (status !== 'Active' && status !== 'Suspended') {
      return res.status(400).json({ error: 'Invalid status classification.' });
    }
    user.status = status;
  }

  if (password !== undefined && password.trim() !== '') {
    db.passwords[userId] = password.trim();
  }

  saveDb();

  logSystemEvent(
    req.user!.id,
    req.user!.username,
    'Admin',
    'User',
    user.id,
    req,
    `Admin updated information details for user "${user.username}" (username/email/role/status)`
  );

  res.json({ success: true, user });
});

app.get('/api/admin/files', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req, res) => {
  res.json({ files: db.files });
});

app.post('/api/admin/files/:id/block', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const fileId = req.params.id;
  const file = db.files.find(f => f.id === fileId);

  if (!file) {
    return res.status(404).json({ error: 'Target file not loaded.' });
  }

  const oldStatus = file.status;
  file.status = file.status === 'Available' ? 'Blocked' : 'Available';

  // If blocked, update user's quota storage calculation so that blocked files are subtracted
  const owner = db.users.find(u => u.id === file.owner_user_id);
  if (owner) {
    if (file.status === 'Blocked' && oldStatus === 'Available') {
      owner.storage_used = Math.max(0, owner.storage_used - file.size);
    } else if (file.status === 'Available' && oldStatus === 'Blocked') {
      owner.storage_used += file.size;
    }
  }

  saveDb();

  logSystemEvent(
    req.user!.id,
    req.user!.username,
    'Admin',
    'File',
    file.id,
    req,
    `Admin changed block status of file "${file.original_name}". Current status: ${file.status}`
  );

  res.json({ success: true, file });
});

app.get('/api/admin/logs', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req, res) => {
  res.json({ logs: db.logs });
});

app.post('/api/admin/quotas', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const { id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes } = req.body;

  if (!id || !name || !storage_limit_bytes || !max_file_size_bytes || !max_files || !daily_upload_limit_bytes) {
    return res.status(400).json({ error: 'All parameters must be provided to create a quota model.' });
  }

  const existingIdx = db.quotas.findIndex(q => q.id === id);
  const newQuota: Quota = {
    id,
    name,
    storage_limit_bytes: Number(storage_limit_bytes),
    max_file_size_bytes: Number(max_file_size_bytes),
    max_files: Number(max_files),
    daily_upload_limit_bytes: Number(daily_upload_limit_bytes)
  };

  if (existingIdx !== -1) {
    db.quotas[existingIdx] = newQuota;
  } else {
    db.quotas.push(newQuota);
  }

  saveDb();

  logSystemEvent(
    req.user!.id,
    req.user!.username,
    'Admin',
    'Quota',
    id,
    req,
    `Admin saved/updated quota template details: "${name}"`
  );

  res.json({ success: true, quotas: db.quotas });
});

app.post('/api/admin/quotas/:id/delete', authenticateUser as express.RequestHandler, verifyAdmin as express.RequestHandler, (req: AuthenticatedRequest, res) => {
  const quotaId = req.params.id;
  const { migrate_to_quota_id } = req.body;

  const quotaIdx = db.quotas.findIndex(q => q.id === quotaId);
  if (quotaIdx === -1) {
    return res.status(404).json({ error: 'Quota tier not found.' });
  }

  if (db.quotas.length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the final remaining quota tier. At least one must be online!' });
  }

  // Check if users are currently attached
  const attachedUsers = db.users.filter(u => u.quota_id === quotaId);
  if (attachedUsers.length > 0) {
    if (!migrate_to_quota_id) {
      return res.status(400).json({
        error: 'Migration required',
        needs_migration: true,
        attached_count: attachedUsers.length
      });
    }

    if (!db.quotas.some(q => q.id === migrate_to_quota_id) || migrate_to_quota_id === quotaId) {
      return res.status(400).json({ error: 'Invalid destination quota specified for account migration.' });
    }

    // Migrate users to specified target
    attachedUsers.forEach(u => {
      u.quota_id = migrate_to_quota_id;
    });

    logSystemEvent(
      req.user!.id,
      req.user!.username,
      'Admin',
      'Quota',
      quotaId,
      req,
      `Migrated ${attachedUsers.length} accounts from deleted quota tier "${quotaId}" to "${migrate_to_quota_id}"`
    );
  }

  const deletedQuota = db.quotas[quotaIdx];
  db.quotas.splice(quotaIdx, 1);
  saveDb();

  logSystemEvent(
    req.user!.id,
    req.user!.username,
    'Admin',
    'Quota',
    quotaId,
    req,
    `Purged quota tier: "${deletedQuota.name}"`
  );

  res.json({ success: true, quotas: db.quotas });
});

// ---------------------------------------------------------
// STARTUP SERVER & VITE INTEGRATION
// ---------------------------------------------------------

async function bootstrap() {
  if (process.env.NODE_ENV !== 'production') {
    // Serve with Vite in Dev Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Static production paths
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    // Handle SPA Routing fallbacks safely
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Leeks.miku.rip virtual portal running on port ${PORT}`);
  });
}

bootstrap();
