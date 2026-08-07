'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
}

const html = read('app/websocket-diagnose.html');
const bridge = read('EmbeddedBridge.ps1');
const links = read('app/external-overlay-links.js');
const images = read('app/overlay-images.js');
const notes = read('app/endgame-cheatsheet.js');
const carpet = read('app/emote-rain-user.js');

// Separate Skalierung in allen visuellen Overlay-Editoren, Videos ausgenommen.
assert.match(html, /id="image-content-scale"[^>]*min="25"[^>]*max="200"/);
assert.match(html, /id="cheat-content-scale"[^>]*min="25"[^>]*max="200"/);
assert.match(html, /id="er-content-scale"[^>]*min="25"[^>]*max="200"/);
assert.match(html, /makeSettingRange\('Skalierung', item\.contentScale/);
assert.doesNotMatch(html, /id="video-content-scale"/);
assert.doesNotMatch(html, /videoContentScale/);

// Der Wert wird dauerhaft und mit sicherem Standardwert 100 % gespeichert.
assert.match(bridge, /contentScale = Clamp-Int[^\r\n]*Fallback 100[^\r\n]*Min 25[^\r\n]*Max 200/);
assert.match(bridge, /"contentScale":/);

// Alle echten Ausgaben werten den Wert aus; Web-Overlays skalieren ihr
// Original-Layout statt lediglich die sichtbare Box neu umbrechen zu lassen.
assert.match(links, /frame\.style\.transform = contentScale === 1 \? 'none' : \('scale\('/);
assert.match(links, /transformOrigin = '0 0'/);
assert.match(html, /function clampLinkAreaToMonitor\(item, area\)/);
assert.match(html, /MONITOR_WIDTH - area\.width \* factor/);
assert.match(html, /monitor\.monitorWidth - startArea\.width \* contentFactor/);
assert.match(links, /sourceWidth - baseWidth \* contentScale/);
assert.match(images, /Number\(im\.width \|\| 0\) \* contentScale/);
assert.match(notes, /cfg\.width[^\r\n]*\* contentScale/);
assert.match(carpet, /copy\.size[^\r\n]*\* \(copy\.contentScale \/ 100\)/);

// Neue Bezeichnung folgt der vorhandenen deutschen, englischen und spanischen UI.
assert.match(html, /'Skalierung': 'Content scale'/);
assert.match(html, /'Skalierung': 'Escala del contenido'/);

console.log('overlay-content-scale: OK');
