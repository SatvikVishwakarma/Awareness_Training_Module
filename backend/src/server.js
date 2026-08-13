require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  ensureSchema,
  saveEmployeeSubmission,
  listEmployeeSubmissions,
  clearEmployeeSubmissions,
  getModuleRegistry,
  setModuleRegistry,
  getModuleAvailability,
  setModuleAvailability,
  getSiteLock,
  setSiteLock,
  getAdminPasswordHash,
  setAdminPasswordHash
} = require('./db');

const app = express();
const port = Number(process.env.PORT || 3001);
const appRoot = path.join(__dirname, '..', '..');
const reactBuildRoot = path.join(appRoot, 'frontend-react', 'dist');
const adminSessions = new Map();
const loginAttempts = new Map();

const defaultModuleRegistry = [
  {
    id: 'phishing',
    title: 'Phishing, Smishing & Vishing',
    entryPath: 'phishing-smishing-vishing-training/enhanced-interactive-training.html'
  },
  {
    id: 'ceo',
    title: 'CEO & Executive Fraud',
    entryPath: 'ceo-executive-fraud-training/enhanced-interactive-training.html'
  },
  {
    id: 'watering',
    title: 'Watering Hole Attacks',
    entryPath: 'watering-hole-attacks-training/enhanced-interactive-training.html'
  },
  {
    id: 'general',
    title: 'General Cybersecurity Awareness',
    entryPath: 'general-cybersecurity-training/enhanced-interactive-training.html'
  },
  {
    id: 'password-mfa',
    title: 'Password & MFA Training',
    entryPath: 'Password-mfa-training/password-mfa-training.html'
  },
  {
    id: 'incident-response',
    title: 'Incident Response Training',
    entryPath: 'incident-response training/incident-response-training.html'
  },
  {
    id: 'privacy',
    title: 'Privacy Awareness Training',
    entryPath: 'privacy-awareness-training/enhanced-interactive-training.html'
  },
  {
    id: 'secure-coding',
    title: 'Secure Coding (OWASP)',
    entryPath: 'secure-coding-training/enhanced-interactive-training.html'
  },
  {
    id: 'ssdlc',
    title: 'Secure SDLC (SSDLC)',
    entryPath: 'SSDLC-Training/ssdlc-training-module.html'
  }
];

const defaultModuleAvailability = defaultModuleRegistry.reduce((acc, module) => {
  acc[module.id] = true;
  return acc;
}, {});

const defaultSiteLock = {
  locked: false,
  reason: 'Training portal is temporarily unavailable. Please contact your administrator.'
};

app.set('trust proxy', true);
app.use(express.json({ limit: '10mb' }));
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));

const sessionCookieName = 'admin_session';
const loginWindowMs = Number(process.env.ADMIN_LOGIN_WINDOW_MS || 15 * 60 * 1000);
const loginMaxAttempts = Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS || 5);
const loginLockMs = Number(process.env.ADMIN_LOGIN_LOCK_MS || 15 * 60 * 1000);
let adminPasswordHash = normalizeString(process.env.ADMIN_PASSWORD_HASH);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  app.use(cors());
} else {
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin not allowed by CORS policy'));
      }
    })
  );
}

