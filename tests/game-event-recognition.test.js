'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

{
  const root = path.join(__dirname, '..');
  const variant = path.basename(root);
  const html = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'app', 'game-event-recognition.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'EmbeddedBridge.ps1'), 'utf8');

  assert(html.includes('/app/game-event-recognition.js'), `${variant}: recognition module is not loaded`);
  assert(html.includes('window.FreakShowGameEventApi'), `${variant}: game-event API is missing`);
  assert(html.includes('socketReady'), `${variant}: Streamer.bot connection state is not exposed`);

  for (const variable of [
    'recognitionName', 'recognitionConfidence', 'recognitionState',
    'recognitionMonitor', 'recognitionTimestamp'
  ]) {
    assert(script.includes(variable), `${variant}: missing Streamer.bot variable ${variable}`);
  }
  assert(script.includes("request: 'DoAction'"), `${variant}: recognition does not call Streamer.bot DoAction`);
  assert(script.includes("state, 'detected'" ) || script.includes("'detected', confidence"), `${variant}: detected transition is missing`);
  assert(script.includes("'lost', confidence"), `${variant}: lost transition is missing`);
  assert(script.includes('threshold - 3'), `${variant}: hysteresis is missing`);
  assert(script.includes('now - rt.matchSince >= stableMs'), `${variant}: stable-match guard is missing`);
  assert(script.includes('now - rt.lastTrigger < Number(recognition.cooldownMs'), `${variant}: cooldown guard is missing`);
  assert(script.includes("folder: 'recognition'"), `${variant}: reference images are not stored in Content/recognition`);
  assert(script.includes('aspect-ratio:var(--ge-monitor-aspect'), `${variant}: preview does not follow the monitor aspect ratio`);
  assert(script.includes("stage.style.setProperty('--ge-monitor-aspect'"), `${variant}: monitor aspect ratio is not updated dynamically`);
  assert(script.includes('.game-event-recognition-stage canvas{display:block;width:100%;height:100%'), `${variant}: captured screen does not fill the preview stage`);
  assert(script.includes('max-width:var(--ed-monitor-max,1100px)'), `${variant}: recognition preview is not sized like the shared monitor previews`);
  assert(script.includes('LIVE_PREVIEW_INTERVAL_MS = 500'), `${variant}: live monitor preview interval is missing`);
  assert(script.includes('function livePreviewLoop()'), `${variant}: live monitor preview loop is missing`);
  assert(script.includes("document.visibilityState === 'hidden'"), `${variant}: live preview does not pause in the background`);
  assert(script.includes('livePreviewBusy'), `${variant}: live preview is missing its overlapping-request guard`);
  assert(script.includes('function isRecognitionItem(item)'), `${variant}: recognition event type guard is missing`);
  assert(script.includes("item.eventType === 'recognition'"), `${variant}: image recognition is not isolated from EXE events`);
  assert(script.includes('game-event-recognition-layout game-control-editor-primary'), `${variant}: recognition editor does not use the shared two-column editor layout`);
  assert(script.includes('game-event-recognition-preview-panel game-control-keyboard-fit ed-slot-monitor'), `${variant}: recognition preview does not use the shared monitor slot`);
  assert(script.includes('game-event-recognition-settings game-control-settings ed-slot-settings'), `${variant}: recognition settings do not use the shared settings column`);
  assert(script.includes('game-event-recognition-actions game-control-actions ed-slot-actions'), `${variant}: recognition actions are not in the shared bottom action row`);
  assert(!script.includes('.game-event-recognition-preview-panel,.game-event-recognition-settings{'), `${variant}: recognition editor still wraps both columns in extra panels`);

  assert(bridge.includes('function Get-ScreenCaptureBytes'), `${variant}: capture function is missing`);
  assert(bridge.includes("$path -eq '/screen-capture'"), `${variant}: screen-capture endpoint is missing`);
  assert(bridge.includes("-ContentType 'image/png'"), `${variant}: screen-capture endpoint is not PNG`);
  assert(bridge.includes('[Math]::Min(1200, $maxWidth)'), `${variant}: capture width is not bounded`);
  assert(bridge.includes('[Math]::Min(800, $maxHeight)'), `${variant}: capture height is not bounded`);
}

console.log('Game-event image recognition regression: OK');
