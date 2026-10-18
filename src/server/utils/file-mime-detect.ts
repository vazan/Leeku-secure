import fs from 'fs';

// Magic bytes for common file types
interface FileSignature {
  mimeType: string;
  signature: Buffer;
  offset?: number;
}

const fileSignatures: FileSignature[] = [
  // Images
  { mimeType: 'image/jpeg', signature: Buffer.from([0xFF, 0xD8, 0xFF]) },
  { mimeType: 'image/png', signature: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) },
  { mimeType: 'image/gif', signature: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) }, // GIF87a
  { mimeType: 'image/gif', signature: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) }, // GIF89a
  { mimeType: 'image/webp', signature: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]) }, // RIFF....WEBP
  { mimeType: 'image/bmp', signature: Buffer.from([0x42, 0x4D]) }, // BM
  { mimeType: 'image/tiff', signature: Buffer.from([0x49, 0x49, 0x2A, 0x00]) }, // Little-endian TIFF
  { mimeType: 'image/tiff', signature: Buffer.from([0x4D, 0x4D, 0x00, 0x2A]) }, // Big-endian TIFF
  { mimeType: 'image/svg+xml', signature: Buffer.from([0x3C, 0x3F, 0x78, 0x6D, 0x6C]) }, // <?xml
  { mimeType: 'image/svg+xml', signature: Buffer.from([0x3C, 0x73, 0x76, 0x67]) }, // <svg

  // Documents
  { mimeType: 'application/pdf', signature: Buffer.from([0x25, 0x50, 0x44, 0x46]) }, // %PDF
  { mimeType: 'application/zip', signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }, // ZIP
  { mimeType: 'application/zip', signature: Buffer.from([0x50, 0x4B, 0x05, 0x06]) }, // Empty ZIP
  { mimeType: 'application/zip', signature: Buffer.from([0x50, 0x4B, 0x07, 0x08]) }, // ZIP spanned

  // Microsoft Office formats (based on OLE2/Compound File Binary)
  { mimeType: 'application/msword', signature: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) }, // .doc
  { mimeType: 'application/vnd.ms-excel', signature: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) }, // .xls
  { mimeType: 'application/vnd.ms-powerpoint', signature: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) }, // .ppt

  // Open Office / Libre Office (based on ZIP)
  { mimeType: 'application/vnd.oasis.opendocument.text', signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }, // .odt (ZIP-based)
  { mimeType: 'application/vnd.oasis.opendocument.spreadsheet', signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }, // .ods (ZIP-based)
  { mimeType: 'application/vnd.oasis.opendocument.presentation', signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }, // .odp (ZIP-based)

  // Audio
  { mimeType: 'audio/mpeg', signature: Buffer.from([0xFF, 0xFB]) }, // MP3
  { mimeType: 'audio/mpeg', signature: Buffer.from([0xFF, 0xF3]) }, // MP3
  { mimeType: 'audio/mpeg', signature: Buffer.from([0xFF, 0xF2]) }, // MP3
  { mimeType: 'audio/mp4', signature: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41, 0x20]) }, // M4A/MP4
  { mimeType: 'audio/wav', signature: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]) }, // RIFF....WAVE
  { mimeType: 'audio/flac', signature: Buffer.from([0x66, 0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]) }, // fLaC
  { mimeType: 'audio/ogg', signature: Buffer.from([0x4F, 0x67, 0x67, 0x53]) }, // OggS

  // Video
  { mimeType: 'video/mp4', signature: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41, 0x20]) }, // M4A/MP4
  { mimeType: 'video/mpeg', signature: Buffer.from([0x00, 0x00, 0x01, 0xB6]) }, // MPEG
  { mimeType: 'video/quicktime', signature: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]) }, // qt
  { mimeType: 'video/x-ms-wmv', signature: Buffer.from([0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]) }, // WMV
  { mimeType: 'video/x-matroska', signature: Buffer.from([0x1A, 0x45, 0xDF, 0xA3]) }, // Matroska

  // Text/Code
  { mimeType: 'text/plain', signature: Buffer.from([0xEF, 0xBB, 0xBF]) }, // UTF-8 BOM (fallback, checked last)
  { mimeType: 'application/json', signature: Buffer.from([0x7B, 0x22]) }, // {"
  { mimeType: 'application/xml', signature: Buffer.from([0x3C, 0x3F, 0x78, 0x6D, 0x6C]) }, // <?xml
  { mimeType: 'text/html', signature: Buffer.from([0x3C, 0x21, 0x44, 0x4F, 0x43, 0x54, 0x59, 0x50, 0x45]) }, // <!DOCTYPE
  { mimeType: 'text/html', signature: Buffer.from([0x3C, 0x68, 0x74, 0x6D, 0x6C]) }, // <html
  { mimeType: 'text/html', signature: Buffer.from([0x3C, 0x68, 0x65, 0x61, 0x64]) }, // <head
  { mimeType: 'text/html', signature: Buffer.from([0x3C, 0x74, 0x69, 0x74, 0x6C, 0x65]) }, // <title
  { mimeType: 'text/css', signature: Buffer.from([0x2A, 0x2F, 0x2A]) }, // /*
  { mimeType: 'text/javascript', signature: Buffer.from([0x66, 0x75, 0x6E, 0x63, 0x74, 0x69, 0x6F, 0x6E]) }, // function
];

