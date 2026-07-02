const { clipboard, ipcRenderer } = require('electron');
const {
  isQuietHoursActive: isQuietHoursActiveForSettings,
  priorityTermsFromText,
  quickReplyTemplatesFromText
} = require('./workflow-helpers');

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

const OWN_SELECTOR = '[data-wapb-owned="true"]';
const MESSAGE_SELECTOR = '[data-testid="msg-container"], [data-pre-plain-text], .message-in, .message-out';
const LOAD_OLDER_TEXT_PATTERN = /click\s+to\s+load\s+(?:old|older)\s+messages|load\s+(?:old|older)\s+messages/i;
const TOP_LOAD_MAX_STEPS = 60;
const TOP_LOAD_WAIT_MS = 650;
const TOP_LOAD_CLICK_WAIT_MS = 1300;

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

function markChatMessages(root = document) {
  for (const message of root.querySelectorAll(MESSAGE_SELECTOR)) {
    if (isVisibleElement(message)) {
      setToken(message, 'message', true);
    }
  }
}

function markChatPreviewsAndNames(root = document) {
  const appRoot = root.querySelector?.('#app') || document;
  const chatList =
    appRoot.querySelector('[aria-label*="Chat list" i], [aria-label*="chat list" i], [role="grid"]') || appRoot;
  const rows = chatList.querySelectorAll('[role="row"], [role="listitem"], [aria-selected]');

  for (const row of rows) {
    if (!isVisibleElement(row)) {
      continue;
    }

    const candidates = row.querySelectorAll('span[title], span[dir="auto"], div[dir="auto"]');
    const textNodes = [...candidates].filter((item) => isVisibleElement(item) && hasText(item));

    if (textNodes[0]) {
      setToken(textNodes[0], 'name', true);
    }
    for (const preview of textNodes.slice(1, 4)) {
      setToken(preview, 'preview', true);
    }
  }
}

function markHeaderAndParticipantNames(root = document) {
  const headers = root.querySelectorAll('header span[title], header span[dir="auto"], header div[dir="auto"]');
  for (const headerText of headers) {
    if (isVisibleElement(headerText) && hasText(headerText)) {
      setToken(headerText, 'name', true);
    }
  }
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

  for (const media of root.querySelectorAll(mediaSelectors.join(','))) {
    if (!isVisibleElement(media)) {
      continue;
    }

    const inMessage = media.closest('[data-testid="msg-container"], [data-pre-plain-text], .message-in, .message-out');
    const wrapper = inMessage || media.closest('div') || media;
    setToken(wrapper, 'media', true);
  }
}

function markGallery(root = document) {
  const thumbnails = root.querySelectorAll(
    '[role="dialog"] img, [role="dialog"] video, [role="dialog"] canvas, [aria-modal="true"] img, [aria-modal="true"] video, [aria-modal="true"] canvas'
  );

  for (const thumbnail of thumbnails) {
    if (isVisibleElement(thumbnail)) {
      setToken(thumbnail.closest('button, div') || thumbnail, 'gallery', true);
    }
  }
}

function markAvatars(root = document) {
  const avatarSelectors = [
    'img[draggable="false"]',
    '[data-testid*="avatar"]',
    '[data-testid*="default-user"]',
    '[aria-label*="profile" i] img',
    '[role="img"]'
  ];

  for (const avatar of root.querySelectorAll(avatarSelectors.join(','))) {
    if (!isVisibleElement(avatar)) {
      continue;
    }

    const rect = avatar.getBoundingClientRect();
    if (rect.width <= 96 && rect.height <= 96) {
      const row = nearestListItem(avatar);
      const target = avatar.closest('button, div') || row || avatar;
      setToken(target, 'avatar', true);
    }
  }
}

function markInput(root = document) {
  const inputs = root.querySelectorAll(
    'footer [contenteditable="true"], [aria-label*="Type a message" i], [aria-label*="message" i][contenteditable="true"]'
  );

  for (const input of inputs) {
    if (isVisibleElement(input)) {
      setToken(input, 'input', true);
    }
  }
}

function clearStaleMarks() {
  for (const element of document.querySelectorAll('[data-wapb-kind]')) {
    if (!document.documentElement.contains(element)) {
      continue;
    }
    if (!isVisibleElement(element)) {
      delete element.dataset.wapbKind;
    }
  }
}

function markPrivacyTargets(root = document) {
  markChatMessages(root);
  markChatPreviewsAndNames(root);
  markHeaderAndParticipantNames(root);
  markMedia(root);
  markGallery(root);
  markAvatars(root);
  markInput(root);
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
function scheduleScan(root = document) {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    ensureStyle();
    clearStaleMarks();
    markPrivacyTargets(root);
    updateChatNavVisibility();
  }, 120);
}

function startObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        scheduleScan(document);
        return;
      }
      if (mutation.type === 'attributes') {
        scheduleScan(document);
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-testid', 'role', 'title', 'class']
  });
}