app.use(async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path === '/health') {
    return next();
  }

  if (req.method !== 'GET') {
    return next();
  }

  const isHtmlRequest = req.path === '/' || req.path === '' || req.path.endsWith('.html');
  if (!isHtmlRequest) {
    return next();
  }

  try {
    const siteLock = await getSiteLock(defaultSiteLock);
    if (siteLock && siteLock.locked) {
      const reason = normalizeString(siteLock.reason) || defaultSiteLock.reason;
      res.status(423).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portal Locked</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;font-family:Segoe UI,Tahoma,sans-serif;padding:24px}.card{max-width:640px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:16px;padding:28px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,.3)}h1{margin:0 0 12px 0}</style></head><body><div class="card"><h1>Training Portal Locked</h1><p>${reason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></div></body></html>`);
      return;
    }
  } catch (error) {
    console.error('Failed to evaluate site lock state:', error);
  }

  next();
});

app.use(express.static(appRoot));

app.use('/react', express.static(reactBuildRoot));
app.get('/react', (req, res) => {
  const entryFile = path.join(reactBuildRoot, 'index.html');
  if (fs.existsSync(entryFile)) {
    return res.sendFile(entryFile);
  }

  return res.status(503).type('html').send('<h1>React app is not built yet.</h1><p>Run: <code>cd frontend-react && npm install && npm run build</code></p>');
});

function normalizeString(value) {
  return String(value || '').trim();
}

function getCurrentAdminPasswordHash() {
  return adminPasswordHash;
}

function setCurrentAdminPasswordHash(hash) {
  adminPasswordHash = normalizeString(hash);
  return adminPasswordHash;
}

function normalizeModuleId(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function slugifyModuleId(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeEntryPath(value) {
  const cleaned = normalizeString(value).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.startsWith('/')) {
    return '';
  }
  return cleaned;
}

function normalizeModuleIcon(value) {
  const icon = String(value || '').trim();
  if (!icon) {
    return '';
  }

  return Array.from(icon).slice(0, 2).join('');
}

function normalizeModuleRecord(rawModule) {
  const id = normalizeModuleId(rawModule?.id);
  const title = normalizeString(rawModule?.title);
  const entryPath = normalizeEntryPath(rawModule?.entryPath);
  if (!id || !title || !entryPath) {
    return null;
  }

  return {
    id,
    title,
    entryPath,
    icon: normalizeModuleIcon(rawModule?.icon)
  };
}

function getModuleTitleIcon(moduleRecord) {
  const knownIcons = {
    phishing: '🎣',
    ceo: '👔',
    watering: '🌐',
    general: '🛡️',
    'password-mfa': '🔐',
    'incident-response': '🚨',
    privacy: '🔒',
    'secure-coding': '💻',
    ssdlc: '🧭'
  };

  const normalizedId = normalizeModuleId(moduleRecord?.id);
  if (knownIcons[normalizedId]) {
    return knownIcons[normalizedId];
  }

  const normalizedTitle = normalizeString(moduleRecord?.title).toLowerCase();
  if (normalizedTitle.includes('phishing') || normalizedTitle.includes('smishing') || normalizedTitle.includes('vishing')) {
    return '🎣';
  }
  if (normalizedTitle.includes('executive') || normalizedTitle.includes('ceo') || normalizedTitle.includes('fraud')) {
    return '👔';
  }
  if (normalizedTitle.includes('watering')) {
    return '🌐';
  }
  if (normalizedTitle.includes('password') || normalizedTitle.includes('mfa')) {
    return '🔐';
  }
  if (normalizedTitle.includes('incident')) {
    return '🚨';
  }
  if (normalizedTitle.includes('privacy')) {
    return '🔒';
  }
  if (normalizedTitle.includes('coding') || normalizedTitle.includes('owasp')) {
    return '💻';
  }
  if (normalizedTitle.includes('sdlc')) {
    return '🧭';
  }
  if (normalizedTitle.includes('cloud')) {
    return '☁️';
  }
  if (normalizedTitle.includes('security') || normalizedTitle.includes('cyber')) {
    return '🛡️';
  }

  return '📘';
}

function getModuleDescription(title) {
  return `Launch ${normalizeString(title) || 'this training module'} from the training portal.`;
}

function countSlidesFromHtml(htmlContent) {
  const source = String(htmlContent || '');
  const explicitSlideIds = source.match(/id\s*=\s*['"]slide\d+['"]/gi);
  if (explicitSlideIds && explicitSlideIds.length > 0) {
    return explicitSlideIds.length;
  }

  const slideClassMatches = source.match(/class\s*=\s*['"][^'"]*\bslide\b[^'"]*['"]/gi);
  if (slideClassMatches && slideClassMatches.length > 0) {
    return slideClassMatches.length;
  }

  return 1;
}

function hasPortalTrackingBridge(htmlContent) {
  return String(htmlContent || '').includes('data-portal-tracking-bridge="true"');
}

function buildPortalTrackingBridge(moduleId, totalSlides) {
  const safeModuleId = JSON.stringify(moduleId);
  const safeTotalSlides = Math.max(Number(totalSlides) || 1, 1);

  return `
<script data-portal-tracking-bridge="true">
(function () {
  const MODULE_ID = ${safeModuleId};
  const FALLBACK_TOTAL_SLIDES = ${safeTotalSlides};
  let lastReportedSlide = null;
  let completionSent = false;

  function getSlides() {
    return Array.from(document.querySelectorAll('.slide'));
  }

  function getTotalSlides() {
    const slides = getSlides();
    return slides.length || FALLBACK_TOTAL_SLIDES || 1;
  }

  function getActiveSlideNumber() {
    const activeSlide = document.querySelector('.slide.active[id^="slide"]');
    if (activeSlide) {
      const match = activeSlide.id.match(/slide(\\d+)/i);
      if (match) {
        return Number(match[1]) || 1;
      }
    }

    const slides = getSlides();
    const activeIndex = slides.findIndex((slide) => slide.classList.contains('active'));
    return activeIndex >= 0 ? activeIndex + 1 : 1;
  }

  function postToParent(payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }
  }

  function reportSlideChange() {
    const slide = getActiveSlideNumber();
    if (slide !== lastReportedSlide) {
      lastReportedSlide = slide;
      postToParent({
        type: 'slideChange',
        slide,
        module: MODULE_ID
      });
    }

    if (slide >= getTotalSlides()) {
      reportCompletion();
    }
  }

  function reportCompletion() {
    if (completionSent) {
      return;
    }

    completionSent = true;
    postToParent({
      type: 'moduleComplete',
      module: MODULE_ID
    });
  }

  function applySlideState(slideNumber) {
    const requestedSlide = Math.max(Number(slideNumber) || 1, 1);
    if (typeof window.showSlide === 'function') {
      window.showSlide(requestedSlide);
      return;
    }

    const slides = getSlides();
    slides.forEach((slide, index) => {
      slide.classList.toggle('active', index === requestedSlide - 1);
    });

    const progressFill = document.getElementById('progressFill') || document.getElementById('progressBar');
    if (progressFill) {
      progressFill.style.width = ((requestedSlide / getTotalSlides()) * 100) + '%';
    }

    const slideLabel = document.getElementById('slideLabel');
    if (slideLabel) {
      slideLabel.textContent = 'Slide ' + requestedSlide + ' of ' + getTotalSlides();
    }

    reportSlideChange();
  }

  function patchFunction(functionName, afterHook) {
    if (typeof window[functionName] !== 'function' || window[functionName].__portalBridgePatched) {
      return;
    }

    const original = window[functionName];
    const patched = function (...args) {
      const result = original.apply(this, args);
      setTimeout(afterHook, 0);
      return result;
    };

    patched.__portalBridgePatched = true;
    window[functionName] = patched;
  }

  function setupHomeTrigger() {
    const homeTrigger = document.querySelector('.grc-owl');
    if (!homeTrigger || homeTrigger.__portalHomeBound) {
      return;
    }

    homeTrigger.__portalHomeBound = true;
    homeTrigger.addEventListener('click', function () {
      postToParent({ type: 'goHome' });
    });
  }

  function setupRestoreStateListener() {
    if (window.__portalRestoreListenerBound) {
      return;
    }

    window.__portalRestoreListenerBound = true;
    window.addEventListener('message', function (event) {
      if (!event.data || typeof event.data !== 'object') {
        return;
      }

      if (event.data.type === 'restoreState') {
        const targetSlide = Math.max(Number(event.data.slide) || 1, 1);
        setTimeout(function () {
          applySlideState(targetSlide);
        }, 40);
      }
    });
  }

  function initTrackingBridge() {
    patchFunction('showSlide', reportSlideChange);
    patchFunction('nextSlide', reportSlideChange);
    patchFunction('prevSlide', reportSlideChange);
    patchFunction('previousSlide', reportSlideChange);
    patchFunction('completeTraining', reportCompletion);
    patchFunction('completeModule', reportCompletion);
    patchFunction('finishTraining', reportCompletion);
    setupHomeTrigger();
    setupRestoreStateListener();

    const requestedSlide = Number(new URLSearchParams(window.location.search).get('slide') || '');
    if (requestedSlide > 1) {
      setTimeout(function () {
        applySlideState(requestedSlide);
      }, 60);
    } else {
      setTimeout(reportSlideChange, 60);
    }

    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(function () {
        reportSlideChange();
      });
      observer.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrackingBridge, { once: true });
  } else {
    initTrackingBridge();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      initTrackingBridge();
      reportSlideChange();
    }, 120);
  });
})();
</script>`;
}

function injectPortalTrackingBridge(htmlContent, moduleId) {
  const source = String(htmlContent || '');
  if (!source) {
    return source;
  }

  if (hasPortalTrackingBridge(source)) {
    return source;
  }

  const bridge = buildPortalTrackingBridge(moduleId, countSlidesFromHtml(source));
  if (/<\/body>/i.test(source)) {
    return source.replace(/<\/body>/i, `${bridge}\n</body>`);
  }

  return `${source}\n${bridge}`;
}

function ensureUploadedModuleTracking(moduleRecord) {
  const normalizedEntryPath = normalizeEntryPath(moduleRecord?.entryPath);
  if (!normalizedEntryPath || !normalizedEntryPath.startsWith('uploaded-modules/')) {
    return;
  }

  const resolvedEntryPath = path.resolve(appRoot, normalizedEntryPath);
  if (!fs.existsSync(resolvedEntryPath)) {
    return;
  }

  try {
    const htmlContent = fs.readFileSync(resolvedEntryPath, 'utf8');
    if (hasPortalTrackingBridge(htmlContent)) {
      return;
    }

    const patchedHtml = injectPortalTrackingBridge(htmlContent, moduleRecord.id);
    fs.writeFileSync(resolvedEntryPath, patchedHtml, 'utf8');
  } catch (error) {
    console.warn(`Unable to prepare uploaded module tracking bridge: ${normalizedEntryPath}`, error);
  }
}

function getModuleMetadata(moduleRecord) {
  const resolvedEntryPath = path.resolve(appRoot, moduleRecord.entryPath);
  let totalSlides = 1;

  try {
    if (fs.existsSync(resolvedEntryPath)) {
      const htmlContent = fs.readFileSync(resolvedEntryPath, 'utf8');
      totalSlides = countSlidesFromHtml(htmlContent);
    }
  } catch (error) {
    console.warn(`Unable to read module HTML for metadata: ${moduleRecord.entryPath}`, error);
  }

  return {
    ...moduleRecord,
    description: getModuleDescription(moduleRecord.title),
    icon: normalizeModuleIcon(moduleRecord.icon) || getModuleTitleIcon(moduleRecord),
    totalSlides
  };
}

function sanitizeModuleRegistry(rawRegistry, fallbackRegistry) {
  const isPersistedArray = Array.isArray(rawRegistry);
  const source = isPersistedArray ? rawRegistry : fallbackRegistry;
  const seenIds = new Set();
  const sanitized = [];

  for (const item of source) {
    const normalized = normalizeModuleRecord(item);
    if (!normalized || seenIds.has(normalized.id)) {
      continue;
    }

    seenIds.add(normalized.id);
    sanitized.push(normalized);
  }

  if (sanitized.length > 0) {
    return sanitized;
  }

  return isPersistedArray ? [] : fallbackRegistry;
}

function buildAvailabilityDefaults(moduleRegistry) {
  return moduleRegistry.reduce((acc, module) => {
    acc[module.id] = true;
    return acc;
  }, {});
}

function mergeAvailability(moduleRegistry, persistedAvailability) {
  const defaults = buildAvailabilityDefaults(moduleRegistry);
  const current = persistedAvailability && typeof persistedAvailability === 'object' ? persistedAvailability : {};
  const merged = { ...defaults };

  for (const module of moduleRegistry) {
    if (typeof current[module.id] === 'boolean') {
      merged[module.id] = current[module.id];
    }
  }

  return merged;
}

async function resolveModuleState() {
  const storedRegistry = await getModuleRegistry(defaultModuleRegistry);
  const moduleRegistry = sanitizeModuleRegistry(storedRegistry, defaultModuleRegistry);
  moduleRegistry.forEach((module) => ensureUploadedModuleTracking(module));
  const persistedAvailability = await getModuleAvailability(buildAvailabilityDefaults(moduleRegistry));
  const moduleAvailability = mergeAvailability(moduleRegistry, persistedAvailability);

  return {
    moduleRegistry: moduleRegistry.map((module) => getModuleMetadata(module)),
    moduleAvailability
  };
}

function createUniqueModuleId(baseId, existingIds) {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let counter = 2;
  while (existingIds.has(`${baseId}-${counter}`)) {
    counter += 1;
  }

  return `${baseId}-${counter}`;
}

function toStoredModuleRecord(module) {
  return {
    id: module.id,
    title: module.title,
    entryPath: module.entryPath,
    icon: normalizeModuleIcon(module.icon)
  };
}

function isPathInside(basePath, targetPath) {
  const normalizedBase = `${path.resolve(basePath)}${path.sep}`;
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget.startsWith(normalizedBase);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') {
    return {};
  }

  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) {
        return acc;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (key) {
        acc[key] = decodeURIComponent(value);
      }

      return acc;
    }, {});
}

function setSessionCookie(req, res, token, maxAgeMs) {
  const secure = req.secure || normalizeString(req.headers['x-forwarded-proto']) === 'https';
  const cookieParts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    'HttpOnly',
    'SameSite=Strict'
  ];

  if (secure) {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(req, res) {
  const secure = req.secure || normalizeString(req.headers['x-forwarded-proto']) === 'https';
  const cookieParts = [
    `${sessionCookieName}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict'
  ];

  if (secure) {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return normalizeString(req.ip || req.socket?.remoteAddress || 'unknown');
}

