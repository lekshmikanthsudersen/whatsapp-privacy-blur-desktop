const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  buildAttentionParts,
  buildTrayTooltip,
  buildWhatsAppUserAgent,
  isQuietHoursActive: isQuietHoursActiveForSettings,
  normalizeProcessMemory,
  parseUnreadCount,
  priorityTermsFromText,
  quickReplyEntriesFromText,
  quickReplyTemplatesFromText,
  redactDiagnostics,
  sanitizeSettings: sanitizeSettingsWithSchema
} = require('./workflow-helpers');
const {
  isSafeExternalUrl,
  isSameWebContents,
  isWhatsAppPermissionRequest,
  isWhatsAppUrl,
  normalizeSelectorHealth,
  validateChatTitle,
  validateSettingsPatch
} = require('./security-helpers');

const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/';
const USER_AGENT = buildWhatsAppUserAgent(process.versions.chrome);
const APP_ID = 'local.whatsappprivacyblur.app';
const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.ico');
const APP_TRAY_ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const SESSION_PARTITION = 'persist:whatsapp-privacy-blur';

app.setAppUserModelId(APP_ID);
app.enableSandbox();

const DEFAULT_SETTINGS = Object.freeze({
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
  hasCompletedFirstRun: false,
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
  quickReplyTemplates: 'Thanks, I will check and update you.\nGot it. I will get back to you soon.\nI am currently away from my desk.'
});

const BOOLEAN_SETTINGS = Object.freeze(
  Object.keys(DEFAULT_SETTINGS).filter((key) => typeof DEFAULT_SETTINGS[key] === 'boolean')
);

const NUMBER_SETTINGS = Object.freeze({
  temporaryRevealMs: { min: 3000, max: 30000, fallback: DEFAULT_SETTINGS.temporaryRevealMs },
  zoomFactor: { min: 0.75, max: 1.5, fallback: DEFAULT_SETTINGS.zoomFactor },
  memoryWarnMb: { min: 256, max: 8192, fallback: DEFAULT_SETTINGS.memoryWarnMb }
});

const STRING_SETTINGS = Object.freeze({
  quietHoursStart: { maxLength: 5, fallback: DEFAULT_SETTINGS.quietHoursStart },
  quietHoursEnd: { maxLength: 5, fallback: DEFAULT_SETTINGS.quietHoursEnd },
  priorityKeywords: { maxLength: 1000, fallback: DEFAULT_SETTINGS.priorityKeywords },
  quickReplyTemplates: { maxLength: 3000, fallback: DEFAULT_SETTINGS.quickReplyTemplates },
  privacyProfile: { maxLength: 16, fallback: DEFAULT_SETTINGS.privacyProfile }
});

const PRIVACY_PROFILES = Object.freeze({
  work: {
    label: 'Work',
    description: 'Balanced privacy for normal daily work.',
    settings: { blurMessages: true, blurPreviews: true, blurMedia: true, blurGallery: true, obscureInput: true, blurAvatars: true, blurNames: true, noTransitionDelay: false, unblurOnAppHover: false }
  },
  presentation: {
    label: 'Presentation',
    description: 'Lock down all chat surfaces before sharing your screen.',
    settings: { blurMessages: true, blurPreviews: true, blurMedia: true, blurGallery: true, obscureInput: true, blurAvatars: true, blurNames: true, noTransitionDelay: true, unblurOnAppHover: false, focusMode: true, captureProtection: true }
  },
  private: {
    label: 'Private',
    description: 'Maximum blur with no pointer-based reveal.',
    settings: { blurMessages: true, blurPreviews: true, blurMedia: true, blurGallery: true, obscureInput: true, blurAvatars: true, blurNames: true, noTransitionDelay: true, unblurOnAppHover: false }
  }
});

const PRIVACY_SETTING_LABELS = Object.freeze({
  enabled: 'Privacy blur',
  blurMessages: 'All messages in chat',
  blurPreviews: 'Last message previews',
  blurMedia: 'Media previews',
  blurGallery: 'Media gallery thumbnails',
  obscureInput: 'Text input obfuscation',
  blurAvatars: 'Profile pictures',
  blurNames: 'Group/user names',
  noTransitionDelay: 'No transition delay',
  unblurOnAppHover: 'Unblur all on app hover'
});

const FIRST_RUN_PRESETS = Object.freeze({
  strict: {
    ...DEFAULT_SETTINGS,
    hasCompletedFirstRun: true,
    closeToTray: true
  },
  balanced: {
    ...DEFAULT_SETTINGS,
    hasCompletedFirstRun: true
  },
  light: {
    ...DEFAULT_SETTINGS,
    hasCompletedFirstRun: true,
    blurMessages: false,
    obscureInput: false
  }
});