/**
 * Detect MIME type from file content (magic bytes)
 * @param filePath Path to the file to analyze
 * @returns Detected MIME type, or null if unable to detect
 */
export function detectFileMime(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;

    // Read enough bytes to check all signatures (max 512 bytes should be enough)
    const bufferSize = 512;
    const buffer = Buffer.alloc(bufferSize);
    const fd = fs.openSync(filePath, 'r');
    try {
      const bytesRead = fs.readSync(fd, buffer, 0, bufferSize, 0);
      if (bytesRead === 0) return null;

      // Trim buffer to actual bytes read
      const data = buffer.slice(0, bytesRead);

      // Check each signature
      for (const sig of fileSignatures) {
        const sigOffset = sig.offset ?? 0;
        if (bytesRead >= sig.length + sigOffset) {
          const slice = data.slice(sigOffset, sigOffset + sig.length);
          if (slice.equals(sig.signature)) {
            return sig.mimeType;
          }
        }
      }

      // Additional checks for text files (check if readable text)
      const textContent = data.toString('utf-8').trim();
      if (textContent.startsWith('<?xml')) return 'application/xml';
      if (textContent.startsWith('<!DOCTYPE')) return 'text/html';
      if (textContent.startsWith('<html') || textContent.startsWith('<head') || textContent.startsWith('<title')) return 'text/html';
      if (textContent.startsWith('/*')) return 'text/css';
      if (textContent.startsWith('function') || textContent.startsWith('const ') || textContent.startsWith('let ') || textContent.startsWith('var ')) return 'text/javascript';

      // Check for UTF-8 BOM at start (after other signatures have been checked)
      if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
        // This is likely text, but could be any text format
        // Don't default to text/plain here as it's too generic
      }

      return null;
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    console.error(`[detectFileMime] Error detecting MIME type for ${filePath}:`, error);
    return null;
  }
}

/**
 * Get a list of possible MIME types based on file extension
 * Used as a fallback when magic byte detection is inconclusive
 */
export function getMimeTypesByExtension(fileName: string): string[] {
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.split('.').pop() || '';

  const extensionMap: Record<string, string[]> = {
    // Images
    jpg: ['image/jpeg'],
    jpeg: ['image/jpeg'],
    png: ['image/png'],
    gif: ['image/gif'],
    webp: ['image/webp'],
    bmp: ['image/bmp'],
    tiff: ['image/tiff'],
    tif: ['image/tiff'],
    svg: ['image/svg+xml'],

    // Documents
    pdf: ['application/pdf'],
    doc: ['application/msword'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xls: ['application/vnd.ms-excel'],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ppt: ['application/vnd.ms-powerpoint'],
    pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],

    // Archives
    zip: ['application/zip'],
    rar: ['application/vnd.rar'],
    tar: ['application/x-tar'],
    gz: ['application/gzip'],
    bz2: ['application/x-bzip2'],
    "7z": ['application/x-7z-compressed'],

    // Audio
    mp3: ['audio/mpeg'],
    wav: ['audio/wav'],
    ogg: ['audio/ogg'],
    flac: ['audio/flac'],
    m4a: ['audio/mp4'],
    aac: ['audio/aac'],

    // Video
    mp4: ['video/mp4'],
    mkv: ['video/x-matroska'],
    webm: ['video/webm'],
    mov: ['video/quicktime'],
    avi: ['video/x-msvideo'],
    wmv: ['video/x-ms-wmv'],

    // Code
    js: ['text/javascript', 'application/javascript'],
    ts: ['text/typescript', 'application/typescript'],
    jsx: ['text/javascript', 'application/javascript'],
    tsx: ['text/typescript', 'application/typescript'],
    py: ['text/x-python', 'application/x-python'],
    java: ['text/x-java'],
    c: ['text/x-c'],
    cpp: ['text/x-c++'],
    h: ['text/x-c-header'],
    css: ['text/css'],
    html: ['text/html'],
    htm: ['text/html'],
    xml: ['application/xml', 'text/xml'],
    json: ['application/json'],
    sql: ['application/sql'],
    md: ['text/markdown', 'text/x-markdown'],

    // Text
    txt: ['text/plain'],
  };

  return extensionMap[extension] || [];
}
