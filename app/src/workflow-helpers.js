function clampNumber(value, definition) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return definition.fallback;
  }
  return Math.min(definition.max, Math.max(definition.min, next));
}

function sanitizeString(value, definition) {
  if (typeof value !== 'string') {
    return definition.fallback;
  }
  return value.slice(0, definition.maxLength);
}

function sanitizeSettings(candidate, schema) {
  const next = { ...schema.defaults };

  for (const key of schema.booleanKeys) {
    if (typeof candidate?.[key] === 'boolean') {
      next[key] = candidate[key];
    }
  }

  for (const [key, definition] of Object.entries(schema.numberSettings)) {
    if (candidate?.[key] !== undefined) {
      next[key] = clampNumber(candidate[key], definition);
    }
  }

  for (const [key, definition] of Object.entries(schema.stringSettings)) {
    if (candidate?.[key] !== undefined) {
      next[key] = sanitizeString(candidate[key], definition);
    }
  }

  return next;
}

function parseClock(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function isQuietHoursActive(settings, date = new Date()) {
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

function parseUnreadCount(title) {
  const match = /^\((\d+)\)\s+/.exec(title || '');
  return match ? Number(match[1]) : 0;
}

function quickReplyTemplatesFromText(value, limit = 12) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function priorityTermsFromText(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeProcessMemory(metrics = []) {
  let totalPrivateBytes = 0;
  let rendererPrivateBytes = 0;

  for (const item of metrics) {
    const privateBytes = Number(item?.memory?.privateBytes) || 0;
    totalPrivateBytes += privateBytes;

    if (item?.type === 'Tab' || item?.type === 'Renderer') {
      rendererPrivateBytes += privateBytes;
    }
  }

  return {
    totalPrivateMb: totalPrivateBytes / 1048576,
    rendererPrivateMb: rendererPrivateBytes / 1048576
  };
}

function buildWhatsAppUserAgent(chromeVersion) {
  const safeChromeVersion = /^\d+\.\d+\.\d+\.\d+$/.test(String(chromeVersion || ''))
    ? chromeVersion
    : '126.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${safeChromeVersion} Safari/537.36`;
}

function normalizeSettingsBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') {
    return { ok: false, reason: 'settings bridge missing' };
  }

  for (const method of ['get', 'update', 'onUpdate', 'ping']) {
    if (typeof bridge[method] !== 'function') {
      return { ok: false, reason: `settings bridge missing ${method}()` };
    }
  }

  return { ok: true };
}

function redactDiagnostics(diagnostics) {
  const clone = JSON.parse(JSON.stringify(diagnostics || {}));

  if (Object.prototype.hasOwnProperty.call(clone.settings || {}, 'priorityKeywords')) {
    clone.settings.priorityKeywords = '[redacted]';
  }
  if (Object.prototype.hasOwnProperty.call(clone.settings || {}, 'quickReplyTemplates')) {
    clone.settings.quickReplyTemplates = '[redacted]';
  }

  return clone;
}

function buildAttentionParts({ unreadCount = 0, hasPriorityUnread = false, settings, memorySample, quiet = false }) {
  const suppressAttention = quiet || (settings.focusMode && !hasPriorityUnread);
  const parts = [];

  if (!suppressAttention && unreadCount > 0) {
    parts.push(`${unreadCount} unread`);
  }
  if (!quiet && hasPriorityUnread) {
    parts.push('Priority unread');
  }
  if (memorySample?.totalPrivateMb >= settings.memoryWarnMb) {
    parts.push(`High memory ${memorySample.totalPrivateMb.toFixed(0)} MB`);
  }

  return { parts, suppressAttention };
}

function buildTrayTooltip(parts) {
  return `WhatsApp Privacy Blur${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

module.exports = {
  buildAttentionParts,
  buildTrayTooltip,
  buildWhatsAppUserAgent,
  clampNumber,
  isQuietHoursActive,
  normalizeProcessMemory,
  normalizeSettingsBridge,
  parseClock,
  parseUnreadCount,
  priorityTermsFromText,
  quickReplyTemplatesFromText,
  redactDiagnostics,
  sanitizeSettings,
  sanitizeString
};
