# Feature Comparison: Leeku Secure vs. Google Drive & Mega.nz

Date: 2026-10-31
Audience: Product owners, developers, stakeholders
Purpose: Identify feature gaps and potential improvements for Leeku Secure based on what Google Drive and Mega.nz offer

---

## 1. Executive Summary

Leeku Secure is a **self-hosted, zero-knowledge file vault** with enterprise-grade encryption, malware scanning, and secure sharing. Compared to Google Drive and Mega.nz, it currently differentiates itself through:

- **AES-256-GCM per-file encryption** with per-file random keys wrapped by a master HKDF sub-key
- **Bitdefender AV scanning** integrated directly into the upload pipeline (fail-closed in production)
- **Argon2id password hashing** (64 MiB, 3 iterations)
- **Public share links** with password, expiry, download cap, and external video embed support
- **Full self-hosting control** on Windows Server 2022 with IIS ARR

However, it **lacks several consumer-facing features** that both Google Drive and Mega.nz excel at, which could significantly improve the user experience and market competitiveness.

---

## 2. Feature Comparison Matrix

### 2.1 Core Storage & File Management

| Feature | Leeku Secure | Google Drive | Mega.nz | Notes |
|---|---|---|---|---|
| File upload | ✅ Resumable.js chunked uploads | ✅ Drag & drop, multi-file | ✅ Drag & drop, multi-file | All three support chunked/resumable uploads |
| Folder hierarchy | ✅ Nested folders | ✅ Nested folders + shared drive | ✅ Nested folders | Parity |
| Folder rename | ✅ | ✅ | ✅ | Parity |
| Folder delete | ✅ | ✅ (with soft delete / trash) | ✅ (trash) | Leeku uses soft delete with 90-day trash retention |
| File preview (text/CSV) | ✅ Up to 5 MB | ✅ Google Docs/Sheets/Slides preview | ✅ Text preview | Leeku limited to text/CSV; both competitors support rich previews |
| Image preview | ⚠️ Thumbnail generation only | ✅ Full inline preview | ✅ Full inline preview | **GAP: Add full-image preview** |
| Video preview | ⚠️ Only via public share embed (Discord/Reddit) | ✅ Native player in Drive UI | ✅ Native player in web UI | **GAP: Add in-app video player** |
| Audio preview | ✅ Native in-app `<audio>` player | ✅ | ✅ | Parity |
| PDF preview | ❌ | ✅ | ✅ | **GAP** |
| Search | ❌ Frontend text input only (client-side filter) | ✅ Full-text indexed search | ✅ Full-text search | **GAP: Add indexed server-side search** |
| File versioning / history | ✅ Unlimited version history (upload same name → new version, download/restore/delete per version) | ✅ (Drive retains versions of Google Docs & uploaded files for 30 days) | ⚠️ (basic) | Leeku advantage: versions retained indefinitely vs Drive's 30-day window |
| Trash / Recycle bin | ✅ Full trash UI (restore / permanent delete, 90-day retention) | ✅ Full trash UI | ✅ Trash folder | Parity |
| Thumbnail generation | ✅ Background job | ✅ Automatic | ✅ Automatic | Parity (images) |
| File TTL / auto-expiry | ✅ | ❌ | ⚠️ | Leeku advantage |
| Storage quota tiers | ✅ Configurable quotas | ✅ (by plan) | ✅ (by plan) | Parity |
| Daily upload limits | ✅ Per-quota | ✅ (by plan) | ✅ (by plan) | Parity |
| File size limits | ✅ Per-quota `max_file_size_bytes` | ✅ (by plan) | ✅ (up to plan limit) | Parity |

### 2.2 Collaboration & Sharing

