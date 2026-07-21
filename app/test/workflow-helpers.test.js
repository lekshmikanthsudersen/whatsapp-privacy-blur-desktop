const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAttentionParts,
  buildTrayTooltip,
  buildWhatsAppUserAgent,
  isQuietHoursActive,
  normalizeProcessMemory,
  parseClock,
  parseUnreadCount,
  priorityTermsFromText,
  quickReplyEntriesFromText,
  quickReplyTemplatesFromText,
  redactDiagnostics,
  sanitizeSettings
} = require('../src/workflow-helpers');

const defaults = {
  enabled: true,
  closeToTray: true,
  focusMode: false,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  memoryWarnMb: 900,
  temporaryRevealMs: 8000,
  zoomFactor: 1,
  priorityKeywords: '',
  quickReplyTemplates: 'Default reply'
};

const schema = {
  defaults,
  booleanKeys: ['enabled', 'closeToTray', 'focusMode', 'quietHoursEnabled'],
  numberSettings: {
    memoryWarnMb: { min: 256, max: 8192, fallback: defaults.memoryWarnMb },
    temporaryRevealMs: { min: 3000, max: 30000, fallback: defaults.temporaryRevealMs },
    zoomFactor: { min: 0.75, max: 1.5, fallback: defaults.zoomFactor }
  },
  stringSettings: {
    quietHoursStart: { maxLength: 5, fallback: defaults.quietHoursStart },
    quietHoursEnd: { maxLength: 5, fallback: defaults.quietHoursEnd },
    priorityKeywords: { maxLength: 20, fallback: defaults.priorityKeywords },
    quickReplyTemplates: { maxLength: 30, fallback: defaults.quickReplyTemplates }
  }
};

test('settings sanitization keeps supported workflow values and clamps numbers', () => {
  const settings = sanitizeSettings(
    {
      enabled: false,
      focusMode: true,
      closeToTray: 'yes',
      memoryWarnMb: 12000,
      temporaryRevealMs: 250,
      zoomFactor: '1.25',
      priorityKeywords: 'Alice, Bob, Charlie',
      quickReplyTemplates: 'Line one\nLine two\nLine three that is very long',
      quietHoursStart: '23:30',
      quietHoursEnd: '07:00'
    },
    schema
  );

  assert.equal(settings.enabled, false);
  assert.equal(settings.focusMode, true);
  assert.equal(settings.closeToTray, defaults.closeToTray);
  assert.equal(settings.memoryWarnMb, 8192);
  assert.equal(settings.temporaryRevealMs, 3000);
  assert.equal(settings.zoomFactor, 1.25);
  assert.equal(settings.priorityKeywords, 'Alice, Bob, Charlie');
  assert.equal(settings.quickReplyTemplates, 'Line one\nLine two\nLine three t');
  assert.equal(settings.quietHoursStart, '23:30');
  assert.equal(settings.quietHoursEnd, '07:00');
});

test('quiet hours handle disabled, same-day, and overnight windows', () => {
  assert.equal(parseClock('22:15'), 1335);
  assert.equal(parseClock('25:00'), undefined);

  assert.equal(
    isQuietHoursActive({ quietHoursEnabled: false, quietHoursStart: '09:00', quietHoursEnd: '17:00' }, new Date('2026-01-01T10:00:00')),
    false
  );

  assert.equal(
    isQuietHoursActive({ quietHoursEnabled: true, quietHoursStart: '09:00', quietHoursEnd: '17:00' }, new Date('2026-01-01T10:00:00')),
    true
  );
  assert.equal(
    isQuietHoursActive({ quietHoursEnabled: true, quietHoursStart: '09:00', quietHoursEnd: '17:00' }, new Date('2026-01-01T18:00:00')),
    false
  );
  assert.equal(
    isQuietHoursActive({ quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '08:00' }, new Date('2026-01-01T23:00:00')),
    true
  );
  assert.equal(
    isQuietHoursActive({ quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '08:00' }, new Date('2026-01-01T07:30:00')),
    true
  );
});

test('quick replies and priority terms parse local settings without message content storage', () => {
  const manyTemplates = Array.from({ length: 14 }, (_item, index) => `Template ${index + 1}`).join('\n');
  assert.deepEqual(quickReplyTemplatesFromText('  Thanks \n\n On it\r\nDone  '), ['Thanks', 'On it', 'Done']);
  assert.equal(quickReplyTemplatesFromText(manyTemplates).length, 12);
  assert.deepEqual(priorityTermsFromText(' Alice, Bob\nTEAM '), ['alice', 'bob', 'team']);
});

