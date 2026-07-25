'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');

function cornersFor(className) {
  const values = [];
  const expression = new RegExp(
    '<span class="' + className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" data-corner="([^"]+)"',
    'g'
  );
  let match;
  while ((match = expression.exec(settings)) !== null) values.push(match[1]);
  return values;
}

function handlesFor(className) {
  const values = [];
  const expression = new RegExp(
    '<span class="' + className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" data-handle="([^"]+)"',
    'g'
  );
  let match;
  while ((match = expression.exec(settings)) !== null) values.push(match[1]);
  return values;
}

assert.deepEqual(
  cornersFor('video-free-handle'),
  ['tl', 'tr', 'bl', 'br'],
  'Das Video darf nur vier Eckpunkte besitzen'
);
assert.deepEqual(
  cornersFor('video-bubble-position-handle'),
  ['tl', 'tr', 'bl', 'br'],
  'Die Video-Bubble darf nur vier Eckpunkte besitzen'
);
assert.deepEqual(
  cornersFor('video-bubble-text-handle'),
  ['tl', 'tr', 'bl', 'br'],
  'Der Bubble-Textbereich darf nur vier Eckpunkte besitzen'
);
assert.deepEqual(
  handlesFor('cheat-mon-handle'),
  ['nw', 'ne', 'sw', 'se'],
  'Notizen dürfen nur vier Eckpunkte besitzen'
);

const imageHandleLine = settings.match(
  /\[[^\n]+\]\.forEach\(function \(c\) \{ var hd = document\.createElement\('span'\); hd\.className = 'image-rect-handle '/
);
assert.ok(imageHandleLine, 'Erzeugung der Bild-Eckpunkte fehlt');
assert.match(imageHandleLine[0], /\['nw', 'ne', 'sw', 'se'\]/);
assert.doesNotMatch(imageHandleLine[0], /'n'|'e'|'s'|'w'/);

const previewHandleGenerators = settings.match(
  /\['nw', 'ne', 'sw', 'se'\]\.forEach\(function \(handleName\) \{[\s\S]{0,240}?handle\.className = 'preview-resize-handle handle-' \+ handleName;/g
) || [];
assert.equal(previewHandleGenerators.length, 2, 'Beide Overlay-Vorschauen müssen genau vier Eckpunkte erzeugen');
assert.doesNotMatch(settings, /preview-resize-handle\.handle-(?:n|s|e|w)\b/);

const resizeStart = settings.indexOf('function beginVideoFreePositionDrag(startEvent)');
const resizeEnd = settings.indexOf('function toggleVideoOutsidePosition()', resizeStart);
assert.notEqual(resizeStart, -1, 'Video-Resize-Funktion fehlt');
assert.notEqual(resizeEnd, -1, 'Ende der Video-Resize-Funktion fehlt');
const resizeCode = settings.slice(resizeStart, resizeEnd);
assert.match(resizeCode, /resizeRight - resizeLeft/);
assert.match(resizeCode, /resizeBottom - resizeTop/);
assert.doesNotMatch(resizeCode, /Proportional skalieren|var sW|var sH|corner\.length === 1/);

assert.match(settings, /function monitorBorderResizeHandle\(event, element, threshold\)/);
[
  'function beginVideoFreePositionDrag(startEvent)',
  'function beginVideoBubblePositionDrag(startEvent)',
  'function beginVideoBubbleTextAreaDrag(startEvent)',
  'function createPreviewRect(area, label, className, dims, linkId, detail)',
  'function createLinkGroupCard(groupName)',
  'function createLinkCardScreen(item, detail)',
  'function cheatMonitorInteract()',
  'function attachImageRectInteract(rect, im)'
].forEach((startMarker, index, markers) => {
  const start = settings.indexOf(startMarker);
  const next = index + 1 < markers.length ? settings.indexOf(markers[index + 1], start + startMarker.length) : settings.length;
  assert.notEqual(start, -1, `${startMarker} fehlt`);
  const end = next > start ? next : Math.min(settings.length, start + 12000);
  assert.match(
    settings.slice(start, end),
    /monitorBorderResizeHandle\(/,
    `${startMarker} verwendet die ziehbare Rahmenkante nicht`
  );
});

console.log('media-corner-handles: OK');
