# Upload Flow Mermaid Analysis

Date: 2026-07-20

This document maps the file upload paths in the app and highlights where repeated loading can happen. The goal is to make the direct upload path, resumable upload path, and preview path visible in one place so duplicate fetches are easy to spot.

## Scope

Confirmed evidence points to these implementation surfaces:

- [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx)
- [src/server.ts](../../src/server.ts)
- [src/client.tsx](../../src/client.tsx)

Key behavior:

- Small files use a direct multipart upload.
- Large files use a resumable chunked upload.
- Both paths converge into the same server-side processing pipeline.
- Images and MP4 files are previewable; other MIME types are not.
- MP4 previews can be fetched twice: once for the thumbnail and again for the video modal.
- Development StrictMode can double-run mount-time effects.

## File Type View

| Type | Upload path impact | Preview behavior |
|---|---|---|
| `image/*` | Upload path is the same as other files; size decides direct vs resumable | Previewable inline |
| `video/mp4` | Upload path is the same as other files; size decides direct vs resumable | Previewable inline and in modal |
| Other MIME types | Upload path is the same as other files; size decides direct vs resumable | Not previewable inline |

Evidence:

- Preview gating in the UI uses `image/*` and `video/mp4` checks in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L2299)
- Preview enforcement on the server only allows images and MP4 in [src/server.ts](../../src/server.ts#L2801)

## Mermaid: End-to-End Upload Overview

```mermaid
flowchart TD
    A[User selects files] --> B{File size <= 50 MB?}
    B -->|Yes| C[Direct multipart upload]
    B -->|No| D[Resumable chunked upload]

    D --> D1[GET /api/files/upload<br/>chunk existence check]
    D1 -->|Chunk missing| D2[POST /api/files/upload<br/>chunk upload]
    D1 -->|Chunk already present| D3[Skip chunk]
    D2 --> D4[Store chunk on disk]
    D4 --> D5{All chunks received?}
    D5 -->|No| D6[Wait for next chunk]
    D5 -->|Yes| D7[Merge chunks into temp file]

    C --> E[Shared server processing pipeline]
    D7 --> E

    E --> F[Quota checks]
    F --> G[Secret-key checks]
    G --> H[Security scan]
    H --> I[Encryption and vault write]
    I --> J[Insert file record]
    J --> K[Update storage usage]
    K --> L[Return file metadata]
    L --> M[Client refreshes lists]
```

Evidence:

- Direct upload and resumable upload logic in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L580)
- Shared upload dispatcher and pipeline in [src/server.ts](../../src/server.ts#L2190)
- Chunk existence check in [src/server.ts](../../src/server.ts#L2210)

## Mermaid: Direct vs Resumable Upload

```mermaid
sequenceDiagram
    participant U as Browser
    participant S as Server
    participant M as Multer
    participant C as Chunk Store
    participant P as Shared Pipeline

    alt Direct upload
        U->>S: POST multipart/form-data
        S->>M: upload.single("file")
        M->>S: req.file ready
        S->>P: continue with shared processing
    else Resumable upload
        loop each chunk
            U->>S: GET /api/files/upload?resumableIdentifier=...&resumableChunkNumber=N
            alt chunk already exists
                S-->>U: 200 skip
            else chunk missing
                S-->>U: 204 upload needed
                U->>S: POST /api/files/upload?resumableIdentifier=...&resumableChunkNumber=N
                S->>C: persist chunk N
                S->>S: count received chunks
            end
        end
        S->>S: merge chunks when complete
        S->>P: continue with shared processing
    end

    P-->>U: success response + file metadata
```

Evidence:

- Client-side resumable loop in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L580)
- Server-side resumable chunk handling in [src/server.ts](../../src/server.ts#L2261)
- Shared processing after upload in [src/server.ts](../../src/server.ts#L2398)

## Mermaid: Where Duplicate Loads Can Happen

```mermaid
flowchart TD
    A[Initial dashboard mount] --> B{React StrictMode in dev?}
    B -->|Yes| C[Mount effect can run twice]
    B -->|No| D[Normal single mount]

    C --> E[loadFilesAndLinks()]
    D --> E

    E --> F[GET /api/files]
    E --> G[GET /api/sharing/links]
    E --> H[GET /api/file-folders]

    I[Upload completes] --> J[loadFilesAndLinks() runs again]
    J --> F
    J --> G
    J --> H

    K[Open MP4 thumbnail] --> L[GET /api/files/:id/preview]
    L --> M[Open video modal]
    M --> N[GET /api/files/:id/preview again]
```

Evidence:

- Dashboard mount effect calls refresh functions in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L441)
- StrictMode wraps the app in [src/client.tsx](../../src/client.tsx#L1)
- Upload completion refreshes the lists in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L787)
- Thumbnail preview fetch happens in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L2299)
- Video modal uses the same preview route in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L2612)

## Mermaid: Preview Branching

```mermaid
flowchart TD
    A[File row rendered] --> B{mime_type starts with image/?}
    B -->|Yes| C[Inline image preview]
    B -->|No| D{mime_type == video/mp4?}
    D -->|Yes| E[Inline MP4 thumbnail preview]
    D -->|No| F[Fallback file icon]

    E --> G{User opens modal?}
    G -->|Yes| H[Video player fetches same preview URL again]
    G -->|No| I[No second fetch]
```

Evidence:

- UI preview branch in [src/app/features/files/pages/user-dashboard.tsx](../../src/app/features/files/pages/user-dashboard.tsx#L2299)
- Server preview gate in [src/server.ts](../../src/server.ts#L2801)

## What This Shows

1. The upload path itself is not type-based in the transport layer; file size selects direct or resumable.
2. The same file can trigger more than one fetch after upload because the client refreshes the full file list.
3. MP4 files can be fetched twice for preview, once in the thumbnail and once in the modal.
4. Development StrictMode can add another duplicate load on mount, but that is a dev-only behavior.

## Notes

- `⚠️ INFERRED`: The duplicate load risk is a behavior analysis, not a declared bug in the code.
- `✅ CONFIRMED`: The upload, refresh, preview, and StrictMode entry points are present in the codebase.
