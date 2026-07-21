const { ipcRenderer } = require('electron');

const DEFAULT_SETTINGS = {
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
  idlePowerSaver: true,
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
  captureProtection: false,
  privacyProfile: 'work',
  priorityKeywords: '',
  quickReplyTemplates: ''
};

let currentSettings = { ...DEFAULT_SETTINGS };
let styleElement;
let navElement;
let toastElement;
let toastTimer;
let loaderElement;
let loaderMessageElement;
let loaderCancelButton;
let replyPickerElement;
let temporaryRevealTimer;
let topLoadRunId = 0;
let lastUnreadPosition;
let lastPriorityState = false;
let cachedConversationRoot;
let cachedChatListContainer;
let cachedChatScrollContainer;
let priorityTimer;
let scanHealthTimer;
let isHoldRevealing = false;
let privacyScannerActive = true;
let privacyObserver;
let lastUnreadListInteractionAt = 0;
let unreadRestoreRunId = 0;
let fullScreenExitElement;
let isFullScreen = false;

const OWN_SELECTOR = '[data-wapb-owned="true"]';
const MESSAGE_SELECTOR = '[data-testid="msg-container"], [data-pre-plain-text], .message-in, .message-out';
const LOAD_OLDER_TEXT_PATTERN = /click\s+to\s+load\s+(?:old|older)\s+messages|load\s+(?:old|older)\s+messages/i;
const TOP_LOAD_MAX_STEPS = 60;
const TOP_LOAD_WAIT_MS = 650;
const TOP_LOAD_CLICK_WAIT_MS = 1300;

function parseClock(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function isQuietHoursActiveForSettings(settings, date = new Date()) {
  if (!settings.quietHoursEnabled) {
    return false;
  }
  const start = parseClock(settings.quietHoursStart);
  const end = parseClock(settings.quietHoursEnd);
  if (start === undefined || end === undefined || start === end) {
    return false;
  }
  const current = date.getHours() * 60 + date.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function priorityTermsFromText(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 32);
}

function quickReplyEntriesFromText(value, limit = 12) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => {
      const separator = item.indexOf('::');
      if (separator <= 0) {
        return { category: 'General', text: item };
      }
      return {
        category: item.slice(0, separator).trim().slice(0, 40) || 'General',
        text: item.slice(separator + 2).trim() || item
      };
    });
}

const css = `
:root {
  --wapb-blur: blur(7px);
  --wapb-media-blur: blur(13px);
  --wapb-transition-duration: 160ms;
  --wapb-transition-delay: 220ms;
}

[data-wapb-owned="true"],
[data-wapb-owned="true"] * {
  filter: none !important;
  color: inherit !important;
  text-shadow: none !important;
}

.wapb-chat-nav {
  position: fixed;
  top: 88px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 5px;
  border: 1px solid rgba(233, 237, 239, 0.14);
  border-radius: 999px;
  background: rgba(17, 27, 33, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: auto;
}

.wapb-chat-nav[hidden],
.wapb-chat-toast[hidden] {
  display: none !important;
}

.wapb-chat-nav button {
  min-width: 54px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  padding: 0 12px;
  background: rgba(0, 168, 132, 0.18);
  color: #e9edef;
  cursor: pointer;
  font: 600 12px/30px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.wapb-chat-nav button:hover,
.wapb-chat-nav button:focus-visible {
  background: #00a884;
  color: #071a16;
  outline: none;
}

.wapb-fullscreen-exit {
  position: fixed;
  top: 12px;
  right: 18px;
  z-index: 2147483647;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(233, 237, 239, 0.2);
  border-radius: 50%;
  background: rgba(17, 27, 33, 0.92);
  color: #e9edef;
  cursor: pointer;
  font: 500 28px/28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-6px);
  transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
}

.wapb-fullscreen-exit.wapb-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.wapb-fullscreen-exit:hover,
.wapb-fullscreen-exit:focus-visible {
  background: #00a884;
  color: #071a16;
  outline: none;
}

.wapb-chat-toast {
  position: fixed;
  top: 132px;
  right: 24px;
  z-index: 2147483647;
  max-width: min(280px, calc(100vw - 48px));
  padding: 9px 12px;
  border-radius: 8px;
  background: rgba(17, 27, 33, 0.94);
  color: #e9edef;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  font: 500 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: none;
}

.wapb-chat-loader {
  position: fixed;
  top: 132px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: min(320px, calc(100vw - 48px));
  padding: 10px 13px;
  border: 1px solid rgba(0, 168, 132, 0.24);
  border-radius: 10px;
  background: rgba(17, 27, 33, 0.96);
  color: #e9edef;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: auto;
}

.wapb-chat-loader[hidden] {
  display: none !important;
}

.wapb-chat-loader::before {
  content: "";
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border: 2px solid rgba(233, 237, 239, 0.24);
  border-top-color: #00a884;
  border-radius: 999px;
  animation: wapb-spin 780ms linear infinite;
}

.wapb-chat-loader-message {
  min-width: 0;
}

.wapb-chat-loader button {
  height: 28px;
  border: 0;
  border-radius: 999px;
  padding: 0 10px;
  background: rgba(233, 237, 239, 0.12);
  color: #e9edef;
  cursor: pointer;
  font: 700 12px/28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.wapb-chat-loader button:hover,
.wapb-chat-loader button:focus-visible {
  background: #e9edef;
  color: #111b21;
  outline: none;
}

.wapb-reply-picker {
  position: fixed;
  right: 24px;
  bottom: 92px;
  z-index: 2147483647;
  display: grid;
  gap: 6px;
  width: min(360px, calc(100vw - 48px));
  padding: 10px;
  border: 1px solid rgba(233, 237, 239, 0.14);
  border-radius: 10px;
  background: rgba(17, 27, 33, 0.97);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.wapb-reply-picker[hidden] {
  display: none !important;
}

.wapb-reply-picker button {
  min-height: 34px;
  border: 0;
  border-radius: 7px;
  padding: 8px 10px;
  background: rgba(233, 237, 239, 0.08);
  color: #e9edef;
  cursor: pointer;
  font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: left;
}

.wapb-reply-picker button:hover,
.wapb-reply-picker button:focus-visible {
  background: #00a884;
  color: #071a16;
  outline: none;
}

.wapb-reply-picker input {
  min-height: 34px;
  border: 1px solid rgba(233, 237, 239, 0.18);
  border-radius: 7px;
  padding: 0 10px;
  background: rgba(0, 0, 0, 0.2);
  color: #e9edef;
  font: 600 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.wapb-reply-picker-list {
  display: grid;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
}

@keyframes wapb-spin {
  to {
    transform: rotate(360deg);
  }
}

:root[data-wapb-no-delay="true"] {
  --wapb-transition-delay: 0ms;
}

:root[data-wapb-enabled="true"] [data-wapb-kind] {
  transition:
    filter var(--wapb-transition-duration) ease var(--wapb-transition-delay),
    opacity var(--wapb-transition-duration) ease var(--wapb-transition-delay),
    color var(--wapb-transition-duration) ease var(--wapb-transition-delay),
    text-shadow var(--wapb-transition-duration) ease var(--wapb-transition-delay) !important;
}

:root[data-wapb-enabled="true"][data-wapb-messages="true"] [data-wapb-kind~="message"],
:root[data-wapb-enabled="true"][data-wapb-previews="true"] [data-wapb-kind~="preview"],
:root[data-wapb-enabled="true"][data-wapb-media="true"] [data-wapb-kind~="media"],
:root[data-wapb-enabled="true"][data-wapb-gallery="true"] [data-wapb-kind~="gallery"],
:root[data-wapb-enabled="true"][data-wapb-avatars="true"] [data-wapb-kind~="avatar"],
:root[data-wapb-enabled="true"][data-wapb-names="true"] [data-wapb-kind~="name"] {
  filter: var(--wapb-blur) !important;
}

:root[data-wapb-enabled="true"][data-wapb-media="true"] [data-wapb-kind~="media"],
:root[data-wapb-enabled="true"][data-wapb-gallery="true"] [data-wapb-kind~="gallery"] {
  filter: var(--wapb-media-blur) !important;
}

:root[data-wapb-enabled="true"][data-wapb-input="true"] [data-wapb-kind~="input"] {
  color: rgba(134, 150, 160, 0.24) !important;
  text-shadow: 0 0 9px rgba(134, 150, 160, 0.86) !important;
  caret-color: #00a884 !important;
}

:root[data-wapb-enabled="true"][data-wapb-unblur-app-hover="true"]:has(body:hover) [data-wapb-kind],
:root[data-wapb-temporary-reveal="true"] [data-wapb-kind],
:root[data-wapb-enabled="true"] [data-wapb-kind]:hover,
:root[data-wapb-enabled="true"] [data-wapb-kind]:focus-within,
:root[data-wapb-enabled="true"] [data-wapb-kind]:has(:hover),
:root[data-wapb-enabled="true"] [data-wapb-kind]:has(:focus) {
  filter: none !important;
  color: inherit !important;
  text-shadow: none !important;
  transition-delay: 0ms !important;
}
`;

