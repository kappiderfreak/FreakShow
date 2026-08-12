// Loads persistent external overlay links inside the transparent overlay layer.
(function () {
  'use strict';

  if (window.__KAPPI_EXTERNAL_OVERLAYS_ACTIVE__) return;
  window.__KAPPI_EXTERNAL_OVERLAYS_ACTIVE__ = true;

  var STORAGE_KEY = 'kappi.overlay.external.links';
  var LEGACY_STORAGE_KEY = 'kappi.diagnose.broadcast.links';
  var RELOAD_MS = 5000;
  var POSITION_PREVIEW_URL = location.origin + '/position-preview';
  var POSITION_PREVIEW_ACK_URL = location.origin + '/position-preview-ack';
  var UI_STATE_URL = location.origin + '/ui-state';
  var POSITION_PREVIEW_POLL_MS = 450;
  var POSITION_THEME_POLL_MS = 2000;
  var POSITION_PREVIEW_SCRIPT_VERSION = '20260721-theme2';
  var EXTERNAL_LINKS_URL = location.origin + '/external-links';
  var EXTERNAL_LINKS_RUNTIME_URL = location.origin + '/external-links/runtime';
  var EXTERNAL_LINKS_POLL_MS = 1000;
  var lastSignature = '';
  var lastPreviewSignature = '';
  var lastPreviewAckAt = 0;
  var bridgeLinks = null;
  var bridgeMonitorWidth = 0;
  var bridgeMonitorHeight = 0;
  var lastConfiguredLinks = [];
  var trigState = {};
  var lastEnabledById = {};
  var lastManualVersionById = {};
  var triggerBound = false;
  var runtimeReportInFlight = false;
  // Rueckmeldung der Overlay-Dokumente zum Schalter "Hintergrund entfernen".
  var backgroundFrames = [];
  var backgroundAckById = {};
  var backgroundSurveyById = {};
  // Welches Fenster zu welchem Overlay gehoert - Grundlage dafuer, beim Neuzeichnen
  // nur die wirklich geaenderten Fenster anzufassen.
  var activeFrames = {};
  var lastRuntimeReportSignature = '';
  var lastRuntimeReportAt = 0;
  var positionThemeAccent = '#4f7dd6';
  var POSITION_THEME_ACCENTS = {
    dunkel: '#4f7dd6',
    hell: '#2f6fe0',
    blau: '#38a1ff',
    lila: '#a672ff',
    gruen: '#34d17a',
    sepia: '#b5762f',
    kontrast: '#5fb0ff',
    rose: '#ff6fae',
    tuerkis: '#2ee0c8',
    orange: '#ff9d3c',
    nord: '#88c0d0'
  };

  function log(message, obj) {
    if (window.console && console.log) {
      console.log('[Kappi External Overlays]', message, obj || '');
    }
  }

  function getConnection() {
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.get === 'function') {
      return window.KappiOverlayConfig.get();
    }
    return window.KAPPI_OVERLAY_CONFIG || { host: '127.0.0.1', port: 8081 };
  }

  function readJson(key) {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(key) : '';
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function normalizeLink(link) {
    link = link || {};
    return {
      id: link.id || link.url || ('external-' + Math.floor(Math.random() * 100000)),
      name: link.name || 'Overlay-Link',
      url: link.url || '',
      profile: link.profile || 'auto',
      persistent: link.persistent !== false,
      enabled: link.enabled !== false,
      trigger: String(link.trigger || '').replace(/^\s+|\s+$/g, ''),
      triggerOn: link.triggerOn === true,
      // -1 = globaler Overlay-Monitor (Abwärtskompatibilität für bestehende Links).
      targetMonitor: Math.max(-1, toInt(link.targetMonitor, -1)),
      manualVersion: Math.max(0, toInt(link.manualVersion, 0)),
      transparentBg: link.transparentBg === true,
      muted: link.muted === true,
      contentScale: normalizeContentScale(link.contentScale),
      crop: normalizeCrop(link.crop),
      area: normalizeArea(link.area)
    };
  }

  function toInt(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  function belongsToThisMonitor(link) {
    // Browser-/OBS-Ausgaben erhalten keine lokale Bildschirm-Route und zeigen
    // daher wie bisher sämtliche Web-Overlays.
    if (!window.__KAPPI_MONITOR_ROUTING__) return true;
    var local = Number(window.__KAPPI_LOCAL_MONITOR__);
    var primary = Number(window.__KAPPI_PRIMARY_MONITOR__);
    var target = toInt(link && link.targetMonitor, -1);
    if (target < 0) target = isFinite(primary) ? primary : 0;
    return target === local;
  }

  // Zuschnitt je Seite in Prozent. Gegenueberliegende Seiten duerfen zusammen
  // hoechstens 80 % wegnehmen, damit immer ein sichtbarer Rest bleibt.
  function normalizeCrop(crop) {
    crop = crop || {};
    function side(value) {
      var n = toInt(value, 0);
      if (n < 0) n = 0;
      if (n > 80) n = 80;
      return n;
    }
    var out = { left: side(crop.left), top: side(crop.top), right: side(crop.right), bottom: side(crop.bottom) };
    if (out.left + out.right > 80) out.right = Math.max(0, 80 - out.left);
    if (out.top + out.bottom > 80) out.bottom = Math.max(0, 80 - out.top);
    return out;
  }

  function normalizeContentScale(value) {
    var n = toInt(value, 100);
    if (n < 25) n = 25;
    if (n > 200) n = 200;
    return n;
  }

  function cropIsActive(crop) {
    return !!crop && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0);
  }

  function normalizeArea(area) {
    var cfg = getConnection();
    area = area || {};
    return {
      preset: area.preset || 'full',
      x: Math.max(0, toInt(area.x, 0)),
      y: Math.max(0, toInt(area.y, 0)),
      width: Math.max(20, toInt(area.width, cfg.monitorWidth || window.innerWidth || 1920)),
      height: Math.max(20, toInt(area.height, cfg.monitorHeight || window.innerHeight || 1080))
    };
  }

  function normalizeLinks(links) {
    var out = [];
    if (!Array.isArray(links)) return out;
    for (var i = 0; i < links.length; i++) {
      var item = normalizeLink(links[i]);
      if (isHandledLocally(item)) continue;
      if (!belongsToThisMonitor(item)) continue;
      // Ausgeschaltete Links muessen fuer Streamer.bot im Speicher bleiben: Sie sind
      // unsichtbar, bis ihr Custom-Event die Laufzeit-Umschaltung aktiviert.
      if (item.url && item.persistent && (item.enabled || (item.triggerOn && item.trigger))) out.push(item);
    }
    return out;
  }

  function isHandledLocally(link) {
    return !!(link && /tawmae\.xyz\/overlays\/giphy-and-sb/i.test(link.url || ''));
  }

  function parseUrl(url) {
    var hashIndex = url.indexOf('#');
    var hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    var noHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    var queryIndex = noHash.indexOf('?');
    return {
      base: queryIndex >= 0 ? noHash.slice(0, queryIndex) : noHash,
      query: queryIndex >= 0 ? noHash.slice(queryIndex + 1) : '',
      hash: hash
    };
  }

  function parseQuery(query) {
    var out = [];
    if (!query) return out;
    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;
      var eq = pairs[i].indexOf('=');
      var key = eq >= 0 ? pairs[i].slice(0, eq) : pairs[i];
      var value = eq >= 0 ? pairs[i].slice(eq + 1) : '';
      out.push({
        key: decodeURIComponent(key || ''),
        value: decodeURIComponent(value || '')
      });
    }
    return out;
  }

  function encodeQuery(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i].key) continue;
      out.push(encodeURIComponent(pairs[i].key) + '=' + encodeURIComponent(pairs[i].value || ''));
    }
    return out.join('&');
  }

  function setQueryValues(url, values) {
    var parts = parseUrl(url);
    var pairs = parseQuery(parts.query);
    var lower = {};
    var key;

    for (key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        lower[String(key).toLowerCase()] = { key: key, value: values[key] };
      }
    }

    var next = [];
    for (var i = 0; i < pairs.length; i++) {
      var lowered = String(pairs[i].key || '').toLowerCase();
      if (lower[lowered]) {
        next.push({ key: pairs[i].key, value: lower[lowered].value });
        delete lower[lowered];
      } else {
        next.push(pairs[i]);
      }
    }

    for (key in lower) {
      if (Object.prototype.hasOwnProperty.call(lower, key)) next.push(lower[key]);
    }

    var query = encodeQuery(next);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  // ===== Zentrale Anbieter-Tabelle =====
  // EINE Datei (app/overlay-providers.json) beschreibt alle bekannten Anbieter.
  // Ein neuer Software-Hersteller wird nur dort eingetragen - hier steht keine
  // Anbieterliste mehr im Code.
  var PROVIDERS_URL = location.origin + '/app/overlay-providers.json';
  var providerTable = null;

  function loadProviderTable(done) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', PROVIDERS_URL + '?t=' + Date.now(), true);
      xhr.timeout = 2500;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = JSON.parse(xhr.responseText || '{}');
            if (parsed && Object.prototype.toString.call(parsed.providers) === '[object Array]') {
              providerTable = { cloudHosts: parsed.cloudHosts || [], providers: parsed.providers };
              render(true);
            }
          } catch (err) {}
        }
        if (done) done();
      };
      xhr.onerror = function () { if (done) done(); };
      xhr.ontimeout = xhr.onerror;
      xhr.send();
    } catch (err) { if (done) done(); }
  }

  // Passenden Tabelleneintrag zu einer Adresse finden (Host exakt, Pfad-Anfang).
  function overlayProviderFor(url) {
    if (!providerTable) return null;
    var parts = parseUrl(String(url || ''));
    var match = String(parts.base || '').match(/^https?:\/\/([^\/?#]+)(\/[^?#]*)?$/i);
    if (!match) return null;
    var host = String(match[1] || '').split('@').pop().split(':')[0].toLowerCase().replace(/^www\./, '');
    var path = String(match[2] || '/').toLowerCase();
    for (var i = 0; i < providerTable.providers.length; i++) {
      var p = providerTable.providers[i];
      if (!p || !p.host || host !== String(p.host).toLowerCase()) continue;
      if (p.path && path.indexOf(String(p.path).toLowerCase()) !== 0) continue;
      return p;
    }
    return null;
  }

  // Cloud-/Server-gehostete Overlays (Streamlabs, StreamElements, ...) laufen NICHT
  // ueber deinen lokalen Streamer.bot. Ihnen Adresse/Port anzuhaengen zerstoert den Link.
  function isCloudHostedOverlay(url) {
    if (!providerTable) return false;
    var m = String(url || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/i);
    if (!m) return false;
    var host = m[1].split('@').pop().split(':')[0].toLowerCase();
    var cloud = providerTable.cloudHosts;
    for (var i = 0; i < cloud.length; i++) {
      var c = String(cloud[i] || '').toLowerCase();
      if (host === c || host.slice(-(c.length + 1)) === '.' + c) return true;
    }
    return false;
  }

  // Verbindungs-Parameter (evtl. frueher fest eingebacken) aus einer URL entfernen.
  var CONNECTION_QUERY_KEYS = [
    'address', 'addr', 'host', 'hostname', 'ip', 'port',
    'server', 'serveraddress', 'ws', 'wsurl',
    'websocket', 'websocketurl', 'socketurl',
    'monitorwidth', 'monitorheight'
  ];
  function stripConnectionParams(url) {
    var parts = parseUrl(url);
    var pairs = parseQuery(parts.query);
    var kept = [];
    for (var i = 0; i < pairs.length; i++) {
      var lk = String(pairs[i].key || '').toLowerCase();
      if (CONNECTION_QUERY_KEYS.indexOf(lk) < 0) kept.push(pairs[i]);
    }
    var query = encodeQuery(kept);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  // Lokaler Relay-Proxy der Bridge. HTTPS-Overlays (z. B. ChatRD von github.io)
  // duerfen aus Browser-Sicht KEIN unverschluesseltes ws:// zu einer LAN-IP
  // aufbauen (Mixed Content) - nur zu 127.0.0.1. Laeuft Streamer.bot auf einem
  // anderen PC, leiten wir solche Overlays ueber 127.0.0.1:PROXY, das die Bridge
  // transparent zum echten Streamer.bot weiterreicht.
  // Der Relay laeuft immer auf DEM PC, von dem diese Seite geladen wurde.
  // Bei lokaler Anzeige ist das 127.0.0.1, bei der Ausgabe auf einem zweiten PC
  // (z. B. OBS im Netzwerk) die LAN-Adresse dieses Hosts.
  var PROXY_HOST = (function () {
    try {
      var h = String(window.location.hostname || '').trim();
      return h ? h : '127.0.0.1';
    } catch (err) { return '127.0.0.1'; }
  })();
  var PROXY_PORT = 18082;

  // Laeuft diese Seite direkt auf dem FreakShow-PC?
  function isLocalPage() {
    return /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(String(window.location.hostname || ''));
  }

  function needsProxy(url, host) {
    return /^https:/i.test(String(url || '')) &&
      !/^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(String(host || ''));
  }

  // Bekannte HTTPS-Overlays ueber die lokale Bridge ausliefern. Grund: Eine
  // HTTPS-Seite darf laut Browser-Regel nur zu localhost eine unverschluesselte
  // WebSocket-Verbindung oeffnen. Wird die Ausgabe auf einem ZWEITEN PC gezeigt,
  // scheitert die Verbindung zu Streamer.bot deshalb immer. Ueber den Bridge-Pfad
  // hat die Seite dieselbe (unverschluesselte) Herkunft wie die Ausgabe und darf
  // ins LAN verbinden. Die Bridge holt das Original-HTML nur in den Arbeitsspeicher.
  function bridgeRelayUrl(url) {
    var provider = overlayProviderFor(url);
    if (!provider || !provider.relayKind) return '';
    var parts = parseUrl(url);
    return window.location.origin + '/external-preview/' + provider.relayKind +
      (parts.query ? '?' + parts.query : '') + parts.hash;
  }

  // StreamUP Horizontal Chat liest die Streamer.bot-Verbindung aus den Parametern
  // "url" und "port". Im FreakShow-iframe verbindet es sich zuverlaessig ueber
  // den lokalen Relay, auch wenn Streamer.bot auf einem zweiten PC laeuft.
  function isStreamUpHorizontalChat(url) {
    try {
      return /(?:^|\/)StreamUP-HorizontalChat\.html(?:[?#]|$)/i.test(decodeURIComponent(String(url || '')));
    } catch (err) {
      return /StreamUP-HorizontalChat\.html/i.test(String(url || ''));
    }
  }

  // Alle bereits in der URL vorhandenen Adress-/Port-Parameter auf den Proxy
  // umbiegen - noetig fuer Overlays mit eigenen Schluesseln (ChatRD:
  // streamerBotServerAddress / streamerBotServerPort). speakerBot* bleibt unberuehrt.
  var PROXY_ADDR_KEYS = ['address', 'addr', 'host', 'hostname', 'ip', 'server', 'serveraddress', 'streamerbotserveraddress'];
  var PROXY_PORT_KEYS = ['port', 'streamerbotserverport'];
  var PROXY_WS_KEYS = ['ws', 'wsurl', 'websocket', 'websocketurl', 'socketurl'];
  function rewriteConnectionParamsToProxy(url) {
    var parts = parseUrl(url);
    var pairs = parseQuery(parts.query);
    var wsUrl = 'ws://' + PROXY_HOST + ':' + PROXY_PORT + '/';
    for (var i = 0; i < pairs.length; i++) {
      var lk = String(pairs[i].key || '').toLowerCase();
      if (PROXY_ADDR_KEYS.indexOf(lk) >= 0) pairs[i].value = PROXY_HOST;
      else if (PROXY_PORT_KEYS.indexOf(lk) >= 0) pairs[i].value = String(PROXY_PORT);
      else if (PROXY_WS_KEYS.indexOf(lk) >= 0) pairs[i].value = wsUrl;
    }
    var query = encodeQuery(pairs);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  // ===== Streamer.bot Chat (chat.streamer.bot) =====
  // Diese Seite liest Adresse und Port NICHT aus eigenen Abfrageparametern, sondern
  // ausschliesslich aus einem base64-Block namens "config" (nachgemessen: mit
  // host=9.9.9.9 in der Adresse verbindet sie trotzdem zum Wert aus dem Block).
  // Adresse anzuhaengen bleibt hier also wirkungslos. Dazu kommt: Die Seite laedt
  // ueber HTTPS und darf unverschluesselt nur zu localhost verbinden. Liegt
  // Streamer.bot auf einem anderen PC, blockiert der Browser die Verbindung - im
  // normalen Browser laesst sich das von Hand erlauben, im Overlay-Fenster nicht.
  // Darum wird der Block selbst auf den lokalen Relay der Bridge umgeschrieben,
  // die dann zum echten Streamer.bot weiterreicht.
  function decodeBase64Utf8(value) {
    var raw = window.atob(String(value || ''));
    try {
      return decodeURIComponent(window.escape ? window.escape(raw) : raw);
    } catch (err) {
      return raw;
    }
  }

  function encodeBase64Utf8(text) {
    var raw = String(text || '');
    try {
      raw = window.unescape ? window.unescape(encodeURIComponent(raw)) : raw;
    } catch (err) {}
    return window.btoa(raw);
  }

  function rewriteStreamerbotChatConfig(url, host, port) {
    var parts = parseUrl(String(url || ''));
    var pairs = parseQuery(parts.query);
    var touched = false;
    for (var i = 0; i < pairs.length; i++) {
      if (String(pairs[i].key || '').toLowerCase() !== 'config') continue;
      try {
        var settings = JSON.parse(decodeBase64Utf8(pairs[i].value));
        if (!settings || typeof settings !== 'object') continue;
        settings.host = String(host);
        settings.port = Number(port);
        // Unverschluesselt: Der Relay der Bridge spricht kein TLS. Mit "secure"
        // wuerde die Seite wss:// versuchen und in eine Zeitueberschreitung laufen.
        settings.secure = false;
        pairs[i].value = encodeBase64Utf8(JSON.stringify(settings));
        touched = true;
      } catch (err) {}
    }
    if (!touched) return url;
    var query = encodeQuery(pairs);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  function applyConnection(link) {
    var cfg = getConnection();
    var url = link.url;
    var profile = link.profile || 'auto';
    var provider = overlayProviderFor(url);

    if (isStreamUpHorizontalChat(url)) {
      return setQueryValues(url, { url: PROXY_HOST, port: PROXY_PORT });
    }

    // "direct" (z. B. Twitch-Alertbox): Link UNVERAENDERT lassen. Herkunft,
    // Sitzung und Zugangs-Token im Hash muessen zusammenpassen; der Frame-Riegel
    // faellt dafuer im Overlay-Fenster (Host.cs liest dieselbe Tabelle).
    if (provider && provider.connection === 'direct') return url;

    // Sicherheitsnetz: Cloud-Overlays NIE eigene Adresse/Port anhaengen und
    // evtl. schon eingebackene wieder ENTFERNEN, egal welches Profil gespeichert ist.
    if (isCloudHostedOverlay(url)) return stripConnectionParams(url);

    // Manche Anbieter brauchen ein festes Profil, sobald "Auto" gewaehlt ist.
    if (profile === 'auto' && provider && provider.autoProfile) profile = provider.autoProfile;

    // Ziel-Host/-Port bestimmen: HTTPS-Overlay + SB nicht auf localhost -> Proxy.
    var proxied = needsProxy(url, cfg.host);
    var host = proxied ? PROXY_HOST : cfg.host;
    var port = proxied ? PROXY_PORT : cfg.port;
    var wsUrl = 'ws://' + host + ':' + port + '/';

    // Verbindung steckt im base64-Block "config", nicht in Parametern (chat.streamer.bot).
    if (provider && provider.connection === 'config-base64') return rewriteStreamerbotChatConfig(url, host, port);

    var out;
    if (profile === 'none') out = url;
    else if (profile === 'host-port') out = setQueryValues(url, { host: host, port: port });
    else if (profile === 'server-port') out = setQueryValues(url, { server: host, port: port });
    else if (profile === 'ip-port') out = setQueryValues(url, { ip: host, port: port });
    else if (profile === 'ws') out = setQueryValues(url, { ws: wsUrl });
    else if (profile === 'websocket') out = setQueryValues(url, { websocket: wsUrl });
    else if (profile === 'websocketUrl') out = setQueryValues(url, { websocketUrl: wsUrl });
    else out = setQueryValues(url, { address: host, port: port });

    // Bei Proxy zusaetzlich alle schon eingebackenen Verbindungs-Parameter umbiegen.
    if (proxied) out = rewriteConnectionParamsToProxy(out);

    // Ausgabe laeuft NICHT auf dem FreakShow-PC (z. B. OBS im Netzwerk): bekannte
    // HTTPS-Overlays ueber die Bridge ausliefern, sonst blockiert der Browser ihre
    // WebSocket-Verbindung zu Streamer.bot (Mixed Content).
    if (!isLocalPage() && /^https:/i.test(String(out || ''))) {
      var relayed = bridgeRelayUrl(out);
      if (relayed) return relayed;
    }
    return out;
  }

  function configuredLinks() {
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.getExternalLinks === 'function') {
      return normalizeLinks(window.KappiOverlayConfig.getExternalLinks());
    }
    return normalizeLinks(window.KAPPI_EXTERNAL_OVERLAY_LINKS || []);
  }

  function storedLinks() {
    var current = normalizeLinks(readJson(STORAGE_KEY));
    if (current.length) return current;
    return normalizeLinks(readJson(LEGACY_STORAGE_KEY));
  }

  function getLinks() {
    if (getConnection().overlaysEnabled === false) return [];
    var map = {};
    var out = [];
    var sources = bridgeLinks !== null ? [bridgeLinks] : [configuredLinks(), storedLinks()];

    for (var s = 0; s < sources.length; s++) {
      for (var i = 0; i < sources[s].length; i++) {
        var item = sources[s][i];
        var key = item.id || item.url;
        if (map[key]) continue;
        map[key] = true;
        out.push(item);
      }
    }

    return out;
  }

  function safeThemeColor(value, fallback) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  function themeRgba(alpha) {
    var color = safeThemeColor(positionThemeAccent, '#4f7dd6');
    var r = parseInt(color.slice(1, 3), 16);
    var g = parseInt(color.slice(3, 5), 16);
    var b = parseInt(color.slice(5, 7), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  function pollPositionTheme() {
    if (typeof XMLHttpRequest === 'undefined') return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', UI_STATE_URL + '?t=' + Date.now(), true);
      xhr.timeout = 900;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var state = JSON.parse(xhr.responseText || '{}');
          var theme = String(state['kappi.ui.theme'] || 'dunkel');
          var next = POSITION_THEME_ACCENTS[theme] || safeThemeColor(state['kappi.ui.accent'], '#4f7dd6');
          positionThemeAccent = safeThemeColor(next, '#4f7dd6');
        } catch (err) {}
      };
      xhr.send();
    } catch (err) {}
  }

  function visibleLinks(configured) {
    var visible = [];
    var seen = {};
    for (var i = 0; i < configured.length; i++) {
      var item = configured[i];
      var id = String(item.id || item.url || '');
      if (!id) continue;
      seen[id] = true;
      var enabled = item.enabled !== false;
      var manualVersion = Math.max(0, toInt(item.manualVersion, 0));
      if (Object.prototype.hasOwnProperty.call(lastEnabledById, id) && lastEnabledById[id] !== enabled) {
        // Manueller Klick im Bedienfeld gewinnt immer und verwirft einen alten
        // Laufzeit-Triggerzustand, wie bei den Bild-Overlays.
        delete trigState[id];
      }
      if (Object.prototype.hasOwnProperty.call(lastManualVersionById, id) && lastManualVersionById[id] !== manualVersion) {
        delete trigState[id];
      }
      lastEnabledById[id] = enabled;
      lastManualVersionById[id] = manualVersion;
      if (!item.triggerOn || !item.trigger) delete trigState[id];
      // Sobald ein Streamer.bot-Trigger benutzt wurde, ist trigState der echte
      // Sichtbarkeitswert (kein reines "zusaetzlich an"). Dadurch kann der Trigger
      // auch ein links bereits eingeschaltetes Overlay wie Chat ausblenden.
      var shown = Object.prototype.hasOwnProperty.call(trigState, id) ? trigState[id] === true : enabled;
      if (shown) visible.push(item);
    }
    for (var known in lastEnabledById) {
      if (Object.prototype.hasOwnProperty.call(lastEnabledById, known) && !seen[known]) {
        delete lastEnabledById[known];
        delete lastManualVersionById[known];
        delete trigState[known];
      }
    }
    return visible;
  }

  function customEventData(payload) {
    var data = payload && payload.data ? payload.data : {};
    // Die lokale Client-Bibliothek liefert CPH.WebsocketBroadcastJson teilweise
    // als komplette General.Custom-Huelle in payload.data. Beide Formen akzeptieren.
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') {
      data = data.data;
    }
    return data || {};
  }

  // Ein Trigger SCHALTET UM. Kommt dasselbe Ereignis doppelt an (z. B. weil der
  // Streamer.bot-Client kurz zweimal aufgebaut wurde), hoebe die zweite Umschaltung
  // die erste sofort wieder auf - das Overlay blitzte nur auf. Darum wirkt derselbe
  // Trigger innerhalb dieser Zeitspanne nur EINMAL.
  var TRIGGER_DEBOUNCE_MS = 400;
  var lastTriggerAt = {};

  function onCustom(payload) {
    var data = customEventData(payload);
    var configured = lastConfiguredLinks.length ? lastConfiguredLinks : getLinks();
    var changed = false;
    var now = Date.now();
    for (var i = 0; i < configured.length; i++) {
      var item = configured[i];
      if (!item || !item.triggerOn || !item.trigger) continue;
      if (data[item.trigger] === true) {
        var id = String(item.id || item.url || '');
        if (!id) continue;
        if (lastTriggerAt[id] && (now - lastTriggerAt[id]) < TRIGGER_DEBOUNCE_MS) {
          log('Trigger „' + item.trigger + '" kam doppelt - zweites Ereignis ignoriert.', item);
          continue;
        }
        lastTriggerAt[id] = now;
        var currentlyShown = Object.prototype.hasOwnProperty.call(trigState, id)
          ? trigState[id] === true
          : item.enabled !== false;
        trigState[id] = !currentlyShown;
        changed = true;
        log('Streamer.bot-Trigger „' + item.trigger + '“: Overlay ' + (trigState[id] ? 'eingeblendet.' : 'ausgeblendet.'), item);
      }
    }
    if (changed) render(true);
  }

  function bindTrigger() {
    if (triggerBound) return true;
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('General.Custom', onCustom);
      triggerBound = true;
      return true;
    }
    return false;
  }

  function reportRuntimeState(configured, visible) {
    if (typeof XMLHttpRequest === 'undefined' || runtimeReportInFlight) return;
    // Die Ausgabe fuer OBS (/freakshow) darf NICHT berichten. Sie zeigt Web-Overlays
    // bewusst nicht an und wuerde deshalb "nicht sichtbar" melden - und damit die
    // Meldung des echten Overlay-Fensters ueberschreiben. In der Steuerseite standen
    // die Schalter dann auf AUS, obwohl das Overlay laeuft, und sprangen nach einem
    // Klick wieder zurueck. Nur das echte Overlay-Fenster meldet seinen Zustand.
    if (isOutputViewer) return;
    var visibleById = {};
    var items = [];
    var i;
    for (i = 0; i < visible.length; i++) {
      visibleById[String(visible[i].id || visible[i].url || '')] = true;
    }
    for (i = 0; i < configured.length; i++) {
      var id = String(configured[i].id || configured[i].url || '');
      if (!id) continue;
      items.push({
        id: id,
        visible: visibleById[id] === true,
        triggered: Object.prototype.hasOwnProperty.call(trigState, id),
        backgroundRemoved: backgroundAckById[id] === true,
        backgroundSurvey: backgroundSurveyById[id] || ''
      });
    }
    var signature = JSON.stringify(items);
    var now = Date.now();
    // Auch ohne Aenderung regelmaessig als Heartbeat melden, damit die
    // Einstellungsseite keinen veralteten Zustand anzeigt.
    if (signature === lastRuntimeReportSignature && (now - lastRuntimeReportAt) < 900) return;
    lastRuntimeReportSignature = signature;
    lastRuntimeReportAt = now;
    try {
      runtimeReportInFlight = true;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', EXTERNAL_LINKS_RUNTIME_URL, true);
      xhr.timeout = 800;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onloadend = function () { runtimeReportInFlight = false; };
      xhr.send(JSON.stringify({ items: items }));
    } catch (err) {
      runtimeReportInFlight = false;
    }
  }

  function pollExternalLinks() {
    if (typeof XMLHttpRequest === 'undefined') return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', EXTERNAL_LINKS_URL + '?t=' + Date.now(), true);
      xhr.timeout = 900;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var response = JSON.parse(xhr.responseText || '{}');
          bridgeMonitorWidth = Math.max(100, toInt(response.monitorWidth, window.innerWidth || 1920));
          bridgeMonitorHeight = Math.max(100, toInt(response.monitorHeight, window.innerHeight || 1080));
          bridgeLinks = normalizeLinks(response.links || []);
          render(false);
        } catch (err) {}
      };
      xhr.send();
    } catch (err) {}
  }

  function ensureLayer() {
    var layer = document.getElementById('kappi-external-overlay-layer');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.id = 'kappi-external-overlay-layer';
    layer.style.position = 'fixed';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.background = 'transparent';

    if (document.body.firstChild) {
      document.body.insertBefore(layer, document.body.firstChild);
    } else {
      document.body.appendChild(layer);
    }
    return layer;
  }

  function ensurePreviewLayer() {
    var layer = document.getElementById('kappi-position-preview-layer');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.id = 'kappi-position-preview-layer';
    layer.style.position = 'fixed';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.background = 'transparent';
    layer.style.zIndex = '2147483600';
    document.body.appendChild(layer);
    return layer;
  }

  function previewAreaFromPayload(payload) {
    payload = payload || {};
    var monitorWidth = Math.max(100, toInt(payload.monitorWidth, window.innerWidth || 1920));
    var monitorHeight = Math.max(100, toInt(payload.monitorHeight, window.innerHeight || 1080));
    var area = normalizeArea(payload.area || {});

    if (area.preset === 'full') {
      area.x = 0;
      area.y = 0;
      area.width = monitorWidth;
      area.height = monitorHeight;
    }

    area.width = Math.max(20, Math.min(area.width, monitorWidth));
    area.height = Math.max(20, Math.min(area.height, monitorHeight));
    area.x = Math.max(0, Math.min(area.x, Math.max(0, monitorWidth - area.width)));
    area.y = Math.max(0, Math.min(area.y, Math.max(0, monitorHeight - area.height)));

    return {
      monitorWidth: monitorWidth,
      monitorHeight: monitorHeight,
      area: area
    };
  }

  function activePositionPreviewItems(payload) {
    var now = Date.now();
    var items = [];
    if (!payload) return items;

    if (Array.isArray(payload.items) && payload.items.length) {
      for (var i = 0; i < payload.items.length; i++) {
        var item = payload.items[i];
        if (item && item.visible && (!item.expiresAt || item.expiresAt > now)) items.push(item);
      }
      return items;
    }

    if (payload.visible && (!payload.expiresAt || payload.expiresAt > now)) items.push(payload);
    return items;
  }

  function appendPositionPreviewFrame(layer, payload) {
    var normalized = previewAreaFromPayload(payload);
    var scaleX = (window.innerWidth || normalized.monitorWidth) / normalized.monitorWidth;
    var scaleY = (window.innerHeight || normalized.monitorHeight) / normalized.monitorHeight;
    var area = normalized.area;

    var frame = document.createElement('div');
    frame.style.position = 'absolute';
    frame.style.left = Math.round(area.x * scaleX) + 'px';
    frame.style.top = Math.round(area.y * scaleY) + 'px';
    frame.style.width = Math.round(area.width * scaleX) + 'px';
    frame.style.height = Math.round(area.height * scaleY) + 'px';
    frame.style.border = '4px solid ' + themeRgba(.98);
    frame.style.background = themeRgba(.16);
    frame.style.boxShadow = '0 0 0 2px rgba(0, 0, 0, .48), 0 0 24px ' + themeRgba(.85) + ', inset 0 0 22px ' + themeRgba(.28);
    frame.style.boxSizing = 'border-box';

    var label = document.createElement('div');
    label.textContent = (payload.name || 'Overlay-Position') + ' | ' + area.x + ':' + area.y + ' | ' + area.width + 'x' + area.height;
    label.style.position = 'absolute';
    label.style.left = '8px';
    label.style.top = '8px';
    label.style.maxWidth = 'calc(100% - 16px)';
    label.style.padding = '6px 9px';
    label.style.borderRadius = '5px';
    label.style.background = 'rgba(4, 10, 18, .82)';
    label.style.border = '1px solid ' + themeRgba(.62);
    label.style.boxShadow = '0 0 10px ' + themeRgba(.24);
    label.style.color = '#e7f1ff';
    label.style.font = '700 13px Consolas, monospace';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    frame.appendChild(label);

    layer.appendChild(frame);
  }

  function renderPositionPreview(payload) {
    var layer = ensurePreviewLayer();
    var items = activePositionPreviewItems(payload);
    reportPositionPreview(items);
    var signature = items.length ? positionThemeAccent + '|' + JSON.stringify(items) : 'hidden';
    if (signature === lastPreviewSignature) return;
    lastPreviewSignature = signature;

    layer.innerHTML = '';
    for (var i = 0; i < items.length; i++) appendPositionPreviewFrame(layer, items[i]);
  }

  function reportPositionPreview(items) {
    var now = Date.now();
    if (now - lastPreviewAckAt < 1000 || typeof XMLHttpRequest === 'undefined') return;
    lastPreviewAckAt = now;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', POSITION_PREVIEW_ACK_URL, true);
      xhr.timeout = 700;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({
        frames: items.length,
        scriptVersion: POSITION_PREVIEW_SCRIPT_VERSION,
        width: window.innerWidth || 0,
        height: window.innerHeight || 0
      }));
    } catch (err) {}
  }

  function pollPositionPreview() {
    if (typeof XMLHttpRequest === 'undefined') return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', POSITION_PREVIEW_URL + '?t=' + Date.now(), true);
      xhr.timeout = 700;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            renderPositionPreview(JSON.parse(xhr.responseText || '{}'));
          } catch (err) {
            renderPositionPreview(null);
          }
        }
      };
      xhr.onerror = function () { renderPositionPreview(null); };
      xhr.ontimeout = xhr.onerror;
      xhr.send();
    } catch (err) {}
  }

  function makeFrame(link) {
    var frame = document.createElement('iframe');
    var area = normalizeArea(link.area);
    var sourceWidth = bridgeMonitorWidth || window.innerWidth || 1920;
    var sourceHeight = bridgeMonitorHeight || window.innerHeight || 1080;
    var scaleX = (window.innerWidth || sourceWidth) / sourceWidth;
    var scaleY = (window.innerHeight || sourceHeight) / sourceHeight;
    var contentScale = normalizeContentScale(link.contentScale) / 100;
    var baseWidth = area.preset === 'full' ? sourceWidth : Math.min(area.width, sourceWidth);
    var baseHeight = area.preset === 'full' ? sourceHeight : Math.min(area.height, sourceHeight);
    var visualX = area.preset === 'full' ? 0 : Math.max(0, Math.min(area.x, Math.max(0, sourceWidth - baseWidth * contentScale)));
    var visualY = area.preset === 'full' ? 0 : Math.max(0, Math.min(area.y, Math.max(0, sourceHeight - baseHeight * contentScale)));
    frame.title = link.name || 'External Overlay';
    // Kein Referer senden -> wie eine OBS-Browserquelle. Streamlabs & Co. liefern
    // sonst 404, wenn ein fremder Referer (127.0.0.1:<Port>) mitgeschickt wird.
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    // Der Wunsch "Hintergrund entfernen" wird ueber den Fensternamen mitgegeben und
    // MUSS vor der Adresse gesetzt werden: Nur dann kennt ihn das Overlay-Dokument
    // schon beim allerersten Bild. Eine Nachricht kaeme erst nach dem Laden - genau
    // dazwischen war der dunkle Hintergrund kurz zu sehen.
    frame.name = link.transparentBg === true ? 'freakshow-overlay-nobg' : 'freakshow-overlay';
    frame.src = applyConnection(link);
    frame.allow = 'autoplay; fullscreen; clipboard-read; clipboard-write; local-network-access; local-network; loopback-network';
    frame.setAttribute('allowtransparency', 'true');
    frame.style.position = 'absolute';
    frame.style.left = Math.round(visualX * scaleX) + 'px';
    frame.style.top = Math.round(visualY * scaleY) + 'px';
    frame.style.width = area.preset === 'full' ? '100vw' : Math.round(baseWidth * scaleX) + 'px';
    frame.style.height = area.preset === 'full' ? '100vh' : Math.round(baseHeight * scaleY) + 'px';

    // Zuschnitt (Alt beim Ziehen einer Ecke): Der Inhalt behaelt seine Groesse, es
    // wird nur etwas abgeschnitten - wie in OBS. Dafuer rendert das iframe in voller,
    // unbeschnittener Groesse und wird so verschoben, dass der stehen bleibende Rest
    // genau im eingestellten Feld sitzt.
    var crop = normalizeCrop(link.crop);
    if (cropIsActive(crop)) {
      var visibleX = visualX;
      var visibleY = visualY;
      var visibleW = baseWidth;
      var visibleH = baseHeight;
      var keepX = Math.max(0.2, 1 - (crop.left + crop.right) / 100);
      var keepY = Math.max(0.2, 1 - (crop.top + crop.bottom) / 100);
      var fullW = visibleW / keepX;
      var fullH = visibleH / keepY;
      frame.style.width = Math.round(fullW * scaleX) + 'px';
      frame.style.height = Math.round(fullH * scaleY) + 'px';
      // Die sichtbare linke obere Ecke bleibt auch bei zusaetzlicher Skalierung
      // exakt an der gespeicherten Position. Ohne den Faktor wanderte ein
      // zugeschnittenes Overlay beim Skalieren seitlich aus seinem Feld.
      frame.style.left = Math.round((visibleX - fullW * crop.left / 100 * contentScale) * scaleX) + 'px';
      frame.style.top = Math.round((visibleY - fullH * crop.top / 100 * contentScale) * scaleY) + 'px';
      frame.style.clipPath = 'inset(' + crop.top + '% ' + crop.right + '% ' + crop.bottom + '% ' + crop.left + '%)';
    } else {
      frame.style.clipPath = 'none';
    }

    // Skaliert das komplette Web-Overlay mit seinem originalen Layout. Anders als
    // beim Zuschneiden bleibt der gesamte Inhalt erhalten; die linke obere Ecke
    // bleibt als Anker an der gespeicherten Position.
    frame.style.transformOrigin = '0 0';
    frame.style.transform = contentScale === 1 ? 'none' : ('scale(' + contentScale + ')');

    frame.style.border = '0';
    frame.style.margin = '0';
    frame.style.padding = '0';
    frame.style.background = 'transparent';
    frame.style.pointerEvents = 'none';

    // Schalter "Hintergrund entfernen": Fremde Overlay-Seiten liegen in einer
    // anderen Herkunft, ihr Aussehen laesst sich von hier nicht anfassen. Das
    // Ausblenden erledigt darum ein Skript IM Overlay-Dokument (Host.cs); hier wird
    // nur der Wunsch hineingereicht. Mehrfach, weil Single-Page-Overlays ihre
    // Oberflaeche erst nach dem Laden aufbauen.
    var wantsTransparent = link.transparentBg === true;
    backgroundFrames.push({ id: String(link.id || link.url || ''), frame: frame });
    var wantsMuted = link.muted === true;
    function postBackgroundWish() {
      try {
        if (frame.contentWindow) {
          frame.contentWindow.postMessage({ freakshowOverlay: 'background', transparent: wantsTransparent }, '*');
          frame.contentWindow.postMessage({ freakshowOverlay: 'mute', muted: wantsMuted }, '*');
        }
      } catch (err) {}
    }
    // Ohne "autoplay" darf die Seite von sich aus keinen Ton starten - zweite
    // Absicherung neben dem Stummschalten im Dokument selbst.
    if (wantsMuted) frame.allow = 'fullscreen; clipboard-read; clipboard-write; local-network-access; local-network; loopback-network';
    frame.addEventListener('load', function () {
      postBackgroundWish();
      window.setTimeout(postBackgroundWish, 400);
      window.setTimeout(postBackgroundWish, 1500);
      window.setTimeout(postBackgroundWish, 4000);
    });

    return frame;
  }

  // Groesse der Anzeigeflaeche. Aendert sie sich, muessen ALLE Fenster neu
  // vermessen werden - alles andere ist Sache des einzelnen Overlays.
  function geometryKey() {
    var sourceWidth = bridgeMonitorWidth || window.innerWidth || 1920;
    var sourceHeight = bridgeMonitorHeight || window.innerHeight || 1080;
    return 'geometry|' + sourceWidth + 'x' + sourceHeight +
      '|' + (window.innerWidth || sourceWidth) + 'x' + (window.innerHeight || sourceHeight);
  }

  // Alles, was DIESES eine Overlay ausmacht. Nur wenn sich hier etwas aendert,
  // muss sein Fenster neu aufgebaut werden.
  function linkPartSignature(link) {
    return link.id + '|' + link.name + '|' + applyConnection(link) +
      '|bg' + (link.transparentBg === true ? '1' : '0') +
      '|mute' + (link.muted === true ? '1' : '0') +
      '|scale' + normalizeContentScale(link.contentScale) +
      '|crop' + JSON.stringify(normalizeCrop(link.crop)) +
      '|' + JSON.stringify(normalizeArea(link.area));
  }

  // Alle Fenster verwerfen - nur fuer die wenigen Faelle, in denen ein echtes
  // Neuladen gewollt ist (z. B. Internet kam zurueck).
  function dropAllFrames() {
    for (var id in activeFrames) {
      if (!Object.prototype.hasOwnProperty.call(activeFrames, id)) continue;
      var frame = activeFrames[id].frame;
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    }
    activeFrames = {};
    backgroundFrames = [];
    lastSignature = '';
  }

  function signatureFor(links) {
    var parts = [geometryKey()];
    for (var i = 0; i < links.length; i++) parts.push(linkPartSignature(links[i]));
    return parts.join('\n');
  }

  // In der Ausgabe fuer OBS (/freakshow) werden Web-Overlays BEWUSST nicht
  // mitgeschickt: fremde Seiten wie die Twitch-Alertbox verbieten die Einbettung
  // (X-Frame-Options), und andere brauchen dort eine Verbindung, die der Browser
  // je nach Aufbau blockiert. Solche Overlays gehoeren in OBS als EIGENE
  // Browserquelle - dort laufen sie zuverlaessig. Videos, Bilder, Notizen und
  // der Rote Teppich werden weiterhin vollstaendig uebertragen.
  var isOutputViewer = (function () {
    try { return /[?&]outputViewer=1(?:&|$)/.test(String(window.location.search || '')); }
    catch (err) { return false; }
  })();

  function render(force) {
    var configured = getLinks();
    lastConfiguredLinks = configured.slice();
    var links = isOutputViewer ? [] : visibleLinks(configured);
    reportRuntimeState(configured, links);
    var signature = signatureFor(links);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    // NUR aendern, was sich wirklich geaendert hat. Frueher wurde die ganze Ebene
    // geleert und alles neu gebaut - beim Aus- oder Einschalten EINES Overlays
    // luden dadurch ALLE anderen ihre Seite neu und blitzten sichtbar auf.
    // Unveraenderte Fenster bleiben jetzt unangetastet stehen.
    // WICHTIG: Ein bestehendes iframe darf im Baum NICHT verschoben werden - das
    // laedt es neu. Die Stapelreihenfolge kommt deshalb ueber z-index, nicht ueber
    // die Reihenfolge im Baum.
    var layer = ensureLayer();
    var geo = geometryKey();
    var stillThere = {};
    backgroundFrames = [];

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var id = String(link.id || link.url || '');
      var sig = geo + '|' + linkPartSignature(link);
      var known = activeFrames[id];
      var keep = known && known.signature === sig && known.frame.parentNode === layer;
      if (keep) {
        known.frame.style.zIndex = String(1000 - i);
        backgroundFrames.push({ id: id, frame: known.frame });
      } else {
        if (known && known.frame.parentNode) known.frame.parentNode.removeChild(known.frame);
        var frame = makeFrame(link);          // traegt sich selbst in backgroundFrames ein
        frame.style.zIndex = String(1000 - i);
        layer.appendChild(frame);
        activeFrames[id] = { signature: sig, frame: frame };
      }
      stillThere[id] = true;
    }

    // Nicht mehr sichtbare Overlays entfernen.
    for (var gone in activeFrames) {
      if (!Object.prototype.hasOwnProperty.call(activeFrames, gone) || stillThere[gone]) continue;
      if (activeFrames[gone].frame.parentNode) activeFrames[gone].frame.parentNode.removeChild(activeFrames[gone].frame);
      delete activeFrames[gone];
      delete backgroundAckById[gone];
    }

    log('Loaded external overlay link(s).', links);
  }

  // --- Internet-Waechter: nach einem PC-Neustart ist das Netz oft noch nicht
  // bereit, wenn das Overlay startet. Die iframes laden dann ins Leere und
  // wuerden ewig leer bleiben. Darum: Erreichbarkeit der externen Links testen
  // und die Frames SOFORT neu laden, sobald das Internet da ist. ---
  var netKnownGood = false;
  var netProbeTimer = null;
  var NET_PROBE_MS = 3000;

  function externalProbeUrl() {
    var links = getLinks();
    for (var i = 0; i < links.length; i++) {
      var url = String(links[i].url || '');
      if (/^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost|192\.168\.|10\.)/i.test(url)) {
        var m = /^(https?:\/\/[^\/]+)/i.exec(url);
        if (m) return m[1] + '/favicon.ico';
      }
    }
    return '';
  }

  function probeInternet() {
    var probe = externalProbeUrl();
    if (!probe || typeof fetch !== 'function') { netKnownGood = true; return; }
    fetch(probe, { mode: 'no-cors', cache: 'no-store' }).then(function () {
      if (!netKnownGood) {
        netKnownGood = true;
        log('Internet erreichbar - lade externe Overlay-Links neu.');
        // Hier ist ein ECHTES Neuladen gewollt: Die Fenster sind ins Leere
        // geladen, solange das Netz fehlte. Darum ausnahmsweise alle verwerfen.
        dropAllFrames();
        render(true);
      }
      stopNetProbe();
    }).catch(function () {
      netKnownGood = false; // weiter warten; Timer laeuft
    });
  }

  function startNetProbe() {
    if (netProbeTimer) return;
    netProbeTimer = window.setInterval(probeInternet, NET_PROBE_MS);
    probeInternet();
  }
  function stopNetProbe() {
    if (netProbeTimer) { window.clearInterval(netProbeTimer); netProbeTimer = null; }
  }

  window.addEventListener('online', function () {
    netKnownGood = false;   // Verbindung kam (neu) - Frames sicherheitshalber neu laden
    startNetProbe();
  });

  window.kappiExternalOverlays = {
    // Bewusstes Neuladen von aussen: hier sollen die Fenster wirklich neu laden.
    reload: function () { dropAllFrames(); render(true); },
    status: function () {
      return {
        active: true,
        links: visibleLinks(lastConfiguredLinks.length ? lastConfiguredLinks : getLinks()),
        configuredLinks: (lastConfiguredLinks.length ? lastConfiguredLinks : getLinks()).slice(),
        layer: !!document.getElementById('kappi-external-overlay-layer')
      };
    },
    hide: function () {
      var layer = ensureLayer();
      layer.style.display = 'none';
    },
    show: function () {
      var layer = ensureLayer();
      layer.style.display = 'block';
      render(true);
    }
  };

  // Erst die Anbieter-Tabelle laden, DANN zeichnen - sonst wuerden Links im
  // ersten Moment ohne Anbieter-Wissen behandelt und gleich darauf neu geladen.
  function boot() {
    loadProviderTable(function () {
      render(true);
      pollPositionTheme();
      pollPositionPreview();
      pollExternalLinks();
      startNetProbe();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  // Falls der allererste Abruf scheiterte: still nachholen.
  window.setInterval(function () { if (!providerTable) loadProviderTable(null); }, 3000);

  // Rueckmeldung aus einem Overlay-Dokument: Der Schalter "Hintergrund entfernen"
  // hat dieses Overlay erreicht. Die Zuordnung laeuft ueber das sendende Fenster,
  // da fremde Overlays sich sonst nicht auseinanderhalten lassen.
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object' || data.freakshowOverlay !== 'background-ack') return;
    for (var i = 0; i < backgroundFrames.length; i++) {
      try {
        if (backgroundFrames[i].frame.contentWindow === event.source) {
          backgroundAckById[backgroundFrames[i].id] = data.applied === true;
          backgroundSurveyById[backgroundFrames[i].id] = String(data.survey || '').slice(0, 200);
          break;
        }
      } catch (err) {}
    }
  }, false);

  window.addEventListener('storage', function (event) {
    if (!event || event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) render(true);
  });
  window.addEventListener('resize', function () { render(false); });
  window.setInterval(function () { render(false); }, RELOAD_MS);
  window.setInterval(pollPositionPreview, POSITION_PREVIEW_POLL_MS);
  window.setInterval(pollPositionTheme, POSITION_THEME_POLL_MS);
  window.setInterval(pollExternalLinks, EXTERNAL_LINKS_POLL_MS);
  if (!bindTrigger()) {
    var triggerBindTries = 0;
    var triggerBindTimer = window.setInterval(function () {
      if (bindTrigger() || ++triggerBindTries > 60) window.clearInterval(triggerBindTimer);
    }, 1000);
  }
})();
