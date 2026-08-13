(function () {
  'use strict';

  var api = window.FreakShowGameEventApi;
  if (!api) return;

  var bridgeOrigin = String(window.BRIDGE_ORIGIN || window.location.origin || '').replace(/\/+$/, '');
  var controlToken = String(window.BRIDGE_CONTROL_TOKEN || '');
  var processesUrl = bridgeOrigin + '/game-control/processes';
  var editorRoot = null;
  var currentItemId = '';
  var processCache = [];
  var runtime = Object.create(null);
  var pollTimer = 0;
  var pollBusy = false;
  var PROCESS_POLL_INTERVAL_MS = 1000;

  function tr(de, en, es) {
    return api.text ? api.text(de, en, es) : de;
  }

  function byId(id) { return document.getElementById(id); }
  function text(id, value) { var el = byId(id); if (el) el.textContent = value; }

  function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
  }

  function isProcessItem(item) {
    return !!(item && item.eventType === 'process');
  }

  function cleanProcessName(value) {
    var name = String(value || '').trim().replace(/^['"]|['"]$/g, '');
    var parts = name.split(/[\\/]/);
    name = parts[parts.length - 1].trim();
    name = name.replace(/\.exe$/i, '').trim();
    if (!name || name.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,119}$/.test(name)) return '';
    return name;
  }

  function ensureConfig(item) {
    var changed = false;
    if (!item.processEvent || typeof item.processEvent !== 'object') {
      item.processEvent = {};
      changed = true;
    }
    var cfg = item.processEvent;
    var defaults = {
      processName: '',
      actionName: 'FreakShow - Process Event',
      platform: 'twitch',
      twitchCategory: '',
      youtubeCategory: '',
      triggerStopped: false,
      cooldownMs: 3000
    };
    Object.keys(defaults).forEach(function (key) {
      if (cfg[key] === undefined || cfg[key] === null) { cfg[key] = defaults[key]; changed = true; }
    });
    cfg.processName = cleanProcessName(cfg.processName);
    if (cfg.platform !== 'youtube' && cfg.platform !== 'both') cfg.platform = 'twitch';
    if (changed) api.save();
    return cfg;
  }

  function itemRuntime(item) {
    if (!runtime[item.id]) runtime[item.id] = {
      initialized: false,
      running: false,
      instances: 0,
      title: '',
      lastTrigger: 0,
      lastState: '',
      lastTimestamp: '',
      error: '',
      errorKind: ''
    };
    return runtime[item.id];
  }

  function resetRuntime(item) {
    if (!item) return;
    runtime[item.id] = {
      initialized: false,
      running: false,
      instances: 0,
      title: '',
      lastTrigger: 0,
      lastState: '',
      lastTimestamp: '',
      error: '',
      errorKind: ''
    };
  }

  function injectStyles() {
    if (document.getElementById('game-event-process-style')) return;
    var style = document.createElement('style');
    style.id = 'game-event-process-style';
    style.textContent = [
      '.game-event-process-root{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:12px}',
      '.game-event-process-root[hidden]{display:none!important}',
      '.game-event-process-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--ed-settings-w,minmax(300px,420px));align-items:start;gap:var(--ed-gap,16px);width:100%;min-width:0}',
      '.game-event-process-overview{display:flex;align-items:stretch;justify-content:center;width:min(100%,calc((100vh - 240px) * var(--gep-monitor-aspect-number,1.777777)));max-width:var(--ed-monitor-max,1100px);min-width:0;aspect-ratio:var(--gep-monitor-aspect,16 / 9);justify-self:center;margin:0 auto}',
      '.game-event-process-card{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;min-height:0;padding:28px;border:1px solid var(--kappi-accent-border,#8b5cf6);border-radius:var(--ed-monitor-radius,7px);box-sizing:border-box;background-color:#090d14;background-image:radial-gradient(circle at center,rgba(139,92,246,.12),transparent 48%),linear-gradient(rgba(139,92,246,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,.1) 1px,transparent 1px);background-size:auto,32px 32px,32px 32px;text-align:center}',
      '.game-event-process-card.is-running{border-color:#38d477;box-shadow:0 0 18px rgba(56,212,119,.14)}',
      '.game-event-process-icon{display:grid;place-items:center;width:64px;height:64px;margin-bottom:12px;border:1px solid var(--kappi-accent-border,#8b5cf6);border-radius:50%;color:var(--kappi-accent-border,#a56bff);font-size:28px}',
      '.game-event-process-card.is-running .game-event-process-icon{border-color:#38d477;color:#77efaa}',
      '.game-event-process-card h3{max-width:100%;margin:0 0 5px;color:var(--t-text,#e8eef8);font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.game-event-process-exe{color:var(--t-muted,#aebbd0);font-size:12px}',
      '.game-event-process-state{margin-top:12px;padding:4px 9px;border:1px solid var(--t-list-border,rgba(255,255,255,.14));border-radius:999px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-process-card.is-running .game-event-process-state{border-color:#38d477;color:#77efaa}',
      '.game-event-process-detail{min-height:18px;margin-top:10px;color:var(--t-muted,#8ea0b8);font-size:11px}',
      '.game-event-process-settings{display:grid;align-content:start;gap:10px;min-width:0;padding-top:2px;box-sizing:border-box}',
      '.game-event-process-field{display:grid;gap:4px;color:var(--t-muted,#aebbd0);font-size:11px}',
      '.game-event-process-field>input,.game-event-process-field>select{width:100%;box-sizing:border-box}',
      // Eingabefeld auf eigener Zeile, darunter Aktualisieren und Durchsuchen zu gleichen Teilen.
      '.game-event-process-input-row{display:flex;flex-wrap:wrap;gap:6px}',
      '.game-event-process-input-row>input{flex:1 1 100%;min-width:0}',
      '.game-event-process-input-row>button{flex:1 1 0;min-width:0;white-space:nowrap}',
      '.game-event-process-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:36px;padding:0 7px;border:1px solid var(--t-list-border,rgba(255,255,255,.14));border-radius:7px;color:var(--t-text,#e8eef8)}',
      '.game-event-process-help{font-size:10px;line-height:1.4;color:var(--t-muted,#8ea0b8)}',
      '.game-event-process-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;flex-wrap:wrap}',
      '.game-event-type-process{transition:border-color .16s ease,color .16s ease,background-color .16s ease}',
      '.game-event-type-process.process-status-idle{border-color:#e0655a!important;color:#ff8a80!important;background:rgba(224,101,90,.12)!important}',
      '.game-event-type-process.process-status-checking{border-color:#d7963b!important;color:#f0b85f!important;background:rgba(215,150,59,.12)!important}',
      '.game-event-type-process.process-status-running{border-color:#38d477!important;color:#77efaa!important;background:rgba(56,212,119,.12)!important}',
      '.game-event-type-recognition{border-color:var(--kappi-accent-border,#8b5cf6)!important}',
      '@media(max-width:2100px){.game-event-process-layout{grid-template-columns:minmax(0,1fr)}.game-event-process-settings{grid-template-columns:repeat(2,minmax(0,1fr))}.game-event-process-toggle,.game-event-process-help{grid-column:1/-1}}',
      '@media(max-width:720px){.game-event-process-settings{grid-template-columns:minmax(0,1fr)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildEditor(editor) {
    if (editorRoot && editorRoot.isConnected) return editorRoot;
    editorRoot = document.createElement('div');
    editorRoot.id = 'game-event-process-root';
    editorRoot.className = 'game-event-process-root game-control-editor-body';
    editorRoot.hidden = true;
    editorRoot.innerHTML = '' +
      '<div class="game-event-process-layout game-control-editor-primary">' +
        '<section id="ge-process-overview" class="game-event-process-overview game-control-keyboard-fit ed-slot-monitor">' +
          '<div id="ge-process-card" class="game-event-process-card">' +
            '<div id="ge-process-icon" class="game-event-process-icon">▶</div>' +
            '<h3 id="ge-process-card-name"></h3>' +
            '<div id="ge-process-card-exe" class="game-event-process-exe"></div>' +
            '<div id="ge-process-card-state" class="game-event-process-state"></div>' +
            '<div id="ge-process-card-detail" class="game-event-process-detail"></div>' +
          '</div>' +
        '</section>' +
        '<aside class="game-event-process-settings game-control-settings ed-slot-settings">' +
          '<label class="game-event-process-field game-control-setting-field"><span data-gep-label="name"></span><input id="ge-process-name" type="text" maxlength="120"></label>' +
          '<div class="game-event-process-field game-control-setting-field"><span data-gep-label="process"></span><div class="game-event-process-input-row"><input id="ge-process-executable" type="text" maxlength="124" list="ge-process-list" placeholder="game.exe"><button id="ge-process-refresh" type="button"></button><button id="ge-process-browse" type="button"></button></div><datalist id="ge-process-list"></datalist><input id="ge-process-file" type="file" accept=".exe" hidden></div>' +
          '<label class="game-event-process-field game-control-setting-field"><span data-gep-label="platform"></span><select id="ge-process-platform"><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="both">Twitch + YouTube</option></select></label>' +
          '<label id="ge-process-twitch-field" class="game-event-process-field game-control-setting-field"><span data-gep-label="twitchCategory"></span><input id="ge-process-twitch-category" type="text" maxlength="180"></label>' +
          '<label id="ge-process-youtube-field" class="game-event-process-field game-control-setting-field"><span data-gep-label="youtubeCategory"></span><input id="ge-process-youtube-category" type="text" maxlength="180"></label>' +
          '<label class="game-event-process-field game-control-setting-field"><span data-gep-label="action"></span><input id="ge-process-action" type="text" maxlength="180"></label>' +
          '<label class="game-event-process-field game-control-setting-field"><span data-gep-label="cooldown"></span><input id="ge-process-cooldown" type="number" min="0" max="600000" step="250"></label>' +
          '<label class="game-event-process-toggle game-control-switch-row"><span data-gep-label="stopped"></span><span class="switch"><input id="ge-process-trigger-stopped" type="checkbox"><span class="switch-track"></span></span></label>' +
          '<div class="game-event-process-help" data-gep-label="explanation"></div>' +
          '<div class="game-event-process-help" data-gep-label="variables"></div>' +
        '</aside>' +
      '</div>' +
      '<div class="game-event-process-actions game-control-actions ed-slot-actions"><button id="ge-process-scan" type="button"></button><button id="ge-process-import" type="button" class="btn-primary"></button><button id="ge-process-test" type="button" class="btn-success"></button></div>';
    editor.appendChild(editorRoot);
    bindEditorEvents();
    return editorRoot;
  }

  function applyLabels() {
    if (!editorRoot) return;
    var labels = {
      name: tr('Name', 'Name', 'Nombre'),
      process: tr('Programm / EXE', 'Program / EXE', 'Programa / EXE'),
      platform: tr('Zielplattform', 'Target platform', 'Plataforma de destino'),
      twitchCategory: tr('Twitch-Kategorie / Spiel', 'Twitch category / game', 'Categoría / juego de Twitch'),
      youtubeCategory: tr('YouTube-Kategorie / Spiel', 'YouTube category / game', 'Categoría / juego de YouTube'),
      action: tr('Streamer.bot-Aktion', 'Streamer.bot action', 'Acción de Streamer.bot'),
      cooldown: tr('Sperrzeit nach Auslösung (ms)', 'Cooldown after trigger (ms)', 'Espera tras activar (ms)'),
      stopped: tr('Auch beim Beenden auslösen', 'Also trigger when stopped', 'Activar también al cerrar'),
      explanation: tr('Die Aktion wird einmal beim Übergang von „nicht gestartet“ zu „läuft“ ausgelöst. Bereits laufende Programme lösen beim Start von FreakShow nicht rückwirkend aus.', 'The action fires once when the program changes from “not running” to “running”. Programs already running when FreakShow starts do not trigger retroactively.', 'La acción se activa una vez cuando el programa pasa de «no iniciado» a «en ejecución». Los programas ya abiertos al iniciar FreakShow no se activan de forma retroactiva.'),
      variables: tr('Variablen: %processEventName%, %processExecutable%, %processState%, %processPlatform%, %processCategory%, %processTwitchCategory%, %processYouTubeCategory%, %processTimestamp%', 'Variables: %processEventName%, %processExecutable%, %processState%, %processPlatform%, %processCategory%, %processTwitchCategory%, %processYouTubeCategory%, %processTimestamp%', 'Variables: %processEventName%, %processExecutable%, %processState%, %processPlatform%, %processCategory%, %processTwitchCategory%, %processYouTubeCategory%, %processTimestamp%')
    };
    Object.keys(labels).forEach(function (key) {
      var el = editorRoot.querySelector('[data-gep-label="' + key + '"]');
      if (el) el.textContent = labels[key];
    });
    text('ge-process-refresh', tr('Aktualisieren', 'Refresh', 'Actualizar'));
    text('ge-process-browse', tr('Durchsuchen …', 'Browse …', 'Examinar …'));
    var browse = byId('ge-process-browse');
    if (browse) browse.title = tr(
      'EXE im Explorer aussuchen. Übernommen wird nur der Dateiname – das Programm muss nicht laufen.',
      'Pick an EXE in Explorer. Only the file name is used – the program does not need to be running.',
      'Elegir un EXE en el Explorador. Solo se usa el nombre del archivo: el programa no tiene que estar en ejecución.');
    text('ge-process-scan', tr('Jetzt prüfen', 'Check now', 'Comprobar ahora'));
    text('ge-process-import', tr('Importcode kopieren', 'Copy import code', 'Copiar código de importación'));
    text('ge-process-test', tr('Streamer.bot testen', 'Test Streamer.bot', 'Probar Streamer.bot'));
  }

  function fallbackCopy(textValue) {
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = String(textValue || '');
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-10000px';
      area.style.top = '0';
      document.body.appendChild(area);
      area.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (error) {}
      document.body.removeChild(area);
      if (copied) resolve();
      else reject(new Error('copy failed'));
    });
  }

  function copyTextValue(textValue) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(String(textValue || '')).catch(function () {
        return fallbackCopy(textValue);
      });
    }
    return fallbackCopy(textValue);
  }

  function setImportButtonState(label, disabled) {
    var button = byId('ge-process-import');
    if (!button) return;
    button.textContent = label;
    button.disabled = !!disabled;
  }

  function restoreImportButtonSoon() {
    setTimeout(function () {
      setImportButtonState(tr('Importcode kopieren', 'Copy import code', 'Copiar código de importación'), false);
    }, 1800);
  }

  function copyProcessEventImportCode() {
    setImportButtonState(tr('Wird kopiert …', 'Copying …', 'Copiando …'), true);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', bridgeOrigin + '/game-event-import-code?t=' + Date.now(), true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300 || !String(xhr.responseText || '').trim()) {
        setImportButtonState(tr('Import nicht verfügbar', 'Import unavailable', 'Importación no disponible'), false);
        restoreImportButtonSoon();
        return;
      }
      copyTextValue(String(xhr.responseText || '').trim()).then(function () {
        setImportButtonState(tr('Importcode kopiert ✓', 'Import code copied ✓', 'Código copiado ✓'), false);
        restoreImportButtonSoon();
      }).catch(function () {
        setImportButtonState(tr('Kopieren fehlgeschlagen', 'Copy failed', 'Error al copiar'), false);
        restoreImportButtonSoon();
      });
    };
    xhr.onerror = function () {
      setImportButtonState(tr('Import nicht verfügbar', 'Import unavailable', 'Importación no disponible'), false);
      restoreImportButtonSoon();
    };
    xhr.send();
  }

  function findProcessEntry(processName) {
    var wanted = cleanProcessName(processName).toLowerCase();
    for (var i = 0; i < processCache.length; i++) {
      if (cleanProcessName(processCache[i].name).toLowerCase() === wanted) return processCache[i];
    }
    return null;
  }

  var processListSignature = '';

  function populateProcessList() {
    var list = byId('ge-process-list');
    if (!list) return;
    var entries = [];
    for (var i = 0; i < processCache.length; i++) {
      var name = cleanProcessName(processCache[i].name);
      if (!name) continue;
      entries.push({ value: name + '.exe', label: processCache[i].title || name });
    }
    var signature = entries.map(function (e) { return e.value + '' + e.label; }).join('');
    // Unveraendert? Dann NICHT neu aufbauen. Das Leeren der datalist schliesst die
    // offene Vorschlagsliste des Browsers - genau das Verschwinden waehrend des
    // Aussuchens, weil die Prozessliste im Hintergrund weiterlaeuft.
    if (signature === processListSignature && list.children.length) return;
    // Auch bei echter Aenderung nicht anfassen, solange das Feld den Fokus hat -
    // die Liste ist dann sichtbar und wuerde unter dem Mauszeiger zuklappen.
    var input = byId('ge-process-executable');
    if (input && document.activeElement === input && list.children.length) return;
    processListSignature = signature;
    list.innerHTML = '';
    for (var j = 0; j < entries.length; j++) {
      var option = document.createElement('option');
      option.value = entries[j].value;
      option.label = entries[j].label;
      list.appendChild(option);
    }
  }

  function syncPlatformFields(cfg) {
    var twitch = byId('ge-process-twitch-field');
    var youtube = byId('ge-process-youtube-field');
    if (twitch) twitch.hidden = cfg.platform === 'youtube';
    if (youtube) youtube.hidden = cfg.platform === 'twitch';
  }

  function statusData(item) {
    var cfg = ensureConfig(item);
    var rt = itemRuntime(item);
    if (!item.enabled) return { state: tr('Ausgeschaltet', 'Disabled', 'Desactivado'), detail: '', kind: '' };
    if (!cfg.processName) return { state: tr('Programm fehlt', 'Program missing', 'Falta el programa'), detail: tr('EXE auswählen oder eintragen', 'Select or enter an EXE', 'Selecciona o introduce un EXE'), kind: 'error' };
    if (rt.error) return { state: tr('Fehler', 'Error', 'Error'), detail: rt.error, kind: 'error' };
    if (!rt.initialized) return { state: tr('Wird geprüft', 'Checking', 'Comprobando'), detail: cfg.processName + '.exe', kind: '' };
    if (rt.running) return { state: tr('Programm läuft', 'Program running', 'Programa en ejecución'), detail: rt.title || (rt.instances + '× ' + cfg.processName + '.exe'), kind: 'running' };
    return { state: tr('Nicht gestartet', 'Not running', 'No iniciado'), detail: cfg.processName + '.exe', kind: '' };
  }

  function updateOverview(item) {
    if (!editorRoot || currentItemId !== item.id) return;
    var cfg = ensureConfig(item);
    var data = statusData(item);
    var card = byId('ge-process-card');
    card.classList.toggle('is-running', data.kind === 'running');
    text('ge-process-icon', data.kind === 'running' ? '●' : '▶');
    text('ge-process-card-name', item.name || tr('Programm-Event', 'Program event', 'Evento de programa'));
    text('ge-process-card-exe', cfg.processName ? cfg.processName + '.exe' : tr('Keine EXE ausgewählt', 'No EXE selected', 'Ningún EXE seleccionado'));
    text('ge-process-card-state', data.state);
    text('ge-process-card-detail', data.detail);
  }

  function updateListStatus(item) {
    var rows = document.querySelectorAll('[data-game-event-id]');
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-game-event-id') === String(item.id)) { row = rows[i]; break; }
    }
    if (!row) return;
    var oldStatus = row.querySelector('.game-event-process-list-status');
    if (oldStatus && oldStatus.parentNode) oldStatus.parentNode.removeChild(oldStatus);
    var badge = row.querySelector('.game-event-type-process');
    if (!badge) return;
    var data = statusData(item);
    badge.classList.remove('process-status-idle', 'process-status-checking', 'process-status-running');
    badge.classList.add(data.kind === 'running' ? 'process-status-running' : (!item.enabled || data.kind === 'error' || !ensureConfig(item).processName ? 'process-status-idle' : 'process-status-checking'));
    badge.title = data.state + (data.detail ? ' · ' + data.detail : '');
  }

  function updateStatus(item) {
    updateListStatus(item);
    updateOverview(item);
  }

  function decorateListItem(row, item) {
    if (!isProcessItem(item)) return;
    var oldStatus = row.querySelector('.game-event-process-list-status');
    if (oldStatus && oldStatus.parentNode) oldStatus.parentNode.removeChild(oldStatus);
    var badge = row.querySelector('.game-event-type-process');
    if (!badge) return;
    var data = statusData(item);
    badge.classList.remove('process-status-idle', 'process-status-checking', 'process-status-running');
    badge.classList.add(data.kind === 'running' ? 'process-status-running' : (!item.enabled || data.kind === 'error' || !ensureConfig(item).processName ? 'process-status-idle' : 'process-status-checking'));
    badge.title = data.state + (data.detail ? ' · ' + data.detail : '');
  }

  function selectedItem() {
    return api.find(api.selectedId());
  }

  function applyProcessGeometry() {
    var overview = byId('ge-process-overview');
    if (!overview) return;
    var widthInput = byId('cfg-monitor-width');
    var heightInput = byId('cfg-monitor-height');
    var width = Math.max(1, Number(widthInput && widthInput.value) || 1920);
    var height = Math.max(1, Number(heightInput && heightInput.value) || 1080);
    overview.style.setProperty('--gep-monitor-aspect', width + ' / ' + height);
    overview.style.setProperty('--gep-monitor-aspect-number', String(width / height));
  }

  function saveCurrent(mutator, resetDetection) {
    var item = selectedItem();
    if (!isProcessItem(item)) return;
    mutator(item, ensureConfig(item));
    if (resetDetection) resetRuntime(item);
    api.save();
    syncPlatformFields(ensureConfig(item));
    updateStatus(item);
  }

  function syncEditor(item, editor) {
    if (!isProcessItem(item)) { hideEditor(); return; }
    buildEditor(editor);
    currentItemId = item.id;
    editorRoot.hidden = false;
    applyLabels();
    var cfg = ensureConfig(item);
    byId('ge-process-name').value = item.name || '';
    byId('ge-process-executable').value = cfg.processName ? cfg.processName + '.exe' : '';
    byId('ge-process-platform').value = cfg.platform;
    byId('ge-process-twitch-category').value = cfg.twitchCategory || '';
    byId('ge-process-youtube-category').value = cfg.youtubeCategory || '';
    byId('ge-process-action').value = cfg.actionName || '';
    byId('ge-process-cooldown').value = clamp(cfg.cooldownMs, 0, 600000, 3000);
    byId('ge-process-trigger-stopped').checked = !!cfg.triggerStopped;
    populateProcessList();
    syncPlatformFields(cfg);
    applyProcessGeometry();
    updateStatus(item);
    if (!processCache.length) loadProcesses(true);
  }

  function hideEditor() {
    currentItemId = '';
    if (editorRoot) editorRoot.hidden = true;
  }

  function sendProcessAction(item, state, force) {
    var cfg = ensureConfig(item);
    var rt = itemRuntime(item);
    var now = Date.now();
    if (!force && rt.lastState === state && now - rt.lastTrigger < Number(cfg.cooldownMs || 0)) return false;
    if (!cfg.actionName) {
      rt.error = tr('Streamer.bot-Aktion fehlt', 'Streamer.bot action is missing', 'Falta la acción de Streamer.bot');
      rt.errorKind = 'action';
      updateStatus(item);
      return false;
    }
    if (!api.socketReady()) {
      rt.error = tr('Streamer.bot ist nicht verbunden', 'Streamer.bot is not connected', 'Streamer.bot no está conectado');
      rt.errorKind = 'action';
      updateStatus(item);
      return false;
    }
    var timestamp = new Date().toISOString();
    var platform = cfg.platform === 'both' ? 'twitch+youtube' : cfg.platform;
    var category = cfg.platform === 'youtube'
      ? cfg.youtubeCategory
      : (cfg.platform === 'both' ? [cfg.twitchCategory, cfg.youtubeCategory].filter(Boolean).join(' | ') : cfg.twitchCategory);
    var payload = {
      request: 'DoAction',
      id: 'freakshow-process-event-' + now + '-' + Math.random().toString(16).slice(2),
      action: { name: cfg.actionName },
      args: {
        processEventName: item.name,
        processName: cfg.processName,
        processExecutable: cfg.processName + '.exe',
        processState: state,
        processRunning: state === 'started',
        processInstances: Number(rt.instances || 0),
        processWindowTitle: rt.title || '',
        processPlatform: platform,
        processCategory: category || '',
        processTwitchCategory: cfg.twitchCategory || '',
        processYouTubeCategory: cfg.youtubeCategory || '',
        processTimestamp: timestamp,
        rawInput: cfg.processName + '.exe | ' + state + ' | ' + platform + ' | ' + (category || '')
      }
    };
    if (!api.send(payload)) {
      rt.error = tr('Streamer.bot-Ereignis konnte nicht gesendet werden', 'Streamer.bot event could not be sent', 'No se pudo enviar el evento de Streamer.bot');
      rt.errorKind = 'action';
      updateStatus(item);
      return false;
    }
    rt.lastTrigger = now;
    rt.lastState = state;
    rt.lastTimestamp = timestamp;
    rt.error = '';
    rt.errorKind = '';
    updateStatus(item);
    return true;
  }

  function evaluateItems() {
    var state = api.state();
    var items = state && Array.isArray(state.items) ? state.items : [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!isProcessItem(item)) continue;
      var cfg = ensureConfig(item);
      var rt = itemRuntime(item);
      if (rt.errorKind === 'poll') { rt.error = ''; rt.errorKind = ''; }
      if (!item.enabled || !cfg.processName) {
        rt.initialized = false;
        rt.running = false;
        rt.instances = 0;
        rt.title = '';
        updateStatus(item);
        continue;
      }
      var entry = findProcessEntry(cfg.processName);
      var runningNow = !!entry;
      var instances = entry ? Number(entry.instances || 1) : 0;
      var title = entry ? String(entry.title || '') : '';
      if (!rt.initialized) {
        rt.initialized = true;
        rt.running = runningNow;
      } else if (!rt.running && runningNow) {
        rt.running = true;
        rt.instances = instances;
        rt.title = title;
        sendProcessAction(item, 'started', false);
      } else if (rt.running && !runningNow) {
        rt.running = false;
        rt.instances = 0;
        rt.title = '';
        if (cfg.triggerStopped) sendProcessAction(item, 'stopped', false);
      }
      rt.running = runningNow;
      rt.instances = instances;
      rt.title = title;
      updateStatus(item);
    }
  }

  function requestProcesses() {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', processesUrl + '?t=' + Date.now(), true);
      xhr.timeout = 5000;
      if (controlToken) xhr.setRequestHeader('X-Kappi-Token', controlToken);
      xhr.onload = function () {
        try {
          var payload = JSON.parse(xhr.responseText || '{}');
          if (xhr.status < 200 || xhr.status >= 300 || !payload.ok || !Array.isArray(payload.processes)) throw new Error(payload.error || ('HTTP ' + xhr.status));
          resolve(payload.processes);
        } catch (error) { reject(error); }
      };
      xhr.onerror = xhr.ontimeout = function () { reject(new Error(tr('Bridge nicht erreichbar', 'Bridge unavailable', 'Bridge no disponible'))); };
      xhr.send();
    });
  }

  function loadProcesses(manual) {
    if (pollBusy) return Promise.resolve(false);
    pollBusy = true;
    return requestProcesses().then(function (processes) {
      processCache = processes;
      populateProcessList();
      evaluateItems();
      return true;
    }).catch(function (error) {
      var item = currentItemId ? api.find(currentItemId) : null;
      if (isProcessItem(item)) {
        itemRuntime(item).error = error && error.message ? error.message : String(error);
        itemRuntime(item).errorKind = 'poll';
        updateStatus(item);
      }
      return false;
    }).finally(function () {
      pollBusy = false;
      if (manual) schedulePoll(PROCESS_POLL_INTERVAL_MS);
    });
  }

  function schedulePoll(delay) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollLoop, delay == null ? PROCESS_POLL_INTERVAL_MS : delay);
  }

  function pollLoop() {
    pollTimer = 0;
    loadProcesses(false).finally(function () { schedulePoll(PROCESS_POLL_INTERVAL_MS); });
  }

  function bindEditorEvents() {
    byId('ge-process-name').onchange = function () {
      saveCurrent(function (item) { item.name = String(byId('ge-process-name').value || '').trim() || item.name; });
      api.render();
    };
    byId('ge-process-executable').onchange = function () {
      saveCurrent(function (item, cfg) {
        cfg.processName = cleanProcessName(byId('ge-process-executable').value);
        byId('ge-process-executable').value = cfg.processName ? cfg.processName + '.exe' : '';
      }, true);
    };
    byId('ge-process-platform').onchange = function () { saveCurrent(function (item, cfg) { cfg.platform = byId('ge-process-platform').value; }); };
    byId('ge-process-twitch-category').onchange = function () { saveCurrent(function (item, cfg) { cfg.twitchCategory = String(byId('ge-process-twitch-category').value || '').trim(); }); };
    byId('ge-process-youtube-category').onchange = function () { saveCurrent(function (item, cfg) { cfg.youtubeCategory = String(byId('ge-process-youtube-category').value || '').trim(); }); };
    byId('ge-process-action').onchange = function () { saveCurrent(function (item, cfg) { cfg.actionName = String(byId('ge-process-action').value || '').trim(); }); };
    byId('ge-process-cooldown').onchange = function () { saveCurrent(function (item, cfg) { cfg.cooldownMs = clamp(byId('ge-process-cooldown').value, 0, 600000, 3000); }); };
    byId('ge-process-trigger-stopped').onchange = function () { saveCurrent(function (item, cfg) { cfg.triggerStopped = !!byId('ge-process-trigger-stopped').checked; }); };
    byId('ge-process-refresh').onclick = function () { loadProcesses(true); };
    // Explorer-Auswahl: das Programm muss dafuer NICHT laufen. Der Browser gibt aus
    // Sicherheitsgruenden nur den Dateinamen heraus - genau den brauchen wir hier.
    byId('ge-process-browse').onclick = function () {
      var picker = byId('ge-process-file');
      if (picker) { picker.value = ''; picker.click(); }
    };
    byId('ge-process-file').onchange = function () {
      var picker = byId('ge-process-file');
      var file = picker && picker.files && picker.files[0];
      if (!file) return;
      var name = cleanProcessName(file.name);
      if (!name) return;
      byId('ge-process-executable').value = name + '.exe';
      saveCurrent(function (item, cfg) { cfg.processName = name; }, true);
      picker.value = '';
    };
    byId('ge-process-scan').onclick = function () { loadProcesses(true); };
    byId('ge-process-import').onclick = copyProcessEventImportCode;
    byId('ge-process-test').onclick = function () {
      var item = selectedItem();
      if (!isProcessItem(item)) return;
      var rt = itemRuntime(item);
      rt.instances = Math.max(1, rt.instances || 0);
      sendProcessAction(item, 'started', true);
    };
  }

  function init() {
    injectStyles();
    api.render();
    schedulePoll(250);
    window.addEventListener('resize', function () {
      if (currentItemId && editorRoot && !editorRoot.hidden) applyProcessGeometry();
    });
    window.addEventListener('beforeunload', function () {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = 0;
    });
  }

  window.FreakShowProcessEvent = {
    syncEditor: syncEditor,
    hideEditor: hideEditor,
    decorateListItem: decorateListItem,
    sendProcessAction: sendProcessAction,
    loadProcesses: loadProcesses,
    init: init
  };

  init();
})();
