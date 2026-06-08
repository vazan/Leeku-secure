-- ============================================================
-- 01_quotas.sql
-- Creates the quotas table and seeds the five default storage tiers.
-- ============================================================

USE LeekuSecure;
GO

CREATE TABLE quotas (
    id                       NVARCHAR(50)   NOT NULL,
    name                     NVARCHAR(100)  NOT NULL,
    storage_limit_bytes      BIGINT         NOT NULL,
    max_file_size_bytes      BIGINT         NOT NULL,
    max_files                INT            NOT NULL,
    daily_upload_limit_bytes BIGINT         NOT NULL,
    created_at               DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),

    CONSTRAINT PK_quotas          PRIMARY KEY (id),
    CONSTRAINT CK_quotas_storage  CHECK (storage_limit_bytes  > 0),
    CONSTRAINT CK_quotas_filesize CHECK (max_file_size_bytes  > 0),
    CONSTRAINT CK_quotas_maxfiles CHECK (max_files            > 0)
);
GO

-- Seed: five default storage tiers
--
--  guest   →  500 MB total /  50 MB per file /   10 files
--  small   →    5 GB total / 250 MB per file /  100 files
--  big     →   25 GB total /   2 GB per file / 1 000 files
--  mega    →  100 GB total /  10 GB per file / 5 000 files
--  eternal →    1 TB total /  50 GB per file / 50 000 files
INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes)
VALUES
    ('guest',   'Guest Leek',    524288000,     52428800,    10,    104857600),
    ('small',   'Small Leek',    5368709120,    268435456,   100,   1073741824),
    ('big',     'Big Leek',      26843545600,   2147483648,  1000,  5368709120),
    ('mega',    'Mega Leek',     107374182400,  10737418240, 5000,  21474836480),
    ('eternal', 'Eternal Leek',  1099511627776, 53687091200, 50000, 107374182400);
GO

PRINT '01_quotas.sql completed.';
GO