const ZOOM_PRESETS = Object.freeze([
  { label: 'Compact 90%', value: 0.9 },
  { label: 'Default 100%', value: 1 },
  { label: 'Comfortable 110%', value: 1.1 },
  { label: 'Large 125%', value: 1.25 }
]);

let mainWindow;
let settingsWindow;
let firstRunWindow;
let diagnosticsWindow;
let tray;
let settings = { ...DEFAULT_SETTINGS };
let alwaysOnTop = false;
let unreadCount = 0;
let isQuitting = false;
let hasPriorityUnread = false;
let memorySamples = [];
let lastOptimizeResult;
let whatsappLoaded = false;
let lastNotifiedUnreadCount = 0;
let optimizeInFlight = false;
const pendingWhatsAppCommands = [];
const runtimeDiagnostics = {
  events: [],
  lastPreloadError: undefined,
  lastRendererGone: undefined,
  lastDidFailLoad: undefined,
  lastSettingsIpcFailure: undefined,
  lastConsoleMessage: undefined,
  lastMediaDiagnostics: undefined,
  selectorHealth: undefined,
  permissionDecisions: []
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function logPath() {
  return path.join(app.getPath('userData'), 'logs', 'app.log');
}

function safeLogDetails(details) {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function logEvent(scope, message, details) {
  const entry = {
    at: new Date().toISOString(),
    scope,
    message,
    details: safeLogDetails(details)
  };

  runtimeDiagnostics.events = [...runtimeDiagnostics.events.slice(-49), entry];

  try {
    const target = logPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Logging must never break the app.
  }

  return entry;
}

function readRawSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function readHardwareAccelerationPreference() {
  return sanitizeSettings(readRawSettingsFile()).disableHardwareAcceleration;
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    settings = sanitizeSettings(parsed);
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function sanitizeSettings(candidate) {
  const next = sanitizeSettingsWithSchema(candidate, {
    defaults: DEFAULT_SETTINGS,
    booleanKeys: BOOLEAN_SETTINGS,
    numberSettings: NUMBER_SETTINGS,
    stringSettings: STRING_SETTINGS
  });

  if (!Object.hasOwn(PRIVACY_PROFILES, next.privacyProfile)) {
    next.privacyProfile = DEFAULT_SETTINGS.privacyProfile;
  }
  return next;
}

function writeSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function showWhatsAppToast(message) {
  if (isQuietHoursActive()) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('whatsapp-command', { type: 'show-toast', message });
  }
}

function isQuietHoursActive(date = new Date()) {
  return isQuietHoursActiveForSettings(settings, date);
}

function totalPrivateMemoryMb() {
  return normalizeProcessMemory(app.getAppMetrics()).totalPrivateMb;
}

function rendererPrivateMemoryMb() {
  return normalizeProcessMemory(app.getAppMetrics()).rendererPrivateMb;
}

function sampleMemory() {
  const sample = {
    at: new Date().toISOString(),
    totalPrivateMb: Number(totalPrivateMemoryMb().toFixed(1)),
    rendererPrivateMb: Number(rendererPrivateMemoryMb().toFixed(1))
  };
  memorySamples = [...memorySamples.slice(-4), sample];
  return sample;
}

function readIcoEntries(filePath) {
  try {
    const bytes = fs.readFileSync(filePath);
    const count = bytes.readUInt16LE(4);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 6 + index * 16;
      entries.push({
        width: bytes[offset] === 0 ? 256 : bytes[offset],
        height: bytes[offset + 1] === 0 ? 256 : bytes[offset + 1],
        bitCount: bytes.readUInt16LE(offset + 6),
        bytes: bytes.readUInt32LE(offset + 8)
      });
    }
    return entries;
  } catch {
    return [];
  }
}

function validateLocalFiles(scope, filePaths) {
  const missing = filePaths.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    logEvent(scope, 'local file validation failed', { missing });
    return false;
  }
  logEvent(scope, 'local file validation passed', { files: filePaths });
  return true;
}

function attachWindowLogging(win, scope) {
  const wc = win.webContents;

  wc.on('console-message', (_event, level, message, line, sourceId) => {
    runtimeDiagnostics.lastConsoleMessage = logEvent(scope, 'console-message', {
      level,
      line
    });
  });

  wc.on('preload-error', (_event, preloadPath, error) => {
    runtimeDiagnostics.lastPreloadError = logEvent(scope, 'preload-error');
  });

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    runtimeDiagnostics.lastDidFailLoad = logEvent(scope, 'did-fail-load', {
      errorCode,
      isMainFrame
    });
  });

  wc.on('render-process-gone', (_event, details) => {
    runtimeDiagnostics.lastRendererGone = logEvent(scope, 'render-process-gone', details);
  });

  wc.on('unresponsive', () => {
    logEvent(scope, 'webContents unresponsive');
  });

  wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    logEvent(scope, 'did-start-navigation', { isInPlace, isMainFrame });
  });

  wc.on('did-navigate', (_event, url) => {
    logEvent(scope, 'did-navigate');
  });

  wc.on('did-finish-load', () => {
    logEvent(scope, 'did-finish-load');
  });

  win.on('unresponsive', () => {
    logEvent(scope, 'window unresponsive');
  });
}

