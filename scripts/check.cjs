const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
const packagedFiles = ['manifest.json', 'content.js', 'detection.js', 'retention.js', 'protocol.js', 'popup.js', 'popup.html', 'privacy.html', ...Object.values(manifest.icons)];
for (const file of packagedFiles) {
  assert(fs.statSync(path.join(root, file)).isFile(), `Missing packaged file: ${file}`);
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}
const popup = fs.readFileSync(path.join(root, manifest.action.default_popup), 'utf8');
for (const match of popup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) assert(packagedFiles.includes(match[1]), `Unpackaged popup script: ${match[1]}`);
console.log(`Syntax and extension packaging checks passed (${packagedFiles.length} required files; original permissions unchanged).`);