function isOwnedElement(element) {
  return Boolean(element?.closest?.(OWN_SELECTOR));
}

function setToken(element, token, enabled) {
  if (isOwnedElement(element)) {
    return;
  }

  const existing = new Set((element.dataset.wapbKind || '').split(/\s+/).filter(Boolean));
  if (enabled) {
    existing.add(token);
  } else {
    existing.delete(token);
  }

  if (existing.size > 0) {
    element.dataset.wapbKind = [...existing].sort().join(' ');
  } else {
    delete element.dataset.wapbKind;
  }
}

function hasText(element) {
  return Boolean(element.textContent && element.textContent.trim().length > 0);
}

function isVisibleElement(element) {
  if (!(element instanceof HTMLElement) || isOwnedElement(element)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function nearestListItem(element) {
  return element.closest('[role="listitem"], [data-testid="cell-frame-container"], [aria-selected]');
}

function elementsWithin(root, selector) {
  if (!(root instanceof Element)) {
    return [];
  }
  const elements = [...root.querySelectorAll(selector)];
  if (root.matches(selector)) {
    elements.unshift(root);
  }
  return elements;
}

function markChatMessages(root = document) {
  let count = 0;
  for (const message of elementsWithin(root, MESSAGE_SELECTOR)) {
    if (isVisibleElement(message)) {
      setToken(message, 'message', true);
      count += 1;
    }
  }
  return count;
}

function markChatPreviewsAndNames(root = document) {
  const rowSelector = '[role="row"], [role="listitem"], [aria-selected]';
  const isRowRoot = root instanceof Element && root.matches(rowSelector);
  const chatList = root instanceof Element && root.matches('[aria-label*="Chat list" i], [aria-label*="chat list" i], [role="grid"]')
    ? root
    : root.querySelector?.('[aria-label*="Chat list" i], [aria-label*="chat list" i], [role="grid"]');
  if (!chatList && !isRowRoot) {
    return { previews: 0, names: 0 };
  }
  const rows = isRowRoot ? [root] : chatList.querySelectorAll(rowSelector);
  let previews = 0;
  let names = 0;

  for (const row of rows) {
    if (!isVisibleElement(row)) {
      continue;
    }

    const candidates = row.querySelectorAll('span[title], span[dir="auto"], div[dir="auto"]');
    const textNodes = [...candidates].filter((item) => isVisibleElement(item) && hasText(item));

    if (textNodes[0]) {
      setToken(textNodes[0], 'name', true);
      names += 1;
    }
    for (const preview of textNodes.slice(1, 4)) {
      setToken(preview, 'preview', true);
      previews += 1;
    }
  }
  return { previews, names };
}

function markHeaderAndParticipantNames(root = document) {
  let count = 0;
  const headers = root.querySelectorAll('header span[title], header span[dir="auto"], header div[dir="auto"]');
  for (const headerText of headers) {
    if (isVisibleElement(headerText) && hasText(headerText)) {
      setToken(headerText, 'name', true);
      count += 1;
    }
  }
  return count;
}

function markMedia(root = document) {
  const mediaSelectors = [
    '[data-testid*="image"]',
    '[data-testid*="video"]',
    '[data-testid*="sticker"]',
    '[data-testid*="gif"]',
    '[aria-label*="image" i]',
    '[aria-label*="video" i]',
    'img[src^="blob:"]',
    'video',
    'canvas'
  ];

  let count = 0;
  for (const media of elementsWithin(root, mediaSelectors.join(','))) {
    if (!isVisibleElement(media)) {
      continue;
    }

    const inMessage = media.closest('[data-testid="msg-container"], [data-pre-plain-text], .message-in, .message-out');
    const wrapper = inMessage || media.closest('div') || media;
    setToken(wrapper, 'media', true);
    count += 1;
  }
  return count;
}

function markGallery(root = document) {
  let count = 0;
  const thumbnails = root.querySelectorAll(
    '[role="dialog"] img, [role="dialog"] video, [role="dialog"] canvas, [aria-modal="true"] img, [aria-modal="true"] video, [aria-modal="true"] canvas'
  );

  for (const thumbnail of thumbnails) {
    if (isVisibleElement(thumbnail)) {
      setToken(thumbnail.closest('button, div') || thumbnail, 'gallery', true);
      count += 1;
    }
  }
  return count;
}

function markAvatars(root = document) {
  const avatarSelectors = [
    'img[draggable="false"]',
    '[data-testid*="avatar"]',
    '[data-testid*="default-user"]',
    '[aria-label*="profile" i] img',
    '[role="img"]'
  ];

  let count = 0;
  for (const avatar of elementsWithin(root, avatarSelectors.join(','))) {
    if (!isVisibleElement(avatar)) {
      continue;
    }

    const rect = avatar.getBoundingClientRect();
    if (rect.width <= 96 && rect.height <= 96) {
      const row = nearestListItem(avatar);
      const target = avatar.closest('button, div') || row || avatar;
      setToken(target, 'avatar', true);
      count += 1;
    }
  }
  return count;
}

function markInput(root = document) {
  const inputs = root.querySelectorAll(
    'footer [contenteditable="true"], [aria-label*="Type a message" i], [aria-label*="message" i][contenteditable="true"]'
  );

  let count = 0;
  for (const input of inputs) {
    if (isVisibleElement(input)) {
      setToken(input, 'input', true);
      count += 1;
    }
  }
  return count;
}

function clearStaleMarks(root = document) {
  for (const element of root.querySelectorAll('[data-wapb-kind]')) {
    if (!document.documentElement.contains(element)) {
      continue;
    }
    if (!isVisibleElement(element)) {
      delete element.dataset.wapbKind;
    }
  }
}

function markPrivacyTargets(root = document) {
  const chatTargets = markChatPreviewsAndNames(root);
  return {
    messageTargets: markChatMessages(root),
    previewTargets: chatTargets.previews,
    mediaTargets: markMedia(root),
    galleryTargets: markGallery(root),
    avatarTargets: markAvatars(root),
    inputTargets: markInput(root),
    nameTargets: chatTargets.names + markHeaderAndParticipantNames(root)
  };
}

function ensureStyle() {
  if (styleElement && document.head?.contains(styleElement)) {
    return;
  }

  styleElement = document.createElement('style');
  styleElement.id = 'wapb-privacy-blur-style';
  styleElement.textContent = css;
  document.head.append(styleElement);
}

function applySettings(nextSettings) {
  currentSettings = { ...DEFAULT_SETTINGS, ...nextSettings };
  const root = document.documentElement;
  root.dataset.wapbEnabled = String(currentSettings.enabled);
  root.dataset.wapbMessages = String(currentSettings.blurMessages);
  root.dataset.wapbPreviews = String(currentSettings.blurPreviews);
  root.dataset.wapbMedia = String(currentSettings.blurMedia);
  root.dataset.wapbGallery = String(currentSettings.blurGallery);
  root.dataset.wapbInput = String(currentSettings.obscureInput);
  root.dataset.wapbAvatars = String(currentSettings.blurAvatars);
  root.dataset.wapbNames = String(currentSettings.blurNames);
  root.dataset.wapbNoDelay = String(currentSettings.noTransitionDelay);
  root.dataset.wapbUnblurAppHover = String(currentSettings.unblurOnAppHover);
  root.dataset.wapbFocusMode = String(currentSettings.focusMode);
}

let scanTimer;
const pendingScanRoots = new Set();

function isCurrentElement(element) {
  return element instanceof HTMLElement && document.documentElement.contains(element) && !isOwnedElement(element);
}

function activeScanRoots() {
  const roots = [];
  const conversation = findConversationRoot();
  const chatList = findChatListContainer();
  if (conversation) roots.push(conversation);
  if (chatList && chatList !== conversation) roots.push(chatList);
  for (const dialog of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
    if (isCurrentElement(dialog)) roots.push(dialog);
  }
  return roots;
}

function findNearestScanRoot(element) {
  if (!(element instanceof HTMLElement) || isOwnedElement(element)) {
    return undefined;
  }
  const leafScope = element.closest(`${MESSAGE_SELECTOR}, [role="row"], [role="listitem"], [aria-selected], [role="dialog"], [aria-modal="true"]`);
  if (leafScope && !isOwnedElement(leafScope)) {
    return leafScope;
  }
  const conversation = findConversationRoot();
  if (conversation?.contains(element)) {
    return conversation;
  }
  const chatList = findChatListContainer();
  if (chatList?.contains(element)) {
    return chatList;
  }
  return element.closest('[role="dialog"], [aria-modal="true"]') || undefined;
}

function reportSelectorHealth(targets, scanMode) {
  window.clearTimeout(scanHealthTimer);
  scanHealthTimer = window.setTimeout(() => {
    ipcRenderer.send('whatsapp:selector-health', {
      scanMode,
      ...targets,
      conversationFound: Boolean(findConversationRoot()),
      chatListFound: Boolean(findChatListContainer())
    });
  }, 500);
}

function scanPendingRoots(scanMode = 'scoped') {
  if (!privacyScannerActive) {
    pendingScanRoots.clear();
    return;
  }
  ensureStyle();
  const totals = { messageTargets: 0, previewTargets: 0, mediaTargets: 0, galleryTargets: 0, avatarTargets: 0, inputTargets: 0 };
  for (const root of pendingScanRoots) {
    if (!isCurrentElement(root)) {
      continue;
    }
    clearStaleMarks(root);
    const targets = markPrivacyTargets(root);
    for (const key of Object.keys(totals)) {
      totals[key] += targets[key] || 0;
    }
  }
  pendingScanRoots.clear();
  updateChatNavVisibility();
  schedulePriorityState();
  reportSelectorHealth(totals, scanMode);
}

function scheduleScan(root) {
  if (!privacyScannerActive) {
    return;
  }
  if (root instanceof HTMLElement) {
    const scopedRoot = findNearestScanRoot(root);
    if (scopedRoot) {
      pendingScanRoots.add(scopedRoot);
    } else {
      for (const activeRoot of activeScanRoots()) {
        pendingScanRoots.add(activeRoot);
      }
    }
  } else {
    for (const activeRoot of activeScanRoots()) {
      pendingScanRoots.add(activeRoot);
    }
  }

  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanPendingRoots(root instanceof HTMLElement ? 'scoped' : 'fallback'), 220);
}

function invalidateCachedContainers(element) {
  if (cachedConversationRoot && (!document.documentElement.contains(cachedConversationRoot) || element === cachedConversationRoot)) {
    cachedConversationRoot = undefined;
  }
  if (cachedChatListContainer && (!document.documentElement.contains(cachedChatListContainer) || element === cachedChatListContainer)) {
    cachedChatListContainer = undefined;
  }
  if (cachedChatScrollContainer && (!document.documentElement.contains(cachedChatScrollContainer) || element === cachedChatScrollContainer)) {
    cachedChatScrollContainer = undefined;
  }
}

function startObserver() {
  if (privacyObserver) {
    return;
  }

  privacyObserver = new MutationObserver((mutations) => {
    if (!privacyScannerActive) {
      return;
    }
    for (const mutation of mutations) {
      const target = mutation.target instanceof HTMLElement ? mutation.target : undefined;
      invalidateCachedContainers(target);
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        scheduleScan(target);
      } else if (mutation.type === 'attributes') {
        scheduleScan(target);
      }
    }
  });

  privacyObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-testid', 'role', 'title', 'class']
  });
}

