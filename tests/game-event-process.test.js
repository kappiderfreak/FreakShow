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
  const script = fs.readFileSync(path.join(root, 'app', 'game-event-process.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'EmbeddedBridge.ps1'), 'utf8');

  assert(html.includes('/app/game-event-process.js'), `${variant}: process-event module is not loaded`);
  assert(html.includes('function gameEventControlOpenAddMenu'), `${variant}: game-event type menu is missing`);
  assert(html.includes("gameEventControlCreateItem('recognition')"), `${variant}: image-recognition choice is missing`);
  assert(html.includes("gameEventControlCreateItem('process')"), `${variant}: process-event choice is missing`);
  assert(html.includes("eventType: eventType"), `${variant}: selected game-event type is not stored`);
  assert(html.includes("type.textContent = processEvent ? 'EXE'"), `${variant}: EXE event type badge is missing`);
  assert(html.includes("actEvent ? 'ACT'"), `${variant}: ACT event type badge is missing`);
  assert(html.includes("overwolfEvent ? 'OW'"), `${variant}: Overwolf event type badge is missing`);

  assert(script.includes("processesUrl = bridgeOrigin + '/game-control/processes'"), `${variant}: process list endpoint is missing`);
  assert(script.includes('PROCESS_POLL_INTERVAL_MS = 1000'), `${variant}: process detection interval is missing`);
  assert(script.includes('if (!rt.initialized)'), `${variant}: first process scan is not treated as a baseline`);
  assert(script.includes("sendProcessAction(item, 'started', false)"), `${variant}: EXE start transition is missing`);
  assert(script.includes("sendProcessAction(item, 'stopped', false)"), `${variant}: optional EXE stop transition is missing`);
  assert(script.includes("request: 'DoAction'"), `${variant}: process event does not call Streamer.bot DoAction`);
  assert(script.includes('processTwitchCategory'), `${variant}: Twitch category variable is missing`);
  assert(script.includes('processYouTubeCategory'), `${variant}: YouTube category variable is missing`);
  assert(script.includes('processPlatform'), `${variant}: platform variable is missing`);
  assert(script.includes('processExecutable'), `${variant}: executable variable is missing`);
  assert(script.includes("cfg.platform === 'both'"), `${variant}: Twitch + YouTube target is missing`);
  assert(script.includes("xhr.setRequestHeader('X-Kappi-Token', controlToken)"), `${variant}: process endpoint token is missing`);
  assert(script.includes('game-event-process-layout game-control-editor-primary'), `${variant}: process editor does not use the shared two-column editor layout`);
  assert(script.includes('game-event-process-overview game-control-keyboard-fit ed-slot-monitor'), `${variant}: process preview does not use the shared monitor slot`);
  assert(script.includes('game-event-process-settings game-control-settings ed-slot-settings'), `${variant}: process settings do not use the shared settings column`);
  assert(script.includes('game-event-process-actions game-control-actions ed-slot-actions'), `${variant}: process actions are not in the shared bottom action row`);
  assert(script.includes('function applyProcessGeometry()'), `${variant}: process preview does not follow the configured monitor geometry`);
  assert(!script.includes('.game-event-process-overview,.game-event-process-settings{'), `${variant}: process editor still wraps both columns in extra panels`);

  assert(bridge.includes("$path -eq '/game-control/processes'"), `${variant}: bridge process endpoint is missing`);
  assert(bridge.includes('Get-GameControlProcessesJson'), `${variant}: bridge process query is missing`);
}

console.log('Game-event EXE detection regression: OK');
