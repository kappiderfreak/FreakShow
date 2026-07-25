(function () {
  'use strict';

  // Streamer.bot laeuft oft auf einem zweiten PC. Deshalb empfaengt das echte
  // FreakShow-Overlay das General.Custom-Signal und beauftragt erst hier die
  // lokale Bridge/AHK-Engine. So wird niemals 127.0.0.1 auf dem Streamer.bot-PC
  // mit dem FreakShow-PC verwechselt.
  var OUTPUT_RECEIVER_ACTION = {
    name: 'FreakShow - Output Receiver Live'
  };
  var LEGACY_OUTPUT_RECEIVER_ACTION = {
    name: 'FreakShow - Output Receiver'
  };
  var outputReceiverWarningShown = false;
  var statusImageRoot = null;
  var activeStatusImages = {};

  function formatGameControlTime(durationMs) {
    var totalSeconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return String(hours).padStart(2, '0') + ':' +
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0');
  }

  function sendOutputToStreamerBot(output) {
    var client = window.client;
    if (!output || !client || typeof client.doAction !== 'function') return;
    var durationMs = Math.max(0, Math.round(Number(output.durationMs) || 0));
    var args = {
      fsModule: String(output.module || 'gameControl'),
      fsState: String(output.state || 'started'),
      fsName: String(output.name || ''),
      fsId: String(output.id || ''),
      fsTrigger: String(output.trigger || ''),
      fsActive: output.active === true,
      fsDurationMs: durationMs,
      fsTime: String(output.formattedTime || formatGameControlTime(durationMs))
    };
    client.doAction(OUTPUT_RECEIVER_ACTION, args).catch(function () {
      // Bestehende Installationen funktionieren weiter, bis das neue zentrale
      // Modul einmalig importiert wurde.
      return client.doAction(LEGACY_OUTPUT_RECEIVER_ACTION, args);
    }).catch(function (error) {
      if (outputReceiverWarningShown) return;
      outputReceiverWarningShown = true;
      console.error('[FreakShow Game Control] Output-Receiver konnte nicht aufgerufen werden:', error);
    });
  }

  function statusImageUrl(path) {
    path = String(path || '').trim();
    if (!path) return '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(path)) return path;
    var parts = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').split('/');
    for (var i = 0; i < parts.length; i++) parts[i] = encodeURIComponent(parts[i]);
    return '/content/' + parts.join('/');
  }

  function ensureStatusImageRoot() {
    if (statusImageRoot && statusImageRoot.parentNode) return statusImageRoot;
    statusImageRoot = document.createElement('div');
    statusImageRoot.id = 'freakshow-game-control-status-images';
    statusImageRoot.setAttribute('aria-hidden', 'true');
    statusImageRoot.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147482000;';
    (document.body || document.documentElement).appendChild(statusImageRoot);
    return statusImageRoot;
  }

  function hideStatusImage(id) {
    id = String(id || '');
    var active = activeStatusImages[id];
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    if (active.element && active.element.parentNode) active.element.parentNode.removeChild(active.element);
    delete activeStatusImages[id];
  }

  function showStatusImage(output) {
    var id = String(output && output.id || '').trim();
    if (!id) return;
    if (!output.active || output.state === 'stopped') {
      hideStatusImage(id);
      return;
    }
    var image = output.statusImage;
    if (!image || image.enabled !== true || !String(image.path || '').trim()) return;

    hideStatusImage(id);
    var element = document.createElement('img');
    element.alt = '';
    element.src = statusImageUrl(image.path);
    element.setAttribute('data-game-control-status-id', id);
    var x = Math.max(0, Math.min(99, Number(image.x) || 0));
    var y = Math.max(0, Math.min(99, Number(image.y) || 0));
    var width = Math.max(1, Math.min(100, Number(image.width) || 30));
    var height = Math.max(1, Math.min(100, Number(image.height) || 30));
    if (x + width > 100) x = 100 - width;
    if (y + height > 100) y = 100 - height;
    var opacity = Math.max(0, Math.min(100, Number(image.opacity) || 0)) / 100;
    element.style.cssText = 'position:absolute;display:block;object-fit:contain;pointer-events:none;user-select:none;' +
      'left:' + x + '%;top:' + y + '%;width:' + width + '%;height:' + height + '%;opacity:' + opacity + ';';
    ensureStatusImageRoot().appendChild(element);

    // Dieselbe Steuerung erneut ausloesen = ihre Bildlaufzeit beginnt neu.
    // Andere aktive Steuerungen behalten ihr eigenes Element und ihren Timer.
    var durationMs = Math.max(0, Math.round(Number(output.durationMs) || 0));
    if (durationMs <= 0) durationMs = 3000;
    activeStatusImages[id] = {
      element: element,
      timer: setTimeout(function () { hideStatusImage(id); }, durationMs)
    };
  }

  function customData(payload) {
    var data = payload && payload.data ? payload.data : {};
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') {
      data = data.data;
    }
    return data && typeof data === 'object' ? data : {};
  }

  function trueSignals(data) {
    var result = [];
    Object.keys(data).some(function (name) {
      if (data[name] === true && name.length > 0 && name.length <= 120) result.push(name);
      return result.length >= 32;
    });
    return result;
  }

  function dynamicSignals(data) {
    var result = [];
    var source = data && data.freakShowGameControl;
    if (source && typeof source === 'object') {
      var legacyTrigger = String(source.trigger || '').trim();
      var legacyInput = String(source.input || '').trim();
      if (legacyTrigger && legacyTrigger.length <= 120 && legacyInput && legacyInput.length <= 40) {
        result.push({ trigger: legacyTrigger, input: legacyInput });
      }
    }
    Object.keys(data).some(function (trigger) {
      if (trigger === 'freakShowGameControl' || typeof data[trigger] !== 'string') return false;
      var input = String(data[trigger] || '').trim();
      if (trigger && trigger.length <= 120 && input && input.length <= 40) {
        result.push({ trigger: trigger, input: input });
      }
      return result.length >= 32;
    });
    return result;
  }

  function runSignals(signals, dynamic) {
    dynamic = Array.isArray(dynamic) ? dynamic : [];
    if (!signals.length && !dynamic.length) return;
    fetch('/game-control/runtime-trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FreakShow-Runtime': 'overlay'
      },
      body: JSON.stringify({ triggers: signals, dynamic: dynamic }),
      cache: 'no-store'
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (result) {
      var outputs = result && Array.isArray(result.outputs) ? result.outputs : [];
      for (var i = 0; i < outputs.length; i++) {
        showStatusImage(outputs[i]);
        sendOutputToStreamerBot(outputs[i]);
      }
      if (result && result.count > 0) {
        console.log('[FreakShow Game Control] Streamer.bot-Trigger gestartet:', result.ids || signals);
      }
    }).catch(function (error) {
      console.error('[FreakShow Game Control] Trigger konnte nicht gestartet werden:', error);
    });
  }

  function onCustom(payload) {
    var data = customData(payload);
    runSignals(trueSignals(data), dynamicSignals(data));
  }

  if (window.client && typeof window.client.on === 'function') {
    window.client.on('General.Custom', onCustom);
  } else {
    console.error('[FreakShow Game Control] Streamer.bot-Client fehlt.');
  }
})();
