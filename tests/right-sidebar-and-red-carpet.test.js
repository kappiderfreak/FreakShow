'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'websocket-diagnose.html'), 'utf8');

assert.match(html, /id="right-sidebar-toggle"/);
assert.match(html, /body\.right-sidebar-collapsed \.workspace-layout/);
assert.match(html, /function setRightSidebarCollapsed\(collapsed, persist\)/);
assert.match(html, /freakshow\.rightSidebarCollapsed/);
assert.match(html, /Twitch: \['ChatMessage', 'RewardRedemption', 'PresentViewers'\]/);
assert.match(html, /YouTube: \['Message', 'PresentViewers'\]/);
assert.match(html, /Kick: \['ChatMessage', 'PresentViewers'\]/);
assert.match(html, /function erIngestPresentViewers\(payload, platform\)/);
assert.match(html, /v\.platform \|\| v\.Platform \|\| v\.type \|\| v\.Type/);
assert.match(html, /copy\.platform = platform/);
assert.match(html, /platform: platform,[\s\S]*?avatarUrl:/);

console.log('right-sidebar-and-red-carpet: OK');