function setPrivacyScannerActive(active) {
  const nextActive = Boolean(active);
  if (nextActive === privacyScannerActive) {
    return;
  }

  privacyScannerActive = nextActive;
  window.clearTimeout(scanTimer);
  window.clearTimeout(priorityTimer);
  if (!privacyScannerActive) {
    pendingScanRoots.clear();
    privacyObserver?.disconnect();
    privacyObserver = undefined;
    return;
  }

  startObserver();
  scheduleScan();
  schedulePriorityState();
}

function startUnreadWorkflowTracker() {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const container = findChatListContainer();
      if (!target || !container || !container.contains(target)) {
        return;
      }

      lastUnreadListInteractionAt = Date.now();
      if (isUnreadFilterActive() && target.closest('[role="row"], [role="listitem"], [data-testid="cell-frame-container"], [aria-selected]')) {
        saveUnreadPosition(container);
      }
    },
    true
  );

  document.addEventListener(
    'wheel',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const container = findChatListContainer();
      if (target && container?.contains(target)) {
        lastUnreadListInteractionAt = Date.now();
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const container = findChatListContainer();
      if (event.key === 'Enter' && target && container?.contains(target) && isUnreadFilterActive()) {
        lastUnreadListInteractionAt = Date.now();
        saveUnreadPosition(container);
      }

      if (event.key === 'Enter' && !event.shiftKey && findMessageInput()?.contains(event.target)) {
        saveUnreadPosition();
        scheduleUnreadRestoreAfterReply();
      }

      if (event.key === 'Escape' && isFullScreen) {
        event.preventDefault();
        ipcRenderer.send('whatsapp:exit-full-screen');
      }
    },
    true
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (target?.closest?.('footer button, footer [role="button"], [aria-label*="Send" i], [data-testid*="send" i]')) {
        saveUnreadPosition();
        scheduleUnreadRestoreAfterReply();
      }
    },
    true
  );
}

