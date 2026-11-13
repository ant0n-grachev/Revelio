const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.match(manifest.version, /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/, 'Use a three-part Chrome extension version');
assert.notEqual(manifest.version, '0.0.0', 'Chrome extension versions must be nonzero');
assert(manifest.version.split('.').every(part => Number(part) <= 65535), 'Chrome version components must be at most 65535');
assert.equal(packageMetadata.version, manifest.version, 'package.json version must match manifest.json');
assert.equal(lockfile.version, manifest.version, 'package-lock.json version must match manifest.json');
assert.equal(lockfile.packages?.['']?.version, manifest.version, 'package-lock.json root package version must match manifest.json');
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
console.log(`Syntax and extension packaging checks passed (${packagedFiles.length} required files; version ${manifest.version}; original permissions unchanged).`);
