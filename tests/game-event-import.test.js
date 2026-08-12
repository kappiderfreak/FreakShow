'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read(path.join('app', 'websocket-diagnose.html'));
const bridge = read('EmbeddedBridge.ps1');
const build = read('Build.ps1');
const encoded = read('FreakShow-Process-Event.sb').trim();

assert.match(html, /id="btn-game-event-import-copy"/);
assert.match(html, /GAME_EVENT_IMPORT_CODE_URL\s*=\s*'\/game-event-import-code'/);
assert.match(html, /FreakShow - Process Event/);
assert.match(html, /FreakShow - Just Chatting/);
assert.match(bridge, /\$path -eq '\/game-event-import-code'/);
assert.match(build, /FreakShow\.ProcessEventImport/);

const payload = Buffer.from(encoded, 'base64');
assert.equal(payload.subarray(0, 4).toString('ascii'), 'SBAE');
const parsed = JSON.parse(zlib.gunzipSync(payload.subarray(4)).toString('utf8'));
const names = parsed.data.actions.map(action => action.name).sort();
assert.deepEqual(names, ['FreakShow - Just Chatting', 'FreakShow - Process Event']);

console.log('game-event-import: OK');
