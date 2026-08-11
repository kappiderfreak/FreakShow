'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'app', 'endgame-cheatsheet.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'EmbeddedBridge.ps1'), 'utf8');

// Das Notiz-Textfeld sitzt jetzt im Reiter „Text" in der rechten Spalte, wie im
// Bubble-Editor der Videos. Links bleibt nur die Monitor-Vorschau.
assert.match(settings, /<div class="cheat-center-layout">/,
  'Notizen brauchen einen eigenen Layout-Container');
assert.match(settings, /\.cheat-center-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  'Ohne Textspalte muss der Monitorbereich einspaltig sein, sonst bleibt links eine leere Spalte');
assert.match(settings, /data-cheat-tab-panel="text"[\s\S]{0,400}?id="cheat-text"/,
  'Das Textfeld muss im Reiter „Text" liegen');
assert.match(settings, /data-cheat-tab="text"[^>]*class="video-bubble-tab is-active"|class="video-bubble-tab is-active"[^>]*data-cheat-tab="text"/,
  'Der Reiter „Text" muss der erste und beim Öffnen aktive sein');

// Reihenfolge der Reiter: Text zuerst, danach Einstellungen und Position.
const tabOrder = ['data-cheat-tab="text"', 'data-cheat-tab="look"', 'data-cheat-tab="pos"']
  .map((needle) => settings.indexOf(needle));
assert.ok(tabOrder.every((i) => i >= 0), 'Alle drei Grundreiter müssen vorhanden sein');
assert.ok(tabOrder[0] < tabOrder[1] && tabOrder[1] < tabOrder[2],
  'Reiterfolge muss Text -> Einstellungen -> Position sein');

// Design-Reiter mit derselben Aufteilung wie im Bubble-Editor.
for (const key of ['type', 'anim', 'fx']) {
  assert.match(settings, new RegExp(`data-cheat-tab-panel="${key}"`),
    `Design-Reiter ${key} muss vorhanden sein`);
}
// Drei Spalten: links Text und Gestaltung, Mitte Monitor, rechts Einstellungen.
assert.match(settings, /id="cheat-fields-host-left"/,
  'Die linke Reiter-Spalte muss vorhanden sein');
assert.match(settings, /\.cheat-editor-primary\s*\{[^}]*grid-template-columns:\s*var\(--ed-settings-w\) minmax\(0,1fr\) var\(--ed-settings-w\)/,
  'Der Editor muss dreispaltig sein: links Reiter, Mitte Monitor, rechts Reiter');
const leftHost = settings.indexOf('id="cheat-fields-host-left"');
const monitor = settings.indexOf('class="cheat-center ed-slot-monitor"');
const rightHost = settings.indexOf('id="cheat-fields-host"');
assert.ok(leftHost >= 0 && monitor >= 0 && rightHost >= 0, 'Alle drei Spalten müssen existieren');
assert.ok(leftHost < monitor && monitor < rightHost,
  'Reihenfolge muss links -> Monitor -> rechts sein');
assert.doesNotMatch(settings, /id="cheat-design-toggle"/,
  'Der Design-Knopf entfällt: die Gestaltungsreiter stehen dauerhaft links');

// Die gemeinsame Monitorberechnung muss bei Notizen die linke UND die rechte
// Einstellungs-Spalte kennen. Sonst landet die Vorschau sichtbar weiter rechts
// als bei Video, Bilder, Roter Teppich und Overlays.
assert.match(settings, /querySelector\('#video-bubble-options:not\(\[hidden\]\), #cheat-fields-host-left:not\(\[hidden\]\)'\)/,
  'Die linke Notiz-Spalte muss als fuehrende Einstellungs-Spalte verrechnet werden');
assert.doesNotMatch(settings, /applySharedMonitorGeometry\('\.cheat-monitor-fit', '#cheat-monitor', '\.cheat-editor-primary', '\.cheat-editor'\)/,
  'Die Notiz-Geometrie darf nicht versehentlich die erste (linke) .cheat-editor-Spalte als rechte Spalte messen');
assert.match(settings, /applySharedMonitorGeometry\('\.cheat-monitor-fit', '#cheat-monitor', '\.cheat-editor-primary', '#cheat-fields-host'\)/,
  'Die Notiz-Geometrie muss die rechte Einstellungs-Spalte eindeutig ueber ihre ID messen');

// Keine doppelten Feld-Kennungen nach dem Umzug der Regler.
for (const id of ['cheat-text', 'cheat-font', 'cheat-font-size', 'cheat-text-opacity', 'cheat-text-color']) {
  const hits = settings.match(new RegExp(`id="${id}"`, 'g')) || [];
  assert.equal(hits.length, 1, `Feld ${id} darf genau einmal vorkommen, gefunden: ${hits.length}`);
}

assert.doesNotMatch(settings, /\.cheat-center \.cheat-text-field\s*\{[^}]*position:\s*absolute/,
  'Das Notiz-Textfeld darf nicht absolut hinter dem Monitor liegen');

// Zusammengehörende Gestaltungsfelder teilen sich wie im Video-Bubble-Editor
// zwei Spalten, während die Reiter weiterhin die komplette Leiste füllen.
assert.match(settings, /#cheat-fields-host-left \.video-fields-tab-panel\[data-cheat-tab-panel="type"\][\s\S]{0,500}?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  'Schrift/Text-Einstellungen müssen kompakt in zwei Spalten stehen');
assert.match(settings, /\.cheat-editor \.video-bubble-tab\s*\{[\s\S]{0,180}?flex:\s*1 1 0/,
  'Notiz-Reiter müssen die vorhandene Leiste gleichmäßig ausfüllen');

// Freie Textposition muss vom Bedienfeld über Speicherung und Bridge bis zum
// echten Overlay durchgereicht werden – nicht nur in der Vorschau erscheinen.
for (const id of ['cheat-text-free-position', 'cheat-text-position-x', 'cheat-text-position-y']) {
  assert.match(settings, new RegExp(`id="${id}"`), `Bedienfeld ${id} fehlt`);
}
for (const key of ['fitText', 'textFreePosition', 'textPositionX', 'textPositionY']) {
  assert.match(settings, new RegExp(`${key}:`), `${key} fehlt im Notiz-Payload`);
  assert.match(overlay, new RegExp(`cfg\\.${key}`), `${key} wird im echten Overlay nicht verwendet`);
  assert.match(bridge, new RegExp(`\\$${key}`), `${key} wird von der Bridge nicht gespeichert`);
}

console.log('notes-responsive-layout: OK');
