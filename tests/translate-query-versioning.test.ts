/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — PostgreSQL Adapter Tests: file-versioning & soft-deletion queries
 *
 * Covers the new SQL conversions introduced by the MSSQL → PostgreSQL soft-deletion
 * and file-versioning migration (G-28):
 *   - explicit `CAST(@param AS uuid)` for nullable params in `IS NULL` predicates
 *     (node-postgres sends params without type OIDs; PG cannot infer the type of a
 *     NULL parameter — fix commit ee62ac0)
 *   - native `RETURNING` support (ADR-1) — passed through unchanged
 *   - the file_versions / file_version_keys / trash queries used by the feature
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { sql, PgRequest, translateQuery } = await import('../src/server/db.js');

function run(queryText: string, inputs: Array<[string, unknown]>) {
  const req = new PgRequest();
  for (const [name, value] of inputs) req.input(name, value);
  return translateQuery(queryText, req['params']);
}

test('translateQuery - CAST(@param AS uuid) is preserved (nullable param inference fix, ee62ac0)', () => {
  // Root-cause reproducer: `((@folderId IS NULL AND folder_id IS NULL) OR folder_id=@folderId)`
  // — the param's first occurrence is inside IS NULL, so PG cannot infer uuid when NULL.
  const { text, values } = run(
    `SELECT id, version_count
     FROM files
     WHERE owner_user_id=@ownerId
       AND ((CAST(@folderId AS uuid) IS NULL AND folder_id IS NULL) OR folder_id=CAST(@folderId AS uuid))
       AND deleted_at IS NULL`,
    [['ownerId', 'user-1'], ['folderId', null]]
  );
  assert.ok(text.includes('CAST($2 AS uuid)'), 'CAST(@folderId AS uuid) -> CAST($2 AS uuid)');
  assert.ok(text.includes('$1'), 'ownerId -> $1');
  assert.strictEqual(values[0], 'user-1');
  assert.strictEqual(values[1], null, 'null folderId value is preserved');
});

test('translateQuery - CAST(@parentFolderId AS uuid) for root folder creation (ee62ac0)', () => {
  const { text, values } = run(
    `SELECT id FROM file_folders
     WHERE owner_user_id=@ownerId AND parent_folder_id=CAST(@parentFolderId AS uuid) AND name=@name`,
    [['ownerId', 'user-1'], ['parentFolderId', null], ['name', 'Root']]
  );
  assert.ok(text.includes('CAST($2 AS uuid)'));
  assert.strictEqual(values[1], null);
});

test('translateQuery - native RETURNING is passed through unchanged (ADR-1)', () => {
  const { text } = run(
    `INSERT INTO files (id, stored_path, version_count)
     VALUES (@id, @path, 1)
     RETURNING id, version_count`,
    [['id', 'uuid-1'], ['path', '/vault/a.bin']]
  );
  assert.ok(/RETURNING\s+id,\s*version_count/.test(text), 'RETURNING clause preserved');
  assert.ok(!text.includes('OUTPUT'), 'no redundant OUTPUT conversion');
});

test('translateQuery - file_versions INSERT (archive current version)', () => {
  const { text, values } = run(
    `INSERT INTO file_versions
      (id,file_id,version_no,stored_path,mime_type,size_bytes,status,checksum_sha256,created_at)
     VALUES (@archiveId,@fileId,@versionNo,@spath,@mime,@sz,'Available',@chk,SYSDATETIMEOFFSET())`,
    [
      ['archiveId', 'uuid-arch'], ['fileId', 'uuid-file'], ['versionNo', 2],
      ['spath', '/vault/old.bin'], ['mime', 'text/plain'], ['sz', 42], ['chk', 'a'.repeat(64)],
    ]
  );
  assert.ok(text.includes('INTO file_versions'));
  assert.ok(text.includes('CURRENT_TIMESTAMP'), 'SYSDATETIMEOFFSET() -> CURRENT_TIMESTAMP');
  // Parameters are positional and deduplicated in first-appearance order.
  assert.strictEqual(values.length, 7);
  assert.strictEqual(values[2], 2);
});

test('translateQuery - trash list query (deleted_at IS NOT NULL)', () => {
  const { text } = run(
    `SELECT id, stored_path, deleted_at, version_count
     FROM files
     WHERE owner_user_id=@ownerId AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`,
    [['ownerId', 'user-1']]
  );
  assert.ok(text.includes('deleted_at IS NOT NULL'));
  assert.ok(text.includes('ORDER BY deleted_at DESC'));
  assert.ok(!text.includes('[dbo].'));
});

test('translateQuery - version soft-delete + version trash join', () => {
  const { text, values } = run(
    `SELECT v.id, v.version_no, v.created_at, v.deleted_at, f.original_name_encrypted
     FROM file_versions v
     JOIN files f ON f.id = v.file_id
     WHERE f.owner_user_id=@ownerId AND v.deleted_at IS NOT NULL
     ORDER BY v.deleted_at DESC`,
    [['ownerId', 'user-1']]
  );
  assert.ok(text.includes('FROM file_versions v'));
  assert.ok(text.includes('JOIN files f'));
  assert.ok(text.includes('v.deleted_at IS NOT NULL'));
  assert.strictEqual(values.length, 1);
});

test('translateQuery - purge scan with interval expression', () => {
  const { text, values } = run(
    `SELECT id FROM files
     WHERE deleted_at IS NOT NULL AND deleted_at<=@cutoff`,
    [['cutoff', new Date('2026-08-03T00:00:00Z')]]
  );
  assert.ok(text.includes('deleted_at<=$1'));
  assert.ok(values[0] instanceof Date);
});

test('translateQuery - missing bound parameter throws (guards null-param regressions)', () => {
  const req = new PgRequest();
  req.input('fileId', 'uuid-1');
  assert.throws(() => {
    req.translateQuery('SELECT * FROM file_versions WHERE file_id=@fileId AND id=@vid', req['params']);
  }, /Missing bound parameter: vid/);
});