function hashUserAgent(value) {
  return crypto.createHash('sha256').update(normalizeString(value || 'unknown')).digest('hex');
}

function getLoginState(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);

  if (!current || current.windowExpiresAt <= now) {
    const resetState = {
      attempts: 0,
      windowExpiresAt: now + loginWindowMs,
      lockUntil: 0
    };
    loginAttempts.set(ip, resetState);
    return resetState;
  }

  return current;
}

function recordFailedLogin(ip) {
  const state = getLoginState(ip);
  const now = Date.now();

  state.attempts += 1;
  if (state.attempts >= loginMaxAttempts) {
    state.lockUntil = now + loginLockMs;
    state.attempts = 0;
    state.windowExpiresAt = now + loginWindowMs;
  }

  loginAttempts.set(ip, state);
  return state;
}

function clearFailedLogin(ip) {
  loginAttempts.delete(ip);
}

async function verifyAdminPassword(password) {
  const configuredHash = getCurrentAdminPasswordHash();
  if (!configuredHash) {
    return false;
  }

  return bcrypt.compare(password, configuredHash);
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies[sessionCookieName]) {
    return normalizeString(cookies[sessionCookieName]);
  }

  return normalizeString(req.headers['x-admin-session']);
}

function requireAdminToken(req, res, next) {
  const configuredHash = getCurrentAdminPasswordHash();

  if (!configuredHash) {
    return res.status(503).json({ error: 'Admin auth is not configured on server' });
  }

  const providedSessionToken = getSessionToken(req);
  if (providedSessionToken) {
    const session = adminSessions.get(providedSessionToken);
    if (
      session &&
      session.expiresAt > Date.now() &&
      session.ip === getClientIp(req) &&
      session.userAgentHash === hashUserAgent(req.headers['user-agent'])
    ) {
      req.adminSession = session;
      req.adminSessionToken = providedSessionToken;
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

function requireCsrfToken(req, res, next) {
  const method = normalizeString(req.method).toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const csrfHeader = normalizeString(req.headers['x-csrf-token']);
  if (!csrfHeader || !req.adminSession || csrfHeader !== req.adminSession.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
}

function createAdminSession(req) {
  const token = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const ttlMs = Number(process.env.ADMIN_SESSION_TTL_MS || 1000 * 60 * 60 * 8);
  adminSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(ttlMs, 60 * 1000),
    csrfToken,
    ip: getClientIp(req),
    userAgentHash: hashUserAgent(req.headers['user-agent'])
  });
  return {
    token,
    csrfToken,
    ttlMs: Math.max(ttlMs, 60 * 1000)
  };
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }

  for (const [ip, state] of loginAttempts.entries()) {
    if (!state || (state.windowExpiresAt <= now && state.lockUntil <= now)) {
      loginAttempts.delete(ip);
    }
  }
}

setInterval(cleanupExpiredSessions, 10 * 60 * 1000).unref();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/api/v1/admin/login', (req, res) => {
  const configuredHash = getCurrentAdminPasswordHash();
  const clientIp = getClientIp(req);
  const loginState = getLoginState(clientIp);

  if (loginState.lockUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((loginState.lockUntil - Date.now()) / 1000);
    res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  if (!configuredHash) {
    return res.status(503).json({ error: 'Admin password hash is not configured on server' });
  }

  const password = normalizeString(req.body?.password);
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  verifyAdminPassword(password)
    .then((isValid) => {
      if (!isValid) {
        const state = recordFailedLogin(clientIp);
        const remainingAttempts = Math.max(loginMaxAttempts - state.attempts, 0);
        return res.status(401).json({ error: `Invalid credentials. Attempts remaining: ${remainingAttempts}` });
      }

      clearFailedLogin(clientIp);
      const session = createAdminSession(req);
      setSessionCookie(req, res, session.token, session.ttlMs);
      return res.status(200).json({
        sessionToken: session.token,
        csrfToken: session.csrfToken,
        expiresInMs: session.ttlMs
      });
    })
    .catch((error) => {
      console.error('Failed to verify admin password:', error);
      return res.status(500).json({ error: 'Unable to process login request' });
    });
});

