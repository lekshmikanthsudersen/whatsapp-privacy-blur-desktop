const SETTINGS_PAGE_DEFAULTS = Object.freeze({
  enabled: true,
  blurMessages: true,
  blurPreviews: true,
  blurMedia: true,
  blurGallery: true,
  obscureInput: true,
  blurAvatars: true,
  blurNames: true,
  noTransitionDelay: false,
  unblurOnAppHover: false,
  closeToTray: true,
  temporaryRevealMs: 8000,
  zoomFactor: 1,
  preserveUnreadListPosition: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  focusMode: false,
  memoryWarnMb: 900,
  dailyPrivacyReset: true,
  disableHardwareAcceleration: false,
  captureProtection: false,
  privacyProfile: 'work',
  priorityKeywords: '',
  quickReplyTemplates: ''
});

const controls = new Map();
let applying = false;
let statusElement;

function bridgeHealth(bridge) {
  if (!bridge || typeof bridge !== 'object') {
    return { ok: false, message: 'Settings bridge is unavailable. Preload did not expose window.privacySettings.' };
  }

  for (const method of ['ping', 'get', 'update', 'onUpdate']) {
    if (typeof bridge[method] !== 'function') {
      return { ok: false, message: `Settings bridge is missing ${method}().` };
    }
  }

  return { ok: true };
}

function ensureStatus(documentRef = document) {
  if (statusElement && documentRef.body.contains(statusElement)) {
    return statusElement;
  }

  statusElement = documentRef.createElement('div');
  statusElement.className = 'status-banner';
  statusElement.hidden = true;
  const shell = documentRef.querySelector('.shell') || documentRef.body;
  const header = documentRef.querySelector('.header');
  if (header?.parentElement) {
    header.insertAdjacentElement('afterend', statusElement);
  } else {
    shell.prepend(statusElement);
  }
  return statusElement;
}

function showStatus(message, tone = 'error', documentRef = document) {
  const target = ensureStatus(documentRef);
  target.textContent = message;
  target.dataset.tone = tone;
  target.hidden = false;
}

function clearStatus(documentRef = document) {
  const target = ensureStatus(documentRef);
  target.hidden = true;
  target.textContent = '';
}

function readControlValue(control) {
  if (control.type === 'checkbox') {
    return control.checked;
  }
  if (control.dataset.value === 'number') {
    return Number(control.value);
  }
  return control.value;
}

function collectControls(bridge, documentRef = document) {
  controls.clear();

  for (const control of documentRef.querySelectorAll('[data-setting]')) {
    controls.set(control.dataset.setting, control);
    control.addEventListener('change', async () => {
      if (applying) {
        return;
      }

      try {
        await bridge.update({
          [control.dataset.setting]: readControlValue(control)
        });
        showStatus('Settings saved.', 'ok', documentRef);
      } catch (error) {
        showStatus(`Settings update failed: ${error.message}`, 'error', documentRef);
      }
    });
  }
}

function render(settings) {
  applying = true;
  for (const [key, control] of controls) {
    if (control.type === 'checkbox') {
      control.checked = Boolean(settings[key]);
    } else {
      control.value = settings[key] === undefined ? '' : String(settings[key]);
    }
  }
  applying = false;
}

async function boot(root = window, documentRef = document) {
  const bridge = root.privacySettings;
  const health = bridgeHealth(bridge);

  if (!health.ok) {
    collectControls({ update: async () => undefined }, documentRef);
    render(SETTINGS_PAGE_DEFAULTS);
    showStatus(health.message, 'error', documentRef);
    return { ok: false, reason: health.message };
  }

  try {
    if (bridge.ping() !== true) {
      throw new Error('settings bridge ping failed');
    }

    collectControls(bridge, documentRef);
    render(await bridge.get());
    bridge.onUpdate((settings) => {
      render(settings);
      clearStatus(documentRef);
    });
    clearStatus(documentRef);
    return { ok: true };
  } catch (error) {
    if (controls.size === 0) {
      collectControls(bridge, documentRef);
    }
    render(SETTINGS_PAGE_DEFAULTS);
    showStatus(`Settings loaded in fallback mode: ${error.message}`, 'error', documentRef);
    return { ok: false, reason: error.message };
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot();
}

if (typeof module !== 'undefined') {
  module.exports = {
    SETTINGS_PAGE_DEFAULTS,
    boot,
    bridgeHealth,
    readControlValue,
    render
  };
}