async function boot() {
  ensureStyle();
  try {
    applySettings(await ipcRenderer.invoke('settings:get'));
  } catch {
    applySettings(DEFAULT_SETTINGS);
    ipcRenderer.send('whatsapp:selector-health', { scanMode: 'fallback', conversationFound: false, chatListFound: false });
  }
  ensureChatNav();
  startObserver();
  startUnreadWorkflowTracker();
  scheduleScan();
}

ipcRenderer.on('privacy-settings-updated', (_event, nextSettings) => {
  applySettings(nextSettings);
  scheduleScan();
  schedulePriorityState();
});

function isScrollableElement(element) {
  if (!(element instanceof HTMLElement) || isOwnedElement(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 160 && rect.height > 160 && element.scrollHeight > element.clientHeight + 120;
}

function isSidebarElement(element) {
  return Boolean(
    element.closest(
      'aside, nav, [aria-label*="Chat list" i], [aria-label*="chat list" i], [aria-label*="Chats" i], [role="grid"]'
    )
  );
}

function findConversationRoot() {
  if (isCurrentElement(cachedConversationRoot)) {
    return cachedConversationRoot;
  }

  const rootSelectors = [
    '#main',
    'main',
    '[role="main"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[data-testid="conversation-panel-body"]'
  ];

  for (const root of document.querySelectorAll(rootSelectors.join(','))) {
    if (
      root instanceof HTMLElement &&
      !isSidebarElement(root) &&
      root.querySelector(`${MESSAGE_SELECTOR}, footer [contenteditable="true"], [aria-label*="Type a message" i]`)
    ) {
        cachedConversationRoot = root;
        return cachedConversationRoot;
    }
  }

  const input = document.querySelector('footer [contenteditable="true"], [aria-label*="Type a message" i]');
  cachedConversationRoot = input?.closest?.('#main, main, [role="main"], [role="application"]') || null;
  return cachedConversationRoot;
}

function scoreChatScrollContainer(element, conversationRoot) {
  const rect = element.getBoundingClientRect();
  const rootRect = conversationRoot?.getBoundingClientRect?.();
  let score = 0;

  if (element.querySelector(MESSAGE_SELECTOR)) {
    score += 1000;
  } else {
    score -= 300;
  }

  if (conversationRoot?.contains(element)) {
    score += 300;
  }

  if (element.closest('main, [role="main"], #main')) {
    score += 150;
  }

  if (isSidebarElement(element)) {
    score -= 900;
  }

  if (element.querySelector('footer [contenteditable="true"]')) {
    score -= 220;
  }

  if (rootRect && rect.left >= rootRect.left - 4 && rect.right <= rootRect.right + 4) {
    score += 80;
  }

  score += Math.min(250, element.scrollHeight - element.clientHeight);
  score += Math.min(120, rect.height);
  return score;
}

function findChatScrollContainer() {
  const conversationRoot = findConversationRoot();
  if (!conversationRoot) {
    return undefined;
  }

  if (isCurrentElement(cachedChatScrollContainer) && conversationRoot.contains(cachedChatScrollContainer)) {
    return cachedChatScrollContainer;
  }

  const candidates = [...conversationRoot.querySelectorAll('div')]
    .filter(isScrollableElement)
    .map((element) => ({ element, score: scoreChatScrollContainer(element, conversationRoot) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  cachedChatScrollContainer = best?.score > 0 ? best.element : undefined;
  return cachedChatScrollContainer;
}

function findChatListContainer() {
  if (isCurrentElement(cachedChatListContainer)) {
    return cachedChatListContainer;
  }

  const roots = [
    ...document.querySelectorAll('[aria-label*="Chat list" i], [aria-label*="chat list" i], [role="grid"], aside')
  ].filter((element) => element instanceof HTMLElement && !isOwnedElement(element));

  for (const root of roots) {
    if (root.scrollHeight > root.clientHeight + 40) {
      cachedChatListContainer = root;
      return cachedChatListContainer;
    }

    const scrollable = [...root.querySelectorAll('div')]
      .filter((element) => element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 40)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (scrollable) {
      cachedChatListContainer = scrollable;
      return cachedChatListContainer;
    }
  }

  return undefined;
}

function isUnreadFilterActive() {
  const candidates = [...document.querySelectorAll('button, [role="button"], [aria-selected], [aria-pressed]')];
  return candidates.some((element) => {
    if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
      return false;
    }
    const text = element.textContent?.replace(/\s+/g, ' ').trim().toLowerCase();
    const selected = element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true';
    return text === 'unread' && selected;
  });
}

function findUnreadAnchor(container) {
  const containerRect = container.getBoundingClientRect();
  const rows = [...container.querySelectorAll('[role="row"], [role="listitem"], [data-testid="cell-frame-container"], [aria-selected]')];
  const anchor = rows.find((row) => {
    if (!(row instanceof HTMLElement) || !isVisibleElement(row)) {
      return false;
    }
    const rect = row.getBoundingClientRect();
    return rect.bottom > containerRect.top + 2 && rect.top < containerRect.bottom - 2;
  });

  if (!(anchor instanceof HTMLElement)) {
    return undefined;
  }

  return {
    element: anchor,
    topOffset: anchor.getBoundingClientRect().top - containerRect.top
  };
}

function saveUnreadPosition(container = findChatListContainer()) {
  if (!currentSettings.preserveUnreadListPosition) {
    return false;
  }

  if (!container) {
    return false;
  }

  lastUnreadPosition = {
    container,
    scrollTop: container.scrollTop,
    savedAt: Date.now(),
    wasUnreadFiltered: isUnreadFilterActive(),
    anchor: findUnreadAnchor(container)
  };
  updateChatNavVisibility();
  return true;
}

function restoreUnreadPosition({ automatic = false } = {}) {
  const savedContainer = lastUnreadPosition?.container;
  const container = isCurrentElement(savedContainer) ? savedContainer : findChatListContainer();
  if (!container || !lastUnreadPosition) {
    if (!automatic) {
      showChatToast('No unread position saved');
    }
    return false;
  }

  let targetScrollTop = lastUnreadPosition.scrollTop;
  const anchor = lastUnreadPosition.anchor;
  if (anchor?.element instanceof HTMLElement && container.contains(anchor.element)) {
    const containerRect = container.getBoundingClientRect();
    const currentOffset = anchor.element.getBoundingClientRect().top - containerRect.top;
    targetScrollTop = container.scrollTop + currentOffset - anchor.topOffset;
  }

  container.scrollTop = Math.max(0, targetScrollTop);
  if (!automatic) {
    showChatToast('Returned to unread position');
  }
  return true;
}

function scheduleUnreadRestoreAfterReply() {
  if (!currentSettings.preserveUnreadListPosition || !lastUnreadPosition?.wasUnreadFiltered) {
    return;
  }

  const runId = ++unreadRestoreRunId;
  const scheduledAt = Date.now();
  for (const delayMs of [180, 650, 1300]) {
    window.setTimeout(() => {
      if (runId !== unreadRestoreRunId || lastUnreadListInteractionAt > scheduledAt) {
        return;
      }
      restoreUnreadPosition({ automatic: true });
    }, delayMs);
  }
}

function priorityTerms() {
  return priorityTermsFromText(currentSettings.priorityKeywords);
}

function schedulePriorityState() {
  if (!privacyScannerActive) {
    return;
  }
  window.clearTimeout(priorityTimer);
  priorityTimer = window.setTimeout(updatePriorityState, 650);
}

function updatePriorityState() {
  const terms = priorityTerms();
  if (terms.length === 0) {
    if (lastPriorityState) {
      lastPriorityState = false;
      ipcRenderer.send('whatsapp:priority-state', { hasPriorityUnread: false });
    }
    return;
  }

  const chatList = findChatListContainer();
  const rows = chatList ? [...chatList.querySelectorAll('[role="row"], [role="listitem"], [aria-selected]')] : [];
  const hasPriorityUnread = rows.some((row) => {
    if (!(row instanceof HTMLElement) || !isVisibleElement(row)) {
      return false;
    }
    const nameElement = row.querySelector('span[title], span[dir="auto"], div[dir="auto"]');
    const normalizedName = (nameElement?.getAttribute('title') || nameElement?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const hasUnreadSignal = Boolean(row.querySelector('[aria-label*="unread" i], [data-testid*="unread" i], [data-icon*="unread" i]'));
    return hasUnreadSignal && terms.includes(normalizedName);
  });

  if (hasPriorityUnread !== lastPriorityState) {
    lastPriorityState = hasPriorityUnread;
    ipcRenderer.send('whatsapp:priority-state', { hasPriorityUnread });
  }
}

function findCurrentChatTitle() {
  const root = findConversationRoot();
  const header = root?.querySelector?.('header') || document.querySelector('header');
  const title = header?.querySelector?.('span[title], [dir="auto"]');
  const text = title?.getAttribute?.('title') || title?.textContent;
  return text?.replace(/\s+/g, ' ').trim() || '';
}

function copyCurrentChatTitle() {
  const title = findCurrentChatTitle();
  if (!title) {
    showChatToast('No chat title found');
    return;
  }

  ipcRenderer.send('whatsapp:copy-chat-title', title);
}

function findMessageInput() {
  return document.querySelector('footer [contenteditable="true"], [aria-label*="Type a message" i], [aria-label*="message" i][contenteditable="true"]');
}

function insertReplyTemplate(text) {
  const input = findMessageInput();
  if (!(input instanceof HTMLElement)) {
    showChatToast('Open a chat first');
    return;
  }

  input.focus();
  document.execCommand('insertText', false, text);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  showChatToast('Template inserted');
}

function quickReplyTemplates() {
  return quickReplyEntriesFromText(currentSettings.quickReplyTemplates);
}

function showQuickReplyPicker() {
  const entries = quickReplyTemplates();
  if (entries.length === 0) {
    showChatToast('No quick replies configured');
    return;
  }

  if (!document.body) {
    return;
  }

  if (!replyPickerElement || !document.body.contains(replyPickerElement)) {
    replyPickerElement = document.createElement('div');
    replyPickerElement.className = 'wapb-reply-picker';
    replyPickerElement.dataset.wapbOwned = 'true';
    document.body.append(replyPickerElement);
  }

  replyPickerElement.replaceChildren();
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search quick replies';
  search.setAttribute('aria-label', 'Search quick replies');
  const list = document.createElement('div');
  list.className = 'wapb-reply-picker-list';

  const renderEntries = (query = '') => {
    list.replaceChildren();
    const normalizedQuery = query.trim().toLowerCase();
    const matches = entries.filter((entry) => !normalizedQuery || `${entry.category} ${entry.text}`.toLowerCase().includes(normalizedQuery));
    for (const entry of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `[${entry.category}] ${entry.text}`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        replyPickerElement.hidden = true;
        insertReplyTemplate(entry.text);
      });
      list.append(button);
    }
    if (matches.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = 'No matching replies';
      list.append(empty);
    }
  };

  search.addEventListener('input', () => renderEntries(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      replyPickerElement.hidden = true;
      event.preventDefault();
    }
    if (event.key === 'Enter') {
      const firstMatch = list.querySelector('button');
      firstMatch?.click();
      event.preventDefault();
    }
  });
  replyPickerElement.append(search, list);
  renderEntries();

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => {
    replyPickerElement.hidden = true;
  });
  replyPickerElement.append(closeButton);
  replyPickerElement.hidden = false;
  search.focus();
}

function openMediaPanel() {
  const root = findConversationRoot();
  const header = root?.querySelector?.('header') || document.querySelector('header');
  const target =
    header?.querySelector?.('[role="button"], button, [tabindex]') ||
    header?.querySelector?.('div');

  if (!(target instanceof HTMLElement)) {
    showChatToast('Media panel not found');
    return;
  }

  clickElement(target);
  showChatToast('Opening chat info');
}

function collectMediaDiagnostics() {
  const video = document.createElement('video');
  const audio = document.createElement('audio');
  const diagnostics = {
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    visibilityState: document.visibilityState,
    video: {
      mp4H264: video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      mp4H265: video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      webmVp8: video.canPlayType('video/webm; codecs="vp8, vorbis"'),
      webmVp9: video.canPlayType('video/webm; codecs="vp9, opus"')
    },
    audio: {
      mp4Aac: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      oggOpus: audio.canPlayType('audio/ogg; codecs="opus"'),
      webmOpus: audio.canPlayType('audio/webm; codecs="opus"')
    }
  };

  ipcRenderer.send('whatsapp:media-diagnostics', diagnostics);
  return diagnostics;
}

function showChatToast(message) {
  if (isQuietHoursActive()) {
    return;
  }

  if (!document.body) {
    return;
  }

  if (!toastElement || !document.body.contains(toastElement)) {
    toastElement = document.createElement('div');
    toastElement.className = 'wapb-chat-toast';
    toastElement.dataset.wapbOwned = 'true';
    toastElement.hidden = true;
    document.body.append(toastElement);
  }

  toastElement.textContent = message;
  toastElement.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastElement) {
      toastElement.hidden = true;
    }
  }, 1800);
}

