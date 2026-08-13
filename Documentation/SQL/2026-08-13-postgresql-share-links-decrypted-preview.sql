-- ============================================================
-- PostgreSQL migration: share_links external preview flags
-- Date: 2026-08-13
-- Purpose:
--   - Ensure share_links has allow_external_preview and
--     allow_decrypted_external_preview
--   - Backfill both columns to FALSE and enforce NOT NULL defaults
-- ============================================================

ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS allow_external_preview BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS allow_decrypted_external_preview BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE share_links
SET allow_external_preview = FALSE
WHERE allow_external_preview IS NULL;

UPDATE share_links
SET allow_decrypted_external_preview = FALSE
WHERE allow_decrypted_external_preview IS NULL;

ALTER TABLE share_links
  ALTER COLUMN allow_external_preview SET DEFAULT FALSE;

ALTER TABLE share_links
  ALTER COLUMN allow_external_preview SET NOT NULL;

ALTER TABLE share_links
  ALTER COLUMN allow_decrypted_external_preview SET DEFAULT FALSE;

ALTER TABLE share_links
  ALTER COLUMN allow_decrypted_external_preview SET NOT NULL;