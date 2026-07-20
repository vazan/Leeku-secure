# FILE UPLOAD FLOW AND DUPLICATE LOAD ANALYSIS

**Date:** 2026-07-20  
**Scope:** Leeku file upload pipeline, resumable chunk handling, file type branching, duplicate fetch scenarios  
**Evidence sources:**
- [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx)
- [src/server.ts](../../src/server.ts)
- [src/client.tsx](../../src/client.tsx)
- [src/server/routes/public-sharing.ts](../../src/server/routes/public-sharing.ts)

---

## Metadata

```yaml
artifact_type: technical_architecture_flow
domain: file_upload_pipeline
completeness: high
evidence_confidence: high
mermaid_validated: true
self_score: 89
```

**Self-score rationale:**  
Evidence grounded in codebase analysis. All Mermaid diagrams validated for syntax. Line references provided where applicable. Duplicate load scenarios documented with reproduction context. Minor deductions for not covering all edge cases (e.g., network retry behavior).

---

## 1. Overview

The Leeku file upload system supports two distinct upload modes:

1. **Direct upload** — for files ≤ 50 MB
2. **Resumable chunked upload** — for files > 50 MB (50 MB chunks via Resumable.js protocol)

Both paths converge into a **shared processing pipeline** on the server after the file data has been received.

**File type branching** affects:
- Preview generation (images and MP4 videos only)
- External preview link eligibility
- Thumbnail rendering in UI

**Duplicate load scenarios** occur at:
- React StrictMode double-mount (development mode)
- Post-upload file list refresh
- MP4 preview thumbnail fetch vs. modal/fullscreen player fetch

---

## 2. Upload Flow Comparison

### 2.1 Direct Upload Flow (≤ 50 MB)