function isQuietHoursActive(date = new Date()) {
  return isQuietHoursActiveForSettings(currentSettings, date);
}

function startTemporaryReveal(durationMs = currentSettings.temporaryRevealMs) {
  const safeDuration = Number.isFinite(Number(durationMs)) ? Math.max(1000, Number(durationMs)) : currentSettings.temporaryRevealMs;
  isHoldRevealing = false;
  document.documentElement.dataset.wapbTemporaryReveal = 'true';
  showChatToast(`Reveal for ${Math.round(safeDuration / 1000)} seconds`);

  window.clearTimeout(temporaryRevealTimer);
  temporaryRevealTimer = window.setTimeout(() => {
    delete document.documentElement.dataset.wapbTemporaryReveal;
    showChatToast('Blur restored');
  }, safeDuration);
}

function startHoldReveal() {
  window.clearTimeout(temporaryRevealTimer);
  isHoldRevealing = true;
  document.documentElement.dataset.wapbTemporaryReveal = 'true';
  showChatToast('Release to restore privacy');
}

function stopReveal() {
  window.clearTimeout(temporaryRevealTimer);
  isHoldRevealing = false;
  delete document.documentElement.dataset.wapbTemporaryReveal;
}

function cancelOldMessageLoading(message = 'Stopped loading old messages') {
  topLoadRunId += 1;
  hideChatLoader();
  showChatToast(message);
}

