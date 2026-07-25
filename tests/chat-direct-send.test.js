'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'websocket-diagnose.html'),
  'utf8'
);

// Nicht von Leerzeilen oder Einrueckung abhaengig: Nur die beiden benachbarten
// Funktionsnamen bilden die Grenze.
function extractFunction(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  const end = html.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `Function ${name} fehlt`);
  assert.notEqual(end, -1, `Folgefunktion ${nextName} fehlt`);
  return html.slice(start, end);
}

const directSource = extractFunction(
  'sendTwitchChatDirect(message)',
  'handleChatSendResponse(payload)'
);
let apiCall = null;
let busy = false;
let cleared = false;
const statuses = [];

const directFactory = new Function(
  'twUser', 'twToken', 'twClientId', 'setChatSendBusy', 'setChatSendStatus',
  'gameControlText', 'twApi', 'chatStr', 'clearSentChatMessage',
  `${directSource}; return sendTwitchChatDirect;`
);

const sendDirect = directFactory(
  () => ({ id: '12345' }),
  () => 'test-token',
  () => 'test-client',
  value => { busy = value; },
  (text, className) => statuses.push({ text, className }),
  de => de,
  (apiPath, callback, options) => {
    apiCall = { apiPath, options };
    callback(200, { data: [{ is_sent: true, message_id: 'message-1' }] });
  },
  value => String(value || ''),
  message => { if (message === 'Hallo Twitch') cleared = true; }
);

assert.equal(sendDirect('Hallo Twitch'), true);
assert.equal(apiCall.apiPath, '/chat/messages');
assert.equal(apiCall.options.method, 'POST');
assert.deepEqual(apiCall.options.body, {
  broadcaster_id: '12345',
  sender_id: '12345',
  message: 'Hallo Twitch'
});
assert.equal(cleared, true);
assert.equal(busy, false);
assert.ok(statuses.some(item => /gesendet/.test(item.text)));

const sendSource = extractFunction('sendChatMessage()', 'initChatPlatform()');
let directCalls = 0;
const fallbackStatuses = [];
const sendFactory = new Function(
  'byId', 'selectedChatPlatform', 'chatPlatformLabel', 'setChatSendStatus',
  'gameControlText', 'sendTwitchChatDirect', 'socket', 'WebSocket',
  'chatSendPending', 'send',
  `${sendSource}; return sendChatMessage;`
);

const sendMessage = sendFactory(
  id => id === 'chat-send-msg' ? { value: 'Direkt-Test' } : { disabled: false },
  () => 'twitch',
  () => 'Twitch',
  (text, className) => fallbackStatuses.push({ text, className }),
  de => de,
  message => { directCalls += 1; return message === 'Direkt-Test'; },
  null,
  { OPEN: 1 },
  {},
  () => false
);

sendMessage();
assert.equal(directCalls, 1);
assert.equal(
  fallbackStatuses.some(item => /Streamer\.bot verbunden/.test(item.text)),
  false
);

console.log('chat-direct-send: OK');
