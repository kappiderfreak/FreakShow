// Central runtime settings for existing and newly managed video overlays.
(function () {
  'use strict';

  if (window.__KAPPI_VIDEO_OVERLAY_MANAGER_ACTIVE__) return;
  window.__KAPPI_VIDEO_OVERLAY_MANAGER_ACTIVE__ = true;

  var SETTINGS_URL = location.origin + '/video-overlays';
  var TRIGGER_URL = location.origin + '/trigger-video';
  // Die Bridge schliesst HTTP-Antworten bewusst. Zu kurze Intervalle erzeugten dadurch
  // tausende TIME_WAIT-Sockets. Einstellungen duerfen etwas ruhiger nachziehen; Trigger
  // bleiben mit maximal rund 500 ms weiterhin praktisch unmittelbar.
  var POLL_MS = 2000;
  var TRIGGER_POLL_MS = 500;
  var items = [];
  var lastTriggerToken = -1;
  var videosPaused = false;
  // Nur das doppelte Echo DESSELBEN unmittelbar aufeinanderfolgenden Events blocken.
  // A -> B -> A muss dagegen auch innerhalb weniger Millisekunden erlaubt bleiben.
  var DUPLICATE_DEBOUNCE_MS = 140;
  var lastRequestedKey = '';
  var lastRequestedAt = 0;
  var pendingTemplateData = Object.create(null);

  // Neuester Trigger gewinnt. Alte Lade-/Play-Events duerfen einen spaeteren Trigger
  // niemals mehr ueberholen. Nur ein VOLLSTAENDIG gepuffertes Video darf warm bleiben;
  // Hintergrund-Warmups wuerden auf der seriellen HTTP-Bridge Steuerbefehle blockieren.
  var playbackGeneration = 0;
  var activeVideo = null;
  var bubbleChatlogHistory = Object.create(null);
  var playbackStatus = { generation: 0, id: '', phase: 'idle', requestedAt: 0, playingAt: 0 };
  var MAX_WARM_PLAYERS = 1;
  var warmPlayers = Object.create(null);
  var warmOrder = [];

  function number(value, fallback, min, max) {
    var parsed = Number(value);
    if (!isFinite(parsed)) parsed = fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  var FREE_POSITION_MIN_SIZE = 8;
  function normalizeVideoArea(area, allowOutside) {
    area = area || {};
    var width = number(area.width, 100, FREE_POSITION_MIN_SIZE, 100);
    var height = number(area.height, 100, FREE_POSITION_MIN_SIZE, 100);
    return {
      x: number(area.x, 0, allowOutside ? -width : 0, allowOutside ? 100 : 100 - width),
      y: number(area.y, 0, allowOutside ? -height : 0, allowOutside ? 100 : 100 - height),
      width: width,
      height: height
    };
  }

  function normalizeBubbleArea(area) {
    area = area || {};
    var width = number(area.width, 78, 8, 100);
    var height = number(area.height, 18, 5, 100);
    return {
      x: number(area.x, 11, 0, 100 - width),
      y: number(area.y, 77, 0, 100 - height),
      width: width,
      height: height
    };
  }

  // Innerer Textbereich: Rechteck in PROZENT DER BUBBLE (nicht des Monitors).
  // Er begrenzt, wo der Text sitzt; die Schrift schrumpft automatisch, bis der
  // Text hineinpasst (bubbleFontSize bleibt die Obergrenze).
  function normalizeBubbleTextArea(area) {
    area = area || {};
    var width = number(area.width, 84, 10, 100);
    var height = number(area.height, 80, 10, 100);
    return {
      x: number(area.x, 8, 0, 100 - width),
      y: number(area.y, 10, 0, 100 - height),
      width: width,
      height: height
    };
  }

  // OBS-artiger Zuschnitt: Anteile (0-80 %) des UNbeschnittenen Videos, die
  // links/oben/rechts/unten abgeschnitten sind. videoArea bleibt das sichtbare
  // Rechteck; das Element wird auf das unbeschnittene Rechteck gesetzt und per
  // clip-path beschnitten (gleiche Rechnung wie in der Vorschau der Steuerseite).
  function normalizeVideoCrop(crop) {
    crop = crop || {};
    var left = number(crop.left, 0, 0, 80);
    var right = Math.min(number(crop.right, 0, 0, 80), 80 - left);
    var top = number(crop.top, 0, 0, 80);
    var bottom = Math.min(number(crop.bottom, 0, 0, 80), 80 - top);
    return { left: left, top: top, right: right, bottom: bottom };
  }

  function applyVideoGeometry(element, config) {
    if (!element || !config) return;
    element.style.position = 'fixed';
    if (config.freePosition) {
      var area = normalizeVideoArea(config.videoArea, config.freePositionOutside);
      var crop = normalizeVideoCrop(config.videoCrop);
      var hasCrop = !!(crop.left || crop.top || crop.right || crop.bottom);
      var wf = Math.max(0.2, 1 - (crop.left + crop.right) / 100);
      var hf = Math.max(0.2, 1 - (crop.top + crop.bottom) / 100);
      var width = hasCrop ? area.width / wf : area.width;
      var height = hasCrop ? area.height / hf : area.height;
      element.style.inset = 'auto';
      element.style.left = (hasCrop ? area.x - width * crop.left / 100 : area.x) + '%';
      element.style.top = (hasCrop ? area.y - height * crop.top / 100 : area.y) + '%';
      element.style.width = width + '%';
      element.style.height = height + '%';
      element.style.clipPath = hasCrop
        ? 'inset(' + crop.top + '% ' + crop.right + '% ' + crop.bottom + '% ' + crop.left + '%)'
        : '';
    } else {
      element.style.inset = '0';
      element.style.left = '';
      element.style.top = '';
      element.style.width = '100vw';
      element.style.height = '100vh';
      element.style.clipPath = '';
    }
  }

  function applyBubbleGeometry(element, config) {
    if (!element || !config) return;
    var area = normalizeBubbleArea(config.bubbleArea);
    element.style.position = 'fixed';
    element.style.inset = 'auto';
    element.style.left = area.x + '%';
    element.style.top = area.y + '%';
    element.style.width = area.width + '%';
    element.style.height = area.height + '%';
  }

  var ALIGN_POS = {
    center: '50% 50%',
    left: '0% 50%',
    right: '100% 50%',
    top: '50% 0%',
    bottom: '50% 100%'
  };
  function normalizeAlign(value) {
    value = String(value || 'center');
    return ALIGN_POS.hasOwnProperty(value) ? value : 'center';
  }

  var BUBBLE_FONT_FAMILIES = [
    'Segoe UI, sans-serif',
    'Arial, sans-serif',
    'Verdana, sans-serif',
    'Tahoma, sans-serif',
    'Georgia, serif',
    "'Times New Roman', serif",
    "'Courier New', monospace",
    'Consolas, monospace',
    'Impact, sans-serif',
    "'Comic Sans MS', cursive"
  ];
  var BUBBLE_TEXT_STYLES = ['normal', 'bold', 'italic', 'boldItalic', 'outline', 'glow'];
  var BUBBLE_ANIMATIONS = ['none', 'fade', 'fromTop', 'fromBottom', 'fromLeft', 'fromRight', 'zoom', 'bounce'];
  var BUBBLE_ANIMATION_UNITS = ['together', 'words', 'letters'];
  var BUBBLE_TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];
  var BUBBLE_TEXT_ALIGNS = ['left', 'center', 'right'];
  var BUBBLE_VERTICAL_ALIGNS = ['top', 'center', 'bottom'];
  function normalizeBubbleFontFamily(value) {
    value = String(value || '');
    return BUBBLE_FONT_FAMILIES.indexOf(value) >= 0 ? value : 'Segoe UI, sans-serif';
  }
  function normalizeBubbleTextStyle(value) {
    value = String(value || '');
    return BUBBLE_TEXT_STYLES.indexOf(value) >= 0 ? value : 'bold';
  }
  function normalizeBubbleAnimation(value) {
    value = String(value || '');
    return BUBBLE_ANIMATIONS.indexOf(value) >= 0 ? value : 'fade';
  }
  function normalizeBubbleAnimationUnit(value) {
    value = String(value || '');
    return BUBBLE_ANIMATION_UNITS.indexOf(value) >= 0 ? value : 'together';
  }
  function normalizeBubbleTextTransform(value) {
    value = String(value || '');
    return BUBBLE_TEXT_TRANSFORMS.indexOf(value) >= 0 ? value : 'none';
  }
  function normalizeBubbleTextAlign(value) {
    value = String(value || '');
    return BUBBLE_TEXT_ALIGNS.indexOf(value) >= 0 ? value : 'center';
  }
  function normalizeBubbleVerticalAlign(value) {
    value = String(value || '');
    return BUBBLE_VERTICAL_ALIGNS.indexOf(value) >= 0 ? value : 'center';
  }

  function normalizePath(value) {
    value = String(value || '').split('#')[0].split('?')[0].replace(/\\/g, '/').toLowerCase();
    try { value = decodeURIComponent(value); } catch (err) {}
    return value;
  }

  function pathsMatch(source, configured) {
    source = normalizePath(source);
    configured = normalizePath(configured);
    return !!(source && configured && (source === configured || source.slice(-configured.length) === configured));
  }

  function normalizeItem(item) {
    item = item || {};
    var freePositionOutside = !!item.freePositionOutside;
    return {
      id: String(item.id || item.videoPath || ''),
      name: String(item.name || 'Video-Overlay'),
      trigger: String(item.trigger || item.name || ''),
      triggerType: (item.triggerType === 'reward') ? 'reward' : 'custom',
      groupTrigger: String(item.groupTrigger || ''),
      videoPath: String(item.videoPath || ''),
      startSeconds: number(item.startSeconds, 0, 0, 86400),
      durationSeconds: number(item.durationSeconds, 0, 0, 86400),
      volume: number(item.volume, 100, 0, 100),
      removeBackground: !!item.removeBackground,
      keyColor: /^#[0-9a-f]{6}$/i.test(item.keyColor || '') ? item.keyColor : '#00ff00',
      tolerance: number(item.tolerance, 20, 0, 100),
      sideBars: item.sideBars !== false,
      align: normalizeAlign(item.align),
      freePosition: !!item.freePosition,
      freePositionOutside: freePositionOutside,
      videoArea: normalizeVideoArea(item.videoArea, freePositionOutside),
      videoCrop: normalizeVideoCrop(item.videoCrop),
      bubbleEnabled: !!item.bubbleEnabled,
      bubbleText: String(item.bubbleText || '').slice(0, 500),
      bubbleFontSize: number(item.bubbleFontSize, 48, 12, 160),
      bubbleFontFamily: normalizeBubbleFontFamily(item.bubbleFontFamily),
      bubbleTextStyle: normalizeBubbleTextStyle(item.bubbleTextStyle),
      bubbleTextColor: /^#[0-9a-f]{6}$/i.test(item.bubbleTextColor || '') ? String(item.bubbleTextColor).toLowerCase() : '#ffffff',
      bubbleAnimation: normalizeBubbleAnimation(item.bubbleAnimation),
      bubbleAnimationUnit: normalizeBubbleAnimationUnit(item.bubbleAnimationUnit),
      bubbleAnimationDuration: number(item.bubbleAnimationDuration, 0.7, 0.2, 3),
      bubbleReadFromFile: !!item.bubbleReadFromFile,
      bubbleTextFile: String(item.bubbleTextFile || ''),
      bubbleAntialias: item.bubbleAntialias !== false,
      bubbleTextTransform: normalizeBubbleTextTransform(item.bubbleTextTransform),
      bubbleVertical: !!item.bubbleVertical,
      bubbleTextOpacity: number(item.bubbleTextOpacity, 100, 0, 100),
      bubbleGradientEnabled: !!item.bubbleGradientEnabled,
      bubbleGradientColor: /^#[0-9a-f]{6}$/i.test(item.bubbleGradientColor || '') ? String(item.bubbleGradientColor).toLowerCase() : '#000000',
      bubbleGradientOpacity: number(item.bubbleGradientOpacity, 0, 0, 100),
      bubbleGradientAngle: number(item.bubbleGradientAngle, 90, 0, 360),
      bubbleTextAlign: normalizeBubbleTextAlign(item.bubbleTextAlign),
      bubbleVerticalAlign: normalizeBubbleVerticalAlign(item.bubbleVerticalAlign),
      bubbleOutlineEnabled: !!item.bubbleOutlineEnabled,
      bubbleOutlineColor: /^#[0-9a-f]{6}$/i.test(item.bubbleOutlineColor || '') ? String(item.bubbleOutlineColor).toLowerCase() : '#000000',
      bubbleOutlineSize: number(item.bubbleOutlineSize, 2, 1, 12),
      bubbleChatlogEnabled: !!item.bubbleChatlogEnabled,
      bubbleChatlogLines: Math.round(number(item.bubbleChatlogLines, 6, 1, 20)),
      bubbleLayer: item.bubbleLayer === 'behind' ? 'behind' : 'above',
      bubbleAssetPath: String(item.bubbleAssetPath || ''),
      bubbleArea: normalizeBubbleArea(item.bubbleArea),
      bubbleTextAreaOn: !!item.bubbleTextAreaOn,
      bubbleTextArea: normalizeBubbleTextArea(item.bubbleTextArea),
      bubbleTextOnly: !!item.bubbleTextOnly,
      enabled: item.enabled !== false,
      managed: item.managed !== false,
      sourceFile: String(item.sourceFile || '')
    };
  }

  function clearDurationTimer(video) {
    if (video && video.__kappiDurationTimer) clearTimeout(video.__kappiDurationTimer);
    if (video) video.__kappiDurationTimer = 0;
  }

  function bubbleMediaUrl(path) {
    path = String(path || '').trim();
    if (!path) return '';
    if (/^(?:https?:|file:|data:|blob:)/i.test(path)) return path;
    var normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    var parts = normalized.split('/');
    for (var i = 0; i < parts.length; i++) parts[i] = encodeURIComponent(parts[i]);
    return location.origin + '/content/' + parts.join('/');
  }

  function bubbleTemplateVariables(source) {
    var values = Object.create(null);
    var seen = [];
    function store(key, value) {
      key = String(key || '').trim();
      if (!key) return;
      var normalized = key.toLowerCase();
      if (values[normalized] == null) values[normalized] = value;
    }
    function printable(value) {
      if (value == null) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
      try { return JSON.stringify(value); } catch (err) { return String(value); }
    }
    function visit(value, path, depth) {
      if (depth > 8) return;
      if (value == null || typeof value !== 'object') {
        var shown = printable(value);
        store(path, shown);
        var dot = path.lastIndexOf('.');
        if (dot >= 0) store(path.slice(dot + 1), shown);
        return;
      }
      if (seen.indexOf(value) >= 0) return;
      seen.push(value);
      if (path) store(path, printable(value));
      if (Array.isArray(value)) {
        for (var ai = 0; ai < value.length; ai++) visit(value[ai], path ? path + '.' + ai : String(ai), depth + 1);
      } else {
        for (var key in value) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
          visit(value[key], path ? path + '.' + key : key, depth + 1);
        }
      }
    }
    visit(source || {}, '', 0);
    function firstUseful(keys) {
      for (var i = 0; i < keys.length; i++) {
        var candidate = values[keys[i]];
        if (candidate == null) continue;
        candidate = String(candidate).trim();
        if (candidate && candidate !== '[object Object]' && candidate.charAt(0) !== '{') return candidate;
      }
      return '';
    }
    // Streamer.bot benennt den Zuschauer je nach Trigger unterschiedlich. Für die
    // Bubble sind diese Varianten absichtlich gleichbedeutend und ohne Beachtung
    // der Groß-/Kleinschreibung nutzbar (%User%, %user%, %USERNAME% usw.).
    var resolvedUser = firstUseful([
      'username', 'user.name', 'user.displayname', 'displayname',
      'userlogin', 'user.login', 'user_name', 'user_login', 'login', 'user'
    ]);
    // Der Core-Test-Trigger besitzt laut Streamer.bot keinen Zuschauer, sondern nur
    // isTest=true. Damit die Vorschau trotzdem eindeutig zeigt, dass die Ersetzung
    // funktioniert, wird in diesem Sonderfall "Test" eingesetzt.
    if (!resolvedUser && String(values.istest || '').toLowerCase() === 'true') resolvedUser = 'Test';
    if (resolvedUser) {
      values.user = resolvedUser;
      if (values.username == null) values.username = resolvedUser;
      if (values.displayname == null) values.displayname = resolvedUser;
      if (values.userlogin == null) values.userlogin = resolvedUser;
    }
    return values;
  }

  function renderBubbleTemplate(template, source) {
    template = String(template || '');
    var values = bubbleTemplateVariables(source);
    function replace(match, key) {
      var normalized = String(key || '').trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(values, normalized) ? values[normalized] : match;
    }
    // Streamer.bot-Schreibweise %variable% sowie die gut lesbare Alternative
    // {{variable}}. Verschachtelte Werte gehen als %reward.title% usw.
    return template
      .replace(/%([A-Za-z_][A-Za-z0-9_.:-]*)%/g, replace)
      .replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, replace);
  }

  function removeVideoBubble(video) {
    if (!video) return;
    var bubble = video.__kappiBubble;
    if (bubble) {
      var assetVideo = bubble.querySelector && bubble.querySelector('video[data-kappi-bubble-asset="1"]');
      try { if (assetVideo) assetVideo.pause(); } catch (err) {}
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }
    video.__kappiBubble = null;
  }

  // Waisen-Kehrer: Bubbles haengen direkt am document.body und sind nur ueber
  // ihr Video-Element verknuepft. Entfernt ein fremder Pfad (z. B. eine alte
  // Effekt-Datei) das Video direkt aus dem DOM, bliebe die Bubble sonst fuer
  // immer sichtbar stehen. Laeuft deshalb bei jedem Settings-Poll mit.
  function sweepOrphanBubbles() {
    var bubbles = document.querySelectorAll('[data-kappi-video-bubble="1"]');
    for (var i = 0; i < bubbles.length; i++) {
      var bubble = bubbles[i];
      var owner = bubble.__kappiOwnerVideo;
      if (owner && owner.isConnected && owner.__kappiBubble === bubble) continue;
      var assetVideo = bubble.querySelector && bubble.querySelector('video');
      try { if (assetVideo) assetVideo.pause(); } catch (err) {}
      if (owner && owner.__kappiBubble === bubble) owner.__kappiBubble = null;
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }
  }

  // --- Ausblende-Animation kurz vor dem Video-Ende ---
  // Der Bubble-Text verschwindet nicht mehr abrupt mit dem Video, sondern
  // blendet mit der eingestellten Einblendanimation RUECKWAERTS aus (Start:
  // eine Animationsdauer vor dem wirksamen Ende). Selbstheilend: springt die
  // Abspielposition wieder vor das Ausblendefenster (Replay/Neustart), wird
  // die Animation abgebrochen und die Bubble ist sofort wieder voll sichtbar.
  function cancelBubbleExit(video) {
    var bubble = video && video.__kappiBubble;
    if (!bubble || !bubble.__kappiExitStarted) return;
    bubble.__kappiExitStarted = false;
    try { if (bubble.__kappiExitAnim) bubble.__kappiExitAnim.cancel(); } catch (err) {}
    bubble.__kappiExitAnim = null;
  }
  function maybeStartBubbleExit(video, config) {
    var bubble = video && video.__kappiBubble;
    if (!bubble || bubble.__kappiExitStarted || !config) return;
    bubble.__kappiExitStarted = true;
    var animation = normalizeBubbleAnimation(config.bubbleAnimation);
    // Ohne Einblendanimation bleibt es beim bisherigen Verhalten (hart weg).
    if (animation === 'none' || typeof bubble.animate !== 'function') return;
    var durationMs = Math.round(number(config.bubbleAnimationDuration, 0.7, 0.2, 3) * 1000);
    var frames = bubbleAnimationFrames(animation, 80).slice().reverse();
    bubble.__kappiExitAnim = bubble.animate(frames, {
      duration: durationMs,
      easing: 'cubic-bezier(.55,.06,.68,.19)',
      fill: 'forwards'
    });
  }

  function applyVideoBubbleLayer(video, bubble, config) {
    if (!video || !bubble || !config) return;
    var videoLayer = 1200;
    try {
      var computed = window.getComputedStyle ? window.getComputedStyle(video) : null;
      var parsed = computed ? parseInt(computed.zIndex, 10) : NaN;
      if (isFinite(parsed)) videoLayer = parsed;
    } catch (err) {}
    var bubbleLayer = config.bubbleLayer === 'behind'
      ? Math.max(0, videoLayer - 1)
      : videoLayer + 1;
    // overlay-layers.js setzt die globale Videoebene mit !important. Darum muss
    // auch die relative Bubble-Ebene als Inline-!important gesetzt werden.
    bubble.style.setProperty('z-index', String(bubbleLayer), 'important');
  }

  function hexToBubbleRgba(value, opacity) {
    value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';
    opacity = number(opacity, 100, 0, 100) / 100;
    return 'rgba('
      + parseInt(value.slice(1, 3), 16) + ','
      + parseInt(value.slice(3, 5), 16) + ','
      + parseInt(value.slice(5, 7), 16) + ','
      + opacity.toFixed(3) + ')';
  }

  function transformBubbleText(value, config) {
    value = String(value || '');
    var transform = normalizeBubbleTextTransform(config && config.bubbleTextTransform);
    if (transform === 'uppercase') return value.toUpperCase();
    if (transform === 'lowercase') return value.toLowerCase();
    if (transform === 'capitalize') {
      return value.replace(/(^|[\s\-–—])([^\s\-–—])/g, function (match, before, letter) {
        return before + letter.toUpperCase();
      });
    }
    return value;
  }

  function applyBubbleTextAppearance(textElement, config) {
    if (!textElement || !config) return;
    var style = normalizeBubbleTextStyle(config.bubbleTextStyle);
    var textColor = /^#[0-9a-f]{6}$/i.test(config.bubbleTextColor || '') ? config.bubbleTextColor : '#ffffff';
    var primaryColor = hexToBubbleRgba(textColor, config.bubbleTextOpacity);
    var gradientColor = /^#[0-9a-f]{6}$/i.test(config.bubbleGradientColor || '') ? config.bubbleGradientColor : '#000000';
    textElement.style.fontFamily = normalizeBubbleFontFamily(config.bubbleFontFamily);
    textElement.style.fontSize = number(config.bubbleFontSize, 48, 12, 160) + 'px';
    textElement.style.color = primaryColor;
    textElement.style.backgroundImage = config.bubbleGradientEnabled
      ? 'linear-gradient(' + number(config.bubbleGradientAngle, 90, 0, 360) + 'deg,' + primaryColor + ',' + hexToBubbleRgba(gradientColor, config.bubbleGradientOpacity) + ')'
      : 'none';
    textElement.style.backgroundClip = config.bubbleGradientEnabled ? 'text' : 'border-box';
    textElement.style.webkitBackgroundClip = config.bubbleGradientEnabled ? 'text' : 'border-box';
    textElement.style.webkitTextFillColor = config.bubbleGradientEnabled ? 'transparent' : primaryColor;
    textElement.style.fontWeight = (style === 'normal' || style === 'italic') ? '500' : '800';
    textElement.style.fontStyle = (style === 'italic' || style === 'boldItalic') ? 'italic' : 'normal';
    var outlineEnabled = style === 'outline' || !!config.bubbleOutlineEnabled;
    var outlineColor = /^#[0-9a-f]{6}$/i.test(config.bubbleOutlineColor || '') ? config.bubbleOutlineColor : '#000000';
    var outlineSize = number(config.bubbleOutlineSize, style === 'outline' ? 2 : 1, 1, 12);
    textElement.style.webkitTextStroke = outlineEnabled ? outlineSize + 'px ' + outlineColor : '0 transparent';
    textElement.style.paintOrder = outlineEnabled ? 'stroke fill' : 'normal';
    textElement.style.textShadow = style === 'glow'
      ? '0 0 5px #fff, 0 0 13px rgba(167,98,255,.95), 0 0 25px rgba(108,74,255,.8)'
      : '0 2px 7px rgba(0,0,0,.85)';
    textElement.style.webkitFontSmoothing = config.bubbleAntialias === false ? 'none' : 'antialiased';
    textElement.style.textRendering = config.bubbleAntialias === false ? 'optimizeSpeed' : 'geometricPrecision';
    textElement.style.writingMode = config.bubbleVertical ? 'vertical-rl' : 'horizontal-tb';
    textElement.style.textOrientation = config.bubbleVertical ? 'mixed' : 'initial';
    textElement.style.textAlign = normalizeBubbleTextAlign(config.bubbleTextAlign);
    textElement.style.whiteSpace = 'pre-wrap';
  }

  function bubbleAnimationFrames(animation, distance) {
    distance = Math.max(12, number(distance, 80, 12, 240));
    if (animation === 'fromTop') return [
      { opacity: 0, transform: 'translateY(-' + distance + 'px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ];
    if (animation === 'fromBottom') return [
      { opacity: 0, transform: 'translateY(' + distance + 'px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ];
    if (animation === 'fromLeft') return [
      { opacity: 0, transform: 'translateX(-' + distance + 'px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ];
    if (animation === 'fromRight') return [
      { opacity: 0, transform: 'translateX(' + distance + 'px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ];
    if (animation === 'zoom') return [
      { opacity: 0, transform: 'scale(.2)' },
      { opacity: 1, transform: 'scale(1)' }
    ];
    if (animation === 'bounce') return [
      { opacity: 0, transform: 'translateY(-' + distance + 'px) scale(.72)' },
      { opacity: 1, transform: 'translateY(12px) scale(1.08)', offset: 0.72 },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ];
    return [{ opacity: 0 }, { opacity: 1 }];
  }

  function renderAnimatedBubbleText(textElement, value, config) {
    if (!textElement || !config) return;
    value = String(value || '');
    var animation = normalizeBubbleAnimation(config.bubbleAnimation);
    var unit = normalizeBubbleAnimationUnit(config.bubbleAnimationUnit);
    var durationMs = Math.round(number(config.bubbleAnimationDuration, 0.7, 0.2, 3) * 1000);
    var signature = [value, animation, unit, durationMs].join('\u001f');
    if (textElement.__kappiBubbleAnimationSignature === signature) return;
    textElement.__kappiBubbleAnimationSignature = signature;
    try {
      var oldAnimations = textElement.getAnimations ? textElement.getAnimations({ subtree: true }) : [];
      for (var ai = 0; ai < oldAnimations.length; ai++) oldAnimations[ai].cancel();
    } catch (err) {}
    textElement.textContent = '';

    var targets = [];
    if (animation === 'none' || unit === 'together') {
      textElement.textContent = value;
      targets.push(textElement);
    } else {
      var parts = unit === 'words' ? value.split(/(\s+)/) : Array.from(value);
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          textElement.appendChild(document.createTextNode(part));
          continue;
        }
        var segment = document.createElement('span');
        segment.setAttribute('data-kappi-video-bubble-segment', '1');
        segment.style.display = 'inline-block';
        segment.style.whiteSpace = 'pre';
        segment.textContent = part;
        textElement.appendChild(segment);
        targets.push(segment);
      }
    }
    if (animation === 'none' || typeof textElement.animate !== 'function') return;

    var frames = bubbleAnimationFrames(animation, 80);
    var stagger = unit === 'words' ? Math.min(220, durationMs * 0.28)
      : (unit === 'letters' ? Math.min(90, durationMs * 0.1) : 0);
    for (var ti = 0; ti < targets.length; ti++) {
      targets[ti].animate(frames, {
        duration: durationMs,
        delay: Math.round(ti * stagger),
        easing: animation === 'bounce' ? 'cubic-bezier(.2,.82,.25,1)' : 'cubic-bezier(.2,.75,.25,1)',
        fill: 'backwards'
      });
    }
  }

  // --- Streamer.bot-Globals fuer Bubble-Tokens ({{sb:Name}} / {{sb-temp:Name}}) ---
  // Gleiches Muster wie bei den Notizen (endgame-cheatsheet.js): der vorhandene
  // window.client wird mitbenutzt. Im Overlay wird ein unbekanntes Token nie
  // technisch angezeigt, sondern leer gelassen.
  var bubbleGlobals = { persisted: {}, temporary: {} };
  var bubbleGlobalsBusy = false;
  var bubbleGlobalsBound = false;
  function normalizeGlobalSet(source) {
    var result = {};
    if (Object.prototype.toString.call(source) === '[object Array]') {
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
  function globalValueText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (err) { return String(value); }
  }
  function refreshBubbleGlobals() {
    var c = window.client;
    if (bubbleGlobalsBusy || !c || typeof c.getGlobals !== 'function') return false;
    if (typeof c.ready !== 'undefined' && !c.ready) return false;
    bubbleGlobalsBusy = true;
    Promise.all([c.getGlobals(true), c.getGlobals(false)]).then(function (responses) {
      bubbleGlobals.persisted = normalizeGlobalSet(responses[0] && (responses[0].variables || responses[0]));
      bubbleGlobals.temporary = normalizeGlobalSet(responses[1] && (responses[1].variables || responses[1]));
    }).catch(function () {}).then(function () { bubbleGlobalsBusy = false; });
    return true;
  }
  function bindBubbleGlobalEvents() {
    if (bubbleGlobalsBound || !window.client || typeof window.client.on !== 'function') return false;
    bubbleGlobalsBound = true;
    window.client.on('Misc.GlobalVariableCreated', refreshBubbleGlobals);
    window.client.on('Misc.GlobalVariableUpdated', refreshBubbleGlobals);
    window.client.on('Misc.GlobalVariableDeleted', refreshBubbleGlobals);
    return true;
  }
  function resolveBubbleGlobals(raw) {
    return String(raw || '').replace(/\{\{(sb|sb-temp):([^{}\r\n]+)\}\}/g, function (token, kind, name) {
      name = String(name || '').trim();
      var bucket = kind === 'sb-temp' ? bubbleGlobals.temporary : bubbleGlobals.persisted;
      return Object.prototype.hasOwnProperty.call(bucket, name) ? globalValueText(bucket[name]) : '';
    });
  }

  function bubbleDisplayText(video, config, rawValue) {
    // Erst SB-Globals ({{sb:...}}) aufloesen, danach die Ereignis-Platzhalter
    // (%var%/{{var}}) aus der Trigger-Payload - so kollidieren beide Formen nicht.
    var resolved = transformBubbleText(renderBubbleTemplate(resolveBubbleGlobals(rawValue), video && video.__kappiTemplateData), config);
    if (!config.bubbleChatlogEnabled) return resolved;
    var key = String(config.id || config.trigger || config.videoPath || 'default');
    var generation = Number(video && video.__kappiGeneration || 0);
    var history = bubbleChatlogHistory[key] || (bubbleChatlogHistory[key] = []);
    var found = false;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].generation === generation) {
        history[i].text = resolved;
        found = true;
        break;
      }
    }
    if (!found) history.push({ generation: generation, text: resolved });
    if (history.length > 20) history.splice(0, history.length - 20);
    var limit = Math.round(number(config.bubbleChatlogLines, 6, 1, 20));
    return history.slice(-limit).map(function (entry) { return entry.text; }).join('\n');
  }

  // Auto-Fit: verkleinert die Schrift stufenweise, bis der Text in den
  // aktiven Textbereich passt (z. B. sehr lange Usernamen nach %user%).
  // bubbleFontSize ist die Obergrenze; applyBubbleTextAppearance setzt sie bei
  // jedem Aufruf zurueck, daher gibt es keinen Ratchet-Effekt ueber die Polls.
  function fitBubbleTextToArea(config, textElement) {
    if (!config || !config.bubbleTextAreaOn || !textElement) return;
    var box = textElement.parentNode;
    if (!box || !box.getAttribute || box.getAttribute('data-kappi-video-bubble-textbox') !== '1') return;
    var size = number(config.bubbleFontSize, 48, 12, 160);
    textElement.style.fontSize = size + 'px';
    var guard = 0;
    while (size > 8 && guard < 200 && (box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1)) {
      size -= 1;
      guard += 1;
      textElement.style.fontSize = size + 'px';
    }
  }

  function showBubbleText(video, config, textElement, rawValue) {
    if (!video || !config || !textElement) return;
    applyBubbleTextAppearance(textElement, config);
    renderAnimatedBubbleText(textElement, bubbleDisplayText(video, config, rawValue), config);
    fitBubbleTextToArea(config, textElement);
  }

  function refreshBubbleTextFile(video, config, textElement) {
    var path = String(config && config.bubbleTextFile || '').trim();
    if (!video || !config || !textElement || !config.bubbleReadFromFile || !path || typeof fetch !== 'function') return;
    var requestKey = path + '\u001f' + String(video.__kappiGeneration || 0);
    if (textElement.__kappiBubbleTextFileRequest === requestKey) return;
    textElement.__kappiBubbleTextFileRequest = requestKey;
    fetch(bubbleMediaUrl(path), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (value) {
        if (!video.__kappiBubble || textElement.__kappiBubbleTextFileRequest !== requestKey) return;
        showBubbleText(video, config, textElement, String(value || '').slice(0, 10000));
      })
      .catch(function () {
        // Bei einer vorübergehend nicht lesbaren Datei bleibt der manuell
        // eingetragene Text als sichtbarer Fallback erhalten.
      });
  }

  function applyVideoBubble(video, config) {
    if (!video || !config || !config.bubbleEnabled) {
      removeVideoBubble(video);
      return;
    }
    var bubble = video.__kappiBubble;
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.setAttribute('data-kappi-video-bubble', '1');
      bubble.style.display = 'flex';
      bubble.style.alignItems = 'flex-end';
      bubble.style.justifyContent = 'center';
      bubble.style.boxSizing = 'border-box';
      bubble.style.padding = '0';
      bubble.style.overflow = 'hidden';
      bubble.style.pointerEvents = 'none';

      var card = document.createElement('div');
      card.setAttribute('data-kappi-video-bubble-card', '1');
      card.style.position = 'relative';
      card.style.display = 'grid';
      card.style.placeItems = 'center';
      card.style.width = '100%';
      card.style.height = '100%';
      card.style.minHeight = '0';
      card.style.boxSizing = 'border-box';
      card.style.overflow = 'hidden';
      card.style.padding = '14px 20px';
      card.style.border = '1px solid rgba(138,180,248,.65)';
      card.style.borderRadius = '22px';
      card.style.background = 'rgba(8,11,20,.62)';
      card.style.boxShadow = '0 10px 34px rgba(0,0,0,.42)';
      card.style.backdropFilter = 'blur(10px)';

      // Der Text sitzt in einem eigenen absoluten Textbereich-Container: ohne
      // aktiven Textbereich fuellt er die Karte (inkl. altem Karten-Innenabstand),
      // mit aktivem Bereich bekommt er das konfigurierte Teil-Rechteck der Bubble.
      var textbox = document.createElement('div');
      textbox.setAttribute('data-kappi-video-bubble-textbox', '1');
      textbox.style.position = 'absolute';
      textbox.style.display = 'grid';
      textbox.style.placeItems = 'center';
      textbox.style.boxSizing = 'border-box';
      textbox.style.overflow = 'hidden';
      textbox.style.zIndex = '2';
      textbox.style.left = '0';
      textbox.style.top = '0';
      textbox.style.width = '100%';
      textbox.style.height = '100%';
      textbox.style.padding = '14px 20px';
      textbox.style.pointerEvents = 'none';

      var text = document.createElement('span');
      text.setAttribute('data-kappi-video-bubble-text', '1');
      text.style.position = 'relative';
      text.style.zIndex = '2';
      text.style.display = 'inline-block';
      text.style.lineHeight = '1.25';
      text.style.textAlign = 'center';
      text.style.textShadow = '0 2px 7px rgba(0,0,0,.85)';
      text.style.overflowWrap = 'anywhere';
      textbox.appendChild(text);
      card.appendChild(textbox);
      bubble.appendChild(card);
      // Besitzer-Verknuepfung fuer den Waisen-Kehrer (sweepOrphanBubbles).
      bubble.__kappiOwnerVideo = video;
      document.body.appendChild(bubble);
      video.__kappiBubble = bubble;
    }

    applyBubbleGeometry(bubble, config);
    applyVideoBubbleLayer(video, bubble, config);
    var cardElement = bubble.querySelector('[data-kappi-video-bubble-card="1"]');
    var textboxElement = bubble.querySelector('[data-kappi-video-bubble-textbox="1"]');
    var textElement = bubble.querySelector('[data-kappi-video-bubble-text="1"]');
    if (textboxElement) {
      // Geometrie VOR dem Text-Rendern setzen, damit die Auto-Fit-Messung in
      // showBubbleText bereits gegen den richtigen Bereich rechnet.
      if (config.bubbleTextAreaOn) {
        var textArea = normalizeBubbleTextArea(config.bubbleTextArea);
        textboxElement.style.left = textArea.x + '%';
        textboxElement.style.top = textArea.y + '%';
        textboxElement.style.width = textArea.width + '%';
        textboxElement.style.height = textArea.height + '%';
        textboxElement.style.padding = '0';
      } else {
        textboxElement.style.left = '0';
        textboxElement.style.top = '0';
        textboxElement.style.width = '100%';
        textboxElement.style.height = '100%';
        textboxElement.style.padding = '14px 20px';
      }
      var horizontal = normalizeBubbleTextAlign(config.bubbleTextAlign);
      var vertical = normalizeBubbleVerticalAlign(config.bubbleVerticalAlign);
      textboxElement.style.justifyItems = horizontal === 'left' ? 'start' : (horizontal === 'right' ? 'end' : 'center');
      textboxElement.style.alignItems = vertical === 'top' ? 'start' : (vertical === 'bottom' ? 'end' : 'center');
    }
    if (textElement) {
      showBubbleText(video, config, textElement, config.bubbleText);
      refreshBubbleTextFile(video, config, textElement);
    }
    var assetPath = String(config.bubbleAssetPath || '');
    var oldPath = String(cardElement && cardElement.getAttribute('data-asset-path') || '');
    if (cardElement && oldPath !== assetPath) {
      var oldAsset = cardElement.querySelector('[data-kappi-video-bubble-visual="1"]');
      if (oldAsset) {
        try { if (oldAsset.tagName === 'VIDEO') oldAsset.pause(); } catch (err) {}
        oldAsset.remove();
      }
      cardElement.setAttribute('data-asset-path', assetPath);
      if (assetPath) {
        var asset;
        if (/\.html?(?:[?#].*)?$/i.test(assetPath)) {
          asset = document.createElement('iframe');
          // Fremde HTML-Bubbles dürfen animieren, aber weder die FreakShow-Seite
          // noch deren Bridge-Daten auslesen.
          asset.setAttribute('sandbox', 'allow-scripts');
          asset.setAttribute('aria-hidden', 'true');
        } else if (/\.webm(?:[?#].*)?$/i.test(assetPath)) {
          asset = document.createElement('video');
          asset.muted = true;
          asset.autoplay = true;
          asset.loop = true;
          asset.playsInline = true;
          asset.setAttribute('data-kappi-bubble-asset', '1');
        }
        if (asset) {
          asset.setAttribute('data-kappi-video-bubble-visual', '1');
          asset.style.position = 'absolute';
          asset.style.inset = '0';
          asset.style.width = '100%';
          asset.style.height = '100%';
          asset.style.border = '0';
          asset.style.objectFit = 'fill';
          asset.style.pointerEvents = 'none';
          asset.src = bubbleMediaUrl(assetPath);
          cardElement.insertBefore(asset, textboxElement);
          if (asset.tagName === 'VIDEO') {
            var promise = asset.play();
            if (promise && typeof promise.catch === 'function') promise.catch(function () {});
          }
        }
      }
    }
    if (cardElement) {
      // "Nur Text": komplette Bubble-Optik aus - auch eine gesetzte Bubble-Datei
      // wird verborgen; es bleibt nur der Text an seiner Position sichtbar.
      var plainBubble = !!config.bubbleTextOnly;
      var visualElement = cardElement.querySelector('[data-kappi-video-bubble-visual="1"]');
      if (visualElement) visualElement.style.display = plainBubble ? 'none' : '';
      var bareCard = plainBubble || !!assetPath;
      cardElement.style.background = bareCard ? 'transparent' : 'rgba(8,11,20,.62)';
      cardElement.style.borderColor = bareCard ? 'transparent' : 'rgba(138,180,248,.65)';
      cardElement.style.boxShadow = bareCard ? 'none' : '0 10px 34px rgba(0,0,0,.42)';
      cardElement.style.backdropFilter = bareCard ? 'none' : 'blur(10px)';
    }
  }

  function removeWarmReference(video) {
    if (!video) return;
    var id = String(video.getAttribute('data-kappi-video-id') || '');
    if (id && warmPlayers[id] === video) delete warmPlayers[id];
    warmOrder = warmOrder.filter(function (entry) { return entry !== id; });
  }

  function discardVideo(video) {
    if (!video) return;
    removeWarmReference(video);
    clearDurationTimer(video);
    removeVideoBubble(video);
    try { video.pause(); } catch (err) {}
    try {
      video.muted = true;
      video.volume = 0;
      video.removeAttribute('src');
      video.load(); // bricht auch eine noch laufende Range-Anfrage ab
    } catch (err) {}
    try { removeChromaCanvas(video); } catch (err) {}
    video.__kappiVideoConfig = null;
    video.__kappiTemplateData = null;
    video.__kappiGeneration = 0;
    if (activeVideo === video) activeVideo = null;
    if (video.parentNode) video.parentNode.removeChild(video);
  }

  function trimWarmPlayers() {
    while (warmOrder.length > MAX_WARM_PLAYERS) {
      var oldestId = warmOrder.pop();
      var oldest = warmPlayers[oldestId];
      delete warmPlayers[oldestId];
      discardVideo(oldest);
    }
  }

  function isFullyBuffered(video) {
    if (!video || video.error || video.readyState < 4) return false;
    var duration = Number(video.duration);
    if (!(duration > 0) || !isFinite(duration)) return false;
    try {
      if (!video.buffered || !video.buffered.length) return false;
      return video.buffered.end(video.buffered.length - 1) >= duration - 0.25;
    } catch (err) { return false; }
  }

  function parkWarmVideo(video, config) {
    if (!video || !config || !config.id || video.error) {
      discardVideo(video);
      return;
    }
    var id = String(config.id);
    var previous = warmPlayers[id];
    if (previous && previous !== video) discardVideo(previous);
    clearDurationTimer(video);
    removeVideoBubble(video);
    try { video.pause(); } catch (err) {}
    try {
      video.muted = true;
      video.volume = 0;
      video.currentTime = Math.max(0, config.startSeconds || 0);
    } catch (err) {}
    removeChromaCanvas(video);
    video.style.display = 'none';
    video.setAttribute('data-kappi-warm', '1');
    video.setAttribute('data-kappi-video-id', id);
    video.__kappiVideoConfig = null;
    video.__kappiTemplateData = null;
    video.__kappiGeneration = 0;
    if (activeVideo === video) activeVideo = null;
    warmPlayers[id] = video;
    warmOrder = warmOrder.filter(function (entry) { return entry !== id; });
    warmOrder.unshift(id);
    trimWarmPlayers();
  }

  function takeWarmVideo(config) {
    var id = String(config && config.id || '');
    var video = id ? warmPlayers[id] : null;
    if (!video) return null;
    if (video.error) {
      discardVideo(video);
      return null;
    }
    delete warmPlayers[id];
    warmOrder = warmOrder.filter(function (entry) { return entry !== id; });
    video.removeAttribute('data-kappi-warm');
    return video;
  }

  function setPlaybackPhase(video, phase) {
    if (!video || video.__kappiGeneration !== playbackGeneration) return;
    playbackStatus.phase = phase;
    if (phase === 'playing') playbackStatus.playingAt = Date.now();
  }

  function finishManagedVideo(video) {
    if (!video) return;
    var config = video.__kappiVideoConfig;
    var isCurrent = video.__kappiGeneration === playbackGeneration;
    if (isCurrent) {
      playbackStatus.phase = 'idle';
      activeVideo = null;
    }
    // Nur ein wirklich vollstaendig gepuffertes Video behalten. readyState >= 2
    // reicht nicht: dann kann im Hintergrund weiterhin eine grosse Range-Anfrage laufen.
    if (config && isFullyBuffered(video)) parkWarmVideo(video, config);
    else discardVideo(video);
  }

  function findForVideo(video) {
    var forcedId = video.getAttribute('data-kappi-video-id') || '';
    var source = normalizePath(video.currentSrc || video.src || video.getAttribute('src'));
    for (var i = 0; i < items.length; i++) {
      if (!items[i].enabled) continue;
      if (forcedId && items[i].id === forcedId) return items[i];
      var configured = normalizePath(items[i].videoPath);
      if (configured && source && (source === configured || source.slice(-configured.length) === configured)) return items[i];
    }
    return null;
  }

  function hexRgb(hex) {
    var value = parseInt(String(hex || '#00ff00').slice(1), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function removeChromaCanvas(video) {
    if (video.__kappiChromaFrame) cancelAnimationFrame(video.__kappiChromaFrame);
    video.__kappiChromaFrame = 0;
    if (video.__kappiChromaCanvas && video.__kappiChromaCanvas.parentNode) {
      video.__kappiChromaCanvas.parentNode.removeChild(video.__kappiChromaCanvas);
    }
    video.__kappiChromaCanvas = null;
    video.style.opacity = video.__kappiOriginalOpacity || '';
  }

  function startChroma(video, config) {
    if (!config.removeBackground) {
      removeChromaCanvas(video);
      return;
    }

    var canvas = video.__kappiChromaCanvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'kappi-video-chroma-canvas';
      canvas.style.cssText = video.style.cssText;
      canvas.style.pointerEvents = 'none';
      canvas.style.background = 'transparent';
      video.__kappiOriginalOpacity = video.style.opacity || '';
      // Rohvideo NICHT sofort verstecken - erst wenn der Chroma-Canvas den ersten
      // Frame gezeichnet hat. Sonst waere das Video unsichtbar (aber hoerbar),
      // falls der Canvas verzoegert startet (z.B. erster Durchlauf nach Neustart).
      if (video.parentNode) video.parentNode.insertBefore(canvas, video.nextSibling);
      video.__kappiChromaCanvas = canvas;
    }

    if (video.__kappiChromaFrame) return;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    // Chroma NICHT in voller Auflösung rechnen: das freigestellte Bild wird per CSS ohnehin
    // auf Bildschirmgröße skaliert. Bei ~960px ist die Qualität praktisch gleich, aber
    // getImageData + Pixel-Schleife laufen um ein Vielfaches schneller (kein CPU-Stau, kein
    // Maus-Ruckeln, das Bild kommt sofort). Bei 5K-Videos ist der Unterschied riesig.
    var MAX_CHROMA_W = 960;

    function draw() {
      if (!video.isConnected || !canvas.isConnected || !config.removeBackground) {
        removeChromaCanvas(video);
        return;
      }
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        var vw = video.videoWidth, vh = video.videoHeight;
        var s = Math.min(1, MAX_CHROMA_W / vw);
        var cw = Math.max(1, Math.round(vw * s));
        var ch = Math.max(1, Math.round(vh * s));
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        try {
          context.clearRect(0, 0, cw, ch);
          context.drawImage(video, 0, 0, cw, ch);
          var frame = context.getImageData(0, 0, cw, ch);
          var key = hexRgb(config.keyColor);
          var threshold = config.tolerance * 4.42;
          var thr2 = threshold * threshold; // quadriert vergleichen -> kein teures Math.sqrt pro Pixel
          var d = frame.data;
          for (var p = 0; p < d.length; p += 4) {
            var dr = d[p] - key.r;
            var dg = d[p + 1] - key.g;
            var db = d[p + 2] - key.b;
            if (dr * dr + dg * dg + db * db <= thr2) d[p + 3] = 0;
          }
          context.putImageData(frame, 0, 0);
          // Ab dem ersten gezeichneten Frame das Rohvideo verstecken (Canvas uebernimmt).
          if (video.style.opacity !== '0') video.style.opacity = '0';
        } catch (err) {
          removeChromaCanvas(video);
          return;
        }
      }
      video.__kappiChromaFrame = requestAnimationFrame(draw);
    }

    video.__kappiChromaFrame = requestAnimationFrame(draw);
  }

  function applyToVideo(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    if (video.getAttribute('data-kappi-bubble-asset') === '1') return;
    if (video.getAttribute('data-kappi-warm') === '1') {
      // Warm-Player laden nur komprimierte Mediendaten. Keine Chroma-Schleife,
      // kein Ton und keine sichtbare Ebene, bis ein echter Trigger sie uebernimmt.
      clearDurationTimer(video);
      removeChromaCanvas(video);
      removeVideoBubble(video);
      video.muted = true;
      video.volume = 0;
      video.style.display = 'none';
      return;
    }
    var config = findForVideo(video);
    if (!config) {
      // Kein passendes (aktives) Item mehr - z. B. Video-Schalter waehrend der
      // Wiedergabe ausgeschaltet. Die Wiedergabe selbst bleibt unangetastet,
      // aber die Bubble darf nicht als veraltete Anzeige stehen bleiben.
      removeVideoBubble(video);
      return;
    }
    video.__kappiVideoConfig = config;
    video.volume = config.volume / 100;
    applyVideoGeometry(video, config);
    // Auch ältere, einzeln erzeugte Video-Elemente bekommen dieselbe feste
    // Referenzebene. Nur so kann die Bubble zuverlässig davor oder dahinter liegen.
    video.style.zIndex = '1200';
    // Balken links/rechts: Seitenverhältnis behalten (contain) statt Bildschirm füllen (cover).
    video.style.objectFit = config.sideBars === false ? 'cover' : 'contain';
    // Ausrichtung innerhalb des Rahmens (bei Balken an eine Seite ziehen statt mittig).
    video.style.objectPosition = ALIGN_POS[config.align] || '50% 50%';
    if (video.__kappiChromaCanvas) {
      applyVideoGeometry(video.__kappiChromaCanvas, config);
      video.__kappiChromaCanvas.style.zIndex = '1200';
      video.__kappiChromaCanvas.style.objectFit = video.style.objectFit;
      video.__kappiChromaCanvas.style.objectPosition = video.style.objectPosition;
    }
    applyVideoBubble(video, config);

    if (config.startSeconds > 0 && video.readyState >= 1 && video.currentTime < 0.25) {
      try { video.currentTime = Math.min(config.startSeconds, Math.max(0, video.duration || config.startSeconds)); } catch (err) {}
    }

    if (!video.__kappiVideoEventsBound) {
      video.__kappiVideoEventsBound = true;

      var stopAndRemove = function () { finishManagedVideo(video); };

      video.addEventListener('loadedmetadata', function () {
        var current = video.__kappiVideoConfig;
        if (current && current.startSeconds > 0) {
          try { video.currentTime = Math.min(current.startSeconds, Math.max(0, video.duration || current.startSeconds)); } catch (err) {}
        }
      });

      // Zuverlässiger Stopp am eingestellten Ende ueber die echte Abspielposition.
      // Greift auch dann, wenn das Video von einer Effekt-Datei gestartet wurde
      // (unabhaengig davon, wann die Events gebunden wurden).
      video.addEventListener('timeupdate', function () {
        var current = video.__kappiVideoConfig;
        if (!current || !(current.durationSeconds > 0)) return;
        var endTime = (current.startSeconds || 0) + current.durationSeconds;
        if (video.currentTime >= endTime - 0.03) stopAndRemove();
      });

      // Bubble-Ausblendung: eine Animationsdauer vor dem wirksamen Ende starten.
      // Wirksames Ende = eingestellte Dauer, sonst die natuerliche Videolaenge.
      video.addEventListener('timeupdate', function () {
        var current = video.__kappiVideoConfig;
        if (!current || !current.bubbleEnabled || !video.__kappiBubble) return;
        var end = current.durationSeconds > 0
          ? (current.startSeconds || 0) + current.durationSeconds
          : (Number(video.duration) || 0);
        if (!(end > 0)) return;
        var lead = number(current.bubbleAnimationDuration, 0.7, 0.2, 3);
        if (video.currentTime >= end - lead) maybeStartBubbleExit(video, current);
        else cancelBubbleExit(video);
      });

      video.addEventListener('play', function () {
        if (video.__kappiGeneration !== playbackGeneration) {
          discardVideo(video);
          return;
        }
        var current = video.__kappiVideoConfig;
        if (!current) return;
        video.volume = current.volume / 100;
        // Sicherheits-Fallback, falls timeupdate ausbleibt (etwas groesserer Puffer,
        // damit der genaue timeupdate-Stopp zuerst greift).
        if (video.__kappiDurationTimer) clearTimeout(video.__kappiDurationTimer);
        if (current.durationSeconds > 0) {
          video.__kappiDurationTimer = setTimeout(stopAndRemove, (current.durationSeconds + 0.4) * 1000);
        }
        startChroma(video, current);
      });

      video.addEventListener('playing', function () { setPlaybackPhase(video, 'playing'); });
      video.addEventListener('waiting', function () { setPlaybackPhase(video, 'waiting'); });
      video.addEventListener('stalled', function () { setPlaybackPhase(video, 'stalled'); });
      video.addEventListener('error', function () {
        if (video.__kappiGeneration === playbackGeneration) setPlaybackPhase(video, 'error');
      });
      video.addEventListener('ended', stopAndRemove);
    }
    startChroma(video, config);
  }

  function scanVideos(root) {
    if (!root) return;
    if (root.tagName === 'VIDEO') applyToVideo(root);
    if (root.querySelectorAll) {
      var videos = root.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) applyToVideo(videos[i]);
    }
  }

  function stopCompetingVideos(except) {
    var running = document.querySelectorAll('video');
    for (var i = 0; i < running.length; i++) {
      var old = running[i];
      if (old === except) continue;
      if (old.getAttribute('data-kappi-bubble-asset') === '1') continue;
      if (old.getAttribute('data-kappi-warm') === '1') {
        // Ein nur teilweise geladener Warm-Player darf den echten Trigger nie
        // ausbremsen. Lediglich vollstaendig gepufferte Daten bleiben im Speicher.
        if (!isFullyBuffered(old)) discardVideo(old);
        continue;
      }
      var oldConfig = old.__kappiVideoConfig || findForVideo(old);
      try { old.pause(); old.muted = true; old.volume = 0; } catch (err) {}
      if (oldConfig && isFullyBuffered(old)) parkWarmVideo(old, oldConfig);
      else discardVideo(old);
    }
  }

  function createManagedVideo(config, templateData) {
    if (window.__KAPPI_INSTANCE_DEACTIVATED__) return null; // stummgeschaltete Alt-Instanz
    if (window.__KAPPI_OVERLAY_SUSPENDED__) return null;    // App-Ausnahme aktiv (Vordergrund-App)
    if (!config || !config.enabled || !config.videoPath) return null;
    // Nur ein direktes Doppel-Echo blocken. Der Wechsel A -> B -> A ist erlaubt,
    // auch wenn alle drei Streamer.bot-Events innerhalb von 140 ms eintreffen.
    var dkey = String(config.id || config.trigger || config.videoPath);
    var now = Date.now();
    if (dkey === lastRequestedKey && (now - lastRequestedAt) < DUPLICATE_DEBOUNCE_MS) {
      // Häufig startet zuerst die alte Effekt-Datei und erst direkt danach erreicht
      // dieselbe Nachricht den zentralen Empfänger mit allen Streamer.bot-Variablen.
      // Das Video nicht doppelt starten, aber seine Bubble mit den später angekommenen
      // Daten sofort neu rendern.
      if (templateData && activeVideo && activeVideo.__kappiVideoConfig) {
        activeVideo.__kappiTemplateData = templateData;
        applyVideoBubble(activeVideo, activeVideo.__kappiVideoConfig);
      }
      // "true" ist absichtlich ein Erfolgswert: Die alten Einzelmodule duerfen
      // bei einem geblockten Echo NICHT ihren kalten Fallback-Player starten.
      return true;
    }
    lastRequestedKey = dkey;
    lastRequestedAt = now;

    playbackGeneration += 1;
    var generation = playbackGeneration;
    var video = takeWarmVideo(config);
    stopCompetingVideos(video);
    if (!video) video = document.createElement('video');

    removeChromaCanvas(video);
    clearDurationTimer(video);
    video.removeAttribute('data-kappi-warm');
    video.setAttribute('data-kappi-video-id', config.id);
    video.__kappiGeneration = generation;
    video.__kappiVideoConfig = config;
    video.__kappiTemplateData = templateData || null;
    video.preload = 'auto';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.muted = false;
    applyVideoGeometry(video, config);
    video.style.objectFit = config.sideBars === false ? 'cover' : 'contain';
    video.style.pointerEvents = 'none';
    video.style.zIndex = '1200';
    video.style.display = 'block';
    video.style.opacity = '';
    // Eigene GPU-Ebene erzwingen, damit das (erste) Video sofort gezeichnet wird
    // und nicht durchsichtig bleibt (WebView2-Erstframe-Effekt nach Neustart).
    video.style.transform = 'translateZ(0)';
    video.style.backfaceVisibility = 'hidden';
    var currentPath = video.currentSrc || video.src || video.getAttribute('src');
    var sourceChanged = !pathsMatch(currentPath, config.videoPath);
    if (sourceChanged) video.src = config.videoPath;
    if (!video.parentNode) document.body.appendChild(video);
    applyToVideo(video);
    activeVideo = video;
    playbackStatus = {
      generation: generation,
      id: dkey,
      phase: sourceChanged ? 'loading' : 'warm',
      requestedAt: now,
      playingAt: 0
    };
    if (sourceChanged) {
      try { video.load(); } catch (err) {}
    } else {
      try { video.currentTime = Math.max(0, config.startSeconds || 0); } catch (err) {}
    }
    var promise = video.play();
    if (promise && typeof promise.catch === 'function') promise.catch(function () {
      if (video.__kappiGeneration === playbackGeneration) setPlaybackPhase(video, 'play-blocked');
    });
    return video;
  }

  function handleCustom(payload) {
    if (videosPaused) return; // global pausiert -> keine automatischen Video-Trigger
    var data = payload && payload.data ? payload.data : {};
    // WICHTIG: Die lokale Client-Bibliothek liefert bei CPH.WebsocketBroadcastJson das
    // KOMPLETTE gesendete JSON als payload.data – also {event:{General/Custom},data:{Trigger:true}}
    // statt direkt {Trigger:true}. Eine Ebene auspacken, sonst matcht kein Trigger.
    // (Alte Einzel-Codes senden FLACH {"Name":true} und sind nicht betroffen.)
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') {
      data = data.data;
    }
    for (var i = 0; i < items.length; i++) {
      var config = items[i];
      // Alte Effekt-Videos wurden mit managed=false gespeichert, weil früher allein
      // ihre einzelne JS-Datei zuständig war. Bei einer umhüllten Custom-Payload sieht
      // diese Datei den Trigger jedoch nicht. sourceFile-Effekte deshalb trotzdem über
      // den kompatiblen zentralen Pfad zulassen.
      if (!config.enabled || (!config.managed && !config.sourceFile) || !config.trigger) continue;
      // Auch bestehende Videos mit eigener Effekt-Datei (sourceFile) zentral starten.
      // So funktionieren sowohl alte flache JSON-Payloads als auch die zeitweise vom
      // Codegenerator erzeugte General.Custom-Hülle. Ein unmittelbar danach reagierendes
      // Alt-Skript wird durch die Sperre in createManagedVideo gegen Doppelstart abgefangen.
      // Reward-Videos reagieren NUR auf die Twitch-Belohnung (handleReward), nicht auf Custom.
      var byTrigger = (data[config.trigger] === true) && config.triggerType !== 'reward';
      var byId = (data.kappiVideoOverlay === config.id || data.videoOverlay === config.name);
      // Alte, einzeln geladene Video-Skripte rufen direkt danach playTrigger auf.
      // Die komplette Event-Payload hier zwischenspeichern, damit auch diese Videos
      // ohne Änderung ihrer alten JS-Datei alle Streamer.bot-Variablen erhalten.
      if (data[config.trigger] === true || byId) pendingTemplateData[config.trigger] = data;
      if (byTrigger || byId) createManagedVideo(config, data);
    }
    // Gruppen-Zufalls-Trigger: kommt der Trigger einer Gruppe über Streamer.bot, spielt
    // EIN zufälliges aktives Video dieser Gruppe – direkt (auch bei sourceFile/reward, wie
    // handleReward), denn die Effekt-Dateien reagieren nicht auf den Gruppen-Trigger.
    var groupBuckets = {};
    for (var g = 0; g < items.length; g++) {
      var gc = items[g];
      if (!gc.enabled || !gc.groupTrigger) continue;
      if (data[gc.groupTrigger] === true) {
        (groupBuckets[gc.groupTrigger] = groupBuckets[gc.groupTrigger] || []).push(gc);
      }
    }
    for (var trig in groupBuckets) {
      if (!groupBuckets.hasOwnProperty(trig)) continue;
      var bucket = groupBuckets[trig];
      createManagedVideo(bucket[Math.floor(Math.random() * bucket.length)], data);
    }
  }

  // Twitch-Kanalpunkte-Belohnung: nur Videos im "reward"-Modus reagieren (per Name).
  // Feld-Extraktion bewusst großzügig (wie im Chat-Panel): Streamer.bot liefert die
  // Belohnung je nach Version als data.reward, data.Reward ODER verschachtelt unter
  // data.redemption.reward. Fehlt hier ein Format, wird der Name nicht gefunden und
  // das Video im Reward-Modus zündet nicht.
  function rewardTitle(data) {
    data = data || {};
    var red = data.redemption || data.Redemption || {};
    var r = (data.reward && typeof data.reward === 'object') ? data.reward
          : (data.Reward && typeof data.Reward === 'object') ? data.Reward
          : (red.reward && typeof red.reward === 'object') ? red.reward
          : (red.Reward && typeof red.Reward === 'object') ? red.Reward : {};
    var t = r.title || r.Title || r.name || r.Name ||
            data.rewardName || data.RewardName || data.rewardTitle || data.title ||
            red.rewardName || red.RewardName || '';
    return String(t || '');
  }
  function handleReward(payload) {
    if (videosPaused) return;
    var data = payload && payload.data ? payload.data : {};
    var low = rewardTitle(data).trim().toLowerCase();
    if (!low) return;
    for (var i = 0; i < items.length; i++) {
      var config = items[i];
      // KEIN managed-Check: Reward-Videos werden IMMER direkt hier abgespielt – auch die
      // mit eigener Effekt-Datei (sourceFile → managed=false). Die Effekt-Dateien reagieren
      // nur auf General.Custom, NICHT auf Twitch-Belohnungen; ohne diesen Pfad zündet ein
      // Reward-Video mit Effekt-Datei nie. createManagedVideo braucht nur videoPath.
      if (!config.enabled || config.triggerType !== 'reward') continue;
      if (String(config.trigger).trim().toLowerCase() === low || String(config.name).trim().toLowerCase() === low) {
        createManagedVideo(config, data);
      }
    }
  }

  var settingsRequestInFlight = false;
  function loadSettings() {
    if (settingsRequestInFlight) return;
    try {
      settingsRequestInFlight = true;
      var xhr = new XMLHttpRequest();
      xhr.open('GET', SETTINGS_URL + '?t=' + Date.now(), true);
      xhr.timeout = 1800;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var response = JSON.parse(xhr.responseText || '{}');
          var source = Array.isArray(response.items) ? response.items : [];
          items = source.map(normalizeItem);
          videosPaused = !!response.paused;
          scanVideos(document);
          sweepOrphanBubbles();
        } catch (err) {}
      };
      xhr.onloadend = function () { settingsRequestInFlight = false; };
      xhr.send();
    } catch (err) { settingsRequestInFlight = false; }
  }

  function playById(id, force, templateData) {
    id = String(id || '');
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id || items[i].name === id) {
        var cfg = items[i];
        if (force && !cfg.enabled) {
          cfg = normalizeItem(items[i]);
          cfg.enabled = true;
        }
        return createManagedVideo(cfg, templateData);
      }
    }
    return null;
  }

  // Zentrale Wiedergabe über den Streamer.bot-Trigger. Wendet Start/Dauer/
  // Effekte aus den gespeicherten Einstellungen an (Bindet die Events VOR dem
  // Abspielen -> der Trim greift auch beim ersten Durchlauf zuverlässig).
  function playByTrigger(trigger, force, templateData) {
    trigger = String(trigger || '');
    if (!trigger) return null;
    var resolvedTemplateData = templateData || pendingTemplateData[trigger] || null;
    if (pendingTemplateData[trigger]) delete pendingTemplateData[trigger];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.trigger === trigger || it.name === trigger || it.id === trigger) {
        // Global pausiert: als "erledigt" melden (true), damit die Effekt-Datei
        // NICHT auf ihre eigene Wiedergabe zurueckfaellt -> es spielt nichts.
        if (videosPaused) return true;
        var cfg = it;
        if (force && !cfg.enabled) {
          cfg = normalizeItem(it);
          cfg.enabled = true;
        }
        // Deaktiviert (linker An/Aus-Schalter aus) und NICHT erzwungen: als "erledigt"
        // (true) melden, damit die Effekt-Datei NICHT auf ihre eigene Wiedergabe
        // zurueckfaellt. So blockiert der Schalter auch echte Streamer.bot-/Reward-Trigger.
        if (!cfg.enabled) return true;
        return createManagedVideo(cfg, resolvedTemplateData);
      }
    }
    return null;
  }

  // Test-Trigger von der Settings-Seite: Video einmal im Overlay zeigen.
  var triggerRequestInFlight = false;
  function pollTrigger() {
    if (triggerRequestInFlight) return;
    try {
      triggerRequestInFlight = true;
      var xhr = new XMLHttpRequest();
      xhr.open('GET', TRIGGER_URL + '?t=' + Date.now(), true);
      xhr.timeout = 1200;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var res = JSON.parse(xhr.responseText || '{}');
          var token = Number(res.token) || 0;
          if (lastTriggerToken < 0) { lastTriggerToken = token; return; }
          if (token > lastTriggerToken) {
            lastTriggerToken = token;
            if (res.id) playById(res.id, true);
          }
        } catch (err) {}
      };
      xhr.onloadend = function () { triggerRequestInFlight = false; };
      xhr.send();
    } catch (err) { triggerRequestInFlight = false; }
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      for (var j = 0; j < mutations[i].addedNodes.length; j++) scanVideos(mutations[i].addedNodes[j]);
    }
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('play', function (event) {
      if (event.target && event.target.tagName === 'VIDEO') applyToVideo(event.target);
    }, true);
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('General.Custom', handleCustom);
      window.client.on('Twitch.RewardRedemption', handleReward);
    }
    loadSettings();
    setInterval(loadSettings, POLL_MS);
    pollTrigger();
    setInterval(pollTrigger, TRIGGER_POLL_MS);
    // SB-Globals fuer {{sb:...}}-Tokens laden: der Client steht evtl. erst nach
    // dem Handshake bereit -> mit Wiederholung starten, danach Events + Fallback.
    var globalsTries = 0;
    var globalsStart = setInterval(function () {
      bindBubbleGlobalEvents();
      if (refreshBubbleGlobals() || ++globalsTries > 60) clearInterval(globalsStart);
    }, 500);
    setInterval(refreshBubbleGlobals, 15000);
  }

  window.kappiVideoOverlays = {
    reload: loadSettings,
    play: function (idOrName, templateData) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === idOrName || items[i].name === idOrName) return createManagedVideo(items[i], templateData);
      }
      return null;
    },
    playTrigger: playByTrigger,
    status: function () {
      return {
        active: true,
        items: items.slice(),
        playback: Object.assign({}, playbackStatus),
        warm: warmOrder.slice()
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