function setChatLoader(message) {
  if (!document.body) {
    return;
  }

  if (!loaderElement || !document.body.contains(loaderElement)) {
    loaderElement = document.createElement('div');
    loaderElement.className = 'wapb-chat-loader';
    loaderElement.dataset.wapbOwned = 'true';
    loaderElement.hidden = true;

    loaderMessageElement = document.createElement('span');
    loaderMessageElement.className = 'wapb-chat-loader-message';

    loaderCancelButton = document.createElement('button');
    loaderCancelButton.type = 'button';
    loaderCancelButton.textContent = 'Cancel';
    loaderCancelButton.title = 'Stop loading old messages';
    loaderCancelButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelOldMessageLoading();
    });

    loaderElement.append(loaderMessageElement, loaderCancelButton);
    document.body.append(loaderElement);
  }

  loaderMessageElement.textContent = message;
  loaderElement.hidden = false;
}

function hideChatLoader() {
  if (loaderElement) {
    loaderElement.hidden = true;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function repeatChatScroll(position, attempt = 0) {
  const container = findChatScrollContainer();
  if (!container) {
    return;
  }

  const top = position === 'top' ? 0 : container.scrollHeight;
  container.scrollTo({
    top,
    behavior: attempt === 0 ? 'smooth' : 'auto'
  });

  if (attempt < 6) {
    window.setTimeout(() => repeatChatScroll(position, attempt + 1), 260);
  }
}

function findLoadOlderTrigger(root = findConversationRoot()) {
  if (!root) {
    return undefined;
  }

  const candidates = [...root.querySelectorAll('button, [role="button"], [tabindex], div, span')];
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement) || isOwnedElement(candidate) || !isVisibleElement(candidate)) {
      continue;
    }

    const text = [
      candidate.getAttribute('aria-label'),
      candidate.getAttribute('title'),
      candidate.textContent
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text.length > 140 || !LOAD_OLDER_TEXT_PATTERN.test(text)) {
      continue;
    }

    let node = candidate;
    while (node && node !== root) {
      if (node.matches('button, [role="button"], [tabindex]')) {
        return node;
      }
      node = node.parentElement;
    }

    return candidate;
  }

  return undefined;
}