| Feature | Leeku Secure | Google Drive | Mega.nz | Notes |
|---|---|---|---|---|
| Public share links (files) | ✅ | ✅ (anyone with link) | ✅ | Parity |
| Public share links (folders) | ✅ | ✅ | ✅ | Parity |
| Password-protected links | ✅ | ⚠️ (restricted via enterprise) | ✅ | Parity with Mega; Leeku advantage over free Drive |
| Link expiry | ✅ | ⚠️ (limited) | ✅ | Leeku advantage |
| Download caps | ✅ (max_downloads) | ⚠️ (limited) | ❌ | **Leeku advantage** |
| External video embed (Discord/Reddit) | ✅ | ⚠️ (limited) | ⚠️ (limited) | **Leeku advantage** |
| Collaboration editing | ❌ | ✅ (Google Docs/Sheets real-time co-editing) | ❌ | **GAP: Add collaborative editing** (major differentiation) |
| Shared team folders / drives | ⚠️ (folder sharing with permission inheritance) | ✅ (Shared Drives with granular permissions) | ⚠️ | **GAP: Add granular permission levels (view/edit/comment)** |
| File-level permissions | ⚠️ Basic (block only) | ✅ Granular (viewer/editor/owner) | ✅ Granular | **GAP: Add granular user-level permissions** |
| Comments / annotations | ❌ | ✅ | ❌ | **GAP: Add file comments/annotations** |
| Activity feed | ❌ | ✅ (activity panel) | ⚠️ (limited) | **GAP: Add per-file activity log** |
| Share link analytics | ⚠️ Download count only | ❌ | ❌ | Partial parity |
| In-app chat/notifications | ❌ | ✅ (Drive notifications) | ✅ (Mega Chat) | **GAP: Add in-app notifications** |

### 2.3 Security & Privacy

| Feature | Leeku Secure | Google Drive | Mega.nz | Notes |
|---|---|---|---|---|
| At-rest encryption | ✅ AES-256-GCM | ✅ (Google-managed keys) | ✅ AES-128 | Leeku advantage (client-controlled keys) |
| End-to-end encryption | ✅ (zero-knowledge) | ❌ (server-side) | ✅ (zero-knowledge) | Parity with Mega |
| Master key wrapping | ✅ HKDF | ❌ | ⚠️ | Leeku advantage |
| Password hashing | ✅ Argon2id | N/A | ✅ (Argon2id) | Parity with Mega |
| 2FA / MFA | ❌ | ✅ (TOTP/security keys) | ✅ (TOTP) | **GAP: Add Two-Factor Authentication** (critical) |
| Session management | ✅ (revoke sessions, IP/UA tracking) | ✅ (Google account sessions) | ✅ | Parity |
| Malware scanning | ✅ Bitdefender | ⚠️ (limited) | ✅ | Leeku advantage |
| AI scan summaries | ⚠️ Optional Gemini integration | ❌ | ❌ | Leeku advantage |
| File-level client-side secret | ✅ Optional PBKDF2 layer | ❌ | ⚠️ | Leeku advantage |
| Account deletion (two-step) | ✅ | ✅ | ✅ | Parity |
| Password reset (email) | ✅ | ✅ | ✅ | Parity |
| Failed-login lockout | ✅ | ✅ | ✅ | Parity |
| Admin suspension | ✅ | ✅ (admin console) | ⚠️ | Parity |
| Column-level DB encryption (PII) | ✅ | ⚠️ (Google-managed) | ⚠️ | Leeku advantage |
| CSRF protection | ✅ | N/A (API-based) | ⚠️ | Leeku advantage |

### 2.4 Desktop & Mobile Clients

| Feature | Leeku Secure | Google Drive | Mega.nz | Notes |
|---|---|---|---|---|
| Desktop app | ⚠️ (desktop-updates route for deployment) | ✅ (Drive for desktop) | ✅ (MEGA Desktop) | **GAP: Build a native desktop client** (Leeku has an app ecosystem but limited) |
| Mobile app (iOS/Android) | ❌ | ✅ | ✅ | **GAP: Build mobile apps** |
| Offline access | ❌ | ✅ (Drive for desktop + mobile offline) | ✅ (desktop sync) | **GAP** |
| File syncing (automatic) | ❌ | ✅ | ✅ (MEGA Sync) | **GAP: Add folder sync client** |
| Browser extension | ❌ | ✅ (via Drive) | ✅ (MEGA extension) | **GAP** |
| Command-line tool | ⚠️ | ✅ (gcloud CLI) | ✅ (MEGA CMD) | Parity |

