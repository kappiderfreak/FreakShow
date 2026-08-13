const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');

assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?\.video-editor-primary,[\s\S]*?\.image-editor-primary,[\s\S]*?\.er-editor-primary,[\s\S]*?\.cheat-editor-primary/,
  'Der gemeinsame Zwischenbreiten-Breakpoint muss alle grossen Editoren stapeln.'
);
assert.match(
  html,
  /matchMedia\('\(max-width: 2100px\)'\)/,
  'Die Monitor-Geometrie muss denselben Breakpoint wie das CSS verwenden.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?\.workspace-main\s*\{[\s\S]*?height:\s*auto\s*!important;[\s\S]*?overflow:\s*visible\s*!important;/,
  'Gestapelte Editoren muessen mit der Seite wachsen, statt eine zweite Scrollleiste zu erzeugen.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?body\.left-nav-collapsed \.video-manager,[\s\S]*?body\.left-nav-collapsed \.emoterain-manager\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/,
  'Ohne Gruppenleiste muessen alle Manager auf ein echtes Einspaltenraster wechseln.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?body\.left-nav-collapsed \.video-manager-nav,[\s\S]*?body\.left-nav-collapsed \.link-nav\s*\{[\s\S]*?display:\s*none\s*!important;/,
  'Eine eingeklappte Gruppenleiste darf im kompakten Layout keine unsichtbare Rasterzeile behalten.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?\.video-manager,[\s\S]*?\.emoterain-manager,[\s\S]*?\.cheat-manager,[\s\S]*?#workspace-view-links \.link-browser,[\s\S]*?#workspace-view-images \.link-browser\.image-browser\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/,
  'Ab halber Ultrawide-Breite muessen die Gruppenlisten aller Tabs ueber ihren Editoren stehen.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?\.video-overlay-list,[\s\S]*?#game-event-control-list,[\s\S]*?#workspace-view-links \.link-nav\s*\{[\s\S]*?max-height:\s*min\(32vh,\s*270px\)\s*!important;[\s\S]*?overflow-y:\s*auto\s*!important;/,
  'Die Gruppenzeile muss kompakt bleiben und nur ihre eigene Liste scrollen.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?#workspace-view-endgame \.cheat-editor-head,[\s\S]*?#workspace-view-links \.link-detail-host \.link-card-head\.video-editor-head\s*\{[\s\S]*?min-height:\s*42px;[\s\S]*?padding-top:\s*7px;[\s\S]*?padding-bottom:\s*7px;/,
  'Die Editor-Titelleisten brauchen im Zwischenmodus einen einheitlichen vertikalen Innenabstand.'
);
assert.match(
  html,
  /body\.left-nav-collapsed #workspace-view-images \.image-editor-head\s*\{[\s\S]*?width:\s*calc\(100% - 12px\);[\s\S]*?min-height:\s*42px;[\s\S]*?margin-left:\s*12px;[\s\S]*?margin-right:\s*0;[\s\S]*?padding-top:\s*7px;[\s\S]*?padding-bottom:\s*7px;/,
  'Die Bilder-Titelleiste muss ohne Gruppenleiste denselben sichtbaren Abstand und Formfaktor behalten.'
);
assert.match(
  html,
  /@media \(max-width: 2100px\)[\s\S]*?\.tabs-monitor-config\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin-left:\s*0;[\s\S]*?flex:\s*1 1 100%;[\s\S]*?\.tabs-monitor-config > label\s*\{[\s\S]*?max-width:\s*100%;/,
  'Die Monitor-Konfiguration muss im Zwischenmodus eine volle Zeile erhalten, damit der Ausgabe-Schalter sichtbar bleibt.'
);

for (const file of [
  'game-event-act.js',
  'game-event-overwolf.js',
  'game-event-process.js',
  'game-event-recognition.js'
]) {
  const source = fs.readFileSync(path.join(root, 'app', file), 'utf8');
  assert.match(
    source,
    /@media\(max-width:2100px\)/,
    `${file} muss bei Zwischenbreiten auf eine Spalte wechseln.`
  );
}

console.log('Responsive intermediate layout tests passed.');
