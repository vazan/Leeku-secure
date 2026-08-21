const VIDEO_EMBED_WARNING_SIZE_BYTES = 50 * 1024 * 1024;
const VIDEO_EMBED_MAX_SIZE_BYTES = 950 * 1024 * 1024;

export function exceedsVideoEmbedSizeLimit({
  mime_type,
  size,
}: {
  mime_type?: string | null;
  size?: number | null;
}): boolean {
  return (
    (mime_type ?? "").trim().toLowerCase().startsWith("video/") &&
    Number(size ?? 0) > VIDEO_EMBED_MAX_SIZE_BYTES
  );
}

export function shouldShowVideoEmbedWarning({
  mime_type,
  size,
  allowExternalPreview,
  allowDecryptedExternalPreview,
}: {
  mime_type?: string | null;
  size?: number | null;
  allowExternalPreview: boolean;
  allowDecryptedExternalPreview: boolean;
}): boolean {
  if (!allowExternalPreview || !allowDecryptedExternalPreview) {
    return false;
  }

  const mime = (mime_type ?? "").trim().toLowerCase();
  const fileSizeBytes = Number(size ?? 0);

  return (
    mime.startsWith("video/") &&
    mime !== "video/mp4" &&
    fileSizeBytes >= VIDEO_EMBED_WARNING_SIZE_BYTES
  );
}

export function getVideoEmbedWarningMessage(): string {
  return "Video playback may not display correctly in embeds because this file format is not MP4.";
}

export function getVideoEmbedSizeLimitMessage(): string {
  return "Only video files under 950 MB can be used for embeds.";
}
