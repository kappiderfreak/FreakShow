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
  var providerSocket = null;
  var providerUrl = '';
  var pollTimer = 0;
  var pollBusy = false;
  var PROCESS_POLL_INTERVAL_MS = 1000;

  function tr(de, en, es) { return api.text ? api.text(de, en, es) : de; }
  function byId(id) { return document.getElementById(id); }
  function text(id, value) { var el = byId(id); if (el) el.textContent = value; }
  function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
  }
  function cleanProcessName(value) {
    var name = String(value || '').trim().replace(/^['"]|['"]$/g, '');
    var parts = name.split(/[\\/]/);
    return parts[parts.length - 1].replace(/\.exe$/i, '').trim().toLowerCase();
  }
  function isOverwolfItem(item) { return !!(item && item.eventType === 'overwolf'); }

  function ensureConfig(item) {
    var changed = false;
    if (!item.overwolfEvent || typeof item.overwolfEvent !== 'object') { item.overwolfEvent = {}; changed = true; }
    var cfg = item.overwolfEvent;
    var defaults = {
      providerUrl: '',
      gameProcess: '',
      eventName: 'kill',
      actionName: 'FreakShow - Overwolf Event',
      videoId: '',
      cooldownMs: 750
    };
    Object.keys(defaults).forEach(function (key) {
      if (cfg[key] === undefined || cfg[key] === null) { cfg[key] = defaults[key]; changed = true; }
    });
    cfg.gameProcess = cleanProcessName(cfg.gameProcess);
    cfg.eventName = String(cfg.eventName || 'kill').trim().toLowerCase();
    cfg.cooldownMs = clamp(cfg.cooldownMs, 0, 600000, 750);
    if (changed) api.save();
    return cfg;
  }

  function itemRuntime(item) {
    if (!runtime[item.id]) runtime[item.id] = { lastTrigger: 0, lastEvent: '', lastData: '', error: '' };
    return runtime[item.id];
  }

  function processRunning(name) {
    var wanted = cleanProcessName(name);
    if (!wanted) return false;
    for (var i = 0; i < processCache.length; i++) if (cleanProcessName(processCache[i].name) === wanted) return true;
    return false;
  }

  function overwolfRunning() {
    for (var i = 0; i < processCache.length; i++) {
      var name = cleanProcessName(processCache[i].name).replace(/\s+/g, '');
      if (name.indexOf('overwolf') === 0) return true;
    }
    return false;
  }

  function readyFor(item) {
    var cfg = ensureConfig(item);
    return !!item.enabled && overwolfRunning() && !!cfg.gameProcess && processRunning(cfg.gameProcess);
  }

  function providerMatches(item) {
    return providerOpen() && String(ensureConfig(item).providerUrl || '').trim() === providerUrl;
  }

  function injectStyles() {
    if (document.getElementById('game-event-overwolf-style')) return;
    var style = document.createElement('style');
    style.id = 'game-event-overwolf-style';
    style.textContent = [
      '.game-event-overwolf-root{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:12px}',
      '.game-event-overwolf-root[hidden]{display:none!important}',
      '.game-event-overwolf-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--ed-settings-w,minmax(300px,420px));align-items:start;gap:var(--ed-gap,16px);width:100%;min-width:0}',
      '.game-event-overwolf-overview{display:flex;width:min(100%,calc((100vh - 240px) * var(--geo-monitor-aspect-number,1.777777)));max-width:var(--ed-monitor-max,1100px);min-width:0;aspect-ratio:var(--geo-monitor-aspect,16 / 9);justify-self:center;margin:0 auto}',
      '.game-event-overwolf-card{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:28px;box-sizing:border-box;border:1px solid #238db9;border-radius:var(--ed-monitor-radius,7px);background-color:#090d14;background-image:radial-gradient(circle at center,rgba(36,168,224,.13),transparent 48%),linear-gradient(rgba(36,168,224,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(36,168,224,.08) 1px,transparent 1px);background-size:auto,32px 32px,32px 32px;text-align:center}',
      '.game-event-overwolf-card.is-ready{border-color:#38d477}',
      '.game-event-overwolf-icon{display:grid;place-items:center;width:64px;height:64px;margin-bottom:12px;border:1px solid #238db9;border-radius:50%;color:#67c8ef;font-size:24px;font-weight:700}',
      '.game-event-overwolf-card.is-ready .game-event-overwolf-icon{border-color:#38d477;color:#77efaa}',
      '.game-event-overwolf-card h3{max-width:100%;margin:0 0 5px;color:var(--t-text,#e8eef8);font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.game-event-overwolf-subtitle,.game-event-overwolf-detail{color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-overwolf-state{margin:12px 0 10px;padding:4px 9px;border:1px solid var(--t-list-border,rgba(255,255,255,.14));border-radius:999px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-overwolf-card.is-ready .game-event-overwolf-state{border-color:#38d477;color:#77efaa}',
      '.game-event-overwolf-settings{display:grid;align-content:start;gap:10px;min-width:0;padding-top:2px}',
      '.game-event-overwolf-field{display:grid;gap:4px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-overwolf-field>input,.game-event-overwolf-field>select{width:100%;box-sizing:border-box}',
      '.game-event-overwolf-input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}',
      '.game-event-overwolf-help{font-size:10px;line-height:1.4;color:var(--t-muted,#8ea0b8)}',
      '.game-event-overwolf-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;flex-wrap:wrap}',
      '.game-event-type-overwolf{transition:border-color .16s ease,color .16s ease,background-color .16s ease}',
      '.game-event-type-overwolf.overwolf-status-none{border-color:#e0655a!important;color:#ff8a80!important;background:rgba(224,101,90,.12)!important}',
      '.game-event-type-overwolf.overwolf-status-partial{border-color:#d7963b!important;color:#f0b85f!important;background:rgba(215,150,59,.12)!important}',
      '.game-event-type-overwolf.overwolf-status-full{border-color:#38d477!important;color:#77efaa!important;background:rgba(56,212,119,.12)!important}',
      '@media(max-width:2100px){.game-event-overwolf-layout{grid-template-columns:minmax(0,1fr)}.game-event-overwolf-settings{grid-template-columns:repeat(2,minmax(0,1fr))}.game-event-overwolf-help{grid-column:1/-1}}',
      '@media(max-width:720px){.game-event-overwolf-settings{grid-template-columns:minmax(0,1fr)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildEditor(editor) {
    if (editorRoot && editorRoot.isConnected) return editorRoot;
    editorRoot = document.createElement('div');
    editorRoot.id = 'game-event-overwolf-root';
    editorRoot.className = 'game-event-overwolf-root game-control-editor-body';
    editorRoot.hidden = true;
    editorRoot.innerHTML = '' +
      '<div class="game-event-overwolf-layout game-control-editor-primary">' +
        '<section id="ge-overwolf-overview" class="game-event-overwolf-overview game-control-keyboard-fit ed-slot-monitor">' +
          '<div id="ge-overwolf-card" class="game-event-overwolf-card">' +
            '<div class="game-event-overwolf-icon">OW</div>' +
            '<h3 id="ge-overwolf-card-name"></h3>' +
            '<div id="ge-overwolf-card-subtitle" class="game-event-overwolf-subtitle"></div>' +
            '<div id="ge-overwolf-card-state" class="game-event-overwolf-state"></div>' +
            '<div id="ge-overwolf-card-detail" class="game-event-overwolf-detail"></div>' +
          '</div>' +
        '</section>' +
        '<aside class="game-event-overwolf-settings game-control-settings ed-slot-settings">' +
          '<label class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="name"></span><input id="ge-overwolf-name" type="text" maxlength="120"></label>' +
          '<label class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="provider"></span><input id="ge-overwolf-provider" type="text" maxlength="300" placeholder="ws://127.0.0.1:PORT/..."> </label>' +
          '<div class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="game"></span><div class="game-event-overwolf-input-row"><input id="ge-overwolf-game" type="text" maxlength="124" list="ge-overwolf-process-list" placeholder="game.exe"><button id="ge-overwolf-refresh" type="button"></button></div><datalist id="ge-overwolf-process-list"></datalist></div>' +
          '<label class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="event"></span><input id="ge-overwolf-event" type="text" maxlength="120" list="ge-overwolf-event-list"><datalist id="ge-overwolf-event-list"><option value="kill"><option value="death"><option value="assist"><option value="match_start"><option value="match_end"><option value="round_start"><option value="round_end"></datalist></label>' +
          '<label class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="action"></span><input id="ge-overwolf-action" type="text" maxlength="180"></label>' +
          '<label class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="video"></span><select id="ge-overwolf-video"></select></label>' +
          '<label class="game-event-overwolf-field game-control-setting-field"><span data-geo-label="cooldown"></span><input id="ge-overwolf-cooldown" type="number" min="0" max="600000" step="250"></label>' +
          '<div class="game-event-overwolf-help" data-geo-label="providerHint"></div>' +
          '<div class="game-event-overwolf-help" data-geo-label="gate"></div>' +
          '<div class="game-event-overwolf-help" data-geo-label="variables"></div>' +
        '</aside>' +
      '</div>' +
      '<div class="game-event-overwolf-actions game-control-actions ed-slot-actions"><button id="ge-overwolf-connect" type="button"></button><button id="ge-overwolf-test" type="button" class="btn-success"></button></div>';
    editor.appendChild(editorRoot);
    bindEditorEvents();
    return editorRoot;
  }

  function applyLabels() {
    if (!editorRoot) return;
    var labels = {
      name: tr('Name', 'Name', 'Nombre'),
      provider: tr('Overwolf-Provider-WebSocket', 'Overwolf provider WebSocket', 'WebSocket del proveedor de Overwolf'),
      game: tr('Spiel-EXE (muss laufen)', 'Game EXE (must be running)', 'EXE del juego (debe estar activo)'),
      event: tr('Overwolf-Ereignisname', 'Overwolf event name', 'Nombre del evento de Overwolf'),
      action: tr('Streamer.bot-Aktion', 'Streamer.bot action', 'Acción de Streamer.bot'),
      video: tr('Video einblenden', 'Show video', 'Mostrar vídeo'),
      cooldown: tr('Sperrzeit nach Auslösung (ms)', 'Cooldown after trigger (ms)', 'Espera tras activar (ms)'),
      providerHint: tr('Overwolf stellt GEP-Daten nur einer Overwolf-App bereit. Hier wird der lokale WebSocket eines solchen Providers eingetragen; FreakShow selbst täuscht keine direkte Overwolf-Verbindung vor.', 'Overwolf exposes GEP data only to an Overwolf app. Enter that app’s local provider WebSocket here; FreakShow does not pretend that Overwolf itself exposes a socket.', 'Overwolf ofrece datos GEP solo a una app de Overwolf. Introduce aquí el WebSocket local de ese proveedor; FreakShow no simula una conexión directa.'),
      gate: tr('Sicherheitsprüfung: Overwolf und die eingetragene Spiel-EXE müssen gleichzeitig laufen. Sonst wird nichts ausgelöst.', 'Safety check: Overwolf and the configured game EXE must be running at the same time. Otherwise nothing triggers.', 'Comprobación: Overwolf y el EXE del juego configurado deben estar activos a la vez. De lo contrario no se activa nada.'),
      variables: tr('Variablen: %overwolfEventName%, %overwolfGameExe%, %overwolfGameName%, %overwolfGameId%, %overwolfEventData%, %overwolfTimestamp%', 'Variables: %overwolfEventName%, %overwolfGameExe%, %overwolfGameName%, %overwolfGameId%, %overwolfEventData%, %overwolfTimestamp%', 'Variables: %overwolfEventName%, %overwolfGameExe%, %overwolfGameName%, %overwolfGameId%, %overwolfEventData%, %overwolfTimestamp%')
    };
    Object.keys(labels).forEach(function (key) {
      var el = editorRoot.querySelector('[data-geo-label="' + key + '"]');
      if (el) el.textContent = labels[key];
    });
    text('ge-overwolf-refresh', tr('Aktualisieren', 'Refresh', 'Actualizar'));
    text('ge-overwolf-connect', tr('Provider verbinden', 'Connect provider', 'Conectar proveedor'));
    text('ge-overwolf-test', tr('Event testen', 'Test event', 'Probar evento'));
  }

  function applyGeometry() {
    var overview = byId('ge-overwolf-overview');
    if (!overview) return;
    var widthInput = byId('cfg-monitor-width');
    var heightInput = byId('cfg-monitor-height');
    var width = Math.max(1, Number(widthInput && widthInput.value) || 1920);
    var height = Math.max(1, Number(heightInput && heightInput.value) || 1080);
    overview.style.setProperty('--geo-monitor-aspect', width + ' / ' + height);
    overview.style.setProperty('--geo-monitor-aspect-number', String(width / height));
  }

  function populateProcesses() {
    var list = byId('ge-overwolf-process-list');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 0; i < processCache.length; i++) {
      var name = String(processCache[i].name || '').trim();
      if (!name || cleanProcessName(name).indexOf('overwolf') === 0) continue;
      var option = document.createElement('option');
      option.value = /\.exe$/i.test(name) ? name : name + '.exe';
      list.appendChild(option);
    }
  }

  // Gruppe voran, damit gleichnamige Videos aus verschiedenen Gruppen
  // unterscheidbar sind.
  function videoOptionLabel(video) {
    var name = String(video.name || video.id || tr('Video', 'Video', 'Vídeo'));
    var group = String(video.group || '').trim();
    if (!group) return tr('Ohne Gruppe', 'Ungrouped', 'Sin grupo') + ' · ' + name;
    return group + ' · ' + name;
  }

  function videoListSignature() {
    var parts = [];
    for (var i = 0; i < videoCache.length; i++) {
      parts.push(String(videoCache[i].id || '') + '' + videoOptionLabel(videoCache[i]));
    }
    return parts.join('');
  }

  function populateVideos(selected) {
    var select = byId('ge-overwolf-video');
    if (!select) return;
    var signature = videoListSignature();
    var keep = (selected == null) ? select.value : selected;
    // Unveraendert? Dann nicht neu bauen - sonst klappt die offene Auswahl zu.
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
    // Ohne Kontroll-Token weist die Bridge die Abfrage ab - die Prozessliste
    // bliebe leer und jedes Spiel gaelte als nicht gestartet.
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

  function enabledItems() {
    var state = api.state();
    var items = state && Array.isArray(state.items) ? state.items : [];
    return items.filter(function (item) { return isOverwolfItem(item) && item.enabled; });
  }

  function closeProvider() {
    var socket = providerSocket;
    providerSocket = null;
    providerUrl = '';
    if (socket) {
      try { socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null; socket.close(); } catch (e) {}
    }
  }

  function providerOpen() { return !!(providerSocket && providerSocket.readyState === WebSocket.OPEN); }

  function connectProvider(force) {
    var items = enabledItems();
    var readyItem = null;
    for (var i = 0; i < items.length; i++) if (readyFor(items[i]) && ensureConfig(items[i]).providerUrl) { readyItem = items[i]; break; }
    if (!readyItem) { closeProvider(); updateAllStatuses(); return; }
    var url = String(ensureConfig(readyItem).providerUrl || '').trim();
    if (!force && providerSocket && providerUrl === url && (providerSocket.readyState === WebSocket.OPEN || providerSocket.readyState === WebSocket.CONNECTING)) return;
    closeProvider();
    providerUrl = url;
    try { providerSocket = new WebSocket(url); } catch (e) { providerSocket = null; updateAllStatuses(); return; }
    providerSocket.onopen = function () { updateAllStatuses(); };
    providerSocket.onmessage = function (event) {
      var message;
      try { message = JSON.parse(event.data || '{}'); } catch (e) { return; }
      handleProviderMessage(message);
    };
    providerSocket.onerror = function () { updateAllStatuses(); };
    providerSocket.onclose = function () { providerSocket = null; providerUrl = ''; updateAllStatuses(); };
  }

  function normalizeEvent(entry, envelope) {
    var rawData = entry && entry.data !== undefined ? entry.data : (envelope && envelope.data !== undefined ? envelope.data : {});
    if (typeof rawData === 'string') {
      try { rawData = JSON.parse(rawData); } catch (e) {}
    }
    return {
      name: String((entry && (entry.name || entry.event)) || (envelope && (envelope.name || envelope.event)) || '').trim().toLowerCase(),
      data: rawData,
      gameName: String((entry && entry.gameName) || (envelope && envelope.gameName) || ''),
      gameId: String((entry && entry.gameId) || (envelope && envelope.gameId) || ''),
      gameExe: cleanProcessName((entry && entry.gameExe) || (envelope && envelope.gameExe) || '')
    };
  }

  function handleProviderMessage(message) {
    var source = Array.isArray(message.events) ? message.events : [message];
    for (var s = 0; s < source.length; s++) {
      var event = normalizeEvent(source[s], message);
      if (!event.name) continue;
      var items = enabledItems();
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var cfg = ensureConfig(item);
        if (!readyFor(item) || !providerMatches(item) || cfg.eventName !== event.name) continue;
        if (event.gameExe && event.gameExe !== cfg.gameProcess) continue;
        fire(item, event, false);
      }
    }
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

  function fire(item, event, force) {
    var cfg = ensureConfig(item);
    var rt = itemRuntime(item);
    if (!readyFor(item)) { rt.error = tr('Overwolf oder Spiel-EXE läuft nicht', 'Overwolf or game EXE is not running', 'Overwolf o el EXE del juego no está activo'); updateStatus(item); return false; }
    var now = Date.now();
    if (!force && now - rt.lastTrigger < cfg.cooldownMs) return false;
    if (!cfg.actionName && !cfg.videoId) { rt.error = tr('Aktion oder Video fehlt', 'Action or video is missing', 'Falta la acción o el vídeo'); updateStatus(item); return false; }
    var timestamp = new Date().toISOString();
    var didTrigger = false;
    if (cfg.actionName && api.socketReady()) {
      api.send({
        request: 'DoAction',
        id: 'freakshow-overwolf-event-' + now + '-' + Math.random().toString(16).slice(2),
        action: { name: cfg.actionName },
        args: {
          overwolfEventName: event.name,
          overwolfGameExe: cfg.gameProcess + '.exe',
          overwolfGameName: event.gameName,
          overwolfGameId: event.gameId,
          overwolfEventData: typeof event.data === 'string' ? event.data : JSON.stringify(event.data || {}),
          overwolfTimestamp: timestamp
        }
      });
      didTrigger = true;
    } else if (cfg.actionName) {
      rt.error = tr('Streamer.bot ist nicht verbunden', 'Streamer.bot is not connected', 'Streamer.bot no está conectado');
    }
    if (cfg.videoId) { triggerVideo(cfg.videoId); didTrigger = true; }
    if (!didTrigger) { updateStatus(item); return false; }
    rt.lastTrigger = now;
    rt.lastEvent = event.name;
    rt.lastData = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || {});
    if (!cfg.actionName || api.socketReady()) rt.error = '';
    updateStatus(item);
    return true;
  }

  function enforceProcessGate() {
    var items = enabledItems();
    var anyReadyProvider = false;
    for (var i = 0; i < items.length; i++) {
      var cfg = ensureConfig(items[i]);
      if (readyFor(items[i]) && cfg.providerUrl) anyReadyProvider = true;
    }
    if (!anyReadyProvider) closeProvider();
    else connectProvider(false);
    updateAllStatuses();
  }

  function updateStatus(item) {
    if (!isOverwolfItem(item)) return;
    var cfg = ensureConfig(item);
    var rt = itemRuntime(item);
    var ready = readyFor(item) && providerMatches(item);
    if (currentItemId === item.id && editorRoot && !editorRoot.hidden) {
      var card = byId('ge-overwolf-card');
      if (card) card.classList.toggle('is-ready', ready);
      text('ge-overwolf-card-name', item.name || 'Overwolf');
      text('ge-overwolf-card-subtitle', (cfg.gameProcess ? cfg.gameProcess + '.exe' : tr('Keine Spiel-EXE', 'No game EXE', 'Sin EXE del juego')) + ' · ' + cfg.eventName);
      var stateText = !item.enabled
        ? tr('Ausgeschaltet', 'Disabled', 'Desactivado')
        : (!overwolfRunning()
          ? tr('Overwolf nicht gestartet', 'Overwolf not running', 'Overwolf no está activo')
          : (!cfg.gameProcess || !processRunning(cfg.gameProcess)
            ? tr('Spiel nicht gestartet', 'Game not running', 'El juego no está activo')
            : (!cfg.providerUrl
              ? tr('Provider-URL fehlt', 'Provider URL missing', 'Falta la URL del proveedor')
              : (providerOpen() ? tr('Bereit', 'Ready', 'Listo') : tr('Provider getrennt', 'Provider disconnected', 'Proveedor desconectado')))));
      text('ge-overwolf-card-state', stateText);
      text('ge-overwolf-card-detail', rt.error || (rt.lastEvent ? tr('Letztes Event: ', 'Last event: ', 'Último evento: ') + rt.lastEvent : tr('Wartet auf Overwolf-GEP-Daten', 'Waiting for Overwolf GEP data', 'Esperando datos GEP de Overwolf')));
    }
  }

  function updateAllStatuses() {
    var state = api.state();
    var items = state && Array.isArray(state.items) ? state.items : [];
    for (var i = 0; i < items.length; i++) if (isOverwolfItem(items[i])) updateStatus(items[i]);
    decorateVisibleRows();
  }

  function decorateListItem(row, item) {
    var oldStatus = row.querySelector('.game-event-overwolf-list-status');
    if (oldStatus && oldStatus.parentNode) oldStatus.parentNode.removeChild(oldStatus);
    var cfg = ensureConfig(item);
    var overwolfOk = overwolfRunning();
    var gameOk = !!cfg.gameProcess && processRunning(cfg.gameProcess);
    var providerOk = providerMatches(item);
    var connectedCount = (overwolfOk ? 1 : 0) + (gameOk ? 1 : 0) + (providerOk ? 1 : 0);
    var badge = row.querySelector('.game-event-type-overwolf');
    if (!badge) return;
    badge.classList.remove('overwolf-status-none', 'overwolf-status-partial', 'overwolf-status-full');
    badge.classList.add(connectedCount === 3 ? 'overwolf-status-full' : (connectedCount > 0 ? 'overwolf-status-partial' : 'overwolf-status-none'));
    badge.title = 'Overwolf: ' + (overwolfOk ? tr('läuft', 'running', 'activo') : tr('nicht gestartet', 'not running', 'no activo'))
      + ' · ' + tr('Spiel: ', 'Game: ', 'Juego: ') + (gameOk ? tr('läuft', 'running', 'activo') : tr('nicht gestartet', 'not running', 'no activo'))
      + ' · ' + tr('Verbindung: ', 'Connection: ', 'Conexión: ') + (providerOk ? tr('steht', 'open', 'abierta') : tr('getrennt', 'disconnected', 'desconectada'));
  }

  function decorateVisibleRows() {
    var rows = document.querySelectorAll('[data-game-event-id]');
    for (var i = 0; i < rows.length; i++) {
      var item = api.find(rows[i].getAttribute('data-game-event-id'));
      if (isOverwolfItem(item)) decorateListItem(rows[i], item);
    }
  }

  function saveCurrent(mutator) {
    var item = api.find(api.selectedId());
    if (!isOverwolfItem(item)) return;
    mutator(item, ensureConfig(item));
    api.save();
    updateStatus(item);
  }

  function bindEditorEvents() {
    byId('ge-overwolf-name').addEventListener('change', function () { saveCurrent(function (item) { item.name = String(byId('ge-overwolf-name').value || '').trim() || item.name; }); api.render(); });
    byId('ge-overwolf-provider').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.providerUrl = String(byId('ge-overwolf-provider').value || '').trim(); }); connectProvider(true); });
    byId('ge-overwolf-game').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.gameProcess = cleanProcessName(byId('ge-overwolf-game').value); }); enforceProcessGate(); });
    byId('ge-overwolf-event').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.eventName = String(byId('ge-overwolf-event').value || 'kill').trim().toLowerCase(); }); });
    byId('ge-overwolf-action').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.actionName = String(byId('ge-overwolf-action').value || '').trim(); }); });
    byId('ge-overwolf-video').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.videoId = byId('ge-overwolf-video').value; }); });
    byId('ge-overwolf-cooldown').addEventListener('change', function () { saveCurrent(function (item, cfg) { cfg.cooldownMs = clamp(byId('ge-overwolf-cooldown').value, 0, 600000, 750); }); });
    byId('ge-overwolf-refresh').onclick = function () { loadProcesses(true); };
    byId('ge-overwolf-connect').onclick = function () { loadProcesses(true); connectProvider(true); };
    byId('ge-overwolf-test').onclick = function () {
      var item = api.find(api.selectedId());
      if (!isOverwolfItem(item)) return;
      var cfg = ensureConfig(item);
      fire(item, { name: cfg.eventName, data: { test: true }, gameName: 'Test', gameId: 'test', gameExe: cfg.gameProcess }, true);
    };
  }

  function syncEditor(item, editor) {
    if (!isOverwolfItem(item)) { hideEditor(); return; }
    buildEditor(editor);
    currentItemId = item.id;
    editorRoot.hidden = false;
    applyLabels();
    applyGeometry();
    var cfg = ensureConfig(item);
    byId('ge-overwolf-name').value = item.name || '';
    byId('ge-overwolf-provider').value = cfg.providerUrl || '';
    byId('ge-overwolf-game').value = cfg.gameProcess ? cfg.gameProcess + '.exe' : '';
    byId('ge-overwolf-event').value = cfg.eventName || 'kill';
    byId('ge-overwolf-action').value = cfg.actionName || '';
    byId('ge-overwolf-cooldown').value = cfg.cooldownMs;
    populateProcesses();
    populateVideos(cfg.videoId);
    loadVideos(cfg.videoId);
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
      // Videoliste laufend nachziehen, damit Umbenennen oder Umgruppieren im
      // Video-Reiter ohne Neuladen der Seite ankommt.
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
    schedulePoll(350);
    window.addEventListener('resize', function () { if (currentItemId && editorRoot && !editorRoot.hidden) applyGeometry(); });
    window.addEventListener('beforeunload', function () { if (pollTimer) clearTimeout(pollTimer); closeProvider(); });
  }

  window.FreakShowOverwolfEvent = {
    syncEditor: syncEditor,
    hideEditor: hideEditor,
    decorateListItem: decorateListItem,
    connect: connectProvider,
    init: init
  };

  init();
})();