function priorityKeywords() {
  return priorityTermsFromText(settings.priorityKeywords);
}

function quickReplyTemplates() {
  return quickReplyTemplatesFromText(settings.quickReplyTemplates);
}

function quickReplyEntries() {
  return quickReplyEntriesFromText(settings.quickReplyTemplates);
}

function broadcastSettings() {
  mainWindow?.webContents.send('privacy-settings-updated', settings);
  settingsWindow?.webContents.send('privacy-settings-updated', settings);
  firstRunWindow?.webContents.send('privacy-settings-updated', settings);
  updateTray();
  rebuildMenu();
}

function applyZoomFactor() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(settings.zoomFactor);
  }
}

function applyCaptureProtection() {
  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setContentProtection === 'function') {
    mainWindow.setContentProtection(Boolean(settings.captureProtection));
  }
}

function applyPrivacyProfile(profileName) {
  const profile = PRIVACY_PROFILES[profileName] || PRIVACY_PROFILES.work;
  return updateSettings({ ...profile.settings, privacyProfile: profileName === 'presentation' || profileName === 'private' ? profileName : 'work' });
}

function recordPermissionDecision(permission, allowed) {
  const decision = { at: new Date().toISOString(), permission, allowed: Boolean(allowed) };
  runtimeDiagnostics.permissionDecisions = [...runtimeDiagnostics.permissionDecisions.slice(-19), decision];
  logEvent('permission', 'permission-decision', { allowed: Boolean(allowed) });
}

function configureWhatsAppPermissions(webContents) {
  const session = webContents.session;
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const allowed = isWhatsAppPermissionRequest(permission, requestingOrigin);
    recordPermissionDecision(permission, allowed);
    return allowed;
  });
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const allowed = isWhatsAppPermissionRequest(permission, details?.requestingUrl || '');
    recordPermissionDecision(permission, allowed);
    callback(allowed);
  });
}

function sendPrivacySafeNotification(nextUnreadCount) {
  if (nextUnreadCount <= lastNotifiedUnreadCount || isQuietHoursActive() || (settings.focusMode && !hasPriorityUnread)) {
    lastNotifiedUnreadCount = nextUnreadCount;
    return;
  }

  lastNotifiedUnreadCount = nextUnreadCount;
  if (!Notification.isSupported() || mainWindow?.isFocused()) {
    return;
  }

  new Notification({
    title: 'WhatsApp Privacy Blur',
    body: `${nextUnreadCount} unread chat${nextUnreadCount === 1 ? '' : 's'}`,
    silent: false
  }).show();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDebugger(task) {
  const wc = mainWindow?.webContents;
  if (!wc || wc.isDestroyed()) {
    return { ok: false, reason: 'no-window' };
  }

  let attachedHere = false;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      attachedHere = true;
    }
    return await task(wc);
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    if (attachedHere && !wc.isDestroyed() && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach();
      } catch {
        // DevTools can detach first; ignore.
      }
    }
  }
}

function gpuFeatureStatus() {
  try {
    return app.getGPUFeatureStatus();
  } catch (error) {
    return { unavailable: error.message };
  }
}

function requestMediaDiagnostics() {
  logEvent('media', 'media diagnostics requested', {
    userAgent: USER_AGENT,
    gpuFeatureStatus: gpuFeatureStatus()
  });
  createDiagnosticsWindow();
  sendWhatsAppCommand('collect-media-diagnostics');
}

async function optimizeNow() {
  if (optimizeInFlight) {
    showWhatsAppToast('Memory optimization is already running');
    return lastOptimizeResult;
  }

  optimizeInFlight = true;
  try {
  const before = sampleMemory();
  showWhatsAppToast('Optimizing memory...');
  sendWhatsAppCommand('optimize-now');

  const result = await Promise.race([
    withDebugger(async (wc) => {
      await wc.debugger.sendCommand('Memory.simulatePressureNotification', { level: 'moderate' });
      await delay(500);
      await wc.debugger.sendCommand('HeapProfiler.collectGarbage');
      return { ok: true };
    }),
    delay(4500).then(() => ({ ok: false, reason: 'timeout' }))
  ]);

  await delay(500);
  const after = sampleMemory();
  lastOptimizeResult = {
    at: new Date().toISOString(),
    before,
    after,
    deltaPrivateMb: Number((after.totalPrivateMb - before.totalPrivateMb).toFixed(1)),
    result
  };

  if (result.ok && lastOptimizeResult.deltaPrivateMb < -5) {
    showWhatsAppToast(`Optimized memory: ${Math.abs(lastOptimizeResult.deltaPrivateMb).toFixed(0)} MB freed`);
  } else if (result.ok) {
    showWhatsAppToast('Memory already stable');
  } else {
    showWhatsAppToast('Memory optimize unavailable');
  }

  updateTray();
  return lastOptimizeResult;
  } finally {
    optimizeInFlight = false;
  }
}