app.get('/api/v1/admin/session', requireAdminToken, (req, res) => {
  return res.status(200).json({
    authenticated: true,
    csrfToken: req.adminSession.csrfToken,
    expiresAt: req.adminSession.expiresAt
  });
});

app.post('/api/v1/admin/logout', requireAdminToken, requireCsrfToken, (req, res) => {
  const providedSessionToken = getSessionToken(req);
  if (providedSessionToken) {
    adminSessions.delete(providedSessionToken);
  }
  clearSessionCookie(req, res);
  res.status(200).json({ message: 'logged out' });
});

app.put('/api/v1/admin/password', requireAdminToken, requireCsrfToken, async (req, res) => {
  const currentPassword = normalizeString(req.body?.currentPassword);
  const newPassword = normalizeString(req.body?.newPassword);

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters long' });
  }

  const matches = await verifyAdminPassword(currentPassword);
  if (!matches) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  try {
    const nextHash = await bcrypt.hash(newPassword, 10);
    await setAdminPasswordHash(nextHash);
    setCurrentAdminPasswordHash(nextHash);
    adminSessions.clear();

    const session = createAdminSession(req);
    setSessionCookie(req, res, session.token, session.ttlMs);

    return res.status(200).json({
      message: 'Admin password updated',
      csrfToken: session.csrfToken,
      expiresInMs: session.ttlMs
    });
  } catch (error) {
    console.error('Failed to update admin password:', error);
    return res.status(500).json({ error: 'Failed to update admin password' });
  }
});