function startUnreadWorkflowTracker() {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.shiftKey && findMessageInput()?.contains(event.target)) {
        saveUnreadPosition();
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
      }
    },
    true
  );
}

async function boot() {
  ensureStyle();
  applySettings(await ipcRenderer.invoke('settings:get'));
  markPrivacyTargets(document);
  ensureChatNav();
  updateChatNavVisibility();
  startObserver();
  startUnreadWorkflowTracker();
  window.setInterval(() => {
    scheduleScan(document);
    updateChatNavVisibility();
    updatePriorityState();
  }, 2500);
}

ipcRenderer.on('privacy-settings-updated', (_event, nextSettings) => {
  applySettings(nextSettings);
  scheduleScan(document);
  updatePriorityState();
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
      return root;
    }
  }

  const input = document.querySelector('footer [contenteditable="true"], [aria-label*="Type a message" i]');
  return input?.closest?.('#main, main, [role="main"], [role="application"]') || null;
}

function scoreChatScrollContainer(element) {
  const rect = element.getBoundingClientRect();
  const conversationRoot = findConversationRoot();
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

  const candidates = [...conversationRoot.querySelectorAll('div')]
    .filter(isScrollableElement)
    .map((element) => ({ element, score: scoreChatScrollContainer(element) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  return best?.score > 0 ? best.element : undefined;
}

function findChatListContainer() {
  const roots = [
    ...document.querySelectorAll('[aria-label*="Chat list" i], [aria-label*="chat list" i], [role="grid"], aside')
  ].filter((element) => element instanceof HTMLElement && !isOwnedElement(element));

  for (const root of roots) {
    if (root.scrollHeight > root.clientHeight + 40) {
      return root;
    }

    const scrollable = [...root.querySelectorAll('div')]
      .filter((element) => element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 40)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (scrollable) {
      return scrollable;
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

function saveUnreadPosition() {
  if (!currentSettings.preserveUnreadListPosition) {
    return false;
  }

  const container = findChatListContainer();
  if (!container) {
    return false;
  }

  lastUnreadPosition = {
    scrollTop: container.scrollTop,
    savedAt: Date.now(),
    wasUnreadFiltered: isUnreadFilterActive()
  };
  return true;
}

function restoreUnreadPosition() {
  const container = findChatListContainer();
  if (!container || !lastUnreadPosition) {
    showChatToast('No unread position saved');
    return;
  }

  container.scrollTo({ top: lastUnreadPosition.scrollTop, behavior: 'smooth' });
  showChatToast('Returned to unread position');
}

function priorityTerms() {
  return priorityTermsFromText(currentSettings.priorityKeywords);
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
    const text = row.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
    const hasUnreadSignal = /\b\d+\b/.test(text) || row.querySelector('[aria-label*="unread" i], [data-testid*="unread" i]');
    return hasUnreadSignal && terms.some((term) => text.includes(term));
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

  clipboard.writeText(title);
  showChatToast('Chat title copied');
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
  return quickReplyTemplatesFromText(currentSettings.quickReplyTemplates);
}

function showQuickReplyPicker() {
  const templates = quickReplyTemplates();
  if (templates.length === 0) {
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
  for (const template of templates) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = template;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      replyPickerElement.hidden = true;
      insertReplyTemplate(template);
    });
    replyPickerElement.append(button);
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => {
    replyPickerElement.hidden = true;
  });
  replyPickerElement.append(closeButton);
  replyPickerElement.hidden = false;
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
  document.documentElement.dataset.wapbTemporaryReveal = 'true';
  showChatToast(`Reveal for ${Math.round(safeDuration / 1000)} seconds`);

  window.clearTimeout(temporaryRevealTimer);
  temporaryRevealTimer = window.setTimeout(() => {
    delete document.documentElement.dataset.wapbTemporaryReveal;
    showChatToast('Blur restored');
  }, safeDuration);
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
  navElement.setAttribute('aria-label', 'Current chat navigation');
  navElement.hidden = true;

  const topButton = document.createElement('button');
  topButton.type = 'button';
  topButton.textContent = 'Top';
  topButton.title = 'Go to top of current chat (Ctrl+Alt+Home)';
  topButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrollCurrentChat('top');
  });

  const latestButton = document.createElement('button');
  latestButton.type = 'button';
  latestButton.textContent = 'Latest';
  latestButton.title = 'Go to latest message (Ctrl+Alt+End)';
  latestButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrollCurrentChat('bottom');
  });

  navElement.append(topButton, latestButton);
  document.body.append(navElement);
  return navElement;
}

function updateChatNavVisibility() {
  const nav = ensureChatNav();
  if (!nav) {
    return;
  }

  nav.hidden = !findChatScrollContainer();
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
    delete document.documentElement.dataset.wapbTemporaryReveal;
    window.clearTimeout(temporaryRevealTimer);
    showChatToast('Privacy reset');
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
