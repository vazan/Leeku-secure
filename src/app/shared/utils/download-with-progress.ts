export interface DownloadProgress {
  loaded: number;
  total: number;
}

interface DownloadOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}

async function responseError(response: Response) {
  try {
    const text = await response.text();
    return JSON.parse(text || "{}").error || "Download unavailable.";
  } catch {
    return "Download unavailable.";
  }
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function downloadWithProgress(
  url: string,
  fileName: string,
  options: DownloadOptions,
) {
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(await responseError(response));
    }

    const headerTotal = Number(response.headers.get("Content-Length") || "0");
    const total = Number.isFinite(headerTotal) ? headerTotal : 0;
    const reader = response.body?.getReader();

    if (!reader) {
      const blob = await response.blob();
      options.onProgress({ loaded: blob.size, total: total || blob.size });
      triggerBrowserDownload(blob, fileName);
      return;
    }

    const chunks: BlobPart[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const normalizedChunk = new Uint8Array(value.byteLength);
      normalizedChunk.set(value);

      chunks.push(normalizedChunk.buffer);
      loaded += normalizedChunk.byteLength;
      options.onProgress({ loaded, total });
    }

    const blob = new Blob(chunks, {
      type: response.headers.get("Content-Type") || "application/octet-stream",
    });
    options.onProgress({ loaded, total: total || loaded });
    triggerBrowserDownload(blob, fileName);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Download cancelled.");
    }
    if (error instanceof Error) throw error;
    throw new Error("Download interrupted.");
  }
}