app.get('/api/v1/public-state', async (_req, res) => {
  try {
    const [{ moduleRegistry, moduleAvailability }, siteLock] = await Promise.all([
      resolveModuleState(),
      getSiteLock(defaultSiteLock)
    ]);

    res.status(200).json({
      modules: moduleRegistry,
      moduleAvailability,
      siteLock
    });
  } catch (error) {
    console.error('Failed to fetch public state:', error);
    res.status(500).json({ error: 'Failed to fetch public state' });
  }
});

app.get('/api/v1/admin/settings', requireAdminToken, async (_req, res) => {
  try {
    const [{ moduleRegistry, moduleAvailability }, siteLock] = await Promise.all([
      resolveModuleState(),
      getSiteLock(defaultSiteLock)
    ]);

    res.status(200).json({
      modules: moduleRegistry,
      moduleAvailability,
      siteLock
    });
  } catch (error) {
    console.error('Failed to fetch admin settings:', error);
    res.status(500).json({ error: 'Failed to fetch admin settings' });
  }
});

app.put('/api/v1/admin/settings/module/:moduleId', requireAdminToken, requireCsrfToken, async (req, res) => {
  const moduleId = normalizeModuleId(req.params.moduleId);

  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' });
  }

  try {
    const { moduleRegistry, moduleAvailability } = await resolveModuleState();
    const knownModuleIds = new Set(moduleRegistry.map((module) => module.id));
    if (!knownModuleIds.has(moduleId)) {
      return res.status(400).json({ error: 'Unknown module id' });
    }

    const next = { ...moduleAvailability, [moduleId]: enabled };
    const saved = await setModuleAvailability(next);
    res.status(200).json({ moduleAvailability: saved });
  } catch (error) {
    console.error('Failed to update module availability:', error);
    res.status(500).json({ error: 'Failed to update module availability' });
  }
});

