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
  const act = fs.readFileSync(path.join(root, 'app', 'game-event-act.js'), 'utf8');
  const overwolf = fs.readFileSync(path.join(root, 'app', 'game-event-overwolf.js'), 'utf8');

  assert(html.includes('/app/game-event-act.js'), `${variant}: ACT module is not loaded`);
  assert(html.includes('/app/game-event-overwolf.js'), `${variant}: Overwolf module is not loaded`);
  assert(html.includes("gameEventControlCreateItem('act')"), `${variant}: ACT add-menu entry is missing`);
  assert(html.includes("gameEventControlCreateItem('overwolf')"), `${variant}: Overwolf add-menu entry is missing`);
  assert(html.includes("eventType === 'act'"), `${variant}: ACT editor routing is missing`);
  assert(html.includes("eventType === 'overwolf'"), `${variant}: Overwolf editor routing is missing`);
  assert(html.includes("actEvent ? 'ACT'"), `${variant}: ACT list badge is missing`);
  assert(html.includes("overwolfEvent ? 'OW'"), `${variant}: Overwolf list badge is missing`);

  assert(act.includes("events: ['CombatData', 'LogLine', 'ChangePrimaryPlayer']"), `${variant}: ACT websocket subscriptions are missing`);
  assert(act.includes("actRunning() && processRunning(cfg.gameProcess)"), `${variant}: ACT events are not gated by ACT and game processes`);
  for (const eventName of ['combat_start', 'combat_end', 'kill', 'death', 'top_dps', 'dps_threshold']) {
    assert(act.includes(eventName), `${variant}: ACT event ${eventName} is missing`);
  }
  assert(act.includes("request: 'DoAction'"), `${variant}: ACT events do not call Streamer.bot`);
  assert(act.includes("'/video-overlays'"), `${variant}: ACT video catalog is missing`);
  assert(act.includes("'/trigger-video'"), `${variant}: ACT video trigger is missing`);
  for (const variable of ['actEventName', 'actEventType', 'actPlayer', 'actKills', 'actDeaths', 'actDps', 'actTopPlayer', 'actTopDps', 'actEncounter', 'actTimestamp']) {
    assert(act.includes(variable), `${variant}: ACT variable ${variable} is missing`);
  }
  assert(act.includes('game-event-act-layout game-control-editor-primary'), `${variant}: ACT editor does not use the shared editor layout`);

  assert(overwolf.includes("overwolfRunning() && !!cfg.gameProcess && processRunning(cfg.gameProcess)"), `${variant}: Overwolf events are not gated by Overwolf and game processes`);
  assert(overwolf.includes('Overwolf-Provider-WebSocket'), `${variant}: Overwolf provider field is missing`);
  assert(overwolf.includes("request: 'DoAction'"), `${variant}: Overwolf events do not call Streamer.bot`);
  assert(overwolf.includes("'/video-overlays'"), `${variant}: Overwolf video catalog is missing`);
  assert(overwolf.includes("'/trigger-video'"), `${variant}: Overwolf video trigger is missing`);
  for (const variable of ['overwolfEventName', 'overwolfGameExe', 'overwolfGameName', 'overwolfGameId', 'overwolfEventData', 'overwolfTimestamp']) {
    assert(overwolf.includes(variable), `${variant}: Overwolf variable ${variable} is missing`);
  }
  assert(overwolf.includes('game-event-overwolf-layout game-control-editor-primary'), `${variant}: Overwolf editor does not use the shared editor layout`);
}

console.log('Game-event ACT/Overwolf providers regression: OK');