function clickElement(element) {
  const options = { bubbles: true, cancelable: true, view: window };
  element.dispatchEvent(new MouseEvent('mousedown', options));
  element.dispatchEvent(new MouseEvent('mouseup', options));
  element.dispatchEvent(new MouseEvent('click', options));
  element.click?.();
}

async function loadOldestMessages() {
  const runId = ++topLoadRunId;
  let loadedBatches = 0;
  let stableSteps = 0;
  let lastScrollHeight = -1;

  const container = findChatScrollContainer();
  if (!container) {
    showChatToast('Open a chat first');
    updateChatNavVisibility();
    return;
  }

  try {
    for (let step = 0; step < TOP_LOAD_MAX_STEPS && runId === topLoadRunId; step += 1) {
      const currentContainer = findChatScrollContainer();
      if (!currentContainer) {
        showChatToast('Open a chat first');
        return;
      }

      setChatLoader(loadedBatches > 0 ? `Loading older messages... ${loadedBatches} batch${loadedBatches === 1 ? '' : 'es'}` : 'Moving to older messages...');
      currentContainer.scrollTo({ top: 0, behavior: step === 0 ? 'smooth' : 'auto' });
      await delay(TOP_LOAD_WAIT_MS);
      if (runId !== topLoadRunId) {
        return;
      }

      const loadOlder = findLoadOlderTrigger();
      if (loadOlder) {
        setChatLoader('Clicking WhatsApp load-old-messages prompt...');
        clickElement(loadOlder);
        loadedBatches += 1;
        stableSteps = 0;
        await delay(TOP_LOAD_CLICK_WAIT_MS);
        if (runId !== topLoadRunId) {
          return;
        }
        continue;
      }

      const nextContainer = findChatScrollContainer();
      if (!nextContainer) {
        showChatToast('Open a chat first');
        return;
      }

      const scrollHeightChanged = Math.abs(nextContainer.scrollHeight - lastScrollHeight) > 8;
      lastScrollHeight = nextContainer.scrollHeight;
      stableSteps = scrollHeightChanged ? 0 : stableSteps + 1;

      if (nextContainer.scrollTop <= 4 && stableSteps >= 3) {
        showChatToast(loadedBatches > 0 ? 'Reached oldest loaded messages' : 'Already at oldest loaded messages');
        return;
      }
    }

    showChatToast('Stopped after safety limit');
  } finally {
    if (runId === topLoadRunId) {
      hideChatLoader();
    }
  }
}

