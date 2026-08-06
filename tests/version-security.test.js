'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read(path.join('app', 'websocket-diagnose.html'));
const bridge = read('EmbeddedBridge.ps1');
const updateManifest = JSON.parse(read('update-manifest.json'));

assert.equal(read('VERSION.txt').trim(), '1.3.1');
assert.match(read('VersionInfo.cs'), /AssemblyFileVersion\("1\.3\.1\.0"\)/);
assert.match(read('VersionInfo.cs'), /Current = "1\.3\.1"/);
assert.match(read('UpdaterVersionInfo.cs'), /AssemblyInformationalVersion\("1\.3\.1"\)/);
assert.match(read('README-FIRST.txt'), /^FreakShow 1\.3\.1/m);
assert.equal(updateManifest.version, '1.3.1');
assert.match(updateManifest.packageUrl, /\/v1\.3\.1\/FreakShow-update-1\.3\.1\.zip$/);

assert.match(
  html,
  /<script src="\/app\/overlay-link-recognizer\.js\?v=[^"]+"><\/script>/
);
assert.doesNotMatch(html, /<script src="overlay-link-recognizer\.js/);

assert.match(html, /window\.BRIDGE_CONTROL_TOKEN = '__BRIDGE_CONTROL_TOKEN__'/);
assert.match(html, /installBridgeWriteProtection/);
assert.match(html, /X-Kappi-Token/);
assert.match(bridge, /\$runtimePostPaths = @\(/);
assert.match(bridge, /not \(Test-ControlToken -Headers \$headers\)/);
assert.match(bridge, /Get-CorsResponseHeaders/);
assert.doesNotMatch(bridge, /Access-Control-Allow-Origin: \*/);
assert.match(bridge, /leer = nur dieser PC/);

assert.match(bridge, /ProtectedData\]::Protect/);
assert.match(bridge, /ProtectedData\]::Unprotect/);
assert.match(bridge, /ui-private-state/);
assert.match(html, /\/ui-private-state\?t=/);

// Inline-Skripte kompilieren. Das entdeckt unter anderem versehentlich fehlende
// Klammern in der sehr grossen Steuerdatei.
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(inlineScripts.length > 0);
for (let index = 0; index < inlineScripts.length; index += 1) {
  try {
    new Function(inlineScripts[index][1]);
  } catch (error) {
    throw new Error(`Inline-Skript ${index} ist ungueltig: ${error.message}`);
  }
}

console.log('version-security: OK');
