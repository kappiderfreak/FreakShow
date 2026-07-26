'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'EmbeddedBridge.ps1'), 'utf8');
const build = fs.readFileSync(path.join(root, 'Build.ps1'), 'utf8');
const host = fs.readFileSync(path.join(root, 'Host.cs'), 'utf8');
const packageScript = fs.readFileSync(path.join(root, 'Create-UpdatePackage.ps1'), 'utf8');
const importCode = fs.readFileSync(path.join(root, 'FreakShow-Chat-Sender.sb'), 'utf8').trim();

assert.match(settings, /id="chat-import-empty" class="chat-import-empty" hidden/);
assert.match(settings, /id="chat-import-copy-empty"/);
assert.match(settings, /id="chat-import-copy-connections"/);
assert.match(settings, /\.chat-import-plus\s*\{[\s\S]*?color:\s*var\(--kappi-accent-border/);
assert.match(settings, /\.chat-import-plus::before,[\s\S]*?transform:\s*translate\(-50%, -50%\)/);
assert.match(settings, /\.chat-import-help\s*\{[\s\S]*?width:\s*100%[\s\S]*?overflow-wrap:\s*anywhere/);
assert.match(settings, /\.chat-import-copy\s*\{[\s\S]*?border:\s*2px solid color-mix/);
assert.match(settings, /button:not\([^{}]*\):not\(\.chat-import-copy\)[^{}]*:hover/);
assert.match(settings, /function copyChatImportCode\(\)/);
assert.match(settings, /CHAT_IMPORT_CODE_URL = '\/chat-import-code'/);
assert.match(settings, /empty\.hidden = chatImportStreamerReady\(\) \|\| chatImportTwitchReady\(\) \|\| hasMessages/);

assert.match(settings, /id="video-preview-empty" class="video-preview-empty" hidden/);
assert.match(settings, /Ein komplett neuer Katalog bleibt bewusst leer/);
assert.match(settings, /video-manager-editor\.empty-catalog > \*/);
assert.match(settings, /editor\.classList\.toggle\('empty-catalog', videoOverlayItems\.length === 0\)/);
assert.match(settings, /#video-progress\[hidden\] \+ #video-settings:not\(\[hidden\]\)\s*\{[\s\S]*?margin-top:\s*auto/);
assert.match(settings, /empty\.hidden = true;\s*empty\.innerHTML = '';\s*empty\.classList\.remove\('clickable'\)/);
assert.match(settings, /return !!item && !String\(item\.videoPath \|\| ''\)\.trim\(\) && !item\.sourceFile/);

assert.match(bridge, /\[string\]\$ChatImportCode = ''/);
assert.match(bridge, /\[string\]\$OutputImportCode = ''/);
assert.match(bridge, /function Merge-StreamerBotImportCodes/);
assert.match(bridge, /\$ChatImportCode = Merge-StreamerBotImportCodes/);
assert.match(bridge, /\$path -eq '\/chat-import-code'/);
assert.match(build, /FreakShow\.ChatSenderImport/);
assert.match(build, /FreakShow\.OutputReceiverImport/);
assert.match(host, /ResourceText\("FreakShow\.ChatSenderImport"\)/);
assert.match(host, /ResourceText\("FreakShow\.OutputReceiverImport"\)/);
assert.match(packageScript, /'FreakShow-Chat-Sender\.sb'/);
assert.ok(importCode.length > 1000, 'Streamer.bot-Importcode ist unerwartet kurz');
assert.match(importCode, /^U0JBR/);

console.log('first-start-import: OK');