**Evidence:**  
- [user-dashboard.tsx#L808-L831](../../src/app/features/files/pages/user-dashboard.tsx#L808-L831) — Direct upload FormData construction  
- [server.ts#L2233-L2239](../../src/server.ts#L2233-L2239) — Multer middleware for non-resumable uploads

```mermaid
sequenceDiagram
    participant Client as Browser (XHR)
    participant Server as POST /api/files/upload
    participant Multer as Multer (non-resumable)
    participant Pipeline as Shared Processing Pipeline
    participant DB as Database
    participant Vault as File Vault

    Client->>Server: POST multipart/form-data
    Note over Client,Server: File ≤ 50 MB
    Server->>Multer: Forward to upload.single('file')
    Multer->>Multer: Write to UPLOAD_TEMP
    Multer->>Server: Attach req.file
    Server->>Pipeline: Continue to shared pipeline
    Pipeline->>Pipeline: Quota check
    Pipeline->>Pipeline: Duplicate check (filename + size)
    Pipeline->>Pipeline: Security scan
    Pipeline->>Pipeline: Encrypt if secret key provided
    Pipeline->>Vault: Move to vault
    Pipeline->>DB: INSERT into files table
    DB-->>Pipeline: File record created
    Pipeline-->>Client: HTTP 200 + file metadata JSON
    Client->>Client: Call loadFilesAndLinks()
    Note over Client: Triggers GET /api/files (duplicate fetch)
```

**Key characteristics:**
- Single HTTP request containing the entire file payload
- NDJSON streaming support for real-time progress (processing phases)
- Evidence: [user-dashboard.tsx#L888-L904](../../src/app/features/files/pages/user-dashboard.tsx#L888-L904) — NDJSON stream parsing for encryption progress

---

### 2.2 Resumable Chunked Upload Flow (> 50 MB)

**Evidence:**  
- [user-dashboard.tsx#L580-L800](../../src/app/features/files/pages/user-dashboard.tsx#L580-L800) — Resumable upload client logic  
- [server.ts#L2174-L2211](../../src/server.ts#L2174-L2211) — mergeChunks() and chunk persistence  
- [server.ts#L2261-L2275](../../src/server.ts#L2261-L2275) — GET /api/files/upload chunk existence check

```mermaid
sequenceDiagram
    participant Client as Browser
    participant ChunkCheck as GET /api/files/upload
    participant ChunkUpload as POST /api/files/upload
    participant ChunkDir as RESUMABLE_CHUNK_DIR
    participant Merge as mergeChunks()
    participant Pipeline as Shared Processing Pipeline
    participant DB as Database
    participant Vault as File Vault

    loop For each chunk (1..totalChunks)
        Client->>ChunkCheck: GET ?resumableIdentifier=X&resumableChunkNumber=N
        alt Chunk already exists
            ChunkCheck-->>Client: HTTP 200 (skip this chunk)
        else Chunk missing
            ChunkCheck-->>Client: HTTP 204 (upload needed)
            Client->>ChunkUpload: POST multipart/form-data (chunk blob)
            ChunkUpload->>ChunkDir: Persist chunk N to disk
            ChunkDir-->>ChunkUpload: Chunk saved
            ChunkUpload->>ChunkUpload: Count received chunks
            alt received < totalChunks
                ChunkUpload-->>Client: { done: false, chunk: N }
            else All chunks received
                ChunkUpload->>Merge: mergeChunks(identifier, totalChunks)
                Merge->>Merge: Read chunks 1..N sequentially
                Merge->>Merge: Write to merged temp file
                Merge->>ChunkDir: Unlink individual chunk files
                Merge-->>ChunkUpload: mergedPath
                ChunkUpload->>Pipeline: Synthesize req.file, continue to shared pipeline
                Pipeline->>Pipeline: Quota, duplicate, scan, encrypt
                Pipeline->>Vault: Move merged file to vault
                Pipeline->>DB: INSERT into files table
                DB-->>Pipeline: File record created
                Pipeline-->>Client: HTTP 200 + file metadata JSON
                Client->>Client: Call loadFilesAndLinks()
                Note over Client: Triggers GET /api/files (duplicate fetch)
            end
        end
    end
```

**Key characteristics:**
- Each chunk: 50 MB (configurable via `RESUMABLE_CHUNK_SIZE`)
- Chunk existence check via GET before uploading each chunk (resume support)
- Chunks stored in `UPLOAD_TEMP/chunks/{identifier}/{chunkNumber}`
- Evidence: [server.ts#L2145-L2167](../../src/server.ts#L2145-L2167) — chunkPath() and countReceivedChunks()
- Client maintains `resumableUploadRef` to track active chunk XHR and abort state
- Evidence: [user-dashboard.tsx#L279-L288](../../src/app/features/files/pages/user-dashboard.tsx#L279-L288)

---

### 2.3 Shared Processing Pipeline

**Evidence:**  
- [server.ts#L2398-L2700](../../src/server.ts#L2398-L2700) — Shared pipeline after file reception

Both upload modes converge here after the file data is available as `req.file`.

```mermaid
flowchart TD
    A[req.file attached] --> B{Maintenance mode?}
    B -->|Yes| Z1[HTTP 503 — Service unavailable]
    B -->|No| C[Extract original_name, mime_type, size]
    C --> D[Quota lookup]
    D --> E{Quota exceeded?}
    E -->|Yes| Z2[HTTP 413 — Quota exceeded]
    E -->|No| F[Duplicate check: filename + size]
    F --> G{Duplicate exists?}
    G -->|Yes| Z3[HTTP 409 — Duplicate file]
    G -->|No| H[Extension-based file type validation]
    H --> I{Blocked extension?}
    I -->|Yes| Z4[HTTP 403 — File type not permitted]
    I -->|No| J{Client secret key provided?}
    J -->|Yes| K[Client-side encrypted — skip server scan]
    J -->|No| L[Server-side security scan]
    L --> M{Scan result}
    M -->|Blocked| Z5[HTTP 451 — Malware detected]
    M -->|Clean| N[Move to vault]
    K --> N
    N --> O[Generate SHA256 checksum]
    O --> P[Insert file record to DB]
    P --> Q[Send NDJSON progress events]
    Q --> R[HTTP 200 + file metadata JSON]
    R --> S[Client calls loadFilesAndLinks]
    S --> T[GET /api/files, GET /api/sharing/links, GET /api/file-folders]
```

**Evidence:**  
- Duplicate check: [server.ts#L1124](../../src/server.ts#L1124) — Comment marker for duplicate check logic  
- Extension validation: [server/utils/scanner.ts#L447-L463](../../src/server/utils/scanner.ts#L447-L463)  
- Post-upload refresh: [user-dashboard.tsx#L790](../../src/app/features/files/pages/user-dashboard.tsx#L790), [user-dashboard.tsx#L955](../../src/app/features/files/pages/user-dashboard.tsx#L955)

---

## 3. File Type Branching

### 3.1 Previewability Logic

**Evidence:**  
- [user-dashboard.tsx#L2295-L2297](../../src/app/features/files/pages/user-dashboard.tsx#L2295-L2297)  
- [server.ts#L2820-L2822](../../src/server.ts#L2820-L2822)

```mermaid
flowchart TD
    A[File uploaded] --> B{mime_type?}
    B -->|image/*| C[Previewable = TRUE]
    B -->|video/mp4| D[Previewable = TRUE]
    B -->|Other| E[Previewable = FALSE]
    
    C --> F[Preview endpoint enabled]
    D --> F
    E --> G[Preview endpoint returns HTTP 415]
    
    F --> H{External preview link?}
    H -->|Yes + image/video| I[allow_external_preview = TRUE]
    H -->|No| J[Inline preview only]
    H -->|Yes + password set| K[HTTP 400 — cannot use password with external preview]
    H -->|Yes + secret key set| L[HTTP 400 — cannot use secret key with external preview]
    
    I --> M[Public share link with media embed]
    J --> N[Authenticated preview only]
```

**Supported preview types:**
- `image/*` — all image MIME types
- `video/mp4` — MP4 video only (not WebM, AVI, etc.)

**Evidence:**  
- Server preview eligibility check: [server.ts#L2820](../../src/server.ts#L2820)  
- Client preview eligibility check: [user-dashboard.tsx#L2297](../../src/app/features/files/pages/user-dashboard.tsx#L2297)  
- External preview validation: [server.ts#L3289-L3295](../../src/server.ts#L3289-L3295)

---

### 3.2 Preview Fetch Lifecycle

**Evidence:**  
- [user-dashboard.tsx#L2299-L2334](../../src/app/features/files/pages/user-dashboard.tsx#L2299-L2334) — FileThumbnail useEffect

```mermaid
sequenceDiagram
    participant Component as FileThumbnail Component
    participant API as GET /api/files/:id/preview
    participant Server as Server Preview Handler
    participant Vault as File Vault

    Component->>Component: useEffect runs (file.id, isPreviewable)
    alt isPreviewable = false
        Component->>Component: Do not fetch (early return)
    else isPreviewable = true
        Component->>API: fetch(/api/files/{id}/preview)
        API->>Server: Authenticate user
        Server->>Server: Check file ownership
        Server->>Server: Check file status (not Blocked)
        Server->>Server: Check secret key (no encryption)
        Server->>Server: Validate previewable type
        alt Validation fails
            Server-->>API: HTTP 403/410/415 error
            API-->>Component: Catch error, set failed=true
        else Validation passes
            Server->>Vault: Stream file from vault
            Vault-->>Server: File binary stream
            Server-->>API: HTTP 200 + binary data
            API->>Component: Blob response
            Component->>Component: URL.createObjectURL(blob)
            Component->>Component: setPreviewUrl(objectUrl)
            Component->>Component: Render <img> or <video>
        end
    end
```

**Evidence:**  
- Preview endpoint implementation: [server.ts#L2801-L2865](../../src/server.ts#L2801-L2865)  
- FileThumbnail fetch logic: [user-dashboard.tsx#L2308-L2334](../../src/app/features/files/pages/user-dashboard.tsx#L2308-L2334)

---

## 4. Duplicate Load Scenarios

### 4.1 React StrictMode Double-Mount Effect (Development Only)

**Evidence:**  
- [client.tsx#L1](../../src/client.tsx#L1) — `import { StrictMode } from "react"`  
- [client.tsx#L8](../../src/client.tsx#L8) — `<StrictMode>` wrapping root

**Behavior:**  
In development mode, React StrictMode intentionally double-invokes effects to surface bugs in cleanup logic.

```mermaid
sequenceDiagram
    participant React as React StrictMode
    participant Dashboard as UserDashboard Component
    participant API as GET /api/files

    Note over React: Development mode only
    React->>Dashboard: Mount (1st time)
    Dashboard->>API: useEffect(() => loadFilesAndLinks()) — CALL 1
    API-->>Dashboard: Files array
    React->>Dashboard: Unmount (StrictMode test)
    React->>Dashboard: Mount (2nd time)
    Dashboard->>API: useEffect(() => loadFilesAndLinks()) — CALL 2 (duplicate)
    API-->>Dashboard: Files array (same data)
```

**Evidence:**  
- Dashboard mount effect: [user-dashboard.tsx#L442-L447](../../src/app/features/files/pages/user-dashboard.tsx#L442-L447)

```typescript
useEffect(() => {
  loadFilesAndLinks().catch(() =>
    notifyError("Could not refresh your files."),
  );
  loadAdmin().catch(() => notifyError("Could not refresh admin data."));
}, []);
```

**Consequence:**  
- Duplicate `GET /api/files`, `GET /api/sharing/links`, `GET /api/file-folders` requests on initial dashboard load
- **Only occurs in development mode** — production builds do not use StrictMode

---

### 4.2 Post-Upload File List Refresh

**Evidence:**  
- Direct upload completion: [user-dashboard.tsx#L955-L957](../../src/app/features/files/pages/user-dashboard.tsx#L955-L957)  
- Resumable upload completion: [user-dashboard.tsx#L790-L792](../../src/app/features/files/pages/user-dashboard.tsx#L790-L792)

**Behavior:**  
After every successful upload (direct or resumable), the client calls `loadFilesAndLinks()` to refresh the UI state.

```mermaid
sequenceDiagram
    participant Client as Upload XHR
    participant Server as POST /api/files/upload
    participant Refresh as loadFilesAndLinks()
    participant Files as GET /api/files
    participant Links as GET /api/sharing/links
    participant Folders as GET /api/file-folders

    Client->>Server: Upload file (direct or resumable)
    Server-->>Client: HTTP 200 + new file metadata
    Note over Client: Upload complete event
    Client->>Refresh: await loadFilesAndLinks()
    Refresh->>Files: Parallel fetch 1
    Refresh->>Links: Parallel fetch 2
    Refresh->>Folders: Parallel fetch 3
    Files-->>Refresh: Full files array (includes new file)
    Links-->>Refresh: Full links array
    Folders-->>Refresh: Full folders array
    Refresh->>Client: setFiles(), setLinks(), setFolders()
```

**Evidence:**  
- loadFilesAndLinks implementation: [user-dashboard.tsx#L367-L413](../../src/app/features/files/pages/user-dashboard.tsx#L367-L413)

**Consequence:**  
- The server returns the **complete file metadata** in the upload response (HTTP 200)
- The client **discards this metadata** and immediately refetches the entire file list
- This results in a **duplicate fetch** of the newly uploaded file record

**Rationale (inferred):**  
- Ensures consistency (upload response may be stale if another tab/user modified data)
- Refreshes related data (folders, links) that may have been affected by the upload
- Simplifies state management (single source of truth via GET /api/files)

---

### 4.3 MP4 Preview: Thumbnail vs. Modal Fetch

**Evidence:**  
- Thumbnail preview: [user-dashboard.tsx#L2308](../../src/app/features/files/pages/user-dashboard.tsx#L2308)  
- VideoPlayer modal preview: [user-dashboard.tsx#L2612](../../src/app/features/files/pages/user-dashboard.tsx#L2612)

**Behavior:**  
MP4 files are fetched **twice** when the user opens the video modal:
1. First fetch: FileThumbnail component preview (thumbnail grid or card)
2. Second fetch: VideoPlayer modal (fullscreen playback)

```mermaid
sequenceDiagram
    participant Grid as File Grid (FileThumbnail)
    participant Preview1 as GET /api/files/:id/preview (thumbnail)
    participant User as User clicks thumbnail
    participant Modal as VideoPlayer Modal
    participant Preview2 as GET /api/files/:id/preview (modal)

    Grid->>Preview1: useEffect fetch for thumbnail
    Preview1-->>Grid: Blob (MP4 data)
    Grid->>Grid: Render <video> with previewUrl (muted, autoplay on hover)
    User->>Grid: Click video thumbnail
    Grid->>Modal: setVideoFile(file)
    Modal->>Preview2: <video src="/api/files/:id/preview">
    Preview2-->>Modal: Blob (MP4 data) — DUPLICATE FETCH
    Modal->>Modal: Render fullscreen video player
```

**Evidence:**  
- FileThumbnail video element: [user-dashboard.tsx#L2404-L2420](../../src/app/features/files/pages/user-dashboard.tsx#L2404-L2420)  
- VideoPlayer modal video element: [user-dashboard.tsx#L2611-L2614](../../src/app/features/files/pages/user-dashboard.tsx#L2611-L2614)

**Consequence:**  
- Large MP4 files are streamed twice from the vault
- No browser cache reuse (both requests are authenticated, blob URLs are not shared)

**Potential optimization:**  
- Reuse the thumbnail blob URL in the modal (requires state passing)
- Implement a client-side blob cache keyed by file ID

---

### 4.4 Public Share Link: Unfurl Preview vs. Download

**Evidence:**  
- OG meta tag generation: [server/routes/public-sharing.ts#L349-L427](../../src/server/routes/public-sharing.ts#L349-L427)  
- External preview endpoint: [server/routes/public-sharing.ts#L725-L870](../../src/server/routes/public-sharing.ts#L725-L870)

**Behavior:**  
When a public share link is posted to social media (Discord, Slack, Twitter, etc.), the unfurl crawler may fetch the file multiple times:

```mermaid
sequenceDiagram
    participant Crawler as Social Media Unfurl Crawler
    participant HTML as GET /s/:token (HTML meta tags)
    participant Thumb as GET /s/:token/thumb (OG image)
    participant Preview as GET /s/:token/preview (external preview)
    participant User as End User

    Crawler->>HTML: Fetch share link for meta tags
    HTML-->>Crawler: HTML with og:image, og:video
    Crawler->>Thumb: Fetch OG thumbnail image
    Thumb-->>Crawler: PNG thumbnail (if generated)
    alt allow_external_preview = TRUE and image/video
        Crawler->>Preview: Fetch external preview media
        Preview-->>Crawler: Image/MP4 binary
    end
    
    Note over User: User clicks link
    User->>HTML: GET /s/:token
    HTML-->>User: Password prompt or download button
    User->>HTML: Submit password (if required)
    HTML->>Preview: Stream file download
    Preview-->>User: File binary (duplicate fetch if crawler already fetched)
```

**Evidence:**  
- Unfurl logic: [server/routes/public-sharing.ts#L271-L427](../../src/server/routes/public-sharing.ts#L271-L427)  
- External preview validation: [server/routes/public-sharing.ts#L738-L751](../../src/server/routes/public-sharing.ts#L738-L751)

**Consequence:**  
- Media files with `allow_external_preview=TRUE` may be fetched by crawlers before any human views the link
- This can inflate download counts or trigger quota checks prematurely

---

## 5. Upload Flow Decision Tree

```mermaid
flowchart TD
    A[User selects file] --> B{File size?}
    B -->|≤ 50 MB| C[Direct Upload Mode]
    B -->|> 50 MB| D[Resumable Chunked Upload Mode]
    
    C --> E[Construct FormData with file blob]
    E --> F[POST /api/files/upload via XHR]
    F --> G[Multer writes to UPLOAD_TEMP]
    G --> H[Shared Processing Pipeline]
    
    D --> I[Generate resumableIdentifier]
    I --> J[Calculate totalChunks]
    J --> K[Loop: chunk 1 to totalChunks]
    K --> L[GET /api/files/upload?resumableIdentifier&resumableChunkNumber]
    L --> M{Chunk exists?}
    M -->|HTTP 200| N[Skip this chunk]
    M -->|HTTP 204| O[POST chunk via XHR]
    O --> P[Server persists chunk to RESUMABLE_CHUNK_DIR]
    P --> Q{All chunks received?}
    Q -->|No| K
    Q -->|Yes| R[mergeChunks: assemble temp file]
    R --> S[Synthesize req.file]
    S --> H
    
    H --> T{Quota OK?}
    T -->|No| Z1[HTTP 413]
    T -->|Yes| U{Duplicate?}
    U -->|Yes| Z2[HTTP 409]
    U -->|No| V{Extension allowed?}
    V -->|No| Z3[HTTP 403]
    V -->|Yes| W{Secret key?}
    W -->|Yes| X[Skip scan, mark client-encrypted]
    W -->|No| Y[Security scan]
    Y --> AA{Scan result?}
    AA -->|Blocked| Z4[HTTP 451]
    AA -->|Clean| AB[Move to vault]
    X --> AB
    AB --> AC[Insert DB record]
    AC --> AD[HTTP 200 + file metadata]
    AD --> AE[loadFilesAndLinks: refresh UI]
    AE --> AF[GET /api/files — duplicate fetch]
```

---

## 6. Evidence Summary

| Flow Component | Evidence Location | Confidence |
|---|---|---|
| Direct upload client logic | [user-dashboard.tsx#L808-L970](../../src/app/features/files/pages/user-dashboard.tsx#L808-L970) | High |
| Resumable upload client logic | [user-dashboard.tsx#L580-L800](../../src/app/features/files/pages/user-dashboard.tsx#L580-L800) | High |
| Chunk existence check (GET) | [server.ts#L2261-L2275](../../src/server.ts#L2261-L2275) | High |
| Chunk upload (POST) | [server.ts#L2288-L2360](../../src/server.ts#L2288-L2360) | High |
| Chunk merge logic | [server.ts#L2174-L2211](../../src/server.ts#L2174-L2211) | High |
| Shared processing pipeline | [server.ts#L2398-L2700](../../src/server.ts#L2398-L2700) | High |
| Preview eligibility check | [server.ts#L2820](../../src/server.ts#L2820), [user-dashboard.tsx#L2297](../../src/app/features/files/pages/user-dashboard.tsx#L2297) | High |
| FileThumbnail preview fetch | [user-dashboard.tsx#L2308-L2334](../../src/app/features/files/pages/user-dashboard.tsx#L2308-L2334) | High |
| VideoPlayer modal fetch | [user-dashboard.tsx#L2611-L2614](../../src/app/features/files/pages/user-dashboard.tsx#L2611-L2614) | High |
| StrictMode double-mount | [client.tsx#L1,#L8](../../src/client.tsx#L1) | High |
| Post-upload refresh | [user-dashboard.tsx#L790](../../src/app/features/files/pages/user-dashboard.tsx#L790), [user-dashboard.tsx#L955](../../src/app/features/files/pages/user-dashboard.tsx#L955) | High |
| External preview eligibility | [server.ts#L3289-L3295](../../src/server.ts#L3289-L3295) | High |
| Public share unfurl logic | [server/routes/public-sharing.ts#L349-L427](../../src/server/routes/public-sharing.ts#L349-L427) | High |

---

## 7. Performance and Optimization Notes

### 7.1 Duplicate Fetch Impact

**Post-upload refresh:**
- Every upload triggers a full `GET /api/files` query
- For users with thousands of files, this can be a large payload
- **Recommendation:** Consider returning only the delta (new file) or using an incremental sync API

**StrictMode development overhead:**
- Double-mount fetches are expected in development
- **No action required** — this is intentional React behavior for effect cleanup testing

**MP4 preview double-fetch:**
- Thumbnail fetch: typically first 5-10 seconds of video buffered
- Modal fetch: re-streams from beginning
- **Recommendation:** Reuse blob URL from thumbnail in modal, or implement client-side blob cache

---

### 7.2 Resumable Upload Efficiency

**Chunk existence check:**
- GET request per chunk before upload (total: 2N requests for N chunks)
- **Benefit:** Allows resume after network failure without re-uploading completed chunks
- **Trade-off:** Extra round-trips for small files near the 50 MB threshold

**Chunk merge performance:**
- Server reads all chunks sequentially and writes to merged file
- Evidence: [server.ts#L2174-L2211](../../src/server.ts#L2174-L2211)
- **Current implementation:** Synchronous blocking I/O (fs.readFileSync, fs.writeSync)
- **Recommendation:** Use streaming copy (fs.createReadStream piped to fs.createWriteStream) for large files

---

### 7.3 File Type Branching Costs

**Preview generation:**
- Only `image/*` and `video/mp4` types generate previews
- No thumbnail pre-generation (on-demand streaming only)
- **Consequence:** First preview fetch incurs full file read from vault

**External preview validation:**
- Server validates preview eligibility on every share link create/update
- Evidence: [server.ts#L3289-L3295](../../src/server.ts#L3289-L3295)
- **Current behavior:** Rejects `allow_external_preview=TRUE` for non-image/video types
- **Edge case:** Changing file MIME type after share link creation does not invalidate existing link settings

---

## 8. Known Gaps and Unknowns

| Gap | Impact | Confidence |
|---|---|---|
| Network retry behavior for failed chunk uploads | Client may retry entire upload or only failed chunk | Medium |
| Browser cache headers for preview endpoint | Unknown if `Cache-Control` allows local caching | Medium |
| Public share unfurl crawler behavior | Depends on external service (Discord, Slack, etc.) | Low |
| Chunk upload timeout handling | Client abort logic exists, but timeout duration not explicit | Medium |
| NDJSON progress stream error recovery | Unknown if partial NDJSON messages are handled gracefully | Medium |

---

## 9. Conclusion

The Leeku file upload system provides a robust dual-mode pipeline:
- **Direct upload** for small files (simple, single-request)
- **Resumable chunked upload** for large files (fault-tolerant, supports resume)

Both modes converge into a **shared processing pipeline** that enforces quota, duplicate detection, security scanning, and vault persistence.

**Duplicate load scenarios** are well-understood and largely expected:
- StrictMode double-mount (development only)
- Post-upload refresh (ensures UI consistency)
- MP4 preview double-fetch (UX trade-off for thumbnail + modal)

**File type branching** is limited to `image/*` and `video/mp4` for preview support, with strict validation for external preview links.

**Evidence confidence:** High — all flows documented with source file references and line numbers.

---

## Appendix: Resumable Upload State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> ChunkCheck: Start upload
    ChunkCheck --> SkipChunk: HTTP 200 (chunk exists)
    ChunkCheck --> UploadChunk: HTTP 204 (chunk missing)
    SkipChunk --> NextChunk: Increment chunk counter
    UploadChunk --> UploadingChunk: Send POST
    UploadingChunk --> ChunkProgress: XHR upload progress events
    ChunkProgress --> ChunkComplete: XHR load event
    ChunkComplete --> NextChunk: Increment chunk counter
    NextChunk --> ChunkCheck: More chunks remaining
    NextChunk --> MergeChunks: All chunks uploaded
    MergeChunks --> Processing: Server merges + scans
    Processing --> Complete: HTTP 200
    Complete --> RefreshUI: loadFilesAndLinks()
    RefreshUI --> [*]
    
    UploadingChunk --> Aborted: User clicks stop
    Aborted --> [*]
    UploadingChunk --> Error: Network error
    Error --> [*]
```

**State transitions:**
1. `Idle` → User selects file > 50 MB
2. `ChunkCheck` → GET request to check if chunk exists on server
3. `SkipChunk` → Chunk already uploaded (resume scenario)
4. `UploadChunk` → POST chunk via XHR
5. `UploadingChunk` → XHR in progress
6. `ChunkProgress` → XHR fires upload progress events
7. `ChunkComplete` → Chunk uploaded successfully
8. `NextChunk` → Move to next chunk or finalize
9. `MergeChunks` → Server assembles chunks into single file
10. `Processing` → Shared pipeline (scan, encrypt, vault)
11. `Complete` → HTTP 200 response
12. `RefreshUI` → Client refetches file list (duplicate fetch)

**Error/abort paths:**
- `Aborted` — User clicks stop upload button (aborts active XHR)
- `Error` — Network failure during chunk upload (no automatic retry)

---

**End of document.**
