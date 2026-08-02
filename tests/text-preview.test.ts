import assert from 'node:assert/strict';
import test from 'node:test';
import { getTextPreviewKind } from '../src/server/utils/text-preview.js';

test('recognizes CSV separately from other text formats', () => {
  assert.equal(getTextPreviewKind('report.csv', 'application/octet-stream'), 'csv');
  assert.equal(getTextPreviewKind('report.data', 'text/csv; charset=utf-8'), 'csv');
});

test('recognizes common text files by extension or file name', () => {
  for (const fileName of [
    'server.log', 'README.md', 'settings.yaml', 'data.json', 'schema.xml',
    'theme.css', 'main.ts', 'query.sql', 'deploy.ps1', 'Dockerfile', '.gitignore',
  ]) {
    assert.equal(getTextPreviewKind(fileName, 'application/octet-stream'), 'text', fileName);
  }
});

test('recognizes standard textual MIME types with unknown extensions', () => {
  assert.equal(getTextPreviewKind('notes.unknown', 'text/plain; charset=utf-8'), 'text');
  assert.equal(getTextPreviewKind('payload.unknown', 'application/problem+json'), 'text');
  assert.equal(getTextPreviewKind('feed.unknown', 'application/atom+xml'), 'text');
});

test('does not preview known binary formats as text', () => {
  assert.equal(getTextPreviewKind('document.pdf', 'application/pdf'), null);
  assert.equal(getTextPreviewKind('archive.zip', 'application/zip'), null);
  assert.equal(getTextPreviewKind('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null);
});