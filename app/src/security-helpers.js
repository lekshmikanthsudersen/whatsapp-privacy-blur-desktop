const MAX_CHAT_TITLE_LENGTH = 256;
const MAX_IPC_PATCH_KEYS = 24;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isSameWebContents(event, win) {
  return Boolean(win && !win.isDestroyed() && event?.sender === win.webContents);
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isWhatsAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'web.whatsapp.com';
  } catch {
    return false;
  }
}

function isWhatsAppPermissionRequest(permission, requestingOrigin) {
  try {
    const origin = new URL(requestingOrigin);
    return origin.protocol === 'https:' && origin.hostname === 'web.whatsapp.com' && permission === 'media';
  } catch {
    return false;
  }
}

function validateSettingsPatch(patch, allowedKeys) {
  if (!isPlainObject(patch)) {
    return { ok: false, reason: 'Settings update must be an object.' };
  }

  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.length > MAX_IPC_PATCH_KEYS || keys.some((key) => !allowedKeys.has(key))) {
    return { ok: false, reason: 'Settings update contains unsupported fields.' };
  }

  return { ok: true, patch };
}

function validateChatTitle(title) {
  if (typeof title !== 'string') {
    return { ok: false, reason: 'Chat title must be text.' };
  }

  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > MAX_CHAT_TITLE_LENGTH) {
    return { ok: false, reason: 'Chat title has an invalid length.' };
  }

  return { ok: true, value: normalized };
}

function normalizeSelectorHealth(payload) {
  if (!isPlainObject(payload)) {
    return undefined;
  }

  const count = (value) => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100000 ? numeric : 0;
  };

  return {
    at: new Date().toISOString(),
    scanMode: payload.scanMode === 'scoped' ? 'scoped' : 'fallback',
    messageTargets: count(payload.messageTargets),
    previewTargets: count(payload.previewTargets),
    mediaTargets: count(payload.mediaTargets),
    galleryTargets: count(payload.galleryTargets),
    avatarTargets: count(payload.avatarTargets),
    inputTargets: count(payload.inputTargets),
    conversationFound: Boolean(payload.conversationFound),
    chatListFound: Boolean(payload.chatListFound)
  };
}

module.exports = {
  MAX_CHAT_TITLE_LENGTH,
  isPlainObject,
  isSafeExternalUrl,
  isSameWebContents,
  isWhatsAppPermissionRequest,
  isWhatsAppUrl,
  normalizeSelectorHealth,
  validateChatTitle,
  validateSettingsPatch
};