app.post('/api/v1/admin/modules', requireAdminToken, requireCsrfToken, async (req, res) => {
  const normalizedModule = normalizeModuleRecord(req.body);
  if (!normalizedModule) {
    return res.status(400).json({ error: 'id, title, and entryPath are required' });
  }

  if (!normalizedModule.entryPath.toLowerCase().endsWith('.html')) {
    return res.status(400).json({ error: 'entryPath must point to an .html file' });
  }

  const resolvedEntryPath = path.resolve(appRoot, normalizedModule.entryPath);
  const normalizedAppRoot = `${path.resolve(appRoot)}${path.sep}`;
  if (!resolvedEntryPath.startsWith(normalizedAppRoot)) {
    return res.status(400).json({ error: 'entryPath must be inside the training workspace' });
  }

  if (!fs.existsSync(resolvedEntryPath)) {
    return res.status(400).json({ error: 'entryPath does not exist in the workspace' });
  }

  try {
    const { moduleRegistry, moduleAvailability } = await resolveModuleState();
    if (moduleRegistry.some((module) => module.id === normalizedModule.id)) {
      return res.status(409).json({ error: 'A module with this id already exists' });
    }

    const nextRegistry = [
      ...moduleRegistry.map(toStoredModuleRecord),
      normalizedModule
    ];
    const nextAvailability = {
      ...moduleAvailability,
      [normalizedModule.id]: true
    };

    await Promise.all([
      setModuleRegistry(nextRegistry),
      setModuleAvailability(nextAvailability)
    ]);

    return res.status(201).json({
      module: getModuleMetadata(normalizedModule),
      modules: nextRegistry.map((module) => getModuleMetadata(module)),
      moduleAvailability: nextAvailability
    });
  } catch (error) {
    console.error('Failed to register module:', error);
    return res.status(500).json({ error: 'Failed to register module' });
  }
});

