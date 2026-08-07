'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'app', 'websocket-diagnose.html'), 'utf8');

assert.match(html, /makeSettingCheckbox\('Ton aus'/);
assert.match(html, /'Ton aus': 'Mute sound'/);
assert.match(html, /'Ton aus': 'Silenciar audio'/);
assert.match(html, /Mutes all sound from this web overlay/);
assert.match(html, /Silencia todo el audio de este overlay web/);
assert.match(html, /function setLinkSettingText\(element, germanText\)/);
assert.match(html, /setLinkSettingText\(status, checked \? 'An' : 'Aus'\)/);
assert.match(html, /setLinkSettingTitle\(transparentField,/);
assert.match(html, /Hides the tinted areas behind the content/);
assert.match(html, /Oculta las áreas coloreadas detrás del contenido/);
assert.doesNotMatch(html, /transparentField\.title\s*=\s*'Blendet/);
assert.doesNotMatch(html, /mutedField\.title\s*=\s*'Schaltet/);

console.log('overlay-language: OK');
