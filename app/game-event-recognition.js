(function () {
  'use strict';

  var api = window.FreakShowGameEventApi;
  if (!api) return;

  var bridgeOrigin = String(window.BRIDGE_ORIGIN || window.location.origin || '').replace(/\/+$/, '');
  var controlToken = String(window.BRIDGE_CONTROL_TOKEN || '');
  var captureUrl = bridgeOrigin + '/screen-capture';
  var uploadUrl = bridgeOrigin + '/video-upload';
  var monitorsUrl = bridgeOrigin + '/monitors';
  var runtime = Object.create(null);
  var referenceCache = Object.create(null);
  var monitorList = [];
  var editorRoot = null;
  var currentItemId = '';
  var previewBitmap = null;
  var scanCursor = 0;
  var scanTimer = 0;
  var scanBusy = false;
  var livePreviewTimer = 0;
  var livePreviewBusy = false;
  var livePreviewEnabled = true;
  var LIVE_PREVIEW_INTERVAL_MS = 500;

  function tr(de, en, es) {
    return api.text ? api.text(de, en, es) : de;
  }

  function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
  }

  function ensureRecognition(item) {
    var changed = false;
    if (!item.recognition || typeof item.recognition !== 'object') {
      item.recognition = {};
      changed = true;
    }
    var r = item.recognition;
    var defaults = {
      referencePath: '', monitor: 0, threshold: 95, stableMs: 750,
      cooldownMs: 3000, scanIntervalMs: 500,
      actionName: 'FreakShow - Image Recognition', triggerLost: false
    };
    Object.keys(defaults).forEach(function (key) {
      if (r[key] === undefined || r[key] === null) { r[key] = defaults[key]; changed = true; }
    });
    if (!r.region || typeof r.region !== 'object') {
      r.region = { x: 0, y: 0, width: 640, height: 360 };
      changed = true;
    }
    if (changed) api.save();
    return r;
  }

  function selectedItem() {
    return api.find(api.selectedId());
  }

  function isRecognitionItem(item) {
    return !!(item && (!item.eventType || item.eventType === 'recognition'));
  }

  function itemRuntime(item) {
    if (!runtime[item.id]) runtime[item.id] = {
      confidence: 0, state: 'idle', detected: false, matchSince: 0,
      lostSince: 0, lastTrigger: 0, lastScan: 0, error: ''
    };
    return runtime[item.id];
  }

  function injectStyles() {
    if (document.getElementById('game-event-recognition-style')) return;
    var style = document.createElement('style');
    style.id = 'game-event-recognition-style';
    style.textContent = [
      '.game-event-recognition-root{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:12px}',
      '.game-event-recognition-root[hidden]{display:none!important}',
      '.game-event-recognition-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--ed-settings-w,minmax(300px,420px));align-items:start;gap:var(--ed-gap,16px);width:100%;min-width:0}',
      '.game-event-recognition-preview-panel{display:flex;flex-direction:column;width:100%;max-width:var(--ed-monitor-max,1100px);min-width:0;justify-self:center;margin:0 auto;gap:8px}',
      '.game-event-recognition-toolbar{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}',
      '.game-event-recognition-toolbar label{display:grid;gap:4px;min-width:190px;flex:1 1 220px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-recognition-stage{position:relative;display:flex;align-items:center;justify-content:center;align-self:center;width:min(100%,calc((100vh - 240px) * var(--ge-monitor-aspect-number,1.777777)));max-width:var(--ed-monitor-max,1100px);aspect-ratio:var(--ge-monitor-aspect,16 / 9);min-height:0;flex:0 0 auto;overflow:hidden;border:1px solid var(--kappi-accent-border,#8b5cf6);border-radius:var(--ed-monitor-radius,7px);background-color:#090d14;background-image:linear-gradient(rgba(139,92,246,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,.12) 1px,transparent 1px);background-size:32px 32px;cursor:crosshair;user-select:none}',
      '.game-event-recognition-stage canvas{display:block;width:100%;height:100%;max-width:none;max-height:none}',
      '.game-event-recognition-live-button.is-live{border-color:#38d477;color:#77efaa}',
      '.game-event-recognition-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--t-muted,#8ea0b8);pointer-events:none}',
      '.game-event-recognition-empty[hidden]{display:none!important}',
      '.game-event-recognition-status{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:30px;padding:6px 9px;border:1px solid var(--t-list-border,rgba(255,255,255,.14));border-radius:7px;color:var(--t-muted,#aebbd0)}',
      '.game-event-recognition-status strong{color:var(--t-text,#e8eef8)}',
      '.game-event-recognition-status.is-detected{border-color:#38d477;color:#77efaa}',
      '.game-event-recognition-status.is-error{border-color:#e76767;color:#ff9b9b}',
      '.game-event-recognition-settings{display:grid;align-content:start;gap:10px;min-width:0;padding-top:2px;box-sizing:border-box}',
      '.game-event-recognition-field{display:grid;gap:4px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-recognition-field>input,.game-event-recognition-field>select{width:100%;box-sizing:border-box}',
      '.game-event-recognition-file-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}',
      '.game-event-recognition-region{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}',
      '.game-event-recognition-region label{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:5px}',
      '.game-event-recognition-region input{min-width:0;width:100%;box-sizing:border-box}',
      '.game-event-recognition-range{display:grid;grid-template-columns:minmax(0,1fr) 58px;align-items:center;gap:7px}',
      '.game-event-recognition-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:36px;padding:0 7px;border:1px solid var(--t-list-border,rgba(255,255,255,.14));border-radius:7px;color:var(--t-text,#e8eef8)}',
      '.game-event-recognition-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;flex-wrap:wrap}',
      '.game-event-type-recognition{transition:border-color .16s ease,color .16s ease,background-color .16s ease}',
      '.game-event-type-recognition.recognition-status-idle{border-color:#e0655a!important;color:#ff8a80!important;background:rgba(224,101,90,.12)!important}',
      '.game-event-type-recognition.recognition-status-ready{border-color:#d7963b!important;color:#f0b85f!important;background:rgba(215,150,59,.12)!important}',
      '.game-event-type-recognition.recognition-status-detected{border-color:#38d477!important;color:#77efaa!important;background:rgba(56,212,119,.12)!important}',
      '.game-event-recognition-help{font-size:10px;line-height:1.35;color:var(--t-muted,#8ea0b8)}',
      '@media(max-width:2100px){.game-event-recognition-layout{grid-template-columns:minmax(0,1fr)}.game-event-recognition-settings{grid-template-columns:repeat(2,minmax(0,1fr))}.game-event-recognition-toggle,.game-event-recognition-help{grid-column:1/-1}}',
      '@media(max-width:720px){.game-event-recognition-settings{grid-template-columns:minmax(0,1fr)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildEditor(editor) {
    if (editorRoot && editorRoot.isConnected) return editorRoot;
    editorRoot = document.createElement('div');
    editorRoot.className = 'game-event-recognition-root game-control-editor-body';
    editorRoot.id = 'game-event-recognition-root';
    editorRoot.hidden = true;
    editorRoot.innerHTML = '' +
      '<div class="game-event-recognition-layout game-control-editor-primary">' +
        '<section class="game-event-recognition-preview-panel game-control-keyboard-fit ed-slot-monitor">' +
          '<div class="game-event-recognition-toolbar">' +
            '<label><span data-ge-label="monitor"></span><select id="ge-recognition-monitor"></select></label>' +
            '<button id="ge-recognition-refresh" class="game-event-recognition-live-button" type="button" aria-pressed="true"></button>' +
          '</div>' +
          '<div id="ge-recognition-stage" class="game-event-recognition-stage">' +
            '<canvas id="ge-recognition-preview"></canvas>' +
            '<div id="ge-recognition-empty" class="game-event-recognition-empty"></div>' +
          '</div>' +
          '<div id="ge-recognition-status" class="game-event-recognition-status"><strong></strong><span></span></div>' +
          '<div class="game-event-recognition-help" data-ge-label="selectionHelp"></div>' +
        '</section>' +
        '<aside class="game-event-recognition-settings game-control-settings ed-slot-settings">' +
          '<label class="game-event-recognition-field game-control-setting-field"><span data-ge-label="name"></span><input id="ge-recognition-name" type="text" maxlength="120"></label>' +
          '<div class="game-event-recognition-field game-control-setting-field"><span data-ge-label="reference"></span>' +
            '<div class="game-event-recognition-file-row"><input id="ge-recognition-reference" type="text" readonly><button id="ge-recognition-file" type="button"></button></div>' +
            '<div class="game-event-recognition-file-row"><button id="ge-recognition-capture-reference" type="button"></button><button id="ge-recognition-clear-reference" type="button">×</button></div>' +
            '<input id="ge-recognition-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden>' +
          '</div>' +
          '<div class="game-event-recognition-field game-control-setting-field"><span data-ge-label="region"></span><div class="game-event-recognition-region">' +
            '<label>X <input id="ge-recognition-x" type="number" min="0" step="1"></label>' +
            '<label>Y <input id="ge-recognition-y" type="number" min="0" step="1"></label>' +
            '<label>B <input id="ge-recognition-width" type="number" min="1" step="1"></label>' +
            '<label>H <input id="ge-recognition-height" type="number" min="1" step="1"></label>' +
          '</div></div>' +
          '<label class="game-event-recognition-field game-control-setting-field"><span data-ge-label="threshold"></span><div class="game-event-recognition-range"><input id="ge-recognition-threshold" type="range" min="50" max="100" step="0.5"><output id="ge-recognition-threshold-value"></output></div></label>' +
          '<label class="game-event-recognition-field game-control-setting-field"><span data-ge-label="stable"></span><input id="ge-recognition-stable" type="number" min="0" max="10000" step="100"></label>' +
          '<label class="game-event-recognition-field game-control-setting-field"><span data-ge-label="cooldown"></span><input id="ge-recognition-cooldown" type="number" min="0" max="600000" step="250"></label>' +
          '<label class="game-event-recognition-field game-control-setting-field"><span data-ge-label="interval"></span><input id="ge-recognition-interval" type="number" min="250" max="10000" step="250"></label>' +
          '<label class="game-event-recognition-field game-control-setting-field"><span data-ge-label="action"></span><input id="ge-recognition-action" type="text" maxlength="180" list="ge-recognition-action-list"><datalist id="ge-recognition-action-list"></datalist></label>' +
          '<label class="game-event-recognition-toggle game-control-switch-row"><span data-ge-label="lost"></span><span class="switch"><input id="ge-recognition-trigger-lost" type="checkbox"><span class="switch-track"></span></span></label>' +
          '<div class="game-event-recognition-help" data-ge-label="variables"></div>' +
        '</aside>' +
      '</div>' +
      '<div class="game-event-recognition-actions game-control-actions ed-slot-actions"><button id="ge-recognition-scan" type="button"></button><button id="ge-recognition-test" type="button" class="btn-success"></button></div>';
    editor.appendChild(editorRoot);
    bindEditorEvents();
    return editorRoot;
  }

  function applyLabels() {
    if (!editorRoot) return;
    var labels = {
      monitor: tr('Quellmonitor', 'Source monitor', 'Monitor de origen'),
      selectionHelp: tr('Im Vorschaubild ziehen, um den Erkennungsbereich festzulegen.', 'Drag in the preview to define the recognition region.', 'Arrastra en la vista previa para definir la zona de reconocimiento.'),
      name: tr('Name', 'Name', 'Nombre'),
      reference: tr('Referenzbild', 'Reference image', 'Imagen de referencia'),
      region: tr('Bildschirmbereich', 'Screen region', 'Región de pantalla'),
      threshold: tr('Trefferquote', 'Match threshold', 'Umbral de coincidencia'),
      stable: tr('Muss stabil sein (ms)', 'Must remain stable (ms)', 'Debe permanecer estable (ms)'),
      cooldown: tr('Sperrzeit nach Auslösung (ms)', 'Cooldown after trigger (ms)', 'Espera tras activar (ms)'),
      interval: tr('Prüfintervall (ms)', 'Scan interval (ms)', 'Intervalo de comprobación (ms)'),
      action: tr('Streamer.bot-Aktion', 'Streamer.bot action', 'Acción de Streamer.bot'),
      lost: tr('Auch beim Verschwinden auslösen', 'Also trigger when lost', 'Activar también al desaparecer'),
      variables: tr('Variablen: %recognitionName%, %recognitionConfidence%, %recognitionState%, %recognitionMonitor%, %recognitionTimestamp%', 'Variables: %recognitionName%, %recognitionConfidence%, %recognitionState%, %recognitionMonitor%, %recognitionTimestamp%', 'Variables: %recognitionName%, %recognitionConfidence%, %recognitionState%, %recognitionMonitor%, %recognitionTimestamp%')
    };
    Object.keys(labels).forEach(function (key) {
      var el = editorRoot.querySelector('[data-ge-label="' + key + '"]');
      if (el) el.textContent = labels[key];
    });
    updateLivePreviewButton();
    text('ge-recognition-file', tr('Datei…', 'File…', 'Archivo…'));
    text('ge-recognition-capture-reference', tr('Bereich als Referenz übernehmen', 'Use region as reference', 'Usar región como referencia'));
    text('ge-recognition-clear-reference', tr('Entfernen', 'Remove', 'Quitar'));
    text('ge-recognition-scan', tr('Jetzt prüfen', 'Scan now', 'Comprobar ahora'));
    text('ge-recognition-test', tr('Streamer.bot testen', 'Test Streamer.bot', 'Probar Streamer.bot'));
    var empty = byId('ge-recognition-empty');
    if (empty) empty.textContent = tr('„Monitorvorschau“ lädt den Bildschirm. Ziehe danach einen Rahmen um das zu erkennende Bild.', '“Monitor preview” loads the screen. Then drag a box around the image to recognize.', '«Vista del monitor» carga la pantalla. Después dibuja un marco alrededor de la imagen que se reconocerá.');
  }

  function byId(id) { return document.getElementById(id); }
  function text(id, value) { var el = byId(id); if (el) el.textContent = value; }

  function monitorFor(index) {
    index = Number(index) || 0;
    for (var i = 0; i < monitorList.length; i++) if (Number(monitorList[i].index) === index) return monitorList[i];
    return monitorList[0] || { index: 0, width: 1920, height: 1080, x: 0, y: 0, primary: true };
  }

  function populateMonitors(selected) {
    var select = byId('ge-recognition-monitor');
    if (!select) return;
    select.innerHTML = '';
    var list = monitorList.length ? monitorList : [{ index: 0, width: 1920, height: 1080, primary: true }];
    list.forEach(function (monitor) {
      var option = document.createElement('option');
      option.value = String(monitor.index);
      option.textContent = tr('Monitor ', 'Monitor ', 'Monitor ') + (Number(monitor.index) + 1) + ' · ' + monitor.width + '×' + monitor.height + (monitor.primary ? ' · ' + tr('Primär', 'Primary', 'Principal') : '');
      select.appendChild(option);
    });
    select.value = String(selected || 0);
  }

  function loadMonitors(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', monitorsUrl + '?t=' + Date.now(), true);
    xhr.timeout = 4000;
    xhr.onload = function () {
      try {
        var payload = JSON.parse(xhr.responseText || '{}');
        monitorList = Array.isArray(payload.monitors) ? payload.monitors : [];
      } catch (e) { monitorList = []; }
      if (callback) callback();
    };
    xhr.onerror = xhr.ontimeout = function () { if (callback) callback(); };
    xhr.send();
  }

  function normalizeRegion(item) {
    var r = ensureRecognition(item);
    var monitor = monitorFor(r.monitor);
    var region = r.region;
    region.x = Math.round(clamp(region.x, 0, Math.max(0, monitor.width - 1), 0));
    region.y = Math.round(clamp(region.y, 0, Math.max(0, monitor.height - 1), 0));
    region.width = Math.round(clamp(region.width, 1, Math.max(1, monitor.width - region.x), monitor.width));
    region.height = Math.round(clamp(region.height, 1, Math.max(1, monitor.height - region.y), monitor.height));
    return region;
  }

  function syncRegionInputs(item) {
    var region = normalizeRegion(item);
    byId('ge-recognition-x').value = region.x;
    byId('ge-recognition-y').value = region.y;
    byId('ge-recognition-width').value = region.width;
    byId('ge-recognition-height').value = region.height;
  }

  function syncEditor(item, editor) {
    if (!isRecognitionItem(item)) { hideEditor(); return; }
    buildEditor(editor);
    if (currentItemId && currentItemId !== item.id && previewBitmap) {
      if (previewBitmap.close) previewBitmap.close();
      previewBitmap = null;
    }
    currentItemId = item.id;
    editorRoot.hidden = false;
    applyLabels();
    var r = ensureRecognition(item);
    byId('ge-recognition-name').value = item.name || '';
    byId('ge-recognition-reference').value = r.referencePath || '';
    byId('ge-recognition-threshold').value = clamp(r.threshold, 50, 100, 95);
    text('ge-recognition-threshold-value', Number(byId('ge-recognition-threshold').value).toFixed(1).replace('.0', '') + ' %');
    byId('ge-recognition-stable').value = clamp(r.stableMs, 0, 10000, 750);
    byId('ge-recognition-cooldown').value = clamp(r.cooldownMs, 0, 600000, 3000);
    byId('ge-recognition-interval').value = clamp(r.scanIntervalMs, 250, 10000, 500);
    byId('ge-recognition-action').value = r.actionName || '';
    byId('ge-recognition-trigger-lost').checked = !!r.triggerLost;
    populateMonitors(r.monitor);
    syncRegionInputs(item);
    drawPreview(item);
    updateStatus(item);
    scheduleLivePreview(previewBitmap ? LIVE_PREVIEW_INTERVAL_MS : 0);
    if (!monitorList.length) loadMonitors(function () {
      if (currentItemId === item.id) { populateMonitors(r.monitor); syncRegionInputs(item); drawPreview(item); }
    });
  }

  function hideEditor() {
    stopLivePreview();
    currentItemId = '';
    if (editorRoot) editorRoot.hidden = true;
  }

  function decorateListItem(row, item) {
    if (!isRecognitionItem(item)) return;
    var oldStatus = row.querySelector('.game-event-recognition-list-status');
    if (oldStatus && oldStatus.parentNode) oldStatus.parentNode.removeChild(oldStatus);
    var badge = row.querySelector('.game-event-type-recognition');
    if (!badge) return;
    var rt = itemRuntime(item);
    var data = statusText(item);
    badge.classList.remove('recognition-status-idle', 'recognition-status-ready', 'recognition-status-detected');
    badge.classList.add(rt.detected ? 'recognition-status-detected' : (!item.enabled || data.kind === 'error' ? 'recognition-status-idle' : 'recognition-status-ready'));
    badge.title = data.state + (data.detail ? ' · ' + data.detail : '');
  }

  function updateListStatus(item) {
    var rt = itemRuntime(item);
    var rows = document.querySelectorAll('[data-game-event-id]');
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-game-event-id') === String(item.id)) { row = rows[i]; break; }
    }
    if (!row) return;
    var oldStatus = row.querySelector('.game-event-recognition-list-status');
    if (oldStatus && oldStatus.parentNode) oldStatus.parentNode.removeChild(oldStatus);
    var badge = row.querySelector('.game-event-type-recognition');
    if (!badge) return;
    var data = statusText(item);
    badge.classList.remove('recognition-status-idle', 'recognition-status-ready', 'recognition-status-detected');
    badge.classList.add(rt.detected ? 'recognition-status-detected' : (!item.enabled || data.kind === 'error' ? 'recognition-status-idle' : 'recognition-status-ready'));
    badge.title = data.state + (data.detail ? ' · ' + data.detail : '');
  }

  function statusText(item) {
    var r = ensureRecognition(item);
    var rt = itemRuntime(item);
    if (!item.enabled) return { state: tr('Ausgeschaltet', 'Disabled', 'Desactivado'), detail: '', kind: '' };
    if (!r.referencePath) return { state: tr('Referenz fehlt', 'Reference missing', 'Falta referencia'), detail: tr('Datei wählen oder Bereich übernehmen', 'Choose a file or capture the region', 'Elige un archivo o captura la región'), kind: 'error' };
    if (rt.error) return { state: tr('Fehler', 'Error', 'Error'), detail: rt.error, kind: 'error' };
    if (rt.detected) return { state: tr('Erkannt', 'Detected', 'Detectado'), detail: rt.confidence.toFixed(1) + ' %', kind: 'detected' };
    if (rt.state === 'matching') return { state: tr('Treffer stabilisieren', 'Stabilizing match', 'Estabilizando coincidencia'), detail: rt.confidence.toFixed(1) + ' %', kind: '' };
    if (rt.lastScan) return { state: tr('Nicht erkannt', 'Not detected', 'No detectado'), detail: rt.confidence.toFixed(1) + ' %', kind: '' };
    return { state: tr('Bereit', 'Ready', 'Listo'), detail: tr('Wartet auf Prüfung', 'Waiting for scan', 'Esperando comprobación'), kind: '' };
  }

  function updateStatus(item) {
    updateListStatus(item);
    if (!editorRoot || currentItemId !== item.id) return;
    var status = byId('ge-recognition-status');
    if (!status) return;
    var data = statusText(item);
    status.classList.toggle('is-detected', data.kind === 'detected');
    status.classList.toggle('is-error', data.kind === 'error');
    status.querySelector('strong').textContent = data.state;
    status.querySelector('span').textContent = data.detail;
  }

  function xhrBlob(body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', captureUrl, true);
      xhr.responseType = 'blob';
      xhr.timeout = 10000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (controlToken) xhr.setRequestHeader('X-Kappi-Token', controlToken);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response && xhr.response.size) resolve(xhr.response);
        else reject(new Error(tr('Bildschirmaufnahme fehlgeschlagen', 'Screen capture failed', 'Falló la captura de pantalla') + ' (HTTP ' + xhr.status + ')'));
      };
      xhr.onerror = xhr.ontimeout = function () { reject(new Error(tr('Bridge nicht erreichbar', 'Bridge unavailable', 'Bridge no disponible'))); };
      xhr.send(JSON.stringify(body));
    });
  }

  function captureRegion(item, preview) {
    var r = ensureRecognition(item);
    var monitor = monitorFor(r.monitor);
    var region = preview ? { x: 0, y: 0, width: monitor.width, height: monitor.height } : normalizeRegion(item);
    return xhrBlob({
      monitor: Number(r.monitor) || 0,
      x: region.x, y: region.y, width: region.width, height: region.height,
      maxWidth: preview ? 1000 : 128,
      maxHeight: preview ? 600 : 128
    });
  }

  function bitmapFromBlob(blob) {
    if (window.createImageBitmap) return window.createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
      image.src = url;
    });
  }

  function bitmapFromUrl(url) {
    if (referenceCache[url]) return referenceCache[url];
    referenceCache[url] = fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('reference not found'); return response.blob(); })
      .then(bitmapFromBlob)
      .catch(function (error) { delete referenceCache[url]; throw error; });
    return referenceCache[url];
  }

  function contentUrl(path) {
    path = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return bridgeOrigin + '/content/' + path.split('/').map(encodeURIComponent).join('/');
  }

  function drawPreview(item) {
    var canvas = byId('ge-recognition-preview');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var monitor = monitorFor(ensureRecognition(item).monitor);
    var stage = byId('ge-recognition-stage');
    if (stage) {
      stage.style.setProperty('--ge-monitor-aspect', monitor.width + ' / ' + monitor.height);
      stage.style.setProperty('--ge-monitor-aspect-number', String(monitor.width / monitor.height));
    }
    if (!previewBitmap) {
      ctx.clearRect(0, 0, canvas.width || 1, canvas.height || 1);
      byId('ge-recognition-empty').hidden = false;
      return;
    }
    byId('ge-recognition-empty').hidden = true;
    canvas.width = previewBitmap.width;
    canvas.height = previewBitmap.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(previewBitmap, 0, 0, canvas.width, canvas.height);
    var region = normalizeRegion(item);
    var sx = canvas.width / monitor.width;
    var sy = canvas.height / monitor.height;
    ctx.fillStyle = 'rgba(139,92,246,.18)';
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--kappi-accent-border').trim() || '#a56bff';
    ctx.lineWidth = Math.max(2, Math.min(canvas.width, canvas.height) / 300);
    ctx.fillRect(region.x * sx, region.y * sy, region.width * sx, region.height * sy);
    ctx.strokeRect(region.x * sx, region.y * sy, region.width * sx, region.height * sy);
  }

  function previewIsVisible() {
    return !!(livePreviewEnabled && editorRoot && !editorRoot.hidden && currentItemId && document.visibilityState !== 'hidden');
  }

  function updateLivePreviewButton() {
    var button = byId('ge-recognition-refresh');
    if (!button) return;
    button.classList.toggle('is-live', livePreviewEnabled);
    button.setAttribute('aria-pressed', livePreviewEnabled ? 'true' : 'false');
    button.textContent = livePreviewEnabled
      ? tr('● Live-Vorschau', '● Live preview', '● Vista en directo')
      : tr('Live-Vorschau starten', 'Start live preview', 'Iniciar vista en directo');
  }

  function stopLivePreview() {
    if (livePreviewTimer) clearTimeout(livePreviewTimer);
    livePreviewTimer = 0;
  }

  function scheduleLivePreview(delay) {
    stopLivePreview();
    updateLivePreviewButton();
    if (!previewIsVisible()) return;
    livePreviewTimer = setTimeout(livePreviewLoop, delay == null ? LIVE_PREVIEW_INTERVAL_MS : delay);
  }

  function livePreviewLoop() {
    livePreviewTimer = 0;
    if (!previewIsVisible()) return;
    refreshPreview(false).finally(function () {
      if (previewIsVisible()) scheduleLivePreview(LIVE_PREVIEW_INTERVAL_MS);
    });
  }

  function refreshPreview(showLoading) {
    var item = currentItemId ? api.find(currentItemId) : selectedItem();
    if (!item || !editorRoot || editorRoot.hidden || livePreviewBusy) return Promise.resolve(false);
    var requestedItemId = item.id;
    var requestedMonitor = Number(ensureRecognition(item).monitor) || 0;
    livePreviewBusy = true;
    var empty = byId('ge-recognition-empty');
    if (showLoading || !previewBitmap) {
      empty.hidden = false;
      empty.textContent = tr('Live-Vorschau wird geladen…', 'Loading live preview…', 'Cargando vista en directo…');
    }
    return captureRegion(item, true).then(bitmapFromBlob).then(function (bitmap) {
      if (currentItemId !== requestedItemId || !editorRoot || editorRoot.hidden || (Number(ensureRecognition(item).monitor) || 0) !== requestedMonitor) {
        if (bitmap && bitmap.close) bitmap.close();
        return false;
      }
      if (previewBitmap && previewBitmap.close) previewBitmap.close();
      previewBitmap = bitmap;
      drawPreview(item);
      itemRuntime(item).error = '';
      updateStatus(item);
      return true;
    }).catch(function (error) {
      if (currentItemId === requestedItemId) {
        if (!previewBitmap) {
          empty.hidden = false;
          empty.textContent = error.message;
        }
        var rt = itemRuntime(item); rt.error = error.message; updateStatus(item);
      }
      return false;
    }).finally(function () {
      livePreviewBusy = false;
    });
  }

  function bindRegionSelection() {
    var stage = byId('ge-recognition-stage');
    var canvas = byId('ge-recognition-preview');
    var start = null;
    function point(ev) {
      var rect = canvas.getBoundingClientRect();
      var item = selectedItem();
      var monitor = monitorFor(ensureRecognition(item).monitor);
      return {
        x: clamp((ev.clientX - rect.left) / Math.max(1, rect.width) * monitor.width, 0, monitor.width, 0),
        y: clamp((ev.clientY - rect.top) / Math.max(1, rect.height) * monitor.height, 0, monitor.height, 0)
      };
    }
    stage.addEventListener('pointerdown', function (ev) {
      if (!previewBitmap || ev.button !== 0) return;
      start = point(ev);
      try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    stage.addEventListener('pointermove', function (ev) {
      if (!start) return;
      var item = selectedItem(); if (!item) return;
      var p = point(ev); var r = ensureRecognition(item).region;
      r.x = Math.round(Math.min(start.x, p.x)); r.y = Math.round(Math.min(start.y, p.y));
      r.width = Math.max(1, Math.round(Math.abs(p.x - start.x))); r.height = Math.max(1, Math.round(Math.abs(p.y - start.y)));
      syncRegionInputs(item); drawPreview(item); ev.preventDefault();
    });
    function finish(ev) {
      if (!start) return;
      start = null;
      try { stage.releasePointerCapture(ev.pointerId); } catch (e) {}
      var item = selectedItem(); if (item) { normalizeRegion(item); api.save(); syncRegionInputs(item); drawPreview(item); }
    }
    stage.addEventListener('pointerup', finish);
    stage.addEventListener('pointercancel', finish);
  }

  function saveCurrent(mutator, redraw) {
    var item = selectedItem();
    if (!item) return;
    mutator(item, ensureRecognition(item));
    api.save();
    if (redraw) { normalizeRegion(item); syncRegionInputs(item); drawPreview(item); }
    updateStatus(item);
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('file read failed')); };
      reader.readAsDataURL(blob);
    });
  }

  function uploadReference(blob, filename, item) {
    return blobToDataUrl(blob).then(function (dataUrl) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        xhr.timeout = 15000;
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (controlToken) xhr.setRequestHeader('X-Kappi-Token', controlToken);
        xhr.onload = function () {
          try {
            var payload = JSON.parse(xhr.responseText || '{}');
            if (!payload.ok || !payload.path) throw new Error(payload.error || 'upload failed');
            resolve(payload.path);
          } catch (error) { reject(error); }
        };
        xhr.onerror = xhr.ontimeout = function () { reject(new Error(tr('Upload fehlgeschlagen', 'Upload failed', 'Falló la carga'))); };
        xhr.send(JSON.stringify({ filename: filename || 'reference.png', dataBase64: dataUrl, folder: 'recognition' }));
      });
    }).then(function (path) {
      var recognition = ensureRecognition(item);
      if (recognition.referencePath) delete referenceCache[contentUrl(recognition.referencePath)];
      recognition.referencePath = path;
      api.save();
      if (currentItemId === item.id) byId('ge-recognition-reference').value = path;
      itemRuntime(item).error = '';
      updateStatus(item);
      return path;
    });
  }

  function compareImages(sample, reference) {
    var size = 48;
    var a = document.createElement('canvas'); var b = document.createElement('canvas');
    a.width = b.width = size; a.height = b.height = size;
    var ac = a.getContext('2d', { willReadFrequently: true });
    var bc = b.getContext('2d', { willReadFrequently: true });
    ac.drawImage(sample, 0, 0, size, size); bc.drawImage(reference, 0, 0, size, size);
    var ad = ac.getImageData(0, 0, size, size).data;
    var bd = bc.getImageData(0, 0, size, size).data;
    var diff = 0; var weight = 0;
    for (var i = 0; i < ad.length; i += 4) {
      var alpha = bd[i + 3] / 255;
      if (alpha < 0.05) continue;
      diff += (Math.abs(ad[i] - bd[i]) + Math.abs(ad[i + 1] - bd[i + 1]) + Math.abs(ad[i + 2] - bd[i + 2])) * alpha;
      weight += 765 * alpha;
    }
    if (!weight) return 0;
    return clamp((1 - diff / weight) * 100, 0, 100, 0);
  }

  function sendRecognitionAction(item, state, confidence, force) {
    var recognition = ensureRecognition(item);
    var rt = itemRuntime(item);
    var now = Date.now();
    if (!force && now - rt.lastTrigger < Number(recognition.cooldownMs || 0)) return false;
    if (!recognition.actionName) {
      rt.error = tr('Streamer.bot-Aktion fehlt', 'Streamer.bot action is missing', 'Falta la acción de Streamer.bot');
      updateStatus(item); return false;
    }
    if (!api.socketReady()) {
      rt.error = tr('Streamer.bot ist nicht verbunden', 'Streamer.bot is not connected', 'Streamer.bot no está conectado');
      updateStatus(item); return false;
    }
    var monitor = monitorFor(recognition.monitor);
    var region = normalizeRegion(item);
    var timestamp = new Date().toISOString();
    var payload = {
      request: 'DoAction',
      id: 'freakshow-recognition-' + now + '-' + Math.random().toString(16).slice(2),
      action: { name: recognition.actionName },
      args: {
        recognitionName: item.name,
        recognitionConfidence: Number(Number(confidence || 0).toFixed(2)),
        recognitionConfidenceText: Number(confidence || 0).toFixed(2) + '%',
        recognitionState: state,
        recognitionMonitor: 'Monitor ' + (Number(recognition.monitor || 0) + 1),
        recognitionMonitorIndex: Number(recognition.monitor || 0),
        recognitionTimestamp: timestamp,
        recognitionReference: recognition.referencePath || '',
        recognitionId: item.id,
        recognitionRegionX: region.x,
        recognitionRegionY: region.y,
        recognitionRegionWidth: region.width,
        recognitionRegionHeight: region.height,
        recognitionMonitorWidth: monitor.width,
        recognitionMonitorHeight: monitor.height,
        rawInput: item.name + ' | ' + Number(confidence || 0).toFixed(2) + '% | ' + state
      }
    };
    if (!api.send(payload)) {
      rt.error = tr('Streamer.bot-Ereignis konnte nicht gesendet werden', 'Streamer.bot event could not be sent', 'No se pudo enviar el evento de Streamer.bot');
      updateStatus(item); return false;
    }
    rt.lastTrigger = now; rt.error = '';
    updateStatus(item);
    return true;
  }

  function evaluate(item, confidence) {
    var recognition = ensureRecognition(item);
    var rt = itemRuntime(item);
    var now = Date.now();
    var threshold = Number(recognition.threshold || 95);
    var stableMs = Number(recognition.stableMs || 0);
    rt.confidence = confidence; rt.lastScan = now; rt.error = '';
    if (confidence >= threshold) {
      rt.lostSince = 0;
      if (!rt.detected) {
        if (!rt.matchSince) rt.matchSince = now;
        rt.state = 'matching';
        if (now - rt.matchSince >= stableMs) {
          rt.detected = true; rt.state = 'detected'; rt.matchSince = 0;
          sendRecognitionAction(item, 'detected', confidence, false);
        }
      } else rt.state = 'detected';
    } else if (confidence <= threshold - 3) {
      rt.matchSince = 0;
      if (rt.detected) {
        if (!rt.lostSince) rt.lostSince = now;
        rt.state = 'losing';
        if (now - rt.lostSince >= stableMs) {
          rt.detected = false; rt.state = 'idle'; rt.lostSince = 0;
          if (recognition.triggerLost) sendRecognitionAction(item, 'lost', confidence, false);
        }
      } else rt.state = 'idle';
    }
    updateStatus(item);
  }

  function scanItem(item) {
    if (!isRecognitionItem(item)) return Promise.resolve(false);
    var recognition = ensureRecognition(item);
    var rt = itemRuntime(item);
    if (!item.enabled || !recognition.referencePath) return Promise.resolve(false);
    var now = Date.now();
    if (now - rt.lastScan < Number(recognition.scanIntervalMs || 500)) return Promise.resolve(false);
    var referenceUrl = contentUrl(recognition.referencePath);
    return Promise.all([captureRegion(item, false).then(bitmapFromBlob), bitmapFromUrl(referenceUrl)])
      .then(function (images) {
        var confidence = compareImages(images[0], images[1]);
        if (images[0] && images[0].close) images[0].close();
        evaluate(item, confidence);
        return true;
      }).catch(function (error) {
        rt.error = error && error.message ? error.message : String(error);
        rt.lastScan = Date.now();
        updateStatus(item);
        return false;
      });
  }

  function scheduleScan(delay) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanLoop, delay == null ? 250 : delay);
  }

  function scanLoop() {
    if (scanBusy) { scheduleScan(250); return; }
    var state = api.state();
    var items = state && Array.isArray(state.items) ? state.items.filter(function (item) {
      if (!isRecognitionItem(item)) return false;
      var r = ensureRecognition(item);
      return !!(item.enabled && r.referencePath);
    }) : [];
    if (!items.length) { scheduleScan(750); return; }
    if (scanCursor >= items.length) scanCursor = 0;
    var item = items[scanCursor++];
    scanBusy = true;
    scanItem(item).finally(function () { scanBusy = false; scheduleScan(125); });
  }

  function requestActions() {
    if (!api.socketReady()) return;
    api.send({ request: 'GetActions', id: 'freakshow-recognition-actions-' + Date.now() });
  }

  function bindEditorEvents() {
    bindRegionSelection();
    byId('ge-recognition-refresh').onclick = function () {
      livePreviewEnabled = !livePreviewEnabled;
      updateLivePreviewButton();
      if (livePreviewEnabled) scheduleLivePreview(0);
      else stopLivePreview();
    };
    byId('ge-recognition-monitor').onchange = function () {
      saveCurrent(function (item, r) {
        r.monitor = Number(byId('ge-recognition-monitor').value) || 0;
        var monitor = monitorFor(r.monitor);
        r.region = { x: 0, y: 0, width: monitor.width, height: monitor.height };
        if (previewBitmap && previewBitmap.close) previewBitmap.close();
        previewBitmap = null;
      }, true);
      if (livePreviewEnabled) scheduleLivePreview(0);
    };
    byId('ge-recognition-name').onchange = function () {
      saveCurrent(function (item) { item.name = String(byId('ge-recognition-name').value || '').trim() || item.name; });
      api.render();
    };
    ['x', 'y', 'width', 'height'].forEach(function (key) {
      byId('ge-recognition-' + key).onchange = function () {
        saveCurrent(function (item, r) { r.region[key] = Number(byId('ge-recognition-' + key).value); }, true);
      };
    });
    byId('ge-recognition-threshold').oninput = function () {
      text('ge-recognition-threshold-value', Number(this.value).toFixed(1).replace('.0', '') + ' %');
      saveCurrent(function (item, r) { r.threshold = Number(byId('ge-recognition-threshold').value); });
    };
    byId('ge-recognition-stable').onchange = function () { saveCurrent(function (item, r) { r.stableMs = clamp(byId('ge-recognition-stable').value, 0, 10000, 750); }); };
    byId('ge-recognition-cooldown').onchange = function () { saveCurrent(function (item, r) { r.cooldownMs = clamp(byId('ge-recognition-cooldown').value, 0, 600000, 3000); }); };
    byId('ge-recognition-interval').onchange = function () { saveCurrent(function (item, r) { r.scanIntervalMs = clamp(byId('ge-recognition-interval').value, 250, 10000, 500); }); };
    byId('ge-recognition-action').onchange = function () { saveCurrent(function (item, r) { r.actionName = String(byId('ge-recognition-action').value || '').trim(); }); };
    byId('ge-recognition-action').onfocus = requestActions;
    byId('ge-recognition-trigger-lost').onchange = function () { saveCurrent(function (item, r) { r.triggerLost = !!byId('ge-recognition-trigger-lost').checked; }); };
    byId('ge-recognition-file').onclick = function () { byId('ge-recognition-file-input').click(); };
    byId('ge-recognition-file-input').onchange = function () {
      var item = selectedItem(); var file = this.files && this.files[0]; this.value = '';
      if (!item || !file) return;
      uploadReference(file, file.name, item).catch(function (error) { var rt = itemRuntime(item); rt.error = error.message; updateStatus(item); });
    };
    byId('ge-recognition-capture-reference').onclick = function () {
      var item = selectedItem(); if (!item) return;
      captureRegion(item, false).then(function (blob) {
        return uploadReference(blob, (item.name || 'reference').replace(/[^A-Za-z0-9_-]/g, '_') + '.png', item);
      }).catch(function (error) { var rt = itemRuntime(item); rt.error = error.message; updateStatus(item); });
    };
    byId('ge-recognition-clear-reference').onclick = function () {
      saveCurrent(function (item, r) { if (r.referencePath) delete referenceCache[contentUrl(r.referencePath)]; r.referencePath = ''; itemRuntime(item).detected = false; });
      byId('ge-recognition-reference').value = '';
    };
    byId('ge-recognition-scan').onclick = function () {
      var item = selectedItem(); if (!item) return;
      itemRuntime(item).lastScan = 0;
      scanItem(item);
    };
    byId('ge-recognition-test').onclick = function () {
      var item = selectedItem(); if (!item) return;
      sendRecognitionAction(item, 'detected', itemRuntime(item).confidence || 100, true);
    };
  }

  function init() {
    injectStyles();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') stopLivePreview();
      else if (previewIsVisible()) scheduleLivePreview(0);
    });
    window.addEventListener('beforeunload', function () {
      stopLivePreview();
      if (previewBitmap && previewBitmap.close) previewBitmap.close();
      previewBitmap = null;
    });
    loadMonitors(function () { api.render(); });
    api.render();
    scheduleScan(500);
  }

  window.FreakShowRecognition = {
    syncEditor: syncEditor,
    hideEditor: hideEditor,
    decorateListItem: decorateListItem,
    scanItem: scanItem,
    compareImages: compareImages,
    sendRecognitionAction: sendRecognitionAction,
    init: init
  };

  init();
})();