app.post('/api/v1/admin/modules/upload', requireAdminToken, requireCsrfToken, async (req, res) => {
  const title = normalizeString(req.body?.title);
  const icon = normalizeModuleIcon(req.body?.icon);
  const originalFileName = normalizeString(req.body?.fileName);
  const htmlContent = String(req.body?.htmlContent || '');

  if (!title || !originalFileName || !htmlContent) {
    return res.status(400).json({ error: 'title, fileName, and htmlContent are required' });
  }

  if (!originalFileName.toLowerCase().endsWith('.html')) {
    return res.status(400).json({ error: 'Only .html files are supported' });
  }

  const baseId = slugifyModuleId(title);
  if (!baseId) {
    return res.status(400).json({ error: 'Unable to derive a valid module id from the title' });
  }

  try {
    const { moduleRegistry, moduleAvailability } = await resolveModuleState();
    const existingIds = new Set(moduleRegistry.map((module) => module.id));
    const moduleId = createUniqueModuleId(baseId, existingIds);
    const moduleFolderRelative = path.join('uploaded-modules', moduleId);
    const moduleFolderAbsolute = path.join(appRoot, moduleFolderRelative);
    const entryPath = path.join(moduleFolderRelative, 'module.html').replace(/\\/g, '/');

    fs.mkdirSync(moduleFolderAbsolute, { recursive: true });
    const preparedHtml = injectPortalTrackingBridge(htmlContent, moduleId);
    fs.writeFileSync(path.join(moduleFolderAbsolute, 'module.html'), preparedHtml, 'utf8');

    const normalizedModule = normalizeModuleRecord({
      id: moduleId,
      title,
      entryPath,
      icon
    });

    const nextRegistry = [...moduleRegistry.map(toStoredModuleRecord), normalizedModule];
    const nextAvailability = {
      ...moduleAvailability,
      [normalizedModule.id]: true
    };

    await Promise.all([
      setModuleRegistry(nextRegistry),
      setModuleAvailability(nextAvailability)
    ]);

    return res.status(201).json({
      module: getModuleMetadata(normalizedModule),
      modules: nextRegistry.map((module) => getModuleMetadata(module)),
      moduleAvailability: nextAvailability
    });
  } catch (error) {
    console.error('Failed to upload module:', error);
    return res.status(500).json({ error: 'Failed to upload module' });
  }
});