### 2.5 Administration & Operations

| Feature | Leeku Secure | Google Drive | Mega.nz | Notes |
|---|---|---|---|---|
| Admin panel | ✅ | ✅ (Google Admin) | ✅ | Parity |
| User management | ✅ (create, suspend, quota) | ✅ | ✅ | Parity |
| System health monitoring | ✅ (CPU/memory/disk/uptime) | ⚠️ | ⚠️ | Leeku advantage |
| Maintenance mode | ✅ | ⚠️ | ⚠️ | Leeku advantage |
| Activity/audit logs | ✅ | ✅ | ⚠️ | Parity |
| Quota management | ✅ Per-user | ✅ | ✅ | Parity |
| File blocking (admin) | ✅ | ✅ (admin) | ⚠️ | Parity |
| IIS W3C logs | ✅ | N/A | N/A | Leeku advantage (compliance) |
| Desktop update distribution | ✅ | N/A | ✅ | Leeku advantage |
| Backup/restore | ⚠️ Documented, needs drill | ✅ | ⚠️ | Partial parity |

---

## 3. Identified Feature Gaps & Improvement Opportunities

### 3.1 High-Priority Gaps (P1)

| # | Gap | Impact | Suggested Solution | Effort |
|---|---|---|---|---|
| 1 | **Two-Factor Authentication (2FA)** | Mega & Google both offer TOTP/security keys; lack of 2FA is a significant security gap for a "secure" file vault | Add TOTP (RFC 6238) or WebAuthn; add a `2fa_secret` column, generate QR code on setup, verify on login | M |
| 2 | **Rich File Preview (images, video, audio, PDF)** | Images/videos/audio now preview inline; PDFs still unsupported — competitors offer full inline preview | Use browser-native `<iframe>`/PDF.js for PDF preview | M |
| 3 | **Server-side Full-Text Search** | Currently only client-side filter of loaded files — doesn't scale | Add SQL Server full-text-indexed search on decrypted filenames/metadata; background indexing job | L |
| 4 | **Mobile Responsive Web App** | Competitors have native apps; current React UI is desktop-primary | Improve responsive layout, mobile navigation, touch support | M |

### 3.2 Medium-Priority Gaps (P2)

| # | Gap | Impact | Suggested Solution | Effort |
|---|---|---|---|---|
| 5 | **Granular Sharing Permissions** | Only coarse "share or block"; competitors allow view/edit/comment roles | Add `permission_level` column to share_links; map to view/comment/edit for folders & files | M |
| 6 | ~~File Version History~~ ✅ **Implemented** | Uploading same name into same folder now creates a version instead of a duplicate; versions drawer lists current + archived with download/restore/delete, per-version share pinning, and a soft-delete version trash | DONE | — |
| 7 | ~~Trash / Recycle Bin UI~~ ✅ **Implemented** | Soft-delete with 90-day retention now has a full trash UI (restore / permanent delete) | DONE | — |
| 8 | **In-App Notifications** | No way to alert users about shares, quotas, or system messages | Add a notifications table + polling or SSE; surface in dashboard bell | M |
| 9 | **File Comments / Activity Feed** | Collaboration limited to sharing; no per-file discussion or history | Add comments table + activity log per file | M |
| 10 | **Share Link Expiry UI** | Expiry exists but not surfaced as a send-to-self calendar reminder | Polish share dialog to show countdown, reminder integration | S |

### 3.3 Lower-Priority Improvements (P3)