test('quick replies support local categories without changing insert text', () => {
  assert.deepEqual(quickReplyEntriesFromText('Sales :: I will send the quote today.\nOn it'), [
    { category: 'Sales', text: 'I will send the quote today.' },
    { category: 'General', text: 'On it' }
  ]);
  assert.deepEqual(quickReplyTemplatesFromText('Sales :: I will send the quote today.'), ['I will send the quote today.']);
});

test('unread count is title-based only', () => {
  assert.equal(parseUnreadCount('(12) WhatsApp'), 12);
  assert.equal(parseUnreadCount('(3) WhatsApp Business'), 3);
  assert.equal(parseUnreadCount('WhatsApp'), 0);
  assert.equal(parseUnreadCount('Chat with (12) inside'), 0);
});

test('memory metrics normalize renderer and total private memory defensively', () => {
  const oneMb = 1048576;
  const memory = normalizeProcessMemory([
    { type: 'Browser', memory: { privateBytes: 100 * oneMb } },
    { type: 'Tab', memory: { privateBytes: 450 * oneMb } },
    { type: 'Renderer', memory: { privateBytes: 50 * oneMb } },
    { type: 'Utility', memory: { privateBytes: 25 * oneMb } },
    { type: 'GPU', memory: {} },
    { type: 'Unknown' }
  ]);

  assert.equal(memory.totalPrivateMb, 625);
  assert.equal(memory.rendererPrivateMb, 500);
});

test('tray attention respects focus mode, priority, quiet hours, and memory warnings', () => {
  const baseSettings = { focusMode: false, memoryWarnMb: 900 };
  assert.deepEqual(
    buildAttentionParts({
      unreadCount: 7,
      hasPriorityUnread: false,
      settings: baseSettings,
      memorySample: { totalPrivateMb: 650 },
      quiet: false
    }),
    { parts: ['7 unread'], suppressAttention: false }
  );

  assert.deepEqual(
    buildAttentionParts({
      unreadCount: 7,
      hasPriorityUnread: false,
      settings: { ...baseSettings, focusMode: true },
      memorySample: { totalPrivateMb: 950 },
      quiet: false
    }),
    { parts: ['High memory 950 MB'], suppressAttention: true }
  );

  assert.deepEqual(
    buildAttentionParts({
      unreadCount: 7,
      hasPriorityUnread: true,
      settings: { ...baseSettings, focusMode: true },
      memorySample: { totalPrivateMb: 950 },
      quiet: false
    }),
    { parts: ['7 unread', 'Priority unread', 'High memory 950 MB'], suppressAttention: false }
  );

  assert.deepEqual(
    buildAttentionParts({
      unreadCount: 7,
      hasPriorityUnread: true,
      settings: baseSettings,
      memorySample: { totalPrivateMb: 950 },
      quiet: true
    }),
    { parts: ['High memory 950 MB'], suppressAttention: true }
  );

  assert.equal(buildTrayTooltip(['7 unread', 'High memory 950 MB']), 'WhatsApp Privacy Blur (7 unread, High memory 950 MB)');
});

test('dynamic WhatsApp user agent uses the runtime Chromium version', () => {
  const userAgent = buildWhatsAppUserAgent('142.0.7444.162');
  assert.match(userAgent, /Windows NT 10\.0; Win64; x64/);
  assert.match(userAgent, /Chrome\/142\.0\.7444\.162/);
  assert.match(userAgent, /Safari\/537\.36$/);
});

test('diagnostics redacts user-authored text and operating-system identifiers', () => {
  const diagnostics = redactDiagnostics({
    app: { name: 'WhatsApp Privacy Blur', version: '1.0.0', appId: 'local.test', exePath: 'C:\\Users\\Private\\app.exe', userAgent: 'fingerprint' },
    paths: { userData: 'C:\\Users\\Private\\AppData' },
    settings: {
      enabled: true,
      priorityKeywords: 'Private Client',
      quickReplyTemplates: 'Sensitive reply'
    },
    processes: [{ pid: 123, type: 'Renderer', privateMb: 512, cpuPercent: 2.5, workingSetMb: 700, sharedMb: 42 }]
  });

  assert.equal(diagnostics.settings.enabled, true);
  assert.equal(diagnostics.settings.priorityKeywords, '[redacted]');
  assert.equal(diagnostics.settings.quickReplyTemplates, '[redacted]');
  assert.deepEqual(diagnostics.processes, [{ type: 'Renderer', privateMb: 512, cpuPercent: 2.5, workingSetMb: 700, sharedMb: 42 }]);
  assert.deepEqual(diagnostics.app, { name: 'WhatsApp Privacy Blur', version: '1.0.0', appId: 'local.test' });
  assert.equal(Object.hasOwn(diagnostics, 'paths'), false);
});