app.delete('/api/v1/admin/modules/:moduleId', requireAdminToken, requireCsrfToken, async (req, res) => {
  const moduleId = normalizeModuleId(req.params.moduleId);
  if (!moduleId) {
    return res.status(400).json({ error: 'Invalid module id' });
  }

  try {
    const { moduleRegistry, moduleAvailability } = await resolveModuleState();
    const moduleToDelete = moduleRegistry.find((module) => module.id === moduleId);
    if (!moduleToDelete) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const nextRegistry = moduleRegistry
      .filter((module) => module.id !== moduleId)
      .map(toStoredModuleRecord);

    const nextAvailability = { ...moduleAvailability };
    delete nextAvailability[moduleId];

    const uploadedModulesRoot = path.join(appRoot, 'uploaded-modules');
    const moduleEntryAbsolute = path.resolve(appRoot, moduleToDelete.entryPath);
    const moduleFolderAbsolute = path.dirname(moduleEntryAbsolute);
    const shouldDeleteFiles =
      isPathInside(uploadedModulesRoot, moduleEntryAbsolute) &&
      path.basename(moduleEntryAbsolute).toLowerCase() === 'module.html';

    if (shouldDeleteFiles && fs.existsSync(moduleFolderAbsolute)) {
      fs.rmSync(moduleFolderAbsolute, { recursive: true, force: true });
    }

    await Promise.all([
      setModuleRegistry(nextRegistry),
      setModuleAvailability(nextAvailability)
    ]);

    return res.status(200).json({
      deletedModuleId: moduleId,
      modules: nextRegistry.map((module) => getModuleMetadata(module)),
      moduleAvailability: nextAvailability
    });
  } catch (error) {
    console.error('Failed to delete module:', error);
    return res.status(500).json({ error: 'Failed to delete module' });
  }
});

app.put('/api/v1/admin/settings/site-lock', requireAdminToken, requireCsrfToken, async (req, res) => {
  const locked = req.body?.locked;
  const reason = normalizeString(req.body?.reason) || defaultSiteLock.reason;

  if (typeof locked !== 'boolean') {
    return res.status(400).json({ error: 'locked must be true or false' });
  }

  try {
    const saved = await setSiteLock({ locked, reason });
    res.status(200).json({ siteLock: saved });
  } catch (error) {
    console.error('Failed to update site lock:', error);
    res.status(500).json({ error: 'Failed to update site lock' });
  }
});

app.post('/api/v1/employee-details', async (req, res) => {
  const name = normalizeString(req.body?.name);
  const department = normalizeString(req.body?.department);
  const email = normalizeString(req.body?.email).toLowerCase();
  const ipAddress = getClientIp(req);

  if (!name || !department || !email) {
    res.status(400).json({ error: 'name, department, and email are required' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'email is invalid' });
    return;
  }

  try {
    const insertResult = await saveEmployeeSubmission({
      name,
      department,
      email,
      ipAddress
    });

    res.status(201).json({
      message: 'saved',
      timestamp: insertResult.timestamp
    });
  } catch (error) {
    console.error('Failed to save employee details:', error);
    res.status(500).json({ error: 'Failed to save employee details' });
  }
});

app.get('/api/v1/employee-details', requireAdminToken, async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 50, 1), 500);

  try {
    const listResult = await listEmployeeSubmissions({ page, pageSize });

    res.status(200).json({
      page,
      pageSize,
      total: listResult.total,
      items: listResult.items
    });
  } catch (error) {
    console.error('Failed to list employee details:', error);
    res.status(500).json({ error: 'Failed to fetch employee details' });
  }
});

app.delete('/api/v1/admin/employee-details', requireAdminToken, requireCsrfToken, async (req, res) => {
  const password = normalizeString(req.body?.password);

  if (!password) {
    return res.status(400).json({ error: 'Admin password is required' });
  }

  const configuredHash = getCurrentAdminPasswordHash();

  if (!configuredHash) {
    return res.status(503).json({ error: 'Admin password hash is not configured on server' });
  }

  const passwordMatches = await verifyAdminPassword(password);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  try {
    const result = await clearEmployeeSubmissions();
    res.status(200).json({
      message: 'Employee records cleared successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Failed to clear employee details:', error);
    res.status(500).json({ error: 'Failed to clear employee details' });
  }
});

ensureSchema()
  .then(async () => {
    const storedHash = await getAdminPasswordHash(adminPasswordHash);
    setCurrentAdminPasswordHash(storedHash || adminPasswordHash);

    app.listen(port, () => {
      console.log(`Employee capture API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database schema:', error);
    process.exit(1);
  });
