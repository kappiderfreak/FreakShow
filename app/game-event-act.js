(function () {
  'use strict';

  var api = window.FreakShowGameEventApi;
  if (!api) return;

  var bridgeOrigin = String(window.BRIDGE_ORIGIN || window.location.origin || '').replace(/\/+$/, '');
  var controlToken = String(window.BRIDGE_CONTROL_TOKEN || '');
  var processesUrl = bridgeOrigin + '/game-control/processes';
  var videosUrl = bridgeOrigin + '/video-overlays';
  var triggerVideoUrl = bridgeOrigin + '/trigger-video';
  var editorRoot = null;
  var currentItemId = '';
  var processCache = [];
  var videoCache = [];
  var videoListRendered = '';
  var videoReloadAt = 0;
  var VIDEO_RELOAD_INTERVAL_MS = 4000;
  var runtime = Object.create(null);
  var actSocket = null;
  var actSocketUrl = '';
  var pollTimer = 0;
  var pollBusy = false;
  var lastCombatDataAt = 0;
  var primaryPlayer = '';
  var PROCESS_POLL_INTERVAL_MS = 1000;
  var ENCOUNTER_IDLE_MS = 3500;

  function tr(de, en, es) { return api.text ? api.text(de, en, es) : de; }
  function byId(id) { return document.getElementById(id); }
  function text(id, value) { var el = byId(id); if (el) el.textContent = value; }
  function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
  }
  function numberValue(value) {
    var normalized = String(value == null ? '' : value).replace(/,/g, '').replace(/[^0-9.\-]/g, '');
    var result = Number(normalized);
    return isFinite(result) ? result : 0;
  }
  function cleanProcessName(value) {
    var name = String(value || '').trim().replace(/^['"]|['"]$/g, '');
    var parts = name.split(/[\\/]/);
    name = parts[parts.length - 1].replace(/\.exe$/i, '').trim();
    return name.toLowerCase();
  }
  function isActItem(item) { return !!(item && item.eventType === 'act'); }

  function savedActUrl() {
    try { return String(window.localStorage.getItem('kappi.conn.actUrl') || '').trim(); } catch (e) { return ''; }
  }

  function ensureConfig(item) {
    var changed = false;
    if (!item.actEvent || typeof item.actEvent !== 'object') { item.actEvent = {}; changed = true; }
    var cfg = item.actEvent;
    var defaults = {
      actUrl: savedActUrl() || 'ws://127.0.0.1:10501/ws',
      gameProcess: 'ffxiv_dx11',
      eventKind: 'kill',
      dpsThreshold: 10000,
      actionName: 'FreakShow - ACT Event',
      videoId: '',
      cooldownMs: 750
    };
    Object.keys(defaults).forEach(function (key) {
      if (cfg[key] === undefined || cfg[key] === null) { cfg[key] = defaults[key]; changed = true; }
    });
    if (['combat_start', 'combat_end', 'kill', 'death', 'top_dps', 'dps_threshold'].indexOf(cfg.eventKind) < 0) cfg.eventKind = 'kill';
    cfg.gameProcess = cleanProcessName(cfg.gameProcess) || 'ffxiv_dx11';
    cfg.dpsThreshold = clamp(cfg.dpsThreshold, 1, 999999999, 10000);
    cfg.cooldownMs = clamp(cfg.cooldownMs, 0, 600000, 750);
    if (changed) api.save();
    return cfg;
  }

  function itemRuntime(item) {
    if (!runtime[item.id]) runtime[item.id] = {
      initialized: false,
      combatActive: false,
      kills: 0,
      deaths: 0,
      dps: 0,
      thresholdAbove: false,
      topPlayer: '',
      topDps: 0,
      encounter: '',
      lastTrigger: 0,
      lastEvent: '',
      error: ''
    };
    return runtime[item.id];
  }

  function resetRuntime(item) {
    if (item && runtime[item.id]) delete runtime[item.id];
  }

  function processRunning(name) {
    var wanted = cleanProcessName(name);
    if (!wanted) return false;
    for (var i = 0; i < processCache.length; i++) {
      if (cleanProcessName(processCache[i].name) === wanted) return true;
    }
    return false;
  }

  function actRunning() {
    for (var i = 0; i < processCache.length; i++) {
      var name = cleanProcessName(processCache[i].name).replace(/\s+/g, '');
      if (name === 'advancedcombattracker' || name === 'advancedcombattrackerx86') return true;
    }
    return false;
  }

  function readyFor(item) {
    var cfg = ensureConfig(item);
    return !!item.enabled && actRunning() && processRunning(cfg.gameProcess);
  }

  function socketMatches(item) {
    return socketOpen() && String(ensureConfig(item).actUrl || '').trim() === actSocketUrl;
  }

  function injectStyles() {
    if (document.getElementById('game-event-act-style')) return;
    var style = document.createElement('style');
    style.id = 'game-event-act-style';
    style.textContent = [
      '.game-event-act-root{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:12px}',
      '.game-event-act-root[hidden]{display:none!important}',
      '.game-event-act-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--ed-settings-w,minmax(300px,420px));align-items:start;gap:var(--ed-gap,16px);width:100%;min-width:0}',
      '.game-event-act-overview{display:flex;width:min(100%,calc((100vh - 240px) * var(--gea-monitor-aspect-number,1.777777)));max-width:var(--ed-monitor-max,1100px);min-width:0;aspect-ratio:var(--gea-monitor-aspect,16 / 9);justify-self:center;margin:0 auto}',
      '.game-event-act-card{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:28px;box-sizing:border-box;border:1px solid #d7963b;border-radius:var(--ed-monitor-radius,7px);background-color:#090d14;background-image:radial-gradient(circle at center,rgba(231,166,74,.13),transparent 48%),linear-gradient(rgba(231,166,74,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(231,166,74,.08) 1px,transparent 1px);background-size:auto,32px 32px,32px 32px;text-align:center}',
      '.game-event-act-card.is-ready{border-color:#38d477}',
      '.game-event-act-icon{display:grid;place-items:center;width:64px;height:64px;margin-bottom:12px;border:1px solid #d7963b;border-radius:50%;color:#f0b85f;font-size:27px}',
      '.game-event-act-card.is-ready .game-event-act-icon{border-color:#38d477;color:#77efaa}',
      '.game-event-act-card h3{max-width:100%;margin:0 0 5px;color:var(--t-text,#e8eef8);font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.game-event-act-subtitle,.game-event-act-detail{color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-act-state{margin:12px 0 10px;padding:4px 9px;border:1px solid var(--t-list-border,rgba(255,255,255,.14));border-radius:999px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-act-card.is-ready .game-event-act-state{border-color:#38d477;color:#77efaa}',
      '.game-event-act-settings{display:grid;align-content:start;gap:10px;min-width:0;padding-top:2px}',
      '.game-event-act-field{display:grid;gap:4px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-act-field>input,.game-event-act-field>select{width:100%;box-sizing:border-box}',
      '.game-event-act-input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}',
      '.game-event-act-help{font-size:10px;line-height:1.4;color:var(--t-muted,#8ea0b8)}',
      '.game-event-act-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;flex-wrap:wrap}',
      /* Der Verbindungszustand steckt direkt im ACT-Badge. Dadurch bleibt die
         Zeile wie in allen anderen Tabs dreispaltig: Typ · Name · Schalter. */
      '.game-event-type-act{transition:border-color .16s ease,color .16s ease,background-color .16s ease}',
      '.game-event-type-act.act-status-none{border-color:#e0655a!important;color:#ff8a80!important;background:rgba(224,101,90,.12)!important}',
      '.game-event-type-act.act-status-partial{border-color:#d7963b!important;color:#f0b85f!important;background:rgba(215,150,59,.12)!important}',
      '.game-event-type-act.act-status-full{border-color:#38d477!important;color:#77efaa!important;background:rgba(56,212,119,.12)!important}',
      '[data-game-event-id]>.switch{justify-self:end;margin-left:auto}',
      '@media(max-width:1120px){.game-event-act-layout{grid-template-columns:minmax(0,1fr)}.game-event-act-settings{grid-template-columns:repeat(2,minmax(0,1fr))}.game-event-act-help{grid-column:1/-1}}',
      '@media(max-width:720px){.game-event-act-settings{grid-template-columns:minmax(0,1fr)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildEditor(editor) {
    if (editorRoot && editorRoot.isConnected) return editorRoot;
    editorRoot = document.createElement('div');
    editorRoot.id = 'game-event-act-root';
    editorRoot.className = 'game-event-act-root game-control-editor-body';
    editorRoot.hidden = true;
    editorRoot.innerHTML = '' +
      '<div class="game-event-act-layout game-control-editor-primary">' +
        '<section id="ge-act-overview" class="game-event-act-overview game-control-keyboard-fit ed-slot-monitor">' +
          '<div id="ge-act-card" class="game-event-act-card">' +
            '<div class="game-event-act-icon">ACT</div>' +
            '<h3 id="ge-act-card-name"></h3>' +
            '<div id="ge-act-card-subtitle" class="game-event-act-subtitle"></div>' +
            '<div id="ge-act-card-state" class="game-event-act-state"></div>' +
            '<div id="ge-act-card-detail" class="game-event-act-detail"></div>' +
          '</div>' +
        '</section>' +
        '<aside class="game-event-act-settings game-control-settings ed-slot-settings">' +
          '<label class="game-event-act-field game-control-setting-field"><span data-gea-label="name"></span><input id="ge-act-name" type="text" maxlength="120"></label>' +
          '<label class="game-event-act-field game-control-setting-field"><span data-gea-label="url"></span><input id="ge-act-url" type="text" maxlength="300"></label>' +
          '<div class="game-event-act-field game-control-setting-field"><span data-gea-label="game"></span><div class="game-event-act-input-row"><input id="ge-act-game" type="text" maxlength="124" list="ge-act-process-list"><button id="ge-act-refresh" type="button"></button></div><datalist id="ge-act-process-list"></datalist></div>' +
          '<label class="game-event-act-field game-control-setting-field"><span data-gea-label="kind"></span><select id="ge-act-kind"><option value="combat_start"></option><option value="combat_end"></option><option value="kill"></option><option value="death"></option><option value="top_dps"></option><option value="dps_threshold"></option></select></label>' +
          '<label id="ge-act-threshold-field" class="game-event-act-field game-control-setting-field"><span data-gea-label="threshold"></span><input id="ge-act-threshold" type="number" min="1" max="999999999" step="100"></label>' +
          '<label class="game-event-act-field game-control-setting-field"><span data-gea-label="action"></span><input id="ge-act-action" type="text" maxlength="180"></label>' +
          '<label class="game-event-act-field game-control-setting-field"><span data-gea-label="video"></span><select id="ge-act-video"></select></label>' +
          '<label class="game-event-act-field game-control-setting-field"><span data-gea-label="cooldown"></span><input id="ge-act-cooldown" type="number" min="0" max="600000" step="250"></label>' +
          '<div class="game-event-act-help" data-gea-label="gate"></div>' +
          '<div class="game-event-act-help" data-gea-label="variables"></div>' +
        '</aside>' +
      '</div>' +
      '<div class="game-event-act-actions game-control-actions ed-slot-actions"><button id="ge-act-connect" type="button"></button><button id="ge-act-test" type="button" class="btn-success"></button></div>';
    editor.appendChild(editorRoot);
    bindEditorEvents();
    return editorRoot;
  }

  function applyLabels() {
    if (!editorRoot) return;
    var labels = {
      name: tr('Name', 'Name', 'Nombre'),
      url: tr('ACT-/OverlayPlugin-WebSocket', 'ACT / OverlayPlugin WebSocket', 'WebSocket de ACT / OverlayPlugin'),
      game: tr('Spiel-EXE (muss laufen)', 'Game EXE (must be running)', 'EXE del juego (debe estar activo)'),
      kind: tr('ACT-Ereignis', 'ACT event', 'Evento de ACT'),
      threshold: tr('DPS-Grenze', 'DPS threshold', 'Umbral de DPS'),
      action: tr('Streamer.bot-Aktion', 'Streamer.bot action', 'Acción de Streamer.bot'),
      video: tr('Video einblenden', 'Show video', 'Mostrar vídeo'),
      cooldown: tr('Sperrzeit nach Auslösung (ms)', 'Cooldown after trigger (ms)', 'Espera tras activar (ms)'),
      gate: tr('Sicherheitsprüfung: ACT/OverlayPlugin und die eingetragene Spiel-EXE müssen gleichzeitig laufen. Sonst wird nichts ausgelöst.', 'Safety check: ACT/OverlayPlugin and the configured game EXE must be running at the same time. Otherwise nothing triggers.', 'Comprobación: ACT/OverlayPlugin y el EXE del juego configurado deben estar activos a la vez. De lo contrario no se activa nada.'),
      variables: tr('Variablen: %actEventName%, %actEventType%, %actPlayer%, %actKills%, %actDeaths%, %actDps%, %actTopPlayer%, %actTopDps%, %actEncounter%, %actTimestamp%', 'Variables: %actEventName%, %actEventType%, %actPlayer%, %actKills%, %actDeaths%, %actDps%, %actTopPlayer%, %actTopDps%, %actEncounter%, %actTimestamp%', 'Variables: %actEventName%, %actEventType%, %actPlayer%, %actKills%, %actDeaths%, %actDps%, %actTopPlayer%, %actTopDps%, %actEncounter%, %actTimestamp%')
    };
    Object.keys(labels).forEach(function (key) {
      var el = editorRoot.querySelector('[data-gea-label="' + key + '"]');
      if (el) el.textContent = labels[key];
    });
    var select = byId('ge-act-kind');
    var optionLabels = [
      tr('Kampf gestartet', 'Combat started', 'Combate iniciado'),
      tr('Kampf beendet', 'Combat ended', 'Combate terminado'),
      tr('Kill', 'Kill', 'Baja'),
      tr('Tod', 'Death', 'Muerte'),
      tr('Meiste DPS', 'Highest DPS', 'Mayor DPS'),
      tr('DPS-Grenze erreicht', 'DPS threshold reached', 'Umbral de DPS alcanzado')
    ];
    if (select) for (var i = 0; i < select.options.length; i++) select.options[i].textContent = optionLabels[i];
    text('ge-act-refresh', tr('Aktualisieren', 'Refresh', 'Actualizar'));
    text('ge-act-connect', tr('ACT neu verbinden', 'Reconnect ACT', 'Reconectar ACT'));
    text('ge-act-test', tr('Event testen', 'Test event', 'Probar evento'));
  }

  function applyGeometry() {
    var overview = byId('ge-act-overview');
    if (!overview) return;
    var widthInput = byId('cfg-monitor-width');
    var heightInput = byId('cfg-monitor-height');
    var width = Math.max(1, Number(widthInput && widthInput.value) || 1920);
    var height = Math.max(1, Number(heightInput && heightInput.value) || 1080);
    overview.style.setProperty('--gea-monitor-aspect', width + ' / ' + height);
    overview.style.setProperty('--gea-monitor-aspect-number', String(width / height));
  }

  function populateProcesses() {
    var list = byId('ge-act-process-list');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 0; i < processCache.length; i++) {
      var name = String(processCache[i].name || '').trim();
      if (!name) continue;
      var option = document.createElement('option');
      option.value = /\.exe$/i.test(name) ? name : name + '.exe';
      list.appendChild(option);
    }
  }

  // Beschriftung eines Video-Eintrags: Gruppe voran, damit gleichnamige Videos
  // aus verschiedenen Gruppen unterscheidbar sind.
  function videoOptionLabel(video) {
    var name = String(video.name || video.id || tr('Video', 'Video', 'Vídeo'));
    var group = String(video.group || '').trim();
    if (!group) return tr('Ohne Gruppe', 'Ungrouped', 'Sin grupo') + ' · ' + name;
    return group + ' · ' + name;
  }

  // Kennung der Liste. Aendert sie sich nicht, wird die Auswahl NICHT neu gebaut -
  // sonst klappt sie beim Nachladen unter dem Mauszeiger zu.
  function videoListSignature() {
    var parts = [];
    for (var i = 0; i < videoCache.length; i++) {
      parts.push(String(videoCache[i].id || '') + '' + videoOptionLabel(videoCache[i]));
    }
    return parts.join('');
  }

  function populateVideos(selected) {
    var select = byId('ge-act-video');
    if (!select) return;
    var signature = videoListSignature();
    var keep = (selected == null) ? select.value : selected;
    if (signature === videoListRendered && select.options.length) {
      if (select.value !== (keep || '')) select.value = keep || '';
      return;
    }
    if (document.activeElement === select && select.options.length) return;
    videoListRendered = signature;
    select.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = tr('— kein Video —', '— no video —', '— sin vídeo —');
    select.appendChild(none);
    for (var i = 0; i < videoCache.length; i++) {
      var option = document.createElement('option');
      option.value = String(videoCache[i].id || '');
      option.textContent = videoOptionLabel(videoCache[i]);
      select.appendChild(option);
    }
    select.value = keep || '';
  }

  function loadVideos(selected) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', videosUrl + '?t=' + Date.now(), true);
    if (controlToken) xhr.setRequestHeader('X-Kappi-Token', controlToken);
    xhr.timeout = 4000;
    xhr.onload = function () {
      try {
        var response = JSON.parse(xhr.responseText || '{}');
        videoCache = Array.isArray(response.items) ? response.items : [];
      } catch (e) { videoCache = []; }
      populateVideos(selected);
    };
    xhr.onerror = xhr.ontimeout = function () { populateVideos(selected); };
    xhr.send();
  }

  function loadProcesses(force) {
    if (pollBusy && !force) return;
    pollBusy = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', processesUrl + '?t=' + Date.now(), true);
    // Ohne Kontroll-Token weist die Bridge die Abfrage ab. Die Liste blieb dann
    // leer und ACT wie Spiel galten als nicht gestartet, obwohl beide liefen.
    if (controlToken) xhr.setRequestHeader('X-Kappi-Token', controlToken);
    xhr.timeout = 3500;
    xhr.onload = function () {
      pollBusy = false;
      try {
        var response = JSON.parse(xhr.responseText || '{}');
        processCache = Array.isArray(response.processes) ? response.processes : [];
      } catch (e) { processCache = []; }
      populateProcesses();
      enforceProcessGate();
    };
    xhr.onerror = xhr.ontimeout = function () { pollBusy = false; processCache = []; enforceProcessGate(); };
    xhr.send();
  }

  function enabledActItems() {
    var state = api.state();
    var items = state && Array.isArray(state.items) ? state.items : [];
    return items.filter(function (item) { return isActItem(item) && item.enabled; });
  }

  function closeSocket() {
    var socket = actSocket;
    actSocket = null;
    actSocketUrl = '';
    if (socket) {
      try { socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null; socket.close(); } catch (e) {}
    }
  }

  function connectAct(force) {
    var items = enabledActItems();
    var readyItem = null;
    for (var i = 0; i < items.length; i++) if (readyFor(items[i])) { readyItem = items[i]; break; }
    if (!readyItem) { closeSocket(); updateAllStatuses(); return; }
    var url = String(ensureConfig(readyItem).actUrl || '').trim();
    if (!url) { closeSocket(); updateAllStatuses(); return; }
    if (!force && actSocket && actSocketUrl === url && (actSocket.readyState === WebSocket.OPEN || actSocket.readyState === WebSocket.CONNECTING)) return;
    closeSocket();
    actSocketUrl = url;
    try { actSocket = new WebSocket(url); } catch (e) { actSocket = null; updateAllStatuses(); return; }
    actSocket.onopen = function () {
      try { actSocket.send(JSON.stringify({ call: 'subscribe', events: ['CombatData', 'LogLine', 'ChangePrimaryPlayer'] })); } catch (e) {}
      updateAllStatuses();
    };
    actSocket.onmessage = function (event) {
      var message;
      try { message = JSON.parse(event.data || '{}'); } catch (e) { return; }
      var type = String(message.type || message.eventType || message.event || '');
      var detail = message.detail && typeof message.detail === 'object' ? message.detail : message;
      if (type === 'ChangePrimaryPlayer') primaryPlayer = String(detail.charName || detail.name || '');
      if (type === 'CombatData' || detail.Encounter || detail.Combatant) handleCombatData(detail);
    };
    actSocket.onerror = function () { updateAllStatuses(); };
    actSocket.onclose = function () { actSocket = null; actSocketUrl = ''; updateAllStatuses(); };
  }

  function combatantEntries(data) {
    var source = data.Combatant || data.combatants || {};
    var entries = [];
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (value && typeof value === 'object') entries.push({ key: key, value: value });
    });
    return entries;
  }

  function findPlayer(entries) {
    var lowerPrimary = primaryPlayer.toLowerCase();
    for (var i = 0; i < entries.length; i++) {
      var name = String(entries[i].value.name || entries[i].value.Name || entries[i].key || '');
      if (entries[i].key === 'YOU' || name === 'YOU' || (lowerPrimary && name.toLowerCase() === lowerPrimary)) return entries[i].value;
    }
    return entries.length ? entries[0].value : {};
  }

  function combatSnapshot(data) {
    var encounter = data.Encounter || data.encounter || {};
    var entries = combatantEntries(data);
    var player = findPlayer(entries);
    var topName = '';
    var topDps = -1;
    for (var i = 0; i < entries.length; i++) {
      var dps = numberValue(entries[i].value.ENCDPS != null ? entries[i].value.ENCDPS : entries[i].value.encdps);
      if (dps > topDps) {
        topDps = dps;
        topName = String(entries[i].value.name || entries[i].value.Name || entries[i].key || '');
      }
    }
    var activeRaw = encounter.isActive;
    var active = activeRaw === undefined ? true : (activeRaw === true || String(activeRaw).toLowerCase() === 'true' || String(activeRaw) === '1');
    return {
      active: active,
      player: String(player.name || player.Name || primaryPlayer || 'YOU'),
      kills: numberValue(player.kills != null ? player.kills : player.Kills),
      deaths: numberValue(player.deaths != null ? player.deaths : player.Deaths),
      dps: numberValue(player.ENCDPS != null ? player.ENCDPS : player.encdps),
      topPlayer: topName,
      topDps: Math.max(0, topDps),
      encounter: String(encounter.title || encounter.CurrentZoneName || encounter.EncounterName || '')
    };
  }

  function isPlayerTop(snapshot) {
    var player = String(snapshot.player || '').toLowerCase();
    var top = String(snapshot.topPlayer || '').toLowerCase();
    return !!player && (top === player || top === 'you' || (primaryPlayer && top === primaryPlayer.toLowerCase()));
  }

  function triggerVideo(videoId) {
    if (!videoId) return;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', triggerVideoUrl, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (controlToken) xhr.setRequestHeader('X-Kappi-Token', controlToken);
    xhr.timeout = 4000;
    xhr.send(JSON.stringify({ id: videoId }));
  }

  function fire(item, kind, snapshot, force) {
    var cfg = ensureConfig(item);
    var rt = itemRuntime(item);
    if (!force && cfg.eventKind !== kind) return false;
    if (!readyFor(item)) { rt.error = tr('ACT oder Spiel-EXE läuft nicht', 'ACT or game EXE is not running', 'ACT o el EXE del juego no está activo'); updateStatus(item); return false; }
    var now = Date.now();
    if (!force && now - rt.lastTrigger < cfg.cooldownMs) return false;
    if (!cfg.actionName && !cfg.videoId) { rt.error = tr('Aktion oder Video fehlt', 'Action or video is missing', 'Falta la acción o el vídeo'); updateStatus(item); return false; }
    var timestamp = new Date().toISOString();
    var didTrigger = false;
    if (cfg.actionName && api.socketReady()) {
      api.send({
        request: 'DoAction',
        id: 'freakshow-act-event-' + now + '-' + Math.random().toString(16).slice(2),
        action: { name: cfg.actionName },
        args: {
          actEventName: item.name,
          actEventType: kind,
          actPlayer: snapshot.player,
          actKills: snapshot.kills,
          actDeaths: snapshot.deaths,
          actDps: snapshot.dps,
          actTopPlayer: snapshot.topPlayer,
          actTopDps: snapshot.topDps,
          actEncounter: snapshot.encounter,
          actTimestamp: timestamp
        }
      });
      didTrigger = true;
    } else if (cfg.actionName) {
      rt.error = tr('Streamer.bot ist nicht verbunden', 'Streamer.bot is not connected', 'Streamer.bot no está conectado');
    }
    if (cfg.videoId) { triggerVideo(cfg.videoId); didTrigger = true; }
    if (!didTrigger) { updateStatus(item); return false; }
    rt.lastTrigger = now;
    rt.lastEvent = kind;
    if (!cfg.actionName || api.socketReady()) rt.error = '';
    updateStatus(item);
    return true;
  }

  function finishEncounter(item, snapshot) {
    var rt = itemRuntime(item);
    if (!rt.combatActive) return;
    fire(item, 'combat_end', snapshot, false);
    if (isPlayerTop(snapshot)) fire(item, 'top_dps', snapshot, false);
    rt.combatActive = false;
    rt.thresholdAbove = false;
  }

  function handleCombatData(data) {
    lastCombatDataAt = Date.now();
    var snapshot = combatSnapshot(data);
    var items = enabledActItems();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!readyFor(item) || !socketMatches(item)) continue;
      var rt = itemRuntime(item);
      if (!rt.initialized) {
        rt.initialized = true;
        rt.combatActive = snapshot.active;
        rt.kills = snapshot.kills;
        rt.deaths = snapshot.deaths;
        rt.thresholdAbove = snapshot.dps >= ensureConfig(item).dpsThreshold;
      } else {
        if (snapshot.active && !rt.combatActive) { rt.combatActive = true; fire(item, 'combat_start', snapshot, false); }
        if (snapshot.kills > rt.kills) fire(item, 'kill', snapshot, false);
        if (snapshot.deaths > rt.deaths) fire(item, 'death', snapshot, false);
        var above = snapshot.dps >= ensureConfig(item).dpsThreshold;
        if (above && !rt.thresholdAbove) fire(item, 'dps_threshold', snapshot, false);
        rt.thresholdAbove = above;
        if (!snapshot.active && rt.combatActive) finishEncounter(item, snapshot);
      }
      rt.kills = snapshot.kills;
      rt.deaths = snapshot.deaths;
      rt.dps = snapshot.dps;
      rt.topPlayer = snapshot.topPlayer;
      rt.topDps = snapshot.topDps;
      rt.encounter = snapshot.encounter;
      updateStatus(item);
    }
  }

  function lastSnapshot(rt) {
    return { player: primaryPlayer || 'YOU', kills: rt.kills, deaths: rt.deaths, dps: rt.dps, topPlayer: rt.topPlayer, topDps: rt.topDps, encounter: rt.encounter };
  }

  function enforceProcessGate() {
    var items = enabledActItems();
    var anyReady = false;
    for (var i = 0; i < items.length; i++) {
      if (readyFor(items[i])) anyReady = true;
      else resetRuntime(items[i]);
    }
    if (!anyReady) closeSocket();
    else connectAct(false);
    if (lastCombatDataAt && Date.now() - lastCombatDataAt > ENCOUNTER_IDLE_MS) {
      for (var j = 0; j < items.length; j++) {
        var rt = itemRuntime(items[j]);
        if (rt.combatActive) finishEncounter(items[j], lastSnapshot(rt));
      }
      lastCombatDataAt = 0;
    }
    updateAllStatuses();
  }

  function socketOpen() { return !!(actSocket && actSocket.readyState === WebSocket.OPEN); }

  function updateStatus(item) {
    if (!isActItem(item)) return;
    var cfg = ensureConfig(item);
    var rt = itemRuntime(item);
    var ready = readyFor(item) && socketMatches(item);
    if (currentItemId === item.id && editorRoot && !editorRoot.hidden) {
      var card = byId('ge-act-card');
      if (card) card.classList.toggle('is-ready', ready);
      text('ge-act-card-name', item.name || 'ACT');
      text('ge-act-card-subtitle', cfg.gameProcess + '.exe · ' + cfg.eventKind);
      // Die drei Bedingungen EINZELN melden. Vorher zeigte die Karte nur die erste
      // Huerde, deshalb war nie zu sehen, ob zusaetzlich noch das Spiel fehlt.
      var actOk = actRunning();
      var gameOk = processRunning(cfg.gameProcess);
      var linkOk = socketOpen();
      var stateText = !item.enabled
        ? tr('Ausgeschaltet', 'Disabled', 'Desactivado')
        : ((actOk && gameOk && linkOk)
          ? tr('Bereit', 'Ready', 'Listo')
          : tr('Nicht bereit', 'Not ready', 'No listo'));
      text('ge-act-card-state', stateText);
      var checkText = tr('ACT: ', 'ACT: ', 'ACT: ')
          + (actOk ? tr('läuft ✓', 'running ✓', 'activo ✓') : tr('nicht gestartet ✗', 'not running ✗', 'no activo ✗'))
        + ' · ' + tr('Spiel: ', 'Game: ', 'Juego: ')
          + (gameOk ? tr('läuft ✓', 'running ✓', 'activo ✓') : tr('nicht gestartet ✗', 'not running ✗', 'no activo ✗'))
        + ' · ' + tr('Verbindung: ', 'Connection: ', 'Conexión: ')
          + (linkOk ? tr('steht ✓', 'open ✓', 'abierta ✓') : tr('getrennt ✗', 'disconnected ✗', 'desconectada ✗'));
      var readyDetail = tr('Kills: ', 'Kills: ', 'Bajas: ') + rt.kills + ' · DPS: ' + Math.round(rt.dps)
        + ' · ' + tr('Top: ', 'Top: ', 'Máximo: ') + (rt.topPlayer || '—');
      // Fehlermeldung hat Vorrang, sonst bei Bereitschaft die Zahlen und sonst die Pruefliste.
      text('ge-act-card-detail', rt.error || ((actOk && gameOk && linkOk) ? readyDetail : checkText));
      var detailNode = byId('ge-act-card-detail');
      if (detailNode) detailNode.title = checkText + (rt.error ? '\n' + rt.error : '');
    }
  }

  function updateAllStatuses() {
    var state = api.state();
    var items = state && Array.isArray(state.items) ? state.items : [];
    for (var i = 0; i < items.length; i++) if (isActItem(items[i])) updateStatus(items[i]);
    decorateVisibleRows();
  }

  function decorateListItem(row, item) {
    // Alte Textanzeige („Wartet/Bereit“) entfernen. Sie erzeugte eine vierte
    // Grid-Spalte und drueckte den Schalter in eine zweite Zeile.
    var status = row.querySelector('.game-event-act-list-status');
    if (status && status.parentNode) status.parentNode.removeChild(status);

    var cfg = ensureConfig(item);
    var actOk = actRunning();
    var gameOk = processRunning(cfg.gameProcess);
    var linkOk = socketMatches(item);
    var connectedCount = (actOk ? 1 : 0) + (gameOk ? 1 : 0) + (linkOk ? 1 : 0);
    var badge = row.querySelector('.game-event-type-act');
    if (!badge) return;
    badge.classList.remove('act-status-none', 'act-status-partial', 'act-status-full');
    badge.classList.add(connectedCount === 3 ? 'act-status-full' : (connectedCount > 0 ? 'act-status-partial' : 'act-status-none'));
    badge.title = tr('ACT: ', 'ACT: ', 'ACT: ')
        + (actOk ? tr('läuft', 'running', 'activo') : tr('nicht gestartet', 'not running', 'no activo'))
      + ' · ' + tr('Spiel: ', 'Game: ', 'Juego: ')
        + (gameOk ? tr('läuft', 'running', 'activo') : tr('nicht gestartet', 'not running', 'no activo'))
      + ' · ' + tr('Verbindung: ', 'Connection: ', 'Conexión: ')
        + (linkOk ? tr('steht', 'open', 'abierta') : tr('getrennt', 'disconnected', 'desconectada'));
  }

  function decorateVisibleRows() {
    var rows = document.querySelectorAll('[data-game-event-id]');
    for (var i = 0; i < rows.length; i++) {
      var item = api.find(rows[i].getAttribute('data-game-event-id'));
      if (isActItem(item)) decorateListItem(rows[i], item);
    }
  }

  function saveCurrent(mutator, reset) {
    var item = api.find(api.selectedId());
    if (!isActItem(item)) return;
    mutator(item, ensureConfig(item));
    if (reset) resetRuntime(item);
    api.save();
    updateStatus(item);
  }

  function syncThresholdField() {
    var field = byId('ge-act-threshold-field');
    var select = byId('ge-act-kind');
    if (field && select) field.hidden = select.value !== 'dps_threshold';
  }

  function bindEditorEvents() {
    byId('ge-act-name').addEventListener('change', function () { saveCurrent(function (item) { item.name = String(byId('ge-act-name').value || '').trim() || item.name; }); api.render(); });
    byId('ge-act-url').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.actUrl = String(byId('ge-act-url').value || '').trim(); }, true); connectAct(true); });
    byId('ge-act-game').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.gameProcess = cleanProcessName(byId('ge-act-game').value) || 'ffxiv_dx11'; }, true); enforceProcessGate(); });
    byId('ge-act-kind').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.eventKind = byId('ge-act-kind').value; }, true); syncThresholdField(); });
    byId('ge-act-threshold').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.dpsThreshold = clamp(byId('ge-act-threshold').value, 1, 999999999, 10000); }, true); });
    byId('ge-act-action').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.actionName = String(byId('ge-act-action').value || '').trim(); }); });
    byId('ge-act-video').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.videoId = byId('ge-act-video').value; }); });
    byId('ge-act-cooldown').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.cooldownMs = clamp(byId('ge-act-cooldown').value, 0, 600000, 750); }); });
    byId('ge-act-refresh').onclick = function () { loadProcesses(true); };
    byId('ge-act-connect').onclick = function () { loadProcesses(true); connectAct(true); };
    byId('ge-act-test').onclick = function () {
      var item = api.find(api.selectedId());
      if (!isActItem(item)) return;
      var cfg = ensureConfig(item);
      var snapshot = { player: primaryPlayer || 'YOU', kills: 1, deaths: 0, dps: cfg.dpsThreshold + 1, topPlayer: primaryPlayer || 'YOU', topDps: cfg.dpsThreshold + 1, encounter: tr('Testkampf', 'Test encounter', 'Combate de prueba') };
      fire(item, cfg.eventKind, snapshot, true);
    };
  }

  function syncEditor(item, editor) {
    if (!isActItem(item)) { hideEditor(); return; }
    buildEditor(editor);
    currentItemId = item.id;
    editorRoot.hidden = false;
    applyLabels();
    applyGeometry();
    var cfg = ensureConfig(item);
    byId('ge-act-name').value = item.name || '';
    byId('ge-act-url').value = cfg.actUrl || '';
    byId('ge-act-game').value = cfg.gameProcess + '.exe';
    byId('ge-act-kind').value = cfg.eventKind;
    byId('ge-act-threshold').value = cfg.dpsThreshold;
    byId('ge-act-action').value = cfg.actionName || '';
    byId('ge-act-cooldown').value = cfg.cooldownMs;
    populateProcesses();
    populateVideos(cfg.videoId);
    loadVideos(cfg.videoId);
    syncThresholdField();
    updateStatus(item);
    loadProcesses(true);
  }

  function hideEditor() {
    currentItemId = '';
    if (editorRoot) editorRoot.hidden = true;
  }

  function schedulePoll(delay) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(function tick() {
      loadProcesses(false);
      // Videoliste laufend nachziehen: Umbenennen oder Umgruppieren im Video-Reiter
      // soll hier ankommen, ohne dass die Seite neu geladen werden muss.
      var now = Date.now();
      if (editorRoot && !editorRoot.hidden && now - videoReloadAt >= VIDEO_RELOAD_INTERVAL_MS) {
        videoReloadAt = now;
        loadVideos(null);
      }
      pollTimer = setTimeout(tick, PROCESS_POLL_INTERVAL_MS);
    }, delay == null ? PROCESS_POLL_INTERVAL_MS : delay);
  }

  function init() {
    injectStyles();
    api.render();
    schedulePoll(250);
    window.addEventListener('resize', function () { if (currentItemId && editorRoot && !editorRoot.hidden) applyGeometry(); });
    window.addEventListener('beforeunload', function () { if (pollTimer) clearTimeout(pollTimer); closeSocket(); });
  }

  window.FreakShowActEvent = {
    syncEditor: syncEditor,
    hideEditor: hideEditor,
    decorateListItem: decorateListItem,
    connect: connectAct,
    init: init
  };

  init();
})();
