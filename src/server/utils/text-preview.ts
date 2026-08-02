import path from 'path';

export type TextPreviewKind = 'text' | 'csv';

export const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.txt', '.log', '.md', '.markdown', '.rst', '.adoc',
  '.json', '.jsonl', '.ndjson', '.geojson', '.xml', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf', '.config', '.env', '.properties',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.rb', '.php', '.java', '.c', '.h', '.cpp', '.cxx', '.hpp', '.cs',
  '.go', '.rs', '.swift', '.kt', '.kts', '.scala', '.lua', '.r', '.sql', '.graphql', '.gql',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
]);

const TEXT_PREVIEW_FILE_NAMES = new Set([
  'dockerfile', 'makefile', 'procfile',
  '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.nvmrc',
]);

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/json', 'application/ld+json', 'application/manifest+json',
  'application/xml', 'application/yaml', 'application/x-yaml', 'application/toml',
  'application/javascript', 'application/x-javascript', 'application/sql',
  'application/graphql', 'application/x-httpd-php', 'application/x-sh',
]);

export function getTextPreviewKind(fileName: string, mimeType: string): TextPreviewKind | null {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName).toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0].trim();

  if (extension === '.csv' || normalizedMimeType === 'text/csv' || normalizedMimeType === 'application/csv') {
    return 'csv';
  }
  if (
    TEXT_PREVIEW_EXTENSIONS.has(extension) ||
    TEXT_PREVIEW_FILE_NAMES.has(baseName) ||
    normalizedMimeType.startsWith('text/') ||
    TEXT_PREVIEW_MIME_TYPES.has(normalizedMimeType) ||
    normalizedMimeType.endsWith('+json') ||
    normalizedMimeType.endsWith('+xml')
  ) {
    return 'text';
  }
  return null;
}