const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');

assert.match(
  html,
  /@media \(max-width: 1360px\)[\s\S]*?\.video-editor-primary,[\s\S]*?\.image-editor-primary,[\s\S]*?\.er-editor-primary,[\s\S]*?\.cheat-editor-primary/,
  'Der gemeinsame Zwischenbreiten-Breakpoint muss alle grossen Editoren stapeln.'
);
assert.match(
  html,
  /matchMedia\('\(max-width: 1360px\)'\)/,
  'Die Monitor-Geometrie muss denselben Breakpoint wie das CSS verwenden.'
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
    /@media\(max-width:1360px\)/,
    `${file} muss bei Zwischenbreiten auf eine Spalte wechseln.`
  );
}

console.log('Responsive intermediate layout tests passed.');