| # | Gap | Impact | Suggested Solution | Effort |
|---|---|---|---|---|
| 11 | Native Desktop Client | Desktop-updates route exists but no packaged installer UX | Package Electron/Tauri app using existing desktop-updates distribution | XL |
| 12 | Mobile Apps | No iOS/Android apps | React Native / Capacitor wrapper over web app | XL |
| 13 | Offline / Sync Client | No local sync | Add desktop sync folder mirroring (like Mega Sync) | XL |
| 14 | Browser Extension | Competitors offer quick-access extensions | Chrome/Firefox extension hitting API | M |
| 15 | Collaborative Co-editing | Google's killer differentiating feature | Integrate a provider (e.g., Yjs/CRDT) — unlikely for v1 | XL |
| 16 | Command-line / WebDAV interface | Advanced users want scripted access | Expose WebDAV or an SFTP/rsync bridge | M |

---

## 4. Where Leeku Secure Already Exceeds Competitors

Understanding where we already win helps prioritize roadmap investments:

| Differentiator | Why it matters |
|---|---|
| **Zero-knowledge E2E encryption** | Files are encrypted client-side before touching disk; Google Drive cannot claim this |
| **Per-file AES-256-GCM with master HKDF wrapping** | Stronger key isolation than Mega's AES-128 default |
| **Bitdefender AV scanning with fail-closed** | Malware is blocked *before* storage; Google does no pre-upload AV |
| **Public share link controls** | Password + expiry + download cap + video embed is richer than either competitor |
| **Unlimited file versioning** | Versions retained indefinitely with per-version download/restore and share pinning — Drive offers only a 30-day window |
| **Admin health/ops controls** | Maintenance mode, system health stats, IIS W3C logs, desktop update distribution is self-hosted-ops-specific |
| **Self-hosting / data sovereignty** | Full control over infra, keys, and compliance (matters for MSPs/enterprise) |

---

## 5. Recommended Roadmap (Prioritized)

### Immediate (0–3 months)
1. **2FA** — highest-value security improvement, matches competitors
2. **PDF preview** — image/video/audio inline preview now done; add PDF support
3. **Mobile responsive Web UI** — support mobile browsers

### Short-term (3–6 months)
4. **Granular share permissions** (view/comment/edit)
5. ~~**File version history**~~ ✅ **Implemented** — same-name uploads create versions; full versions drawer with download / restore / delete, per-version share pinning, and version trash
6. ~~**Trash UI**~~ ✅ **Implemented** — trash with restore + 90-day purge in place
7. **Server-side search index**

### Long-term (6–12 months)
8. **Native desktop client** (leverage existing desktop-updates)
9. **Mobile app**
10. **Offline/sync client**
11. **Browser extension**

---

## 6. Evidence & Sources

### Leeku Secure (code evidence)
- Encryption & key wrapping: `src/server/utils/encryption.ts`
- Bitdefender scanner integration: `src/server/utils/scanner.ts`
- Public share & embed routing: `src/server/routes/public-sharing.ts`
- Folder sharing: `src/server/routes/public-folder-sharing.ts`
- Session management: `src/server/routes/sessions.ts`
- Admin health/quotas: `src/server.ts` (lines ~1218, ~1233, ~4355+)
- Maintenance mode: `src/server/routes/maintenance-mode.ts`
- Desktop update distribution: `src/server/routes/desktop-updates.ts`
- Upload handling (resumable.js): `src/server.ts` (lines ~2737–2800)
- Thumbnail generation: `src/server.ts` (lines ~3547–3624, ~5061+)

### Competitor feature sets
- Google Drive: official product page (`google.com/drive`)
- Mega: official feature pages (`mega.io`)
- Feature observations are based on publicly documented capabilities as of 2026-10-31.

---

## 7. Conclusion

Leeku Secure's **zero-knowledge encryption, AV scanning, and public share controls** already outclass both Google Drive and Mega.nz in security depth proven by code. However, to compete on **user experience, collaboration, and platform reach**, the project should prioritize:

1. **2FA** (security parity)
2. **Rich inline previews** (parity + UX)
3. **Granular sharing permissions** (collaboration)
4. **Mobile/native clients** (platform reach)

These additions would let Leeku Secure claim the **"most secure self-hosted cloud storage"** title with the **same UX polish users expect from the big providers.**
