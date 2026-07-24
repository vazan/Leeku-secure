import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveVaultArtifactPath } from '../src/server/routes/desktop-updates.js';

test('resolves current and legacy stored paths inside the Leeku vault', () => {
  const vaultRoot = path.resolve('test-vault');

  assert.equal(
    resolveVaultArtifactPath(vaultRoot, 'artifact.vault'),
    path.join(vaultRoot, 'artifact.vault'),
  );
  assert.equal(
    resolveVaultArtifactPath(vaultRoot, `${path.sep}artifact.vault`),
    path.join(vaultRoot, 'artifact.vault'),
  );
  assert.equal(
    resolveVaultArtifactPath(vaultRoot, `release${path.sep}artifact.vault`),
    path.join(vaultRoot, 'release', 'artifact.vault'),
  );
});

test('rejects stored paths that could escape the Leeku vault', () => {
  const vaultRoot = path.resolve('test-vault');

  assert.equal(resolveVaultArtifactPath(vaultRoot, ''), null);
  assert.equal(resolveVaultArtifactPath(vaultRoot, '..'), null);
  assert.equal(resolveVaultArtifactPath(vaultRoot, `..${path.sep}artifact.vault`), null);
  assert.equal(resolveVaultArtifactPath(vaultRoot, 'C:\\outside.vault'), null);
});
