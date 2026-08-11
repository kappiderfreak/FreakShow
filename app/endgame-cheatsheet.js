/*
 * Endgame-Speckzettel (Cheat-Sheet): blendet Text-Kaesten auf dem Monitor ein -
 * fuer Raid-/Spiel-Notizen. MEHRERE Texte koennen GLEICHZEITIG angezeigt werden,
 * jeder an seiner eigenen Position. Kommt ueber die Bridge (/cheatsheet, jetzt
 * eine LISTE: { items: [...] }; alte Einzelform wird weiter unterstuetzt).
 * Rahmenfarbe und Hintergrundbild unabhängig, Transparenz, Textfarbe, Schriftart - pro Text.
 * Ein Streamer.bot-Trigger blendet den jeweiligen Text ein/aus (pro Text-ID).
 * Laeuft im echten Overlay (index.html).
 */
(function () {
  'use strict';
  if (window.__KAPPI_CHEATSHEET_ACTIVE__) return;
  window.__KAPPI_CHEATSHEET_ACTIVE__ = true;

  var URL_ = location.origin + '/cheatsheet';
  var POLL_MS = 250;  // Positions-/Groessenaenderungen aus dem Editor nahezu live uebernehmen
  var pollBusy = false; // keine ueberlappenden Antworten, die neue Geometrie zurueckdrehen koennen
  var LAYER_ID = 'kappi-cheatsheet-layer';
  var lastKey = '';
  var lastItems = [];
  var trigVis = {};   // pro Text-ID: per Streamer.bot-Trigger ein-/ausgeblendet (unabh. vom Schalter)
  var trigKeys = {};  // erkennt ausgeschaltete oder geaenderte Trigger und verwirft alte Sichtbarkeit
  var lastEnabledCs = {}; // zuletzt gesehener Schalter-Zustand je Text (Flanken-Erkennung, s.u.)
  var noteHideTimers = {}; // Ausblendanimation erst beenden, danach das Element verstecken

  // Streamer.bot-Globals fuer Notiz-Tokens:
  // {{sb:Name}} = gespeichert, {{sb-temp:Name}} = temporaer.
  // Der bereits vorhandene window.client wird wiederverwendet; kein zweiter Socket.
  var noteVariables = { persisted: {}, temporary: {} };
  var noteVariableEventsBound = false;
  var noteVariableRefreshBusy = false;
  var noteVariableRefreshTimer = null;
  function normalizeVariableSet(source) {
    var result = {};
    if (Array.isArray(source)) {
      for (var i = 0; i < source.length; i++) {
        var item = source[i] || {};
        var name = String(item.name || '').trim();
        if (name) result[name] = item.value;
      }
    } else if (source && typeof source === 'object') {
      for (var key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        var entry = source[key];
        result[key] = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry;
      }
    }
    return result;
  }
  function variableValueText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  function variableHtml(value) {
    return variableValueText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function resolveVariables(raw) {
    return String(raw || '').replace(/\{\{(sb|sb-temp):([^{}\r\n]+)\}\}/g, function (token, kind, name) {
      name = String(name || '').trim();
      var bucket = kind === 'sb-temp' ? noteVariables.temporary : noteVariables.persisted;
      // Im echten Overlay nie den technischen Platzhalter zeigen. Beim Start bleibt
      // die Stelle kurz leer und wird direkt nach dem Variablenabruf neu gerendert.
      return Object.prototype.hasOwnProperty.call(bucket, name) ? variableHtml(bucket[name]) : '';
    });
  }

  // --- Ereignis-Variablen (%user%, %message%, %amount%, beliebige Feldnamen) ---
  // Beim Ausloesen wird die Streamer.bot-Payload pro Notiz eingefangen und beim
  // Rendern eingesetzt - gleiche Logik wie bei den Video-Bubbles. Vor dem ersten
  // Trigger bleibt die Stelle leer (nie der technische Platzhalter im Overlay).
  var noteEventData = {}; // pro Notiz-ID: abgeflachte Payload des letzten Triggers
  function flattenEventData(source) {
    var out = {};
    function walk(value, prefix, depth) {
      if (value == null || depth > 6 || typeof value !== 'object') return;
      for (var key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        var path = prefix ? prefix + '.' + key : key;
        var v = value[key];
        if (v != null && typeof v === 'object') walk(v, path, depth + 1);
        else {
          out[path.toLowerCase()] = v;
          var short = String(key).toLowerCase();
          if (!Object.prototype.hasOwnProperty.call(out, short)) out[short] = v;
        }
      }
    }
    walk(source, '', 0);
    // %user%-Komfort: die ueblichen Namensfelder priorisiert aufloesen.
    if (out['user'] == null || typeof out['user'] === 'object') {
      var pick = ['username', 'user.name', 'displayname', 'userdisplayname', 'user.login', 'login', 'name'];
      for (var i = 0; i < pick.length; i++) {
        if (Object.prototype.hasOwnProperty.call(out, pick[i]) && out[pick[i]] != null) { out['user'] = out[pick[i]]; break; }
      }
    }
    return out;
  }
  function resolveEventVariables(raw, id) {
    var vars = noteEventData[id];
    return String(raw || '').replace(/%([A-Za-z0-9_.]+)%/g, function (token, name) {
      if (!vars) return '';
      var key = String(name || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(vars, key) ? variableHtml(vars[key]) : '';
    });
  }
  function refreshVariables() {
    var c = window.client;
    if (noteVariableRefreshBusy || !c || typeof c.getGlobals !== 'function') return false;
    // getGlobals existiert schon kurz vor abgeschlossenem WebSocket-Handshake. Erst
    // bei ready abrufen, damit der Startversuch nicht verfrueht fehlschlaegt.
    if (typeof c.ready !== 'undefined' && !c.ready) return false;
    noteVariableRefreshBusy = true;
    Promise.all([c.getGlobals(true), c.getGlobals(false)]).then(function (responses) {
      noteVariables.persisted = normalizeVariableSet(responses[0] && (responses[0].variables || responses[0]));
      noteVariables.temporary = normalizeVariableSet(responses[1] && (responses[1].variables || responses[1]));
      renderAll(lastItems);
    }).catch(function () {
      // Verbindung ist beim Start evtl. noch im Handshake; kurzfristig erneut versuchen.
      window.setTimeout(refreshVariables, 750);
    }).then(function () { noteVariableRefreshBusy = false; });
    return true;
  }
  function scheduleVariableRefresh() {
    if (noteVariableRefreshTimer) window.clearTimeout(noteVariableRefreshTimer);
    noteVariableRefreshTimer = window.setTimeout(function () { noteVariableRefreshTimer = null; refreshVariables(); }, 120);
  }
  function bindVariableEvents() {
    if (noteVariableEventsBound || !window.client || typeof window.client.on !== 'function') return false;
    noteVariableEventsBound = true;
    window.client.on('Misc.GlobalVariableCreated', scheduleVariableRefresh);
    window.client.on('Misc.GlobalVariableUpdated', scheduleVariableRefresh);
    window.client.on('Misc.GlobalVariableDeleted', scheduleVariableRefresh);
    return true;
  }

  function clampNum(v, lo, hi, def) {
    v = Number(v);
    if (!isFinite(v)) v = def;
    return Math.max(lo, Math.min(hi, v));
  }

  // Die EXE öffnet für weitere physische Bildschirme kleine Zusatzfenster. Ein
  // Element ohne eigene Auswahl (-1) gehört weiterhin zum global gewählten
  // Hauptmonitor – das erhält das alte Verhalten vollständig.
  function belongsToThisMonitor(cfg) {
    if (!window.__KAPPI_MONITOR_ROUTING__) return true;
    var local = Number(window.__KAPPI_LOCAL_MONITOR__);
    var primary = Number(window.__KAPPI_PRIMARY_MONITOR__);
    var target = parseInt(cfg && cfg.targetMonitor, 10);
    if (!isFinite(target) || target < 0) target = isFinite(primary) ? primary : 0;
    return target === local;
  }

  // Eine gemeinsame, fixe Ebene haelt ALLE Text-Kaesten (so bewegt/entfernt ein Text
  // die anderen nicht). Jeder Text ist ein Kind mit eigener Position.
  function ensureLayer() {
    var l = document.getElementById(LAYER_ID);
    if (!l) {
      l = document.createElement('div');
      l.id = LAYER_ID;
      l.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:2147483000;';
      (document.body || document.documentElement).appendChild(l);
    }
    return l;
  }

  function ensureItemEl(layer, id) {
    var el = document.getElementById('kcs-item-' + id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'kcs-item-' + id;
      el.style.cssText = 'position:absolute; box-sizing:border-box; pointer-events:none; display:none;';
      var bg = document.createElement('div');
      bg.className = 'kcs-bg';
      bg.style.cssText = 'position:absolute; inset:0; border-radius:inherit; z-index:0; background-size:cover; background-position:center; background-repeat:no-repeat;';
      var frame = document.createElement('div');
      frame.className = 'kcs-text-frame';
      var txt = document.createElement('div');
      txt.className = 'kcs-text';
      txt.style.cssText = 'position:relative; z-index:1; white-space:pre-wrap; word-break:break-word; overflow-wrap:break-word;';
      frame.appendChild(txt);
      el.appendChild(bg);
      el.appendChild(frame);
      layer.appendChild(el);
    } else if (!el.querySelector('.kcs-text-frame')) {
      // Laufende Overlay-Seiten ohne Neuladen verlustfrei auf die neue, mit der
      // Vorschau identische Text-Frame-Struktur umstellen.
      var oldText = el.querySelector('.kcs-text');
      var migratedFrame = document.createElement('div');
      migratedFrame.className = 'kcs-text-frame';
      if (oldText) migratedFrame.appendChild(oldText);
      el.appendChild(migratedFrame);
    }
    return el;
  }
  function colorWithOpacity(hex, opacity) {
    var match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!match) return String(hex || '#8ab4f8');
    var value = parseInt(match[1], 16);
    return 'rgba(' + ((value >> 16) & 255) + ',' + ((value >> 8) & 255) + ',' + (value & 255) + ',' + (clampNum(opacity, 0, 100, 100) / 100) + ')';
  }

  function noteAnimationKind(value, legacy) {
    value = String(value == null ? (legacy || 'none') : value).toLowerCase();
    return ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'typewriter'].indexOf(value) >= 0 ? value : 'none';
  }

  function noteAnimationDurationMs(cfg) {
    var unit = cfg && cfg.animationUnit === 's' ? 's' : 'ms';
    var duration = Number(cfg && cfg.animationDuration);
    if (unit === 's' && isFinite(duration) && duration > 60) duration = duration / 1000;
    if (!isFinite(duration) || duration <= 0) duration = unit === 's' ? 0.4 : 400;
    duration = unit === 's'
      ? clampNum(duration, 0.05, 60, 0.4) * 1000
      : clampNum(duration, 50, 60000, 400);
    return Math.round(duration);
  }

  function cancelNoteLayerAnimation(target, visible) {
    if (!target) return;
    if (target.__kcsNoteAnimation && typeof target.__kcsNoteAnimation.cancel === 'function') {
      try { target.__kcsNoteAnimation.cancel(); } catch (e) {}
    }
    target.__kcsNoteAnimation = null;
    target.style.visibility = visible === false ? 'hidden' : 'visible';
  }

  function noteAnimationFrames(kind, entering, baseOpacity) {
    var shown = { opacity: baseOpacity, transform: 'none', clipPath: 'inset(0 0 0 0)' };
    var hidden = { opacity: 0, transform: 'none', clipPath: 'inset(0 0 0 0)' };
    if (kind === 'slide-up') hidden.transform = 'translateY(' + (entering ? '6vh' : '-6vh') + ')';
    else if (kind === 'slide-down') hidden.transform = 'translateY(' + (entering ? '-6vh' : '6vh') + ')';
    else if (kind === 'slide-left') hidden.transform = 'translateX(' + (entering ? '6vw' : '-6vw') + ')';
    else if (kind === 'slide-right') hidden.transform = 'translateX(' + (entering ? '-6vw' : '6vw') + ')';
    else if (kind === 'zoom') hidden.transform = 'scale(.82)';
    else if (kind === 'typewriter') {
      hidden.opacity = baseOpacity;
      hidden.clipPath = 'inset(0 100% 0 0)';
    }
    return entering ? [hidden, shown] : [shown, hidden];
  }

  function animateNoteLayer(target, kind, entering, durationMs) {
    if (!target) return false;
    cancelNoteLayerAnimation(target, true);
    // Diese Bewegung wurde vom Nutzer fuer das Stream-Overlay ausdruecklich
    // konfiguriert und darf deshalb nicht still durch eine Browser-Voreinstellung
    // ersetzt werden.
    if (kind === 'none') {
      if (!entering) target.style.visibility = 'hidden';
      return false;
    }
    if (typeof target.animate !== 'function') {
      if (!entering) target.style.visibility = 'hidden';
      return false;
    }
    var baseOpacity = Number(window.getComputedStyle(target).opacity);
    if (!isFinite(baseOpacity)) baseOpacity = 1;
    var animation = target.animate(noteAnimationFrames(kind, entering, baseOpacity), {
      duration: durationMs,
      easing: entering ? 'cubic-bezier(.2,.75,.25,1)' : 'cubic-bezier(.55,0,.8,.45)',
      fill: 'both'
    });
    target.__kcsNoteAnimation = animation;
    if (entering) animation.onfinish = function () {
      if (target.__kcsNoteAnimation !== animation) return;
      try { animation.cancel(); } catch (e) {}
      target.__kcsNoteAnimation = null;
      target.style.visibility = 'visible';
    };
    return true;
  }

  function noteSegmentSettings(el) {
    if (!el) return null;
    try { return JSON.parse(el.getAttribute('data-cheat-segment-settings') || '{}'); }
    catch (e) { return null; }
  }

  function noteSegmentStyleValue(value) {
    value = String(value || 'normal');
    return /^(normal|bold|italic|bolditalic)$/.test(value) ? value : 'normal';
  }

  function applyStoredTextSegments(root, contentScale) {
    if (!root || !root.querySelectorAll) return;
    var segments = root.querySelectorAll('[data-cheat-segment-settings]');
    for (var i = 0; i < segments.length; i++) {
      var el = segments[i], settings = noteSegmentSettings(el);
      if (!settings) continue;
      var style = noteSegmentStyleValue(settings.textStyle);
      var textColor = settings.textColor || '#e8f0ff';
      el.classList.add('cheat-text-segment');
      el.style.display = 'inline';
      el.style.fontSize = (clampNum(settings.fontSize, 10, 160, 20) * contentScale) + 'px';
      el.style.fontFamily = settings.font || 'Segoe UI, sans-serif';
      el.style.fontWeight = (style === 'bold' || style === 'bolditalic') ? '800' : '600';
      el.style.fontStyle = (style === 'italic' || style === 'bolditalic') ? 'italic' : 'normal';
      var transform = String(settings.textTransform || 'none');
      el.style.textTransform = transform === 'upper' ? 'uppercase'
        : (transform === 'lower' ? 'lowercase' : (transform === 'caps' ? 'capitalize' : 'none'));
      el.style.webkitFontSmoothing = settings.antialias === false ? 'none' : 'antialiased';
      el.style.textRendering = settings.antialias === false ? 'optimizeSpeed' : 'optimizeLegibility';
      el.style.writingMode = settings.verticalText === true ? 'vertical-rl' : '';
      el.style.textOrientation = settings.verticalText === true ? 'upright' : '';
      el.style.opacity = String(clampNum(settings.textOpacity, 0, 100, 100) / 100);
      var outline = settings.outlineEnabled === true ? clampNum(settings.outlineSize, 0, 20, 2) * contentScale : 0;
      el.style.webkitTextStroke = outline > 0 ? outline + 'px ' + (settings.outlineColor || '#000000') : '0 transparent';
      el.style.paintOrder = outline > 0 ? 'stroke fill' : 'normal';
      if (settings.gradientEnabled === true) {
        el.style.backgroundImage = 'linear-gradient(' + clampNum(settings.gradientAngle, 0, 360, 90) + 'deg, ' + textColor + ', ' + colorWithOpacity(settings.gradientColor || '#8ab4f8', settings.gradientOpacity) + ')';
        el.style.webkitBackgroundClip = 'text';
        el.style.backgroundClip = 'text';
        el.style.color = 'transparent';
        el.style.webkitTextFillColor = 'transparent';
      } else {
        el.style.backgroundImage = '';
        el.style.webkitBackgroundClip = '';
        el.style.backgroundClip = '';
        el.style.color = textColor;
        el.style.webkitTextFillColor = textColor;
      }
    }
  }

  function animateStoredTextSegments(root, entering) {
    if (!root || !root.querySelectorAll) return 0;
    var segments = root.querySelectorAll('[data-cheat-segment-settings]');
    var longest = 0;
    for (var i = 0; i < segments.length; i++) {
      var settings = noteSegmentSettings(segments[i]); if (!settings) continue;
      var kind = noteAnimationKind(entering ? settings.textEnterAnimation : settings.textExitAnimation);
      var unit = String(settings.animationUnit || 'ms').toLowerCase() === 's' ? 's' : 'ms';
      var rawDuration = clampNum(settings.animationDuration, unit === 's' ? 0.1 : 50, unit === 's' ? 10 : 10000, unit === 's' ? 0.6 : 600);
      var durationMs = unit === 's' ? rawDuration * 1000 : rawDuration;
      if (kind !== 'none' && animateNoteLayer(segments[i], kind, entering, durationMs)) longest = Math.max(longest, durationMs);
    }
    return longest;
  }

  function cancelStoredTextSegmentAnimations(root, visible) {
    if (!root || !root.querySelectorAll) return;
    var segments = root.querySelectorAll('[data-cheat-segment-settings]');
    for (var i = 0; i < segments.length; i++) cancelNoteLayerAnimation(segments[i], visible);
  }

  function finishNoteHide(el, id) {
    if (noteHideTimers[id]) window.clearTimeout(noteHideTimers[id]);
    delete noteHideTimers[id];
    cancelNoteLayerAnimation(el.querySelector('.kcs-text'), false);
    cancelStoredTextSegmentAnimations(el.querySelector('.kcs-text'), false);
    cancelNoteLayerAnimation(el.querySelector('.kcs-bg'), false);
    if (el.dataset.noteVisible !== '1') el.style.display = 'none';
    el.dataset.noteExiting = '0';
  }

  function beginNoteExit(el, cfg, hasText, hasImage) {
    var id = String(cfg && cfg.id || el.id || 'note');
    if (el.dataset.noteExiting === '1') return;
    el.dataset.noteVisible = '0';
    el.dataset.noteExiting = '1';
    delete el.dataset.noteTextEnterStamp;
    delete el.dataset.noteImageEnterStamp;
    var durationMs = noteAnimationDurationMs(cfg || {});
    var textKind = noteAnimationKind(cfg && cfg.textExitAnimation);
    var imageKind = noteAnimationKind(cfg && cfg.imageExitAnimation);
    var textRuns = hasText && animateNoteLayer(el.querySelector('.kcs-text'), textKind, false, durationMs);
    var segmentDuration = hasText ? animateStoredTextSegments(el.querySelector('.kcs-text'), false) : 0;
    var imageRuns = hasImage && animateNoteLayer(el.querySelector('.kcs-bg'), imageKind, false, durationMs);
    if (!textRuns && !imageRuns && !segmentDuration) {
      finishNoteHide(el, id);
      return;
    }
    noteHideTimers[id] = window.setTimeout(function () { finishNoteHide(el, id); }, Math.max(durationMs, segmentDuration) + 34);
  }

  function renderItem(el, cfg) {
    // Zeigen, wenn der manuelle Schalter AN ist ODER per Streamer.bot-Trigger eingeblendet.
    var hasText = !!(cfg && String(cfg.text || '').trim().length > 0);
    var hasImage = !!(cfg && cfg.backgroundEnabled && String(cfg.bgImage || '').trim());
    var show = cfg && (cfg.enabled || trigVis[cfg.id]) && (hasText || hasImage);
    if (!show) {
      if (el.dataset.noteVisible === '1') beginNoteExit(el, cfg || {}, hasText, hasImage);
      else if (el.dataset.noteExiting !== '1') finishNoteHide(el, String(cfg && cfg.id || el.id || 'note'));
      return;
    }
    var noteId = String(cfg.id || el.id || 'note');
    var wasExiting = el.dataset.noteExiting === '1';
    if (noteHideTimers[noteId]) window.clearTimeout(noteHideTimers[noteId]);
    delete noteHideTimers[noteId];
    var noteIsEntering = el.dataset.noteVisible !== '1';
    // Nur beim echten Wiedereinblenden bzw. beim Abbruch einer Ausblendung
    // laufende Animationen zuruecksetzen. Normale Bridge-Aktualisierungen duerfen
    // eine gerade sichtbare Animation nicht mitten im Lauf abschneiden.
    if (noteIsEntering || wasExiting) {
      cancelNoteLayerAnimation(el.querySelector('.kcs-text'), true);
      cancelStoredTextSegmentAnimations(el.querySelector('.kcs-text'), true);
      cancelNoteLayerAnimation(el.querySelector('.kcs-bg'), true);
    }
    el.dataset.noteVisible = '1';
    el.dataset.noteExiting = '0';

    // Position/Breite/Hoehe in PROZENT des Monitors (frei positionierbar, pro Text).
    var x = clampNum(cfg.x, 0, 100, 66);
    var y = clampNum(cfg.y, 0, 100, 6);
    // Content Scale skaliert ALLES: Rahmen samt Breite und Hoehe, Schrift, Abstaende
    // und jeden Inhalt darin. Ein Regler fuer die komplette Notiz.
    var contentScale = clampNum(cfg.contentScale, 25, 200, 100) / 100;
    var width = clampNum(cfg.width, 5, 90, 24) * contentScale;
    var height = clampNum(cfg.height, 0, 95, 0) * contentScale;
    if (height > 0 && height < 4) height = 4;
    x = Math.min(x, Math.max(0, 100 - width));
    if (height > 0) y = Math.min(y, Math.max(0, 100 - height));
    // Das Bedienfeld erlaubt bis 160 px. Die Ausgabe muss exakt dieselbe Grenze
    // verwenden; die alte 96-px-Kappe ließ den echten Text kleiner als die
    // Vorschau erscheinen und erzeugte dadurch scheinbar leeren Platz.
    var fontSize = clampNum(cfg.fontSize, 10, 160, 20) * contentScale;
    var bgOpacity = clampNum(cfg.bgOpacity, 0, 100, 85) / 100;
    var textOpacity = clampNum(cfg.textOpacity, 0, 100, 100) / 100;
    var frameColor = cfg.frameColor || '#101826';
    var frameEnabled = (typeof cfg.frameEnabled === 'boolean') ? cfg.frameEnabled : true;
    var backgroundEnabled = (typeof cfg.backgroundEnabled === 'boolean') ? cfg.backgroundEnabled : (cfg.mode === 'image');
    var textColor = cfg.textColor || '#e8f0ff';
    var font = cfg.font || 'Segoe UI, sans-serif';
    // Ausrichtung des Textes INNERHALB der Notiz - neun Stellungen.
    // Senkrecht ueber das Flex-Raster, waagerecht ueber text-align.
    var alignX = ['center', 'end'].indexOf(cfg.textAlignX) >= 0 ? cfg.textAlignX : 'start';
    var alignY = ['center', 'end'].indexOf(cfg.textAlignY) >= 0 ? cfg.textAlignY : 'start';
    var flexY = alignY === 'center' ? 'center' : (alignY === 'end' ? 'flex-end' : 'flex-start');
    var textX = alignX === 'center' ? 'center' : (alignX === 'end' ? 'right' : 'left');
    // Optional kann der Text unabhaengig vom Notiz-Hintergrund innerhalb der
    // Flaeche platziert werden. X/Y sind Prozent der Notiz und bezeichnen die
    // linke obere Ecke des Textbereichs. Breite/Hoehe sind ebenfalls Prozent
    // der Notiz; alte Daten ohne diese Werte behalten ihre bisherige Restflaeche.
    var textFree = cfg.textFreePosition === true;
    var textPositionX = clampNum(cfg.textPositionX, 0, 95, 0);
    var textPositionY = clampNum(cfg.textPositionY, 0, 95, 0);
    var textPositionWidth = clampNum(cfg.textPositionWidth, 5, 100 - textPositionX, 100 - textPositionX);
    var textPositionHeight = clampNum(cfg.textPositionHeight, 5, 100 - textPositionY, 100 - textPositionY);

    el.style.cssText = 'position:absolute; box-sizing:border-box; pointer-events:none;'
      + ' display:' + (textFree ? 'block' : 'flex') + '; align-items:' + (textFree ? 'initial' : flexY) + ';'
      + ' left:' + x + 'vw; top:' + y + 'vh; width:' + width + 'vw;'
      + (height > 0 ? ' height:' + height + 'vh;' : '')
      + ' max-width:calc(100vw - 6px); max-height:calc(100vh - 6px); overflow:hidden;'
      + ' padding:' + (10 * contentScale) + 'px ' + (12 * contentScale) + 'px;'
      + ' border-radius:' + (10 * contentScale) + 'px; border:' + (2 * contentScale) + 'px solid ' + (frameEnabled ? frameColor : 'transparent') + ';'
      + ' box-shadow:0 ' + (6 * contentScale) + 'px ' + (24 * contentScale) + 'px rgba(0,0,0,.45);';

    var bg = el.querySelector('.kcs-bg');
    if (backgroundEnabled && String(cfg.bgImage || '').trim()) {
      var imagePositionX = clampNum(cfg.imagePositionX, 0, 95, 0);
      var imagePositionY = clampNum(cfg.imagePositionY, 0, 95, 0);
      var imagePositionWidth = clampNum(cfg.imagePositionWidth, 5, 100 - imagePositionX, 100 - imagePositionX);
      var imagePositionHeight = clampNum(cfg.imagePositionHeight, 5, 100 - imagePositionY, 100 - imagePositionY);
      var imageFit = ['contain', 'stretch'].indexOf(String(cfg.imageFit || '').toLowerCase()) >= 0
        ? String(cfg.imageFit).toLowerCase()
        : 'cover';
      // Gespeicherte volle Bridge-URL auf die eigene Herkunft umbiegen (Tab-/PC-uebergreifend).
      var _bi = String(cfg.bgImage).replace(/\/content\/backgrounds\//i, '/content/notes/backgrounds/'); var _ci = _bi.indexOf('/content/');
      var _url = (_ci > 0 && /^https?:\/\//.test(_bi)) ? (location.origin + _bi.slice(_ci)) : _bi;
      bg.style.inset = 'auto';
      bg.style.left = imagePositionX + '%';
      bg.style.top = imagePositionY + '%';
      bg.style.width = imagePositionWidth + '%';
      bg.style.height = imagePositionHeight + '%';
      bg.style.backgroundImage = 'url("' + _url.replace(/"/g, '%22') + '")';
      bg.style.backgroundColor = 'transparent';
      bg.style.backgroundSize = imageFit === 'stretch' ? '100% 100%' : imageFit;
      bg.style.backgroundPosition = 'center';
      bg.style.backgroundRepeat = 'no-repeat';
      bg.style.borderRadius = (imagePositionX === 0 && imagePositionY === 0 && imagePositionWidth === 100 && imagePositionHeight === 100)
        ? 'inherit'
        : (4 * contentScale) + 'px';
    } else {
      bg.style.inset = '0';
      bg.style.left = '';
      bg.style.top = '';
      bg.style.width = '';
      bg.style.height = '';
      bg.style.backgroundImage = 'none';
      bg.style.backgroundColor = frameEnabled ? frameColor : 'transparent';
      bg.style.backgroundSize = 'cover';
      bg.style.borderRadius = 'inherit';
    }
    bg.style.opacity = String(bgOpacity);

    var textFrame = el.querySelector('.kcs-text-frame');
    var txt = el.querySelector('.kcs-text');
    // Formatierter Text (Fett/Kursiv/Unterstrichen kommen als <b>/<i>/<u> aus dem Bedienfeld).
    // Quelle ist der eigene, lokale Speckzettel-Text -> innerHTML ist hier vertretbar.
    // Zusaetzlich wird Mini-Markdown interpretiert (kappi-markdown.js: Ueberschriften,
    // Tabellen, Listen, **fett** usw.) - identisch zur Vorschau im Bedienfeld.
    var rawText = resolveEventVariables(resolveVariables(cfg.text || ''), cfg.id);
    txt.innerHTML = (typeof window.kappiMarkdown === 'function') ? window.kappiMarkdown(rawText) : rawText;
    applyStoredTextSegments(txt, contentScale);
    // Ein Text ohne bewusst gesetzten Zeilenumbruch bleibt beim automatischen
    // Einpassen einzeilig. So wird er weiter verkleinert, statt ab einer
    // bestimmten Laenge unerwartet in eine zweite Zeile zu springen.
    var singleLineFit = cfg.fitText === true
      && !/[\r\n]/.test(String(rawText || ''))
      && !/<br\s*\/?\s*>/i.test(String(rawText || ''));
    var imageEmojis = txt.querySelectorAll('img.kappi-note-image-emoji');
    for (var ie = 0; ie < imageEmojis.length; ie++) {
      var imageEmojiSize = clampNum(imageEmojis[ie].getAttribute('data-kappi-note-emoji-size'), 16, 256, 48);
      imageEmojis[ie].style.width = (imageEmojiSize * contentScale) + 'px';
      imageEmojis[ie].style.height = 'auto';
      imageEmojis[ie].style.maxWidth = '100%';
      imageEmojis[ie].style.objectFit = 'contain';
      imageEmojis[ie].style.verticalAlign = 'middle';
    }
    // kappi-markdown.js setzt Tabellen-Zellen mit festen Pixeln (1px Rahmen,
    // 2px/8px Innenabstand). Die muessen mitskalieren, sonst bleiben Tabellen
    // beim Herunterskalieren zu klobig - die Vorschau macht es schon so.
    var cells = txt.querySelectorAll('th, td');
    for (var ci = 0; ci < cells.length; ci++) {
      cells[ci].style.borderWidth = (1 * contentScale) + 'px';
      cells[ci].style.padding = (2 * contentScale) + 'px ' + (8 * contentScale) + 'px';
    }
    txt.style.color = textColor;
    txt.style.opacity = String(textOpacity);
    txt.style.fontFamily = font;
    txt.style.fontSize = fontSize + 'px';
    txt.style.lineHeight = '1.35';
    // Exakt dieselbe Struktur wie in der Bedienfeld-Vorschau: Der unsichtbare
    // Frame traegt Position, Groesse und vertikale Ausrichtung; der Text selbst
    // bleibt darin relativ. So stimmen freie Textposition und Zentrierung in
    // Vorschau, Gaming-PC-Ausgabe und OBS pixelgleich ueberein.
    if (textFrame) {
      textFrame.style.cssText = textFree
        ? ('position:absolute; z-index:1; display:flex; box-sizing:border-box; overflow:hidden;'
          + ' left:' + textPositionX + '%; top:' + textPositionY + '%;'
          + ' width:' + textPositionWidth + '%; height:' + textPositionHeight + '%;'
          + ' align-items:' + flexY + ';')
        : 'display:contents;';
    }
    txt.style.position = 'relative';
    txt.style.left = '';
    txt.style.top = '';
    txt.style.width = '100%';
    txt.style.height = 'auto';
    txt.style.maxHeight = textFree ? '100%' : '';
    txt.style.overflow = textFree ? 'hidden' : '';
    txt.style.boxSizing = 'border-box';
    txt.style.whiteSpace = singleLineFit ? 'nowrap' : 'pre-wrap';
    txt.style.wordBreak = singleLineFit ? 'normal' : 'break-word';
    txt.style.overflowWrap = singleLineFit ? 'normal' : 'break-word';
    txt.style.textAlign = textX;
    // Volle Hoehe nur bei Ausrichtung oben. Sonst wuerde der Textblock die
    // ganze Notiz fuellen und senkrechtes Zentrieren haette keine Wirkung.
    txt.style.minHeight = (!textFree && height > 0 && alignY === 'start') ? '100%' : '';
    // ===== Design: Schrift & Text =====
    var style = String(cfg.textStyle || 'normal');
    txt.style.fontWeight = (style === 'bold' || style === 'bolditalic') ? '800' : '600';
    txt.style.fontStyle = (style === 'italic' || style === 'bolditalic') ? 'italic' : 'normal';
    var transform = String(cfg.textTransform || 'none');
    txt.style.textTransform = transform === 'upper' ? 'uppercase'
      : (transform === 'lower' ? 'lowercase' : (transform === 'caps' ? 'capitalize' : 'none'));
    // Kantenglaettung aus: harte Pixelkanten, z. B. fuer Pixelschriften.
    txt.style.webkitFontSmoothing = (cfg.antialias === false) ? 'none' : 'antialiased';
    txt.style.textRendering = (cfg.antialias === false) ? 'optimizeSpeed' : 'optimizeLegibility';
    txt.style.writingMode = (cfg.verticalText === true) ? 'vertical-rl' : '';
    txt.style.textOrientation = (cfg.verticalText === true) ? 'upright' : '';

    // ===== Design: Effekte =====
    // Kontur und Fuellung muessen getrennte Ebenen bleiben. Die frueheren vier
    // farbigen Textschatten lagen bei einer transparenten Verlaufsfuellung auch
    // innerhalb der Buchstaben und faerbten dadurch den kompletten Text in der
    // Konturfarbe. Ein echter Stroke bleibt hinter der Fuellung; der neutrale
    // Schlagschatten beeinflusst den Farbverlauf nicht.
    txt.style.textShadow = '0 ' + (1 * contentScale) + 'px ' + (2 * contentScale) + 'px rgba(0,0,0,.55)';
    var oSize = cfg.outlineEnabled === true ? clampNum(cfg.outlineSize, 0, 20, 2) * contentScale : 0;
    var oColor = cfg.outlineColor || '#000000';
    if (oSize > 0) {
      txt.style.webkitTextStroke = oSize + 'px ' + oColor;
      txt.style.paintOrder = 'stroke fill';
    } else {
      txt.style.webkitTextStroke = '0 transparent';
      txt.style.paintOrder = 'normal';
    }
    // Farbverlauf auf dem Text: Verlauf als Hintergrund, Text als Maske.
    if (cfg.gradientEnabled === true) {
      var gAngle = clampNum(cfg.gradientAngle, 0, 360, 90);
      var gColor = cfg.gradientColor || '#8ab4f8';
      txt.style.backgroundImage = 'linear-gradient(' + gAngle + 'deg, ' + textColor + ', ' + colorWithOpacity(gColor, cfg.gradientOpacity) + ')';
      txt.style.webkitBackgroundClip = 'text';
      txt.style.backgroundClip = 'text';
      txt.style.color = 'transparent';
      txt.style.webkitTextFillColor = 'transparent';
    } else {
      txt.style.backgroundImage = '';
      txt.style.webkitBackgroundClip = '';
      txt.style.backgroundClip = '';
      txt.style.webkitTextFillColor = '';
      txt.style.color = textColor;
    }

    // Einpassen NACH allen Schrifteinstellungen - sonst wird an der falschen
    // Groesse gemessen.
    if (cfg.fitText === true) fitTextIntoBox(textFree && textFrame ? textFrame : el, txt, fontSize);

    // ===== Design: Animation =====
    applyNoteEnterAnimations(el, cfg, noteIsEntering);
  }

  // Getrennte Einblendanimationen fuer Text und Bild. Das alte Feld „animation"
  // bleibt der Fallback fuer bereits gespeicherte Notizen.
  function applyNoteEnterAnimations(el, cfg, forceRestart) {
    var durationMs = noteAnimationDurationMs(cfg);
    var textKind = noteAnimationKind(cfg.textEnterAnimation, cfg.animation);
    var imageKind = noteAnimationKind(cfg.imageEnterAnimation, cfg.animation);
    var hasImage = cfg.backgroundEnabled === true && String(cfg.bgImage || '').trim().length > 0;
    var textStamp = textKind + '|' + durationMs + '|' + String(cfg.text || '').length;
    var imageStamp = imageKind + '|' + durationMs + '|' + String(cfg.bgImage || '');
    if (forceRestart || el.dataset.noteTextEnterStamp !== textStamp) {
      el.dataset.noteTextEnterStamp = textStamp;
      animateNoteLayer(el.querySelector('.kcs-text'), textKind, true, durationMs);
      animateStoredTextSegments(el.querySelector('.kcs-text'), true);
    }
    if (hasImage && (forceRestart || el.dataset.noteImageEnterStamp !== imageStamp)) {
      el.dataset.noteImageEnterStamp = imageStamp;
      animateNoteLayer(el.querySelector('.kcs-bg'), imageKind, true, durationMs);
    } else if (!hasImage) {
      delete el.dataset.noteImageEnterStamp;
      cancelNoteLayerAnimation(el.querySelector('.kcs-bg'), true);
    }
  }

  // Schrift so weit verkleinern, bis der Text in die Notiz passt. Gedacht fuer
  // Anzeigen mit wechselndem Inhalt - ein kurzer Name passt, ein sehr langer
  // wuerde sonst unten abgeschnitten. Bis 6 px verkleinern: eine prozentuale
  // Untergrenze stoppte bei grossen Ausgangsschriften zu frueh und erzwang trotz
  // „Einpassen“ einen ungewollten Zeilenumbruch.
  function fitTextIntoBox(box, txt, basePx) {
    var min = 6;
    var size = basePx;
    txt.style.fontSize = size + 'px';
    function textFits() {
      // Der Rahmen selbst hat overflow:hidden. Dadurch kann sein scrollHeight
      // trotz abgeschnittenem Kind genauso gross wie clientHeight bleiben.
      // Deshalb immer den wirklichen Text-Ueberlauf gegen die nutzbare
      // Innenflaeche des Rahmens pruefen.
      var cs = window.getComputedStyle(box);
      var innerW = Math.max(1, box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
      var innerH = Math.max(1, box.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0));
      var availableW = Math.max(1, Math.min(txt.clientWidth || innerW, innerW));
      var availableH = Math.max(1, Math.min(txt.clientHeight || innerH, innerH));
      return txt.scrollWidth <= availableW + 1 && txt.scrollHeight <= availableH + 1;
    }
    for (var step = 0; step < 48; step++) {
      if (textFits()) break;
      if (size <= min) break;
      size = size * 0.92;
      if (size < min) size = min;
      txt.style.fontSize = size + 'px';
    }
  }

  function renderAll(items) {
    var layer = ensureLayer();
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var cfg = items[i];
      if (!cfg || !cfg.id) continue;
      if (!belongsToThisMonitor(cfg)) continue;
      seen[cfg.id] = true;
      var triggerKey = cfg.triggerOn ? String(cfg.trigger || '').trim() : '';
      if (!triggerKey || (Object.prototype.hasOwnProperty.call(trigKeys, cfg.id) && trigKeys[cfg.id] !== triggerKey)) {
        delete trigVis[cfg.id];
      }
      trigKeys[cfg.id] = triggerKey;
      // Flanken-Erkennung: aendert sich der GESPEICHERTE Schalter (enabled), war das ein
      // manueller Klick im Bedienfeld -> Laufzeit-Trigger-Sichtbarkeit dieses Textes
      // verwerfen (sonst haelt trigVis einen per Streamer.bot eingeblendeten Text fest
      // und der Schalter laesst sich scheinbar nicht ausschalten).
      var enNow = !!cfg.enabled;
      if (Object.prototype.hasOwnProperty.call(lastEnabledCs, cfg.id) && lastEnabledCs[cfg.id] !== enNow) {
        delete trigVis[cfg.id];
      }
      lastEnabledCs[cfg.id] = enNow;
      renderItem(ensureItemEl(layer, cfg.id), cfg);
    }
    // Veraltete Text-Elemente entfernen (Text geloescht/umbenannt).
    var existing = layer.querySelectorAll('[id^="kcs-item-"]');
    for (var j = existing.length - 1; j >= 0; j--) {
      var id = existing[j].id.replace('kcs-item-', '');
      if (!seen[id]) {
        if (noteHideTimers[id]) window.clearTimeout(noteHideTimers[id]);
        delete noteHideTimers[id];
        layer.removeChild(existing[j]);
        delete trigVis[id];
        delete trigKeys[id];
        delete lastEnabledCs[id];
        delete noteEventData[id];
      }
    }
  }

  // Bridge liefert jetzt { items: [...] }. Alte Einzelform ({text,enabled,...} ohne
  // items) wird als 1-Element-Liste behandelt (Abwaertskompatibilitaet).
  function normalizeResponse(r) {
    if (r && Object.prototype.toString.call(r.items) === '[object Array]') return r.items;
    if (r && (typeof r.text === 'string' || typeof r.enabled !== 'undefined')) {
      if (!r.id) r.id = 'legacy';
      return [r];
    }
    return [];
  }

  function poll() {
    if (pollBusy) return;
    pollBusy = true;
    try {
      var x = new XMLHttpRequest();
      x.open('GET', URL_ + '?t=' + Date.now(), true);
      x.timeout = 2500;
      x.onload = function () {
        pollBusy = false;
        if (x.status < 200 || x.status >= 300) return;
        var key = x.responseText || '';
        if (key === lastKey) return; // nichts geaendert -> nicht neu zeichnen
        lastKey = key;
        try { lastItems = normalizeResponse(JSON.parse(key)); renderAll(lastItems); } catch (e) {}
      };
      x.onerror = x.ontimeout = x.onabort = function () { pollBusy = false; };
      x.send();
    } catch (e) { pollBusy = false; }
  }

  // --- Streamer.bot Custom-Event -> Text ein-/ausblenden (pro Text-ID) ---
  // Streamer.bot sendet { "<trigger>": true }. Nur Texte mit triggerOn reagieren.
  function onCustom(payload) {
    var data = payload && payload.data ? payload.data : {};
    // Lokale Client-Lib verpackt CPH.WebsocketBroadcastJson eine Ebene tief -> auspacken.
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') { data = data.data; }
    var changed = false;
    for (var i = 0; i < lastItems.length; i++) {
      var cfg = lastItems[i];
      if (!cfg || !cfg.triggerOn) continue;
      var trig = String(cfg.trigger || '').trim();
      if (trig && data[trig] === true) {
        trigVis[cfg.id] = !trigVis[cfg.id];
        // Payload dieses Triggers fuer %user%/%message%/... im Notiz-Text merken.
        noteEventData[cfg.id] = flattenEventData(data);
        changed = true;
      }
    }
    if (changed) renderAll(lastItems);
  }
  function bindTrigger() {
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('General.Custom', onCustom);
      return true;
    }
    return false;
  }

  function start() {
    poll();
    window.setInterval(poll, POLL_MS);
    // Der Streamer.bot-Client steht evtl. erst spaeter bereit -> mit Wiederholung binden.
    if (!bindTrigger()) {
      var tries = 0;
      var t = window.setInterval(function () { if (bindTrigger() || ++tries > 60) window.clearInterval(t); }, 1000);
    }
    bindVariableEvents();
    // Der echte Client ersetzt beim Start kurz den Warteschlangen-Client. Sobald getGlobals
    // verfuegbar ist, werden beide Variablenarten geladen; danach dienen Events + 15-s-Fallback.
    var variableTries = 0;
    var variableStart = window.setInterval(function () {
      bindVariableEvents();
      if (refreshVariables() || ++variableTries > 60) window.clearInterval(variableStart);
    }, 500);
    window.setInterval(refreshVariables, 15000);
  }
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start);
})();
