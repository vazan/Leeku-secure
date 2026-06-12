export interface DownloadProgress {
  loaded: number;
  total: number;
}

interface DownloadOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  onProgress: (progress: DownloadProgress) => void;
}

async function responseError(xhr: XMLHttpRequest) {
  try {
    const text =
      xhr.response instanceof Blob ? await xhr.response.text() : xhr.responseText;
    return JSON.parse(text || "{}").error || "Download unavailable.";
  } catch {
    return "Download unavailable.";
  }
}

export function downloadWithProgress(
  url: string,
  fileName: string,
  options: DownloadOptions,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || "GET", url);
    Object.entries(options.headers || {}).forEach(([name, value]) =>
      xhr.setRequestHeader(name, value),
    );
    xhr.responseType = "blob";
    xhr.onprogress = (event) => {
      options.onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
      });
    };
    xhr.onload = async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(await responseError(xhr)));
        return;
      }
      const objectUrl = URL.createObjectURL(xhr.response);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      resolve();
    };
    xhr.onerror = () => reject(new Error("Download interrupted."));
    xhr.onabort = () => reject(new Error("Download cancelled."));
    xhr.send(options.body);
  });
}
