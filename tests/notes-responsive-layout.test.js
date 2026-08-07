'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');

assert.match(settings, /<div class="cheat-center-layout">/,
  'Notizen brauchen einen eigenen responsiven Layout-Container');
assert.match(settings, /\.cheat-center-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(260px, 340px\) minmax\(0, 1fr\)/,
  'Textfeld und Monitor müssen getrennte Grid-Spalten besitzen');
assert.match(settings, /@container\s*\(max-width:\s*860px\)\s*\{[\s\S]*?\.cheat-center-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/,
  'Bei wenig Platz müssen Textfeld und Monitor untereinander stehen');
assert.doesNotMatch(settings, /\.cheat-center \.cheat-text-field\s*\{[^}]*position:\s*absolute/,
  'Das Notiz-Textfeld darf nicht mehr absolut hinter dem Monitor liegen');
assert.match(settings, /\.cheat-center \.cheat-text-field\s*\{[\s\S]*?position:\s*relative/,
  'Das Notiz-Textfeld muss im normalen Layoutfluss bleiben');
assert.match(settings, /\.cheat-center-layout > \.cheat-text-field:not\(\[hidden\]\)/,
  'Die Monitorberechnung muss die Textspalte berücksichtigen');
assert.match(settings, /Math\.abs\(cheatTextRect\.top - cheatMonitorRect\.top\) < 4/,
  'Gestapelte und nebeneinanderliegende Notizen müssen unterschieden werden');

console.log('notes-responsive-layout: OK');