function scrollCurrentChat(position) {
  if (position === 'top') {
    loadOldestMessages();
    return;
  }

  topLoadRunId += 1;
  hideChatLoader();

  const container = findChatScrollContainer();
  if (!container) {
    showChatToast('Open a chat first');
    updateChatNavVisibility();
    return;
  }

  repeatChatScroll(position);
  showChatToast('Moving to latest message');
}

function ensureFullScreenExitControl() {
  if (!document.body) {
    return undefined;
  }
  if (fullScreenExitElement && document.body.contains(fullScreenExitElement)) {
    return fullScreenExitElement;
  }

  fullScreenExitElement = document.createElement('button');
  fullScreenExitElement.type = 'button';
  fullScreenExitElement.className = 'wapb-fullscreen-exit';
  fullScreenExitElement.dataset.wapbOwned = 'true';
  fullScreenExitElement.textContent = 'X';
  fullScreenExitElement.title = 'Exit full screen (F11)';
  fullScreenExitElement.setAttribute('aria-label', 'Exit full screen');
  fullScreenExitElement.hidden = true;
  fullScreenExitElement.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('whatsapp:exit-full-screen');
  });
  fullScreenExitElement.addEventListener('mouseenter', () => fullScreenExitElement?.classList.add('wapb-visible'));
  document.addEventListener('mousemove', (event) => {
    if (!isFullScreen || !fullScreenExitElement) {
      return;
    }
    fullScreenExitElement.classList.toggle('wapb-visible', event.clientY <= 72 || fullScreenExitElement.matches(':hover'));
  });
  document.body.append(fullScreenExitElement);
  return fullScreenExitElement;
}

function setFullScreenState(enabled) {
  isFullScreen = Boolean(enabled);
  const exitControl = ensureFullScreenExitControl();
  if (!exitControl) {
    return;
  }
  exitControl.hidden = !isFullScreen;
  exitControl.classList.remove('wapb-visible');
}

function ensureChatNav() {
  if (!document.body) {
    return undefined;
  }

  if (navElement && document.body.contains(navElement)) {
    return navElement;
  }

  navElement = document.createElement('div');
  navElement.className = 'wapb-chat-nav';
  navElement.dataset.wapbOwned = 'true';
  navElement.setAttribute('role', 'toolbar');
  navElement.setAttribute('aria-label', 'Unread chat workflow');
  navElement.hidden = true;

  const resumeUnreadButton = document.createElement('button');
  resumeUnreadButton.type = 'button';
  resumeUnreadButton.textContent = 'Resume unread list';
  resumeUnreadButton.title = 'Return to the unread-list position saved before replying (Ctrl+Alt+U)';
  resumeUnreadButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    restoreUnreadPosition();
  });

  navElement.append(resumeUnreadButton);
  document.body.append(navElement);
  return navElement;
}

function updateChatNavVisibility() {
  const nav = ensureChatNav();
  if (!nav) {
    return;
  }

  nav.hidden = !currentSettings.preserveUnreadListPosition || !lastUnreadPosition?.wasUnreadFiltered;
}

ipcRenderer.on('whatsapp-command', (_event, command) => {
  if (!command || typeof command.type !== 'string') {
    return;
  }

  if (command.type === 'chat-scroll-top') {
    scrollCurrentChat('top');
  }

  if (command.type === 'chat-scroll-bottom') {
    scrollCurrentChat('bottom');
  }

  if (command.type === 'chat-scroll-cancel') {
    cancelOldMessageLoading();
  }

  if (command.type === 'temporary-reveal') {
    startTemporaryReveal(command.durationMs);
  }

  if (command.type === 'show-toast' && typeof command.message === 'string') {
    showChatToast(command.message);
  }

  if (command.type === 'privacy-reset') {
    stopReveal();
    showChatToast('Privacy reset');
  }

  if (command.type === 'set-idle-mode') {
    setPrivacyScannerActive(!command.idle);
  }

  if (command.type === 'set-full-screen') {
    setFullScreenState(command.enabled);
  }

  if (command.type === 'unread-position-save') {
    if (saveUnreadPosition()) {
      showChatToast('Unread position saved');
    } else {
      showChatToast('No chat list position found');
    }
  }

  if (command.type === 'unread-position-restore') {
    restoreUnreadPosition();
  }

  if (command.type === 'copy-current-chat-title') {
    copyCurrentChatTitle();
  }

  if (command.type === 'insert-reply-template' && typeof command.text === 'string') {
    insertReplyTemplate(command.text);
  }

  if (command.type === 'quick-reply-picker') {
    showQuickReplyPicker();
  }

  if (command.type === 'open-media-panel') {
    openMediaPanel();
  }

  if (command.type === 'optimize-now') {
    showChatToast('Optimizing memory...');
  }

  if (command.type === 'collect-media-diagnostics') {
    collectMediaDiagnostics();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

window.addEventListener('blur', stopReveal);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopReveal();
  }
  if (currentSettings.idlePowerSaver) {
    setPrivacyScannerActive(!document.hidden);
  }
});
