const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isSafeExternalUrl,
  isWhatsAppPermissionRequest,
  isWhatsAppUrl,
  normalizeSelectorHealth,
  validateChatTitle,
  validateSettingsPatch
} = require('../src/security-helpers');

test('navigation only accepts HTTPS WhatsApp content and safe external URLs', () => {
  assert.equal(isWhatsAppUrl('https://web.whatsapp.com/'), true);
  assert.equal(isWhatsAppUrl('https://web.whatsapp.com.evil.example/'), false);
  assert.equal(isWhatsAppUrl('http://web.whatsapp.com/'), false);
  assert.equal(isSafeExternalUrl('https://example.com/support'), true);
  assert.equal(isSafeExternalUrl('mailto:test@example.com'), false);
  assert.equal(isSafeExternalUrl('https://user:pass@example.com'), false);
});

test('permission broker only permits media from the WhatsApp origin', () => {
  assert.equal(isWhatsAppPermissionRequest('media', 'https://web.whatsapp.com/'), true);
  assert.equal(isWhatsAppPermissionRequest('notifications', 'https://web.whatsapp.com/'), false);
  assert.equal(isWhatsAppPermissionRequest('media', 'https://example.com/'), false);
});

test('IPC payload guards reject unsupported settings and unsafe chat titles', () => {
  const allowed = new Set(['enabled', 'privacyProfile']);
  assert.deepEqual(validateSettingsPatch({ enabled: false }, allowed), { ok: true, patch: { enabled: false } });
  assert.equal(validateSettingsPatch({ unknown: true }, allowed).ok, false);
  assert.equal(validateSettingsPatch([], allowed).ok, false);
  assert.deepEqual(validateChatTitle('  Project  Alpha  '), { ok: true, value: 'Project Alpha' });
  assert.equal(validateChatTitle('').ok, false);
  assert.equal(validateChatTitle('x'.repeat(257)).ok, false);
});

test('selector health reports bounded counts and no DOM content', () => {
  const health = normalizeSelectorHealth({
    scanMode: 'scoped',
    messageTargets: 4,
    previewTargets: 2,
    mediaTargets: 1,
    galleryTargets: 1,
    avatarTargets: 3,
    inputTargets: 1,
    conversationFound: true,
    chatListFound: true,
    chatTitle: 'must not be reported'
  });

  assert.equal(health.scanMode, 'scoped');
  assert.equal(health.messageTargets, 4);
  assert.equal(Object.hasOwn(health, 'chatTitle'), false);
  assert.equal(normalizeSelectorHealth({ messageTargets: -1 }).messageTargets, 0);
});
