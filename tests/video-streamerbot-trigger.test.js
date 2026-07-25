'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'app', 'video-overlay-manager.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'EmbeddedBridge.ps1'), 'utf8');

const customStart = manager.indexOf('function handleCustom(payload)');
const customEnd = manager.indexOf('function handleReward(', customStart);
assert.notEqual(customStart, -1, 'handleCustom fehlt');
assert.notEqual(customEnd, -1, 'Ende von handleCustom fehlt');
const handleCustom = manager.slice(customStart, customEnd);
assert.match(handleCustom, /data\.event\.source === 'General'/);
assert.match(handleCustom, /data\[config\.trigger\] === true/);

const generatorStart = settings.indexOf('function streamerbotActionCode(trigger)');
const generatorEnd = settings.indexOf('function showStreamerbotCode()', generatorStart);
assert.notEqual(generatorStart, -1, 'Streamer.bot-Codegenerator fehlt');
assert.notEqual(generatorEnd, -1, 'Ende des Streamer.bot-Codegenerators fehlt');
const generated = Function(
  settings.slice(generatorStart, generatorEnd) + '\nreturn streamerbotActionCode;'
)()('BA_TEST');
assert.match(generated, /new JProperty\("BA_TEST", true\)/);
assert.match(generated, /foreach \(var pair in args\)/);
assert.match(generated, /CPH\.WebsocketBroadcastJson/);

const templateStart = manager.indexOf('function bubbleTemplateVariables(source)');
const templateEnd = manager.indexOf('function removeVideoBubble(video)', templateStart);
assert.notEqual(templateStart, -1, 'Bubble-Variablenaufloesung fehlt');
assert.notEqual(templateEnd, -1, 'Ende der Bubble-Variablenaufloesung fehlt');
const renderBubbleTemplate = Function(
  manager.slice(templateStart, templateEnd) + '\nreturn renderBubbleTemplate;'
)();
assert.equal(renderBubbleTemplate('%User%', { userName: 'Alice' }), 'Alice');
assert.equal(renderBubbleTemplate('%USER%', { user: { displayName: 'Bob' } }), 'Bob');
assert.equal(renderBubbleTemplate('%user%', { userLogin: 'charlie' }), 'charlie');
assert.equal(renderBubbleTemplate('%User%', { isTest: true }), 'Test');

assert.match(settings, /id="video-bubble-font-size"/);
assert.match(settings, /id="video-bubble-font-family"/);
assert.match(settings, /id="video-bubble-text-color"/);
assert.match(settings, /id="video-bubble-animation"/);
assert.match(settings, /id="video-bubble-above" type="checkbox"/);
assert.match(manager, /function renderAnimatedBubbleText/);
assert.match(bridge, /ForcedFolder 'video-bubbles'/);
assert.match(bridge, /bubbleAnimationDuration = \$bubbleAnimationDuration/);

console.log('video-streamerbot-trigger: OK');
