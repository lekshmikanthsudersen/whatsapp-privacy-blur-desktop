const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SETTINGS_PAGE_DEFAULTS,
  boot,
  bridgeHealth
} = require('../src/settings');

function createControl(setting, options = {}) {
  return {
    dataset: { setting, value: options.valueType },
    type: options.type || 'text',
    value: options.value || '',
    checked: false,
    listeners: {},
    addEventListener(eventName, callback) {
      this.listeners[eventName] = callback;
    }
  };
}

function createFakeDocument() {
  const controls = [
    createControl('enabled', { type: 'checkbox' }),
    createControl('temporaryRevealMs', { type: 'number', valueType: 'number' }),
    createControl('priorityKeywords', { value: '' })
  ];

  const documentRef = {
    statusElement: undefined,
    body: {
      contains: (element) => Boolean(element && element === documentRef.statusElement)
    },
    createElement: () => ({
      className: '',
      dataset: {},
      hidden: false,
      textContent: ''
    }),
    querySelector(selector) {
      if (selector === '.shell') {
        return {
          prepend: (element) => {
            documentRef.statusElement = element;
          }
        };
      }
      if (selector === '.header') {
        return {
          parentElement: {},
          insertAdjacentElement: (_position, element) => {
            documentRef.statusElement = element;
          }
        };
      }
      return undefined;
    },
    querySelectorAll: (selector) => (selector === '[data-setting]' ? controls : [])
  };

  return { controls, documentRef };
}

test('settings bridge health reports missing preload bridge', () => {
  assert.deepEqual(bridgeHealth(undefined), {
    ok: false,
    message: 'Settings bridge is unavailable. Preload did not expose window.privacySettings.'
  });
});

test('settings page renders fallback controls when bridge is missing', async () => {
  const { controls, documentRef } = createFakeDocument();
  const result = await boot({}, documentRef);

  assert.equal(result.ok, false);
  assert.match(result.reason, /Settings bridge is unavailable/);
  assert.equal(controls[0].checked, SETTINGS_PAGE_DEFAULTS.enabled);
  assert.equal(controls[1].value, String(SETTINGS_PAGE_DEFAULTS.temporaryRevealMs));
  assert.equal(documentRef.statusElement.hidden, false);
  assert.match(documentRef.statusElement.textContent, /Settings bridge is unavailable/);
});

test('settings page renders fallback controls when settings:get rejects', async () => {
  const { controls, documentRef } = createFakeDocument();
  const bridge = {
    ping: () => true,
    get: async () => {
      throw new Error('IPC unavailable');
    },
    update: async () => undefined,
    onUpdate: () => undefined
  };

  const result = await boot({ privacySettings: bridge }, documentRef);

  assert.equal(result.ok, false);
  assert.match(result.reason, /IPC unavailable/);
  assert.equal(controls[0].checked, SETTINGS_PAGE_DEFAULTS.enabled);
  assert.equal(controls[1].value, String(SETTINGS_PAGE_DEFAULTS.temporaryRevealMs));
  assert.equal(documentRef.statusElement.hidden, false);
  assert.match(documentRef.statusElement.textContent, /fallback mode: IPC unavailable/);
});