function dailyPrivacyReset() {
  if (!settings.dailyPrivacyReset) {
    return;
  }

  if (!settings.enabled) {
    updateSettings({ enabled: true }, { silent: true });
  }
  mainWindow?.webContents.send('whatsapp-command', { type: 'privacy-reset' });
}

function scheduleDailyPrivacyReset() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  setTimeout(() => {
    dailyPrivacyReset();
    setInterval(dailyPrivacyReset, 24 * 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
}

function updateSettings(patch, options = {}) {
  const previous = settings;
  const selectedProfile = Object.hasOwn(patch || {}, 'privacyProfile') ? PRIVACY_PROFILES[patch.privacyProfile] : undefined;
  settings = sanitizeSettings({ ...settings, ...(selectedProfile?.settings || {}), ...patch });
  writeSettings();
  broadcastSettings();
  applyZoomFactor();
  applyCaptureProtection();

  if (!options.silent) {
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled') && previous.enabled !== settings.enabled) {
      showWhatsAppToast(settings.enabled ? 'Blur on' : 'Blur off');
    } else if (!Object.prototype.hasOwnProperty.call(patch, 'hasCompletedFirstRun')) {
      showWhatsAppToast('Settings saved');
    }
  }

  return settings;
}

function focusMainWindow() {
  if (!settings.hasCompletedFirstRun) {
    createFirstRunWindow();
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
}

function flushPendingWhatsAppCommands() {
  const wc = mainWindow?.webContents;
  if (!wc || wc.isDestroyed() || !whatsappLoaded) {
    return;
  }

  while (pendingWhatsAppCommands.length > 0) {
    wc.send('whatsapp-command', pendingWhatsAppCommands.shift());
  }
}

function sendWhatsAppCommand(type, payload = {}) {
  focusMainWindow();
  const wc = mainWindow?.webContents;
  if (!wc || wc.isDestroyed()) {
    return;
  }

  const command = { type, ...payload };
  if (!whatsappLoaded || wc.isLoadingMainFrame()) {
    pendingWhatsAppCommands.push(command);
    return;
  }

  wc.send('whatsapp-command', command);
}

function revealTemporarily() {
  sendWhatsAppCommand('temporary-reveal', { durationMs: settings.temporaryRevealMs });
}

function panicPrivacyMode() {
  applyPrivacyProfile('presentation');
  sendWhatsAppCommand('privacy-reset');
  showWhatsAppToast('Presentation privacy mode enabled');
}

function revealLabel() {
  return `Reveal for ${Math.round(settings.temporaryRevealMs / 1000)} seconds`;
}

function toggleBlur() {
  updateSettings({ enabled: !settings.enabled });
}

function toggleFocusMode() {
  updateSettings({ focusMode: !settings.focusMode }, { silent: true });
  updateUnreadSurfaces();
  showWhatsAppToast(settings.focusMode ? 'Focus mode on' : 'Focus mode off');
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function toggleAlwaysOnTop() {
  alwaysOnTop = !alwaysOnTop;
  mainWindow?.setAlwaysOnTop(alwaysOnTop);
  rebuildMenu();
}

function isAllowedTopLevelUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'web.whatsapp.com';
  } catch {
    return false;
  }
}

function makeUnreadOverlay(count) {
  const label = count > 99 ? '99+' : String(count);
  const fontSize = label.length > 2 ? 8 : 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#00a884"/><text x="16" y="20" text-anchor="middle" font-family="Segoe UI, Arial" font-size="${fontSize}" font-weight="700" fill="#071a16">${label}</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function updateUnreadSurfaces() {
  const quiet = isQuietHoursActive();
  const memorySample = sampleMemory();
  const { parts, suppressAttention } = buildAttentionParts({
    unreadCount,
    hasPriorityUnread,
    settings,
    memorySample,
    quiet
  });

  tray?.setToolTip(buildTrayTooltip(parts));

  if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
    if (!suppressAttention && unreadCount > 0) {
      mainWindow.setOverlayIcon(makeUnreadOverlay(unreadCount), `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }

  updateTray();
}

function updateUnreadFromTitle(title) {
  const next = parseUnreadCount(title);
  if (next === unreadCount) {
    return;
  }
  unreadCount = next;
  sendPrivacySafeNotification(next);
  updateUnreadSurfaces();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    title: 'WhatsApp Privacy Blur',
    width: 1280,
    height: 900,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#111b21',
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, 'preload-whatsapp.js'),
      sandbox: true
    }
  });

  attachWindowLogging(mainWindow, 'whatsapp');
  mainWindow.webContents.setUserAgent(USER_AGENT);
  configureWhatsAppPermissions(mainWindow.webContents);

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isWhatsAppUrl(url)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url) && !isWhatsAppUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-start-loading', () => {
    whatsappLoaded = false;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    whatsappLoaded = true;
    mainWindow.webContents.send('privacy-settings-updated', settings);
    mainWindow.webContents.send('whatsapp-command', { type: 'collect-media-diagnostics' });
    if (settings.dailyPrivacyReset) {
      mainWindow.webContents.send('whatsapp-command', { type: 'privacy-reset' });
    }
    flushPendingWhatsAppCommands();
    applyZoomFactor();
  });

  mainWindow.webContents.on('page-title-updated', (_event, title) => {
    updateUnreadFromTitle(title);
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && settings.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
      showWhatsAppToast('Hidden to tray');
    }
  });

  mainWindow.on('blur', () => {
    mainWindow.webContents.send('whatsapp-command', { type: 'privacy-reset' });
  });

  mainWindow.on('hide', () => {
    mainWindow.webContents.send('whatsapp-command', { type: 'privacy-reset' });
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
    whatsappLoaded = false;
    unreadCount = 0;
    lastNotifiedUnreadCount = 0;
    updateUnreadSurfaces();
  });

  mainWindow.setAlwaysOnTop(alwaysOnTop);
  applyZoomFactor();
  applyCaptureProtection();
  updateUnreadSurfaces();
  mainWindow.loadURL(WHATSAPP_WEB_URL);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    title: 'Privacy Blur Settings',
    width: 500,
    height: 720,
    minWidth: 460,
    minHeight: 600,
    parent: mainWindow,
    backgroundColor: '#0f1720',
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-settings.js'),
      sandbox: true
    }
  });

  attachWindowLogging(settingsWindow, 'settings');
  validateLocalFiles('settings', [
    path.join(__dirname, 'preload-settings.js'),
    path.join(__dirname, 'settings.html'),
    path.join(__dirname, 'settings.css'),
    path.join(__dirname, 'settings.js')
  ]);
  settingsWindow.removeMenu();
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });
}

function completeFirstRun(presetName = 'balanced') {
  const preset = FIRST_RUN_PRESETS[presetName] || FIRST_RUN_PRESETS.balanced;
  updateSettings(preset, { silent: true });

  if (firstRunWindow && !firstRunWindow.isDestroyed()) {
    firstRunWindow.close();
  }

  createMainWindow();
  showWhatsAppToast('Settings saved');
  return settings;
}

function createFirstRunWindow() {
  if (firstRunWindow && !firstRunWindow.isDestroyed()) {
    firstRunWindow.focus();
    return;
  }

  firstRunWindow = new BrowserWindow({
    title: 'Set Up WhatsApp Privacy Blur',
    width: 620,
    height: 620,
    minWidth: 560,
    minHeight: 560,
    backgroundColor: '#0f1720',
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-settings.js'),
      sandbox: true
    }
  });

  attachWindowLogging(firstRunWindow, 'first-run');
  validateLocalFiles('first-run', [
    path.join(__dirname, 'preload-settings.js'),
    path.join(__dirname, 'first-run.html'),
    path.join(__dirname, 'first-run.js'),
    path.join(__dirname, 'settings.css')
  ]);
  firstRunWindow.removeMenu();
  firstRunWindow.loadFile(path.join(__dirname, 'first-run.html'));
  firstRunWindow.on('closed', () => {
    firstRunWindow = undefined;
    if (!settings.hasCompletedFirstRun && !isQuitting) {
      completeFirstRun('balanced');
    }
  });
}

function getDiagnostics() {
  const currentMemory = sampleMemory();
  return redactDiagnostics({
    app: {
      name: app.getName(),
      version: app.getVersion(),
      appId: APP_ID
    },
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      gpuFeatureStatus: gpuFeatureStatus()
    },
    state: {
      unreadCount,
      hasPriorityUnread,
      alwaysOnTop,
      hasMainWindow: Boolean(mainWindow && !mainWindow.isDestroyed()),
      closeToTray: settings.closeToTray,
      quietHoursActive: isQuietHoursActive(),
      focusMode: settings.focusMode,
      privacyProfile: settings.privacyProfile,
      captureProtection: settings.captureProtection
    },
    memory: {
      current: currentMemory,
      samples: memorySamples,
      lastOptimizeResult
    },
    diagnostics: runtimeDiagnostics,
    privacyControls: {
      enabled: settings.enabled,
      blurMessages: settings.blurMessages,
      blurPreviews: settings.blurPreviews,
      blurMedia: settings.blurMedia,
      blurGallery: settings.blurGallery,
      obscureInput: settings.obscureInput,
      blurAvatars: settings.blurAvatars,
      blurNames: settings.blurNames
    },
    processes: app.getAppMetrics().map((item) => ({
      type: item.type,
      cpuPercent: Number(item.cpu.percentCPUUsage.toFixed(2)),
      workingSetMb: Number((item.memory.workingSetSize / 1024).toFixed(1)),
      privateMb: Number((item.memory.privateBytes / 1048576).toFixed(1)),
      sharedMb: Number((item.memory.sharedBytes / 1048576).toFixed(1))
    }))
  });
}

function getSupportBundle() {
  return {
    generatedAt: new Date().toISOString(),
    safeHealthReport: getDiagnostics(),
    eventTimeline: runtimeDiagnostics.events.map(({ at, scope, message, details }) => ({ at, scope, message, details }))
  };
}

async function exportDiagnostics() {
  const target = diagnosticsWindow && !diagnosticsWindow.isDestroyed() ? diagnosticsWindow : mainWindow;
  const options = {
    title: 'Export diagnostics package',
    defaultPath: `whatsapp-privacy-blur-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  };
  const result = target && !target.isDestroyed()
    ? await dialog.showSaveDialog(target, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(result.filePath, `${JSON.stringify(getDiagnostics(), null, 2)}\n`, 'utf8');
  return { canceled: false, filePath: result.filePath };
}

async function exportSupportBundle() {
  const target = diagnosticsWindow && !diagnosticsWindow.isDestroyed() ? diagnosticsWindow : mainWindow;
  const confirmation = target && !target.isDestroyed()
    ? await dialog.showMessageBox(target, {
      type: 'question',
      buttons: ['Cancel', 'Create bundle'],
      defaultId: 0,
      cancelId: 0,
      message: 'Create a redacted support bundle?',
      detail: 'It contains runtime health, memory samples, selector coverage, and event timestamps. It never includes chats, contact names, message text, cookies, or file paths.'
    })
    : { response: 0 };

  if (confirmation.response !== 1) {
    return { canceled: true };
  }

  const result = await dialog.showSaveDialog(target, {
    title: 'Save redacted support bundle',
    defaultPath: `whatsapp-privacy-blur-support-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(result.filePath, `${JSON.stringify(getSupportBundle(), null, 2)}\n`, 'utf8');
  return { canceled: false, filePath: result.filePath };
}

function createDiagnosticsWindow() {
  if (diagnosticsWindow && !diagnosticsWindow.isDestroyed()) {
    diagnosticsWindow.focus();
    return;
  }

  diagnosticsWindow = new BrowserWindow({
    title: 'WhatsApp Privacy Blur Diagnostics',
    width: 760,
    height: 720,
    minWidth: 620,
    minHeight: 540,
    backgroundColor: '#0f1720',
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-settings.js'),
      sandbox: true
    }
  });

  attachWindowLogging(diagnosticsWindow, 'diagnostics');
  validateLocalFiles('diagnostics', [
    path.join(__dirname, 'preload-settings.js'),
    path.join(__dirname, 'diagnostics.html'),
    path.join(__dirname, 'diagnostics.js'),
    path.join(__dirname, 'settings.css')
  ]);
  diagnosticsWindow.removeMenu();
  diagnosticsWindow.loadFile(path.join(__dirname, 'diagnostics.html'));
  diagnosticsWindow.on('closed', () => {
    diagnosticsWindow = undefined;
  });
}

function buildSettingsSubmenu() {
  return Object.entries(PRIVACY_SETTING_LABELS).map(([key, label]) => ({
    label,
    type: 'checkbox',
    checked: settings[key],
    click: (item) => updateSettings({ [key]: item.checked })
  }));
}

function buildZoomSubmenu() {
  return ZOOM_PRESETS.map((preset) => ({
    label: preset.label,
    type: 'radio',
    checked: Math.abs(settings.zoomFactor - preset.value) < 0.001,
    click: () => updateSettings({ zoomFactor: preset.value })
  }));
}

function buildProfileSubmenu() {
  return Object.entries(PRIVACY_PROFILES).map(([key, profile]) => ({
    label: profile.label,
    type: 'radio',
    checked: settings.privacyProfile === key,
    toolTip: profile.description,
    click: () => applyPrivacyProfile(key)
  }));
}

function buildQuickReplySubmenu() {
  const entries = quickReplyEntries();
  if (entries.length === 0) {
    return [{ label: 'No templates configured', enabled: false }];
  }

  return entries.map((entry, index) => ({
    label: `${index + 1}. [${entry.category}] ${entry.text.slice(0, 36)}${entry.text.length > 36 ? '...' : ''}`,
    click: () => sendWhatsAppCommand('insert-reply-template', { text: entry.text })
  }));
}

function rebuildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Settings', accelerator: 'Ctrl+,', click: createSettingsWindow },
        { label: 'Diagnostics', click: createDiagnosticsWindow },
        { type: 'separator' },
        { label: 'Reload WhatsApp', accelerator: 'Ctrl+R', click: () => mainWindow?.reload() },
        { label: settings.closeToTray ? 'Hide to Tray' : 'Close Window', click: () => mainWindow?.close() },
        { label: 'Quit', accelerator: 'Alt+F4', click: quitApp }
      ]
    },
    {
      label: 'Privacy',
      submenu: [
        {
          label: 'Toggle Blur',
          type: 'checkbox',
          checked: settings.enabled,
          accelerator: 'Alt+X',
          click: toggleBlur
        },
        { label: revealLabel(), accelerator: 'Ctrl+Alt+R', click: revealTemporarily },
        { label: 'Presentation panic mode', accelerator: 'Ctrl+Alt+P', click: panicPrivacyMode },
        { label: 'Privacy profile', submenu: buildProfileSubmenu() },
        { label: 'Focus Mode', type: 'checkbox', checked: settings.focusMode, accelerator: 'Ctrl+Alt+F', click: toggleFocusMode },
        { label: 'Daily Privacy Reset', type: 'checkbox', checked: settings.dailyPrivacyReset, click: (item) => updateSettings({ dailyPrivacyReset: item.checked }) },
        { label: 'Open Settings', accelerator: 'Ctrl+,', click: createSettingsWindow },
        { type: 'separator' },
        ...buildSettingsSubmenu()
      ]
    },
    {
      label: 'Chat',
      submenu: [
        { label: 'Go to top of current chat', accelerator: 'Ctrl+Alt+Home', click: () => sendWhatsAppCommand('chat-scroll-top') },
        { label: 'Go to latest message', accelerator: 'Ctrl+Alt+End', click: () => sendWhatsAppCommand('chat-scroll-bottom') },
        { label: 'Stop loading old messages', accelerator: 'Ctrl+Alt+Esc', click: () => sendWhatsAppCommand('chat-scroll-cancel') },
        { type: 'separator' },
        { label: 'Save unread position', click: () => sendWhatsAppCommand('unread-position-save') },
        { label: 'Return to unread position', accelerator: 'Ctrl+Alt+U', click: () => sendWhatsAppCommand('unread-position-restore') },
        { label: 'Copy current chat title', click: () => sendWhatsAppCommand('copy-current-chat-title') },
        { label: 'Open current chat media panel', click: () => sendWhatsAppCommand('open-media-panel') },
        { label: 'Show quick reply picker', accelerator: 'Ctrl+Alt+Q', click: () => sendWhatsAppCommand('quick-reply-picker') },
        { label: 'Quick Reply Templates', submenu: buildQuickReplySubmenu() }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Optimize Now', click: optimizeNow },
        { label: 'Media Diagnostics', click: requestMediaDiagnostics },
        { label: 'Diagnostics', click: createDiagnosticsWindow }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Chat Zoom', submenu: buildZoomSubmenu() },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetZoom' },
        { label: 'Zoom In', role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Always on top', type: 'checkbox', checked: alwaysOnTop, accelerator: 'Ctrl+Alt+T', click: toggleAlwaysOnTop },
        { label: 'Focus WhatsApp', click: focusMainWindow },
        { type: 'separator' },
        { label: 'Toggle Full Screen', role: 'togglefullscreen' }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
}

function updateTray() {
  if (!tray) {
    return;
  }

  const quiet = isQuietHoursActive();
  const latestMemory = memorySamples[memorySamples.length - 1] || sampleMemory();
  const { parts } = buildAttentionParts({
    unreadCount,
    hasPriorityUnread,
    settings,
    memorySample: latestMemory,
    quiet
  });
  const tooltip = buildTrayTooltip(parts);
  const suffix = tooltip.slice('WhatsApp Privacy Blur'.length);
  tray.setToolTip(tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `WhatsApp Privacy Blur${suffix}`, enabled: false },
      { type: 'separator' },
      { label: 'Show WhatsApp', click: focusMainWindow },
       { label: settings.enabled ? 'Turn Blur Off' : 'Turn Blur On', click: toggleBlur },
       { label: revealLabel(), click: revealTemporarily },
       { label: 'Presentation panic mode', click: panicPrivacyMode },
       { label: settings.focusMode ? 'Turn Focus Mode Off' : 'Turn Focus Mode On', click: toggleFocusMode },
      { label: 'Optimize Now', click: optimizeNow },
      { label: 'Diagnostics', click: createDiagnosticsWindow },
      { type: 'separator' },
      { label: 'Quit', click: quitApp }
    ])
  );
}

function createTray() {
  if (tray) {
    return;
  }

  const trayIcon = nativeImage.createFromPath(APP_TRAY_ICON_PATH).resize({ width: 16, height: 16 });
  if (typeof trayIcon.setTemplateImage === 'function') {
    trayIcon.setTemplateImage(false);
  }
  tray = new Tray(trayIcon.isEmpty() ? APP_ICON_PATH : trayIcon);
  tray.on('click', focusMainWindow);
  tray.on('double-click', focusMainWindow);
  updateTray();
}

function registerShortcut(accelerator, callback) {
  const registered = globalShortcut.register(accelerator, callback);
  if (!registered) {
    console.warn(`${accelerator} global shortcut could not be registered.`);
  }
}

function registerIpcHandlers() {
  const isMainSender = (event) => isSameWebContents(event, mainWindow);
  const isSettingsSender = (event) => isSameWebContents(event, settingsWindow);
  const isFirstRunSender = (event) => isSameWebContents(event, firstRunWindow);
  const isDiagnosticsSender = (event) => isSameWebContents(event, diagnosticsWindow);
  const isLocalSender = (event) => isMainSender(event) || isSettingsSender(event) || isFirstRunSender(event) || isDiagnosticsSender(event);
  const rejectUntrusted = () => {
    throw new Error('Untrusted renderer IPC request.');
  };

  ipcMain.handle('settings:get', (event) => {
    if (!isLocalSender(event)) rejectUntrusted();
    return settings;
  });
  ipcMain.handle('settings:update', (event, patch) => {
    if (!isSettingsSender(event)) rejectUntrusted();
    const result = validateSettingsPatch(patch, new Set([...BOOLEAN_SETTINGS, ...Object.keys(NUMBER_SETTINGS), ...Object.keys(STRING_SETTINGS)]));
    if (!result.ok) throw new Error(result.reason);
    return updateSettings(result.patch);
  });
  ipcMain.handle('first-run:complete', (event, presetName) => {
    if (!isFirstRunSender(event) || !Object.hasOwn(FIRST_RUN_PRESETS, presetName)) rejectUntrusted();
    return completeFirstRun(presetName);
  });
  ipcMain.handle('diagnostics:get', (event) => {
    if (!isDiagnosticsSender(event)) rejectUntrusted();
    return getDiagnostics();
  });
  ipcMain.handle('diagnostics:export', (event) => {
    if (!isDiagnosticsSender(event)) rejectUntrusted();
    return exportDiagnostics();
  });
  ipcMain.handle('diagnostics:export-support', (event) => {
    if (!isDiagnosticsSender(event)) rejectUntrusted();
    return exportSupportBundle();
  });
  ipcMain.on('whatsapp:copy-chat-title', (event, title) => {
    if (!isMainSender(event)) return;
    const result = validateChatTitle(title);
    if (result.ok) {
      clipboard.writeText(result.value);
      showWhatsAppToast('Chat title copied');
    }
  });
  ipcMain.on('whatsapp:priority-state', (_event, state) => {
    if (!isMainSender(_event)) return;
    hasPriorityUnread = Boolean(state?.hasPriorityUnread);
    updateUnreadSurfaces();
  });
  ipcMain.on('whatsapp:media-diagnostics', (_event, diagnostics) => {
    if (!isMainSender(_event)) return;
    runtimeDiagnostics.lastMediaDiagnostics = logEvent('whatsapp', 'media-diagnostics', diagnostics);
  });
  ipcMain.on('whatsapp:selector-health', (_event, health) => {
    if (!isMainSender(_event)) return;
    runtimeDiagnostics.selectorHealth = normalizeSelectorHealth(health);
  });
}

if (readHardwareAccelerationPreference()) {
  app.disableHardwareAcceleration();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(() => {
    app.setName('WhatsApp Privacy Blur');
    readSettings();
    registerIpcHandlers();
    createTray();
    rebuildMenu();

    registerShortcut('Alt+X', toggleBlur);
    registerShortcut('Ctrl+Alt+R', revealTemporarily);
    registerShortcut('Ctrl+Alt+Esc', () => sendWhatsAppCommand('chat-scroll-cancel'));
    registerShortcut('Ctrl+Alt+U', () => sendWhatsAppCommand('unread-position-restore'));
    registerShortcut('Ctrl+Alt+F', toggleFocusMode);
    registerShortcut('Ctrl+Alt+P', panicPrivacyMode);
    registerShortcut('Ctrl+Alt+Q', () => sendWhatsAppCommand('quick-reply-picker'));

    dailyPrivacyReset();
    scheduleDailyPrivacyReset();
    setInterval(updateTray, 60 * 1000);

    if (settings.hasCompletedFirstRun) {
      createMainWindow();
    } else {
      createFirstRunWindow();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (settings.hasCompletedFirstRun) {
          createMainWindow();
        } else {
          createFirstRunWindow();
        }
      } else {
        focusMainWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if ((isQuitting || !settings.closeToTray) && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
