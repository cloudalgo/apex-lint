import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemMetadataProvider } from '../../src/metadata/filesystem-provider.js';

test('FilesystemMetadataProvider: finds objects and survives a symlink cycle', () => {
  const root = mkdtempSync(join(tmpdir(), 'apexlint-proj-'));
  const objects = join(root, 'force-app', 'main', 'default', 'objects');
  mkdirSync(join(objects, 'Account', 'fields'), { recursive: true });
  writeFileSync(join(objects, 'Account', 'fields', 'Name__c.field-meta.xml'), '<type>Text</type>');
  try { symlinkSync(root, join(root, 'force-app', 'loop'), 'dir'); } catch { /* skip if unsupported */ }

  const provider = new FilesystemMetadataProvider([root]);
  assert.equal(provider.hasObject('Account'), true);
  assert.equal(provider.getObject('account')?.fields.get('name__c')?.type, 'Text');
});
