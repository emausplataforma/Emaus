"use strict";
/* ============================================================
   BoraAgendar — servidor (MVP, sem dependências externas)
   Roda com:  node server.js
   Dados ficam em ./data (JSON) — depois pode migrar p/ PostgreSQL
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
/* DATA_DIR permite apontar os dados para um volume persistente (Railway/Render/Fly/Oracle)
   Ex.: DATA_DIR=/data  (volume montado) — sem isso, os dados ficam em ./data */
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SALONS_DIR = path.join(DATA, 'salons');
const SVC_VIDEOS_DIR = path.join(DATA, 'svc-videos');
const PUBLIC_URL = String(
  process.env.PUBLIC_URL ||
  process.env.URL_PUBLICA ||
  process.env['URL_PÚBLICA'] ||
  'https://glow-platform-production.up.railway.app'
).replace(/\/+$/, '');
/* Instância Zapster oficial da plataforma (Bora Agendar · +55 21 99292-7535).
   Todas as respostas e automações saem daqui. */
const PLATFORM_ZAPSTER_INSTANCE = 'szv9lygxoy3axjp07zx4e';
fs.mkdirSync(SALONS_DIR, { recursive: true });
/* aliases init after db load below */

/* ---------------- cabeçalhos de segurança ---------------- */
const CSP_HTML = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-src 'self' https://www.youtube.com https://www.instagram.com https://instagram.com https://*.cdninstagram.com https://www.tiktok.com https://vm.tiktok.com https://open.spotify.com"
].join('; ');
function securityHeaders(req) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  };
  if (process.env.CSP !== 'off') h['Content-Security-Policy'] = CSP_HTML;
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim();
  if (proto === 'https') h['Strict-Transport-Security'] = 'max-age=15552000';
  return h;
}

/* ---------------- helpers ---------------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const uid = () => crypto.randomBytes(6).toString('hex');
/* Arquivos de interface que podem ser servidos. O resto da raiz (código, dados,
   README, package.json) nunca sai por HTTP. */
const PUBLIC_FILES = new Set(['index.html', 'salon-app.html', 'admin.html', 'trial.html', 'guia.html',
  'guia-video.html', 'guia-whatsapp.html', 'conectar.html', 'captura.html', 'termos.html',
  'privacidade.html', 'politica-de-privacidade.html', 'nicho.html', 'sw.js', 'qrcode.min.js', 'manifest.webmanifest',
  'favicon.ico', 'apple-touch-icon.png', 'logo.png', 'icon-192.png', 'icon-512.png', 'logo.svg', 'robots.txt']);
const PUBLIC_DIRS = ['icons/', 'static/', 'tutorial/', 'img/', 'imagens/', 'assets/'];
const PUBLIC_IMG_EXT = /\.(png|jpe?g|webp|svg|ico|gif)$/i;
function isPublicAsset(rel) {
  const r = String(rel || '').replace(/^\/+/, '');
  if (!r || r.indexOf('..') > -1) return false;
  if (PUBLIC_DIRS.some(d => r.indexOf(d) === 0)) return true;
  if (PUBLIC_FILES.has(r)) return true;
  /* imagem solta na raiz é asset público (logo.png, favicon-32.png…); código,
     dados e config (.js/.json/.md/.txt) continuam bloqueados. */
  if (r.indexOf('/') === -1 && PUBLIC_IMG_EXT.test(r)) return true;
  return false;
}
/* Senha: scrypt com salt por usuário (sem dependência externa). Aceita o hash
   antigo (sha-256 puro) e melhora sozinha no primeiro login bem-sucedido. */
const PW_MIN = 6;
const PWH = 'scr$';
function hashPw(pw) {
  const salt = crypto.randomBytes(12).toString('hex');
  const h = crypto.scryptSync(String(pw || ''), salt, 32).toString('hex');
  return PWH + salt + '$' + h;
}
function isModernHash(stored) { return String(stored || '').indexOf(PWH) === 0; }
function checkPw(pw, stored) {
  const s = String(stored || '');
  if (!s) return false;
  if (s.indexOf(PWH) === 0) {
    const parts = s.split('$');
    if (parts.length !== 3) return false;
    const cur = crypto.scryptSync(String(pw || ''), parts[1], 32).toString('hex');
    try { return crypto.timingSafeEqual(Buffer.from(parts[2], 'hex'), Buffer.from(cur, 'hex')); } catch (e) { return false; }
  }
  return s === sha(pw); /* legado */
}
function sessionToken() { return crypto.randomBytes(18).toString('hex'); }
/* Limite simples por IP: sem dependência, morre quando o processo reinicia. */
const rlBuckets = new Map();
function clientIp(req) {
  const xf = String((req.headers && (req.headers['x-forwarded-for'] || '')) || '').split(',')[0].trim();
  return xf || String((req.socket && req.socket.remoteAddress) || 'local');
}
function tooMany(req, key, limit, windowMs) {
  const ip = clientIp(req);
  const k = key + '|' + ip;
  const now = Date.now();
  let b = rlBuckets.get(k);
  if (!b || now - b.t0 > windowMs) { b = { t0: now, n: 0 }; rlBuckets.set(k, b); }
  b.n++;
  if (rlBuckets.size > 4000) { for (const [kk, vv] of rlBuckets) if (now - vv.t0 > windowMs) rlBuckets.delete(kk); }
  return b.n > limit;
}
/* Imagens: o payload público entrega uma URL, não o base64 dentro do JSON. */
const IMG_REF_RE = /^\/api\/public\/[a-z0-9-]+\/(img|logo)\//;
function isImgRef(v) { return IMG_REF_RE.test(v) || String(v || '').indexOf('/media/') === 0; }
function imgRef(kind, slug, id) { return '/api/public/' + slug + '/img/' + kind + '/' + encodeURIComponent(String(id || '')); }
/* O payload público recebe a URL (com carimbo para o navegador poder cachear),
   nunca o base64 — hoje isso pesa 1,2 MB a 1,8 MB na tela da cliente. */
function photoRef(v, ref) {
  if (typeof v === 'string' && v.indexOf('data:image/') === 0) {
    /* cicatriz do bug antigo: base64 cortado em exatamente 900k = imagem
       corrompida. Trata como sem foto (emoji) até a dona reenviar. */
    if (v.length === 900000) return null;
    return ref + '?v=' + sha(v).slice(0, 10);
  }
  return v || null;
}
/* Guarda: se a tela devolver a URL que geramos, a imagem guardada continua lá. */
function keepStoredPhoto(incoming, stored) {
  /* campo ausente na requisição = a dona não mexeu na foto → mantém a guardada.
     null / '' explícito = ela removeu a foto → limpa. */
  if (incoming === undefined) return stored === undefined ? null : stored;
  const v = String(incoming === null ? '' : incoming).trim();
  if (!v) return null;
  if (v.indexOf('data:image/') === 0) {
    /* nunca cortar base64 no meio: foto truncada = imagem quebrada que a
       dona salva e não aparece. Grande demais: mantém a foto anterior. */
    if (v.length <= 1900000) return v;
    return stored === undefined ? null : stored;
  }
  if (isImgRef(v)) return stored || v;
  return v.slice(0, 400);
}
function photoBuffer(v) {
  const mm = String(v || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!mm) return null;
  try { return { type: mm[1], buf: Buffer.from(mm[2], 'base64') }; } catch (e) { return null; }
}
/* Mercado Pago: nunca aceitar aviso de fora — conferir o pagamento na API. */
const MP_API = String(process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/+$/, '');
function mpToken() { return String((db.gateway && db.gateway.mercadopagoToken) || '').trim(); }
function mpFetchPayment(id) {
  const tok = mpToken();
  if (!tok || !id) return Promise.resolve(null);
  return fetch(MP_API + '/v1/payments/' + encodeURIComponent(id), { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
}
function mpAmountOk(pay, expected) {
  const got = Number((pay && (pay.transaction_amount_received || pay.transaction_amount || pay.captured_amount)) || 0);
  const want = Number(expected || 0);
  if (!want) return true;
  return got + 0.01 >= want;
}
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => fmtDate(new Date());
function brazilTodayStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) { return todayStr(); }
}
function brazilNowMin() {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const num = tp => parseInt((parts.find(x => x.type === tp) || {}).value, 10) || 0;
    let h = num('hour');
    if (h === 24) h = 0;
    return h * 60 + num('minute');
  } catch (e) {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}
function apptHourKey(a) {
  const raw = String((a && a.time) || '').trim();
  const hm = raw.match(/^(\d{1,2}):(\d{2})/);
  if (hm) {
    const h = Number(hm[1]);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return pad(h);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || /Z$/.test(raw) || raw.includes('T')) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      try {
        let h = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(d), 10);
        if (h === 24) h = 0;
        if (Number.isFinite(h) && h >= 0 && h <= 23) return pad(h);
      } catch (e) {}
    }
  }
  return null;
}
function bumpApptHour(byHour, a) {
  const h = apptHourKey(a);
  if (h) byHour[h] = (byHour[h] || 0) + 1;
}
function hourListFrom(byHour, valKey) {
  valKey = valKey || 'value';
  return Object.keys(byHour).sort((a, b) => Number(a) - Number(b)).map(h => {
    const row = { hour: h + 'h' };
    row[valKey] = byHour[h];
    return row;
  });
}
function peakHourKey(byHour) {
  let best = null, bestN = -1;
  Object.keys(byHour).forEach(h => {
    const n = byHour[h] || 0;
    const hn = Number(h);
    if (n > bestN || (n === bestN && hn > Number(best))) { best = h; bestN = n; }
  });
  return best;
}
function weekStartStr(ds) {
  const d = new Date(String(ds || brazilTodayStr()).slice(0, 10) + 'T12:00:00');
  const back = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - back);
  return fmtDate(d);
}
function monthKeyAdd(mk, n) {
  const p = String(mk || '').split('-');
  const d = new Date(Number(p[0]) || 2026, (Number(p[1]) || 1) - 1 + n, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function monthLabelBR(mk) {
  const p = String(mk || '').split('-');
  const y = Number(p[0]), m = Number(p[1]);
  if (!y || !m || m < 1 || m > 12) return String(mk || '');
  return MONTHS_PT[m - 1] + ' de ' + y;
}
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
const isSunday = ds => new Date(ds + 'T12:00:00').getDay() === 0;
const toMin = t => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); };
const fmtTime = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const fmtBRL = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const slugify = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('salon-' + uid());
const CATS = [
  { id: 'unhas', label: 'Unhas', emoji: '💅' },
  { id: 'cabelo', label: 'Cabelo', emoji: '💇‍♀️' },
  { id: 'sobrancelha', label: 'Sobrancelhas', emoji: '✨' },
  { id: 'maquiagem', label: 'Maquiagem', emoji: '💄' },
  { id: 'estetica', label: 'Estética', emoji: '🧖‍♀️' },
  { id: 'barbearia', label: 'Barbearia', emoji: '💈' },
  { id: 'tattoo', label: 'Tattoo & Piercing', emoji: '🖋️' },
  { id: 'odonto', label: 'Odontologia', emoji: '🦷' },
  { id: 'petshop', label: 'Pet Shop', emoji: '🐾' }
];
const PLAN_PRICES = { 'Básico': 69, 'Pro': 139, 'Premium': 249 };
/* Preços dos planos podem ser sobrescritos pelo painel admin (db.gateway.planPrices).
   Sempre fallback para PLAN_PRICES caso a configuração não exista. */
function planPrice(plan){
  const p = PLAN_PRICES[plan];
  const gp = (db && db.gateway && db.gateway.planPrices && typeof db.gateway.planPrices === 'object') ? db.gateway.planPrices : {};
  const key = String(plan || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const raw = gp[key] !== undefined ? gp[key] : gp[plan] !== undefined ? gp[plan] : null;
  return (raw !== null && Number.isFinite(Number(raw)) && Number(raw) > 0) ? Math.round(Number(raw)) : p;
}
function cleanPlanPrices(v){
  const r = v && typeof v === 'object' ? v : {};
  const num = (x, def) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n) : def; };
  return { basico: num(r.basico||r.Básico, PLAN_PRICES['Básico']), pro: num(r.pro||r.Pro, PLAN_PRICES['Pro']), premium: num(r.premium||r.Premium, PLAN_PRICES['Premium']) };
}
function planPricesMap(){
  const c = cleanPlanPrices(db && db.gateway && db.gateway.planPrices);
  /* tabela antiga da divulgação (79/149/299) → valores atuais */
  if (Number(c.basico) === 79 && Number(c.pro) === 149 && Number(c.premium) === 299) {
    return { basico: PLAN_PRICES['Básico'], pro: PLAN_PRICES['Pro'], premium: PLAN_PRICES['Premium'] };
  }
  return { basico: c.basico, pro: c.pro, premium: c.premium };
}
/* Dias do teste grátis: fonte da verdade é o campo do painel admin.
   As páginas usam o token %TRIALDIAS% e o servidor troca na entrega. */
function trialDaysNow(){ const d = Number(db && db.gateway && db.gateway.trialDays); return (d>=1&&d<=90) ? d : 15; }
function applyPlanPricesToHtml(html) {
  if (!html || typeof html !== 'string') return html;
  const pp = planPricesMap();
  html = html.replace(/(<span class="name">BÁSICO<\/span>\s*<div class="price"[^>]*>)R\$\s*\d+/i, '$1R$ ' + pp.basico);
  html = html.replace(/(<span class="name">PRO<\/span>\s*<div class="price"[^>]*>)R\$\s*\d+/i, '$1R$ ' + pp.pro);
  html = html.replace(/(<span class="name">PREMIUM<\/span>\s*<div class="price"[^>]*>)R\$\s*\d+/i, '$1R$ ' + pp.premium);
  html = html.replace(/R\$\s*\d+\/mês \(Pro\)/g, 'R$ ' + pp.pro + '/mês (Pro)');
  html = html.replace(/Básico R\$\s*\d+/g, 'Básico R$ ' + pp.basico);
  html = html.replace(/Pro R\$\s*\d+/g, 'Pro R$ ' + pp.pro);
  html = html.replace(/Premium R\$\s*\d+/g, 'Premium R$ ' + pp.premium);
  html = html.replace(/Básico — R\$ \d+\/mês/g, 'Básico — R$ ' + pp.basico + '/mês');
  html = html.replace(/Pro — R\$ \d+\/mês/g, 'Pro — R$ ' + pp.pro + '/mês');
  html = html.replace(/Premium — R\$ \d+\/mês/g, 'Premium — R$ ' + pp.premium + '/mês');
  html = html.replace(/Planos:\s*Básico R\$\s*\d+\s*·\s*Pro R\$\s*\d+\s*·\s*Premium R\$\s*\d+/g,
    'Planos: Básico R$ ' + pp.basico + ' · Pro R$ ' + pp.pro + ' · Premium R$ ' + pp.premium);
  html = html.replace(/Planos\s+\d+\s*\/\s*\d+\s*\/\s*\d+/g,
    'Planos ' + pp.basico + ' / ' + pp.pro + ' / ' + pp.premium);
  return html;
}
const THEME_FONTS = ['padrao', 'elegante', 'moderna', 'classica', 'impacto', 'retro'];
const THEME_DEFAULT = { primary: '#D63A6B', bg: '#FBF4F6', font: 'padrao' };
function cleanTheme(th) {
  const t = th && typeof th === 'object' ? th : {};
  const hex = v => /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : null;
  return {
    primary: hex(t.primary) || THEME_DEFAULT.primary,
    bg: hex(t.bg) || THEME_DEFAULT.bg,
    font: THEME_FONTS.includes(t.font) ? t.font : 'padrao'
  };
}
function cleanCustomCategories(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(raw => {
    if (!raw || typeof raw !== 'object') return;
    let id = String(raw.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id) id = 'cat-' + uid();
    if (seen.has(id)) return;
    seen.add(id);
    const label = clipText(raw.label || raw.name || id, 40);
    if (!label) return;
    const emoji = String(raw.emoji || '✨').slice(0, 8);
    const photo = raw.photo && String(raw.photo).startsWith('data:image') && String(raw.photo).length <= 1900000 ? String(raw.photo) : null;
    out.push({ id, label, emoji, photo });
  });
  return out.slice(0, 40);
}
function cleanExpenses(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 500).map(raw => {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || ('e' + Date.now() + uid())).slice(0, 40);
    const date = String(raw.date || todayStr()).slice(0, 10);
    const desc = clipText(raw.desc || raw.description || 'Gasto', 120);
    const category = clipText(raw.category || 'Geral', 40);
    const amount = Math.max(0, Math.round((+raw.amount || 0) * 100) / 100);
    return { id, date, desc, category, amount, createdAt: raw.createdAt || Date.now() };
  }).filter(Boolean);
}
function mergeCats(salon) {
  const custom = cleanCustomCategories(salon && salon.cfg && salon.cfg.customCategories);
  const map = {};
  CATS.forEach(c => { map[c.id] = { id: c.id, label: c.label, emoji: c.emoji, photo: null, builtin: true }; });
  custom.forEach(c => { map[c.id] = { id: c.id, label: c.label, emoji: c.emoji, photo: c.photo || null, builtin: false }; });
  return Object.values(map);
}

const BOT_NICHES = ['salao', 'barbearia', 'unhas', 'estetica', 'maquiagem', 'tattoo', 'sobrancelha', 'odonto', 'petshop', 'personal', 'fisio', 'nutri', 'pilates', 'autoest', 'depilacao', 'psico', 'clinica'];
const BOT_TONES = ['auto', 'feminino', 'masculino', 'neutro'];
function cleanNiche(value) {
  const raw = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const aliases = { beleza: 'salao', beleza_salao: 'salao', barber: 'barbearia', barbershop: 'barbearia', manicure: 'unhas', nail: 'unhas', nails: 'unhas', estetica_facial: 'estetica', odontologia: 'odonto', tatuagem: 'tattoo', tattoo_studio: 'tattoo', pet: 'petshop' };
  const niche = aliases[raw] || raw;
  return BOT_NICHES.includes(niche) ? niche : 'salao';
}
function cleanBotTone(value) { return BOT_TONES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'auto'; }
function cleanRebook(value) {
  const r = value && typeof value === 'object' ? value : {};
  const enabled = r.enabled === undefined ? true : !!r.enabled;
  const autoWhats = r.autoWhats === undefined ? true : !!r.autoWhats;
  return { enabled: enabled, days: Math.max(1, Math.min(365, parseInt(r.days, 10) || 23)), autoWhats: autoWhats };
}
function serviceRebookDays(salon, serviceId) {
  const def = cleanRebook(salon && salon.cfg && salon.cfg.rebook).days;
  const svc = ((salon && salon.services) || []).find(x => x && x.id === serviceId);
  const n = parseInt(svc && svc.rebookDays, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 365) return n;
  return def;
}
/* Personalidade do bot: como ele fala (tom, formalidade, emoji), como apresenta os
   valores (preços) e se ele se adapta ao perfil de cada cliente. Híbrido: as regras
   cobrem menu/agenda/horário; a IA (opcional) responde perguntas abertas. */
const BOT_FORMALITY = ['auto', 'informal', 'formal'];
const BOT_EMOJI = ['auto', 'com', 'sem'];
const BOT_PRICE = ['resumida', 'detalhada', 'nao'];
function cleanBotConfig(value, allowAI = true) {
  const b = value && typeof value === 'object' ? value : {};
  const ai = b.ai && typeof b.ai === 'object' ? b.ai : {};
  // allowAI = false → o salão não pode definir o motor de IA (só a administração).
  return {
    tone: cleanBotTone(b.tone),
    formality: BOT_FORMALITY.includes(b.formality) ? b.formality : 'auto',
    emoji: BOT_EMOJI.includes(b.emoji) ? b.emoji : 'auto',
    greeting: clipText(b.greeting, 120),
    priceStyle: BOT_PRICE.includes(b.priceStyle) ? b.priceStyle : 'resumida',
    perClient: !!b.perClient,
    aiEnabled: allowAI ? !!b.aiEnabled : false,
    ai: {
      baseUrl: allowAI ? clipText(ai.baseUrl, 200) : '',
      model: allowAI ? clipText(ai.model, 80) : '',
      token: allowAI ? clipText(ai.token, 200) : '',
      temperature: Math.max(0, Math.min(1.5, Number(ai.temperature) || 0.6))
    }
  };
}
/* Tom de comunicação "auto" segue o nicho; os outros campos têm padrão neutro. */
function cleanBotConfigDefaults() {
  return { tone: 'auto', formality: 'auto', emoji: 'auto', greeting: '', priceStyle: 'resumida', perClient: false, aiEnabled: false, ai: { baseUrl: '', model: '', token: '', temperature: 0.6 } };
}
const clipText = (value, max) => String(value || '').trim().slice(0, max);
/* Moldura escolhida pela dona para o vídeo do serviço (o arquivo não é cortado:
   o enquadramento é aplicado na tela). r = proporção, z = zoom, x/y = foco. */
const FRAME_RATIOS = { '1:1': 1, '3:4': 3/4, '4:5': 4/5, '4:3': 4/3, '9:16': 9/16, '16:9': 16/9, 'free': 0 };
function cleanFrame(f) {
  if (!f || typeof f !== 'object') return null;
  const r = FRAME_RATIOS[String(f.r || '')] !== undefined ? String(f.r) : '';
  if (!r) return null;
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const out = { r: r, z: num(f.z, 1, 1, 3), x: num(f.x, 50, 0, 100), y: num(f.y, 50, 0, 100), fit: f.fit === 'contain' ? 'contain' : 'cover' };
  if (r === 'free' && out.z === 1 && out.fit === 'cover' && out.x === 50 && out.y === 50) return null;
  return out;
}
/* style inline para o HTML usar a moldura sem depender de CSS extra */
function frameStyle(f) {
  if (!f) return '';
  const ratio = f.r === 'free' ? '' : ('aspect-ratio:' + f.r.replace(':', '/') + ';');
  return ratio + 'overflow:hidden;object-fit:' + (f.fit || 'cover') + ';object-position:' + f.x + '% ' + f.y + '%;transform:scale(' + f.z + ')';
}
function cleanServiceVideo(v) {
  v = String(v || '').trim();
  if (!v) return '';
  v = v.replace(/^http:\/\//i, 'https://');
  if (/^www\./i.test(v) || /^(instagram|youtube|youtu\.be|tiktok)\./i.test(v)) v = 'https://' + v;
  if (!/^https:\/\//i.test(v)) return '';
  v = v.split('\n')[0].trim().slice(0, 400);
  if (/[\s<>"']/.test(v)) return '';
  return v;
}
function safeVideoKey(x) {
  return String(x || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}
function svcVideoPath(slug, id) {
  return path.join(SVC_VIDEOS_DIR, safeVideoKey(slug) + '-' + safeVideoKey(id) + '.mp4');
}
function writeSvcVideoFile(slug, id, dataUrl) {
  const m = String(dataUrl || '').match(/^data:(?:video\/[a-zA-Z0-9.+-]+|application\/octet-stream);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return '';
  const buf = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
  if (!buf.length || buf.length > 28e6) return '';
  fs.mkdirSync(SVC_VIDEOS_DIR, { recursive: true });
  const dest = svcVideoPath(slug, id);
  fs.writeFileSync(dest, buf);
  return '/media/svc-video/' + safeVideoKey(slug) + '/' + safeVideoKey(id);
}
function removeSvcVideoFile(slug, id) {
  try { fs.unlinkSync(svcVideoPath(slug, id)); } catch (e) {}
}
function adminProfile() {
  const a = (db && db.admin) || {};
  const name = clipText(a.name, 40) || 'Admin';
  const emoji = String(a.emoji || '💎').trim().slice(0, 8) || '💎';
  return { name, emoji };
}
const digitsOnly = s => String(s || '').replace(/\D/g, '');
function phoneDigits(s) {
  let d = digitsOnly(s);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  return d.slice(-11);
}
const digitsCpf = s => digitsOnly(s).slice(0, 11);
function isValidCpf(cpf) {
  const d = digitsCpf(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (+d[i]) * (10 - i);
  let r = (sum * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== +d[9]) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += (+d[i]) * (11 - i);
  r = (sum * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === +d[10];
}
function cleanBirthdate(v) {
  const raw = String(v || '').trim();
  let y, mo, d;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return '';
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  const iso = y + '-' + pad(mo) + '-' + pad(d);
  const today = brazilTodayStr();
  const minY = (+today.slice(0, 4)) - 100;
  if (y < minY || iso > today) return '';
  return iso;
}
function isBirthdayToday(birthdate, today) {
  const bd = cleanBirthdate(birthdate);
  const t = String(today || brazilTodayStr()).slice(0, 10);
  if (!bd || t.length < 10) return false;
  const bMM = bd.slice(5, 7), bDD = bd.slice(8, 10);
  const tMM = t.slice(5, 7), tDD = t.slice(8, 10);
  if (bMM === tMM && bDD === tDD) return true;
  /* 29/02 em ano não bissexto: parabeniza em 28/02 */
  if (bMM === '02' && bDD === '29' && tMM === '02' && tDD === '28') {
    const y = +t.slice(0, 4);
    const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    return !leap;
  }
  return false;
}
function findClientBirthdate(s, cpf, name) {
  const id = digitsCpf(cpf);
  const L = id && isValidCpf(id) ? getLedger(s, id) : null;
  if (L && L.birthdate) return cleanBirthdate(L.birthdate);
  const profs = (s && s.clientProfiles) || {};
  const byName = name ? profs[normKey(name)] : null;
  if (byName && byName.birthdate) return cleanBirthdate(byName.birthdate);
  if (id) {
    for (const pr of Object.values(profs)) {
      if (pr && digitsCpf(pr.cpf) === id && pr.birthdate) return cleanBirthdate(pr.birthdate);
    }
  }
  return '';
}
function cleanPayOnBooking(p) {
  const r = p && typeof p === 'object' ? p : {};
  const mode = r.mode === 'fixed' ? 'fixed' : 'percent';
  const depositPercent = Math.max(0, Math.min(100, Math.round(+r.depositPercent || 0)));
  const depositAmount = Math.max(0, Math.round((+r.depositAmount || 0) * 100) / 100);
  return { enabled: !!r.enabled, mode, depositPercent, depositAmount };
}
function cleanPhotoData(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (s.startsWith('data:image/') && s.length > 40) return s.length <= 1900000 ? s : null;
  return null;
}
function knownTeamCats(salon) {
  const ids = new Set();
  CATS.forEach(c => ids.add(c.id));
  cleanCustomCategories(salon && salon.cfg && salon.cfg.customCategories).forEach(c => { if (c && c.id) ids.add(c.id); });
  (salon && salon.services || []).forEach(sv => { if (sv && sv.cat) ids.add(sv.cat); });
  (salon && salon.pros || []).forEach(p => (p && p.cats || []).forEach(c => { if (c) ids.add(c); }));
  return ids;
}
function publicPros(list) {
  return (list || []).map(p => {
    if (!p || typeof p !== 'object') return p;
    const out = Object.assign({}, p);
    delete out.phone;
    delete out.account;
    delete out.commissionPct;
    return out;
  });
}
function proSafe(p) {
  if (!p || typeof p !== 'object') return p;
  const out = Object.assign({}, p);
  if (out.account) out.account = { email: out.account.email };
  return out;
}
const bookingUrl = slug => PUBLIC_URL + '/app?slug=' + encodeURIComponent(slug || '');
const cfgDefaults = cfg => ({
  nicho: cleanNiche(cfg && cfg.nicho),
  botTone: cleanBotTone(cfg && cfg.botTone),
  bot: (cfg && cfg.bot && typeof cfg.bot === 'object') ? cleanBotConfig(cfg.bot) : cleanBotConfigDefaults(),
  slogan: (cfg && cfg.slogan) || '',
  logo: (cfg && cfg.logo) || null,
  ownerPhoto: cleanPhotoData(cfg && cfg.ownerPhoto),
  address: clipText(cfg && cfg.address, 220),
  instagram: clipText(cfg && cfg.instagram, 80).replace(/^@/, ''),
  contactPhone: clipText(cfg && cfg.contactPhone, 30),
  notifyPhone: (cfg && cfg.notifyPhone) || '',
  rebook: cleanRebook(cfg && cfg.rebook),
  payOnBooking: cleanPayOnBooking(cfg && cfg.payOnBooking),
  theme: cleanTheme(cfg && cfg.theme),
  customCategories: cleanCustomCategories(cfg && cfg.customCategories),
  expenses: cleanExpenses(cfg && cfg.expenses),
  botInstance: clipText(cfg && cfg.botInstance, 80)
});
function platformBrandInfo() {
  const v = (db && db.admin && db.admin.logoV) || 0;
  return { name: 'BoraAgendar', logoV: v, logoUrl: '/icons/icon-192.png?v=' + (v || '20260909') };
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function publicBaseUrl(req) {
  const env = String(PUBLIC_URL || '').replace(/\/+$/, '');
  const proto = String((req && req.headers && req.headers['x-forwarded-proto']) || 'https').split(',')[0].trim();
  const host = String((req && req.headers && req.headers['host']) || '').split(',')[0].trim();
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) return proto + '://' + host;
  return env || 'https://glow-platform-production.up.railway.app';
}
function platformIconVersion() {
  const manual = db && db.admin && db.admin.logoV;
  if (manual) return String(manual);
  try {
    const files = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];
    let stamp = '';
    for (const f of files) {
      try { const st = fs.statSync(path.join(ROOT, f)); stamp += st.size + '.' + Math.round(st.mtimeMs); } catch (e) { stamp += 'x'; }
    }
    return sha(stamp).slice(0, 10);
  } catch (e) { return '20260909'; }
}
function applyShareMeta(html, req, url) {
  const base = publicBaseUrl(req);
  const v = platformIconVersion();
  const slug = String((url && url.searchParams && url.searchParams.get('slug')) || '').toLowerCase().trim();
  let title = 'BoraAgendar';
  let desc = 'Agenda online, WhatsApp e horários em um só link.';
  let img = base + '/icons/icon-512.png?v=' + encodeURIComponent(v);
  if (slug) {
    try {
      const resolved = readSalonResolved(slug);
      const s = resolved && resolved.salon;
      if (s) {
        title = s.name || title;
        const slogan = (s.cfg && s.cfg.slogan) || '';
        desc = slogan || ('Agende em ' + s.name + ' pelo celular.');
        /* prévia do link = sempre logo BoraAgendar; a logo do salão só aparece dentro da página */
      }
    } catch (e) {}
  }
  const pageUrl = base + (slug ? '/app?slug=' + encodeURIComponent(slug) : '/app');
  let out = String(html);
  out = out.replace(/<title>[^<]*<\/title>/i, '<title>' + escAttr(title) + ' — BoraAgendar</title>');
  out = out.replace(/<link rel="icon"[^>]*>/i, '<link rel="icon" type="image/png" href="' + base + '/icons/icon-192.png?v=' + encodeURIComponent(v) + '">');
  const manHref = slug ? ('/manifest.webmanifest?slug=' + encodeURIComponent(slug)) : '/manifest.webmanifest';
  out = out.replace(/<link rel="manifest"[^>]*>/i, '<link rel="manifest" href="' + manHref + '">');
  out = out.replace(/<link rel="apple-touch-icon"[^>]*>/i, '');
  const meta = [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="BoraAgendar">',
    '<meta property="og:title" content="' + escAttr(title) + '">',
    '<meta property="og:description" content="' + escAttr(desc).slice(0, 180) + '">',
    '<meta property="og:url" content="' + escAttr(pageUrl) + '">',
    '<meta property="og:image" content="' + escAttr(img) + '">',
    '<meta property="og:image:width" content="512">',
    '<meta property="og:image:height" content="512">',
    '<meta name="twitter:card" content="summary">',
    '<meta name="twitter:title" content="' + escAttr(title) + '">',
    '<meta name="twitter:image" content="' + escAttr(img) + '">' ,
    '<link rel="apple-touch-icon" href="' + base + '/icons/apple-touch-icon.png?v=' + encodeURIComponent(v) + '">'
  ].join('\n');
  if (/<meta property="og:image"[^>]*>/i.test(out)) out = out.replace(/<meta property="og:image"[^>]*>/i, meta);
  else out = out.replace(/<\/title>/i, '</title>\n' + meta);
  out = out.replace(/\/icons\/icon-192\.png\?v=\d+/g, '/icons/icon-192.png?v=' + encodeURIComponent(v));
  return out;
}

/* ---------------- banco de dados ---------------- */
const dbFile = () => path.join(DATA, 'db.json');
let db = null;
let recoveryMode = false;
function ensureDBShape(){
  if (!db || typeof db !== 'object') return;
  if (!db.aliases || typeof db.aliases !== 'object') db.aliases = {};
  if (!db.tokens) db.tokens = {};
  if (!db.tickets) db.tickets = [];
  if (!db.salons) db.salons = [];
  if (!db.waConnect || typeof db.waConnect !== 'object') db.waConnect = {};
  if (!Array.isArray(db.botLog)) db.botLog = [];
  if (!db.clientSalon || typeof db.clientSalon !== 'object') db.clientSalon = {};
  if (!db.clientPending || typeof db.clientPending !== 'object') db.clientPending = {};
  if (!Array.isArray(db.leads)) db.leads = [];
  if (!db.whatsStatus || typeof db.whatsStatus !== 'object') db.whatsStatus = {};
  if (!Array.isArray(db.referrals)) db.referrals = [];
  if (!Array.isArray(db.discountKeys)) db.discountKeys = [];
  if (!db.reportClaims || typeof db.reportClaims !== 'object') db.reportClaims = {};
  if (!Array.isArray(db.platformExpenses)) db.platformExpenses = [];
  if (db.gateway) {
    db.gateway.automations = db.gateway.automations && typeof db.gateway.automations === 'object' ? db.gateway.automations : {};
    if (db.gateway.automations.weeklyReport) {
      db.gateway.automations.weeklyReport = false;
      try { saveDB(); } catch (e) {}
    }
  }
}
function loadDB() {
  const file = dbFile();
  const inProdVolume = !!(process.env.DATA_DIR || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  try {
    if (!fs.existsSync(file)) throw new Error('db.json ausente');
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
    ensureDBShape();
    const allowEmptyProd = process.env.ALLOW_EMPTY_PROD_DB === 'true';
    if (inProdVolume && !allowEmptyProd && (!Array.isArray(db.salons) || db.salons.length === 0)) {
      recoveryMode = true;
      console.error('🚨 MODO RECUPERAÇÃO: banco de produção vazio. O painel continuará disponível para restaurar um backup.');
    }
    console.log('📦 Dados carregados de', file, '—', (db.salons || []).length, 'salão(ões)', recoveryMode ? '(recuperação)' : '');
  } catch (e) {
    console.error('⚠️  Não achei banco em', file, '→', e.message);
    console.error('    DATA_DIR=', process.env.DATA_DIR || '(não definido, usando ./data)');
    fs.mkdirSync(SALONS_DIR, { recursive: true });
    /* Se já existem arquivos de salão no volume, reconecta em vez de seedar demo */
    let existing = [];
    try {
      existing = fs.readdirSync(SALONS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    } catch (_) {}
    db = {
      admin: (function () {
        /* SENHA PADRÃO NÃO EXISTE MAIS: em produção vem de ADMIN_PASSWORD.
           Sem ela, geramos uma na hora e mostramos UMA vez no log do deploy. */
        const env = String(process.env.ADMIN_PASSWORD || '').trim();
        if (env) return { email: process.env.ADMIN_EMAIL || 'admin@boraagendar.com.br', password: hashPw(env) };
        if (process.env.DATA_DIR || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
          const gen = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
          console.log('🔑 Senha inicial do painel (troque depois de entrar):', gen);
          return { email: process.env.ADMIN_EMAIL || 'admin@boraagendar.com.br', password: hashPw(gen) };
        }
        return { email: 'admin@boraagendar.com.br', password: hashPw('admin123') }; /* só para demo local */
      })(),
      salons: [], tickets: [], tokens: {}, aliases: {}
    };
    if (existing.length) {
      console.error('🔁 Reconstruindo índice a partir de', existing.length, 'arquivo(s) em', SALONS_DIR);
      existing.forEach(slug => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(SALONS_DIR, slug + '.json'), 'utf8'));
          db.salons.push({
            slug: s.slug || slug,
            name: s.name || slug,
            owner: s.owner || '',
            email: s.email || '',
            plan: s.plan || 'Básico',
            status: s.status || 'ativo',
            createdAt: s.createdAt || new Date().toISOString(),
            lastActive: Date.now(),
            nextDue: null,
            payments: [],
            trialEnd: s.trialEnd || null
          });
        } catch (err) {
          console.error('   falha ao ler', slug, err.message);
        }
      });
      saveDB();
    } else if (inProdVolume) {
      recoveryMode = true;
      console.error('🚨 MODO RECUPERAÇÃO: volume/banco de produção vazio. O painel continuará disponível para restaurar um backup.');
      console.error('   Confira DATA_DIR (deve ser o mesmo Mount Path do volume) antes de restaurar.');
      saveDB();
    } else {
      console.log('🌱 Ambiente local: criando salões de demonstração...');
      seed();
    }
  }
  return db;
}
function saveDB() { ensureDBShape(); fs.writeFileSync(dbFile(), JSON.stringify(db, null, 2)); }
function readSalon(slug) { try { return JSON.parse(fs.readFileSync(path.join(SALONS_DIR, slug + '.json'), 'utf8')); } catch (e) { return null; } }

/* Restaura um backup gerado pelo painel admin. Os tokens de sessão são
   descartados de propósito: depois da restauração todos precisam entrar novamente. */
function restoreBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.db || typeof snapshot.salons !== 'object') {
    throw new Error('Arquivo de backup inválido');
  }
  const sourceDb = snapshot.db;
  if (!sourceDb.admin || !sourceDb.admin.email || !sourceDb.admin.password) throw new Error('Backup sem credenciais da administração');
  const entries = Object.entries(snapshot.salons);
  if (!entries.length) throw new Error('O backup não contém nenhum salão');
  const restored = [];
  const seen = new Set();
  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const slug = String(raw.slug || key).toLowerCase().trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || seen.has(slug)) throw new Error('Slug inválido no backup');
    if (!String(raw.name || '').trim() || !String(raw.email || '').trim()) throw new Error('Salão incompleto no backup');
    seen.add(slug);
    restored.push(Object.assign({}, raw, { slug }));
  }
  if (!restored.length) throw new Error('O backup não contém salões válidos');
  const metaBySlug = new Map((Array.isArray(sourceDb.salons) ? sourceDb.salons : []).map(x => [String(x.slug || '').toLowerCase(), x]));
  /* O plano/status do índice db.json é a fonte de verdade; sincroniza também o arquivo do salão. */
  restored.forEach(s => {
    const meta = metaBySlug.get(s.slug) || {};
    if (meta.plan) s.plan = meta.plan;
    if (meta.status) s.status = meta.status;
  });
  const metas = restored.map(s => Object.assign({
    slug: s.slug, name: s.name, owner: s.owner || '', email: s.email || '', plan: s.plan || 'Básico',
    status: s.status || 'ativo', createdAt: s.createdAt || new Date().toISOString(), lastActive: Date.now(),
    nextDue: null, payments: [], trialEnd: s.trialEnd || null
  }, metaBySlug.get(s.slug) || {}, { slug: s.slug, name: s.name, owner: s.owner || '', email: s.email || '' }));
  const nextDb = {
    admin: { email: String(sourceDb.admin.email), password: String(sourceDb.admin.password) },
    salons: metas,
    tickets: Array.isArray(sourceDb.tickets) ? sourceDb.tickets : [],
    tokens: {},
    aliases: sourceDb.aliases && typeof sourceDb.aliases === 'object' ? sourceDb.aliases : {}
  };
  if (sourceDb.gateway && typeof sourceDb.gateway === 'object') nextDb.gateway = sourceDb.gateway;
  fs.mkdirSync(SALONS_DIR, { recursive: true });
  fs.readdirSync(SALONS_DIR).filter(f => f.endsWith('.json')).forEach(f => { try { fs.unlinkSync(path.join(SALONS_DIR, f)); } catch (e) {} });
  restored.forEach(s => fs.writeFileSync(path.join(SALONS_DIR, s.slug + '.json'), JSON.stringify(s, null, 2)));
  db = nextDb;
  recoveryMode = false;
  saveDB();
  return { salons: restored.length, tickets: nextDb.tickets.length };
}

/* Ajusta emojis genéricos de beleza quando o nicho não é salão/unhas */
const BEAUTY_EMOJIS = new Set(['💅','💖','👰','🌸','💐','🩷','🎀']);
const NICHE_FALLBACK_EMOJI = { barbearia:'💈', unhas:'💅', estetica:'🧖‍♀️', maquiagem:'💄', tattoo:'🖋️', sobrancelha:'✨', odonto:'🦷', petshop:'🐾', salao:'✨', personal:'🏋️', fisio:'💪', nutri:'🥗', pilates:'🧘', autoest:'🚗', depilacao:'🌸', psico:'🛋️', clinica:'🩺' };
const CAT_FALLBACK_EMOJI = { unhas:'💅', cabelo:'💇‍♀️', sobrancelha:'✨', maquiagem:'💄', estetica:'🧖‍♀️', barbearia:'💈', tattoo:'🖋️', odonto:'🦷', petshop:'🐾', personal:'🏋️', fisio:'💪', nutri:'🥗', pilates:'🧘', autoest:'🚗', depilacao:'🌸', psico:'🛋️', clinica:'🩺' };
function normalizeServiceEmojis(salon) {
  if (!salon || !Array.isArray(salon.services)) return salon;
  let changed = cleanFakePromos(salon);
  const niche = cleanNiche(salon.cfg && salon.cfg.nicho);
  if (niche === 'salao' || niche === 'unhas' || niche === 'maquiagem') {
    if (changed) try { writeSalon(salon); } catch (e) {}
    return salon;
  }
  salon.services.forEach(svc => {
    if (!svc) return;
    if (!svc.emoji || BEAUTY_EMOJIS.has(svc.emoji)) {
      const next = CAT_FALLBACK_EMOJI[svc.cat] || NICHE_FALLBACK_EMOJI[niche] || '✨';
      if (svc.emoji !== next) { svc.emoji = next; changed = true; }
    }
  });
  if (changed) try { writeSalon(salon); } catch (e) {}
  return salon;
}

function writeSalon(s) { fs.writeFileSync(path.join(SALONS_DIR, s.slug + '.json'), JSON.stringify(s, null, 2)); }
function meta(slug) { return db.salons.find(x => x.slug === slug); }
function updateMeta(slug, patch) { const i = db.salons.findIndex(x => x.slug === slug); if (i > -1) { Object.assign(db.salons[i], patch); saveDB(); } }
function touch(slug) { updateMeta(slug, { lastActive: Date.now() }); }
/* aliases: slug antigo -> slug atual (quando o negócio troca de nome/link) */
function aliasMap() { return (db.aliases && typeof db.aliases === 'object') ? db.aliases : {}; }
function setAlias(oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  db.aliases = db.aliases || {};
  db.aliases[oldSlug] = newSlug;
  /* reapontar aliases que já apontavam para o antigo */
  Object.keys(db.aliases).forEach(k => { if (db.aliases[k] === oldSlug) db.aliases[k] = newSlug; });
  saveDB();
}
function resolveSlug(raw) {
  let slug = String(raw || '').toLowerCase().trim();
  if (!slug) return '';
  const seen = new Set();
  const map = aliasMap();
  while (map[slug] && !seen.has(slug)) { seen.add(slug); slug = map[slug]; }
  return slug;
}
function readSalonResolved(raw) {
  const requested = String(raw || '').toLowerCase().trim();
  const slug = resolveSlug(requested);
  const salon = readSalon(slug);
  if (!salon) return null;
  return { salon, slug: salon.slug || slug, requested, redirected: !!(requested && requested !== (salon.slug || slug)) };
}
function isSlugTaken(slug, except) {
  if (!slug) return true;
  if (except && slug === except) return false;
  if (readSalon(slug)) return true;
  const map = aliasMap();
  /* se algum alias aponta para outro salão vivo, considera ocupado só se o arquivo existir no destino diferente */
  if (map[slug] && map[slug] !== except && readSalon(map[slug])) return true;
  return db.salons.some(x => x.slug === slug && x.slug !== except);
}
function renameSalonSlug(oldSlug, newSlug) {
  newSlug = slugify(newSlug);
  if (!newSlug || newSlug.length < 2) return { ok:false, error:'Link público inválido (mín. 2 caracteres)' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug)) return { ok:false, error:'Use só letras minúsculas, números e hífen' };
  if (newSlug === oldSlug) return { ok:true, slug: oldSlug, changed:false };
  if (isSlugTaken(newSlug, oldSlug)) return { ok:false, error:'Este link já está em uso por outro negócio' };
  const s = readSalon(oldSlug);
  if (!s) return { ok:false, error:'Salão não encontrado' };
  const oldPath = path.join(SALONS_DIR, oldSlug + '.json');
  const newPath = path.join(SALONS_DIR, newSlug + '.json');
  s.slug = newSlug;
  s.previousSlugs = Array.from(new Set([...(s.previousSlugs || []), oldSlug])).slice(-10);
  fs.writeFileSync(newPath, JSON.stringify(s, null, 2));
  try { fs.unlinkSync(oldPath); } catch (e) {}
  /* meta */
  const i = db.salons.findIndex(x => x.slug === oldSlug);
  if (i > -1) { db.salons[i].slug = newSlug; db.salons[i].name = s.name; }
  /* tokens ativos do salão */
  Object.keys(db.tokens || {}).forEach(k => {
    if (db.tokens[k] && db.tokens[k].salon === oldSlug) db.tokens[k].salon = newSlug;
  });
  /* tickets */
  (db.tickets || []).forEach(t => { if (t.salonSlug === oldSlug) t.salonSlug = newSlug; });
  setAlias(oldSlug, newSlug);
  saveDB();
  return { ok:true, slug:newSlug, changed:true, oldSlug };
}

/* ---------------- motores de horário (por salão) ---------------- */
function workingWindow(salon, proId, dateStr) {
  const cfg = (salon.availability.schedule[proId] || {})[DOW[new Date(dateStr + 'T12:00:00').getDay()]];
  if (!cfg || !cfg.on) return null;
  if ((salon.availability.offDays[proId] || []).includes(dateStr)) return null;
  return cfg;
}
function durOf(salon, id) { const s = salon.services.find(x => x.id === id); return s ? s.dur : 60; }
function cleanAddons(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = {};
  for (let i = 0; i < arr.length && out.length < 3; i++) {
    const a = arr[i] || {};
    const name = String(a.name || '').trim().slice(0, 80);
    if (!name) continue;
    let price = Number(a.price);
    if (!Number.isFinite(price) || price < 0) price = 0;
    price = Math.round(price * 100) / 100;
    let dur = parseInt(a.dur, 10);
    if (!Number.isFinite(dur) || dur < 0) dur = 0;
    dur = Math.min(180, dur);
    let id = String(a.id || ('ad' + (out.length + 1))).replace(/[^\w-]/g, '').slice(0, 24);
    if (!id) id = 'ad' + (out.length + 1);
    if (seen[id]) id = id + '_' + (out.length + 1);
    seen[id] = 1;
    out.push({ id: id, name: name, price: price, dur: dur });
  }
  return out;
}
function resolveAddons(salon, serviceId, addonIds) {
  const svc = ((salon && salon.services) || []).find(x => x.id === serviceId) || {};
  const allowed = cleanAddons(svc.addons);
  const want = Array.isArray(addonIds) ? addonIds.map(String) : [];
  return allowed.filter(a => want.indexOf(a.id) !== -1);
}
function addonsExtra(addons) {
  const list = Array.isArray(addons) ? addons : [];
  return {
    price: list.reduce((n, a) => n + (Number(a.price) || 0), 0),
    dur: list.reduce((n, a) => n + (Number(a.dur) || 0), 0)
  };
}
function apptDur(salon, a) {
  if (a && Number.isFinite(Number(a.dur)) && Number(a.dur) > 0) return Number(a.dur);
  return durOf(salon, a && a.serviceId) + addonsExtra(a && a.addons).dur;
}
function occupiesSlot(a) {
  return !!a && (a.status === 'confirmed' || a.status === 'done' || a.status === 'pending_payment');
}
function isSlotFree(salon, proId, dateStr, startMin, dur, exceptId) {
  return !salon.appointments.some(a =>
    a.id !== exceptId &&
    a.professionalId === proId && a.date === dateStr &&
    occupiesSlot(a) &&
    overlaps(startMin, startMin + dur, toMin(a.time), toMin(a.time) + apptDur(salon, a)));
}
function slotsFor(salon, proId, dateStr, dur, exceptId) {
  const w = workingWindow(salon, proId, dateStr);
  if (!w) return [];
  const s = toMin(w.start), e = toMin(w.end), ls = toMin(w.lunchStart), le = toMin(w.lunchEnd);
  const nowMin = dateStr === brazilTodayStr() ? brazilNowMin() : -1;
  const res = [];
  for (let m = s; m + dur <= e; m += 30) {
    const lunch = m < le && m + dur > ls;
    const occ = !isSlotFree(salon, proId, dateStr, m, dur, exceptId);
    res.push({ time: fmtTime(m), free: !occ && !lunch && m > nowMin, occupied: occ, lunch, past: m <= nowMin });
  }
  return res;
}
function eligiblePros(salon, catId) { return salon.pros.filter(p => p.cats.includes(catId)); }
function slotsForChoice(salon, serviceId, dateStr, proId, exceptId, extraDur) {
  const dur = durOf(salon, serviceId) + Math.max(0, parseInt(extraDur, 10) || 0);
  const catId = (salon.services.find(x => x.id === serviceId) || {}).cat;
  if (proId && proId !== 'any') return slotsFor(salon, proId, dateStr, dur, exceptId);
  const map = {};
  eligiblePros(salon, catId).forEach(p => slotsFor(salon, p.id, dateStr, dur, exceptId).forEach(s => {
    const k = s.time;
    if (!map[k]) map[k] = { time: k, free: false, occupied: false, lunch: true, past: s.past };
    if (s.free) map[k].free = true;
    if (s.occupied) map[k].occupied = true;
    if (!s.lunch) map[k].lunch = false;
    map[k].past = map[k].past && s.past;
  }));
  return Object.keys(map).sort().map(k => { const s = map[k]; return { time: k, free: s.free, occupied: !s.free && !s.lunch, lunch: s.lunch, past: s.past }; });
}
function assignPro(salon, serviceId, dateStr, timeStr, exceptId, extraDur) {
  const catId = (salon.services.find(x => x.id === serviceId) || {}).cat;
  const dur = durOf(salon, serviceId) + Math.max(0, parseInt(extraDur, 10) || 0);
  return eligiblePros(salon, catId).find(p => slotsFor(salon, p.id, dateStr, dur, exceptId).some(s => s.time === timeStr && s.free)) || null;
}
function isRealPromo(s) {
  if (!s) return false;
  const price = Number(s.price) || 0;
  const promo = Number(s.promoPrice) || 0;
  return !!s.promo && promo > 0 && price > 0 && promo < price;
}
function cleanFakePromos(salon) {
  if (!salon || !Array.isArray(salon.services)) return false;
  let changed = false;
  salon.services.forEach(svc => {
    if (!svc) return;
    const price = Number(svc.price) || 0;
    const promo = Number(svc.promoPrice) || 0;
    /* Destaque (svc.promo) vale mesmo sem preço menor. Só limpa promoção falsa. */
    if (promo > 0 && !(promo < price)) { svc.promoPrice = 0; changed = true; }
  });
  return changed;
}
function effPrice(s) { return isRealPromo(s) ? Number(s.promoPrice) : ((s && s.price) || 0); }
/* Atendimento espontâneo pode registrar um valor diferente do preço de tabela.
   Agendamentos antigos continuam usando o preço do serviço como fallback. */
function appointmentPrice(salon, appointment) {
  const raw = appointment && appointment.amount;
  if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw))) return Math.max(0, Number(raw));
  const base = effPrice(salon.services.find(x => x.id === (appointment && appointment.serviceId)) || {}) + addonsExtra(appointment && appointment.addons).price;
  /* Crédito de indicação e boas-vindas abatem do valor do serviço (receita líquida do salão). */
  let disc = 0;
  if (appointment && appointment.referralCreditUsed) disc += Number(appointment.referralCreditUsed) || 0;
  if (appointment && appointment.welcomeDiscount) disc += Number(appointment.welcomeDiscount) || 0;
  return Math.max(0, base - disc);
}
function moneyRound(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}
function cleanCommissionPct(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}
function proCommissionPct(pro) {
  if (!pro || typeof pro !== 'object') return null;
  if (pro.commissionPct === undefined || pro.commissionPct === null || pro.commissionPct === '') return null;
  return cleanCommissionPct(pro.commissionPct, null);
}
function splitByCommission(price, pct) {
  const p = moneyRound(price);
  if (pct == null) return { pct: null, proEarn: 0, salonEarn: p };
  const proEarn = moneyRound(p * Number(pct) / 100);
  return { pct: Number(pct), proEarn, salonEarn: moneyRound(p - proEarn) };
}
function findProById(s, id) {
  return (s && s.pros || []).find(x => x && x.id === id) || null;
}
function fmtPctLabel(pct) {
  if (pct == null || pct === '') return '—';
  const n = Number(pct);
  if (!Number.isFinite(n)) return '—';
  return (Math.round(n * 10) / 10) + '%';
}
function buildByProList(s, byPro, byProCount, byProEarn, byProSalon) {
  const seen = new Set();
  const rows = [];
  const push = function (id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const p = findProById(s, id);
    rows.push({
      id, name: (p && p.name) || id,
      count: byProCount[id] || 0,
      value: moneyRound(byPro[id] || 0),
      pct: proCommissionPct(p),
      proEarn: moneyRound(byProEarn[id] || 0),
      salonEarn: moneyRound(byProSalon[id] || 0)
    });
  };
  Object.keys(byProCount || {}).forEach(push);
  Object.keys(byPro || {}).forEach(push);
  (s && s.pros || []).forEach(p => { if (p && p.id) push(p.id); });
  return rows.sort((a, b) => b.value - a.value || b.count - a.count || String(a.name).localeCompare(String(b.name), 'pt-BR'));
}
/* Serviço feito = concluído, ou confirmado em data que já passou.
   Não conta: futuro, cancelado, falta, aguardando pagamento. */
function isRealizedAppt(a, today) {
  if (!a) return false;
  const st = a.status;
  if (st === 'canceled' || st === 'no_show' || st === 'pending_payment') return false;
  today = today || brazilTodayStr();
  if (st === 'done') return true;
  if (st === 'confirmed' && a.date && String(a.date).slice(0, 10) <= today) return true;
  return false;
}
function calcDepositAmount(salon, appointment) {
  if (appointment && appointment.charge && Number.isFinite(Number(appointment.charge.amount))) {
    return Math.max(0, Number(appointment.charge.amount));
  }
  const payCfg = cleanPayOnBooking(salon && salon.cfg && salon.cfg.payOnBooking);
  if (!payCfg.enabled) return 0;
  const price = appointmentPrice(salon, appointment);
  if (payCfg.mode === 'fixed') {
    if (payCfg.depositAmount > 0) return Math.min(payCfg.depositAmount, price > 0 ? price : payCfg.depositAmount);
    return price;
  }
  if (payCfg.depositPercent > 0) return Math.round(price * payCfg.depositPercent / 100);
  return price;
}
function paymentSatisfied(a) {
  return !!(a && a.payment && (a.payment.status === 'pago' || a.payment.status === 'aguardando'));
}

/* ===================== PLANOS & PACOTES (plano do mês, pacote de cursos) =====================
   A dona cria o plano: quais serviços cobre, quantas utilizações (N) e a validade em dias
   (0 = sem prazo — caso típico de pacote de curso). Ela vende o pacote para a cliente
   (o dinheiro é dela; ela recebe o Pix e marca como pago — ou já cria marcado).
   A cliente usa o plano no agendamento pela vitrine: o sinal é dispensado e 1 uso é
   consumido. Cancelou? O uso volta. Faltou? O plano decide (noShowUses) se conta uso. */
function fmtD(ds){ const q = String(ds || '').split('-'); return q.length === 3 ? (q[2] + '/' + q[1] + '/' + q[0]) : String(ds || ''); }
function cleanPlanInput(p, idx) {
  p = p || {};
  const uses = Math.max(1, Math.min(99, parseInt(p.uses, 10) || 1));
  const days = Math.max(0, Math.min(365, parseInt(p.days, 10) || 0));
  const price = Math.max(0, Math.round((+p.price || 0) * 100) / 100);
  return {
    id: String(p.id || ('pl' + Date.now() + (idx || 0) + uid())).slice(0, 40),
    name: clipText(p.name, 60) || 'Plano do mês',
    desc: clipText(p.desc, 220),
    services: (Array.isArray(p.services) ? p.services : []).map(String).slice(0, 40),
    uses: uses, days: days, price: price,
    active: p.active !== false,
    noShowUses: !!p.noShowUses,
    type: p.type === 'curso' ? 'curso' : 'servicos',
    renewable: p.renewable === undefined ? true : !!p.renewable,
    featured: !!p.featured,
    sessions: (Array.isArray(p.sessions) ? p.sessions : []).slice(0, 60).map(x => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(String((x || {}).date)) ? String(x.date) : '',
      time: /^\d{1,2}:\d{2}$/.test(String((x || {}).time)) ? String(x.time).padStart(5, '0') : '',
      label: clipText((x || {}).label, 60)
    })).filter(x => x.date && x.time)
  };
}
function packLive(s, pk, svcId) {
  if (!pk || pk.status !== 'ativo') return false;
  if ((+pk.usesLeft || 0) <= 0) return false;
  if (pk.expiresAt && pk.expiresAt < todayStr()) return false;
  const pl = (s.plans || []).find(x => x.id === pk.planId);
  const covers = (pl && pl.services && pl.services.length) ? pl.services : (pk.services || []);
  return !svcId || covers.includes(svcId);
}
function packRefreshExpired(s) {
  let ch = false; const t = todayStr();
  (s.packs || []).forEach(pk => {
    if (pk.status === 'ativo' && pk.expiresAt && pk.expiresAt < t) {
      pk.status = 'expirado';
      (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'venceu', note: 'Validade terminou em ' + pk.expiresAt + ' \u00b7 sobraram ' + (pk.usesLeft || 0) + ' uso(s)' });
      ch = true;
      /* 🎟️ aviso à dona no exato instante em que o pacote vira "expirado" */
      try {
        const ownerPh = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone)) || '';
        if (phoneDigits(ownerPh).length >= 10 && claimReportSend('pacote-venc', pk.id + '|' + pk.expiresAt + '|venc', s.slug)) {
          sendSalonOut(s, ownerPh, '🎟️ *Pacote venceu* — ' + (s.name || '') + '\n\n*' + ((pk.client && pk.client.name) || 'Cliente') + '* ficou com ' + (pk.usesLeft || 0) + ' uso(s) sem usar no plano ' + pk.planName + '. Quem quase usou renova fácil — um "oi" agora rende mais que propaganda. 😉' + (pk.renewReq ? '\n\n⚠️ Ela já tinha pedido renovação: App → Planos → 🔁 Renovar agora.' : ''), 'lembrete-plano');
        }
      } catch (e) {}
    }
  });
  return ch;
}
function packForClient(s, cpf, phone) {
  const c = digitsCpf(cpf || ''), pd = phoneDigits(phone || '');
  return (s.packs || []).filter(pk => {
    if (!pk.client) return false;
    const kc = digitsCpf(pk.client.cpf || ''), kp = phoneDigits(pk.client.phone || '');
    return (c && kc && kc === c) || (pd.length >= 10 && kp.length >= 9 && kp.slice(-9) === pd.slice(-9));
  });
}
function packView(s, pk) {
  const pl = (s.plans || []).find(x => x.id === pk.planId) || {};
  const covers = (pl.services && pl.services.length) ? pl.services : (pk.services || []);
  const live = pk.status === 'ativo' && (+pk.usesLeft || 0) > 0 && (!pk.expiresAt || pk.expiresAt >= todayStr());
  return { id: pk.id, planName: pk.planName || pl.name || 'plano', uses: pk.uses, usesLeft: pk.usesLeft || 0, expiresAt: pk.expiresAt || null, status: (pk.status === 'ativo' && !live) ? 'sem_uso' : pk.status, price: pk.price, services: covers, live, type: pk.type || pl.type || 'servicos', renewable: pk.renewable !== false, renewReq: !!pk.renewReq, sessions: (pk.sessions && pk.sessions.length ? pk.sessions : (pl.sessions || [])), sessionsUsed: (pk.sessionsUsed || []).map(u => ({ date: u.date, time: u.time })) };
}
function packUse(s, appt, pk) {
  pk.usesLeft = Math.max(0, (Number(pk.usesLeft) || 0) - 1);
  (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'uso', note: 'Usou \u201C' + (((s.services || []).find(x => x.id === appt.serviceId) || {}).name || 'serviço') + '\u201D em ' + appt.date + ' ' + appt.time + ' \u00b7 restam ' + pk.usesLeft });
  appt.packRef = { packId: pk.id, planName: pk.planName, left: pk.usesLeft };
}
function packUndo(s, appt, kind) {
  if (!appt || !appt.packRef) return false;
  const pk = (s.packs || []).find(x => x.id === appt.packRef.packId);
  if (!pk) return false;
  if (appt.date && appt.time && Array.isArray(pk.sessionsUsed)) pk.sessionsUsed = pk.sessionsUsed.filter(u => !(u.date === appt.date && u.time === appt.time));
  const pl = (s.plans || []).find(x => x.id === pk.planId) || {};
  if (kind === 'no_show' && pl.noShowUses) {
    (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'falta', note: 'Falta registrada \u2014 uso consumido (regra do plano)' });
    return false;
  }
  pk.usesLeft = Math.min(Number(pk.uses) || 0, (Number(pk.usesLeft) || 0) + 1);
  (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'devolucao', note: (kind === 'no_show' ? 'Falta sem custo \u2014 uso devolvido ao plano' : 'Horário cancelado \u2014 uso devolvido ao plano') + ' \u00b7 restam ' + pk.usesLeft });
  return true;
}
function publicPlans(s) {
  return (s.plans || []).filter(pl => pl.active).map(pl => ({
    id: pl.id, name: pl.name, desc: pl.desc, uses: pl.uses, days: pl.days, price: pl.price,
    type: pl.type || 'servicos', renewable: pl.renewable !== false, featured: !!pl.featured, sessions: (pl.sessions || []).slice(0, 8),
    services: pl.services.map(id => { const v = (s.services || []).find(x => x.id === id) || {}; return { id, name: v.name || id, emoji: v.emoji || '\u2728' }; })
  }));
}
function reschedulePolicy(salon, a) {
  if (!a || a.status !== 'confirmed') return { ok: false, reason: 'Agendamento não está confirmado' };
  const payCfg = cleanPayOnBooking(salon && salon.cfg && salon.cfg.payOnBooking);
  if (!payCfg.enabled) return { ok: true, free: true, consume: false };
  const used = (a.rescheduleCount || 0) >= 1;
  if (paymentSatisfied(a)) {
    if (used) return { ok: false, reason: 'Você já usou o reagendamento grátis deste horário. Cancele e faça um novo agendamento — será cobrado o sinal novamente.' };
    return { ok: true, free: true, consume: true };
  }
  return { ok: true, free: true, consume: false };
}

const NOSHOW_NOTE = 'Cliente faltou — sinal não convertido em crédito';
function ensureClientLedgerMap(s) {
  if (!s.clientLedger || typeof s.clientLedger !== 'object') s.clientLedger = {};
  return s.clientLedger;
}
function getLedger(s, cpf) {
  const id = digitsCpf(cpf);
  if (!isValidCpf(id)) return null;
  return ensureClientLedgerMap(s)[id] || null;
}
function ensureLedger(s, client) {
  const id = digitsCpf(client && client.cpf);
  if (!isValidCpf(id)) return null;
  const map = ensureClientLedgerMap(s);
  const cur = map[id] || {
    cpf: id, name: '', phone: '', birthdate: '', createdAt: new Date().toISOString(),
    noShows: [], waivers: [], deposits: [], events: [], reschedules: []
  };
  if (client && client.name) cur.name = String(client.name).trim().slice(0, 80);
  if (client && client.phone) cur.phone = String(client.phone).trim().slice(0, 30);
  if (client && client.birthdate) {
    const bd = cleanBirthdate(client.birthdate);
    if (bd) cur.birthdate = bd;
  }
  cur.updatedAt = new Date().toISOString();
  map[id] = cur;
  return cur;
}
function pushLedgerEvent(L, type, text, extra) {
  if (!L) return;
  L.events = L.events || [];
  L.events.unshift(Object.assign({ id: 'ev' + uid(), at: new Date().toISOString(), type, text }, extra || {}));
  if (L.events.length > 200) L.events.length = 200;
}
function unusedWaiver(L) {
  return (L && Array.isArray(L.waivers) ? L.waivers.find(w => w && !w.used) : null) || null;
}
function openNoShow(L, salon) {
  const list = L && Array.isArray(L.noShows) ? L.noShows : [];
  return list.find(n => {
    if (!n || n.settledBy) return false;
    if (n.pendingAppointmentId && salon) {
      const ap = (salon.appointments || []).find(a => a.id === n.pendingAppointmentId);
      if (ap && (ap.status === 'pending_payment' || ap.status === 'confirmed' || ap.status === 'done')) return false;
    }
    return true;
  }) || null;
}
function quoteClientCharge(salon, cpf, serviceId, addons) {
  const payCfg = cleanPayOnBooking(salon && salon.cfg && salon.cfg.payOnBooking);
  const price = appointmentPrice(salon, { serviceId: serviceId, addons: addons || [] });
  const L = getLedger(salon, cpf);
  const open = openNoShow(L, salon);
  const waiver = unusedWaiver(L);
  if (open && waiver) {
    return {
      required: false, reason: 'waived', amount: 0, percent: 0, payBeforeConfirm: false,
      waiverId: waiver.id, noShowId: open.id,
      label: 'Cobrança liberada pela dona nesta vez'
    };
  }
  if (open && payCfg.enabled && payCfg.mode === 'percent') {
    const percent = payCfg.depositPercent > 0 ? payCfg.depositPercent : 25;
    const amount = Math.max(0, Math.round(price * percent / 100));
    return {
      required: amount > 0, reason: 'penalty', amount, percent, payBeforeConfirm: true,
      noShowId: open.id,
      label: percent + '% do valor do novo serviço (falta anterior — sinal não virou crédito)'
    };
  }
  if (payCfg.enabled) {
    const dummy = { serviceId };
    const amount = (function () {
      if (payCfg.mode === 'fixed') {
        if (payCfg.depositAmount > 0) return Math.min(payCfg.depositAmount, price > 0 ? price : payCfg.depositAmount);
        return price;
      }
      if (payCfg.depositPercent > 0) return Math.round(price * payCfg.depositPercent / 100);
      return price;
    })();
    return {
      required: amount > 0, reason: 'sinal', amount, percent: payCfg.mode === 'percent' ? payCfg.depositPercent : 0,
      payBeforeConfirm: false,
      label: payCfg.mode === 'fixed' && payCfg.depositAmount > 0
        ? ('Sinal de ' + fmtBRL(amount))
        : (payCfg.depositPercent > 0 ? ('Sinal de ' + payCfg.depositPercent + '% do serviço') : 'Pagamento na confirmação')
    };
  }
  return { required: false, reason: 'none', amount: 0, percent: 0, payBeforeConfirm: false, label: '' };
}
function publicChargeView(q) {
  if (!q) return null;
  return {
    required: !!q.required, reason: q.reason, amount: q.amount || 0, percent: q.percent || 0,
    payBeforeConfirm: !!q.payBeforeConfirm, label: q.label || ''
  };
}
function recordDeposit(s, a) {
  if (!a || !a.payment) return;
  const L = ensureLedger(s, a.client || {});
  if (!L) return;
  L.deposits = L.deposits || [];
  const row = {
    appointmentId: a.id, amount: a.payment.amount, status: a.payment.status,
    at: a.payment.paidAt || a.payment.confirmedByClientAt || a.payment.createdAt,
    kind: (a.charge && a.charge.reason) || 'sinal'
  };
  const i = L.deposits.findIndex(d => d.appointmentId === a.id);
  if (i > -1) L.deposits[i] = row; else L.deposits.unshift(row);
}
function maybeConfirmPending(s, a) {
  if (!a || a.status !== 'pending_payment') return false;
  if (!paymentSatisfied(a) && !(a.payment && a.payment.status === 'pago')) return false;
  a.status = 'confirmed';
  a.confirmedAt = new Date().toISOString();
  if (a.client && a.client.cpf) {
    const L = getLedger(s, a.client.cpf);
    const pendingNs = L && (L.noShows || []).find(n => n.pendingAppointmentId === a.id && !n.settledBy);
    if (pendingNs) pendingNs.settledBy = a.id;
  }
  if (!a.confirmedNotified) {
    a.confirmedNotified = true;
    notifyNewBooking(s, a); notifyClientBooking(s, a);
    /* Recompensa a indicadora quando a indicada confirma o 1º horário (após pagar). */
    if (a.referralCode && a.client && a.client.cpf) {
      const L = getLedger(s, a.client.cpf);
      if (L && !L.refRewarded) rewardClientReferral(s, a);
    }
    return true;
  }
  return true;
}
/* Chave Pix de RECEBIMENTO de um salão (o sinal do agendamento cai na conta do SALÃO,
   nunca na da plataforma). O Access Token global da plataforma serve APENAS para a
   cobrança de assinatura dos salões — não para o sinal do cliente. */
function salonChargePixKey(s, slug) {
  return String((db.salons.find(x => x.slug === (slug || (s && s.slug))) || {}).pixKey || (s && s.cfg && s.cfg.pixKey) || '').trim();
}
/* Pagamento do sinal pelo cliente: SEMPRE manual, com a chave Pix do próprio salão.
   Não usa o token da plataforma (o dinheiro nunca cai na conta da plataforma). */
async function createPixPayment(s, a, amount, slug) {
  amount = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  const pixKey = salonChargePixKey(s, slug);
  const payment = { status: 'pendente', amount, type: 'manual', pixKey, createdAt: new Date().toISOString(), autoCharge: false };
  if (amount > 0 && !pixKey) payment.error = 'O salão ainda não cadastrou uma chave Pix para receber o sinal.';
  return payment;
}
function upsertClientProfile(s, client) {
  if (!s || !client) return;
  if (client.name) {
    s.clientProfiles = s.clientProfiles || {};
    const key = normKey(client.name);
    if (key) {
      const cur = s.clientProfiles[key] || {};
      s.clientProfiles[key] = {
        name: String(client.name).trim().slice(0, 80) || cur.name || '',
        phone: String(client.phone || cur.phone || '').trim().slice(0, 30),
        cpf: digitsCpf(client.cpf || cur.cpf),
        birthdate: cleanBirthdate(client.birthdate) || cur.birthdate || '',
        photo: cur.photo || null
      };
    }
  }
  if (isValidCpf(client.cpf)) {
    const L = ensureLedger(s, client);
    if (L && !L.events) L.events = [];
  }
}
const TEAM_PLANS = new Set(['Pro', 'Premium']);
const canManageTeam = salon => !!(salon && TEAM_PLANS.has(salon.plan));

/* ---------------- seeds ---------------- */
function defaultSchedule() {
  const defDay = (on, start, end, ls, le) => ({ on, start: start || '09:00', end: end || '19:00', lunchStart: ls || '12:00', lunchEnd: le || '13:00' });
  return { mon: defDay(true), tue: defDay(true), wed: defDay(true), thu: defDay(true), fri: defDay(true), sat: defDay(true, '09:00', '14:00'), sun: defDay(false) };
}
const SERVICES_SEED = [
  { id: 'manicure', name: 'Manicure', cat: 'unhas', emoji: '💅', price: 45, dur: 45, promo: false },
  { id: 'pedicure', name: 'Pedicure', cat: 'unhas', emoji: '🦶', price: 55, dur: 50, promo: false },
  { id: 'manu_pedi', name: 'Manicure + Pedicure', cat: 'unhas', emoji: '✨', price: 90, dur: 75, promo: true, promoPrice: 75 },
  { id: 'alongamento', name: 'Alongamento de unhas', cat: 'unhas', emoji: '💅', price: 150, dur: 120, promo: false },
  { id: 'gel', name: 'Esmaltação em gel', cat: 'unhas', emoji: '💖', price: 90, dur: 90, promo: false },
  { id: 'corte_fem', name: 'Corte feminino', cat: 'cabelo', emoji: '✂️', price: 80, dur: 60, promo: false },
  { id: 'corte_masc', name: 'Corte masculino', cat: 'cabelo', emoji: '💈', price: 50, dur: 40, promo: false },
  { id: 'escova', name: 'Escova', cat: 'cabelo', emoji: '💇‍♀️', price: 70, dur: 60, promo: true, promoPrice: 55 },
  { id: 'coloracao', name: 'Coloração', cat: 'cabelo', emoji: '🎨', price: 160, dur: 120, promo: false },
  { id: 'luzes', name: 'Luzes / Mechas', cat: 'cabelo', emoji: '🌟', price: 250, dur: 180, promo: false },
  { id: 'design', name: 'Design de sobrancelha', cat: 'sobrancelha', emoji: '💁‍♀️', price: 40, dur: 30, promo: false },
  { id: 'henna', name: 'Henna', cat: 'sobrancelha', emoji: '🌿', price: 25, dur: 20, promo: false },
  { id: 'design_henna', name: 'Design + Henna', cat: 'sobrancelha', emoji: '✨', price: 55, dur: 45, promo: true, promoPrice: 45 },
  { id: 'fio_a_fio', name: 'Sobrancelha fio a fio', cat: 'sobrancelha', emoji: '🧵', price: 120, dur: 60, promo: false },
  { id: 'make_social', name: 'Maquiagem social', cat: 'maquiagem', emoji: '💄', price: 120, dur: 60, promo: false },
  { id: 'make_noiva', name: 'Maquiagem para noivas', cat: 'maquiagem', emoji: '👰', price: 450, dur: 150, promo: false },
  { id: 'make_auto', name: 'Automaquiagem', cat: 'maquiagem', emoji: '🪞', price: 80, dur: 60, promo: false },
  { id: 'limpeza', name: 'Limpeza de pele', cat: 'estetica', emoji: '🧖‍♀️', price: 130, dur: 75, promo: true, promoPrice: 100 },
  { id: 'hidratacao', name: 'Hidratação facial', cat: 'estetica', emoji: '💧', price: 90, dur: 60, promo: false },
  { id: 'mascara', name: 'Máscara facial', cat: 'estetica', emoji: '🍃', price: 70, dur: 45, promo: false }
];
const trialSvc = (id, name, cat, emoji, price, dur) => ({ id, name, cat, emoji, price, dur, promo:false });
const TRIAL_TEMPLATES = {
  salao: { slogan:'Beleza, cuidado e praticidade em cada atendimento.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Profissional de beleza', emoji:'💄', cats:['unhas','cabelo','sobrancelha','maquiagem','estetica'], services:null },
  barbearia: { slogan:'Estilo e cuidado em cada corte.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Barbeiro(a)', emoji:'💈', cats:['barbearia','sobrancelha'], services:[
    trialSvc('corte-classico','Corte clássico','barbearia','✂️',45,45), trialSvc('corte-degrade','Corte degradê','barbearia','💇‍♂️',55,55), trialSvc('barba','Barba tradicional','barbearia','🪒',35,35), trialSvc('corte-barba','Corte + barba','barbearia','💈',80,75), trialSvc('pezinho','Pezinho / acabamento','barbearia','🧔',20,20), trialSvc('sobrancelha-masc','Sobrancelha masculina','sobrancelha','👁️',25,25)
  ]},
  unhas: { slogan:'Unhas lindas, cuidado em cada detalhe.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Nail designer', emoji:'💅', cats:['unhas'], services:[
    trialSvc('manicure','Manicure','unhas','💅',30,45), trialSvc('pedicure','Pedicure','unhas','🦶',30,50), trialSvc('manu-pedi','Manicure + Pedicure','unhas','✨',50,90), trialSvc('gel','Esmaltação em gel','unhas','💖',90,90), trialSvc('alongamento','Alongamento de unhas','unhas','💅',130,120), trialSvc('blindagem','Blindagem em gel','unhas','✨',65,75)
  ]},
  estetica: { slogan:'Seu momento de cuidado começa aqui.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Especialista em estética', emoji:'🧖', cats:['estetica'], services:[
    trialSvc('limpeza-pele','Limpeza de pele','estetica','🧖',130,75), trialSvc('hidratacao-facial','Hidratação facial','estetica','💧',90,60), trialSvc('peeling','Peeling facial','estetica','✨',150,60), trialSvc('massagem','Massagem relaxante','estetica','💆',120,60)
  ]},
  maquiagem: { slogan:'Beleza para realçar a sua melhor versão.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Maquiador(a)', emoji:'💄', cats:['maquiagem'], services:[
    trialSvc('make-social','Maquiagem social','maquiagem','💄',120,60), trialSvc('make-noiva','Maquiagem para noiva','maquiagem','👰',450,150), trialSvc('make-festa','Maquiagem festa','maquiagem','✨',150,75), trialSvc('auto-make','Automaquiagem','maquiagem','🪞',100,90)
  ]},
  tattoo: { slogan:'Arte autoral, atendimento profissional.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Tatuador(a)', emoji:'🖋️', cats:['tattoo'], services:[
    trialSvc('tattoo-mini','Tatuagem mini','tattoo','🖋️',180,60), trialSvc('tattoo-media','Tatuagem média','tattoo','🖋️',350,120), trialSvc('piercing','Piercing','tattoo','✨',90,30), trialSvc('consulta-tattoo','Consulta / orçamento','tattoo','📋',0,30)
  ]},
  sobrancelha: { slogan:'Seu olhar em destaque todos os dias.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Designer de sobrancelhas', emoji:'✨', cats:['sobrancelha'], services:[
    trialSvc('design','Design de sobrancelhas','sobrancelha','✨',40,30), trialSvc('henna','Design + Henna','sobrancelha','🌿',55,45), trialSvc('lash','Lash lifting','sobrancelha','👁️',130,60), trialSvc('brow','Brow lamination','sobrancelha','✨',150,60)
  ]},
  odonto: { slogan:'Cuidado odontológico com atenção e confiança.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Profissional de odontologia', emoji:'🦷', cats:['odonto'], services:[
    trialSvc('avaliacao','Avaliação odontológica','odonto','🦷',0,30), trialSvc('limpeza-odonto','Limpeza dentária','odonto','🪥',180,45), trialSvc('clareamento','Clareamento dental','odonto','✨',650,60), trialSvc('manutencao','Manutenção ortodôntica','odonto','🦷',150,30)
  ]},
  petshop: { slogan:'Cuidado e carinho para o seu melhor amigo.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Profissional pet', emoji:'🐾', cats:['petshop'], services:[
    trialSvc('banho-p','Banho — porte pequeno','petshop','🐾',45,60), trialSvc('banho-m','Banho — porte médio','petshop','🐾',60,75), trialSvc('banho-tosa','Banho + tosa','petshop','✂️',85,90), trialSvc('tosa-hig','Tosa higiênica','petshop','🐾',45,45), trialSvc('unhas-pet','Corte de unhas','petshop','🐾',25,20)
  ]},
  personal: { slogan:'Treino com hora marcada e evolução que aparece.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Personal trainer', emoji:'🏋️', cats:['personal'], services:[
    trialSvc('avaliacao-personal','Avaliação física','personal','📋',100,60), trialSvc('treino-pessoal','Treino pessoal','personal','🏋️',150,60), trialSvc('treino-duo','Treino em dupla','personal','👥',200,60), trialSvc('funcional','Aula funcional','personal','⏱️',90,50), trialSvc('online-personal','Mensal online (acompanhamento)','personal','📱',280,30)
  ]},
  fisio: { slogan:'Movimento sem dor, evolução com constância.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Fisioterapeuta', emoji:'💪', cats:['fisio'], services:[
    trialSvc('avaliacao-fisio','Avaliação fisioterapêutica','fisio','📋',180,50), trialSvc('sessao-fisio','Sessão de fisioterapia','fisio','💪',160,50), trialSvc('rpg-fisio','RPG / Reeducação postural','fisio','🧘',150,50), trialSvc('pilates-clin','Pilates clínico','fisio','⏱️',120,50), trialSvc('dlm-fisio','Drenagem linfática','fisio','✨',140,60)
  ]},
  nutri: { slogan:'Consulta que muda o prato — e vira hábito.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Nutricionista', emoji:'🥗', cats:['nutri'], services:[
    trialSvc('consulta-nutri','Consulta nutricional','nutri','🥗',250,50), trialSvc('retorno-nutri','Retorno de evolução','nutri','📈',120,30), trialSvc('plano-alimentar','Plano alimentar + consulta','nutri','🍽️',300,60), trialSvc('nutri-esportiva','Nutrição esportiva','nutri','🏋️',280,50), trialSvc('nutri-materna','Nutrição materna','nutri','🤱',260,50)
  ]},
  pilates: { slogan:'Corpo no lugar com aula pequena e horário fixo.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Instrutor(a) de pilates', emoji:'🧘', cats:['pilates'], services:[
    trialSvc('avaliacao-pilates','Avaliação postural','pilates','📋',100,40), trialSvc('aula-solo','Aula solo em turma','pilates','🧘',90,50), trialSvc('aula-reformer','Aula individual no aparelho','pilates','⚙️',150,50), trialSvc('dueto-pilates','Aula em dupla','pilates','👥',110,50), trialSvc('mensal-pilates','Plano mensal 3x/semana','pilates','📅',380,30)
  ]},
  autoest: { slogan:'Carro com cara de novo, com hora marcada.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Detailer', emoji:'🚗', cats:['autoest'], services:[
    trialSvc('lavagem-auto','Lavagem detalhada','autoest','🫧',150,120), trialSvc('polimento-auto','Polimento + vitrificação','autoest','✨',600,240), trialSvc('interna-auto','Higienização de interior','autoest','🪑',250,150), trialSvc('motor-auto','Limpeza de motor','autoest','🔧',120,60), trialSvc('farol-auto','Restauração de faróis','autoest','💡',90,45)
  ]},
  depilacao: { slogan:'Pele lisa sem \u201Cme encaixa aí?\u201D no meio da tarde.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Depiladora', emoji:'🌸', cats:['depilacao'], services:[
    trialSvc('perna-dep','Perna completa','depilacao','🌸',80,60), trialSvc('axila-virilha','Axila + virilha','depilacao','✨',60,40), trialSvc('virilha-completa','Virilha completa','depilacao','🌺',55,35), trialSvc('bucqueixo-dep','Buço + queixo','depilacao','🪷',35,20), trialSvc('costa-homem-dep','Costa ou peito (masculino)','depilacao','💪',70,50)
  ]},
  psico: { slogan:'A sessão acontece — sem \u201Cvou ter que faltar hoje\u201D.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Psicólogo(a)', emoji:'🛋️', cats:['psico'], services:[
    trialSvc('sessao-psico','Sessão individual','psico','🛋️',200,50), trialSvc('sessao-online-psico','Sessão online','psico','💻',180,50), trialSvc('casal-psico','Sessão de casal','psico','👥',320,60), trialSvc('infantil-psico','Sessão infantil','psico','🧸',200,45), trialSvc('acolhimento-psico','Acolhimento (1ª conversa)','psico','📋',0,30)
  ]},
  clinica: { slogan:'Do agendamento ao retorno — sua clínica funcionando redonda.', theme:{primary:'#0ABAB5',bg:'#071318',font:'moderna'}, role:'Profissional da clínica', emoji:'🩺', cats:['clinica'], services:[
    trialSvc('avaliacao-clinica','Consulta de avaliação','clinica','🩺',250,50), trialSvc('retorno-clinica','Retorno','clinica','📋',120,30), trialSvc('procedimento-clinica','Procedimento','clinica','✨',350,60), trialSvc('tratamento-clinica','Sessão de tratamento','clinica','⏱️',180,45), trialSvc('exame-clinica','Exame / avaliação completa','clinica','🔬',200,40)
  ]}
};
function applyTrialTemplate(salon, niche) {
  const t = TRIAL_TEMPLATES[cleanNiche(niche)] || TRIAL_TEMPLATES.salao;
  salon.cfg = salon.cfg || {};
  salon.cfg.slogan = t.slogan;
  salon.cfg.nicho = cleanNiche(niche);
  salon.cfg.botTone = 'auto';
  salon.cfg.theme = cleanTheme(t.theme);
  salon.cfg.rebook = cleanRebook({ enabled:true, days:23, autoWhats:true });
  salon.services = t.services ? JSON.parse(JSON.stringify(t.services)) : JSON.parse(JSON.stringify(SERVICES_SEED));
  /* 2 primeiros serviços como destaque (promo) para o trial já nascer com vitrine */
  salon.services.forEach((svc, i) => {
    if (i < 2) {
      svc.promo = true;
      svc.promoPrice = Math.max(1, Math.round((svc.price || 0) * 0.85));
    }
  });
  salon.pros.forEach(p => { p.role = t.role; p.emoji = t.emoji; p.cats = t.cats.slice(); });
}

function nthWeekday(ds, n) {
  const d = new Date(ds + 'T12:00:00'); let found = -1;
  while (found < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w >= 1 && w <= 5) found++; }
  return fmtDate(d);
}
function makeSalon(cfg) {
  const schedule = {};
  cfg.pros.forEach(p => { schedule[p.id] = defaultSchedule(); });
  if (cfg.scheduleOverrides) Object.keys(cfg.scheduleOverrides).forEach(pid => Object.assign(schedule[pid], cfg.scheduleOverrides[pid]));
  return {
    slug: cfg.slug, name: cfg.name, owner: cfg.owner, email: cfg.email, passwordHash: hashPw(cfg.password),
    plan: cfg.plan, status: cfg.status || 'teste', createdAt: new Date().toISOString(),
    cfg: { slogan: cfg.slogan || 'Transformando sua beleza com carinho e cuidado.', logo: null, nicho: cleanNiche(cfg.nicho), botTone: cleanBotTone(cfg.botTone), bot: (cfg.bot && typeof cfg.bot === 'object') ? cleanBotConfig(cfg.bot) : cleanBotConfigDefaults(), address: clipText(cfg.address, 220), instagram: clipText(cfg.instagram, 80).replace(/^@/, ''), contactPhone: clipText(cfg.contactPhone, 30), notifyPhone: '', rebook: cleanRebook(cfg.rebook) },
    pros: cfg.pros,
    services: JSON.parse(JSON.stringify(SERVICES_SEED)),
    availability: { schedule, offDays: {} },
    plans: cfg.plans || [], packs: cfg.packs || [],
    appointments: cfg.appointments || []
  };
}
function seed() {
  const t = todayStr(), d1 = nthWeekday(t, 0), d2 = nthWeekday(t, 1), d3 = nthWeekday(t, 2);
  const mk = (name, phone) => ({ name, phone });
  const s1 = makeSalon({
    slug: 'studio-da-bel', name: 'Studio da Bel', owner: 'Isabela R.', email: 'bel@studio.com', password: '123456', plan: 'Pro', status: 'ativo',
    slogan: 'Beleza que combina com você.',
    pros: [
      { id: 'ana', name: 'Ana Paula', role: 'Especialista em unhas', emoji: '💅', color: '#F7C6D4', cats: ['unhas'], commissionPct: 50 },
      { id: 'camila', name: 'Camila Souza', role: 'Cabelo & coloração', emoji: '💇‍♀️', color: '#F3D9B1', cats: ['cabelo'], commissionPct: 40 },
      { id: 'juliana', name: 'Juliana Lima', role: 'Sobrancelha & maquiagem', emoji: '💄', color: '#D9BCEB', cats: ['sobrancelha', 'maquiagem'], commissionPct: 60 },
      { id: 'renata', name: 'Renata Alves', role: 'Estética facial', emoji: '🧖‍♀️', color: '#B5E0CF', cats: ['estetica'], commissionPct: 50 }
    ],
    scheduleOverrides: { camila: { sat: { on: false, start: '09:00', end: '19:00', lunchStart: '12:00', lunchEnd: '13:00' } }, renata: { sat: { on: true, start: '09:00', end: '13:00', lunchStart: '12:00', lunchEnd: '13:00' } } },
    appointments: [
      { id: 'a1', serviceId: 'manicure', professionalId: 'ana', date: d1, time: '09:00', client: mk('Mariana Costa', '(21) 99811-2233'), status: 'confirmed', notes: '', createdAt: Date.now() - 8.64e7 },
      { id: 'a2', serviceId: 'corte_fem', professionalId: 'camila', date: d1, time: '10:00', client: mk('Patrícia Gomes', '(21) 98765-4321'), status: 'confirmed', notes: '', createdAt: Date.now() - 8.64e7 },
      { id: 'a3', serviceId: 'design_henna', professionalId: 'juliana', date: d1, time: '14:30', client: mk('Fernanda Dias', '(21) 99988-7766'), status: 'confirmed', notes: '', createdAt: Date.now() - 8.64e7 },
      { id: 'a4', serviceId: 'make_social', professionalId: 'juliana', date: d2, time: '10:00', client: mk('Larissa Mendes', '(21) 97654-3210'), status: 'confirmed', notes: '', createdAt: Date.now() - 7e7 },
      { id: 'a5', serviceId: 'escova', professionalId: 'camila', date: d2, time: '15:00', client: mk('Sofia Almeida', '(21) 95544-3322'), status: 'confirmed', notes: '', createdAt: Date.now() - 7e7 },
      { id: 'a6', serviceId: 'limpeza', professionalId: 'renata', date: d2, time: '09:30', client: mk('Carolina Nunes', '(21) 93322-1100'), status: 'done', notes: '', createdAt: Date.now() - 9e7 }
    ]
  });
  const s2 = makeSalon({
    slug: 'sala-da-cintia', name: 'Sala da Cíntia', owner: 'Cíntia M.', email: 'cintia@sala.com', password: '123456', plan: 'Básico', status: 'ativo',
    slogan: 'Cabelo bonito é autoestima.',
    pros: [
      { id: 'cintia', name: 'Cíntia M.', role: 'Cabeleireira', emoji: '💇‍♀️', color: '#F3D9B1', cats: ['cabelo'], commissionPct: 50 },
      { id: 'mara', name: 'Mara L.', role: 'Manicure', emoji: '💅', color: '#F7C6D4', cats: ['unhas'], commissionPct: 50 }
    ],
    appointments: [
      { id: 'a1', serviceId: 'escova', professionalId: 'cintia', date: d1, time: '15:00', client: mk('Sofia Almeida', '(21) 95544-3322'), status: 'confirmed', notes: '', createdAt: Date.now() - 6e7 },
      { id: 'a2', serviceId: 'coloracao', professionalId: 'cintia', date: d2, time: '11:00', client: mk('Beatriz Ramos', '(21) 94433-2211'), status: 'confirmed', notes: '', createdAt: Date.now() - 5e7 }
    ]
  });
  const s3 = makeSalon({
    slug: 'unhas-da-pri', name: 'Unhas da Pri', owner: 'Priscila A.', email: 'pri@unhas.com', password: '123456', plan: 'Básico', status: 'teste',
    slogan: 'Unhas impecáveis, vida leve.',
    pros: [{ id: 'pri', name: 'Pri A.', role: 'Manicure & nail design', emoji: '💅', color: '#F7C6D4', cats: ['unhas'] }],
    appointments: []
  });
  [s1, s2, s3].forEach(s => { writeSalon(s); db.salons.push({ slug: s.slug, name: s.name, owner: s.owner, email: s.email, plan: s.plan, status: s.status, createdAt: s.createdAt, lastActive: Date.now(), nextDue: addDays(todayStr(), 15), payments: [], trialEnd: null }); });
  db.tickets = [
    { id: 't1', salonSlug: 'unhas-da-pri', salonName: 'Unhas da Pri', user: 'Priscila A.', subject: 'Como coloco minha logo no aplicativo?', message: 'Não estou conseguindo subir a imagem da logo.', status: 'aberto', when: Date.now() - 3.6e6 },
    { id: 't2', salonSlug: 'sala-da-cintia', salonName: 'Sala da Cíntia', user: 'Cíntia M.', subject: 'Quero mudar o horário de almoço da agenda', message: 'Atendo até 18h, pode ajustar?', status: 'aberto', when: Date.now() - 8.64e7 }
  ];
  saveDB();
}

/* ---------------- API helpers ---------------- */
function json(res, code, obj) {
  try { res.setHeader('Cache-Control', 'no-store'); } catch (e) {} res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > 40e6) { req.destroy(); reject(new Error('Arquivo grande demais')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        try { req.rawBody = data; } catch (e) {}
        resolve(data ? JSON.parse(data) : {});
      } catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function tokenAuth(req, role) {
  const h = req.headers['authorization'] || '';
  const tk = h.startsWith('Bearer ') ? h.slice(7) : '';
  const t = db.tokens[tk];
  if (!t) return null;
  if (t.exp < Date.now()) { delete db.tokens[tk]; saveDB(); return null; }
  if (role === 'salon' && !t.salon) return null;
  if (role === 'admin' && t.salon) return null;
  return t;
}

/* ---------------- estatísticas do salão ---------------- */
function salonStats(s) {
  const today = brazilTodayStr();
  const act = s.appointments.filter(a => isRealizedAppt(a, today));
  const revenue = act.reduce((acc, a) => acc + appointmentPrice(s, a), 0);
  const clients = new Set(s.appointments.map(a => (a.client && a.client.name || '').trim().toLowerCase()).filter(Boolean));
  const upcoming = s.appointments.filter(a => a.status === 'confirmed' && a.date >= todayStr()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);
  return { appts: s.appointments.length, revenue, clients: clients.size, upcoming: upcoming.map(a => ({ id: a.id, time: a.time, date: a.date, client: a.client.name, service: (s.services.find(x => x.id === a.serviceId) || {}).name, pro: (s.pros.find(p => p.id === a.professionalId) || {}).name })) };
}

const normKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function clientRecordKey(client) {
  const cpf = digitsCpf(client && client.cpf);
  if (isValidCpf(cpf)) return 'cpf:' + cpf;
  const name = (client && client.name || '').trim();
  if (!name) return '';
  return 'name:' + normKey(name);
}
function rememberServiceNote(s, client, serviceId, text) {
  const key = clientRecordKey(client);
  const note = clipText(text, 400);
  if (!s || !key || !serviceId || !note) return;
  s.clientServiceNotes = s.clientServiceNotes || {};
  s.clientServiceNotes[key] = Object.assign({}, s.clientServiceNotes[key] || {});
  s.clientServiceNotes[key][String(serviceId)] = note;
}
function serviceNotesForClient(s, client) {
  const store = (s && s.clientServiceNotes) || {};
  const out = {};
  const keys = [];
  const rec = clientRecordKey(client);
  if (rec) keys.push(rec);
  if (client && client.key && keys.indexOf(client.key) < 0) keys.push(client.key);
  if (client && client.name) {
    const nk = 'name:' + normKey(client.name);
    if (keys.indexOf(nk) < 0) keys.push(nk);
  }
  keys.forEach(k => {
    const m = store[k];
    if (!m || typeof m !== 'object') return;
    Object.keys(m).forEach(sid => {
      const note = clipText(m[sid], 400);
      if (note) out[sid] = note;
    });
  });
  return out;
}
function applyClientServiceNotes(s, key, map) {
  if (!s || !key || !map || typeof map !== 'object') return;
  s.clientServiceNotes = s.clientServiceNotes || {};
  const cur = Object.assign({}, s.clientServiceNotes[key] || {});
  Object.keys(map).forEach(sid => {
    const note = clipText(map[sid], 400);
    if (note) cur[sid] = note;
    else delete cur[sid];
  });
  s.clientServiceNotes[key] = cur;
}
function aggregateClients(s) {
  const map = {};
  const today = brazilTodayStr();
  (s.appointments || []).forEach(a => {
    if (a.status === 'canceled') return;
    const name = (a.client && a.client.name || '').trim();
    const key = clientRecordKey(a.client);
    if (!key) return;
    const price = a.status === 'no_show' ? 0 : appointmentPrice(s, a);
    if (!map[key]) map[key] = {
      key, name, phone: (a.client && a.client.phone) || '', cpf: digitsCpf(a.client && a.client.cpf),
      visits: 0, total: 0, lastVisit: null, nextVisit: null, upcoming: 0, history: 0,
      services: {}, noShowCount: 0, freeReschedules: 0, notes: ''
    };
    const c = map[key];
    if (name) c.name = name;
    if (a.client && a.client.phone) c.phone = a.client.phone;
    if (a.client && a.client.cpf && !c.cpf) c.cpf = digitsCpf(a.client.cpf);
    if (a.client && a.client.birthdate && !c.birthdate) c.birthdate = cleanBirthdate(a.client.birthdate);
    if (a.status === 'no_show') c.noShowCount++;
    else c.visits++;
    if (a.rescheduleCount) c.freeReschedules += a.rescheduleCount;
    c.total += price;
    if (!c.lastVisit || a.date > c.lastVisit) c.lastVisit = a.date;
    c.services[a.serviceId] = (c.services[a.serviceId] || 0) + 1;
    if ((a.status === 'confirmed' || a.status === 'pending_payment') && a.date >= today) {
      c.upcoming++;
      if (!c.nextVisit || a.date < c.nextVisit) c.nextVisit = a.date;
    } else {
      c.history++;
    }
  });
  const ledger = ensureClientLedgerMap(s);
  Object.keys(ledger).forEach(cpf => {
    const L = ledger[cpf];
    const key = 'cpf:' + cpf;
    if (!map[key]) map[key] = {
      key, name: L.name || '', phone: L.phone || '', cpf, visits: 0, total: 0,
      lastVisit: null, nextVisit: null, upcoming: 0, history: 0, services: {},
      noShowCount: 0, freeReschedules: 0, notes: L.notes || ''
    };
    const c = map[key];
    if (L.name) c.name = L.name;
    if (L.phone) c.phone = L.phone;
    c.cpf = cpf;
    if (L.notes) c.notes = L.notes;
    c.noShowCount = Math.max(c.noShowCount, (L.noShows || []).length);
    c.openNoShow = !!openNoShow(L, s);
    c.unusedWaiver = !!unusedWaiver(L);
    c.waiverReason = (unusedWaiver(L) || {}).reason || '';
    c.deposits = (L.deposits || []).slice(0, 20);
    c.noShows = (L.noShows || []).slice(0, 20);
    c.waivers = (L.waivers || []).slice(0, 20);
    c.events = (L.events || []).slice(0, 30);
    c.reschedules = (L.reschedules || []).slice(0, 20);
  });
  const list = Object.values(map);
  const profs = s.clientProfiles || {};
  list.forEach(c => {
    const nameKey = normKey(c.name);
    const pr = profs[nameKey] || {};
    if (pr.name && !c.name) c.name = pr.name;
    if (pr.phone && !c.phone) c.phone = pr.phone;
    c.photo = pr.photo || null;
    if (pr.cpf && !c.cpf) c.cpf = pr.cpf;
    c.birthdate = pr.birthdate || c.birthdate || '';
    if (!c.notes) c.notes = (s.clientNotes && s.clientNotes[nameKey]) || '';
    c.serviceNotes = serviceNotesForClient(s, { name: c.name, cpf: c.cpf, key: c.key });
    c.openNoShow = !!c.openNoShow;
    c.unusedWaiver = !!c.unusedWaiver;
  });
  return list.sort((a, b) => b.total - a.total || b.visits - a.visits);
}
function monthBalance(s, mk) {
  mk = String(mk || '').slice(0, 7);
  const DOW_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const appts = (s.appointments || []).filter(a => String(a.date || '').slice(0, 7) === mk);
  let revenue = 0, canceled = 0, noShow = 0, done = 0, confirmed = 0;
  let commission = 0, salonShare = 0;
  const bySvc = {}, bySvcCount = {}, byPro = {}, byProCount = {}, byProEarn = {}, byProSalon = {}, byDow = {}, byDowRev = {}, byHour = {};
  const clients = new Set();
  const firstByClient = {};
  (s.appointments || []).forEach(a => {
    if (!a || a.status === 'canceled') return;
    const k = clientRecordKey(a.client);
    if (!k || !a.date) return;
    if (!firstByClient[k] || a.date < firstByClient[k]) firstByClient[k] = a.date;
  });
  const today = brazilTodayStr();
  appts.forEach(a => {
    const st = a.status;
    if (st === 'canceled') { canceled++; return; }
    if (st === 'no_show') { noShow++; return; }
    if (st === 'pending_payment') { confirmed++; return; }
    if (st === 'confirmed' && a.date && a.date > today) { confirmed++; return; }
    if (st === 'done') done++;
    else if (st === 'confirmed') confirmed++;
    else return;
    const price = appointmentPrice(s, a);
    revenue += price;
    const svc = a.serviceId || '?';
    bySvc[svc] = (bySvc[svc] || 0) + price;
    bySvcCount[svc] = (bySvcCount[svc] || 0) + 1;
    const pro = a.professionalId || '?';
    const split = splitByCommission(price, proCommissionPct(findProById(s, pro)));
    commission += split.proEarn;
    salonShare += split.salonEarn;
    byPro[pro] = (byPro[pro] || 0) + price;
    byProCount[pro] = (byProCount[pro] || 0) + 1;
    byProEarn[pro] = (byProEarn[pro] || 0) + split.proEarn;
    byProSalon[pro] = (byProSalon[pro] || 0) + split.salonEarn;
    const dow = new Date(a.date + 'T12:00:00').getDay();
    byDow[dow] = (byDow[dow] || 0) + 1;
    byDowRev[dow] = (byDowRev[dow] || 0) + price;
    bumpApptHour(byHour, a);
    const key = clientRecordKey(a.client);
    if (key) clients.add(key);
  });
  let newClients = 0;
  clients.forEach(k => { if (String(firstByClient[k] || '').slice(0, 7) === mk) newClients++; });
  const expensesList = cleanExpenses(s.cfg && s.cfg.expenses).filter(e => String(e.date || '').slice(0, 7) === mk);
  const expensesTotal = expensesList.reduce((a, e) => a + e.amount, 0);
  const profit = Math.round((revenue - expensesTotal) * 100) / 100;
  const served = (function () {
    let n = 0;
    appts.forEach(a => { if (isRealizedAppt(a, today)) n++; });
    return n;
  })();
  const ticketMedio = served ? Math.round(revenue / served) : 0;
  const svcName = id => (s.services.find(x => x.id === id) || { name: id }).name;
  const proName = id => (s.pros.find(x => x.id === id) || { name: id }).name;
  const topServices = Object.keys(bySvcCount).map(id => ({
    id, name: svcName(id), count: bySvcCount[id], value: bySvc[id] || 0
  })).sort((a, b) => b.count - a.count || b.value - a.value);
  const byProList = buildByProList(s, byPro, byProCount, byProEarn, byProSalon);
  const byDowList = [0, 1, 2, 3, 4, 5, 6].map(d => ({
    day: DOW_NAMES[d], dow: d, count: byDow[d] || 0, revenue: byDowRev[d] || 0
  }));
  const movable = byDowList.filter(x => x.dow !== 0 || x.count > 0);
  const bestDow = movable.slice().sort((a, b) => b.count - a.count || b.revenue - a.revenue)[0] || null;
  const worstDow = movable.filter(x => x.dow !== 0).slice().sort((a, b) => a.count - b.count || a.revenue - b.revenue)[0] || null;
  const byHourList = hourListFrom(byHour, 'count');
  const peak = peakHourKey(byHour);
  const topService = topServices[0] || null;
  const topPro = byProList[0] || null;
  return {
    month: mk, label: monthLabelBR(mk),
    revenue, expenses: expensesTotal, profit, done, confirmed, served, canceled, noShow,
    commission: moneyRound(commission), salonShare: moneyRound(salonShare),
    ticketMedio, clients: clients.size, newClients,
    topService, topPro,
    peakHour: peak ? (peak + 'h') : null, peakHourCount: peak ? byHour[peak] : 0,
    bestDow: bestDow && bestDow.count ? { day: bestDow.day, count: bestDow.count, revenue: bestDow.revenue } : null,
    worstDow: worstDow && (!bestDow || worstDow.day !== bestDow.day) ? { day: worstDow.day, count: worstDow.count, revenue: worstDow.revenue } : null,
    topServices: topServices.slice(0, 6),
    byProList, byDowList, byHourList
  };
}
function formatMonthlyWhats(s, bal, prev) {
  const nome = (s && s.name) || 'seu espaço';
  let growth = '';
  if (prev && prev.revenue > 0) {
    const g = Math.round((bal.revenue - prev.revenue) / prev.revenue * 100);
    growth = ' (' + (g >= 0 ? '+' : '') + g + '% vs ' + String(prev.label || '').split(' ')[0] + ')';
  }
  const lines = [
    '📊 *Balanço de ' + bal.label + '* — ' + nome,
    '',
    '💰 Faturamento: ' + fmtBRL(bal.revenue) + growth,
    ((bal.byProList || []).some(x => x && x.pct != null) ? ('💼 Equipe (comissões): ' + fmtBRL(bal.commission || 0) + ' · 🏠 Casa: ' + fmtBRL(bal.salonShare != null ? bal.salonShare : moneyRound((bal.revenue || 0) - (bal.commission || 0)))) : null),
    '💸 Gastos: ' + fmtBRL(bal.expenses),
    (bal.profit >= 0 ? '📈 Lucro: ' : '⚠️ Prejuízo: ') + fmtBRL(bal.profit),
    '🎟️ Ticket médio: ' + fmtBRL(bal.ticketMedio),
    '✅ ' + bal.served + ' atendimentos · ❌ ' + bal.canceled + ' cancel. · ⚠️ ' + bal.noShow + ' faltas',
    '👥 ' + bal.clients + ' clientes' + (bal.newClients ? (' · ' + bal.newClients + ' novos') : '')
  ];
  if (bal.topService) lines.push('', '⭐ Mais contratado: *' + bal.topService.name + '* (' + bal.topService.count + 'x · ' + fmtBRL(bal.topService.value) + ')');
  if (bal.bestDow) lines.push('📅 Melhor dia da semana: *' + bal.bestDow.day + '* (' + bal.bestDow.count + ' atendimentos)');
  if (bal.worstDow) lines.push('📉 Dia mais fraco: *' + bal.worstDow.day + '* (' + bal.worstDow.count + ')');
  if (bal.topPro) lines.push('👩 Quem mais atendeu: *' + bal.topPro.name + '*');
  if (bal.peakHour) lines.push('🕐 Horário de pico: ' + bal.peakHour);
  const splits = (bal.byProList || []).filter(x => x && (x.count || x.value));
  if (splits.length) {
    lines.push('', '💼 Produção da equipe:');
    splits.slice(0, 6).forEach(x => {
      lines.push('   *' + x.name + '* · ' + fmtPctLabel(x.pct) + ' · produziu ' + fmtBRL(x.value) + ' · ganho ' + fmtBRL(x.proEarn));
    });
  }
  lines.push('', 'Detalhes no app: Relatórios → Equipe.');
  return lines.filter(function (x) { return x != null; }).join('\n');
}
function upsertMonthlyReport(s, bal, text, via) {
  s.monthlyReports = Array.isArray(s.monthlyReports) ? s.monthlyReports : [];
  const row = {
    month: bal.month, label: bal.label, sentAt: new Date().toISOString(), via: via || 'auto',
    revenue: bal.revenue, expenses: bal.expenses, profit: bal.profit,
    served: bal.served, canceled: bal.canceled, noShow: bal.noShow,
    ticketMedio: bal.ticketMedio, clients: bal.clients, newClients: bal.newClients,
    topService: bal.topService, bestDow: bal.bestDow, worstDow: bal.worstDow,
    topPro: bal.topPro, peakHour: bal.peakHour, text: text
  };
  const i = s.monthlyReports.findIndex(x => x && x.month === bal.month);
  if (i > -1) s.monthlyReports[i] = row;
  else s.monthlyReports.unshift(row);
  if (s.monthlyReports.length > 24) s.monthlyReports.length = 24;
  return row;
}
function lastDayOfMonth(mk) {
  const p = String(mk || '').split('-');
  return new Date(Number(p[0]) || 2026, Number(p[1]) || 1, 0).getDate();
}
/* Balanço mensal: UMA VEZ, só no dia 1 do mês seguinte (mês anterior já fechado). */
function monthEndWindow(today) {
  today = today || brazilTodayStr();
  const mk = today.slice(0, 7);
  const day = parseInt(today.slice(8, 10), 10);
  const last = lastDayOfMonth(mk);
  return { today, mk, day, last, inWindow: day === 1 };
}
function claimReportSend(kind, key, slug) {
  db.reportClaims = db.reportClaims && typeof db.reportClaims === 'object' ? db.reportClaims : {};
  const id = String(kind || '') + ':' + String(key || '') + ':' + String(slug || '');
  if (!id || id === '::') return false;
  if (db.reportClaims[id]) return false;
  db.reportClaims[id] = new Date().toISOString();
  const keys = Object.keys(db.reportClaims);
  if (keys.length > 400) {
    keys.sort(function (a, b) { return String(db.reportClaims[a]).localeCompare(String(db.reportClaims[b])); });
    keys.slice(0, keys.length - 300).forEach(function (k) { delete db.reportClaims[k]; });
  }
  try { saveDB(); } catch (e) {}
  return true;
}
/* Mês fechado = mês anterior ao atual (no dia 1 já está completo). */
function closedMonthKey(today) {
  today = today || brazilTodayStr();
  return monthKeyAdd(today.slice(0, 7), -1);
}
/* Espalha os balanços pelos dias 1-3 do mês (cada salão tem seu dia fixo por
   hash do slug): o número da plataforma não toma 200 rajadas no dia 1. */
function reportDaySlot(slug) {
  let h = 0;
  const t = String(slug || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h % 3;
}
function runMonthlyReports() {
  const w = monthEndWindow();
  if (!(w.day >= 1 && w.day <= 3)) return { sent: 0, skipped: 'fora-da-janela', day: w.day, last: w.last };
  const mk = closedMonthKey(w.today); /* mês FECHADO: enviado só no dia 1 do mês seguinte */
  let sent = 0, already = 0;
  (db.salons || []).forEach(meta => {
    const s = readSalon(meta.slug);
    if (!s || s.status === 'suspenso') return;
    if (w.day - 1 !== reportDaySlot(s.slug)) return;
    const existing = (s.monthlyReports || []).find(x => x && x.month === mk);
    if (existing) { already++; return; }
    if (!claimReportSend('monthly', mk, s.slug)) { already++; return; }
    const bal = monthBalance(s, mk);
    if (!bal.served && !bal.revenue && !bal.expenses) { already++; return; }
    const prev = monthBalance(s, monthKeyAdd(mk, -1));
    const text = formatMonthlyWhats(s, bal, prev);
    upsertMonthlyReport(s, bal, text, 'auto');
    writeSalon(s); /* grava sentAt ANTES do WhatsApp — o job horário não manda de novo */
    const n = pushNotif(s, 'balanco', 'Balanço de ' + bal.label + ' — enviado no WhatsApp do dono. Faturamento ' + fmtBRL(bal.revenue) + ', lucro ' + fmtBRL(bal.profit) + '.');
    sseSend(s.slug, n);
    sendOwnerWhats(s, text, 'balanco');
    sent++;
  });
  return { sent, already, month: mk };
}

/* --- Balanço TRIMESTRAL: agrega os 3 meses anteriores ao mês atual. --- */
function quarterPeriod(today) {
  today = today || brazilTodayStr();
  const cur = today.slice(0, 7);
  const m2 = monthKeyAdd(cur, -1), m1 = monthKeyAdd(cur, -2), m0 = monthKeyAdd(cur, -3);
  /* Ordem cronológica (do mais antigo ao mais recente) para exibição. */
  const label = monthLabelBR(m0) + ' a ' + monthLabelBR(m2) + ' — ' + m0.slice(0, 4);
  return { months: [m0, m1, m2], refMonth: m2, label, key: m0.slice(0, 4) + '-T' + String(Math.floor((Number(m2.slice(5, 7)) - 1) / 3) + 1) };
}
function quarterBalance(s, today) {
  const q = quarterPeriod(today);
  let revenue = 0, expenses = 0, profit = 0, served = 0, canceled = 0, noShow = 0, commission = 0, salonShare = 0;
  const bySvc = {}, byPro = {}, byHour = {}, byDow = {};
  const clients = new Set();
  const monthSeries = [];
  for (const mk of q.months) {
    const b = monthBalance(s, mk);
    revenue += b.revenue; expenses += b.expenses; profit += b.profit;
    served += b.served; canceled += b.canceled; noShow += b.noShow;
    commission += b.commission || 0; salonShare += b.salonShare || 0;
    monthSeries.push({ month: mk, label: monthLabelBR(mk), revenue: b.revenue, profit: b.profit, served: b.served, newClients: b.newClients });
  }
  /* clientes únicos no trimestre */
  const mkSet = new Set(q.months);
  (s.appointments || []).forEach(a => {
    if (!a) return;
    const k = clientRecordKey(a.client);
    if (!k || !a.date) return;
    if (mkSet.has(String(a.date).slice(0, 7))) clients.add(k);
  });
  /* serviços e profissionais do trimestre (por receita) */
  q.months.forEach(mk => {
    (s.appointments || []).forEach(a => {
      if (!a || String(a.date || '').slice(0, 7) !== mk) return;
      if (a.status === 'canceled' || a.status === 'no_show' || a.status === 'pending_payment') return;
      const price = appointmentPrice(s, a);
      const svc = a.serviceId || '?'; bySvc[svc] = (bySvc[svc] || 0) + price;
      const pro = a.professionalId || '?'; byPro[pro] = (byPro[pro] || 0) + price;
      bumpApptHour(byHour, a);
      const dow = new Date(a.date + 'T12:00:00').getDay(); byDow[dow] = (byDow[dow] || 0) + 1;
    });
  });
  const svcName = id => (s.services.find(x => x.id === id) || { name: id }).name;
  const proName = id => (s.pros.find(x => x.id === id) || { name: id }).name;
  const topServices = Object.entries(bySvc).map(([id, value]) => ({ id, name: svcName(id), value }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  const topPro = Object.entries(byPro).map(([id, value]) => ({ id, name: proName(id), value }))
    .sort((a, b) => b.value - a.value)[0] || null;
  const peakHour = peakHourKey(byHour);
  const peakHourPair = peakHour ? [peakHour, byHour[peakHour]] : null;
  return {
    q: q.key, label: q.label, months: monthSeries,
    revenue, expenses, profit, served, canceled, noShow,
    commission: moneyRound(commission), salonShare: moneyRound(salonShare),
    clients: clients.size, ticketMedio: served ? Math.round(revenue / served) : 0,
    avgMonthly: Math.round(revenue / 3), topServices, topPro,
    peakHour: peakHourPair ? (peakHourPair[0] + 'h') : null, peakHourCount: peakHourPair ? peakHourPair[1] : 0
  };
}
function formatQuarterlyWhats(s, bal) {
  const nome = (s && s.name) || 'seu espaço';
  const lines = [
    '📊 *Balanço do trimestre* — ' + nome,
    '_' + bal.label + '_',
    '',
    '💰 Faturamento: ' + fmtBRL(bal.revenue) + ' (média ' + fmtBRL(bal.avgMonthly) + '/mês)',
    '💼 Equipe (comissões): ' + fmtBRL(bal.commission || 0) + ' · 🏠 Casa: ' + fmtBRL(bal.salonShare != null ? bal.salonShare : moneyRound((bal.revenue || 0) - (bal.commission || 0))),
    '💸 Gastos: ' + fmtBRL(bal.expenses),
    (bal.profit >= 0 ? '📈 Lucro: ' : '⚠️ Prejuízo: ') + fmtBRL(bal.profit),
    '🎟️ Ticket médio: ' + fmtBRL(bal.ticketMedio),
    '✅ ' + bal.served + ' atendimentos · ❌ ' + bal.canceled + ' cancel. · ⚠️ ' + bal.noShow + ' faltas',
    '👥 ' + bal.clients + ' clientes únicos no período',
    ''];
  if (bal.months && bal.months.length) {
    lines.push('🧮 Mês a mês:');
    bal.months.forEach(m => lines.push('   ' + m.label + ': ' + fmtBRL(m.revenue) + ' · ' + m.served + ' atend.'));
  }
  if (bal.topServices && bal.topServices.length) {
    lines.push('', '⭐ Serviços que mais renderam:');
    bal.topServices.slice(0, 4).forEach(sv => lines.push('   *' + sv.name + '*: ' + fmtBRL(sv.value)));
  }
  if (bal.topPro) lines.push('👩 Profissional que mais rendeu: *' + bal.topPro.name + '*');
  if (bal.peakHour) lines.push('🕐 Horário de pico no trimestre: ' + bal.peakHour);
  lines.push('', 'Detalhes no app: Relatórios → Balanço.');
  return lines.join('\n');
}
function runQuarterlyReports(today) {
  today = today || brazilTodayStr();
  const day = parseInt(String(today).slice(8, 10), 10);
  if (day < 1 || day > 3) return { sent: 0, skipped: 'fora-da-janela', day: day };
  /* Uma vez: dia 1 seguinte ao trimestre (1/jan, 1/abr, 1/jul, 1/out). */
  const curM = Number(String(today).slice(5, 7));
  if (![1, 4, 7, 10].includes(curM)) return { sent: 0, skipped: 'nao-e-1o-dia-do-trimestre', month: curM };
  const q = quarterPeriod(today);
  let sent = 0, already = 0;
  (db.salons || []).forEach(meta => {
    const s = readSalon(meta.slug);
    if (!s || s.status === 'suspenso') return;
    if (day - 1 !== reportDaySlot(s.slug)) return;
    s.quarterlyReports = Array.isArray(s.quarterlyReports) ? s.quarterlyReports : [];
    const existing = s.quarterlyReports.find(x => x && x.q === q.key);
    if (existing) { already++; return; }
    if (!claimReportSend('quarterly', q.key, s.slug)) { already++; return; }
    const bal = quarterBalance(s, today);
    if (!bal.served && !bal.revenue) { already++; return; }
    const text = formatQuarterlyWhats(s, bal);
    s.quarterlyReports.unshift({
      q: q.key, label: q.label, sentAt: new Date().toISOString(), via: 'auto',
      revenue: bal.revenue, expenses: bal.expenses, profit: bal.profit,
      served: bal.served, clients: bal.clients, ticketMedio: bal.ticketMedio, text
    });
    if (s.quarterlyReports.length > 8) s.quarterlyReports.length = 8;
    writeSalon(s); /* sentAt gravado ANTES do WhatsApp */
    const n = pushNotif(s, 'balanco', 'Balanço trimestral enviado — faturamento ' + fmtBRL(bal.revenue) + ', lucro ' + fmtBRL(bal.profit) + '.');
    sseSend(s.slug, n);
    sendOwnerWhats(s, text, 'balanco');
    sent++;
  });
  return { sent, already, quarter: q.key };
}

function salonReports(s) {
  const today = brazilTodayStr();
  const month = today.slice(0, 7);
  const d0 = new Date(today + 'T12:00:00'); const pm = new Date(d0.getFullYear(), d0.getMonth() - 1, 1);
  const prevMonth = pm.getFullYear() + '-' + pad(pm.getMonth() + 1);
  let revenue = 0, revenueThis = 0, revenuePrev = 0;
  let commissionThis = 0, commissionPrev = 0, commissionToday = 0, commissionWeek = 0, commissionTotal = 0;
  let salonShareThis = 0, salonSharePrev = 0;
  const bySvc = {}, bySvcCount = {}, byPro = {}, byProCount = {}, byProEarn = {}, byProSalon = {}, byDow = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, byHour = {};
  const revenueByMonth = {};
  let confirmed = 0, done = 0, canceled = 0, doneThis = 0, donePrev = 0, scheduledThis = 0;
  let revenueToday = 0, doneToday = 0, revenueWeek = 0, doneWeek = 0;
  const ws = weekStartStr(today);
  s.appointments.forEach(a => {
    if (!a) return;
    if (a.status === 'canceled') { canceled++; return; }
    if (a.status === 'no_show' || a.status === 'pending_payment') return;
    const mk = String(a.date || '').slice(0, 7);
    const ds = String(a.date || '').slice(0, 10);
    if (a.status === 'confirmed' && ds && ds > today) {
      confirmed++;
      if (mk === month) scheduledThis++;
      return;
    }
    if (!isRealizedAppt(a, today)) return;
    const price = appointmentPrice(s, a);
    const pid = a.professionalId;
    const split = splitByCommission(price, proCommissionPct(findProById(s, pid)));
    revenue += price;
    commissionTotal += split.proEarn;
    if (a.status === 'done') done++; else confirmed++;
    if (mk) revenueByMonth[mk] = (revenueByMonth[mk] || 0) + price;
    if (mk === month) { revenueThis += price; doneThis++; commissionThis += split.proEarn; salonShareThis += split.salonEarn; }
    else if (mk === prevMonth) { revenuePrev += price; donePrev++; commissionPrev += split.proEarn; salonSharePrev += split.salonEarn; }
    if (ds === today) { revenueToday += price; doneToday++; commissionToday += split.proEarn; }
    if (ds >= ws && ds <= today) { revenueWeek += price; doneWeek++; commissionWeek += split.proEarn; }
    bySvc[a.serviceId] = (bySvc[a.serviceId] || 0) + price;
    bySvcCount[a.serviceId] = (bySvcCount[a.serviceId] || 0) + 1;
    byPro[pid] = (byPro[pid] || 0) + price;
    byProCount[pid] = (byProCount[pid] || 0) + 1;
    byProEarn[pid] = (byProEarn[pid] || 0) + split.proEarn;
    byProSalon[pid] = (byProSalon[pid] || 0) + split.salonEarn;
    byDow[new Date(a.date + 'T12:00:00').getDay()]++;
    bumpApptHour(byHour, a);
  });
  const expenses = cleanExpenses(s.cfg && s.cfg.expenses);
  let expensesThis = 0, expensesPrev = 0, expensesTotal = 0;
  const expensesByMonth = {}, expensesByCat = {};
  expenses.forEach(e => {
    expensesTotal += e.amount;
    const mk = String(e.date || '').slice(0, 7);
    if (mk) expensesByMonth[mk] = (expensesByMonth[mk] || 0) + e.amount;
    if (mk === month) expensesThis += e.amount;
    if (mk === prevMonth) expensesPrev += e.amount;
    const cat = e.category || 'Geral';
    expensesByCat[cat] = (expensesByCat[cat] || 0) + e.amount;
  });
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
    const mk = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const rev = revenueByMonth[mk] || 0;
    const exp = expensesByMonth[mk] || 0;
    months.push({ month: mk, label, revenue: rev, expenses: exp, profit: Math.round((rev - exp) * 100) / 100 });
  }
  const svcName = id => (s.services.find(x => x.id === id) || { name: id }).name;
  const proName = id => (s.pros.find(x => x.id === id) || { name: id }).name;
  const topServices = Object.entries(bySvc).map(([id, v]) => ({ id, name: svcName(id), value: v, count: bySvcCount[id] || 0 })).sort((a, b) => b.count - a.count || b.value - a.value).slice(0, 8);
  const byProList = buildByProList(s, byPro, byProCount, byProEarn, byProSalon);
  const DOW_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const byDowList = Object.entries(byDow).map(([d, v]) => ({ day: DOW_NAMES[+d], value: v })).sort((a, b) => b.value - a.value);
  const byHourList = hourListFrom(byHour, 'value');
  const byExpenseCat = Object.entries(expensesByCat).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const profitThis = Math.round((revenueThis - expensesThis) * 100) / 100;
  const profitPrev = Math.round((revenuePrev - expensesPrev) * 100) / 100;
  const balanceThis = monthBalance(s, month);
  const balancePrev = monthBalance(s, prevMonth);
  return {
    revenue, revenueThis, revenuePrev,
    growth: revenuePrev ? Math.round((revenueThis - revenuePrev) / revenuePrev * 100) : null,
    confirmed, done, canceled, doneThis, donePrev, scheduledThis,
    revenueToday, doneToday, revenueWeek, doneWeek, weekStart: ws,
    commissionThis: moneyRound(commissionThis), commissionPrev: moneyRound(commissionPrev),
    commissionToday: moneyRound(commissionToday), commissionWeek: moneyRound(commissionWeek),
    commissionTotal: moneyRound(commissionTotal),
    salonShareThis: moneyRound(salonShareThis), salonSharePrev: moneyRound(salonSharePrev),
    netProfitThis: moneyRound(salonShareThis - expensesThis),
    ticketMedio: doneThis ? Math.round(revenueThis / doneThis) : 0,
    topServices, byProList, byDowList, byHourList,
    peakHour: (function () { const pk = peakHourKey(byHour); return pk ? (pk + 'h') : null; })(),
    expenses, expensesTotal, expensesThis, expensesPrev, byExpenseCat, months,
    profitThis, profitPrev,
    profitGrowth: profitPrev ? Math.round((profitThis - profitPrev) / Math.abs(profitPrev) * 100) : null,
    insight: profitThis >= 0
      ? ('Neste mês o lucro está em ' + profitThis.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + (expensesThis ? ' após ' + expensesThis.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + ' de gastos.' : '.'))
      : ('Atenção: os gastos deste mês superam o faturamento em ' + Math.abs(profitThis).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '.'),
    balanceThis, balancePrev,
    monthlyReports: (s.monthlyReports || []).slice(0, 12),
    quarterlyReports: (s.quarterlyReports || []).slice(0, 8)
  };
}

function proReports(s, proId) {
  const today = brazilTodayStr();
  const month = today.slice(0, 7);
  const ws = weekStartStr(today);
  const d0 = new Date(today + 'T12:00:00');
  const pm = new Date(d0.getFullYear(), d0.getMonth() - 1, 1);
  const prevMonth = pm.getFullYear() + '-' + pad(pm.getMonth() + 1);
  const proObj = findProById(s, proId) || { id: proId, name: 'Profissional' };
  const pct = proCommissionPct(proObj);
  let producedThis = 0, producedPrev = 0, producedToday = 0, producedWeek = 0, producedTotal = 0;
  let earnThis = 0, earnPrev = 0, earnToday = 0, earnWeek = 0, earnTotal = 0;
  let salonThis = 0, salonTotal = 0;
  let doneThis = 0, doneToday = 0, doneWeek = 0, doneTotal = 0;
  const bySvc = {};
  const items = [];
  (s.appointments || []).forEach(a => {
    if (!a || a.professionalId !== proId) return;
    if (!isRealizedAppt(a, today)) return;
    const price = appointmentPrice(s, a);
    const split = splitByCommission(price, pct);
    const mk = String(a.date || '').slice(0, 7);
    const ds = String(a.date || '').slice(0, 10);
    producedTotal += price; earnTotal += split.proEarn; salonTotal += split.salonEarn; doneTotal++;
    if (mk === month) { producedThis += price; earnThis += split.proEarn; salonThis += split.salonEarn; doneThis++; }
    else if (mk === prevMonth) { producedPrev += price; earnPrev += split.proEarn; }
    if (ds === today) { producedToday += price; earnToday += split.proEarn; doneToday++; }
    if (ds >= ws && ds <= today) { producedWeek += price; earnWeek += split.proEarn; doneWeek++; }
    const sid = a.serviceId || '?';
    const svcObj = (s.services || []).find(x => x.id === sid) || {};
    if (!bySvc[sid]) bySvc[sid] = { id: sid, name: svcObj.name || sid, count: 0, produced: 0, earn: 0 };
    bySvc[sid].count++;
    bySvc[sid].produced += price;
    bySvc[sid].earn += split.proEarn;
    items.push({
      id: a.id, date: a.date, time: a.time,
      client: (a.client && a.client.name) || '',
      service: svcObj.name || sid,
      price: moneyRound(price),
      pct: split.pct,
      proEarn: split.proEarn,
      salonEarn: split.salonEarn
    });
  });
  items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.time || '').localeCompare(String(a.time || '')));
  const bySvcList = Object.values(bySvc).map(x => ({
    id: x.id, name: x.name, count: x.count,
    produced: moneyRound(x.produced), earn: moneyRound(x.earn)
  })).sort((a, b) => b.produced - a.produced || b.count - a.count);
  return {
    isProView: true,
    proId, proName: proObj.name || 'Profissional',
    pct,
    producedThis: moneyRound(producedThis), producedPrev: moneyRound(producedPrev),
    producedToday: moneyRound(producedToday), producedWeek: moneyRound(producedWeek),
    producedTotal: moneyRound(producedTotal),
    earnThis: moneyRound(earnThis), earnPrev: moneyRound(earnPrev),
    earnToday: moneyRound(earnToday), earnWeek: moneyRound(earnWeek),
    earnTotal: moneyRound(earnTotal),
    salonThis: moneyRound(salonThis), salonTotal: moneyRound(salonTotal),
    doneThis, doneToday, doneWeek, doneTotal,
    ticketMedio: doneThis ? moneyRound(producedThis / doneThis) : 0,
    bySvc: bySvcList,
    recent: items.slice(0, 50)
  };
}

/* ---------------- rotas ---------------- */
async function handle(req, res, url, body) {
  const p = url.pathname;
  const q = url.searchParams;

  const vidM = p.match(/^\/media\/svc-video\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
  if (vidM && req.method === 'GET') {
    const file = svcVideoPath(vidM[1], vidM[2]);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const buf = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes'
    });
    res.end(buf);
    return;
  }

  /* ---- autenticação ---- */
  if (p === '/api/auth/login' && req.method === 'POST') {
    const { email, password } = body;
    /* 12 tentativas por IP a cada 10 min — trava força bruta sem travar gente real. */
    if (tooMany(req, 'login', 12, 10 * 60 * 1000)) {
      return json(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde uns minutos e tente de novo.' });
    }
    if (String(email).toLowerCase() === db.admin.email && checkPw(password, db.admin.password)) {
      if (!isModernHash(db.admin.password)) { db.admin.password = hashPw(password); }
      const tk = sessionToken(); db.tokens[tk] = { role: 'admin', exp: Date.now() + 30 * 864e5 }; saveDB();
      const ap = adminProfile();
      return json(res, 200, { ok: true, role: 'admin', token: tk, name: ap.name, emoji: ap.emoji });
    }
    const s = db.salons.find(x => x.email.toLowerCase() === String(email).toLowerCase());
    if (s) {
      const sal = readSalon(s.slug);
      if (sal && checkPw(password, sal.passwordHash)) {
        if (!isModernHash(sal.passwordHash)) { sal.passwordHash = hashPw(password); writeSalon(sal); }
        const tk = sessionToken(); db.tokens[tk] = { role: 'salon', salon: s.slug, exp: Date.now() + 30 * 864e5 }; saveDB();
        touch(s.slug);
        return json(res, 200, { ok: true, role: 'salon', token: tk, slug: s.slug, name: s.name });
      }
    }
    /* login de profissional (conta individual criada pela dona do salão) */
    for (const x of db.salons) {
      const sal = readSalon(x.slug);
      if (!sal) continue;
      const proObj = sal.pros.find(pp => pp.account && String(pp.account.email).toLowerCase() === String(email).toLowerCase() && checkPw(password, pp.account.passwordHash));
      if (proObj) {
        if (!isModernHash(proObj.account.passwordHash)) { proObj.account.passwordHash = hashPw(password); writeSalon(sal); }
        const tk = sessionToken(); db.tokens[tk] = { role: 'pro', salon: x.slug, proId: proObj.id, exp: Date.now() + 30 * 864e5 }; saveDB();
        touch(x.slug);
        return json(res, 200, { ok: true, role: 'pro', token: tk, slug: x.slug, name: proObj.name, proId: proObj.id });
      }
    }
    return json(res, 401, { ok: false, error: 'E-mail ou senha incorretos' });
  }

  /* ---- público (clientes marcam sem login) ---- */
  let m = p.match(/^\/api\/public\/([a-z0-9-]+)\/data$/);
  if (m && req.method === 'GET') {
    const resolved = readSalonResolved(m[1]);
    if (!resolved) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const s = normalizeServiceEmojis(resolved.salon);
    const pubCfg = cfgDefaults(s.cfg);
    delete pubCfg.notifyPhone; /* não expor o telefone da dona para o público */
    /* não expor a chave do motor de IA para o público */
    if (pubCfg.bot && pubCfg.bot.ai) { pubCfg.bot.ai.token = ''; pubCfg.bot.ai.baseUrl = ''; }
    /* fotos por URL: o JSON que a cliente baixa deixa de pesar megabytes */
    pubCfg.logo = photoRef(pubCfg.logo, '/api/public/' + s.slug + '/logo');
    pubCfg.ownerPhoto = photoRef(pubCfg.ownerPhoto, imgRef('owner', s.slug, 'owner'));
    const slimServices = (s.services || []).map(x => x ? Object.assign({}, x, { photo: photoRef(x.photo, imgRef('svc', s.slug, x.id)) }) : x);
    const slimPros = publicPros(s.pros).map(x => x ? Object.assign({}, x, { photo: photoRef(x.photo, imgRef('pro', s.slug, x.id)) }) : x);
    return json(res, 200, {
      ok: true,
      salon: { name: s.name, slug: s.slug, cfg: pubCfg, plan: s.plan, status: s.status },
      pros: slimPros, services: slimServices, cats: mergeCats(s),
      clientReferral: clientRefCfgFor(s),
      canonicalSlug: s.slug,
      redirectedFrom: resolved.redirected ? resolved.requested : null,
      brand: platformBrandInfo()
    });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/img\/(svc|pro|owner)\/([\w.%-]+)$/);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const resolved = readSalonResolved(m[1]);
    if (!resolved) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const s = resolved.salon;
    const id = decodeURIComponent(m[3]);
    let raw = '';
    if (m[2] === 'svc') { const sv = (s.services || []).find(x => String(x.id) === id); raw = sv && sv.photo; }
    else if (m[2] === 'pro') { const pr = (s.pros || []).find(x => String(x.id) === id); raw = pr && pr.photo; }
    else raw = (s.cfg && s.cfg.ownerPhoto) || '';
    if (typeof raw === 'string' && raw && !photoBuffer(raw)) { res.writeHead(302, { Location: raw }); return res.end(); }
    const img = photoBuffer(raw);
    if (!img) { res.writeHead(404); res.end(); return; }
    const etag = '"' + sha(img.buf.toString('base64').slice(0, 60000)).slice(0, 24) + '"';
    if (String(req.headers['if-none-match'] || '') === etag) { res.writeHead(304); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': img.type, 'Content-Length': img.buf.length, 'ETag': etag,
      'Cache-Control': 'public, max-age=2592000, immutable', 'Vary': 'Accept-Encoding'
    });
    return res.end(img.buf);
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/logo$/);
  if (m && req.method === 'GET') {
    const resolved = readSalonResolved(m[1]);
    if (!resolved) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const s = resolved.salon;
    const photo = cleanPhotoData(s && s.cfg && s.cfg.logo);
    if (photo) {
      const mm = photo.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (mm) {
        try {
          const buf = Buffer.from(mm[2], 'base64');
          const etag = '"' + sha(mm[2].slice(0, 60000)).slice(0, 24) + '"';
          if (String(req.headers['if-none-match'] || '') === etag) { res.writeHead(304); res.end(); return; }
          res.writeHead(200, {
            'Content-Type': mm[1], 'Content-Length': buf.length, 'ETag': etag,
            'Cache-Control': 'public, max-age=2592000, immutable'
          });
          return res.end(buf);
        } catch (e) {}
      }
    }
    res.writeHead(302, { Location: '/icons/icon-512.png?v=' + encodeURIComponent(platformIconVersion()) });
    return res.end();
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/slots$/);
  if (m && req.method === 'GET') {
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(resolved.salon);
    const serviceId = q.get('serviceId'), date = q.get('date'), proId = q.get('proId') || 'any';
    const exceptId = q.get('exceptId') || '';
    const extraDur = q.get('extraDur') || 0;
    if (!serviceId || !date) return json(res, 400, { ok: false, error: 'Faltam parâmetros' });
    return json(res, 200, { ok: true, slots: slotsForChoice(s, serviceId, date, proId, exceptId, extraDur) });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/days$/);
  if (m && req.method === 'GET') {
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(resolved.salon);
    const serviceId = q.get('serviceId'), proId = q.get('proId') || 'any';
    const catId = (s.services.find(x => x.id === serviceId) || {}).cat;
    const days = [];
    for (let i = 0; i < 60; i++) {
      const ds = addDays(brazilTodayStr(), i);
      if (isSunday(ds)) continue;
      if (proId && proId !== 'any') { if (workingWindow(s, proId, ds)) days.push(ds); }
      else if (eligiblePros(s, catId).some(p => workingWindow(s, p.id, ds))) days.push(ds);
    }
    return json(res, 200, { ok: true, days });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/client\/lookup$/);
  if (m && req.method === 'POST') {
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(resolved.salon);
    if (!isValidCpf(body.cpf)) return json(res, 400, { ok: false, error: 'Informe um CPF válido' });
    const cpf = digitsCpf(body.cpf);
    let L = getLedger(s, cpf);
    if (!L) {
      const past = (s.appointments || []).find(a => digitsCpf(a.client && a.client.cpf) === cpf);
      if (past) L = ensureLedger(s, past.client);
    }
    if (!L) return json(res, 200, { ok: true, found: false, firstVisit: true, birthdate: '' });
    const charge = quoteClientCharge(s, cpf, body.serviceId, resolveAddons(s, body.serviceId, body.addonIds));
    return json(res, 200, {
      ok: true, found: true, firstVisit: false,
      name: L.name || '', phone: L.phone || '',
      birthdate: findClientBirthdate(s, cpf, L.name),
      noShowCount: (L.noShows || []).length,
      openNoShow: !!openNoShow(L, s),
      lastNoShowNote: (openNoShow(L, s) || {}).note || '',
      unusedWaiver: !!unusedWaiver(L),
      charge: publicChargeView(charge),
      packs: (packRefreshExpired(s) && writeSalon(s), packForClient(s, cpf, (L.phone || '')).map(pk => { const pv = packView(s, pk); pv.covers = (pv.services || []).includes(body.serviceId); return pv; }))
    });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/bookings$/);
  if (m && req.method === 'POST') {
    /* 25 marcações por 10 min por IP: folga para o Wi-Fi do salão, trava para script. */
    if (tooMany(req, 'book', 25, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' });
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(resolved.salon);
    if (s.status === 'suspenso') return json(res, 403, { ok: false, error: 'Salão suspenso' });
    const { serviceId, date, time, proId, notes } = body;
    if (!serviceId || !date || !time) return json(res, 400, { ok: false, error: 'Dados incompletos' });
    if (!isValidCpf(body.cpf)) return json(res, 400, { ok: false, error: 'Informe um CPF válido' });
    const cpf = digitsCpf(body.cpf);
    const existing = getLedger(s, cpf);
    const name = String(body.name || (existing && existing.name) || '').trim();
    const phone = String(body.phone || (existing && existing.phone) || '').trim();
    if (!existing) {
      if (name.length < 2) return json(res, 400, { ok: false, error: 'No primeiro agendamento, informe seu nome' });
      if (phoneDigits(phone).length < 10) return json(res, 400, { ok: false, error: 'No primeiro agendamento, informe um WhatsApp com DDD' });
      if (!cleanBirthdate(body.birthdate)) return json(res, 400, { ok: false, error: 'No primeiro agendamento, informe sua data de nascimento' });
    } else if (name.length < 2) {
      return json(res, 400, { ok: false, error: 'Informe seu nome' });
    }
    const birthdate = cleanBirthdate(body.birthdate) || findClientBirthdate(s, cpf, name);
    const chosenAddons = resolveAddons(s, serviceId, body.addonIds);
    const extraDur = addonsExtra(chosenAddons).dur;
    const extraPrice = addonsExtra(chosenAddons).price;
    let packPre = null;
    if (body.packId) {
      packPre = packForClient(s, cpf, phone).find(x => x.id === String(body.packId));
      if (!packPre || !packLive(s, packPre, serviceId)) return json(res, 400, { ok: false, error: 'Seu plano não está valendo para este serviço agora. Renove com o espaço ou marque pagando normalmente.' });
      const sessPre = (packPre.sessions && packPre.sessions.length) ? packPre.sessions : [];
      if (sessPre.length) {
        if (!sessPre.some(x => x.date === date && x.time === time)) return json(res, 400, { ok: false, error: 'Este plano tem dias marcados pelo espaço — escolha uma das datas de aula dele. 💛' });
        if ((packPre.sessionsUsed || []).some(u => u.date === date && u.time === time)) return json(res, 400, { ok: false, error: 'Você já garantiu esta aula — escolha outra data do seu plano.' });
      }
    }
    const freeSlots = slotsForChoice(s, serviceId, date, proId, '', extraDur).filter(x => x.time === time && x.free);
    if (!freeSlots.length) return json(res, 409, { ok: false, error: packPre && (packPre.sessions||[]).length ? 'Nesta aula já tem gente sentada — escolha outra data do seu plano.' : 'Horário ocupado' });
    const assigned = proId && proId !== 'any' ? proId : (assignPro(s, serviceId, date, time, null, extraDur) || { id: null }).id;
    if (!assigned) return json(res, 409, { ok: false, error: 'Horário ocupado' });
    const client = { name, phone, cpf, birthdate };
    const charge = quoteClientCharge(s, cpf, serviceId, chosenAddons);
    let packChosen = packPre;
    if (packChosen) {
      charge.required = false; charge.reason = 'plan'; charge.amount = 0;
      charge.label = 'Pago com plano ' + (packChosen.planName || 'do espaço');
      if ((packChosen.sessions || []).length) packChosen.sessionsUsed = (packChosen.sessionsUsed || []).concat([{ date, time, at: new Date().toISOString() }]);
    }
    /* Crédito de indicação da própria cliente (indicadora) abate nesta visita.
       Se há sinal/depósito, abate dele; senão abate do VALOR DO SERVIÇO (funciona
       mesmo em salões que não cobram sinal). Considera só crédito não expirado. */
    let usedCredit = 0;
    if (existing) {
      const me = findRefByClient(s, client);
      const fullPrice = effPrice(s.services.find(x => x.id === serviceId) || {}) + extraPrice;
      if (me && refAvailableTotal(me, s) > 0) {
        const maxAble = (charge.required && charge.amount > 0) ? charge.amount : fullPrice;
        usedCredit = Math.min(refAvailableTotal(me, s), maxAble);
        if (usedCredit > 0) {
          refConsumeCredit(me, usedCredit, s);
          const L = ensureLedger(s, client);
          if (L) pushLedgerEvent(L, 'credito_uso', 'Usou R$ ' + usedCredit + ' de crédito de indicação nesta visita', { appointmentId: null });
        }
      }
    }
    const status = charge.payBeforeConfirm && charge.required ? 'pending_payment' : 'confirmed';
    /* Indicação cliente → cliente: no PRIMEIRO agendamento, se veio um código,
       vincula a indicadora (só se ela for cliente estabelecida — trava anti-fraude). */
    let referralCode = '';
    let referralHint = '';
    let welcomePct = 0;
    if (clientRefCfgFor(s).enabled && !existing) {
      const rawRef = String(body.refCode || body.referralCode || '').toLowerCase().trim();
      if (rawRef) {
        const referrer = findRefByCode(s, rawRef);
        if (!referrer) referralHint = 'codigo-invalido';
        else if (referrer.cpf && referrer.cpf === cpf) referralHint = 'auto-indicacao';
        else if (!refIsEstablished(s, referrer)) referralHint = 'indicador-nao-elegivel';
        else { referralCode = referrer.code; referralHint = 'ok'; welcomePct = clientRefCfgFor(s).welcomePercent || 0; }
      }
    }
    const appt = {
      id: 'a' + Date.now() + uid(), serviceId, professionalId: assigned, date, time, client,
      status, notes: String(notes || '').trim(), createdAt: Date.now(),
      manageToken: crypto.randomBytes(8).toString('hex'), rescheduleCount: 0,
      charge: publicChargeView(charge), referralCode: referralCode || undefined,
      referralCreditUsed: usedCredit || undefined,
      addons: chosenAddons.length ? chosenAddons : undefined,
      dur: durOf(s, serviceId) + extraDur
    };
    /* Desconto de boas-vindas para a indicada (cliente nova que veio por código). */
    if (welcomePct > 0 && referralCode && !existing) {
      const fullPrice = effPrice(s.services.find(x => x.id === serviceId) || {}) + extraPrice;
      const welcomeDisc = Math.round(fullPrice * welcomePct / 100);
      if (welcomeDisc > 0) {
        appt.welcomePct = welcomePct;
        appt.welcomeDiscount = welcomeDisc;
        if (charge.required && charge.amount > 0) {
          charge.amount = Math.max(0, charge.amount - welcomeDisc);
          appt.charge = publicChargeView(charge);
        }
        const Lw = ensureLedger(s, client);
        if (Lw) pushLedgerEvent(Lw, 'boasvindas', 'Desconto de boas-vindas de ' + welcomePct + '% (R$ ' + welcomeDisc + ') por ter vindo por indicação', { appointmentId: appt.id });
      }
    }
    if (usedCredit > 0 && charge.required && charge.amount > 0) {
      charge.amount = Math.max(0, charge.amount - usedCredit);
      appt.charge = publicChargeView(charge);
    }
    const L = ensureLedger(s, client);
    if (charge.reason === 'waived' && L) {
      const w = unusedWaiver(L);
      if (w) {
        w.used = true; w.usedAt = new Date().toISOString(); w.appointmentId = appt.id;
        appt.chargeWaived = { waiverId: w.id, reason: w.reason, at: w.usedAt };
        pushLedgerEvent(L, 'dispensa_usada', 'Cobrança dispensada usada neste agendamento', { appointmentId: appt.id, reason: w.reason });
      }
      const open = openNoShow(L);
      if (open) open.settledBy = 'waiver:' + (w && w.id || '');
    } else if (charge.reason === 'penalty' && L) {
      const open = openNoShow(L);
      if (open) open.settledBy = appt.id;
      pushLedgerEvent(L, 'cobranca', 'Cobrança de ' + (charge.percent || 25) + '% no novo horário após falta', { appointmentId: appt.id, amount: charge.amount });
    }
    if (L) {
      if (!existing) pushLedgerEvent(L, 'cadastro', 'Primeiro agendamento — CPF cadastrado');
      if (referralCode && !L.refRewarded) L.referredBy = referralCode;
      pushLedgerEvent(L, 'agendamento', 'Agendou ' + ((s.services.find(x => x.id === serviceId) || {}).name || 'serviço') + ' em ' + date + ' às ' + time, { appointmentId: appt.id, status });
    }
    s.appointments.push(appt);
    if (packChosen) packUse(s, appt, packChosen);
    upsertClientProfile(s, client);
    if (appt.notes) rememberServiceNote(s, client, serviceId, appt.notes);
    if (charge.required && charge.amount > 0) {
      appt.payment = await createPixPayment(s, appt, charge.amount, resolved.slug);
      recordDeposit(s, appt);
      sendClientPaymentPix(s, appt);
      /* Houve espera (pagamento) no meio: se outra cliente marcou neste horário
         enquanto isso, desfaz a nossa e pede para escolher outra vaga. */
      try {
        const minsOf = t => { const mm = String(t || '').match(/^(\d{1,2}):(\d{2})/); return mm ? (+mm[1]) * 60 + (+mm[2]) : -1; };
        const fresh = readSalon(s.slug);
        const aS = minsOf(time), aE = aS + (+appt.dur || 30);
        const clash = fresh && (fresh.appointments || []).some(o => o && o.id !== appt.id && o.date === date && o.status !== 'canceled' &&
          !(appt.professionalId && o.professionalId && o.professionalId !== appt.professionalId) &&
          minsOf(o.time) < aE && minsOf(o.time) + (+o.dur || 30) > aS);
        if (clash) {
          s.appointments = (s.appointments || []).filter(o => o.id !== appt.id);
          try { writeSalon(s); } catch (e) {}
          return json(res, 409, { ok: false, error: 'Ops — essa vaga acabou de ser preenchida agora. Escolha outro horário, por favor.' });
        }
      } catch (e) { /* conferência é reforço; falhou, segue o fluxo normal */ }
    }
    if (status === 'confirmed') {
      appt.confirmedNotified = true;
      notifyNewBooking(s, appt);
      notifyClientBooking(s, appt);
      /* Recompensa a indicadora quando a indicada confirma o 1º horário. */
      if (referralCode && !existing) rewardClientReferral(s, appt);
    } else {
      const n = pushNotif(s, 'aviso', client.name + ' reservou horário — aguardando pagamento de ' + fmtBRL(charge.amount || 0) + ' para confirmar');
      sseSend(s.slug, n);
      notifyClientBooking(s, appt);
      writeSalon(s);
    }
    return json(res, 201, { ok: true, appointment: appt, charge: publicChargeView(charge), firstVisit: !existing, payment: appt.payment || null, referralHint: referralHint || null, netPrice: appointmentPrice(s, appt), packLeft: packChosen ? packChosen.usesLeft : null });
  }

  /* ---- gerenciamento do agendamento pela cliente (link com token) ---- */
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/bookings\/([\w-]+)\/manage$/);
  if (m && req.method === 'GET') {
    const __rs = readSalonResolved(m[1]); if (!__rs) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(__rs.salon);
    const a = s.appointments.find(x => x.id === m[2]);
    if (!a || a.manageToken !== q.get('token')) return json(res, 403, { ok: false, error: 'Link inválido' });
    const svcData = s.services.find(x => x.id === a.serviceId) || {};
    const proData = s.pros.find(x => x.id === a.professionalId) || {};
    const payInfo = a.payment ? { status: a.payment.status, amount: a.payment.amount } : null;
    const policy = reschedulePolicy(s, a);
    return json(res, 200, { ok: true, appointment: { id: a.id, serviceId: a.serviceId, professionalId: a.professionalId, service: svcData.name, serviceEmoji: svcData.emoji, pro: proData.name, proEmoji: proData.emoji, date: a.date, time: a.time, price: effPrice(svcData), client: a.client.name, status: a.status, payment: payInfo, rescheduleCount: a.rescheduleCount || 0, canReschedule: policy.ok, rescheduleFree: !!policy.free, rescheduleReason: policy.reason || null } });
  }
  if (m && req.method === 'POST') {
    const __rs = readSalonResolved(m[1]); if (!__rs) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(__rs.salon);
    const a = s.appointments.find(x => x.id === m[2]);
    if (!a || a.manageToken !== body.token) return json(res, 403, { ok: false, error: 'Link inválido' });
    if (a.status === 'canceled') return json(res, 200, { ok: true, already: true });
    a.status = 'canceled';
    packUndo(s, a, 'cancel');
    notifyCancel(s, a);
    return json(res, 200, { ok: true, canceled: true });
  }

  /* ---- reagendamento pela cliente (1x grátis após pagar o sinal) ---- */
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/bookings\/([\w-]+)\/reschedule$/);
  if (m && req.method === 'POST') {
    const __rs = readSalonResolved(m[1]); if (!__rs) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(__rs.salon);
    const a = s.appointments.find(x => x.id === m[2]);
    if (!a || a.manageToken !== body.token) return json(res, 403, { ok: false, error: 'Link inválido' });
    const policy = reschedulePolicy(s, a);
    if (!policy.ok) return json(res, 400, { ok: false, error: policy.reason });
    const date = String(body.date || '');
    const time = String(body.time || '');
    const proId = body.proId || a.professionalId;
    if (!date || !time) return json(res, 400, { ok: false, error: 'Escolha a nova data e o horário' });
    if (date === a.date && time === a.time && (!proId || proId === a.professionalId || proId === 'any'))
      return json(res, 400, { ok: false, error: 'Escolha um horário diferente do atual' });
    const extraDur = Math.max(0, apptDur(s, a) - durOf(s, a.serviceId));
    const freeSlots = slotsForChoice(s, a.serviceId, date, proId, a.id, extraDur).filter(x => x.time === time && x.free);
    if (!freeSlots.length) return json(res, 409, { ok: false, error: 'Horário ocupado' });
    const assigned = proId && proId !== 'any' ? proId : (assignPro(s, a.serviceId, date, time, a.id, extraDur) || { id: null }).id;
    if (!assigned) return json(res, 409, { ok: false, error: 'Horário ocupado' });
    const oldPro = s.pros.find(x => x.id === a.professionalId);
    const oldDate = a.date, oldTime = a.time;
    a.date = date;
    a.time = time;
    a.professionalId = assigned;
    if (policy.consume) a.rescheduleCount = (a.rescheduleCount || 0) + 1;
    a.rescheduledAt = new Date().toISOString();
    const L = a.client && a.client.cpf ? ensureLedger(s, a.client) : null;
    if (L) {
      L.reschedules = L.reschedules || [];
      L.reschedules.unshift({ appointmentId: a.id, at: a.rescheduledAt, from: oldDate + ' ' + oldTime, to: date + ' ' + time, free: !!policy.consume });
      pushLedgerEvent(L, 'reagendamento', policy.consume ? 'Reagendamento grátis utilizado' : 'Horário reagendado', { appointmentId: a.id });
    }
    notifyReschedule(s, a, oldDate, oldTime, oldPro && oldPro.phone);
    return json(res, 200, { ok: true, appointment: a, rescheduleCount: a.rescheduleCount || 0 });
  }

  /* ---- pagamento do agendamento pela cliente (Pix) ---- */
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/bookings\/([\w-]+)\/payment$/);
  if (m && req.method === 'POST') {
    const __rs = readSalonResolved(m[1]); if (!__rs) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(__rs.salon);
    const a = s.appointments.find(x => x.id === m[2]);
    if (!a || a.manageToken !== body.token) return json(res, 403, { ok: false, error: 'Link inválido' });
    if (a.payment && (a.payment.status === 'pago' || a.payment.status === 'aguardando')) return json(res, 200, { ok: true, payment: a.payment });
    const payCfg = cleanPayOnBooking(s.cfg && s.cfg.payOnBooking);
    if (!payCfg.enabled) return json(res, 200, { ok: true, payment: null, note: 'Pagamento na confirmação desativado' });
    const amount = calcDepositAmount(s, a);
    const pixKey = salonChargePixKey(s, __rs.slug);
    const payment = { status: 'pendente', amount, type: 'manual', pixKey, createdAt: new Date().toISOString() };
    if (amount > 0 && !pixKey) payment.error = 'O salão ainda não cadastrou uma chave Pix para receber o sinal.';
    a.payment = payment;
    writeSalon(s);
    return json(res, 200, { ok: true, payment });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/bookings\/([\w-]+)\/payment\/confirm$/);
  if (m && req.method === 'POST') {
    const __rs = readSalonResolved(m[1]); if (!__rs) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(__rs.salon);
    const a = s.appointments.find(x => x.id === m[2]);
    if (!a || a.manageToken !== body.token) return json(res, 403, { ok: false, error: 'Link inválido' });
    if (a.payment && a.payment.status === 'pendente') {
      a.payment.status = 'aguardando';
      a.payment.confirmedByClientAt = new Date().toISOString();
      recordDeposit(s, a);
      maybeConfirmPending(s, a);
      writeSalon(s);
      return json(res, 200, { ok: true, payment: a.payment, appointmentStatus: a.status });
    }
    return json(res, 200, { ok: true, payment: a.payment || null, appointmentStatus: a.status });
  }

  /* ---- webhook Mercado Pago (pagamento aprovado) ---- */
  /* ---- webhook do bot de WhatsApp (Z-API ou Zapster) ---- */
  if (p === '/api/bot/webhook' && req.method === 'GET') {
    const gm = ((db.gateway || {}).meta) || {};
    const mode = q.get('hub.mode'); const vt = q.get('hub.verify_token'); const chal = q.get('hub.challenge');
    if (mode === 'subscribe' && gm.verifyToken && String(vt) === String(gm.verifyToken)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(String(chal || ''));
    }
    return json(res, 403, { ok: false, error: 'Token de verificação inválido — confira em Configurações → WhatsApp oficial (Meta).' });
  }
  if (p === '/api/bot/webhook' && req.method === 'POST' && body && body.object === 'whatsapp_business_account') {
    if (tooMany(req, 'wawebhook', 600, 60 * 1000)) return json(res, 200, { ok: true, ignored: 'rate-limit' });
    return handleMetaWebhook(body, req, res);
  }
  if (p === '/api/bot/webhook' && req.method === 'POST') {
    if (tooMany(req, 'wawebhook', 600, 60 * 1000)) return json(res, 200, { ok: true, ignored: 'rate-limit' });
    /* Nunca responda mensagens enviadas pelo próprio bot/usuário. Sem este filtro,
       o gateway pode reenviar a mensagem de saída ao webhook e o bot entra em loop. */
    const msgObj = body.data && body.data.message;
    const fromMe = body.fromMe === true || body.from_me === true || body.isFromMe === true ||
      (msgObj && (msgObj.fromMe === true || msgObj.from_me === true || msgObj.isFromMe === true)) ||
      (body.data && (body.data.fromMe === true || body.data.from_me === true || body.data.isFromMe === true));
    if (fromMe) {
      pushBotLog({ ignored: 'fromMe', inst: pickWhatsInst(body, req) });
      return json(res, 200, { ok: true, ignored: 'fromMe' });
    }
    const eventType = String(body.type || body.event || body.eventType || '').toLowerCase();
    const gw = db.gateway || {};
    let inst = pickWhatsInst(body, req) || platformInstanceId();
    if (eventType === 'instance.connected') {
      const phone = pickWhatsConnectedPhone(body) || ((body.data && (body.data.phone_number || body.data.id)) || '');
      const salon = findSalonByBotInstance(inst);
      if (salon && phone) {
        salon.cfg = salon.cfg || {};
        salon.cfg.botPhone = clipText(phone, 30);
        if (!salon.cfg.contactPhone) salon.cfg.contactPhone = clipText(phone, 30);
        try { writeSalon(salon); } catch (e) {}
      }
      zapsterEnsureWebhook(inst).catch(function () {});
      pushBotLog({ type: 'instance.connected', inst: inst, from: phone, salon: salon && salon.slug, ignored: null });
      return json(res, 200, { ok: true, connected: true, salon: salon && salon.slug });
    }
    if (['message.sent','message.ack','message.status','message.delivered','message.read','status','delivery','read','message.reaction','reaction','instance.qrcode','instance.disconnected'].includes(eventType)) return json(res,200,{ok:true,ignored:'non-inbound-event'});
    if (isGroupWhatsEvent(body)) {
      pushBotLog({ ignored: 'group', inst: inst, type: eventType });
      return json(res, 200, { ok: true, ignored: 'group' });
    }
    const eventId = body.id || body.messageId || body.message_id || (body.data && (body.data.id || body.data.messageId));
    if (isDuplicateBotEvent(eventId)) return json(res,200,{ok:true,ignored:'duplicate'});
    const from = pickWhatsFrom(body);
    const replyTo = pickWhatsReplyTo(body) || from;
    let rawMsg = pickWhatsText(body);
    const connectedPhone = pickWhatsConnectedPhone(body);
    const isZapster = body.type === 'message.received' || !!(body.data && (body.data.sender || body.data.content));
    const zap = gw.zapster || {};
    const zapi = gw.zapi || null;
    const msgKind = pickWhatsMsgKind(body);
    if (!rawMsg && from && ['audio','image','sticker','video','ptt','voice','document','location'].includes(msgKind)) {
      /* Mídia sem legenda NÃO é pedido de atendimento. Antes isso virava "oi" e
         o bot respondia o catálogo para qualquer contato — inclusive os pessoais. */
      pushBotLog({ ignored: 'midia-sem-texto', inst: inst, from: from, type: eventType, kind: msgKind });
      return json(res, 200, { ok: true, ignored: 'midia-sem-texto' });
    }

    if (!from || !rawMsg) {
      pushBotLog({ ignored: 'sem-texto-ou-remetente', inst: inst, from: from, text: rawMsg, type: eventType, kind: msgKind });
      return json(res, 200, { ok:true, note:'Evento sem texto ou remetente', inst: inst || null });
    }

    /* Z-API ReceivedCallback e similares: já extraímos from/text acima. */
    const inboundOk = isZapster || !eventType || ['message.received','received','message_received','inbound','receivedcallback'].includes(eventType);
    if (!inboundOk) return json(res, 200, { ok:true, ignored:'not-inbound', type: eventType });

    const routed = await routeWhatsBot(inst, from, rawMsg, gw, connectedPhone);
    if (!routed.reply) {
      pushBotLog({ ignored: routed.ignored || 'no-reply', inst: inst, from: from, text: rawMsg, salon: routed.salon && routed.salon.slug, channel: routed.channel, role: routed.role });
      return json(res, 200, {
        ok:true, ignored: routed.ignored || 'no-reply',
        provider: isZapster ? 'zapster' : 'zapi',
        channel: routed.channel, role: routed.role,
        salon: routed.salon ? routed.salon.slug : null,
        inst: inst || null
      });
    }
    if (isZapster || (zap.token && zap.baseUrl)) {
      /* Responde PELA instância que recebeu a mensagem: se a cliente escreveu no
         número do salão, a resposta sai do número do salão (não do da plataforma). */
      const sendInst = inst || platformInstanceId() || zap.instance;
      const sent = await zapsterSend(zap, replyTo || from, routed.reply, sendInst);
      const sendOk = !!(sent && !sent.error && (sent.message_id || sent.id || sent.ok !== false));
      pushBotLog({ ignored: null, inst: inst, from: from, text: rawMsg, reply: routed.reply, salon: routed.salon && routed.salon.slug, channel: routed.channel, sendOk: sendOk, sendErr: sendOk ? null : zapsterErr(sent) });
      return json(res, 200, { ok:true, replied:true, sent: sendOk, provider:'zapster', salon: routed.salon ? routed.salon.slug : 'plataforma', channel: routed.channel, role: routed.role });
    }
    if (zapi && zapi.baseUrl && zapi.token) {
      zapiSend(zapi, from, routed.reply, inst || zapi.instance).catch(()=>{});
      pushBotLog({ ignored: null, inst: inst, from: from, text: rawMsg, reply: routed.reply, salon: routed.salon && routed.salon.slug, channel: routed.channel, sendOk: true });
      return json(res, 200, { ok:true, replied:true, provider:'zapi', salon: routed.salon ? routed.salon.slug : 'plataforma', channel: routed.channel, role: routed.role });
    }
    pushBotLog({ ignored: 'gateway-nao-configurado', inst: inst, from: from, text: rawMsg });
    return json(res, 200, { ok:true, note:'Bot respondeu em memória mas gateway não está configurado para envio' });
  }

  /* rota de teste do bot — só pelo painel (antes era aberta: qualquer um fazia o
     bot trabalhar e queimava os créditos de IA configurados). */
  if (p === '/api/bot/test' && req.method === 'POST') {
    if (!tokenAuth(req, 'admin')) return json(res, 401, { ok: false, error: 'Entre no painel para testar o bot.' });
    const gw = db.gateway || {};
    const from = String(body.from || '').replace(/\D/g,'');
    if (body.platform || body.channel === 'platform' || body.concierge) {
      const inst = String(body.inst || (gw.zapster && gw.zapster.instance) || (gw.zapi && gw.zapi.instance) || '').trim();
      if (body.reset) clearClientSalon(from);
      const routed = await routeWhatsBot(inst, from, body.message || '', gw, body.connectedPhone || '');
      return json(res, 200, {
        ok: true, reply: routed.reply, channel: routed.channel, role: routed.role,
        salon: routed.salon && routed.salon.slug, ignored: routed.ignored || null,
        concierge: conciergeOn(), lembrar: getClientSalon(from) || null
      });
    }
    const slug = body.slug || '';
    const s = slug ? readSalon(slug) : null;
    let reply = buildBotReply(s, from, body.message || '', { audience: 'client' });
    if (!reply) reply = await maybeAiReply(s, body.message || '', botVoice(s, from));
    return json(res, 200, { ok: true, reply, channel: 'salon', role: 'client' });
  }

  if (p === '/api/webhooks/mercadopago' && req.method === 'POST') {
    /* AVISO NÃO BASTA: ninguém marca pagamento como "pago" por aqui sem a gente
       confirmar o id na API do Mercado Pago (antes, qualquer POST resolvido
       marcava o sinal da cliente como quitado). */
    const data = body.data || {};
    const mpId = data.id || body.id;
    const tok = mpToken();
    if (!mpId) return json(res, 200, { ok: true, ignored: 'sem-id' });
    if (!tok) return json(res, 200, { ok: true, ignored: 'sem-token-mp' });
    const pay = await mpFetchPayment(mpId);
    if (!pay || pay.status !== 'approved') return json(res, 200, { ok: true, ignored: 'não-aprovado' });
    /* 1) assinatura do espaço em aberto */
    for (const x of db.salons) {
      const lc = x.lastCharge;
      if (lc && lc.mpId && String(lc.mpId) === String(pay.id)) {
        if (!mpAmountOk(pay, lc.amount)) return json(res, 200, { ok: true, ignored: 'valor-diferente' });
        const out = settlePlanPayment(x, pay, lc.amount);
        return json(res, 200, { ok: true, settled: 'assinatura', salon: out.slug, nextDue: out.nextDue });
      }
    }
    /* 2) sinal do agendamento */
    for (const x of db.salons) {
      const sal = readSalon(x.slug);
      if (!sal) continue;
      const a = sal.appointments.find(ap => ap.payment && String(ap.payment.mpId) === String(pay.id));
      if (a) {
        if (!mpAmountOk(pay, a.payment.amount)) return json(res, 200, { ok: true, ignored: 'valor-diferente' });
        a.payment.status = 'pago';
        a.payment.paidAt = new Date().toISOString();
        a.payment.webhook = true;
        recordDeposit(sal, a);
        maybeConfirmPending(sal, a);
        writeSalon(sal);
        return json(res, 200, { ok: true, settled: 'sinal', salon: x.slug });
      }
    }
    return json(res, 200, { ok: true, settled: null });
  }

  /* ---- autocadastro de teste grátis (15 dias) ---- */
  if (p === '/api/public/lead' && req.method === 'POST') {
    if (tooMany(req, 'lead', 30, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: 'Calma aí — tente de novo daqui a pouco.' });
    const r = recordLead({
      phone: body.phone || body.whatsapp || '',
      name: body.name || '',
      niche: body.niche || '',
      note: body.note || body.message || '',
      source: 'landing',
      status: 'novo'
    });
    return json(res, 200, { ok: r.pushed, lead: r.lead, reason: r.reason || null });
  }
  if (p === '/api/public/trial' && req.method === 'POST') {
    if (tooMany(req, 'trial', 40, 60 * 60 * 1000)) return json(res, 429, { ok: false, error: 'Muitas contas criadas deste mesmo celular. Aguarde 1 hora.' });
    const name = String(body.name || '').trim();
    const owner = String(body.owner || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const nicho = cleanNiche(body.nicho);
    if (name.length < 2 || owner.length < 2 || email.length < 5 || password.length < PW_MIN)
      return json(res, 400, { ok: false, error: 'Preencha todos os campos (senha mín. ' + PW_MIN + ' caracteres)' });
    const accepted = body.acceptedTerms === true || body.acceptedTerms === 'true' || body.aceite === true;
    if (!accepted)
      return json(res, 400, { ok: false, error: 'Para criar o teste, aceite os Termos de uso.' });
    const phoneRaw = String(body.phone || body.whatsapp || '').trim();
    const phoneD = phoneDigits(phoneRaw);
    if (phoneD.length < 10)
      return json(res, 400, { ok: false, error: 'Informe um WhatsApp com DDD para receber o acesso e o passo a passo.' });
    if (db.salons.some(x => x.email.toLowerCase() === email))
      return json(res, 400, { ok: false, error: 'Este e-mail já está cadastrado. Faça login na área do salão.' });
    let slug = slugify(name);
    if (readSalon(slug)) slug = slug + '-' + Math.floor(Math.random() * 900 + 100);
    const s = makeSalon({ slug, name, owner, email, password, plan: 'Pro', status: 'teste', nicho, pros: [{ id: 'pro1', name: owner, role: 'Proprietária', emoji: '💄', color: '#F7C6D4', cats: ['unhas', 'cabelo', 'sobrancelha', 'maquiagem', 'estetica'] }] });
    applyTrialTemplate(s, nicho);
    const trialDays = (db.gateway && db.gateway.trialDays) || 15;
    const trialEnd = addDays(brazilTodayStr(), Math.max(1, Math.min(90, trialDays)));
    s.trialEnd = trialEnd;
    s.cfg.notifyPhone = phoneRaw;
    s.cfg.contactPhone = phoneRaw;
    s.termsAcceptedAt = new Date().toISOString();
    s.termsVersion = '2026-09-04';
    const wantedCode = String(body.discountCode || body.promoCode || body.chave || '').trim();
    if (wantedCode) {
      const probe = findDiscountKey(wantedCode);
      if (!probe) return json(res, 400, { ok: false, error: 'Chave de desconto inválida ou desativada' });
      if (probe.maxUses > 0 && (probe.uses || 0) >= probe.maxUses) return json(res, 400, { ok: false, error: 'Esta chave já esgotou' });
    }
    writeSalon(s);
    /* indicação: se veio um código válido, guarda quem indicou */
    const referredBy = (body.referral || body.referralCode || '') ? ((referralCodeOf(resolveReferrer(body.referral || body.referralCode))) || '') : '';
    const metaRow = { slug, name: s.name, owner: s.owner, email: s.email, plan: s.plan, status: 'teste', createdAt: new Date().toISOString(), lastActive: Date.now(), nextDue: null, payments: [], trialEnd, referredBy: referredBy || undefined, referralRewardApplied: false };
    if (wantedCode) applyDiscountCodeToSalon(metaRow, wantedCode);
    db.salons.push(metaRow);
    saveDB();
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = req.headers['host'] || 'localhost';
    const base = proto + '://' + host;
    const tk = uid();
    db.tokens[tk] = { role: 'salon', salon: slug, exp: Date.now() + 30 * 864e5 };
    saveDB();
    const salonUrl = base + '/app?slug=' + slug;
    const guiaUrl = base + '/guia';
    notifyNewSalonOwner(s, { phone: phoneRaw, salonUrl, guiaUrl, email: s.email, trialEnd });
    return json(res, 201, { ok: true, slug, email: s.email, password, trialEnd, token: tk, salonUrl, trialUrl: base + '/trial?nicho=' + encodeURIComponent(nicho), nicho, discount: metaRow.discountCode ? { code: metaRow.discountCode, percent: metaRow.discountPercent, times: metaRow.discountTimesTotal } : null });
  }
  if (p === '/api/public/trial/status' && req.method === 'GET') {
    const s = readSalon(q.get('slug') || '');
    if (!s) return json(res, 404, { ok: false });
    const metaRow = db.salons.find(x => x.slug === s.slug) || {};
    return json(res, 200, { ok: true, status: s.status, trialEnd: metaRow.trialEnd || null, plan: s.plan });
  }
  if (p === '/api/public/discount-code' && req.method === 'GET') {
    const k = findDiscountKey(q.get('code') || '');
    if (!k) return json(res, 404, { ok: false, error: 'Chave inválida ou desativada' });
    if (k.maxUses > 0 && (k.uses || 0) >= k.maxUses) return json(res, 400, { ok: false, error: 'Esta chave já esgotou' });
    return json(res, 200, { ok: true, code: k.code, percent: k.percent, times: k.times });
  }

  /* ---- eventos em tempo real (SSE) — som de novo agendamento ---- */
  if (p === '/api/salon/events' && req.method === 'GET') {
    const tk = q.get('token') || String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const t = db.tokens[tk];
    if (!t || t.salon === undefined) return json(res, 401, { ok: false, error: 'Não autenticado' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(':ok\n\n');
    const slug = t.salon;
    (sseClients[slug] = sseClients[slug] || new Set()).add(res);
    const close = () => { const s = sseClients[slug]; if (s) s.delete(res); };
    req.on('close', close);
    res.on('close', close);
    return;
  }

  /* ---- autenticado: salão / admin (gate de 401) ---- */
  if (p === '/api/salon' || p.startsWith('/api/salon/') || p === '/api/admin/dashboard' || p.startsWith('/api/admin/')) {
    const need = p.startsWith('/api/admin') ? 'admin' : 'salon';
    if (!tokenAuth(req, need)) return json(res, 401, { ok: false, error: 'Não autenticado' });
  }

  /* ---- autenticado: salão ---- */
  const t = tokenAuth(req, 'salon');
  const isPro = !!(t && t.proId);

  if (p === '/api/salon/billing/pay' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Só a dona do salão paga a assinatura.' });
    const xb = meta(t.salon); const sb = readSalon(t.salon);
    if (!xb || !sb) return json(res, 404, { ok: false });
    if (xb.status === 'teste') return json(res, 400, { ok: false, error: 'Você está no teste grátis — nada a pagar ainda. A cobrança começa ao ativar um plano.' });
    if (!(db.gateway && db.gateway.mercadopagoToken)) return json(res, 400, { ok: false, error: 'O Pix automático ainda não foi conectado pela administração do BoraAgendar — chame o suporte.' });
    const fresh = xb.lastCharge && xb.lastCharge.qrCode && xb.lastCharge.status === 'pending' && (Date.now() - new Date(xb.lastCharge.createdAt).getTime() < 26 * 3600e3);
    if (fresh) return json(res, 200, { ok: true, reused: true, amount: xb.lastCharge.amount, qrCode: xb.lastCharge.qrCode, nextDue: xb.nextDue || null });
    const r = await createPlanPixCharge(xb, 'owner');
    if (!r.ok) return json(res, 400, { ok: false, error: r.error });
    saveDB();
    return json(res, 200, { ok: true, amount: r.charge.amount, qrCode: r.charge.qrCode, nextDue: xb.nextDue || null });
  }
  if (p === '/api/salon/discount-code' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const x = db.salons.find(v => v.slug === t.salon);
    if (!x) return json(res, 404, { ok: false });
    if (x.status !== 'teste') return json(res, 400, { ok: false, error: 'A chave de desconto só pode ser aplicada no período de teste' });
    const red = applyDiscountCodeToSalon(x, body.code || body.discountCode || '');
    if (!red.ok) return json(res, 400, { ok: false, error: red.error });
    saveDB();
    return json(res, 200, { ok: true, billing: billingPublic(x) });
  }
  if (p === '/api/salon' && req.method === 'GET' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    touch(s.slug);
    if (t.proId) {
      const proObj = s.pros.find(x => x.id === t.proId);
      if (!proObj) return json(res, 403, { ok: false, error: 'Profissional não encontrada' });
      return json(res, 200, {
        ok: true, isPro: true, proId: t.proId,
        salon: { slug: s.slug, name: s.name, plan: s.plan, status: s.status },
        cfg: cfgDefaults(s.cfg),
        pros: [proSafe(proObj)],
        services: s.services,
        availability: { schedule: { [t.proId]: (s.availability.schedule[t.proId] || {}) }, offDays: { [t.proId]: (s.availability.offDays[t.proId] || []) } },
        appointments: s.appointments.filter(a => a.professionalId === t.proId),
        clientServiceNotes: s.clientServiceNotes || {},
        billing: billingPublic(meta(s.slug)),
        brand: platformBrandInfo()
      });
    }
    return json(res, 200, { ok: true, isPro: false, salon: { slug: s.slug, name: s.name, owner: s.owner, email: s.email, plan: s.plan, status: s.status, pixKey: (meta(s.slug) || {}).pixKey || '', passwordChanged: !!s.passwordChangedAt }, cfg: cfgDefaults(s.cfg), pros: s.pros, services: s.services, availability: s.availability, appointments: s.appointments, clientServiceNotes: s.clientServiceNotes || {}, billing: billingPublic(meta(s.slug)), notifications: (s.notifications || []).slice(0, 20), brand: platformBrandInfo() });
  }
  if (p === '/api/salon/notifications/read' && req.method === 'POST' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    (s.notifications || []).forEach(n => { n.read = true; });
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/salon/clients' && req.method === 'GET' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    return json(res, 200, { ok: true, clients: aggregateClients(s) });
  }
  if (p === '/api/salon/clients' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const key = normKey(body.key);
    if (!key) return json(res, 400, { ok: false, error: 'Cliente inválido' });
    s.clientNotes = s.clientNotes || {};
    s.clientNotes[key] = String(body.notes || '').slice(0, 500);
    if (body.serviceNotes && typeof body.serviceNotes === 'object') applyClientServiceNotes(s, key, body.serviceNotes);
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/salon/clients/profile' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const key = normKey(body.key);
    if (!key) return json(res, 400, { ok: false, error: 'Cliente inválido' });
    s.clientProfiles = s.clientProfiles || {};
    const cur = s.clientProfiles[key] || {};
    s.clientProfiles[key] = {
      name: (body.name && String(body.name).trim().slice(0, 80)) || cur.name || '',
      phone: (body.phone && String(body.phone).trim().slice(0, 30)) || cur.phone || '',
      cpf: String(body.cpf || cur.cpf || '').replace(/\D/g, '').slice(0, 11),
      birthdate: body.birthdate !== undefined ? (cleanBirthdate(body.birthdate) || '') : (cur.birthdate || ''),
      photo: body.photo || cur.photo || null
    };
    const cpfSave = digitsCpf(body.cpf || s.clientProfiles[key].cpf);
    if (isValidCpf(cpfSave)) {
      const L = ensureLedger(s, { name: s.clientProfiles[key].name || body.name, phone: s.clientProfiles[key].phone, cpf: cpfSave, birthdate: s.clientProfiles[key].birthdate });
      if (typeof body.notes === 'string') L.notes = String(body.notes).slice(0, 500);
    }
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }
  /* ---- Planos & pacotes: CRUD da dona ---- */
  if (p === '/api/salon/plans' && req.method === 'GET' && t) {
    if (isPro) return json(res, 200, { ok: true, plans: [], packs: [] });
    const s = readSalon(t.salon); if (!s) return json(res, 404, { ok: false });
    if (packRefreshExpired(s)) writeSalon(s);
    const metaX = meta(s.slug) || {};
    return json(res, 200, { ok: true, plans: s.plans || [], pixKey: metaX.pixKey || s.pixKey || '', packs: (s.packs || []).slice().reverse().slice(0, 80).map(pk => Object.assign(packView(s, pk), { client: { name: (pk.client || {}).name || '', phone: (pk.client || {}).phone || '' }, soldAt: pk.soldAt, paidAt: pk.paidAt, log: (pk.log || []).slice(0, 6) })) });
  }
  if (p === '/api/salon/plans' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona' });
    const s = readSalon(t.salon); if (!s) return json(res, 404, { ok: false });
    const raw = Array.isArray(body.plans) ? body.plans.slice(0, 30) : [];
    s.plans = raw.map((pl, i) => cleanPlanInput(pl, i));
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, plans: s.plans });
  }
  if (p === '/api/salon/packs' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona' });
    const s = readSalon(t.salon); if (!s) return json(res, 404, { ok: false });
    const pl = (s.plans || []).find(x => x.id === String(body.planId));
    if (!pl) return json(res, 400, { ok: false, error: 'Plano não encontrado' });
    const cname = clipText(body.name, 60), cphone = clipText(body.phone, 30);
    if (cname.length < 2) return json(res, 400, { ok: false, error: 'Informe o nome da cliente' });
    const paid = body.paid !== false;
    const pk = { id: 'pk' + Date.now() + uid(), planId: pl.id, planName: pl.name, price: pl.price, uses: pl.uses, usesLeft: pl.uses, days: pl.days, type: pl.type || 'servicos', renewable: pl.renewable !== false, sessions: (pl.sessions || []).slice(), client: { name: cname, phone: cphone, cpf: digitsCpf(body.cpf || '') }, services: pl.services.slice(), soldAt: new Date().toISOString(), paidAt: paid ? new Date().toISOString() : null, expiresAt: pl.days > 0 ? addDays(todayStr(), pl.days) : null, status: paid ? 'ativo' : 'pendente', log: [{ at: new Date().toISOString(), type: 'venda', note: (paid ? 'Pacote vendido e pago' : 'Pacote reservado \u2014 aguardando o Pix') + ': ' + pl.name }] };
    s.packs = s.packs || []; s.packs.unshift(pk);
    writeSalon(s); touch(s.slug);
    if (paid && phoneDigits(cphone).length >= 10) {
      sendSalonOut(s, cphone, '🎟️ *Plano ativado!* — ' + (s.name || '') + '\n\nOi, ' + (cname.split(' ')[0] || 'tudo bem') + '! Seu plano *' + pl.name + '* já está valendo: *' + pl.uses + ' uso(s)*' + (pl.days > 0 ? (' até ' + String(pk.expiresAt).split('-').reverse().join('/')) : ' sem prazo') + '.\n\nNa próxima vez que agendar pelo nosso link, é só marcar \u201Cusar meu plano\u201D que o sinal não é cobrado. 💛', 'plano-acao');
    }
    return json(res, 200, { ok: true, pack: packView(s, pk) });
  }
  m = p.match(/^\/api\/salon\/packs\/([\w-]+)\/act$/);
  if (m && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona' });
    const s = readSalon(t.salon); if (!s) return json(res, 404, { ok: false });
    const pk = (s.packs || []).find(x => x.id === m[1]);
    if (!pk) return json(res, 404, { ok: false, error: 'Pacote não encontrado' });
    const act = String(body.action || '');
    if (act === 'pay') {
      if (pk.status === 'pendente') {
        pk.status = 'ativo'; pk.paidAt = new Date().toISOString();
        (pk.log = pk.log || []).unshift({ at: pk.paidAt, type: 'pago', note: 'Pagamento recebido — plano ativo' });
        if (phoneDigits(pk.client && pk.client.phone).length >= 10) sendSalonOut(s, pk.client.phone, '🎟️ *Plano ativado!* — ' + (s.name || '') + '\n\nRecebi seu Pix! Seu plano *' + pk.planName + '* está valendo com *' + pk.usesLeft + ' uso(s)*. É só agendar pelo link e marcar \u201Cusar meu plano\u201D 💛', 'plano-acao');
      }
    }
    else if (act === 'renew') {
      const plR = (s.plans || []).find(y => y.id === pk.planId) || {};
      pk.usesLeft = Number(pk.uses) || Number(plR.uses) || 4;
      const dd = Number(pk.days != null ? pk.days : (plR.days || 30));
      pk.expiresAt = dd > 0 ? addDays(todayStr(), dd) : null;
      pk.status = 'ativo'; pk.renewReq = false; pk.paidAt = new Date().toISOString(); pk.sessionsUsed = [];
      (pk.log = pk.log || []).unshift({ at: pk.paidAt, type: 'renovado', note: 'Plano renovado — ' + pk.usesLeft + ' usos' + (pk.expiresAt ? (' até ' + pk.expiresAt) : ' sem prazo') });
      if (phoneDigits(pk.client && pk.client.phone).length >= 10) sendSalonOut(s, pk.client.phone, '🔁 *Plano renovado!* — ' + (s.name || '') + '\n\nSeu *' + pk.planName + '* voltou com tudo: *' + pk.usesLeft + ' uso(s)*' + (pk.expiresAt ? (' até ' + fmtD(pk.expiresAt)) : ' sem prazo') + '. É só agendar pelo link e marcar "usar meu plano" 💛', 'plano-acao');
    }
    else if (act === 'cancel') { pk.status = 'cancelado'; (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'cancelado', note: 'Cancelado pela responsável' + (body.note ? ' — ' + clipText(body.note, 120) : '') }); }
    else if (act === 'use+1' || act === 'use-1') { const d = act === 'use+1' ? 1 : -1; pk.usesLeft = Math.max(0, Math.min(Number(pk.uses) || 0, (Number(pk.usesLeft) || 0) + d)); (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'ajuste', note: (d > 0 ? 'Uso devolvido manualmente' : 'Uso baixado manualmente') + ' \u00b7 restam ' + pk.usesLeft }); }
    else return json(res, 400, { ok: false, error: 'Ação inválida' });
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, pack: packView(s, pk) });
  }
  /* ---- plano público: vitrine mostra; cliente manifesta interesse ---- */
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/plans$/);
  if (m && req.method === 'GET') {
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = resolved.salon;
    return json(res, 200, { ok: true, plans: publicPlans(s), pixKey: (meta(s.slug) || {}).pixKey || '' });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/mypacks$/);
  if (m && req.method === 'GET') {
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = resolved.salon;
    const cpfQ = String(q.get('cpf') || ''), phQ = String(q.get('phone') || '');
    const mine = packForClient(s, cpfQ, phQ).filter(pk => pk.status === 'ativo' || pk.status === 'expirado' || pk.status === 'pendente');
    return json(res, 200, { ok: true, packs: mine.map(pk => packView(s, pk)) });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/plan-renew$/);
  if (m && req.method === 'POST') {
    if (tooMany(req, 'planren', 12, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: 'Muitos pedidos seguidos — tente em instantes.' });
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = resolved.salon;
    const mine = packForClient(s, digitsCpf(body.cpf || ''), String(body.phone || '')).filter(pk => pk.renewable !== false);
    const pk = mine.find(x => x.status === 'ativo') || mine[0];
    if (!pk) return json(res, 400, { ok: false, error: 'Não achei um plano renovável para você — fale com o espaço.' });
    pk.renewReq = true;
    (pk.log = pk.log || []).unshift({ at: new Date().toISOString(), type: 'renovacao', note: 'Cliente pediu renovação pelo site' });
    writeSalon(s); touch(s.slug);
    try {
      const ownerPhone = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone)) || '';
      if (phoneDigits(ownerPhone).length >= 10) sendSalonOut(s, ownerPhone, '🔁 *Renovação pedida* — ' + s.name + '\n\n*' + ((pk.client && pk.client.name) || 'Cliente') + '* quer renovar o plano *' + pk.planName + '*' + (pk.usesLeft > 0 ? (' (sobraram ' + pk.usesLeft + ' uso(s))') : '') + '.\n\nRecebeu o Pix? Abra o app → Planos → 🔁 Renovar agora. 🚀', 'plano-acao');
    } catch (e) {}
    return json(res, 200, { ok: true, sent: true, instructions: 'Pedido enviado! Combine o Pix com o espaço (' + fmtBRL(pk.price || 0) + ') — assim que ele confirmar, seu novo período ativa e você recebe o aviso no WhatsApp.' });
  }
  m = p.match(/^\/api\/public\/([a-z0-9-]+)\/plan-interest$/);
  if (m && req.method === 'POST') {
    if (tooMany(req, 'planreq', 8, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: 'Muitos pedidos seguidos — tente em instantes.' });
    const resolved = readSalonResolved(m[1]); if (!resolved) return json(res, 404, { ok: false });
    const s = resolved.salon;
    if (s.status === 'suspenso') return json(res, 403, { ok: false, error: 'Espaço indisponível no momento' });
    const pl = (s.plans || []).find(x => x.id === String(body.planId) && x.active);
    if (!pl) return json(res, 400, { ok: false, error: 'Plano indisponível' });
    const cname = clipText(body.name, 60), cphone = clipText(body.phone, 30);
    if (cname.length < 2 || phoneDigits(cphone).length < 10) return json(res, 400, { ok: false, error: 'Preencha nome e WhatsApp com DDD' });
    const pk = { id: 'pk' + Date.now() + uid(), planId: pl.id, planName: pl.name, price: pl.price, uses: pl.uses, usesLeft: pl.uses, days: pl.days, type: pl.type || 'servicos', renewable: pl.renewable !== false, sessions: (pl.sessions || []).slice(), client: { name: cname, phone: cphone, cpf: digitsCpf(body.cpf || '') }, services: pl.services.slice(), soldAt: new Date().toISOString(), paidAt: null, expiresAt: pl.days > 0 ? addDays(todayStr(), pl.days) : null, status: 'pendente', log: [{ at: new Date().toISOString(), type: 'pedido', note: 'Cliente pediu pelo site — confirmar ao receber o Pix' }] };
    s.packs = s.packs || []; s.packs.unshift(pk);
    writeSalon(s); touch(s.slug);
    try {
      const ownerPhone = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone)) || '';
      if (phoneDigits(ownerPhone).length >= 10) sendSalonOut(s, ownerPhone, '🎟️ *Novo pedido de plano* — ' + s.name + '\n\n*' + cname + '* quer o plano *' + pl.name + '* (' + pl.uses + ' usos, ' + (pl.days > 0 ? pl.days + ' dias' : 'sem prazo') + ') por ' + fmtBRL(pl.price) + '.\n\nWhatsApp dela: ' + cphone + '\nQuando o Pix cair, abra \u2192 Planos \u2192 \u201CRecebi o Pix\u201D que eu ativo e aviso ela. 🚀', 'plano-acao');
    } catch (e) {}
    const px = (meta(s.slug) || {}).pixKey || '';
    return json(res, 200, { ok: true, pixKey: px, price: pl.price, instructions: px ? ('Agora: pague ' + fmtBRL(pl.price) + ' no Pix *' + px + '* e mande o comprovante no WhatsApp do espaço — ele ativa seu plano na hora.') : 'Agora mande um alô no WhatsApp do espaço combinando o pagamento — ele ativa seu plano na hora.' });
  }

  if (p === '/api/salon/clients/waiver' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const cpf = digitsCpf(body.cpf);
    if (!isValidCpf(cpf)) return json(res, 400, { ok: false, error: 'Cliente sem CPF válido' });
    const L = ensureLedger(s, { cpf, name: body.name, phone: body.phone });
    if (unusedWaiver(L)) return json(res, 400, { ok: false, error: 'Já existe uma liberação desta vez em aberto' });
    const reason = clipText(body.reason || 'Liberar cobrança desta vez', 220);
    const w = { id: 'w' + Date.now() + uid(), createdAt: new Date().toISOString(), reason, by: 'owner', used: false, usedAt: null, appointmentId: null };
    L.waivers = L.waivers || [];
    L.waivers.unshift(w);
    pushLedgerEvent(L, 'dispensa', 'Liberar cobrança desta vez' + (reason ? ' — ' + reason : ''), { waiverId: w.id });
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, waiver: w });
  }
  m = p.match(/^\/api\/salon\/appointments\/([\w-]+)\/noshow$/);
  if (m && req.method === 'POST' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const a = s.appointments.find(x => x.id === m[1]);
    if (!a) return json(res, 404, { ok: false });
    if (isPro && a.professionalId !== t.proId) return json(res, 403, { ok: false, error: 'Este agendamento não é seu' });
    if (a.status !== 'confirmed' && a.status !== 'pending_payment') return json(res, 400, { ok: false, error: 'Só é possível marcar falta em horário confirmado' });
    a.status = 'no_show';
    a.noShowAt = new Date().toISOString();
    a.noShowNote = NOSHOW_NOTE;
    packUndo(s, a, 'no_show');
    if (a.client && isValidCpf(a.client.cpf)) {
      const Lns = ensureLedger(s, a.client);
      Lns.noShows = Lns.noShows || [];
      Lns.noShows.unshift({
        id: 'ns' + Date.now() + uid(), appointmentId: a.id, date: a.date, time: a.time,
        serviceId: a.serviceId, markedAt: a.noShowAt, note: NOSHOW_NOTE, settledBy: null
      });
      pushLedgerEvent(Lns, 'falta', NOSHOW_NOTE, { appointmentId: a.id });
    }
    const svcNm = (s.services.find(x => x.id === a.serviceId) || {}).name || 'procedimento';
    const nf = pushNotif(s, 'falta', a.client.name + ' — ' + NOSHOW_NOTE + ' (' + svcNm + ' em ' + a.date + ' ' + a.time + ')');
    sseSend(s.slug, nf);
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, appointment: a, note: NOSHOW_NOTE });
  }
  m = p.match(/^\/api\/salon\/appointments\/([\w-]+)\/checkin$/);
  if (m && req.method === 'POST' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const a = s.appointments.find(x => x.id === m[1]);
    if (!a) return json(res, 404, { ok: false });
    if (isPro && a.professionalId !== t.proId) return json(res, 403, { ok: false, error: 'Este agendamento não é seu' });
    if (a.status !== 'confirmed') return json(res, 400, { ok: false, error: 'Só é possível check-in em agendamento confirmado' });
    if (a.checkInTime) return json(res, 400, { ok: false, error: 'Check-in já realizado para este agendamento' });
    a.checkInTime = new Date().toISOString();
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/salon/expenses' && req.method === 'GET' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const expenses = cleanExpenses(s.cfg && s.cfg.expenses).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    return json(res, 200, { ok: true, expenses });
  }
  if (p === '/api/salon/expenses' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    s.cfg = s.cfg || {};
    const list = cleanExpenses(s.cfg.expenses);
    const item = {
      id: body.id || ('e' + Date.now() + uid()),
      date: String(body.date || todayStr()).slice(0, 10),
      desc: clipText(body.desc || body.description || '', 120),
      category: clipText(body.category || 'Geral', 40) || 'Geral',
      amount: Math.max(0, Math.round((+body.amount || 0) * 100) / 100),
      createdAt: Date.now()
    };
    if (!item.desc || item.desc.length < 2) return json(res, 400, { ok: false, error: 'Descreva o gasto' });
    if (!(item.amount > 0)) return json(res, 400, { ok: false, error: 'Informe o valor do gasto' });
    const i = list.findIndex(x => x.id === item.id);
    if (i > -1) list[i] = Object.assign({}, list[i], item, { createdAt: list[i].createdAt || item.createdAt });
    else list.unshift(item);
    s.cfg.expenses = list.slice(0, 500);
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, expense: item, expenses: s.cfg.expenses });
  }
  m = p.match(/^\/api\/salon\/expenses\/([\w-]+)$/);
  if (m && req.method === 'DELETE' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    s.cfg = s.cfg || {};
    s.cfg.expenses = cleanExpenses(s.cfg.expenses).filter(x => x.id !== m[1]);
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, expenses: s.cfg.expenses });
  }
  if (p === '/api/salon/reports' && req.method === 'GET' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    if (isPro) {
      return json(res, 200, { ok: true, isPro: true, reports: proReports(s, t.proId) });
    }
    let reports = salonReports(s);
    /* Relatórios avançados (pico, melhor/pior dia) são do plano Pro+. Comissão da equipe fica em todos os planos. */
    if (!planFeature(s, 'advancedReports')) {
      reports = Object.assign({}, reports, { topServices: reports.topServices.slice(0, 3), bestDow: null, worstDow: null, peakHour: null, byHourList: [], byDowList: [] });
    }
    return json(res, 200, { ok: true, advanced: planFeature(s, 'advancedReports'), reports });
  }
  if (p === '/api/salon/reports/monthly-send' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const w = monthEndWindow();
    const mk = String(body.month || (w.inWindow ? closedMonthKey(w.today) : w.mk)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mk)) return json(res, 400, { ok: false, error: 'Mês inválido' });
    const bal = monthBalance(s, mk);
    const prev = monthBalance(s, monthKeyAdd(mk, -1));
    const text = formatMonthlyWhats(s, bal, prev);
    upsertMonthlyReport(s, bal, text, 'manual');
    const n = pushNotif(s, 'balanco', 'Balanço de ' + bal.label + ' enviado — faturamento ' + fmtBRL(bal.revenue));
    sseSend(s.slug, n);
    if (!(s.cfg && s.cfg.notifyPhone)) return json(res, 200, { ok: true, sent: false, needPhone: true, month: mk, text });
    sendOwnerWhats(s, text, 'balanco');
    return json(res, 200, { ok: true, sent: true, month: mk, label: bal.label });
  }
  if (p === '/api/salon/reports/quarterly-send' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const bal = quarterBalance(s, brazilTodayStr());
    const text = formatQuarterlyWhats(s, bal);
    s.quarterlyReports = Array.isArray(s.quarterlyReports) ? s.quarterlyReports : [];
    const dup = s.quarterlyReports.find(x => x && x.q === bal.q);
    const row = { q: bal.q, label: bal.label, sentAt: new Date().toISOString(), via: 'manual',
      revenue: bal.revenue, expenses: bal.expenses, profit: bal.profit, served: bal.served, clients: bal.clients, ticketMedio: bal.ticketMedio, text };
    if (dup) { s.quarterlyReports[s.quarterlyReports.indexOf(dup)] = row; }
    else s.quarterlyReports.unshift(row);
    if (s.quarterlyReports.length > 8) s.quarterlyReports.length = 8;
    writeSalon(s);
    const n = pushNotif(s, 'balanco', 'Balanço trimestral enviado — faturamento ' + fmtBRL(bal.revenue));
    sseSend(s.slug, n);
    if (!(s.cfg && s.cfg.notifyPhone)) return json(res, 200, { ok: true, sent: false, needPhone: true, quarter: bal.q, text });
    sendOwnerWhats(s, text, 'balanco');
    return json(res, 200, { ok: true, sent: true, quarter: bal.q, label: bal.label });
  }
  if (p === '/api/salon/config' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    let s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    if (body.name && String(body.name).trim().length >= 2) { s.name = String(body.name).trim(); updateMeta(s.slug, { name: s.name }); }
    if (typeof body.slogan === 'string') s.cfg.slogan = body.slogan.trim();
    if (body.logo !== undefined) s.cfg.logo = keepStoredPhoto(body.logo, s.cfg.logo);
    if (body.ownerPhoto !== undefined) s.cfg.ownerPhoto = keepStoredPhoto(body.ownerPhoto, s.cfg.ownerPhoto);
    if (typeof body.address === 'string') s.cfg.address = clipText(body.address, 220);
    if (typeof body.instagram === 'string') s.cfg.instagram = clipText(body.instagram, 80).replace(/^@/, '');
    if (typeof body.contactPhone === 'string') s.cfg.contactPhone = clipText(body.contactPhone, 30);
    if (typeof body.notifyPhone === 'string') s.cfg.notifyPhone = body.notifyPhone.trim();
    if (typeof body.pixKey === 'string') {
      const salonMeta = meta(s.slug);
      if (salonMeta) salonMeta.pixKey = clipText(body.pixKey, 120);
    }
    if (body.rebook) s.cfg.rebook = cleanRebook(body.rebook);
    if (body.payOnBooking) s.cfg.payOnBooking = cleanPayOnBooking(body.payOnBooking);
    if (body.theme) s.cfg.theme = cleanTheme(body.theme);
    if (body.customCategories !== undefined) s.cfg.customCategories = cleanCustomCategories(body.customCategories);
    if (body.botInstance !== undefined) {
      const bi = clipText(body.botInstance, 80);
      if (bi !== clipText(s.cfg.botInstance, 80)) {
        if (bi) return json(res, 403, { ok: false, error: 'Conectar ou trocar o número do salão é feito pela equipe BoraAgendar (vantagem do Premium, com a configuração incluída). Para desligar um número já conectado, pode limpar este campo.' });
        s.cfg.botInstance = bi;
        detachInstanceFromOthers(bi, s.slug);
      }
    }
    if (body.nicho !== undefined) s.cfg.nicho = cleanNiche(body.nicho);
    if (body.botTone !== undefined) s.cfg.botTone = cleanBotTone(body.botTone);
    if (body.bot !== undefined) s.cfg.bot = cleanBotConfig(body.bot, false);
    writeSalon(s); touch(s.slug);
    if (s.cfg && s.cfg.botInstance) zapsterEnsureWebhook(s.cfg.botInstance).catch(()=>{});
    /* 🎓 A dona cadastrou o WhatsApp do espaço e salvou: se ela ainda não
       recebeu o tutorial (cadastro sem número, ou envio falhou na madrugada),
       mandamos boas-vindas + tutorial agora. Uma vez só — depois disso o
       tutorialSentAt segura qualquer reenvio. */
    let tutorialQueued = false;
    if (typeof body.notifyPhone === 'string') {
      const xm = meta(s.slug);
      const phoneOk = phoneDigits(s.cfg.notifyPhone).length >= 10;
      if (phoneOk && xm && !xm.tutorialSentAt) {
        tutorialQueued = true;
        Promise.resolve().then(() => notifyNewSalonOwner(s, {
          phone: s.cfg.notifyPhone,
          salonUrl: PUBLIC_URL + '/app?slug=' + s.slug,
          guiaUrl: PUBLIC_URL + '/guia',
          email: s.email,
          trialEnd: s.trialEnd || xm.trialEnd || null
        })).catch(() => {});
      }
    }
    /* troca do link público (slug) — opcional; mantém redirecionamento do antigo */
    let slugChanged = false; let oldSlug = s.slug;
    if (body.slug !== undefined || body.updateSlugFromName) {
      const desired = body.updateSlugFromName ? slugify(s.name) : String(body.slug || '').trim();
      const ren = renameSalonSlug(s.slug, desired);
      if (!ren.ok) return json(res, 400, { ok: false, error: ren.error });
      if (ren.changed) {
        slugChanged = true; oldSlug = ren.oldSlug;
        s = readSalon(ren.slug);
        t.salon = ren.slug; /* token da sessão passa a apontar para o novo slug */
        if (db.tokens) {
          Object.keys(db.tokens).forEach(k => {
            if (db.tokens[k] && db.tokens[k].salon === oldSlug) db.tokens[k].salon = ren.slug;
          });
          saveDB();
        }
      }
    }
    return json(res, 200, {
      ok: true,
      slug: s.slug,
      name: s.name,
      publicUrl: bookingUrl(s.slug),
      slugChanged,
      previousSlug: slugChanged ? oldSlug : null,
      tutorialQueued
    });
  }
  /* Indicação vista pelo próprio dono: código, link, crédito, histórico e pausa. */
  if (p === '/api/salon/password' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão pode alterar a senha' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const current = String(body.current || '');
    const next = String(body.next || '');
    if (next.length < PW_MIN) return json(res, 400, { ok: false, error: 'A nova senha deve ter pelo menos ' + PW_MIN + ' caracteres' });
    if (!checkPw(current, s.passwordHash)) return json(res, 401, { ok: false, error: 'Senha atual incorreta' });
    s.passwordHash = hashPw(next);
    s.passwordChangedAt = new Date().toISOString();
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, passwordChanged: true });
  }
  if (p === '/api/salon/referral' && req.method === 'GET' && t) {
    const cfg = referralCfg();
    const meta = db.salons.find(v => v.slug === t.salon) || {};
    const history = (db.referrals || []).filter(r => r.referredBy === t.salon).slice(0, 40);
    return json(res, 200, {
      ok: true,
      enabled: cfg.enabled,
      percent: cfg.percent,
      programNote: cfg.note,
      myCode: referralCodeOf(meta),
      myPaused: !!meta.referralPaused,
      myCredits: (meta.referralCredits || 0),
      referredBy: meta.referredBy || null,
      history
    });
  }
  if (p === '/api/salon/referral' && req.method === 'PUT' && t) {
    const meta = db.salons.find(v => v.slug === t.salon);
    if (!meta) return json(res, 404, { ok: false });
    meta.referralPaused = !!body.paused;
    saveDB();
    return json(res, 200, { ok: true, paused: meta.referralPaused });
  }
  /* ---- Indicação cliente → cliente (admins/dona do salão) ---- */
  if (p === '/api/salon/client-referral' && req.method === 'GET' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const cfg = clientRefCfgFor(s);
    const global = clientRefCfg();
    ensureClientRefs(s);
    const clients = s.clientRefs.map(r => {
      const appts = clientAppointments(s, r.cpf, r.name);
      return {
        code: r.code, name: r.name || '', phone: r.phone || '', cpf: r.cpf || '',
        credit: refAvailableTotal(r, s),
        creditExpiresAt: refExpiresAt(r, s),
        established: appts.some(a => a.status === 'done'),
        visits: appts.filter(a => a.status === 'done').length,
        total: appts.reduce((ac, a) => ac + appointmentPrice(s, a), 0),
        referredByClient: r.referredBy || '',
        rewardedAt: r.rewardedAt || null
      };
    }).sort((a, b) => (b.credit || 0) - (a.credit || 0) || b.visits - a.visits);
    return json(res, 200, {
      ok: true,
      enabled: cfg.enabled, percent: cfg.percent,
      welcomePercent: cfg.welcomePercent, expiryDays: cfg.expiryDays, maxCredits: cfg.maxCredits,
      isCustom: !!(s.cfg && s.cfg.clientReferral && typeof s.cfg.clientReferral === 'object'),
      globalPercent: global.percent, globalWelcome: global.welcomePercent,
      linkBase: bookingUrl(s.slug),
      clients,
      log: (s.clientReferralLog || []).slice(0, 40)
    });
  }
  if (p === '/api/salon/client-referral' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    ensureClientRefs(s);
    const bodyCode = String(body.code || '').toLowerCase().trim();
    if (body.code !== undefined) {
      if (!bodyCode || bodyCode.length < 2) return json(res, 400, { ok: false, error: 'Código muito curto' });
      if (bodyCode.length > 24) return json(res, 400, { ok: false, error: 'Código muito longo (máx. 24)' });
      if (!/^[a-z0-9][a-z0-9]*$/.test(bodyCode)) return json(res, 400, { ok: false, error: 'Use apenas letras e números, sem espaço ou acento' });
      const target = body.cpf ? findRefByClient(s, { cpf: body.cpf }) : (body.name ? findRefByClient(s, { name: body.name }) : null);
      if (!target) return json(res, 404, { ok: false, error: 'Cliente não encontrado' });
      const other = s.clientRefs.find(r => r.code === bodyCode && r !== target);
      if (other) return json(res, 409, { ok: false, error: 'Esse código já existe para outro cliente' });
      target.code = bodyCode;
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, code: bodyCode });
    }
    if (body.resetReward !== undefined) {
      const target = body.cpf ? findRefByClient(s, { cpf: body.cpf }) : (body.name ? findRefByClient(s, { name: body.name }) : null);
      if (!target) return json(res, 404, { ok: false, error: 'Cliente não encontrado' });
      const L = body.cpf ? getLedger(s, body.cpf) : null;
      if (L) { L.refRewarded = false; L.referredBy = ''; }
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true });
    }
    /* BAIXA MANUAL: a dona zera o crédito de uma cliente (ex.: desconto dado na mão). */
    if (body.baixaCredit !== undefined) {
      const keyCpf = digitsCpf(body.cpf || (typeof body.baixaCredit === 'string' ? body.baixaCredit : ''));
      const target = keyCpf ? findRefByClient(s, { cpf: keyCpf }) : (body.name ? findRefByClient(s, { name: body.name }) : null);
      if (!target) return json(res, 404, { ok: false, error: 'Cliente não encontrado' });
      const used = refAvailableTotal(target, s);
      if (used > 0) { refConsumeCredit(target, used, s); target.baixaAt = Date.now(); }
      const L = body.cpf ? getLedger(s, body.cpf) : null;
      if (L) pushLedgerEvent(L, 'baixa_credito', 'Crédito de indicação dado baixa manualmente (R$ ' + used + ')', {});
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, baixa: used, name: target.name });
    }
    /* A dona pode personalizar o programa do SALÃO dela (%, boas-vindas, liga/desliga). */
    if (body.cfg && typeof body.cfg === 'object') {
      if (body.cfg.reset) { delete s.cfg.clientReferral; }
      else {
        s.cfg = s.cfg || {};
        const cur = (s.cfg.clientReferral && typeof s.cfg.clientReferral === 'object') ? s.cfg.clientReferral : {};
        const g = cleanClientRef(db && db.gateway && db.gateway.clientReferral);
        const pct = body.cfg.percent !== undefined ? Math.max(0, Math.min(100, parseInt(body.cfg.percent, 10) || 0)) : (cur.percent !== undefined ? cur.percent : g.percent);
        const welcome = body.cfg.welcomePercent !== undefined ? Math.max(0, Math.min(100, parseInt(body.cfg.welcomePercent, 10) || 0)) : (cur.welcomePercent !== undefined ? cur.welcomePercent : g.welcomePercent);
        const exp = body.cfg.expiryDays !== undefined ? Math.max(0, Math.min(730, parseInt(body.cfg.expiryDays, 10) || 0)) : (cur.expiryDays !== undefined ? cur.expiryDays : g.expiryDays);
        const maxC = body.cfg.maxCredits !== undefined ? Math.max(0, Math.min(10000, parseInt(body.cfg.maxCredits, 10) || 0)) : (cur.maxCredits !== undefined ? cur.maxCredits : g.maxCredits);
        const en = body.cfg.enabled !== undefined ? !!body.cfg.enabled : (cur.enabled !== undefined ? cur.enabled : g.enabled);
        s.cfg.clientReferral = { enabled: en, percent: pct > 0 ? pct : 15, welcomePercent: welcome, expiryDays: exp, maxCredits: maxC };
      }
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, cfg: cleanClientRef(s.cfg.clientReferral || {}) });
    }
    return json(res, 400, { ok: false, error: 'Nada para alterar' });
  }
  if (p === '/api/salon/whats-connect' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do espaço' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    return json(res, 403, { ok: false, error: 'A conexão do número próprio é feita pela equipe BoraAgendar: a gente cria a linha no nosso sistema e te manda o link para você só escanear no celular do salão. É vantagem do Premium e já vem com a configuração feita do jeito certo — chame o suporte pelo botão de WhatsApp ou no (21) 99292-7535 e peça sua linha.' });
    const out = await startSalonWhatsConnect(s, {
      phone: body.phone || (s.cfg && s.cfg.contactPhone),
      invitePhone: body.invitePhone || (s.cfg && s.cfg.notifyPhone),
      sendInvite: !!body.sendInvite
    });
    if (!out.ok) return json(res, 400, out);
    return json(res, 200, out);
  }
  if (p === '/api/salon/availability' && req.method === 'PUT' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    if (isPro) {
      const pid = t.proId;
      if (body.schedule && body.schedule[pid]) s.availability.schedule[pid] = body.schedule[pid];
      if (body.offDays && body.offDays[pid]) s.availability.offDays[pid] = body.offDays[pid];
    } else {
      if (body.schedule) s.availability.schedule = body.schedule;
      if (body.offDays) s.availability.offDays = body.offDays;
    }
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }
  /* Equipe: somente planos Pro e Premium podem cadastrar/editar colaboradores. */
  if (p === '/api/salon/team' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    if (!canManageTeam(s)) return json(res, 403, { ok: false, error: 'Cadastro de colaboradores disponível nos planos Pro e Premium' });
    const name = String(body.name || '').trim().slice(0, 80);
    const role = String(body.role || '').trim().slice(0, 80);
    const emoji = String(body.emoji || '👤').slice(0, 8);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? String(body.color) : '#E8D8DE';
    const cats = Array.isArray(body.cats) ? [...new Set(body.cats.map(x => String(x)).filter(Boolean))] : [];
    const validCats = [...knownTeamCats(s)];
    const selectedCats = cats.filter(x => validCats.includes(x));
    if (name.length < 2) return json(res, 400, { ok: false, error: 'Informe o nome do colaborador' });
    if (!selectedCats.length) return json(res, 400, { ok: false, error: 'Escolha pelo menos uma área de atendimento' });
    const phone = clipText(body.phone, 30);
    const photo = keepStoredPhoto(body.photo, null);
    const commissionPct = cleanCommissionPct(body.commissionPct, 50);
    const proObj = { id: 'pro' + Date.now() + uid(), name, role, emoji, color, cats: selectedCats, phone, photo, commissionPct };
    s.pros = Array.isArray(s.pros) ? s.pros : [];
    s.pros.push(proObj);
    s.availability = s.availability || { schedule: {}, offDays: {} };
    s.availability.schedule = s.availability.schedule || {};
    s.availability.offDays = s.availability.offDays || {};
    s.availability.schedule[proObj.id] = defaultSchedule();
    s.availability.offDays[proObj.id] = [];
    writeSalon(s); touch(s.slug);
    return json(res, 201, { ok: true, pro: proObj, availability: { schedule: s.availability.schedule[proObj.id], offDays: [] } });
  }
  m = p.match(/^\/api\/salon\/team\/([\w-]+)$/);
  if (m && (req.method === 'PUT' || req.method === 'DELETE') && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    if (!canManageTeam(s)) return json(res, 403, { ok: false, error: 'Gestão de colaboradores disponível nos planos Pro e Premium' });
    const proObj = s.pros.find(x => x.id === m[1]);
    if (!proObj) return json(res, 404, { ok: false, error: 'Colaborador não encontrado' });
    const linked = s.appointments.filter(a => a.professionalId === proObj.id && a.status !== 'canceled');
    if (req.method === 'DELETE') {
      if (s.pros.length <= 1) return json(res, 400, { ok: false, error: 'O salão precisa manter pelo menos um profissional' });
      if (linked.length) return json(res, 400, { ok: false, error: 'Não é possível remover colaborador com agendamentos vinculados' });
      s.pros = s.pros.filter(x => x.id !== proObj.id);
      if (s.availability && s.availability.schedule) delete s.availability.schedule[proObj.id];
      if (s.availability && s.availability.offDays) delete s.availability.offDays[proObj.id];
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, removed: proObj.id });
    }
    const name = String(body.name === undefined ? proObj.name : body.name).trim().slice(0, 80);
    const role = String(body.role === undefined ? (proObj.role || '') : body.role).trim().slice(0, 80);
    const emoji = String(body.emoji === undefined ? (proObj.emoji || '👤') : body.emoji).slice(0, 8);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || proObj.color || '')) ? String(body.color || proObj.color) : (proObj.color || '#E8D8DE');
    const cats = Array.isArray(body.cats) ? [...new Set(body.cats.map(x => String(x)).filter(Boolean))] : (proObj.cats || []);
    const validCats = [...knownTeamCats(s)];
    const selectedCats = cats.filter(x => validCats.includes(x));
    if (name.length < 2) return json(res, 400, { ok: false, error: 'Informe o nome do colaborador' });
    if (!selectedCats.length) return json(res, 400, { ok: false, error: 'Escolha pelo menos uma área de atendimento' });
    if (linked.some(a => { const service = s.services.find(x => x.id === a.serviceId); return service && !selectedCats.includes(service.cat); })) return json(res, 400, { ok: false, error: 'A nova área não pode excluir serviços já agendados' });
    const phone = body.phone !== undefined ? clipText(body.phone, 30) : (proObj.phone || '');
    const photo = body.photo !== undefined ? keepStoredPhoto(body.photo, proObj.photo || null) : (proObj.photo || null);
    const commissionPct = body.commissionPct !== undefined
      ? cleanCommissionPct(body.commissionPct, proCommissionPct(proObj) != null ? proCommissionPct(proObj) : 50)
      : (proCommissionPct(proObj) != null ? proCommissionPct(proObj) : proObj.commissionPct);
    Object.assign(proObj, { name, role, emoji, color, cats: selectedCats, phone, photo, commissionPct });
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, pro: proObj });
  }
  if (p === '/api/salon/pros/phone' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const proObj = s.pros.find(x => x.id === body.proId);
    if (!proObj) return json(res, 404, { ok: false, error: 'Profissional não encontrada' });
    if (body.phone !== undefined) proObj.phone = clipText(body.phone, 30);
    if (body.photo !== undefined) proObj.photo = keepStoredPhoto(body.photo, proObj.photo);
    if (body.commissionPct !== undefined) {
      if (body.commissionPct === null || body.commissionPct === '') delete proObj.commissionPct;
      else proObj.commissionPct = cleanCommissionPct(body.commissionPct, 0);
    }
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, phone: proObj.phone || '', photo: proObj.photo || null, commissionPct: proCommissionPct(proObj) });
  }
  if (p === '/api/salon/pros' && req.method === 'PUT' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const proObj = s.pros.find(x => x.id === body.proId);
    if (!proObj) return json(res, 404, { ok: false, error: 'Profissional não encontrada' });
    if (body.remove) { proObj.account = undefined; }
    else {
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.password || '');
      if (email.length < 5 || pass.length < PW_MIN) return json(res, 400, { ok: false, error: 'Informe e-mail válido e senha (mín. ' + PW_MIN + ')' });
      const ownerSame = s.email.toLowerCase() === email;
      const other = s.pros.some(x => x.id !== proObj.id && x.account && x.account.email.toLowerCase() === email);
      if (ownerSame || other) return json(res, 400, { ok: false, error: 'Este e-mail já está em uso' });
      proObj.account = { email, passwordHash: hashPw(pass) };
    }
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, hasAccount: !!proObj.account, email: proObj.account ? proObj.account.email : null });
  }
  if (p === '/api/salon/services' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const b = body;
    if (!b.name || b.price === undefined || b.price === null || b.price === '' || !b.dur || !b.cat) return json(res, 400, { ok: false, error: 'Dados incompletos' });
    if (+b.price < 0) return json(res, 400, { ok: false, error: 'Valor inválido' });
    if (b.promo && s.services.filter(x => x.promo).length >= 4 && !s.services.some(x => x.id === b.id && x.promo)) return json(res, 400, { ok: false, error: 'Máximo de 4 destaques' });
    let rebookDays = parseInt(b.rebookDays, 10);
    if (!Number.isFinite(rebookDays) || rebookDays < 1) rebookDays = null;
    else rebookDays = Math.min(365, rebookDays);
    const video = cleanServiceVideo(b.video);
    if (typeof b.photo === 'string' && b.photo.startsWith('data:image/') && b.photo.length > 1900000) {
      return json(res, 400, { ok: false, error: 'A foto saiu grande demais para o formato antigo do app. Feche e reabra o painel (ela entra comprimida) e salve de novo pelo "Enquadrar".' });
    }
    const svcId = b.id || ('s' + Date.now() + uid());
    const prev = s.services.find(x => x.id === svcId);
    let videoClip = prev && prev.videoClip;
    if (b.clearVideoFile) {
      removeSvcVideoFile(s.slug, svcId);
      videoClip = undefined;
    } else if (typeof b.videoFile === 'string' && b.videoFile.indexOf('data:video') === 0) {
      const saved = writeSvcVideoFile(s.slug, svcId, b.videoFile);
      if (saved) videoClip = saved;
    }
    const prevSvc = s.services.find(x => x.id === svcId);
    const svc = { id: svcId, name: String(b.name).trim(), cat: b.cat, emoji: b.emoji || (NICHE_FALLBACK_EMOJI[cleanNiche((s.cfg && s.cfg.nicho) || 'salao')] || '✨'), price: +b.price, promoPrice: +b.promoPrice || 0, dur: +b.dur, promo: !!b.promo, photo: keepStoredPhoto(b.photo, prevSvc && prevSvc.photo),
    frame: (b.frame === undefined) ? ((prevSvc && prevSvc.frame) || undefined) : (cleanFrame(b.frame) || undefined),
    video: video || undefined, videoClip: videoClip || undefined, rebookDays: rebookDays, addons: cleanAddons(b.addons) };
    if (!(svc.promoPrice > 0 && svc.promoPrice < svc.price)) { svc.promoPrice = 0; }
    const i = s.services.findIndex(x => x.id === svc.id);
    if (i > -1) s.services[i] = svc; else s.services.push(svc);
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true, service: svc });
  }
  m = p.match(/^\/api\/salon\/services\/([\w-]+)$/);
  if (m && req.method === 'DELETE' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const id = m[1];
    if (s.appointments.some(a => a.serviceId === id)) return json(res, 400, { ok: false, error: 'Serviço possui agendamentos' });
    s.services = s.services.filter(x => x.id !== id);
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }
  /* Atendimento espontâneo: cliente sem agendamento, lançado já como concluído. */
  if (p === '/api/salon/appointments/spontaneous' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão pode registrar atendimento espontâneo' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const date = String(body.date || brazilTodayStr()).slice(0, 10);
    const time = String(body.time || '');
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const cpf = digitsCpf(body.cpf);
    const notes = String(body.notes || '').trim().slice(0, 500);
    const paymentMethod = ['pix', 'dinheiro', 'cartao', 'outro', 'nao-informado'].includes(body.paymentMethod) ? body.paymentMethod : 'nao-informado';
    const amountRaw = body.amount === undefined || body.amount === null || body.amount === '' ? null : Number(body.amount);
    const rawItems = Array.isArray(body.services) && body.services.length
      ? body.services
      : (Array.isArray(body.serviceIds) && body.serviceIds.length
        ? body.serviceIds.map(id => ({ serviceId: id, proId: body.proId }))
        : [{ serviceId: body.serviceId, proId: body.proId }]);
    const seenSvc = new Set();
    const items = [];
    rawItems.forEach(raw => {
      const sid = String((raw && raw.serviceId) || raw || '').trim();
      if (!sid || seenSvc.has(sid)) return;
      const service = s.services.find(x => x.id === sid);
      if (!service) return;
      seenSvc.add(sid);
      const requestedPro = String((raw && raw.proId) || body.proId || '');
      const eligible = eligiblePros(s, service.cat);
      const proObj = s.pros.find(p => p.id === requestedPro) || eligible.find(p => p.id === requestedPro) || eligible[0] || s.pros[0] || null;
      if (!proObj) return;
      items.push({ service, proObj });
    });
    if (!items.length || name.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return json(res, 400, { ok: false, error: 'Informe cliente, pelo menos um serviço, data e horário válidos' });
    }
    if (date > brazilTodayStr()) return json(res, 400, { ok: false, error: 'Atendimento espontâneo deve ser hoje ou uma data passada' });
    if (amountRaw !== null && (!Number.isFinite(amountRaw) || amountRaw < 0)) return json(res, 400, { ok: false, error: 'Valor cobrado inválido' });
    if (cpf && !isValidCpf(cpf)) return json(res, 400, { ok: false, error: 'CPF inválido' });
    const catalogPrices = items.map(it => effPrice(it.service));
    const catalogTotal = catalogPrices.reduce((a, b) => a + b, 0);
    let amounts;
    if (amountRaw === null) amounts = catalogPrices;
    else if (catalogTotal > 0) {
      amounts = catalogPrices.map(pr => Math.round(amountRaw * (pr / catalogTotal) * 100) / 100);
      const diff = Math.round((amountRaw - amounts.reduce((a, b) => a + b, 0)) * 100) / 100;
      amounts[amounts.length - 1] = Math.round((amounts[amounts.length - 1] + diff) * 100) / 100;
    } else {
      amounts = items.map((_, i) => (i === 0 ? Math.round(amountRaw * 100) / 100 : 0));
    }
    const start0 = toMin(time);
    if (!Number.isFinite(start0)) return json(res, 400, { ok: false, error: 'Horário inválido' });
    const cursorByPro = {};
    const client = { name, phone, cpf, birthdate: cleanBirthdate(body.birthdate) };
    const groupId = 'w' + Date.now() + uid();
    const created = [];
    items.forEach((it, idx) => {
      const pid = it.proObj.id;
      const start = cursorByPro[pid] != null ? cursorByPro[pid] : start0;
      cursorByPro[pid] = start + durOf(s, it.service.id);
      const appt = {
        id: 'a' + Date.now() + uid() + idx, serviceId: it.service.id, professionalId: pid, date, time: fmtTime(start),
        client, status: 'done', source: 'espontaneo', scheduled: false, walkInGroupId: groupId,
        amount: amounts[idx], paymentMethod, notes, checkInTime: new Date().toISOString(), createdAt: Date.now()
      };
      s.appointments.push(appt);
      created.push(appt);
    });
    upsertClientProfile(s, client);
    if (notes) created.forEach(ap => rememberServiceNote(s, client, ap.serviceId, notes));
    writeSalon(s); touch(s.slug);
    return json(res, 201, { ok: true, appointment: created[0], appointments: created, groupId });
  }

  if (p === '/api/salon/appointments' && req.method === 'POST' && t) {
    if (isPro) return json(res, 403, { ok: false, error: 'Somente a dona do salão' });
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const { serviceId, date, time, proId, name, phone, notes, cpf } = body;
    if (!serviceId || !date || !time || !name) return json(res, 400, { ok: false });
    const chosenAddons = resolveAddons(s, serviceId, body.addonIds);
    const extraDur = addonsExtra(chosenAddons).dur;
    const dur = durOf(s, serviceId) + extraDur;
    const assigned = proId && proId !== 'any' ? proId : (assignPro(s, serviceId, date, time, null, extraDur) || {}).id;
    if (!assigned) return json(res, 409, { ok: false, error: 'Horário ocupado' });
    const freeNow = slotsForChoice(s, serviceId, date, proId, '', extraDur).some(x => x.time === time && x.free);
    if (!freeNow) return json(res, 409, { ok: false, error: 'Horário ocupado' });
    const client = { name: String(name).trim(), phone: String(phone || '').trim(), cpf: digitsCpf(cpf), birthdate: cleanBirthdate(body.birthdate) };
    if (client.cpf && !isValidCpf(client.cpf)) return json(res, 400, { ok: false, error: 'CPF inválido' });
    const appt = { id: 'a' + Date.now() + uid(), serviceId, professionalId: assigned, date, time, client, status: 'confirmed', notes: String(notes || '').trim(), createdAt: Date.now(), manageToken: crypto.randomBytes(8).toString('hex'), rescheduleCount: 0, addons: chosenAddons.length ? chosenAddons : undefined, dur: dur };
    s.appointments.push(appt);
    upsertClientProfile(s, client);
    if (appt.notes) rememberServiceNote(s, client, serviceId, appt.notes);
    appt.confirmedNotified = true;
    notifyNewBooking(s, appt);
    notifyClientBooking(s, appt);
    touch(s.slug);
    return json(res, 201, { ok: true, appointment: appt });
  }
  m = p.match(/^\/api\/salon\/appointments\/([\w-]+)$/);
  if (m && req.method === 'PATCH' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const a = s.appointments.find(x => x.id === m[1]);
    if (!a) return json(res, 404, { ok: false });
    if (isPro && a.professionalId !== t.proId) return json(res, 403, { ok: false, error: 'Este agendamento não é seu' });
    const oldStatus = a.status;
    if (['done', 'canceled', 'confirmed'].includes(body.status)) a.status = body.status;
    if (oldStatus !== 'canceled' && a.status === 'canceled') packUndo(s, a, 'cancel');
    /* ---- Edição de dados do atendimento (inclusive já concluído 'done') ---- */
    if (body.serviceId !== undefined) {
      const svc = s.services.find(x => x.id === body.serviceId);
      if (!svc) return json(res, 400, { ok: false, error: 'Serviço inválido' });
      const changed = a.serviceId !== svc.id;
      a.serviceId = svc.id;
      if (changed && a.source === 'espontaneo' && body.amount === undefined) a.amount = effPrice(svc);
    }
    if (body.professionalId !== undefined) {
      const pro = s.pros.find(x => x.id === body.professionalId);
      if (!pro) return json(res, 400, { ok: false, error: 'Profissional inválido' });
      a.professionalId = pro.id;
    }
    if (body.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return json(res, 400, { ok: false, error: 'Data inválida' });
      a.date = String(body.date);
    }
    if (body.time !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(String(body.time))) return json(res, 400, { ok: false, error: 'Horário inválido' });
      a.time = String(body.time);
    }
    if (body.amount !== undefined) {
      const amt = Number(body.amount);
      if (!Number.isFinite(amt) || amt < 0) return json(res, 400, { ok: false, error: 'Valor inválido' });
      a.amount = Math.round(amt * 100) / 100;
    }
    if (body.clientName !== undefined) { a.client = a.client || {}; a.client.name = clipText(body.clientName, 80); }
    if (body.clientPhone !== undefined) { a.client = a.client || {}; a.client.phone = clipText(body.clientPhone, 30); }
    if (body.clientCpf !== undefined) { a.client = a.client || {}; a.client.cpf = digitsCpf(body.clientCpf); }
    if (body.notes !== undefined) {
      a.notes = clipText(body.notes, 500);
      if (a.notes) rememberServiceNote(s, a.client, a.serviceId, a.notes);
    }
    if (body.paymentMethod !== undefined) a.paymentMethod = ['pix', 'dinheiro', 'cartao', 'outro', 'nao-informado'].includes(body.paymentMethod) ? body.paymentMethod : 'nao-informado';
    if (a.status === 'done' && oldStatus !== 'done') {
      const rebook = cleanRebook(s.cfg && s.cfg.rebook);
      if (rebook.enabled) { a.rebookDue = addDays(a.date, serviceRebookDays(s, a.serviceId)); a.rebookStatus = 'scheduled'; }
    }
    writeSalon(s); touch(s.slug);
    return json(res, 200, { ok: true });
  }
  m = p.match(/^\/api\/salon\/appointments\/([\w-]+)\/payment$/);
  if (m && req.method === 'POST' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    const a = s.appointments.find(x => x.id === m[1]);
    if (!a) return json(res, 404, { ok: false });
    if (isPro && a.professionalId !== t.proId) return json(res, 403, { ok: false, error: 'Este agendamento não é seu' });
    if (!a.payment) return json(res, 400, { ok: false, error: 'Sem pagamento pendente' });
    if (a.payment.status === 'pendente' || a.payment.status === 'aguardando') {
      a.payment.status = 'pago';
      a.payment.paidAt = new Date().toISOString();
      recordDeposit(s, a);
      maybeConfirmPending(s, a);
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, payment: a.payment, appointmentStatus: a.status });
    }
    return json(res, 200, { ok: true, payment: a.payment });
  }
  if (p === '/api/salon/tickets' && req.method === 'POST' && t) {
    const s = normalizeServiceEmojis(readSalon(t.salon)); if (!s) return json(res, 404, { ok: false });
    if (!body.subject || String(body.subject).trim().length < 4) return json(res, 400, { ok: false });
    db.tickets.push({ id: 't' + Date.now() + uid(), salonSlug: s.slug, salonName: s.name, user: s.owner || s.name, subject: String(body.subject).trim(), message: String(body.message || '').trim(), status: 'aberto', when: Date.now() });
    saveDB();
    return json(res, 201, { ok: true });
  }
  if (p === '/api/salon/tickets' && req.method === 'GET' && t) {
    return json(res, 200, { ok: true, tickets: db.tickets.filter(x => x.salonSlug === t.salon) });
  }

  /* ---- autenticado: admin ---- */
  const ta = tokenAuth(req, 'admin');

  if (p === '/api/admin/discount-keys' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, keys: discountKeysList() });
  }
  if (p === '/api/admin/discount-keys' && req.method === 'POST' && ta) {
    const k = cleanDiscountKey(body);
    if (!k.code) return json(res, 400, { ok: false, error: 'Informe a chave (letras e números)' });
    if (discountKeysList().some(x => normDiscountCode(x.code) === k.code)) return json(res, 400, { ok: false, error: 'Essa chave já existe' });
    db.discountKeys.push(k);
    saveDB();
    return json(res, 201, { ok: true, key: k });
  }
  m = p.match(/^\/api\/admin\/discount-keys\/([\w-]+)$/);
  if (m && req.method === 'PATCH' && ta) {
    const k = discountKeysList().find(x => x.id === m[1]);
    if (!k) return json(res, 404, { ok: false });
    if (body.percent !== undefined) k.percent = Math.max(1, Math.min(100, parseInt(body.percent, 10) || k.percent));
    if (body.times !== undefined) k.times = Math.max(1, Math.min(24, parseInt(body.times, 10) || k.times));
    if (body.maxUses !== undefined) k.maxUses = Math.max(0, Math.min(10000, parseInt(body.maxUses, 10) || 0));
    if (body.note !== undefined) k.note = clipText(body.note, 80);
    if (body.enabled !== undefined) k.enabled = !!body.enabled;
    if (body.code !== undefined) {
      const nc = normDiscountCode(body.code);
      if (!nc) return json(res, 400, { ok: false, error: 'Chave inválida' });
      if (discountKeysList().some(x => x.id !== k.id && normDiscountCode(x.code) === nc)) return json(res, 400, { ok: false, error: 'Essa chave já existe' });
      k.code = nc;
    }
    saveDB();
    return json(res, 200, { ok: true, key: k });
  }
  if (m && req.method === 'DELETE' && ta) {
    const i = discountKeysList().findIndex(x => x.id === m[1]);
    if (i < 0) return json(res, 404, { ok: false });
    db.discountKeys.splice(i, 1);
    saveDB();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/restore' && req.method === 'POST' && ta) {
    try {
      const result = restoreBackupSnapshot(body);
      return json(res, 200, { ok: true, restoredSalons: result.salons, restoredTickets: result.tickets, tokensReset: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message || 'Não foi possível restaurar o backup' });
    }
  }
  if (p === '/api/admin/dashboard' && req.method === 'GET' && ta) {
    const stats = db.salons.map(x => { const s = readSalon(x.slug); return { meta: x, st: s ? salonStats(s) : null }; });
    const mrr = db.salons.filter(x => x.status === 'ativo').reduce((a, x) => a + planPrice(x.plan), 0);
    const overdue = db.salons.filter(x => x.status === 'ativo' && (!x.nextDue || x.nextDue < todayStr())).length;
    const revByMonth = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); revByMonth[d.getFullYear() + '-' + pad(d.getMonth() + 1)] = 0; }
    db.salons.forEach(x => { const s = readSalon(x.slug); if (!s) return; s.appointments.forEach(a => { if (a.status === 'confirmed' || a.status === 'done') { const k = a.date.slice(0, 7); if (k in revByMonth) revByMonth[k] += appointmentPrice(s, a); } }); });
    return json(res, 200, { ok: true, recoveryMode, profile: adminProfile(), active: db.salons.filter(x => x.status === 'ativo').length, total: db.salons.length, test: db.salons.filter(x => x.status === 'teste').length, suspended: db.salons.filter(x => x.status === 'suspenso').length, overdue, mrr, totalAppts: stats.reduce((a, x) => a + (x.st ? x.st.appts : 0), 0), totalClients: stats.reduce((a, x) => a + (x.st ? x.st.clients : 0), 0), openTickets: db.tickets.filter(x => x.status === 'aberto').length, revenueByMonth: revByMonth, theme: cleanTheme(db.admin && db.admin.theme), planPrices: planPricesMap() });
  }
  if (p === '/api/admin/salons' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, salons: db.salons.map(x => { const s = readSalon(x.slug); const st = s ? salonStats(s) : { appts: 0, revenue: 0, clients: 0, upcoming: [] }; return { slug: x.slug, name: x.name, owner: x.owner, email: x.email, plan: x.plan, status: x.status, createdAt: x.createdAt, lastActive: x.lastActive, nextDue: x.nextDue || null, payments: x.payments || [], pixKey: x.pixKey || '', lastCharge: x.lastCharge || null, trialEnd: x.trialEnd || null, discountCode: x.discountCode || '', discountPercent: x.discountPercent || 0, discountTimesLeft: x.discountTimesLeft || 0, discountTimesTotal: x.discountTimesTotal || 0, ...st }; }) });
  }
  if (p === '/api/admin/salons' && req.method === 'POST' && ta) {
    const b = body;
    if (!b.name || !b.owner || !b.email || !b.password || !b.plan) return json(res, 400, { ok: false, error: 'Dados incompletos' });
    const slug = slugify(b.name);
    if (readSalon(slug)) return json(res, 400, { ok: false, error: 'Já existe salão com esse nome (link: /app?slug=' + slug + ')' });
    const s = makeSalon({ slug, name: String(b.name).trim(), owner: String(b.owner).trim(), email: String(b.email).trim(), password: String(b.password), plan: b.plan, status: 'teste', pros: [{ id: 'pro1', name: String(b.owner).trim(), role: 'Proprietária', emoji: '💄', color: '#F7C6D4', cats: ['unhas', 'cabelo', 'sobrancelha', 'maquiagem', 'estetica'] }] });
    writeSalon(s);
    const referredBy = (b.referral || b.referralCode || '') ? (referralCodeOf(resolveReferrer(b.referral || b.referralCode)) || '') : '';
    db.salons.push({ slug, name: s.name, owner: s.owner, email: s.email, plan: s.plan, status: 'teste', createdAt: new Date().toISOString(), lastActive: Date.now(), nextDue: addDays(todayStr(), 30), payments: [], trialEnd: null, referredBy: referredBy || undefined, referralRewardApplied: false });
    saveDB();
    const adminPhone = String(b.phone || b.whatsapp || (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone)) || '').trim();
    if (phoneDigits(adminPhone).length >= 10) {
      s.cfg = s.cfg || {};
      s.cfg.notifyPhone = s.cfg.notifyPhone || adminPhone;
      s.cfg.contactPhone = s.cfg.contactPhone || adminPhone;
      writeSalon(s);
      notifyNewSalonOwner(s, { phone: adminPhone, salonUrl: PUBLIC_URL + '/app?slug=' + slug, guiaUrl: PUBLIC_URL + '/guia', email: s.email, trialEnd: null });
    }
    return json(res, 201, { ok: true, slug, email: s.email, password: b.password });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/trial$/);
  if (m && req.method === 'POST' && ta) {
    const x = db.salons.find(v => v.slug === m[1]);
    if (!x) return json(res, 404, { ok: false });
    const days = parseInt(body.days, 10);
    if (!days || days < 1 || days > 365) return json(res, 400, { ok: false, error: 'Dias deve ser entre 1 e 365' });
    const base = (x.trialEnd && x.trialEnd > todayStr()) ? x.trialEnd : todayStr();
    x.trialEnd = addDays(base, days);
    if (x.status === 'suspenso') { x.status = 'teste'; const s = readSalon(m[1]); if (s) { s.status = 'teste'; writeSalon(s); } }
    saveDB();
    return json(res, 200, { ok: true, trialEnd: x.trialEnd });
  }

  /* 🎁 Cortesia: dias ou meses de graça para um salão ativo ou bloqueado.
     Estende a data de renovação (ou o fim do teste) SEM criar lançamento em
     payments — por isso não aparece como "recebido" no painel financeiro. */
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/gift$/);
  if (m && req.method === 'POST' && ta) {
    const x = db.salons.find(v => v.slug === m[1]);
    if (!x) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const days = parseInt(body.days, 10);
    if (!days || days < 1 || days > 730) return json(res, 400, { ok: false, error: 'Dias deve ser entre 1 e 730' });
    const note = clipText(String(body.note || ''), 120);
    const today = todayStr();
    const br = ds => String(ds || '').split('-').reverse().join('/');
    let until = null, mode = 'assinatura';
    if (x.status === 'teste') {
      mode = 'teste';
      const base = (x.trialEnd && x.trialEnd > today) ? x.trialEnd : today;
      x.trialEnd = addDays(base, days);
      until = x.trialEnd;
      x.trialReminderSent = false; x.graceUsed = false;
    } else {
      const base = (x.nextDue && x.nextDue > today) ? x.nextDue : today;
      x.nextDue = addDays(base, days);
      until = x.nextDue;
      x.status = 'ativo'; /* desbloqueia na hora, se estivesse suspenso */
      x.graceUsed = false; x.trialReminderSent = false; x.billReminderSent = false;
      x.lateNudges = 0; x.lastCharge = null; x.pendingCharges = []; /* zerou a dívida antiga perdoada */
    }
    x.gifts = Array.isArray(x.gifts) ? x.gifts : [];
    x.gifts.unshift({ date: today, days, until, note: note || '' });
    if (x.gifts.length > 24) x.gifts.length = 24;
    const s = readSalon(m[1]);
    if (s) { s.status = x.status; writeSalon(s); }
    saveDB();
    let notified = false;
    if (body.notify && s) {
      const what = mode === 'teste' ? 'testes' : 'de acesso';
      const ownerPhone = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone || s.cfg.botPhone)) || '';
      if (ownerPhone) {
        notified = true;
        Promise.resolve().then(() => sendOwnerWhats(s, '🎁 *Cortesia da administração* — ' + s.name + '\n\nLiberamos *' + days + ' dia' + (days === 1 ? '' : 's') + ' ' + what + ', sem cobrança*' + (note ? ' (' + note + ')' : '') + '.\n\nSeu ' + (mode === 'teste' ? 'teste' : 'acesso') + ' está garantido até *' + br(until) + '*. Nada que você precise fazer. 💛')).catch(() => {});
      }
    }
    return json(res, 200, { ok: true, until, days, status: x.status, mode, notified });
  }

  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/password$/);
  if (m && req.method === 'POST' && ta) {
    const s = readSalon(m[1]);
    if (!s) return json(res, 404, { ok: false });
    const pw = String(body.password || '');
    if (pw.length < PW_MIN) return json(res, 400, { ok: false, error: 'Senha deve ter pelo menos ' + PW_MIN + ' caracteres' });
    s.passwordHash = hashPw(pw);
    s.passwordChangedAt = new Date().toISOString();
    writeSalon(s); touch(m[1]);
    return json(res, 200, { ok: true });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/theme$/);
  if (m && req.method === 'PUT' && ta) {
    const __rs = readSalonResolved(m[1]); if (!__rs) return json(res, 404, { ok: false });
    const s = normalizeServiceEmojis(__rs.salon);
    s.cfg = s.cfg || {};
    s.cfg.theme = cleanTheme(body.theme);
    writeSalon(s); touch(m[1]);
    return json(res, 200, { ok: true, theme: s.cfg.theme });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)$/);
  if (m && req.method === 'GET' && ta) {
    const x = db.salons.find(v => v.slug === m[1]); const s = readSalon(m[1]);
    if (!x || !s) return json(res, 404, { ok: false });
    return json(res, 200, { ok: true, salon: { ...x, ...salonStats(s), services: s.services.length, pros: s.pros, botInstance: (s.cfg && s.cfg.botInstance) || '', notifyPhone: (s.cfg && s.cfg.notifyPhone) || '', contactPhone: (s.cfg && s.cfg.contactPhone) || (s.cfg && s.cfg.botPhone) || '', nicho: (s.cfg && s.cfg.nicho) || 'salao', botTone: (s.cfg && s.cfg.botTone) || 'auto', bot: (s.cfg && s.cfg.bot && typeof s.cfg.bot === 'object') ? s.cfg.bot : cleanBotConfigDefaults(), planFeatures: PLAN_FEATURES[s.plan] || PLAN_FEATURES['Básico'], referralCode: referralCodeOf(x), referralCredits: x.referralCredits || 0, referralPaused: !!x.referralPaused, referredBy: x.referredBy || null } });
  }
  if (m && req.method === 'DELETE' && ta) {
    const i = db.salons.findIndex(v => v.slug === m[1]);
    if (i === -1) return json(res, 404, { ok: false });
    db.salons.splice(i, 1);
    try { fs.unlinkSync(path.join(SALONS_DIR, m[1] + '.json')); } catch (e) { /* arquivo pode não existir */ }
    Object.keys(db.tokens).forEach(k => { if (db.tokens[k].salon === m[1]) delete db.tokens[k]; });
    db.tickets = db.tickets.filter(t => t.salonSlug !== m[1]);
    saveDB();
    return json(res, 200, { ok: true });
  }
  if (m && req.method === 'PATCH' && ta) {
    const x = db.salons.find(v => v.slug === m[1]); const s = readSalon(m[1]);
    if (!x || !s) return json(res, 404, { ok: false });
    let salonChanged = false;
    if (body.status && ['ativo', 'teste', 'suspenso'].includes(body.status)) { x.status = body.status; s.status = body.status; salonChanged = true; }
    if (body.plan && PLAN_PRICES[body.plan]) { x.plan = body.plan; s.plan = body.plan; salonChanged = true; }
    let clearedFrom = [];
    if (body.botInstance !== undefined) {
      s.cfg = s.cfg || {};
      s.cfg.botInstance = clipText(body.botInstance, 80);
      salonChanged = true;
    }
    if (body.contactPhone !== undefined) {
      s.cfg = s.cfg || {};
      s.cfg.contactPhone = clipText(body.contactPhone, 30);
      salonChanged = true;
    }
    if (body.bot !== undefined) {
      s.cfg = s.cfg || {};
      s.cfg.bot = cleanBotConfig(body.bot);
      salonChanged = true;
    }
    if (body.discountCode !== undefined) {
      const raw = String(body.discountCode || '').trim();
      if (!raw) {
        x.discountCode = '';
        x.discountPercent = 0;
        x.discountTimesTotal = 0;
        x.discountTimesLeft = 0;
      } else {
        const red = applyDiscountCodeToSalon(x, raw, { force: true });
        if (!red.ok) return json(res, 400, { ok: false, error: red.error });
      }
    }
    if (salonChanged) writeSalon(s);
    /* ID de instância vale para UM salão. Se o mesmo ID estava em outro espaço,
       ele sai de lá — senão o bot de um responde a tabela do outro. */
    if (body.botInstance !== undefined) clearedFrom = detachInstanceFromOthers(s.cfg.botInstance, m[1]);
    saveDB();
    if (s.cfg && s.cfg.botInstance) zapsterEnsureWebhook(s.cfg.botInstance).catch(()=>{});
    return json(res, 200, { ok: true, clearedFrom });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/pay$/);
  if (m && req.method === 'POST' && ta) {
    const x = db.salons.find(v => v.slug === m[1]);
    if (!x) return json(res, 404, { ok: false });
    /* chave de desconto ( % × N cobranças ) + crédito de indicação */
    const baseAmt = (body.amount !== undefined && body.amount !== null && body.amount !== '') ? Number(body.amount) : planPrice(x.plan);
    const promo = peekPromoDiscount(x, baseAmt);
    let amt = Math.max(0, baseAmt - promo.amount);
    const referralPeek = peekReferralCredit(x);
    const discountUsed = Math.min(amt, referralPeek);
    if (discountUsed > 0) {
      x.referralCredits = Math.max(0, (x.referralCredits || 0) - discountUsed);
      x.lastReferralApplied = new Date().toISOString();
      amt = Math.max(0, amt - discountUsed);
    }
    if (promo.amount > 0) consumePromoDiscount(x);
    x.payments = x.payments || [];
    const isFirstPay = !x.payments.some(p => p.amount > 0);
    x.payments.push({ date: todayStr(), amount: amt, discountUsed: discountUsed || undefined, promoCode: promo.amount ? x.discountCode : undefined, promoAmount: promo.amount || undefined, promoPercent: promo.percent || undefined });
    const base = (x.nextDue && x.nextDue > todayStr()) ? x.nextDue : todayStr();
    x.nextDue = addDays(base, 30);
    x.trialEnd = null; /* virou cliente pagante */
    x.graceUsed = false; x.trialReminderSent = false; x.billReminderSent = false;
    x.status = 'ativo';
    const s = readSalon(m[1]);
    if (s) { s.status = 'ativo'; writeSalon(s); }
    /* recompensa o indicador se o indicado pagou a primeira vez */
    let reward = null;
    if (isFirstPay) reward = rewardReferral(x.slug);
    saveDB();
    return json(res, 200, { ok: true, nextDue: x.nextDue, payments: x.payments.length, amountCharged: amt, discountUsed, reward });
  }
  if (p === '/api/admin/tickets' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, tickets: db.tickets.slice().reverse() });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/pix$/);
  if (m && req.method === 'PUT' && ta) {
    const x = db.salons.find(v => v.slug === m[1]);
    if (!x) return json(res, 404, { ok: false });
    x.pixKey = String(body.pixKey || '').trim();
    saveDB();
    return json(res, 200, { ok: true, pixKey: x.pixKey });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/pix-charge$/);
  if (m && req.method === 'POST' && ta) {
    const x = db.salons.find(v => v.slug === m[1]);
    if (!x) return json(res, 404, { ok: false });
    const token = (db.gateway && db.gateway.mercadopagoToken) || '';
    if (!token) return json(res, 400, { ok: false, error: 'Configure o token do Mercado Pago em Configurações para gerar cobranças Pix automáticas.' });
    const info = planChargeInfo(x);
    const amount = body.amount || info.amount;
    const payerEmail = String(body.payerEmail || '').trim() || 'cliente@exemplo.com';
    try {
      const mp = await fetch(MP_API + '/v1/payments', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Idempotency-Key': uid() + Date.now() },
        body: JSON.stringify({ transaction_amount: amount, description: 'Assinatura ' + x.name + ' (' + x.plan + ')', payment_method_id: 'pix', payer: { email: payerEmail } })
      });
      const j = await mp.json();
      if (j.status === 'pending' && j.point_of_interaction && j.point_of_interaction.transaction_data) {
        x.lastCharge = { amount, mpId: j.id, createdAt: new Date().toISOString(), qrCode: j.point_of_interaction.transaction_data.qr_code, status: 'pending' };
        saveDB();
        return json(res, 200, { ok: true, qrCode: j.point_of_interaction.transaction_data.qr_code, qrBase64: j.point_of_interaction.transaction_data.qr_code_base64 || null });
      }
      return json(res, 502, { ok: false, error: 'Mercado Pago respondeu: ' + (j.message || JSON.stringify(j).slice(0, 200)) });
    } catch (e) { return json(res, 502, { ok: false, error: 'Falha ao contatar o Mercado Pago: ' + e.message }); }
  }
  
  if (p === '/api/admin/plan-prices' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, planPrices: planPricesMap() });
  }
  if (p === '/api/admin/plan-prices' && req.method === 'PUT' && ta) {
    db.gateway = db.gateway || {};
    db.gateway.planPrices = cleanPlanPrices(body && (body.planPrices || body));
    saveDB();
    return json(res, 200, { ok: true, planPrices: planPricesMap() });
  }

  if (p === '/api/admin/meta-subscribe' && req.method === 'POST' && ta) {
    const m = ((db.gateway || {}).meta) || {};
    if (!m.wabaId || !m.token) return json(res, 400, { ok: false, error: 'Preencha WABA ID e Token da Meta antes.' });
    const r = await graphApi('/' + encodeURIComponent(String(m.wabaId).trim()) + '/subscribed_apps', 'POST', {});
    return json(res, 200, { ok: !!(r && !r.error), result: r && r.error ? r.message : 'Conta WhatsApp vinculada ao aplicativo Meta.' });
  }
  if (p === '/api/admin/meta-templates' && req.method === 'POST' && ta) {
    return json(res, 200, await metaBuildTemplates());
  }
  if (p === '/api/admin/meta-check' && req.method === 'POST' && ta) {
    const m = ((db.gateway || {}).meta) || {};
    if (!m.token || !m.phoneId) return json(res, 400, { ok: false, error: 'Faltam Token e Phone Number ID' });
    const r = await graphApi('/' + encodeURIComponent(String(m.phoneId).trim()) + '?fields=verified_name,display_phone_number,quality_rating', 'GET');
    return json(res, 200, { ok: !!(r && !r.error), number: (r && (r.display_phone_number || r.verified_name)) || '', quality: (r && r.quality_rating) || '', error: (r && r.error && r.error.message) || '' });
  }
  if (p === '/api/admin/gateway' && req.method === 'GET' && ta) {
    const gw = db.gateway || {};
    const z = gw.zapi || {};
    const zs = gw.zapster || {};
    return json(res, 200, { ok: true, gateway: {
      mercadopagoToken: gw.mercadopagoToken || '', pixKey: gw.pixKey || '', trialDays: gw.trialDays || 15,
      whatsappProvider: gw.whatsappProvider || 'zapi',
      meta: { phoneId: (gw.meta && gw.meta.phoneId) || '', token: (gw.meta && gw.meta.token) || '', wabaId: (gw.meta && gw.meta.wabaId) || '', verifyToken: (gw.meta && gw.meta.verifyToken) || '', appSecret: (gw.meta && gw.meta.appSecret) || '' },
      metaWebhookUrl: PUBLIC_URL + '/api/bot/webhook',
      zapi: { baseUrl: z.baseUrl || '', instance: z.instance || '', token: z.token || '' },
      zapster: { baseUrl: zs.baseUrl || 'https://api.zapsterapi.com', instance: zs.instance || '', token: zs.token || '' },
      ai: { baseUrl: (gw.ai && gw.ai.baseUrl) || '', model: (gw.ai && gw.ai.model) || '', token: (gw.ai && gw.ai.token) || '', temperature: Number((gw.ai && gw.ai.temperature) || 0.6) },
      planPrices: planPricesMap(),
      automations: automationCfg(),
      botConcierge: conciergeOn(),
      platformInstance: platformInstanceId(),
      conciergeSalons: listLiveSalons().map(s => ({ slug: s.slug, name: s.name, instance: salonBotInstance(s) || '' })),
      conciergeSameId: (function () {
        const pi = platformInstanceId();
        if (!pi) return null;
        const hits = listLiveSalons().filter(s => salonBotInstance(s) === pi).map(s => s.name || s.slug);
        return hits.length ? hits.join(', ') : null;
      })(),
      adminWhats: clipText(gw.adminWhats, 30),
      referral: referralCfg(),
      clientReferral: clientRefCfg()
    } });
  }
  if (p === '/api/admin/gateway' && req.method === 'PUT' && ta) {
    db.gateway = db.gateway || {};
    if (typeof body.mercadopagoToken === 'string') db.gateway.mercadopagoToken = body.mercadopagoToken.trim();
    if (typeof body.pixKey === 'string') db.gateway.pixKey = body.pixKey.trim();
    if (body.whatsappProvider && ['zapi','zapster','meta'].includes(body.whatsappProvider)) db.gateway.whatsappProvider = body.whatsappProvider;
    if (body.meta) db.gateway.meta = cleanMetaCfg(body.meta);
    if (body.zapi) db.gateway.zapi = { baseUrl: String(body.zapi.baseUrl || '').trim(), instance: String(body.zapi.instance || '').trim(), token: String(body.zapi.token || '').trim() };
    if (body.zapster) db.gateway.zapster = { baseUrl: String(body.zapster.baseUrl || 'https://api.zapsterapi.com').trim(), instance: String(body.zapster.instance || '').trim(), token: String(body.zapster.token || '').trim() };
    if (body.ai) db.gateway.ai = { baseUrl: String(body.ai.baseUrl || '').trim(), model: String(body.ai.model || '').trim(), token: String(body.ai.token || '').trim(), temperature: Math.max(0, Math.min(1.5, Number(body.ai.temperature) || 0.6)) };
    if (body.planPrices) db.gateway.planPrices = cleanPlanPrices(body.planPrices);
    if (body.automations) {
      const a = body.automations;
      db.gateway.automations = {
        autoBilling: !!a.autoBilling, weeklyReport: false, whatsMonitor: !!a.whatsMonitor,
        autoBackup: !!a.autoBackup, leadSales: !!a.leadSales, autoSuspend: !!a.autoSuspend,
        divulgaTips: a.divulgaTips === undefined ? true : !!a.divulgaTips
      };
    }
    if (typeof body.adminWhats === 'string') db.gateway.adminWhats = clipText(body.adminWhats, 30);
    /* modo concierge: 1 número da plataforma atende as clientes de todos os espaços */
    if (typeof body.botConcierge === 'boolean') db.gateway.botConcierge = body.botConcierge;
    if (body.referral) db.gateway.referral = cleanReferral(body.referral);
    if (body.clientReferral) db.gateway.clientReferral = cleanClientRef(body.clientReferral);
    if (body.trialDays) { const td = parseInt(body.trialDays, 10); if (td && td >= 1 && td <= 90) db.gateway.trialDays = td; }
    saveDB();
    if (db.gateway.zapster && db.gateway.zapster.instance) zapsterEnsureWebhook(db.gateway.zapster.instance).catch(()=>{});
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/whats-webhooks' && req.method === 'POST' && ta) {
    const zs = (db.gateway && db.gateway.zapster) || {};
    const results = [];
    if (zs.instance) {
      const r = await zapsterEnsureWebhook(zs.instance);
      results.push({ target: 'plataforma', instance: zs.instance, ok: !!(r && r.ok), error: r && r.error });
    }
    for (const x of db.salons) {
      const s = readSalon(x.slug);
      const inst = salonBotInstance(s);
      if (!inst) { results.push({ target: x.slug, instance: '', ok: false, note: 'sem instância do salão' }); continue; }
      const r = await zapsterEnsureWebhook(inst);
      results.push({ target: x.slug, instance: inst, ok: !!(r && r.ok), error: r && r.error });
    }
    return json(res, 200, { ok: true, webhookUrl: PUBLIC_URL + '/api/bot/webhook', results });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/whats-connect$/);
  if (m && req.method === 'POST' && ta) {
    const s = readSalon(m[1]);
    if (!s) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const out = await startSalonWhatsConnect(s, {
      phone: body.phone,
      invitePhone: body.invitePhone,
      sendInvite: body.sendInvite !== false,
      instanceId: body.instanceId
    });
    if (!out.ok) return json(res, 400, out);
    return json(res, 200, out);
  }
  if (p === '/api/admin/outbound' && req.method === 'GET' && ta) {
    outRoll();
    const perNow = Object.keys(outLedger.per).reduce(function (o, k) { o[k] = { hoje: outLedger.per[k].sent, nestaHora: outLedger.per[k].hsent }; return o; }, {});
    return json(res, 200, { ok: true, today: outLedger.sent, fastToday: outLedger.fast, hour: Object.keys(outLedger.per).reduce(function (a, k) { return a + outLedger.per[k].hsent; }, 0), per: perNow, queued: outLedger.depth, paused: !!outPaused(), last: outLedger.last, salons: outLedger.salon, cfg: { capDay: OUT.capDay, capHour: OUT.capHour, capDest: OUT.capDest, capSalon: OUT.capSalon, quiet: OUT.quietA + 'h-' + OUT.quietB + 'h', gap: (OUT.gapMin / 1000) + '-' + (OUT.gapMax / 1000) + 's programadas · ' + (OUT.fastMin / 1000) + '-' + (OUT.fastMax / 1000) + 's reações' } });
  }
  if (p === '/api/admin/outbound-pause' && req.method === 'POST' && ta) {
    db.gateway = db.gateway || {};
    db.gateway.outPause = !db.gateway.outPause;
    saveDB();
    return json(res, 200, { ok: true, paused: !!db.gateway.outPause });
  }
  if (p === '/api/admin/outbound-ping' && req.method === 'POST' && ta) {
    const b = body || {};
    const to = phoneDigits((b && b.to) || '');
    const txt = String((b && b.text) || 'Teste de cadência BoraAgendar');
    if (!to) return json(res, 400, { ok: false, error: 'informe "to" com o telefone' });
    const r = await sendViaPlatformBot(to, txt + ' #' + Date.now(), { kind: (b && b.fast) ? 'teste' : 'teste-cadencia' });
    return json(res, 200, { ok: !(r && r.error), result: r && r.error ? String(r.message || 'falhou') : 'enviado' });
  }
  if (p === '/api/admin/expenses' && req.method === 'GET' && ta) {
    ensureDBShape();
    const mth = String(q.get('month') || '').slice(0, 7);
    const list = (db.platformExpenses || []).slice();
    const inM = mth ? list.filter(x => String(x.date || '').startsWith(mth)) : list;
    return json(res, 200, { ok: true, month: mth || null, expenses: inM, total: Math.round(inM.reduce((a, x) => a + (+x.amount || 0), 0) * 100) / 100 });
  }
  if (p === '/api/admin/expenses' && req.method === 'POST' && ta) {
    const label = String((body && body.label) || '').trim().slice(0, 60);
    const amount = Math.round(Number((body && body.amount) || 0) * 100) / 100;
    if (label.length < 2 || !(amount > 0) || amount > 1000000) return json(res, 400, { ok: false, error: 'Informe o nome e um valor maior que zero.' });
    ensureDBShape();
    const e = { id: 'pe' + Date.now() + uid(), label, amount, cat: String((body && body.cat) || 'outros').slice(0, 24), date: /^\d{4}-\d{2}-\d{2}$/.test(String((body && body.date) || '')) ? String(body.date) : todayStr(), monthly: !!(body && body.monthly), auto: false, createdAt: new Date().toISOString() };
    db.platformExpenses.unshift(e);
    if (db.platformExpenses.length > 600) db.platformExpenses.length = 600;
    saveDB();
    return json(res, 200, { ok: true, expense: e });
  }
  m = p.match(/^\/api\/admin\/expenses\/([\w-]+)$/);
  if (m && req.method === 'DELETE' && ta) {
    const i = (db.platformExpenses || []).findIndex(x => x.id === m[1]);
    if (i < 0) return json(res, 404, { ok: false, error: 'Não encontrada' });
    db.platformExpenses.splice(i, 1); saveDB();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/expenses/renew' && req.method === 'POST' && ta) {
    const src2 = (db.platformExpenses || []).find(x => x.id === String((body && body.id) || ''));
    if (!src2) return json(res, 404, { ok: false, error: 'Não encontrada' });
    const e = Object.assign({}, src2, { id: 'pe' + Date.now() + uid(), date: todayStr(), auto: false, createdAt: new Date().toISOString() });
    db.platformExpenses.unshift(e); saveDB();
    return json(res, 200, { ok: true, expense: e });
  }
  if (p === '/api/admin/finance-month' && req.method === 'GET' && ta) {
    const mth = String(q.get('month') || '') || todayStr().slice(0, 7);
    ensureDBShape();
    let collected = 0;
    (db.salons || []).forEach(x => { (x.payments || []).forEach(pm => { if (String(pm.date || '').startsWith(mth)) collected += (+pm.amount || 0); }); });
    const ex = (db.platformExpenses || []).filter(e2 => String(e2.date || '').startsWith(mth)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const spent = ex.reduce((a, e2) => a + (+e2.amount || 0), 0);
    return json(res, 200, { ok: true, month: mth, collected: Math.round(collected * 100) / 100, spent: Math.round(spent * 100) / 100, profit: Math.round((collected - spent) * 100) / 100, expenses: ex });
  }
  if (p === '/api/admin/billing/check-pending' && req.method === 'POST' && ta) {
    const r = await mpSettlePendingCharges();
    return json(res, 200, Object.assign({ ok: true }, r));
  }
  if (p === '/api/admin/zapster/instances' && req.method === 'GET' && ta) {
    const r = await zapsterReq('GET', '/v1/wa/instances?per_page=50');
    if (!r.ok) return json(res, 400, { ok: false, error: zapsterErr(r.data) || 'Não consegui listar as instâncias da Zapster' });
    const plat = platformInstanceId();
    const list = ((r.data && r.data.instances) || []).map(it => {
      const phone = (it && it.metadata && it.metadata.phone_number) || (it && it.phone_number) || (it && it.phone) || '';
      return {
        id: it.id, name: it.name || '', status: it.status || '', phone: phone,
        connected: isWhatsConnectedStatus(it.status),
        isPlatform: !!(plat && it.id === plat)
      };
    });
    return json(res, 200, { ok: true, instances: list, platformId: plat });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/whats-status$/);
  if (m && req.method === 'GET' && ta) {
    const s = readSalon(m[1]);
    if (!s) return json(res, 404, { ok: false });
    const inst = salonBotInstance(s);
    if (!inst) return json(res, 200, { ok: true, connected: false, status: 'sem-instancia' });
    const r = await zapsterReq('GET', '/v1/wa/instances/' + encodeURIComponent(inst));
    const st = (r.data && r.data.status) || '';
    const hooks = (r.data && r.data.webhooks) || [];
    const hookUrl = PUBLIC_URL + '/api/bot/webhook';
    const hookOk = hooks.some(h => h && h.url === hookUrl && h.enabled !== false);
    return json(res, 200, { ok: true, connected: isWhatsConnectedStatus(st), status: st || (r.ok ? 'unknown' : 'erro'), instanceId: inst, webhook: hookOk, webhookUrl: hookUrl, phone: (s.cfg && (s.cfg.botPhone || s.cfg.contactPhone)) || '' });
  }
  if (p === '/api/admin/whats-log' && req.method === 'GET' && ta) {
    const salonF = String(q.get('salon') || '').toLowerCase();
    const instF = String(q.get('inst') || '').toLowerCase();
    let log = db.botLog || [];
    if (salonF) log = log.filter(x => String(x.salon || '').toLowerCase().includes(salonF));
    if (instF) log = log.filter(x => String(x.inst || '').toLowerCase().includes(instF));
    return json(res, 200, { ok: true, log: log.slice(0, 50) });
  }
  if (p === '/api/admin/leads' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, leads: (db.leads || []).slice(0, 100) });
  }
  m = p.match(/^\/api\/admin\/leads\/([\w-]+)$/);
  if (m && req.method === 'PATCH' && ta) {
    const le = (db.leads || []).find(x => x.id === m[1]);
    if (!le) return json(res, 404, { ok: false });
    if (body.status) le.status = clipText(body.status, 40);
    le.handled = !!body.handled;
    saveDB();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/referrals' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, referral: referralCfg(), referrals: (db.referrals || []).slice(0, 120) });
  }
  /* Painel central do programa CLIENTE→CLIENTE (todas as clientes de todos os salões). */
  if (p === '/api/admin/client-referrals' && req.method === 'GET' && ta) {
    const cfg = clientRefCfg();
    let totalCredit = 0, totalRewarded = 0, totalReferrals = 0;
    const salons = [];
    const log = [];
    fs.readdirSync(SALONS_DIR).filter(f => f.endsWith('.json')).forEach(f => {
      try {
        const s = readSalon(f.replace(/\.json$/, ''));
        if (!s) return;
        ensureClientRefs(s);
        const scfg = clientRefCfgFor(s);
        const outstanding = s.clientRefs.reduce((a, r) => a + refAvailableTotal(r, s), 0);
        const rewarded = s.clientRefs.reduce((a, r) => a + (r.creditParts ? r.creditParts.reduce((x, p) => x + (Number(p.amount) || 0), 0) : (r.credit || 0)), 0);
        const established = s.clientRefs.filter(r => refIsEstablished(s, r)).length;
        totalCredit += outstanding; totalRewarded += rewarded;
        salons.push({
          slug: s.slug, name: s.name || s.slug, status: s.status || 'ativo',
          enabled: scfg.enabled, percent: scfg.percent, welcomePercent: scfg.welcomePercent,
          expiryDays: scfg.expiryDays, maxCredits: scfg.maxCredits,
          isCustom: !!(s.cfg && s.cfg.clientReferral && typeof s.cfg.clientReferral === 'object'),
          outstanding, rewarded, established, refs: s.clientRefs.length
        });
        totalReferrals += (s.clientReferralLog || []).length;
        (s.clientReferralLog || []).forEach(l => log.push(Object.assign({}, l, { salon: s.slug, salonName: s.name || s.slug })));
      } catch (e) {}
    });
    log.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return json(res, 200, { ok: true, config: cfg, salons, log: log.slice(0, 200), totalCredit, totalRewarded, totalReferrals });
  }
  /* Admin dá baixa manual, ajusta crédito ou pausa o programa de UM salão (cliente→cliente). */
  if (p === '/api/admin/client-referral' && req.method === 'PUT' && ta) {
    const s = normalizeServiceEmojis(readSalon(String(body.slug || '').toLowerCase().trim()));
    if (!s) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    ensureClientRefs(s);
    if (body.zeroCredit !== undefined) {
      const target = findRefByClient(s, { cpf: body.cpf, name: body.name });
      if (!target) return json(res, 404, { ok: false, error: 'Cliente não encontrado' });
      const used = refAvailableTotal(target, s);
      if (used > 0) { refConsumeCredit(target, used, s); target.baixaAt = Date.now(); }
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, cpf: target.cpf, name: target.name, baixa: used });
    }
    if (body.setCredit !== undefined && Number.isFinite(Number(body.setCredit))) {
      const target = findRefByClient(s, { cpf: body.cpf, name: body.name });
      if (!target) return json(res, 404, { ok: false, error: 'Cliente não encontrado' });
      const v = Math.max(0, Math.round(Number(body.setCredit)));
      target.creditParts = [{ amount: v, at: Date.now() }];
      target.credit = v;
      writeSalon(s); touch(s.slug);
      return json(res, 200, { ok: true, cpf: target.cpf, name: target.name, credit: v });
    }
    if (body.cfgReset) { delete s.cfg.clientReferral; writeSalon(s); touch(s.slug); return json(res, 200, { ok: true }); }
    return json(res, 400, { ok: false, error: 'Nada para alterar' });
  }
  if (p === '/api/admin/referral-code' && req.method === 'GET' && ta) {
    const list = db.salons.map(x => ({ slug: x.slug, name: x.name, status: x.status, referralCode: referralCodeOf(x), referralCredits: x.referralCredits || 0, referredBy: x.referredBy || null, referralRewardApplied: !!x.referralRewardApplied, referralPaused: !!x.referralPaused }));
    return json(res, 200, { ok: true, codes: list });
  }
  if (p === '/api/admin/referral-code' && req.method === 'PUT' && ta) {
    const meta = db.salons.find(v => v.slug === String(body.slug || '').toLowerCase().trim());
    if (!meta) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    try {
      meta.referralPaused = !!body.paused;
      if (body.setCredits !== undefined && Number.isFinite(Number(body.setCredits))) meta.referralCredits = Math.max(0, Math.round(Number(body.setCredits)));
      if (body.addCredits !== undefined && Number.isFinite(Number(body.addCredits))) meta.referralCredits = Math.max(0, (meta.referralCredits || 0) + Math.round(Number(body.addCredits)));
      saveDB();
      return json(res, 200, { ok: true, slug: meta.slug, referralCredits: meta.referralCredits || 0, referralPaused: !!meta.referralPaused });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (p === '/api/admin/run-all' && req.method === 'POST' && ta) {
    const r = await runAllAutomations();
    const rem = runReminders();
    const bday = runBirthdayWishes();
    return json(res, 200, { ok: true, ...r, reminders: rem, birthdays: bday });
  }
  if (p === '/api/admin/send-tutorials' && req.method === 'POST' && ta) {
    const slugs = Array.isArray(body && body.slugs) ? body.slugs.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
    const results = await sendOwnerTutorials(slugs);
    const sent = results.filter(function (r) { return r.ok; }).length;
    const skipped = results.filter(function (r) { return r.skipped; }).length;
    return json(res, 200, { ok: true, sent: sent, skipped: skipped, total: results.length, results: results });
  }
  if (p === '/api/admin/send-owners-message' && req.method === 'POST' && ta) {
    const text = String((body && body.text) || '').trim();
    if (text.length < 2) return json(res, 400, { ok: false, error: 'Escreva a mensagem.' });
    if (text.length > 3500) return json(res, 400, { ok: false, error: 'Mensagem longa demais (máx. 3500 caracteres).' });
    const slugsMsg = Array.isArray(body && body.slugs) ? body.slugs.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
    const ownerMsgResults = await sendOwnersBroadcast(text, slugsMsg);
    const ownerSent = ownerMsgResults.filter(function (r) { return r.ok; }).length;
    const ownerSkipped = ownerMsgResults.filter(function (r) { return r.skipped; }).length;
    const ownerFailed = ownerMsgResults.filter(function (r) { return !r.ok && !r.skipped; }).length;
    return json(res, 200, { ok: true, sent: ownerSent, skipped: ownerSkipped, failed: ownerFailed, total: ownerMsgResults.length, results: ownerMsgResults });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/send-tutorial$/);
  if (m && req.method === 'POST' && ta) {
    const s = readSalon(m[1]);
    if (!s) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const info = ownerTutorialInfo(s, { phone: (body && body.phone) || '' });
    if (phoneDigits(info.phone).length < 10)
      return json(res, 400, { ok: false, error: 'Este salão não tem WhatsApp da responsável. Preencha o número e salve.' });
    const r = await sendOwnerTutorialLink(s, info);
    if (!r || !r.ok) return json(res, 400, { ok: false, error: (r && (r.error || r.skipped)) || 'Não foi possível enviar' });
    return json(res, 200, { ok: true, phone: r.phone });
  }
  m = p.match(/^\/api\/admin\/salons\/([a-z0-9-]+)\/whats-test$/);
  if (m && req.method === 'POST' && ta) {
    const s = readSalon(m[1]);
    if (!s) return json(res, 404, { ok: false, error: 'Salão não encontrado' });
    const inst = platformInstanceId();
    if (!inst) return json(res, 400, { ok: false, error: 'A instância Zapster da plataforma não está definida.' });
    const phone = body.phone || (s.cfg && s.cfg.notifyPhone) || (s.cfg && s.cfg.contactPhone);
    if (!looksLikeBrPhone(phone)) return json(res, 400, { ok: false, error: 'Informe um WhatsApp de teste com DDD (outro celular, não o do próprio salão).' });
    const zap = (db.gateway && db.gateway.zapster) || {};
    const text = 'Oi. Aqui é o *' + s.name + '* (BoraAgendar).\n\nTeste do bot da plataforma: se você leu isto, o WhatsApp está ligado.';
    const sent = await whatsSendRaw(phone, text, inst);
    const sendOk = !!(sent && !sent.error && (sent.message_id || sent.id || sent.ok !== false));
    pushBotLog({ inst: inst, from: 'teste', text: 'teste', reply: text, salon: s.slug, channel: 'salon', sendOk: sendOk, sendErr: sendOk ? null : zapsterErr(sent) });
    if (!sendOk) return json(res, 400, { ok: false, error: zapsterErr(sent) || 'Zapster não enviou. A instância está conectada?' });
    return json(res, 200, { ok: true, sent: true, to: intlWhatsNumber(phone) });
  }
  if (p === '/api/admin/theme' && req.method === 'GET' && ta) {
    return json(res, 200, { ok: true, theme: cleanTheme(db.admin && db.admin.theme), logo: !!(db.admin && db.admin.logo), logoV: (db.admin && db.admin.logoV) || 0 });
  }
  if (p === '/api/admin/theme' && req.method === 'PUT' && ta) {
    db.admin = db.admin || {};
    db.admin.theme = cleanTheme(body.theme);
    saveDB();
    return json(res, 200, { ok: true, theme: db.admin.theme });
  }
  if (p === '/api/admin/logo' && req.method === 'PUT' && ta) {
    db.admin = db.admin || {};
    if (body.logo === null || body.logo === '') {
      db.admin.logo = null;
      db.admin.logoV = Date.now();
      saveDB();
      return json(res, 200, { ok: true, logo: false, logoV: db.admin.logoV });
    }
    const photo = cleanPhotoData(body.logo);
    if (!photo) return json(res, 400, { ok: false, error: 'Envie uma imagem (PNG ou JPG)' });
    db.admin.logo = photo;
    db.admin.logoV = Date.now();
    saveDB();
    return json(res, 200, { ok: true, logo: true, logoV: db.admin.logoV });
  }
  if (p === '/api/admin/run-reminders' && req.method === 'POST' && ta) {
    const r = runReminders();
    const m = runMonthlyReports();
    const q = runQuarterlyReports();
    return json(res, 200, { ok: true, ...r, monthly: m, quarterly: q });
  }
  if (p === '/api/admin/profile' && req.method === 'PUT' && ta) {
    db.admin = db.admin || {};
    if (typeof body.name === 'string') {
      const name = clipText(body.name, 40);
      if (name.length < 2) return json(res, 400, { ok: false, error: 'Digite um nome com pelo menos 2 letras' });
      db.admin.name = name;
    }
    if (typeof body.emoji === 'string') {
      db.admin.emoji = String(body.emoji).trim().slice(0, 8) || '💎';
    }
    saveDB();
    return json(res, 200, { ok: true, profile: adminProfile() });
  }
  if (p === '/api/admin/password' && req.method === 'PUT' && ta) {
    const { current, next } = body;
    if (!current || !next || String(next).length < 6) return json(res, 400, { ok: false, error: 'A nova senha deve ter pelo menos 6 caracteres' });
    if (!checkPw(current, db.admin.password)) return json(res, 401, { ok: false, error: 'Senha atual incorreta' });
    db.admin.password = hashPw(String(next));
    saveDB();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/backup' && req.method === 'GET' && ta) {
    const backup = { createdAt: new Date().toISOString(), db, salons: {} };
    db.salons.forEach(x => { backup.salons[x.slug] = readSalon(x.slug); });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="boraagendar-backup-' + todayStr() + '.json"' });
    return res.end(JSON.stringify(backup, null, 2));
  }
  m = p.match(/^\/api\/admin\/tickets\/([\w-]+)$/);
  if (m && req.method === 'PATCH' && ta) {
    const tk = db.tickets.find(x => x.id === m[1]);
    if (!tk) return json(res, 404, { ok: false });
    if (body.status) tk.status = body.status;
    saveDB();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/public/admin-theme' && req.method === 'GET') {
    return json(res, 200, { ok: true, theme: cleanTheme(db.admin && db.admin.theme) });
  }
  if (p === '/api/public/wa-connect' && req.method === 'GET') {
    const row = getWaConnect(q.get('t'));
    if (!row) return json(res, 404, { ok: false, error: 'Link inválido ou expirado. Peça outro para a administração.' });
    const inst = row.instanceId;
    let connected = false, status = '';
    if (inst) {
      const r = await zapsterReq('GET', '/v1/wa/instances/' + encodeURIComponent(inst));
      status = (r.data && r.data.status) || '';
      connected = isWhatsConnectedStatus(status);
    }
    const phone = (row.salon.cfg && (row.salon.cfg.contactPhone || row.salon.cfg.botPhone)) || '';
    return json(res, 200, { ok: true, salonName: row.salon.name, connected: connected, status: status, phone: phone });
  }
  if (p === '/api/public/wa-connect/status' && req.method === 'GET') {
    const row = getWaConnect(q.get('t'));
    if (!row) return json(res, 404, { ok: false, error: 'Link inválido ou expirado' });
    const inst = row.instanceId;
    if (!inst) return json(res, 200, { ok: true, connected: false, salonName: row.salon.name, status: 'sem-instancia' });
    const r = await zapsterReq('GET', '/v1/wa/instances/' + encodeURIComponent(inst));
    const st = (r.data && r.data.status) || '';
    const connected = isWhatsConnectedStatus(st);
    if (connected) zapsterEnsureWebhook(inst).catch(function () {});
    return json(res, 200, { ok: true, connected: connected, status: st, salonName: row.salon.name });
  }
  if (p === '/api/public/wa-connect/pairing' && req.method === 'POST') {
    const row = getWaConnect(body.t || q.get('t'));
    if (!row) return json(res, 404, { ok: false, error: 'Link inválido ou expirado' });

    const inst = row.instanceId;
    if (!inst) return json(res, 400, { ok: false, error: 'Instância ainda não criada. Peça para a administração gerar o link de novo.' });
    const phone = body.phone || (row.salon.cfg && (row.salon.cfg.contactPhone || row.salon.cfg.botPhone)) || '';
    const intl = intlWhatsNumber(phone);
    if (!intl) return json(res, 400, { ok: false, error: 'Informe o WhatsApp do espaço com DDD' });
    if (phone) {
      row.salon.cfg = row.salon.cfg || {};
      row.salon.cfg.contactPhone = clipText(phone, 30);
      writeSalon(row.salon);
    }
    await zapsterReq('POST', '/v1/wa/instances/' + encodeURIComponent(inst) + '/power-on');
    let r = await zapsterReq('POST', '/v1/wa/instances/' + encodeURIComponent(inst) + '/pairing-code', { phone_number: intl });
    if (!r.ok) r = await zapsterReq('POST', '/v1/wa/instances/' + encodeURIComponent(inst) + '/pairing-code', { phone_number: '+' + intl });
    const code = r.data && (r.data.pairing_code || r.data.pairingCode || r.data.code);
    if (!r.ok || !code) return json(res, 400, { ok: false, error: zapsterErr(r.data) || r.error || 'Não foi possível gerar o código. Confira o número e tente de novo.' });
    return json(res, 200, { ok: true, pairing_code: String(code).toUpperCase() });
  }
  if (p === '/api/public/wa-connect/qr' && req.method === 'GET') {
    const row = getWaConnect(q.get('t'));
    if (!row || !row.instanceId) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, error: 'Link inválido' })); }
    const z = zapsterAuth();
    if (!z) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, error: 'Zapster não configurada' })); }
    await zapsterReq('POST', '/v1/wa/instances/' + encodeURIComponent(row.instanceId) + '/power-on');
    try {
      const r = await fetch(z.base + '/v1/wa/instances/' + encodeURIComponent(row.instanceId) + '/qrcode', {
        headers: { 'Authorization': 'Bearer ' + z.token, 'Accept': 'image/png, application/json' }
      });
      const ct = String(r.headers.get('content-type') || '');
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || ct.indexOf('image') < 0) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'QR indisponível. A instância já pode estar conectada — atualize a página.' }));
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'Falha ao buscar o QR' }));
    }
  }
  if (p === '/api/health') return json(res, 200, { ok: true, salons: db.salons.length, recoveryMode, dataDir: process.env.DATA_DIR ? 'env' : 'local', hasDb: fs.existsSync(dbFile()), out: { today: outLedger.sent, queued: outLedger.depth, paused: !!outPaused() } });
  if (p === '/api/public/plan-prices') return json(res, 200, Object.assign({ ok: true }, planPricesMap()));
  if (p.startsWith('/api/')) return json(res, 404, { ok: false, error: 'Rota não encontrada' });

  if (p === '/manifest.webmanifest' || p === '/manifest.json') {
    const slugRaw = String(q.get('slug') || '').toLowerCase().trim();
    const v = String(platformIconVersion());
    const icon192 = '/icons/icon-192.png?v=' + encodeURIComponent(v);
    const icon512 = '/icons/icon-512.png?v=' + encodeURIComponent(v);
    let name = 'BoraAgendar';
    let shortName = 'BoraAgendar';
    let start = '/';
    let id = '/';
    let desc = 'Agenda online, WhatsApp e gestão para o seu espaço.';
    if (slugRaw) {
      const resolved = readSalonResolved(slugRaw);
      const s = resolved && resolved.salon;
      const slug = (s && s.slug) || slugRaw;
      start = '/app?slug=' + encodeURIComponent(slug);
      id = '/app?slug=' + slug;
      if (s && s.name) {
        name = String(s.name).slice(0, 40);
        shortName = name.length > 12 ? name.slice(0, 12) : name;
        desc = String((s.cfg && s.cfg.slogan) || ('Agende em ' + name)).slice(0, 120);
      }
    }
    const man = {
      id: id, name: name, short_name: shortName, description: desc, lang: 'pt-BR',
      start_url: start, scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#071318', theme_color: '#0ABAB5',
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png?v=' + encodeURIComponent(v), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    };
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(man));
  }
  if (p === '/.well-known/assetlinks.json') {
    const sha = String((db && db.gateway && db.gateway.playSha256) || process.env.PLAY_SHA256 || '').trim();
    const body = sha ? [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'br.com.boraagendar', sha256_cert_fingerprints: [sha] }
    }] : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(body));
  }

  /* Logo da plataforma (editável no admin). Sem upload, usa o arquivo em /icons. */
  if (p === '/icons/icon-192.png' || p === '/icons/icon-512.png' || p === '/icons/apple-touch-icon.png') {
    try {
      const custom = db && db.admin && cleanPhotoData(db.admin.logo);
      if (custom) {
        const m = custom.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (m) {
          res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'no-cache, max-age=0' });
          return res.end(Buffer.from(m[2], 'base64'));
        }
      }
    } catch (e) {}
  }

  if (p === '/robots.txt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /media/\n\nSitemap: ' + PUBLIC_URL + '/sitemap.xml\n');
  }
  if (p === '/sitemap.xml' && req.method === 'GET') {
    const today = todayStr();
    const urls = ['/', '/trial', '/guia', '/termos', '/privacidade'].concat(['salao','unhas','barbearia','estetica','sobrancelha','maquiagem','tattoo','petshop','personal','fisio','nutri','pilates','autoest','depilacao','psico','clinica'].map(n => '/nicho/' + n));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => '  <url><loc>' + PUBLIC_URL + u + '</loc><changefreq>monthly</changefreq><priority>' + (u === '/' ? '1.0' : (u.indexOf('/nicho/') === 0 ? '0.9' : '0.6')) + '</priority><lastmod>' + today + '</lastmod></url>').join('\n') +
      '\n</urlset>\n';
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(xml);
  }

  /* ---- estáticos (aceita pasta public/ OU arquivos na raiz) ---- */
  let sp = p;
  const mCapt = p.match(/^\/captura\/([a-z0-9-]+)$/i);
  if (sp === '/') sp = '/index.html';
  if (sp === '/app') sp = '/salon-app.html';
  if (sp === '/admin') sp = '/admin.html';
  if (sp === '/trial') sp = '/trial.html';
  if (sp === '/termos' || sp === '/termos-de-uso') sp = '/termos.html';
  if (sp === '/guia') sp = '/guia.html';
  if (sp === '/guia-video') sp = '/guia-video.html';
  if (sp === '/privacidade' || sp === '/privacidade-lgpd' || sp === '/politica-de-privacidade') sp = '/privacidade.html';
  if (/^\/nicho(\/[a-z0-9-]+)?\/?$/i.test(sp)) sp = '/nicho.html';
  if (sp === '/guia-whatsapp') sp = '/guia-whatsapp.html';
  if (sp === '/conectar') sp = '/conectar.html';
  if (sp === '/captura' || sp === '/icone-boraagendar' || mCapt) sp = '/captura.html';
  const rel = path.normalize(sp).replace(/^([/\\])/, '');
  /* Só o que é interface do usuário sai da raiz. Sem isto, qualquer um abria
     /server.js (código-fonte inteiro) e /README.md (que publicava a senha padrão
     do painel). Dados, código e config ficam fora do HTTP. */
  if (!isPublicAsset(rel)) return json(res, 404, { ok: false, error: 'Rota não encontrada' });
  const cands = [];
  cands.push(path.join(ROOT, 'public', rel));
  cands.push(path.join(ROOT, rel));
  if (rel.startsWith('icons/')) {
    cands.push(path.join(ROOT, 'public', rel.slice(6)));
    cands.push(path.join(ROOT, rel.slice(6)));
  }
  const allowed = [path.join(ROOT, 'public') + path.sep, ROOT + path.sep];
  let served = false;
  for (const f of cands) {
    if (!allowed.some(a => f.startsWith(a))) continue;
    try {
      const buf = fs.readFileSync(f);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
      const ext = path.extname(f);
      let out = buf;
      if (ext === '.html') {
        const base = path.basename(f);
        if (base === 'index.html' || base === 'trial.html' || base === 'admin.html' || base === 'guia.html' || base === 'captura.html') {
          out = Buffer.from(applyPlanPricesToHtml(buf.toString('utf8')), 'utf8');
        }
        if (base === 'index.html' || base === 'trial.html' || base === 'guia.html' || base === 'captura.html' || base === 'nicho.html') {
          out = Buffer.from(out.toString('utf8').split('%TRIALDIAS%').join(String(trialDaysNow())), 'utf8');
        }
        if (base === 'salon-app.html') {
          out = Buffer.from(applyShareMeta(buf.toString('utf8'), req, url), 'utf8');
        }
      }
      const headers = { 'Content-Type': types[ext] || 'application/octet-stream' };
      if (ext === '.html') headers['Cache-Control'] = 'no-store';
      if (ext === '.png' && rel.indexOf('icon') >= 0) headers['Cache-Control'] = 'no-cache, max-age=0';
      res.writeHead(200, headers);
      res.end(out);
      served = true;
      break;
    } catch (e) { /* tenta próximo candidato */ }
  }
  if (!served) return json(res, 404, { ok: false, error: 'Página não encontrada' });
}

/* ---------------- notificações para a dona do salão ---------------- */
const sseClients = {}; /* slug -> Set de respostas SSE abertas */
const botSeenEvents = new Map();
function isDuplicateBotEvent(id){ if(!id) return false; const now=Date.now(); for(const [k,t] of botSeenEvents) if(now-t>10*60*1000) botSeenEvents.delete(k); if(botSeenEvents.has(String(id))) return true; botSeenEvents.set(String(id),now); return false; }
function sseSend(slug, data) {
  const set = sseClients[slug];
  if (!set || !set.size) return;
  const payload = 'event: aviso\ndata: ' + JSON.stringify(data) + '\n\n';
  set.forEach(res => { try { res.write(payload); } catch (e) { set.delete(res); } });
}
function notifWhen(ds){ return new Date(ds + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); }
function pushNotif(s, type, text) {
  s.notifications = s.notifications || [];
  const n = { id: 'n' + Date.now() + uid(), type, text, createdAt: Date.now(), read: false };
  s.notifications.unshift(n);
  if (s.notifications.length > 50) s.notifications.length = 50;
  writeSalon(s);
  return n;
}
function activeWhatsGateway() {
  const gw = db.gateway || {};
  const zs = gw.zapster || {};
  const za = gw.zapi || {};
  const zapReady = !!(zs.token && String(zs.token).trim());
  const preferZap = gw.whatsappProvider === 'zapster' || zapReady;
  if (preferZap && zapReady) {
    return {
      provider: 'zapster',
      cfg: {
        baseUrl: String(zs.baseUrl || 'https://api.zapsterapi.com').replace(/\/$/, ''),
        instance: String(zs.instance || '').trim(),
        token: String(zs.token).trim()
      }
    };
  }
  if (za.baseUrl && za.instance && za.token) return { provider: 'zapi', cfg: za };
  return null;
}
/* ================= WHATSAPP OFICIAL — META CLOUD API =================
   Canal oficial da Meta: automação sem risco de bloqueio. Regras do jogo:
   • resposta a mensagem recebida (janela de 24 h) → texto livre, grátis;
   • mensagem iniciada pela plataforma (lembrete, cobrança, dica, aviso) →
     template aprovado ('bora_mensagem' / 'bora_dica'), categoria dita pela Meta.
   O número da plataforma vira Meta; salões com instância própria Zapster/Z-API
   seguem neles — a escolha do transporte é por destinatário de instância. */
const GRAPH_HOST = String(process.env.META_GRAPH_HOST || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
function metaConf() {
  const gw = db.gateway || {};
  const m = gw.meta || {};
  return (gw.whatsappProvider === 'meta' && m.token && m.phoneId) ? m : null;
}
function graphApi(path, method, payload) {
  const m = ((db.gateway || {}).meta) || {};
  const opts = { method: method || 'POST', headers: { 'Authorization': 'Bearer ' + String(m.token || '').trim(), 'Content-Type': 'application/json' } };
  if (payload) opts.body = JSON.stringify(payload);
  return fetch(GRAPH_HOST + path, opts).then(r => r.json().catch(() => ({}))).then(j => {
    if (j && j.error) {
      const e = j.error || {};
      const transient = e.code === 4 || e.code === 100 || e.code === 131056 || /rate|too many|temporary/i.test(String(e.message || ''));
      return { error: true, transient: !!transient, message: transient ? 'erro-fila' : ('Meta: ' + String(e.message || 'recusado').slice(0, 140)) };
    }
    return j;
  }).catch(() => ({ error: true, transient: true, message: 'erro-fila' }));
}
function metaSendRaw(number, message, opts) {
  const m = ((db.gateway || {}).meta) || {};
  const to = phoneDigits(number);
  if (!m.token || !m.phoneId) return Promise.resolve({ error: true, message: 'Meta não configurada' });
  if (!to || to.length < 10) return Promise.resolve({ error: true, message: 'sem-whatsapp' });
  /* a API não renderiza markdown do zap: tira os asteriscos (~ _ ` idem) */
  const clean = String(message || '').replace(/[*~_`]/g, '');
  const isReply = !!(opts && opts.reply);
  let payload;
  if (isReply) payload = { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: clean.slice(0, 1500) } };
  else {
    const kind = String((opts && opts.kind) || '');
    const tpl = (kind === 'divulga') ? 'bora_dica' : 'bora_mensagem';
    const TPL_MAX = 620;
    let body1 = clean;
    const extraMsg = clean.length > TPL_MAX ? clean.slice(TPL_MAX).replace(/^\s+/, '').trim() : '';
    body1 = clean.slice(0, TPL_MAX).trim() + (extraMsg ? '\n\n(continua na próxima mensagem)' : '');
    payload = { messaging_product: 'whatsapp', to, type: 'template', template: { name: tpl, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: body1 }] }] } };
    /* continuação também sai como template — fora da janela de 24 h a Meta só aceita template */
    if (extraMsg) setTimeout(function(){ metaSendRaw(number, '…continuando:\n\n' + extraMsg, opts).catch(function(){}); }, 1600);
  }
  return fetch(GRAPH_HOST + '/' + String(m.phoneId).trim() + '/messages', { method: 'POST', headers: { 'Authorization': 'Bearer ' + String(m.token).trim(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(r => r.json().catch(() => ({}))).then(j => {
      if (!j || j.error) {
        const e = (j && j.error) || {};
        const transient = e.code === 4 || e.code === 100 || e.code === 131056 || /rate|too many|temporary/i.test(String(e.message || ''));
        return { error: true, message: transient ? 'erro-fila' : ('Meta: ' + String(e.message || 'recusado').slice(0, 140)) };
      }
      const id = (j.messages && j.messages[0] && j.messages[0].id) || ('meta-' + Date.now());
      return { id, message_id: id };
    }).catch(() => ({ error: true, message: 'erro-fila' }));
}
function cleanMetaCfg(m) {
  m = m || {};
  return { token: clipText(m.token, 400), phoneId: clipText(m.phoneId, 60), wabaId: clipText(m.wabaId, 60), verifyToken: clipText(m.verifyToken, 80), appSecret: clipText(m.appSecret, 160) };
}
function metaBuildTemplates() {
  const m = ((db.gateway || {}).meta) || {};
  const waba = String(m.wabaId || '').trim();
  if (!waba || !m.token) return Promise.resolve({ ok: false, error: 'Preencha Token e WABA ID no card do WhatsApp oficial.' });
  const defs = [
    { name: 'bora_mensagem', category: 'UTILITY', language: 'pt_BR', components: [{ type: 'BODY', text: 'Mensagem do seu espaço:\n\n{{1}}' }, { type: 'FOOTER', text: 'BoraAgendar' }] },
    { name: 'bora_dica', category: 'MARKETING', language: 'pt_BR', components: [{ type: 'BODY', text: 'Dica do seu espaço para atrair clientes:\n\n{{1}}' }, { type: 'FOOTER', text: 'BoraAgendar' }] }
  ];
  return graphApi('/' + encodeURIComponent(waba) + '/message_templates?limit=100&language=pt_BR', 'GET').then(list => {
    const have = {};
    (((list && list.data) || [])).forEach(t => { have[String(t.name)] = t.status; });
    const chain = Promise.resolve([]);
    return defs.reduce((acc, d) => acc.then(out => {
      if (have[d.name]) return out.concat([{ name: d.name, status: have[d.name], existed: true }]);
      return graphApi('/' + encodeURIComponent(waba) + '/message_templates', 'POST', d).then(r =>
        out.concat([{ name: d.name, status: (r && r.error) ? ('erro: ' + r.message) : ((r && r.status) || 'submitted'), id: r && r.id }]));
    }), chain).then(results => ({ ok: true, results }));
  });
}
/* ================= META: webhook oficial (checagem + entrada) =================
   Meta envia { object: 'whatsapp_business_account', entry: [{ changes: [{ value:
   { contacts, messages } }]}] }. Resposta ao cliente sai como texto livre (dentro
   da janela de 24h); validação da assinatura X-Hub-Signature-256 quando App Secret. */
function handleMetaWebhook(body, req, res) {
  const gw = db.gateway || {};
  const m = gw.meta || {};
  if (m.appSecret && typeof req.rawBody === 'string' && req.rawBody) {
    const sig = String(req.headers['x-hub-signature-256'] || '');
    let want = '';
    try { want = 'sha256=' + crypto.createHmac('sha256', String(m.appSecret)).update(req.rawBody, 'utf8').digest('hex'); } catch (e) {}
    if (want && sig !== want) return json(res, 403, { ok: false, error: 'assinatura inválida' });
  }
  const entries = Array.isArray(body.entry) ? body.entry : [];
  let handled = 0;
  for (const en of entries) {
    const changes = (en && en.changes) || [];
    for (const chg of changes) {
      if (!chg || chg.field !== 'messages') continue;
      const v = chg.value || {};
      const own = String((v.metadata && (v.metadata.display_phone_number || '')) || '').replace(/\D/g, '');
      for (const msg of (Array.isArray(v.messages) ? v.messages : [])) {
        if (!msg || msg.from == null) continue;
        const fromD = String(msg.from).replace(/\D/g, '');
        if (own && fromD === own) continue;                     /* eco do próprio envio */
        if (msg.id && isDuplicateBotEvent(String(msg.id))) continue;
        let txt = '';
        if (msg.type === 'text') txt = (msg.text && msg.text.body) || '';
        else if (msg.type === 'button') txt = (msg.button && (msg.button.text)) || '';
        else if (msg.type === 'interactive') { const it = msg.interactive || {}; txt = (it.button_reply && (it.button_reply.title || it.button_reply.text || it.button_reply.id)) || (it.list_reply && (it.list_reply.title || it.list_reply.description)) || ''; }
        else if (msg.type === 'image') txt = (msg.image && msg.image.caption) || '';
        else if (msg.type === 'document') txt = (msg.document && msg.document.caption) || '';
        txt = String(txt || '').trim();
        if (!txt) { pushBotLog({ ignored: 'meta-sem-texto', inst: 'meta', from: fromD, type: msg.type || '' }); continue; }
        handled++;
        (async () => {
          try {
            const routed = await routeWhatsBot('meta', fromD, txt, gw, '');
            if (!routed || !routed.reply) { pushBotLog({ ignored: (routed && routed.ignored) || 'no-reply', inst: 'meta', from: fromD, text: txt.slice(0, 90), salon: routed && routed.salon && routed.salon.slug, channel: routed && routed.channel, role: routed && routed.role }); return; }
            const sent = await metaSendRaw(fromD, routed.reply, { reply: true });
            const ok = !!(sent && !sent.error);
            pushBotLog({ ignored: null, inst: 'meta', from: fromD, text: txt.slice(0, 90), reply: routed.reply, salon: (routed.salon && routed.salon.slug) || '', channel: routed.channel, role: routed.role, sendOk: ok, sendErr: ok ? null : ((sent && sent.message) || '') });
          } catch (e) { pushBotLog({ ignored: 'meta-erro', inst: 'meta', from: fromD, text: txt.slice(0, 60) }); }
        })();
      }
    }
  }
  return json(res, 200, { ok: true, received: handled });
}

/* ============ CADÊNCIA DE SAÍDA (anti-suspensão do WhatsApp) ============
   Toda mensagem iniciada pelo sistema passa por uma fila única: espaçamento
   aleatório entre envios, limites por hora/dia e por destinatário, janela
   noturna e pausa total. Respostas ao chat (webhook) NÃO passam por aqui.
   Ajuste fino por variáveis: BOT_CAP_DAY BOT_CAP_HOUR BOT_CAP_DEST
   BOT_GAP_MIN/BOT_GAP_MAX espaçamento entre MENSAGENS PROGRAMADAS (padrão 180000-195000 = ~3 min)
   BOT_FAST_MIN/BOT_FAST_MAX espaçamento das REAÇÕES a clientes (padrão 15000-16000 = 15 s)
   BOT_QUIET_START BOT_QUIET_END BOT_DUP_MIN
   BOT_HARD_DAY BOT_OUT_PAUSE (=on pausa todo envio automático) */
const OUT_FAST_KINDS = { 'aviso-salao':1, 'aviso-donos':1, 'pix-sinal':1, 'indicacao':1, 'convite':1, 'teste':1, 'boas-vindas-dono':1, 'tutorial-dono':1, 'plano-acao':1 };
const OUT = {
  capDay: Number(process.env.BOT_CAP_DAY || 600),
  capHour: Number(process.env.BOT_CAP_HOUR || 150),
  capDest: Number(process.env.BOT_CAP_DEST || 2),
  capSalon: Number(process.env.BOT_CAP_SALON || 100),
  gapMin: Number(process.env.BOT_GAP_MIN || 180000),
  gapMax: Number(process.env.BOT_GAP_MAX || 195000),
  fastMin: Number(process.env.BOT_FAST_MIN || 15000),
  fastMax: Number(process.env.BOT_FAST_MAX || 16000),
  crossMs: Number(process.env.BOT_CROSS_MS || 3000),
  quietA: Number(process.env.BOT_QUIET_START || 21),
  quietB: Number(process.env.BOT_QUIET_END || 9),
  dupMin: Number(process.env.BOT_DUP_MIN || 90),
  hardDay: Number(process.env.BOT_HARD_DAY || 2000)
};
function outPaused() { return /^(1|on|sim|true)$/i.test(String(process.env.BOT_OUT_PAUSE || '')) || !!(db.gateway && db.gateway.outPause); }
const outLedger = { day: '', sent: 0, fast: 0, hour: '', per: {}, dest: {}, salon: {}, dup: new Map(), chain: Promise.resolve(), chainFast: Promise.resolve(), lastSent: 0, depth: 0, last: null, alertDay: '' };
function outSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function outRnd(a, b) { a = Math.max(0, a | 0); b = Math.max(a, b | 0); return a + Math.floor(Math.random() * (b - a + 1)); }
function outRoll() {
  const d = brazilTodayStr(), h = d + 'T' + String(brazilHourNow());
  if (outLedger.day !== d) { outLedger.day = d; outLedger.sent = 0; outLedger.fast = 0; outLedger.dest = {}; outLedger.per = {}; outLedger.salon = {}; }
  if (outLedger.hour !== h) { outLedger.hour = h; Object.keys(outLedger.per).forEach(function (k) { outLedger.per[k].hsent = 0; }); }
}
function outBkt(inst) {
  const k = String(inst || 'plat');
  let b = outLedger.per[k];
  if (!b) { b = { sent: 0, hsent: 0 }; outLedger.per[k] = b; }
  return b;
}
function outKey(dig, msg) { return dig + '|' + crypto.createHash('sha1').update(String(msg || '')).digest('hex').slice(0, 14); }
/* Piso entre as duas filas: nenhum envio sai a menos de OUT.crossMs do anterior,
   qualquer que seja a fila. Loop re-valida para as duas correntes não acordarem
   no mesmo tick e dispararem juntas. */
async function outCrossWait() {
  for (;;) {
    const w = OUT.crossMs - (Date.now() - outLedger.lastSent);
    if (w <= 0) { outLedger.lastSent = Date.now(); return; }
    await outSleep(w);
  }
}
function outReject(dig, msg, proactive, inst, salon) {
  outRoll();
  if (!proactive && outLedger.sent + outLedger.fast >= OUT.hardDay) return 'loop-detectado';
  if (proactive) {
    if (outPaused()) return 'pausado';
    const h = brazilHourNow();
    if (h >= OUT.quietA || h < OUT.quietB) return 'noturno';
    const b = outBkt(inst);
    if (b.sent >= OUT.capDay) return 'cap-dia';
    if (b.hsent >= OUT.capHour) return 'cap-hora';
    if ((outLedger.dest[String(inst || 'plat') + ':' + dig] || 0) >= OUT.capDest) return 'cap-destino';
    if (outLedger.depth > 400) return 'fila-cheia';
    if (salon && (outLedger.salon[salon] || 0) >= OUT.capSalon) return 'cota-salon';
  }
  const t = outLedger.dup.get(outKey(dig, msg));
  if (t && Date.now() - t < OUT.dupMin * 60000) return 'repetida';
  return null;
}
function outMarkDup(dig, msg) {
  outLedger.dup.set(outKey(dig, msg), Date.now());
  if (outLedger.dup.size > 4000) {
    const cut = Date.now() - 6 * 3600e3;
    outLedger.dup.forEach(function (v, k) { if (v < cut) outLedger.dup.delete(k); });
  }
}
function outRetryable(m) { return /pausado|noturno|cap-hora|cap-dia|fila-cheia|erro-fila|sem-gateway|WhatsApp não configurado|Instância WhatsApp não definida/.test(String(m || '')); }
function outEnqueue(dig, msg, inst, proactive, salon, kind) {
  return new Promise(function (resolve) {
    let done = false;
    function finish(r) { if (!done) { done = true; resolve(r); } }
    outLedger.depth++;
    const run = async function () {
      outLedger.depth--;
      try {
        const rej = outReject(dig, msg, proactive, inst, salon);
        if (rej) {
          finish({ error: true, message: rej });
          if (rej === 'cap-dia' && outLedger.alertDay !== outLedger.day) {
            outLedger.alertDay = outLedger.day;
            const ap = db.gateway && db.gateway.adminWhats;
            if (ap) whatsSendRaw(phoneDigits(ap), '⚠️ BoraAgendar — o limite diário de ' + OUT.capDay + ' mensagens automáticas foi atingido hoje. Envios de lembrete/retorno ficam para amanhã. Para mudar: variável BOT_CAP_DAY no Railway.', inst).catch(function () {});
          }
          return;
        }
        await outCrossWait();
        const res = await whatsSendRaw(dig, msg, inst, { kind: kind || '' });
        outLedger.lastSent = Date.now();
        outMarkDup(dig, msg);
        if (!res || !res.error) {
          if (proactive) {
            outLedger.sent++;
            const b = outBkt(inst); b.sent++; b.hsent++;
            const dk = String(inst || 'plat') + ':' + dig;
            outLedger.dest[dk] = (outLedger.dest[dk] || 0) + 1;
            if (salon) outLedger.salon[salon] = (outLedger.salon[salon] || 0) + 1;
          }
          else outLedger.fast++;
        }
        outLedger.last = { at: new Date().toISOString(), to: dig, proactive: !!proactive, ok: !!(res && !res.error) };
        finish(res || { error: true, message: 'sem-resposta' });
        /* espaçamento DESDE fila: programadas de 3 em 3 min; reações de 15 em 15 s.
           O chamador recebe a resposta NA HORA; o sono só segura o próximo item da fila. */
        await outSleep(proactive ? outRnd(OUT.gapMin, OUT.gapMax) : outRnd(OUT.fastMin, OUT.fastMax));
      } catch (e) { finish({ error: true, message: 'erro-fila' }); }
    };
    if (proactive) outLedger.chain = outLedger.chain.then(run);
    else outLedger.chainFast = outLedger.chainFast.then(run);
  });
}
/* Número próprio do salão (diferente do da plataforma); '' = usa o da plataforma. */
function salonOwnInst(s) {
  const own = salonBotInstance(s);
  return own && own !== platformInstanceId() ? own : '';
}
function sendSalonOut(s, to, message, kind) {
  const own = salonOwnInst(s);
  if (own) return whatsSend(to, message, own, { proactive: true, kind: kind }).then(function (res) { logOutboundWhats(s, phoneDigits(to), res, kind); return res; });
  return sendViaPlatformBot(to, message, { salon: s, kind: kind });
}
function whatsSendRaw(number, message, instanceOverride, opts) {
  if (metaConf()) {
    const plat = platformInstanceId();
    const own = instanceOverride && String(instanceOverride).trim() && String(instanceOverride).trim() !== plat;
    if (!own) return metaSendRaw(number, message, opts);
    const gwm = db.gateway || {}; const zsm = gwm.zapster || {}; const zam = gwm.zapi || {};
    if (zsm.token && zsm.baseUrl) return zapsterSend({ baseUrl: String(zsm.baseUrl || 'https://api.zapsterapi.com').replace(/\/$/, ''), token: String(zsm.token).trim() }, number, message, instanceOverride);
    if (zam.baseUrl && zam.token && zam.instance) return zapiSend(zam, number, message, instanceOverride);
    return Promise.resolve({ error: true, message: 'sem-gateway-para-instancia' });
  }
  const channel = activeWhatsGateway();
  if (!channel) return Promise.resolve({ error: true, message: 'WhatsApp não configurado' });
  const inst = String(instanceOverride || platformInstanceId() || channel.cfg.instance || '').trim();
  if (!inst) return Promise.resolve({ error: true, message: 'Instância WhatsApp não definida' });
  if (channel.provider === 'zapster') return zapsterSend(channel.cfg, number, message, inst);
  return zapiSend(channel.cfg, number, message, inst);
}
function whatsSend(number, message, instanceOverride, opts) {
  const dig = phoneDigits(number);
  if (!dig) return Promise.resolve({ error: true, message: 'sem-numero' });
  return outEnqueue(dig, message, instanceOverride, !!(opts && opts.proactive), (opts && opts.salon) || '', (opts && opts.kind) || '');
}
function releaseReportClaim(kind, key, slug) {
  if (!db.reportClaims) return;
  const id = String(kind || '') + ':' + String(key || '') + ':' + String(slug || '');
  if (db.reportClaims[id]) { delete db.reportClaims[id]; try { saveDB(); } catch (e) {} }
}
function logOutboundWhats(s, number, res, kind) {
  const ok = !!(res && !res.error);
  pushBotLog({
    inst: (s && whatsInstanceFor(s)) || '',
    from: 'sistema',
    text: kind || 'envio',
    reply: clipText(number, 20),
    salon: s && s.slug,
    channel: 'outbound',
    sendOk: ok,
    sendErr: ok ? '' : (res ? zapsterErr(res) : 'sem-resposta')
  });
}
function salonClientHeader(s) {
  const name = String((s && s.name) || '').trim() || 'seu espaço';
  return '*' + name + '*';
}
function clientMsgFromSalon(s, body) {
  return salonClientHeader(s) + '\n\n' + String(body || '').trim();
}
function sendViaPlatformBot(number, message, meta) {
  const inst = platformInstanceId();
  const digits = phoneDigits(number);
  const kind = (meta && meta.kind) || 'plataforma';
  const salon = meta && meta.salon;
  if (!inst) {
    const res = { error: true, message: 'Instância da plataforma não definida' };
    if (salon) logOutboundWhats(salon, digits || '', res, kind);
    return Promise.resolve(res);
  }
  if (!digits || digits.length < 10) {
    const res = { error: true, message: 'sem-whatsapp' };
    if (salon) logOutboundWhats(salon, digits || '', res, kind);
    return Promise.resolve(res);
  }
  return whatsSend(digits, message, inst, { proactive: !OUT_FAST_KINDS[kind], salon: salon && salon.slug, kind: kind }).then(res => {
    if (salon) logOutboundWhats(salon, digits, res, kind);
    else pushBotLog({ inst: inst, from: 'plataforma', text: kind, reply: digits, channel: 'outbound', sendOk: !!(res && !res.error), sendErr: (res && res.error) ? zapsterErr(res) : '' });
    return res;
  }).catch(e => {
    const res = { error: true, message: e.message };
    if (salon) logOutboundWhats(salon, digits, res, kind);
    return res;
  });
}
function sendOwnerWhats(s, text, kind) {
  const phone = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone || s.cfg.botPhone)) || '';
  if (kind) { sendSalonOut(s, phone, text, kind); return; }
  sendViaPlatformBot(phone, text, { salon: s, kind: 'aviso-salao' });
}
function ownerWelcomeFirstName(s) {
  return String((s && s.owner) || '').trim().split(/\s+/)[0] || 'oi';
}
function welcomeOwnerWhatsText(s, info) {
  const first = ownerWelcomeFirstName(s);
  const biz = String((s && s.name) || 'seu espaço').trim();
  const days = (db.gateway && db.gateway.trialDays) || 15;
  let ate = '';
  if (info && info.trialEnd) {
    try {
      ate = new Date(String(info.trialEnd).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
    } catch (e) { ate = ''; }
  }
  const loginUrl = PUBLIC_URL + '/app?entrar=1';
  const guiaUrl = (info && info.guiaUrl) || (PUBLIC_URL + '/guia');
  return 'Oi, ' + first + '! Que bom ter você no *BoraAgendar* 💎\n\n' +
    'Seu espaço *' + biz + '* já está no ar. A cliente marca sozinha pelo celular — e você recebe o aviso na hora.\n\n' +
    'Você tem *' + days + ' dias grátis*' + (ate ? (' (até ' + ate + ')') : '') + ', sem cartão.\n\n' +
    '📲 *Link das clientes*\n' + ((info && info.salonUrl) || '') + '\n\n' +
    '🔐 *Seu painel*\n' + loginUrl + '\nE-mail: ' + ((info && info.email) || '') + '\nSenha: a que você criou. Não cadastre de novo.\n\n' +
    'Daqui a pouco te mando o *tour* — um link para você ver tudo o que a plataforma pode fazer, no seu ritmo.\n\n' +
    'Qualquer dúvida, é só *responder esta conversa*.';
}
function ownerOnboardingTutorialText(s, info) {
  const first = ownerWelcomeFirstName(s);
  const biz = String((s && s.name) || 'seu espaço').trim();
  const guiaUrl = (info && info.guiaUrl) || (PUBLIC_URL + '/guia');
  const loginUrl = PUBLIC_URL + '/app?entrar=1';
  return '✨ *Seu tour BoraAgendar — ' + biz + '*\n\n' +
    first + ', preparei um link só para você. Fala de *tudo*, com ênfase no que mais muda o dia a dia:\n\n' +
    '🤖 *O bot* — conversa no WhatsApp, agenda, lembra horário, retorno e aniversário, em nome do *' + biz + '*\n' +
    '📊 *O gerador de finanças* — faturamento, gastos, comissão da equipe e o lucro da casa\n' +
    '🎬 *Os vídeos* — grave no celular e eles rodam sozinhos na vitrine e nos destaques\n\n' +
    'Abre neste link (vale a pena, de verdade):\n' +
    guiaUrl + '\n\n' +
    'Painel: ' + loginUrl + '\n\n' +
    'Quando terminar, manda o link do *' + biz + '* para uma cliente de confiança. O primeiro horário chega sozinho.\n\n' +
    'Estou aqui se travar — é só responder esta conversa 💎';
}
function ownerNotifyPhone(s, extra) {
  extra = extra || {};
  return String(extra.phone || (s && s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone || s.cfg.botPhone)) || '').trim();
}
function ownerTutorialInfo(s, extra) {
  extra = extra || {};
  const slug = (s && s.slug) || '';
  const row = (db.salons || []).find(function (x) { return x.slug === slug; }) || {};
  return {
    phone: ownerNotifyPhone(s, extra),
    salonUrl: extra.salonUrl || (PUBLIC_URL + '/app?slug=' + slug),
    guiaUrl: extra.guiaUrl || (PUBLIC_URL + '/guia'),
    email: extra.email || (s && s.email) || row.email || '',
    trialEnd: extra.trialEnd || (s && s.trialEnd) || row.trialEnd || null
  };
}
function sendOwnerTutorialLink(s, info) {
  try {
    info = ownerTutorialInfo(s, info);
    const phone = info.phone;
    if (phoneDigits(phone).length < 10) return Promise.resolve({ ok: false, skipped: 'sem-whatsapp' });
    const tutorial = ownerOnboardingTutorialText(s, info);
    return sendViaPlatformBot(phone, tutorial, { salon: s, kind: 'tutorial-dono' })
      .then(function (r) {
        const ok = !(r && r.error);
        if (ok && s && s.slug) {
          const x = (db.salons || []).find(function (v) { return v.slug === s.slug; });
          if (x) { x.tutorialSentAt = new Date().toISOString(); saveDB(); }
        }
        return { ok: ok, phone: phoneDigits(phone), send: r, skipped: ok ? '' : ((r && r.error) || 'falha') };
      })
      .catch(function (e) { return { ok: false, error: (e && e.message) || 'falha' }; });
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e && e.message) || 'falha' });
  }
}
function notifyNewSalonOwner(s, info) {
  try {
    info = ownerTutorialInfo(s, info);
    const phone = info.phone;
    if (phoneDigits(phone).length < 10) return Promise.resolve({ ok: false, skipped: 'sem-whatsapp' });
    const greet = welcomeOwnerWhatsText(s, info);
    const tutorial = ownerOnboardingTutorialText(s, info);
    return sendViaPlatformBot(phone, greet, { salon: s, kind: 'boas-vindas-dono' })
      .then(function () { return new Promise(function (ok) { setTimeout(ok, 2200); }); })
      .then(function () { return sendViaPlatformBot(phone, tutorial, { salon: s, kind: 'tutorial-dono' }); })
      .then(function (r) {
        const ok = !(r && r.error);
        if (ok && s && s.slug) {
          const x = (db.salons || []).find(function (v) { return v.slug === s.slug; });
          if (x) { x.tutorialSentAt = new Date().toISOString(); saveDB(); }
        }
        return { ok: ok, phone: phoneDigits(phone), send: r, skipped: ok ? undefined : ((r && r.message) || 'falha') };
      })
      .catch(function (e) { return { ok: false, error: (e && e.message) || 'falha' }; });
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e && e.message) || 'falha' });
  }
}
const DEMO_SALON_SLUGS = { 'studio-da-bel': 1, 'sala-da-cintia': 1, 'unhas-da-pri': 1 };
function fillOwnerBroadcast(text, s) {
  const first = ownerWelcomeFirstName(s);
  const biz = String((s && s.name) || 'seu espaço').trim();
  return String(text || '')
    .split('{nome}').join(first)
    .split('{Nome}').join(first)
    .split('{NOME}').join(first)
    .split('{salao}').join(biz)
    .split('{salão}').join(biz)
    .split('{Salao}').join(biz)
    .split('{Salão}').join(biz)
    .split('{SALAO}').join(biz)
    .split('{SALÃO}').join(biz);
}
async function sendOwnersBroadcast(text, slugs) {
  const results = [];
  const seen = {};
  const all = (slugs && slugs.length) ? slugs : (db.salons || []).map(function (x) { return x.slug; });
  for (let i = 0; i < all.length; i++) {
    const slug = all[i];
    if (DEMO_SALON_SLUGS[slug]) { results.push({ slug: slug, skipped: 'demo' }); continue; }
    const s = readSalon(slug);
    const x = (db.salons || []).find(function (v) { return v.slug === slug; });
    if (!s) { results.push({ slug: slug, skipped: 'nao-encontrado' }); continue; }
    if (x && x.status === 'suspenso') { results.push({ slug: slug, name: s.name, skipped: 'suspenso' }); continue; }
    const info = ownerTutorialInfo(s);
    const d = phoneDigits(info.phone);
    if (d.length < 10) { results.push({ slug: slug, name: s.name, skipped: 'sem-whatsapp' }); continue; }
    if (seen[d]) { results.push({ slug: slug, name: s.name, skipped: 'mesmo-numero' }); continue; }
    seen[d] = 1;
    const msg = fillOwnerBroadcast(text, s);
    const r = await sendViaPlatformBot(info.phone, msg, { salon: s, kind: 'aviso-donos' });
    const ok = !(r && r.error);
    results.push({
      slug: slug,
      name: s.name,
      phone: d,
      ok: ok,
      error: ok ? undefined : ((r && (r.message || r.error)) || 'falha')
    });
    await new Promise(function (done) { setTimeout(done, 800); });
  }
  return results;
}
async function sendOwnerTutorials(slugs) {
  const results = [];
  const seen = {};
  const all = (slugs && slugs.length) ? slugs : (db.salons || []).map(function (x) { return x.slug; });
  for (let i = 0; i < all.length; i++) {
    const slug = all[i];
    if (DEMO_SALON_SLUGS[slug]) { results.push({ slug: slug, skipped: 'demo' }); continue; }
    const s = readSalon(slug);
    const x = (db.salons || []).find(function (v) { return v.slug === slug; });
    if (!s) { results.push({ slug: slug, skipped: 'nao-encontrado' }); continue; }
    if (x && x.status === 'suspenso') { results.push({ slug: slug, name: s.name, skipped: 'suspenso' }); continue; }
    const info = ownerTutorialInfo(s);
    const d = phoneDigits(info.phone);
    if (d.length < 10) { results.push({ slug: slug, name: s.name, skipped: 'sem-whatsapp' }); continue; }
    if (seen[d]) { results.push({ slug: slug, name: s.name, skipped: 'mesmo-numero' }); continue; }
    seen[d] = 1;
    const r = await sendOwnerTutorialLink(s, info);
    results.push({ slug: slug, name: s.name, phone: d, ok: !!(r && r.ok), skipped: r && r.skipped, error: r && r.error });
    await new Promise(function (ok) { setTimeout(ok, 800); });
  }
  return results;
}
function sendWhatsMany(numbers, text, instanceOverride) {
  const seen = new Set();
  (numbers || []).forEach(n => {
    const d = phoneDigits(n);
    if (!d || seen.has(d)) return;
    seen.add(d);
    whatsSend(d, text, instanceOverride).catch(() => {});
  });
}
function bookingNotifyTargets(s, a, extraPhones) {
  const list = [];
  if (s.cfg && s.cfg.notifyPhone) list.push(s.cfg.notifyPhone);
  const proObj = (s.pros || []).find(x => x.id === (a && a.professionalId));
  if (proObj && proObj.phone) list.push(proObj.phone);
  (extraPhones || []).forEach(p => { if (p) list.push(p); });
  return list;
}
function sendClientPaymentPix(s, a) {
  if (!a || !a.payment) return;
  if (a.waPixSinal) return;
  a.waPixSinal = new Date().toISOString();
  try { writeSalon(s); } catch (e) {}
  const digits = String((a.client && a.client.phone) || '').replace(/\D/g, '');
  if (!digits) return;
  const sv = s.services.find(x => x.id === a.serviceId) || {};
  const amount = a.payment.amount;
  let msg;
  if (!(amount > 0)) return;
  if (a.payment.qrCode) {
    msg = '💳 *Sinal para confirmar seu horário* — ' + s.name + '\n\n' +
      'Serviço: ' + (sv.name || 'Atendimento') + '\nValor: ' + fmtBRL(amount) + '\n\n' +
      '*Pague por Pix copia e cola:*\n' + a.payment.qrCode + '\n\n' +
      'Assim que pagar, seu horário é confirmado. Qualquer dúvida, chama a gente.';
  } else if (a.payment.pixKey) {
    msg = '💳 *Sinal para confirmar seu horário* — ' + s.name + '\n\n' +
      'Serviço: ' + (sv.name || 'Atendimento') + '\nValor: ' + fmtBRL(amount) + '\n\n' +
      'Chave Pix: ' + a.payment.pixKey + '\n\n' +
      'Envie o comprovante por aqui para confirmarmos.';
  } else {
    return;
  }
  whatsSend(digits, msg, whatsInstanceFor(s)).then(res => logOutboundWhats(s, digits, res, "pix-sinal")).catch(()=>{});
}
function notifyClientBooking(s, a) {
  if (!a) return;
  if (a.waClientConfirm) return;
  const digits = phoneDigits(a && a.client && a.client.phone);
  if (!digits || digits.length < 10) {
    logOutboundWhats(s, '', { error: true, message: 'cliente-sem-whatsapp' }, 'confirmação-agendamento');
    return;
  }
  a.waClientConfirm = new Date().toISOString();
  try { writeSalon(s); } catch (e) {}
  const sv = s.services.find(x => x.id === a.serviceId) || {};
  const pr = s.pros.find(x => x.id === a.professionalId) || {};
  const link = a.manageToken
    ? (bookingUrl(s.slug) + '&gerenciar=' + encodeURIComponent(a.id) + '&token=' + encodeURIComponent(a.manageToken))
    : bookingUrl(s.slug);
  const price = appointmentPrice(s, a);
  const pending = a.status && a.status !== 'confirmed';
  const title = pending ? '📩 *Recebemos seu agendamento!*' : '✅ *Agendamento confirmado!*';
  const extra = pending
    ? '\n\nPara confirmar o horário, conclua o pagamento do sinal. Qualquer dúvida, responda esta mensagem.'
    : '\n\n📌 Consulte os detalhes ou cancele pelo link:\n' + link;
  const msg = clientMsgFromSalon(s, title + '\n\nOlá, ' + ((a.client && a.client.name) || '') + '! Seu horário no *' + s.name + '*:\n\n📋 Serviço: ' + (sv.name || 'Atendimento') + '\n📅 Data: ' + notifWhen(a.date) + '\n⏰ Horário: ' + a.time + '\n👤 Profissional: ' + (pr.name || 'Equipe') + '\n💰 Valor: ' + fmtBRL(price) + extra);
  whatsSend(digits, msg, whatsInstanceFor(s)).then(res => logOutboundWhats(s, digits, res, 'confirmação-agendamento')).catch(e => logOutboundWhats(s, digits, { error: true, message: e.message }, 'confirmação-agendamento'));
}
function notifyNewBooking(s, a) {
  if (!a) return;
  if (a.waOwnerNew) return;
  a.waOwnerNew = new Date().toISOString();
  try { writeSalon(s); } catch (e) {}
  const svcName = ((s.services.find(x => x.id === a.serviceId) || {}).name || 'procedimento') + (a.addons && a.addons.length ? (' + ' + a.addons.map(x => x.name).filter(Boolean).join(', ')) : '');
  const proObj = s.pros.find(x => x.id === a.professionalId) || {};
  const when = notifWhen(a.date);
  const n = pushNotif(s, 'novo_agendamento', a.client.name + ' — ' + svcName + ' em ' + when + ' às ' + a.time + (proObj.name ? ' (' + proObj.name + ')' : ''));
  sseSend(s.slug, n);
  const price = appointmentPrice(s, a);
  const payCfg = cleanPayOnBooking(s.cfg && s.cfg.payOnBooking);
  const deposit = payCfg.enabled ? calcDepositAmount(s, a) : 0;
  const depositLine = deposit ? '\n💰 Sinal: ' + fmtBRL(deposit) : '';
  sendWhatsMany(bookingNotifyTargets(s, a), '*Novo horário* — ' + s.name + '\n' + a.client.name + (a.client && a.client.phone ? ' · ' + a.client.phone : '') + '\n' + svcName + (proObj.name ? ' com ' + proObj.name : '') + '\n' + when + ' às ' + a.time + '\n' + fmtBRL(price) + depositLine, whatsInstanceFor(s));
}
function notifyCancel(s, a) {
  if (!a) return;
  if (a.waCancel) return;
  a.waCancel = new Date().toISOString();
  try { writeSalon(s); } catch (e) {}
  const svcName = (s.services.find(x => x.id === a.serviceId) || {}).name || 'procedimento';
  const when = notifWhen(a.date);
  const n = pushNotif(s, 'cancelamento', a.client.name + ' cancelou ' + svcName + ' (' + when + ' às ' + a.time + ')');
  sseSend(s.slug, n);
  sendWhatsMany(bookingNotifyTargets(s, a), '*Cancelou* — ' + s.name + '\n' + a.client.name + ' desmarcou ' + svcName + '\n' + when + ' às ' + a.time + '\nA vaga ficou livre.', whatsInstanceFor(s));
}
function notifyReschedule(s, a, oldDate, oldTime, oldProPhone) {
  const svcName = (s.services.find(x => x.id === a.serviceId) || {}).name || 'procedimento';
  const proObj = s.pros.find(x => x.id === a.professionalId) || {};
  const when = notifWhen(a.date);
  const oldWhen = notifWhen(oldDate);
  const n = pushNotif(s, 'reagendamento', a.client.name + ' reagendou ' + svcName + ' para ' + when + ' às ' + a.time + (proObj.name ? ' (' + proObj.name + ')' : ''));
  sseSend(s.slug, n);
  sendWhatsMany(bookingNotifyTargets(s, a, oldProPhone ? [oldProPhone] : []), '*Reagendou* — ' + s.name + '\n' + a.client.name + ' · ' + svcName + (proObj.name ? ' com ' + proObj.name : '') + '\nEra ' + oldWhen + ' às ' + oldTime + '\nAgora ' + when + ' às ' + a.time, whatsInstanceFor(s));
}

/* ---------------- expiração de testes grátis ---------------- */
function daysBetween(a, b) {
  return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
}
function expireTrials() {
  const today = todayStr();
  let suspended = 0, extended = 0, reminded = 0;
  let dirty = false;
  /* --- fluxo do teste grátis --- */
  db.salons.forEach(x => {
    if (x.status === 'suspenso' || x.status === 'ativo') return;
    if (!x.trialEnd) return;
    const s = readSalon(x.slug);
    const daysLeft = daysBetween(x.trialEnd, today);
    /* aviso com 3 dias de antecedência (uma única vez) */
    if (daysLeft <= 3 && daysLeft >= 0 && !x.trialReminderSent) {
      if (claimReportSend('trial-aviso', String(x.trialEnd), x.slug)) {
      x.trialReminderSent = true;
      dirty = true;
      reminded++;
      if (s) {
        const msg = daysLeft === 0 ? 'Seu teste grátis termina HOJE. Regularize o pagamento para não pausar o acesso!' : 'Seu teste grátis termina em ' + daysLeft + ' dia' + (daysLeft > 1 ? 's' : '') + '. Regularize o pagamento para não pausar o acesso!';
        pushNotif(s, 'aviso', msg);
        sendOwnerWhats(s, '⏰ *Aviso no ' + s.name + '!* ' + msg);
        writeSalon(s);
      }
      }
    }
    /* venceu e ainda não usou a carência de 1 dia grátis */
    if (daysLeft < 0 && !x.graceUsed) {
      if (claimReportSend('trial-carencia', String(x.trialEnd), x.slug)) {
      x.graceUsed = true;
      x.trialEnd = addDays(today, 1);
      dirty = true;
      extended++;
      if (s) {
        const msg = 'Seu teste grátis terminou, mas você ganhou 1 dia EXTRA de carência. Aproveite para regularizar o pagamento!';
        pushNotif(s, 'aviso', msg);
        sendOwnerWhats(s, '🎁 *Carência de 1 dia no ' + s.name + '!* ' + msg);
        writeSalon(s);
      }
      }
    }
    /* já usou a carência e continua sem pagar → bloqueia automático */
    else if (daysLeft < 0 && x.graceUsed && x.status !== 'suspenso') {
      if (claimReportSend('trial-pausado', x.slug, x.slug)) {
      x.status = 'suspenso';
      dirty = true;
      suspended++;
      if (s) {
        s.status = 'suspenso';
        const msg = 'Seu acesso foi pausado: o período de teste terminou. Para reativar, regularize o pagamento com a administração.';
        pushNotif(s, 'aviso', msg);
        sendOwnerWhats(s, '⏸️ *Acesso pausado no ' + s.name + '.* ' + msg);
        writeSalon(s);
      }
      }
    }
  });
  /* --- aviso de vencimento para clientes pagantes (3 dias antes) — uma vez por vencimento --- */
  db.salons.forEach(x => {
    if (x.status !== 'ativo' || !x.nextDue || x.billReminderSent) return;
    const daysLeft = daysBetween(x.nextDue, today);
    if (daysLeft <= 3 && daysLeft >= 0) {
      if (!claimReportSend('bill-aviso', String(x.nextDue), x.slug)) return;
      x.billReminderSent = true;
      dirty = true;
      const s = readSalon(x.slug);
      if (s) {
        const msg = daysLeft === 0 ? 'Sua assinatura vence HOJE. Regularize para não ter o acesso pausado!' : 'Sua assinatura vence em ' + daysLeft + ' dia' + (daysLeft > 1 ? 's' : '') + '. Regularize o pagamento!';
        pushNotif(s, 'aviso', msg);
        sendOwnerWhats(s, '💳 *Aviso no ' + s.name + '!* ' + msg + '\n\nQuer pagar antes do vencimento? Abra seu painel → card "💳 Minha assinatura" → Gerar Pix. Caiu o pagamento, a baixa é sozinha.\n' + PUBLIC_URL + '/app?slug=' + s.slug);
        writeSalon(s);
      }
    }
  });
  if (dirty || suspended || extended || reminded) saveDB();
  return { suspended, extended, reminded };
}

/* ---------------- lembretes automáticos ---------------- */
/* ============================================================
   BOT DE WHATSAPP (respostas automáticas — sem custo de IA)
   Usa o Z-API já configurado. Recebe webhook em /api/bot/webhook
   ============================================================ */
function normText(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
function hasAny(s, words){ return words.some(w => s.includes(w)); }
function botMenuCliente(s){
  return 'Oi. Aqui é o *' + (s && s.name ? s.name : 'espaço') + '*.\n\n' +
    'Posso te ajudar com:\n' +
    '1. Serviços e valores\n' +
    '2. Agendar\n' +
    '3. Horário de funcionamento\n' +
    '4. Endereço e contato\n' +
    '5. Cancelar\n' +
    '6. Falar com a gente\n\n' +
    'Pode responder com o número ou escrever o que precisa.';
}
function botMenuDono(){
  return 'Oi. Aqui é o suporte do *BoraAgendar*.\n\n' +
    '1. Senha / acesso\n' +
    '2. Configurar o espaço\n' +
    '3. Pagamento da assinatura\n' +
    '4. Falar com uma pessoa\n\n' +
    'Responda com o número ou escreva sua dúvida.';
}
function isPlatformWhatsInstance(inst, gw) {
  const i = String(inst || '').trim();
  const z = String((gw && gw.zapi && gw.zapi.instance) || '').trim();
  const zs = String((gw && gw.zapster && gw.zapster.instance) || '').trim();
  /* Sem instance no payload da Zapster (formato oficial do webhook), esta
     instância única da plataforma é o destino. */
  if (!i) return true;
  if (z && i === z) return true;
  if (zs && i === zs) return true;
  if (i === PLATFORM_ZAPSTER_INSTANCE) return true;
  return false;
}
function phonesMatch(a, b) {
  const da = phoneDigits(a);
  const dbp = phoneDigits(b);
  if (!da || !dbp) return false;
  if (da.length < 8 || dbp.length < 8) return da === dbp;
  return da.slice(-8) === dbp.slice(-8);
}
function salonBotInstance(s) {
  return clipText(s && s.cfg && s.cfg.botInstance, 80);
}
/* Retorna TODOS os salões ligados a uma instância (uma instância pode atender
   vários salões — ex.: a instância da plataforma / número compartilhado). */
function salonsByBotInstance(inst) {
  const i = String(inst || '');
  if (!i) return [];
  const out = [];
  for (const x of db.salons) {
    const s = readSalon(x.slug);
    if (s && salonBotInstance(s) === i) out.push(s);
  }
  return out;
}
function findSalonByBotInstance(inst) {
  return salonsByBotInstance(inst)[0] || null;
}
function findSalonByWhatsPhone(phone) {
  if (!phoneDigits(phone) || phoneDigits(phone).length < 8) return null;
  for (const x of db.salons) {
    const s = readSalon(x.slug);
    if (!s || !s.cfg) continue;
    if (phonesMatch(s.cfg.contactPhone, phone) || phonesMatch(s.cfg.notifyPhone, phone) || phonesMatch(s.cfg.botPhone, phone)) return s;
  }
  return null;
}
function findSalonByOwnerPhone(from) {
  if (!phoneDigits(from) || phoneDigits(from).length < 8) return null;
  for (const x of db.salons) {
    const s = readSalon(x.slug);
    if (!s || !s.cfg) continue;
    if (phonesMatch(s.cfg.notifyPhone, from) || phonesMatch(s.cfg.contactPhone, from)) return s;
  }
  return null;
}
function pickWhatsInst(body, req) {
  const h = (req && req.headers) || {};
  const data = (body && body.data) || {};
  const instObj = (typeof body.instance === 'object' && body.instance) || (typeof data.instance === 'object' && data.instance) || {};
  return String(
    h['x-instance-id'] || h['x-instance'] || h['x-zapster-instance'] || h['x-zapster-instance-id'] ||
    body.instance_id || body.instanceId || (typeof body.instance === 'string' ? body.instance : '') ||
    instObj.id || instObj.instance_id || instObj.instanceId ||
    data.instance_id || data.instanceId || (typeof data.instance === 'string' ? data.instance : '') ||
    ''
  ).trim();
}
function looksLikeBrPhone(s) {
  const d = digitsOnly(s);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return true;
  if (d.length === 10 || d.length === 11) return true;
  return false;
}
function isOwnPlatformWhats(num) {
  const d = phoneDigits(num);
  if (!d) return false;
  if (phonesMatch(d, '21992927535') || phonesMatch(d, '992927535')) return true;
  const gw = db.gateway || {};
  const bot = (gw.zapster && (gw.zapster.phone || gw.zapster.number || gw.zapster.wid)) || '';
  if (bot && phonesMatch(d, bot)) return true;
  return false;
}
function pickWhatsFrom(body) {
  const data = (body && body.data) || {};
  const sender = data.sender || body.sender || {};
  const rec = data.recipient || body.recipient || {};
  const cands = [sender.phone_number, sender.phone, sender.id, rec.phone_number, rec.phone, rec.id, body.from, body.phone];
  const phones = [];
  for (let i = 0; i < cands.length; i++) {
    if (looksLikeBrPhone(cands[i])) phones.push(digitsOnly(cands[i]));
  }
  for (let i = 0; i < phones.length; i++) {
    if (!isOwnPlatformWhats(phones[i])) return phones[i];
  }
  if (phones.length) return phones[0];
  return String(
    sender.phone_number || sender.phone || sender.id ||
    rec.phone_number || rec.phone || rec.id ||
    body.from || body.phone ||
    (data.phone && (data.phone.phone || data.phone)) ||
    (data.message && (data.message.contactPhone || data.message.from)) ||
    ''
  ).replace(/\D/g, '');
}
function pickWhatsReplyTo(body) {
  const from = pickWhatsFrom(body);
  if (looksLikeBrPhone(from) && !isOwnPlatformWhats(from)) return intlWhatsNumber(from);
  const data = (body && body.data) || {};
  const sender = data.sender || body.sender || {};
  const rec = data.recipient || body.recipient || {};
  const cands = [sender.phone_number, sender.phone, sender.id, rec.phone_number, rec.phone, rec.id];
  for (let i = 0; i < cands.length; i++) {
    if (looksLikeBrPhone(cands[i]) && !isOwnPlatformWhats(cands[i])) return intlWhatsNumber(cands[i]);
  }
  if (looksLikeBrPhone(from)) return intlWhatsNumber(from);
  if (sender.id) return String(sender.id);
  return intlWhatsNumber(from);
}
function pushBotLog(row) {
  try {
    ensureDBShape();
    db.botLog = Array.isArray(db.botLog) ? db.botLog : [];
    db.botLog.unshift({
      at: new Date().toISOString(),
      inst: clipText(row && row.inst, 40),
      from: clipText(row && row.from, 20),
      text: clipText(row && row.text, 80),
      reply: clipText(row && row.reply, 80),
      ignored: clipText(row && row.ignored, 40),
      salon: clipText(row && row.salon, 40),
      channel: clipText(row && row.channel, 20),
      sendOk: !!(row && row.sendOk),
      sendErr: clipText(row && row.sendErr, 160),
      type: clipText(row && row.type, 40)
    });
    if (db.botLog.length > 40) db.botLog.length = 40;
    saveDB();
  } catch (e) {}
}
function pickWhatsText(body) {
  const data = (body && body.data) || {};
  const content = data.content || {};
  const msg = data.message || {};
  const media = content.media || {};
  return String(
    content.text || content.body || content.caption || media.caption ||
    (content.message && content.message.text) ||
    (typeof body.message === 'string' ? body.message : '') ||
    body.text ||
    msg.message || msg.text || msg.body || msg.caption ||
    (msg.message && msg.message.message) ||
    ''
  ).trim();
}
function pickWhatsMsgKind(body) {
  const data = (body && body.data) || {};
  return String((data && data.type) || body.messageType || (data.content && data.content.type) || '').toLowerCase();
}
function pickWhatsConnectedPhone(body) {
  const data = (body && body.data) || {};
  const inst = body.instance || data.instance || {};
  return String(
    body.connectedPhone || body.connected_phone ||
    data.connectedPhone || data.connected_phone ||
    inst.phone || inst.phone_number || inst.wid ||
    data.wid || body.wid ||
    ''
  );
}
function isKnownWhatsInstance(inst, gw, connectedPhone) {
  if (isPlatformWhatsInstance(inst, gw)) return true;
  if (findSalonByBotInstance(inst)) return true;
  if (findSalonByWhatsPhone(connectedPhone)) return true;
  if (!inst && !connectedPhone) return true;
  return false;
}
function platformInstanceId() {
  const gw = db.gateway || {};
  const saved = String((gw.zapster && gw.zapster.instance) || (gw.zapi && gw.zapi.instance) || '').trim();
  return saved || PLATFORM_ZAPSTER_INSTANCE;
}
/* ================= UM NÚMERO SÓ PARA TODOS OS ESPAÇOS (modo concierge) =================
   Um único WhatsApp (o da plataforma) atende as clientes de todos os salões.
   O bot pergunta de qual espaço a pessoa quer falar, guarda a escolha por
   CLIENT_SALON_TTL e responde com o catálogo, os valores, o expediente, o
   endereço e o link daquele salão — cada espaço com a sua identidade.
   Custo: 1 instância só, em vez de uma por salão. */
const CLIENT_SALON_TTL = 6 * 60 * 60 * 1000; /* a escolha da cliente vale 6 horas */
function conciergeOn() {
  const gw = db.gateway || {};
  return gw.botConcierge !== false;
}
/* Número compartilhado = o da plataforma (ou payload sem id de instância,
   que é o formato da Zapster: sempre chega no número da plataforma). */
function isSharedWhatsInstance(inst, gw) {
  const i = String(inst || '').trim();
  if (!i) return true;
  if (isPlatformWhatsInstance(i, gw)) return true;
  return conciergeOn() && i === platformInstanceId();
}
/* A pessoa quer falar de outro espaço? */
function wantsSwitchSalon(text) {
  const t = stripForIntent(text);
  if (!t) return false;
  return hasAny(t, ['trocar de salao', 'trocar de espaco', 'trocar o salao', 'trocar o espaco',
    'mudar de salao', 'mudar de espaco', 'mudar o salao', 'mudar o espaco',
    'outro salao', 'outros saloes', 'outro espaco', 'outro estabelecimento', 'outro negocio',
    'nao e esse salao', 'nao era esse salao', 'era outro salao', 'falar com outro espaco']);
}
/* Pede algo que só o atendimento de um espaço resolve (valores, agenda, expediente). */
function conciergeClientLikely(text) {
  const t = stripForIntent(text);
  if (!t || isNonTextWhats(text)) return false;
  if (isClientBookingIntent(text)) return true;
  return hasAny(t, ['valor', 'preco', 'tabela', 'catalogo', 'cardapio', 'quanto custa', 'quanto sai',
    'servico', 'procedimento', 'agenda', 'vaga', 'disponibilidade', 'que horas', 'abre hoje',
    'endereco', 'onde fica', 'cancelar', 'remarcar', 'corte', 'barba', 'unha', 'cabelo',
    'escova', 'sobrancelha', 'maquiagem', 'alisamento', 'progressiva', 'penteado', 'manicure', 'pedicure']);
}
/* Só conversa fiada / emoji / risada: não merece resposta num número pessoal. */
function isWhatsNoise(text) {
  const t = stripForIntent(text);
  if (!t || isNonTextWhats(text)) return true;
  if (/^(k+|haha+|rs+|kk+|kkkk+|lol|jkk+|hue+|aff+|uai|ehhe+|hehe+)$/.test(t)) return true;
  if (/^(vlw|valeu|obg|obgd|obrigad[ao]|tmj|blz|blz+|beleza|ok+|okey|joia|show|top+|topzera|bjs+|beijos?|sim$|nao$|amem|amei|aham|entendi|anotado|kk)$/.test(t)) return true;
  if (t.split(/\s+/).length <= 1 && t.length <= 4) return true;
  return false;
}
function shouldStaySilent(text) {
  if (!isWhatsNoise(text)) return false;
  const t = stripForIntent(text) || normText(text);
  return !isClientGreeting(t);
}
/* Lista os espaços ativos e guarda a escolha pendente (routeSharedClient resolve o número). */
function conciergeAskRecent(from, minutes) {
  const k = 'w:lastask:' + phoneDigits(from);
  return (Date.now() - Number((db.clientPending || {})[k] || 0)) < (minutes || 30) * 60 * 1000;
}
function conciergeSalonList(from, force, quietMin) {
  const list = listLiveSalons();
  if (!list.length) return null;
  if (list.length === 1) {
    const only = list[0];
    setClientSalon(from, only.slug);
    return 'Certo, *' + (only.name || 'o espaço') + '*. Veja o que posso responder:\n\n' +
      '1. Serviços e valores\n2. Agendar\n3. Horário de funcionamento\n4. Endereço e contato\n5. Cancelar\n6. Falar com a equipe\n\nResponda com o número ou escreva o que você precisa.';
  }
  /* Perguntou e a pessoa não escolheu: não fica repetindo a lista atrás dela. */
  if (!force && conciergeAskRecent(from, quietMin)) return null;
  const lines = list.map((s, i) => (i + 1) + '. ' + (s.name || s.slug));
  db.clientPending = db.clientPending || {};
  db.clientPending['w:pending:' + phoneDigits(from)] = list.map(s => s.slug);
  db.clientPending['w:lastask:' + phoneDigits(from)] = Date.now();
  saveDB();
  setPlatMenu(from, null); /* numeração desta lista vale 1..N — zera o menu antigo */
  return 'Para eu te passar os serviços e os valores certos, me diz de qual espaço você quer falar:\n\n' +
    lines.join('\n') +
    '\n\nPode mandar o número ou escrever o nome do espaço. Quando quiser trocar, é só dizer *trocar de salão*.';
}
/* Resposta de cliente para um salão. Na instância compartilhada o bot fica
   quieto em conversa fiada; no número do próprio salão ele sempre ajuda. */
async function salonClientReply(salon, from, rawMsg, forceMenu) {
  let reply = buildBotReply(salon, from, rawMsg, { audience: 'client' });
  if (reply) return reply;
  const t = stripForIntent(rawMsg) || normText(rawMsg);
  if (forceMenu) return buildBotReply(salon, from, 'menu', { audience: 'client' });
  if (isClientGreeting(t) || isClientBookingIntent(rawMsg)) return buildBotReply(salon, from, 'menu', { audience: 'client' });
  if (!isWhatsNoise(rawMsg)) {
    const ai = await maybeAiReply(salon, rawMsg, botVoice(salon, from));
    if (ai) return ai;
  }
  return null;
}
/* ID de instância é de UM salão por vez (número próprio). Quando a dona de
   outro espaço cola o mesmo ID, o bot responderia pelo catálogo errado — foi
   assim que apareceram informações de outra barbearia. A instância da
   plataforma é compartilhada de propósito e por isso fica intacta. */
function detachInstanceFromOthers(inst, keepSlug) {
  const i = String(inst || '').trim();
  if (!i) return [];
  if (i === platformInstanceId()) return [];
  const cleared = [];
  for (const x of (db.salons || [])) {
    if (!x || !x.slug || x.slug === keepSlug) continue;
    const other = readSalon(x.slug);
    if (!other || !other.cfg) continue;
    if (salonBotInstance(other) === i) {
      other.cfg.botInstance = '';
      try { writeSalon(other); cleared.push(x.slug); } catch (e) { /* ignore */ }
    }
  }
  if (cleared.length) console.log('🧹 Instância ' + i + ' saiu de ' + cleared.join(', ') + ' — agora é só de ' + keepSlug);
  return cleared;
}
/* ---- roteador para instância única (dono E clientes de vários salões) ---- */
function clientCtxKey(from){ return 'w:' + phoneDigits(from); }
/* Descobre o salão citado no texto: pelo link (?slug=), pelo "Código: slug"
   que o botão do app manda, ou pelo nome do salão escrito na mensagem. */
function findSalonInText(text){
  const raw = String(text || '');
  const t = normText(raw); /* sem acentos e minúsculas */
  let slug = null;
  /* Link público: ?slug=... (com ou sem /app à frente) */
  const mSlug = raw.match(/[/?&]slug=([a-z0-9-]+)/i);
  if (mSlug) slug = mSlug[1];
  /* "código: X" — usa o texto sem acento para pegar também o "Código" com acento */
  if (!slug) { const c = t.match(/\bcodigo\s*:?\s*([a-z0-9-]+)/); if (c) slug = c[1]; }
  if (slug) { const rs = readSalonResolved(slug); if (rs) return rs.salon; }
  /* Compara pelo nome normalizado, ignorando diferenças de hífen/espaço.
     Ex.: mensagem com "sala-da-cintia" acha o salão "Sala da Cíntia". */
  for (const x of (db.salons || [])) {
    if (!x || !x.slug) continue;
    const name = normKey(x.name || '');
    if (!name || name.length < 3) continue;
    const compactName = name.replace(/[\s-]+/g, '');
    const compactT = t.replace(/[\s-]+/g, '');
    if (t.includes(name) || compactT.includes(compactName)) {
      const rs = readSalonResolved(x.slug);
      if (rs) return rs.salon;
    }
  }
  return null;
}
function setClientSalon(from, salon){
  db.clientSalon = db.clientSalon || {};
  const k = clientCtxKey(from);
  if (!salon) { delete db.clientSalon[k]; saveDB(); return; }
  db.clientSalon[k] = { slug: String((salon && salon.slug) || salon || ''), at: Date.now() };
  const keys = Object.keys(db.clientSalon);
  if (keys.length > 800) keys.slice(0, keys.length - 800).forEach(x => delete db.clientSalon[x]);
  saveDB();
}
/* A lembrança vale CLIENT_SALON_TTL. Sem prazo, um número ficava preso para
   sempre num salão e toda mensagem seguinte recebia o catálogo daquele espaço. */
function getClientSalon(from){
  db.clientSalon = db.clientSalon || {};
  const k = clientCtxKey(from);
  const v = db.clientSalon[k];
  if (!v) return '';
  if (typeof v === 'string') { db.clientSalon[k] = { slug: v, at: Date.now() }; saveDB(); return v; }
  if (!v.slug) return '';
  if (conciergeOn() && (Date.now() - Number(v.at || 0)) > CLIENT_SALON_TTL) { delete db.clientSalon[k]; saveDB(); return ''; }
  return v.slug;
}
function clearClientSalon(from){ setClientSalon(from, null); }
function platMenuKey(from){ return 'w:platmenu:' + phoneDigits(from); }
function setPlatMenu(from, v){
  db.clientPending = db.clientPending || {};
  db.clientPending[platMenuKey(from)] = v || null;
  saveDB();
}
function getPlatMenu(from){ return (db.clientPending || {})[platMenuKey(from)] || null; }
function listLiveSalons(){
  return (db.salons || []).map(x => readSalon(x.slug)).filter(Boolean);
}
function platformWelcomeText(){
  const opened = platformOpenWelcome('');
  return opened.text;
}
function platformOpenWelcome(from){
  const list = listLiveSalons();
  const slugs = list.map(s => s.slug);
  const lines = [];
  lines.push('Oi, tudo bem?');
  lines.push('Aqui é o *BoraAgendar*.');
  lines.push('');
  lines.push('Me conta como posso te ajudar:');
  lines.push('');
  lines.push('*Abrir meu espaço*');
  lines.push('1. Quero o teste grátis de ' + ((db.gateway && Number(db.gateway.trialDays)) || 15) + ' dias');
  if (list.length) {
    lines.push('');
    lines.push('*Sou cliente e quero agendar*');
    list.forEach((s, i) => lines.push((i + 2) + '. ' + s.name));
  }
  const supportN = list.length + 2;
  lines.push('');
  lines.push('*Já uso o BoraAgendar*');
  lines.push(supportN + '. Preciso de ajuda com minha conta');
  lines.push('');
  lines.push('Pode mandar o número — ou o nome do salão, se preferir.');
  if (from) setPlatMenu(from, { kind: 'welcome', slugs: slugs, supportN: supportN });
  return { text: lines.join('\n'), slugs: slugs, supportN: supportN };
}
function isClientBookingIntent(text){
  const t = stripForIntent(text) || normText(text);
  if (!t) return false;
  return hasAny(t, ['agendar','marcar','vaga','horario','servico','preco','quanto custa','cancelar','endereco','onde fica']);
}
/* Instância única: se quem escreve não é dono (já tratado na rota), o bot atende
   como cliente e precisa saber de qual salão. Tenta o código/link/nome do texto;
   senão volta a usar o salão já lembrado para aquele número; senão pede na lista. */
async function routeSharedClient(inst, from, rawMsg, gw){
  const d = phoneDigits(from);
  const numeric = normText(rawMsg).replace(/\s/g, '').replace(/[.)]/g, '');
  const pendingKey = 'w:pending:' + d;
  const pending = (db.clientPending || {})[pendingKey];
  /* Tinha uma lista de espaços em aberto e a pessoa respondeu com o número. */
  if (pending && Array.isArray(pending) && /^\d{1,2}$/.test(numeric)) {
    const n = parseInt(numeric, 10);
    if (n >= 1 && n <= pending.length) {
      const slug = pending[n - 1];
      const rs = readSalonResolved(slug);
      db.clientPending = db.clientPending || {}; db.clientPending[pendingKey] = null; saveDB();
      setPlatMenu(from, null);
      if (rs) {
        setClientSalon(from, rs.salon.slug);
        /* Ela só escolheu o espaço — ainda não pediu nada. Mostra o menu dele. */
        const reply = buildBotReply(rs.salon, from, 'menu', { audience: 'client' });
        return { reply, salon: rs.salon, role: 'client', channel: 'concierge', ignored: null };
      }
    }
  }
  /* "trocar de salão" / "não é esse" — esquece o espaço e pergunta de novo. */
  if (wantsSwitchSalon(rawMsg)) {
    clearClientSalon(from);
    const reply = conciergeSalonList(from, true);
    return { reply, salon: null, role: 'client', channel: 'concierge', ignored: reply ? null : 'no-salons' };
  }
  /* Espaço citado na mensagem (nome, link ?slug= ou "Código: xxx"). */
  const found = findSalonInText(rawMsg);
  if (found) {
    setClientSalon(from, found.slug);
    const reply = await salonClientReply(found, from, rawMsg, false);
    return { reply, salon: found, role: 'client', channel: 'concierge', ignored: reply ? null : 'not-customer-intent' };
  }
  /* Número que já escolheu um espaço (vale CLIENT_SALON_TTL). */
  const known = getClientSalon(from);
  if (known) {
    const rs = readSalonResolved(known);
    if (rs) {
      const reply = await salonClientReply(rs.salon, from, rawMsg, false);
      return { reply, salon: rs.salon, role: 'client', channel: 'concierge', ignored: reply ? null : 'not-customer-intent' };
    }
  }
  /* Conversa fiada de contato pessoal, sem espaço: o bot fica quieto. */
  if (shouldStaySilent(rawMsg)) return { reply: null, salon: null, role: 'unknown', channel: 'concierge', ignored: 'noise' };
  /* Não sabemos de qual espaço ela fala: pergunta. */
  /* Preciso de verdade (preço, agenda, trocar) → pergunta de novo. Só "oi" → espera 5 min. */
  const t0 = stripForIntent(rawMsg);
  const forcar = conciergeClientLikely(rawMsg);
  const reply = conciergeSalonList(from, forcar, isClientGreeting(t0) ? 5 : 30);
  if (!reply) return { reply: null, salon: null, role: 'unknown', channel: 'concierge', ignored: listLiveSalons().length ? 'perguntado-ha-pouco' : 'no-salons' };
  return { reply, salon: null, role: 'client', channel: 'concierge', ignored: null };
}
async function routeWhatsBot(inst, from, rawMsg, gw, connectedPhone) {
  /* Payload Zapster oficial não traz instance_id — assume a instância da plataforma. */
  inst = String(inst || '').trim() || platformInstanceId();
  /* Modo concierge: o número da plataforma atende as clientes de TODOS os espaços.
     Por isso ele nunca é tratado como linha exclusiva de um salão — foi assim que
     uma cliente de um espaço recebeu a tabela de preços do outro. */
  const attached = salonsByBotInstance(inst);
  /* Com o concierge desligado volta o critério antigo: se a instância é de um só
     salão, aquele número é tratado como linha exclusiva dele. */
  const shared = conciergeOn() ? isSharedWhatsInstance(inst, gw)
                               : (attached.length !== 1 && isPlatformWhatsInstance(inst, gw));
  /* Instância dedicada a UM único salão (número próprio do espaço). */
  if (!shared && attached.length === 1) {
    let salon = attached[0];
    /* Se a cliente cita OUTRO espaço (nome, link ?slug= ou "Código:"), respeita a
       escolha — importa quando um mesmo número atende 2+ negócios. */
    const cited = findSalonInText(rawMsg);
    if (cited && cited.slug !== salon.slug) {
      salon = cited;
      setClientSalon(from, salon.slug);
    }
    if (connectedPhone && !salon.cfg.botPhone) {
      salon.cfg = salon.cfg || {};
      salon.cfg.botPhone = clipText(connectedPhone, 30);
      try { writeSalon(salon); } catch (e) {}
    }
    const reply = await salonClientReply(salon, from, rawMsg, true);
    return { reply, salon, role: 'client', channel: 'salon', ignored: reply ? null : 'not-customer-intent' };
  }
  /* Número compartilhado (plataforma) ou instância que atende 2+ espaços:
     DONO (número de avisos/contato) → suporte · LEAD (teste/plano) → bot da
     plataforma · resto → CLIENTE de um espaço (catálogo, valores, link dele). */
  if (shared || attached.length > 1) {
    /* Cliente que já citou ou já escolheu um espaço: nunca vira lead no meio da conversa. */
    const pendList = (db.clientPending || {})['w:pending:' + phoneDigits(from)];
    const hasSalonContext = (Array.isArray(pendList) && pendList.length > 0) ||
      !!(findSalonInText(rawMsg) || getClientSalon(from) || wantsSwitchSalon(rawMsg));
    if (hasSalonContext) return await routeSharedClient(inst, from, rawMsg, gw);
    const ownerSalon = findSalonByOwnerPhone(from);
    if (ownerSalon) {
      const reply = buildBotReply(ownerSalon, from, rawMsg, { audience: 'owner' });
      return { reply, salon: ownerSalon, role: 'owner', channel: 'platform', ignored: reply ? null : 'owner-ignore' };
    }
    /* Menu do "oi": 1 cadastro · 2..N+1 salões · último = suporte de dono. */
    const platPend = getPlatMenu(from);
    const platOpt = (stripForIntent(rawMsg) || normText(rawMsg)).replace(/\s/g, '').replace(/[.)]/g, '');
    if (platPend && (platPend === 'menu' || platPend.kind === 'welcome') && /^\d{1,2}$/.test(platOpt)) {
      const n = parseInt(platOpt, 10);
      const slugs = (platPend && platPend.slugs) || listLiveSalons().map(s => s.slug);
      const supportN = (platPend && platPend.supportN) || (slugs.length + 2);
      if (n === 1) {
        setPlatMenu(from, null);
        const lead = buildPlatformBotReply('quero testar o bora agendar', from, inst);
        return { reply: lead ? lead.reply : platformOpenWelcome(from).text, salon: null, role: 'lead', channel: 'platform', ignored: null };
      }
      if (n === supportN) {
        setPlatMenu(from, null);
        const reply = buildBotReply({ name: 'BoraAgendar', plan: 'Pro', cfg: {}, services: [], pros: [] }, from, 'menu', { audience: 'owner' });
        return { reply, salon: null, role: 'owner', channel: 'platform', ignored: reply ? null : 'owner-ignore' };
      }
      const salonIdx = n - 2;
      if (salonIdx >= 0 && salonIdx < slugs.length) {
        setPlatMenu(from, null);
        const rs = readSalonResolved(slugs[salonIdx]);
        if (rs) {
          setClientSalon(from, rs.salon.slug);
          const reply = buildBotReply(rs.salon, from, 'menu', { audience: 'client' });
          return { reply, salon: rs.salon, role: 'client', channel: 'concierge', ignored: reply ? null : 'not-customer-intent' };
        }
      }
    }
    /* Lead de venda (teste grátis, plano, cadastro). */
    const leadReply = buildPlatformBotReply(rawMsg, from, inst);
    if (leadReply) {
      setPlatMenu(from, null);
      return { reply: leadReply.reply, salon: null, role: 'lead', channel: 'platform', ignored: null };
    }
    /* Pergunta concreta de cliente (preço, agenda, expediente, endereço): o espaço dela. */
    if (conciergeClientLikely(rawMsg)) {
      return await routeSharedClient(inst, from, rawMsg, gw);
    }
    /* Só cumprimentou: menu único da plataforma (abrir espaço · cliente de cada espaço · suporte). */
    if (isClientGreeting(stripForIntent(rawMsg))) {
      const opened = platformOpenWelcome(from);
      return { reply: opened.text, salon: null, role: 'lead', channel: 'platform', ignored: null };
    }
    /* O resto é conversa particular de quem escreveu num número pessoal: fica quieto. */
    return { reply: null, salon: null, role: 'unknown', channel: 'platform', ignored: shouldStaySilent(rawMsg) ? 'noise' : 'no-intent' };
  }
  /* Instância que o sistema ainda não conhece, mas o número conectado é de um salão. */
  const salon = findSalonByWhatsPhone(connectedPhone);
  if (salon) {
    if (inst && !salonBotInstance(salon)) {
      salon.cfg = salon.cfg || {};
      salon.cfg.botInstance = String(inst);
      try { writeSalon(salon); } catch (e) {}
    }
    if (connectedPhone && !salon.cfg.botPhone) {
      salon.cfg = salon.cfg || {};
      salon.cfg.botPhone = clipText(connectedPhone, 30);
      try { writeSalon(salon); } catch (e) {}
    }
    const reply = await salonClientReply(salon, from, rawMsg, true);
    return { reply, salon, role: 'client', channel: 'salon', ignored: reply ? null : 'not-customer-intent' };
  }
  /* Instância desconhecida ou payload sem id: atende como plataforma (lista de espaços / lead). */
  const ownerSalon2 = findSalonByOwnerPhone(from);
  if (ownerSalon2) {
    const reply = buildBotReply(ownerSalon2, from, rawMsg, { audience: 'owner' });
    return { reply, salon: ownerSalon2, role: 'owner', channel: 'platform', ignored: reply ? null : 'owner-ignore' };
  }
  const lead2 = buildPlatformBotReply(rawMsg, from, inst);
  if (lead2) return { reply: lead2.reply, salon: null, role: 'lead', channel: 'platform', ignored: null };
  if (conciergeClientLikely(rawMsg)) return await routeSharedClient(inst, from, rawMsg, gw);
  if (isClientGreeting(stripForIntent(rawMsg))) {
    const opened2 = platformOpenWelcome(from);
    return { reply: opened2.text, salon: null, role: 'lead', channel: 'platform', ignored: null };
  }
  return { reply: null, salon: null, role: 'unknown', channel: 'platform', ignored: shouldStaySilent(rawMsg) ? 'noise' : 'no-intent' };
}
async function zapsterEnsureWebhook(instanceId) {
  const inst = String(instanceId || '').trim();
  if (!zapsterAuth() || !inst) return { ok: false, error: 'Zapster não configurada' };
  const hookUrl = PUBLIC_URL + '/api/bot/webhook';
  const events = ['message.received'];
  const details = await zapsterReq('GET', '/v1/wa/instances/' + encodeURIComponent(inst));
  const hooks = (details.data && details.data.webhooks) || [];
  const mine = hooks.find(h => h && (h.url === hookUrl || String(h.name || '') === 'BoraAgendar'));
  let r;
  if (mine && mine.id) {
    r = await zapsterReq('PATCH', '/v1/wa/instances/' + encodeURIComponent(inst) + '/webhooks/' + encodeURIComponent(mine.id), {
      events: events, enabled: true, name: 'BoraAgendar', url: hookUrl
    });
  } else {
    r = await zapsterReq('POST', '/v1/wa/instances/' + encodeURIComponent(inst) + '/webhooks', {
      events: events, enabled: true, name: 'BoraAgendar', url: hookUrl
    });
  }
  const id = r && r.data && (r.data.id || r.data.webhook_id);
  return { ok: !!(r && r.ok), id: id, url: hookUrl, status: r && r.status, error: (r && r.ok) ? null : zapsterErr(r && r.data) };
}
function zapsterAuth() {
  const zap = (db.gateway && db.gateway.zapster) || {};
  const base = String(zap.baseUrl || 'https://api.zapsterapi.com').replace(/\/$/, '');
  const token = String(zap.token || '');
  if (!base || !token) return null;
  return { base, token };
}
function zapsterErr(data) {
  if (!data) return 'Falha na Zapster';
  if (typeof data === 'string') return clipText(data, 220);
  if (Array.isArray(data.errors) && data.errors[0]) return clipText(data.errors[0].message || data.errors[0].code || 'erro', 220);
  if (data.message) return clipText(data.message, 220);
  if (data.error) return clipText(typeof data.error === 'string' ? data.error : JSON.stringify(data.error), 220);
  return 'Falha na Zapster';
}
function zapsterReq(method, path, body) {
  const z = zapsterAuth();
  if (!z) return Promise.resolve({ ok: false, error: 'Zapster não configurada' });
  const opts = { method: method || 'GET', headers: { 'Authorization': 'Bearer ' + z.token, 'Accept': 'application/json' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(z.base + path, opts).then(async r => {
    const ct = String(r.headers.get('content-type') || '');
    let data = null;
    if (ct.indexOf('json') >= 0) { try { data = await r.json(); } catch (e) { data = null; } }
    else { try { data = await r.text(); } catch (e) { data = null; } }
    return { ok: r.ok, status: r.status, data };
  }).catch(e => ({ ok: false, error: e.message }));
}
function intlWhatsNumber(s) {
  let d = digitsOnly(s);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('55') && d.length >= 12) return d.slice(0, 13);
  d = phoneDigits(s);
  if (d.length < 10) return '';
  return '55' + d;
}
function isWhatsConnectedStatus(st) {
  const s = String(st || '').toLowerCase();
  return s === 'connected' || s === 'open' || s === 'ready' || s === 'online' || s === 'authenticated';
}
function pruneWaConnect() {
  ensureDBShape();
  const now = Date.now();
  Object.keys(db.waConnect).forEach(k => {
    const row = db.waConnect[k];
    if (!row || (row.exp && row.exp < now)) delete db.waConnect[k];
  });
}
/* ============================================================
   NÚMERO PRÓPRIO: só a ADMINISTRAÇÃO cria/conecta (qualquer plano).
   A rota de autoatendimento da dona devolve 403 com o passo a passo do
   suporte; o painel (rota /api/admin/...whats-connect, PATCH botInstance e
   o seletor de instâncias Zapster) segue 100% nas suas mãos — assim todo
   pareamento nasce certo e nenhum plano dá custo Zapster por engano.
   Limpar o campo pela dona continua livre (desligar nunca é bloqueado). */
function salonPlanStatus(s) {
  const meta = (db.salons || []).find(function (x) { return x.slug === (s && s.slug); });
  return {
    status: String((meta && meta.status) || (s && s.status) || '').toLowerCase(),
    plan: String((meta && meta.plan) || (s && s.plan) || '').toLowerCase()
  };
}
function canOwnInstance(s) {
  if (!s) return false;
  return salonPlanStatus(s).plan === 'premium';
}
function issueWaConnectToken(salon) {
  pruneWaConnect();
  Object.keys(db.waConnect).forEach(k => {
    if (db.waConnect[k] && db.waConnect[k].slug === salon.slug) delete db.waConnect[k];
  });
  const token = crypto.randomBytes(12).toString('hex');
  db.waConnect[token] = {
    slug: salon.slug,
    instanceId: salonBotInstance(salon),
    exp: Date.now() + 7 * 864e5,
    createdAt: Date.now()
  };
  salon.cfg = salon.cfg || {};
  salon.cfg.waConnectToken = token;
  saveDB();
  writeSalon(salon);
  return token;
}
function getWaConnect(token) {
  pruneWaConnect();
  const row = db.waConnect[String(token || '')];
  if (!row) return null;
  const s = readSalon(row.slug);
  if (!s) return null;
  return { token: String(token), salon: s, instanceId: salonBotInstance(s) || row.instanceId, row };
}
function zapsterCreateFailMsg(r) {
  const raw = zapsterErr(r && r.data) || (r && r.error) || '';
  const t = String(raw).toLowerCase();
  if (r && (r.status === 402 || r.status === 403 || r.status === 409 || /limit|quota|plano|plan|subscription|máximo|maximo|already/.test(t))) {
    return 'A Zapster não criou outra instância (plano cobra por instância). No painel da Zapster toque em + Nova Instância. Se o número do salão já está conectado numa instância, anexe o ID dela no salão.';
  }
  return raw || 'Não foi possível criar a instância na Zapster';
}
async function provisionSalonWhats(s, phone, attachId) {
  if (!zapsterAuth()) return { ok: false, error: 'Zapster não configurada. Em Configurações, cole a URL, o token e a instância da plataforma.' };
  s.cfg = s.cfg || {};
  const plat = platformInstanceId();
  if (attachId) {
    const id = clipText(attachId, 80);
    if (!id) return { ok: false, error: 'ID da instância vazio' };
    s.cfg.botInstance = id;
    if (phone) {
      s.cfg.contactPhone = clipText(phone, 30);
      if (!s.cfg.botPhone) s.cfg.botPhone = clipText(phone, 30);
    }
    writeSalon(s);
    const clearedFrom = detachInstanceFromOthers(id, s.slug);
    await zapsterEnsureWebhook(id);
    return { ok: true, instanceId: id, created: false, attached: true, clearedFrom, sameAsPlatform: !!(plat && plat === id), concierge: conciergeOn() };
  }
  let inst = salonBotInstance(s);
  if (inst && plat && inst === plat) inst = '';
  let created = false;
  if (!inst) {
    const payload = {
      connection_type: 'unofficial',
      name: clipText((s.name || s.slug) + ' · ' + s.slug, 80),
      metadata: { salon_slug: s.slug, customer_name: clipText(s.owner || s.name, 80) }
    };
    const intl = intlWhatsNumber(phone);
    if (intl) payload.metadata.phone_number = '+' + intl;
    const r = await zapsterReq('POST', '/v1/wa/instances', payload);
    const id = r.data && (r.data.id || r.data.instance_id);
    if (!r.ok || !id) return { ok: false, error: zapsterCreateFailMsg(r) };
    inst = String(id);
    s.cfg.botInstance = inst;
    created = true;
  }
  if (phone) {
    s.cfg.contactPhone = clipText(phone, 30);
    if (!s.cfg.botPhone) s.cfg.botPhone = clipText(phone, 30);
  }
  writeSalon(s);
  zapsterEnsureWebhook(inst).catch(function () {});
  zapsterReq('POST', '/v1/wa/instances/' + encodeURIComponent(inst) + '/power-on').catch(function () {});
  return { ok: true, instanceId: inst, created };
}
function waConnectUrl(token) {
  return PUBLIC_URL + '/conectar?t=' + encodeURIComponent(token);
}
function formatWaConnectInvite(s, url) {
  const nome = (s && s.name) || 'seu espaço';
  return 'Oi. Aqui é o *BoraAgendar*.\n\n' +
    'Para o bot responder as clientes no WhatsApp do *' + nome + '*, abra este link no celular (funciona de qualquer estado):\n\n' +
    url + '\n\n' +
    'Toque em *Gerar código agora*. Depois, no WhatsApp: Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone → digite o código.\n\n' +
    'Use o WhatsApp de atendimento do espaço, não o pessoal da família.';
}
async function startSalonWhatsConnect(s, opts) {
  opts = opts || {};
  const phone = clipText(opts.phone || (s.cfg && s.cfg.contactPhone) || (s.cfg && s.cfg.botPhone) || '', 30);
  const ready = await provisionSalonWhats(s, phone, opts.instanceId);
  if (!ready.ok) return ready;
  const token = issueWaConnectToken(s);
  const url = waConnectUrl(token);
  let invited = false;
  const invitePhone = clipText(opts.invitePhone || (s.cfg && s.cfg.notifyPhone) || phone, 30);
  if (opts.sendInvite !== false && phoneDigits(invitePhone).length >= 10) {
    whatsSend(invitePhone, formatWaConnectInvite(s, url)).catch(function () {});
    invited = true;
  }
  return {
    ok: true, connectUrl: url, token: token, instanceId: ready.instanceId, created: !!ready.created,
    attached: !!ready.attached, sameAsPlatform: !!ready.sameAsPlatform,
    clearedFrom: ready.clearedFrom || [], concierge: !!ready.concierge,
    invited: invited, invitePhone: invited ? invitePhone : '', phone: phone
  };
}
function isGroupWhatsEvent(body) {
  const data = (body && body.data) || {};
  if (body && (body.isGroup === true || body.is_group === true || body.group === true)) return true;
  if (data.isGroup === true || data.is_group === true || data.group === true) return true;
  const chat = String((data.chat && (data.chat.id || data.chat.jid)) || data.chatId || data.chat_id || body.chatId || '');
  const from = String(body.from || data.from || '');
  if (chat.includes('@g.us') || from.includes('@g.us') || chat.includes('@newsletter')) return true;
  if (data.sender && (data.sender.type === 'group' || data.sender.is_group)) return true;
  if (data.recipient && (data.recipient.type === 'group' || data.recipient.is_group)) return true;
  return false;
}
function isNonTextWhats(s) {
  const raw = String(s || '').trim();
  if (!raw) return true;
  const noEmoji = raw.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '');
  const letters = noEmoji.replace(/[^\p{L}\p{N}]+/gu, '');
  return !letters;
}
function stripForIntent(s){
  return String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function isClientGreeting(t){
  if (!t) return false;
  if (['oi','ola','oie','oii','oiii','hey','alo','eai','eae','fala','opa','menu','comecar','inicio','ajuda','help','bom dia','boa tarde','boa noite'].includes(t)) return true;
  if (/^(oi+|oie+|ola+|alo+|hey+|eai|eae|e ai|fala|opa)\b/.test(t) && t.length <= 48) return true;
  if (/^(bom dia|boa tarde|boa noite)\b/.test(t) && t.length <= 48) return true;
  return false;
}
function isAppQuestion(text){
  const s = stripForIntent(text) || normText(text) || '';
  if (!s) return false;
  if (hasAny(s, ['aplicativo','tela inicial','adicionar a tela','colocar na tela','baixar o app','baixar app','instalar o app','instalar app','instalar aplicativo','o aplicativo','esse app','este app'])) return true;
  if (/\bapp\b/.test(s) && !hasAny(s, ['whatsapp'])) return true;
  if (hasAny(s, ['como usa','como usar','como funciona','nao sei usar']) && hasAny(s, ['app','link','site','pagina','agendamento','aplicativo'])) return true;
  return false;
}
function platformAppExplain(){
  return 'O *BoraAgendar* é o sistema de agenda. Não precisa baixar aplicativo.\n\n' +
    '• *Cliente* — abre o link do salão no celular, escolhe o serviço e o horário.\n' +
    '• *Dono de espaço* — teste grátis de ' + ((db.gateway && Number(db.gateway.trialDays)) || 15) + ' dias, sem cartão: ' + PUBLIC_URL + '/trial\n\n' +
    'Você quer *agendar* num espaço ou *usar no seu negócio*?';
}
function classifyMessage(text, isDono){
  const t = stripForIntent(text) || normText(text);
  if (!t || isNonTextWhats(text)) return { type: 'ignore' };
  if (/^(k+|haha+|rs+|kkk+|kk+|lol|vlw|tmj|aff+|uai|jkk+|hue+)$/i.test(t)) return { type: 'ignore' };

  /* Atalhos numéricos do menu: funcionam com "2", "2." ou "2)" — só se a mensagem for só o número. */
  const option = t.replace(/\s/g, '').replace(/[.)]/g, '');
  const ownerOptions = { '1':'dono_senha', '2':'dono_config', '3':'dono_pagamento', '4':'dono_humano' };
  const clientOptions = { '1':'cli_servicos', '2':'cli_agendar', '3':'cli_horarios', '4':'cli_local', '5':'cli_cancelar', '6':'cli_humano' };
  if(isDono && ownerOptions[option]) return {type:ownerOptions[option]};
  if(!isDono && clientOptions[option]) return {type:clientOptions[option]};

  /* Saudação / menu — "oi tudo bem" e variações também entram. */
  if (isClientGreeting(t) || ['menu','comecar','inicio','ajuda','help'].includes(t)) return {type:'menu'};

  /* ----- suporte da responsável ----- */
  if(isDono){
    if(hasAny(t, ['senha','esqueci','trocar senha','acesso','login','entrar'])) return {type:'dono_senha'};
    if(hasAny(t, ['configurar','configura','logo','servicos','horario','como faco','como mudo','personalizar','cor'])) return {type:'dono_config'};
    if(hasAny(t, ['pagamento','pagar','assinatura','plano','cobranca','fatura','mensalidade','preco','valor do plano'])) return {type:'dono_pagamento'};
    if(hasAny(t, ['falar','humano','atendente','pessoa','suporte'])) return {type:'dono_humano'};
    return {type:'dono_generico'};
  }

  /* ----- cliente ----- */
  if(hasAny(t, ['servico','valor','preco','quanto custa','quanto e','quanto fica','valores','precos','tabela','cardapio','catalogo','lista','opcoes'])) return {type:'cli_servicos'};
  if(hasAny(t, ['cancelar','desmarcar','remarcar','cancelamento','desmarc'])) return {type:'cli_cancelar'};
  /* Deve vir antes do agendamento: "horário de funcionamento" não é pedido de vaga. */
  if(hasAny(t, ['funcionamento','horario de funcionamento','horarios de funcionamento','expediente','que horas','abre','fecha','atende hoje','atende sabado','atende domingo'])) return {type:'cli_horarios'};
  if(hasAny(t, ['agendar','marcar','vaga','disponivel','quero marcar','marcar horario','agenda','quero um horario','horario disponivel'])) return {type:'cli_agendar'};
  if(hasAny(t, ['onde','endereco','localizacao','local','contato','telefone','whatsapp','chegar'])) return {type:'cli_local'};
  if(hasAny(t, ['pagamento','pix','pagar','sinal','cartao','deposito'])) return {type:'cli_pagamento'};
  if(hasAny(t, ['falar','atendente','equipe','pessoa','humano','duvida'])) return {type:'cli_humano'};
  if (isAppQuestion(t)) return {type:'cli_app'};
  if(hasAny(t, ['tatuagem','barba','corte','sobrancelha','unha','unhas','cabelo','maquiagem','estetica','banho','tosa','pele','gel','fibra','alongamento','piercing','spa'])) return {type:'cli_servicos'};
  /* Cliente escreveu algo: nunca ficar mudo. O menu deixa escolher. */
  return {type:'menu'};
}

/* Perfis: o nicho define vocabulário e o tom pode ser ajustado pela responsável no próprio app. */
const NICHO_PERFIS = {
  salao:       { tone:'feminino', emoji:'com', saud:'Oi! 💅', cliente:'cliente', srv:'procedimento', dono:'responsável pelo salão' },
  barbearia:   { tone:'masculino', emoji:'sem', saud:'Olá', cliente:'cliente', srv:'serviço', dono:'responsável pela barbearia' },
  unhas:       { tone:'feminino', emoji:'com', saud:'Oi! ✨', cliente:'cliente', srv:'procedimento', dono:'responsável pelo estúdio' },
  estetica:    { tone:'neutro', emoji:'com', saud:'Olá! 🧖', cliente:'paciente', srv:'procedimento', dono:'responsável pelo espaço' },
  maquiagem:   { tone:'feminino', emoji:'com', saud:'Oi! 💄', cliente:'cliente', srv:'serviço', dono:'responsável pelo estúdio' },
  tattoo:      { tone:'masculino', emoji:'sem', saud:'Olá', cliente:'cliente', srv:'serviço', dono:'responsável pelo estúdio' },
  sobrancelha: { tone:'feminino', emoji:'com', saud:'Oi! ✨', cliente:'cliente', srv:'serviço', dono:'responsável pelo estúdio' },
  odonto:      { tone:'neutro', emoji:'com', saud:'Olá! 🦷', cliente:'paciente', srv:'procedimento', dono:'responsável pela clínica' },
  petshop:     { tone:'masculino', emoji:'sem', saud:'Olá', cliente:'cliente', srv:'serviço', dono:'responsável pelo pet shop' },
  personal:    { tone:'neutro', emoji:'com', saud:'Olá! 💪', cliente:'aluno', srv:'treino', dono:'personal trainer' },
  fisio:       { tone:'neutro', emoji:'com', saud:'Olá!', cliente:'paciente', srv:'atendimento', dono:'responsável pela clínica' },
  nutri:       { tone:'neutro', emoji:'com', saud:'Olá! 🥗', cliente:'paciente', srv:'consulta', dono:'responsável pelo consultório' },
  pilates:     { tone:'feminino', emoji:'com', saud:'Oi! 🧘', cliente:'aluna', srv:'aula', dono:'responsável pelo estúdio' },
  autoest:     { tone:'masculino', emoji:'sem', saud:'Olá', cliente:'cliente', srv:'serviço', dono:'responsável pelo estúdio' },
  depilacao:   { tone:'feminino', emoji:'com', saud:'Oi! 🌸', cliente:'cliente', srv:'sessão', dono:'responsável pelo estúdio' },
  psico:       { tone:'neutro', emoji:'sem', saud:'Olá', cliente:'paciente', srv:'sessão', dono:'responsável pelo consultório' },
  clinica:     { tone:'neutro', emoji:'com', saud:'Olá! 🩺', cliente:'paciente', srv:'atendimento', dono:'responsável pela clínica' }
};
/* Classifica o perfil da cliente (com base no histórico do salão) para o bot
   respeitar a relação: nova, retorno, frequente ou VIP. */
function clientKind(c){
  if (!c) return 'novo';
  if ((c.visits || 0) >= 5 || (c.total || 0) >= 1500) return 'vip';
  if ((c.visits || 0) >= 2) return 'frequente';
  if ((c.visits || 0) >= 1) return 'retorno';
  return 'novo';
}
function botClientFromPhone(salon, from){
  const d = phoneDigits(String(from || ''));
  if (d.length < 8) return null;
  try {
    const list = aggregateClients(salon);
    return list.find(c => phoneDigits(c.phone).slice(-8) === d.slice(-8)) || null;
  } catch (e) { return null; }
}
/* Voz do bot: une o perfil do nicho, a personalidade configurada pela dona
   (tom, formalidade, emoji, saudação) e a adaptação ao perfil da cliente. */
function botVoice(s, from){
  const base = NICHO_PERFIS[cleanNiche(s && s.cfg && s.cfg.nicho)] || NICHO_PERFIS.salao;
  const bot = (s && s.cfg && s.cfg.bot && typeof s.cfg.bot === 'object') ? s.cfg.bot : {};
  /* A aba "Bot" tem prioridade só quando a dona escolhe um tom; senão vale o antigo seletor. */
  const requestedTone = (bot.tone && bot.tone !== 'auto') ? cleanBotTone(bot.tone) : cleanBotTone(s && s.cfg && s.cfg.botTone);
  const tone = requestedTone === 'auto' ? base.tone : requestedTone;
  const emojiMode = BOT_EMOJI.includes(bot.emoji) ? bot.emoji : 'auto';
  const usesEmoji = emojiMode === 'auto' ? base.emoji !== 'sem' : emojiMode === 'com';
  const formality = BOT_FORMALITY.includes(bot.formality) ? bot.formality : 'auto';
  const priceStyle = BOT_PRICE.includes(bot.priceStyle) ? bot.priceStyle : 'resumida';
  const perClient = !!bot.perClient;
  const client = perClient ? botClientFromPhone(s, from) : null;
  const kind = client ? clientKind(client) : 'novo';
  const firstName = client && client.name ? String(client.name).trim().split(/\s+/)[0] : '';
  return {
    tone, usesEmoji, formality, priceStyle, perClient, client, kind, firstName,
    saud: base.saud, cliente: base.cliente, srv: base.srv, dono: base.dono,
    greeting: String(bot.greeting || '').trim(),
    aiEnabled: !!bot.aiEnabled, ai: bot.ai || {}
  };
}
function personalGreet(P){
  if (!P.perClient || !P.client || P.kind === 'novo') return '';
  const n = P.firstName;
  if (!n) return '';
  const em = P.usesEmoji ? '✨ ' : '';
  if (P.kind === 'vip') return 'Oi, ' + n + '! ' + em + 'Que bom falar com você — você é uma das nossas clientes mais queridas. ';
  if (P.kind === 'frequente') return 'Oi, ' + n + '! ' + em + 'Que bom te ver por aqui de novo. ';
  if (P.kind === 'retorno') return 'Oi, ' + n + '! Que bom que você voltou. ';
  return '';
}
function buildBotSysPrompt(s, P){
  const nome = s.name || 'o estabelecimento';
  const niche = cleanNiche(s.cfg && s.cfg.nicho);
  const toneLabel = { feminino: 'acolhedor e carinhoso', masculino: 'direto e objetivo', neutro: 'neutro e inclusivo' }[P.tone] || 'natural';
  const formLabel = P.formality === 'formal' ? 'formal e respeitoso (trate o cliente por "você")' : (P.formality === 'informal' ? 'informal e descontraído, como um atendimento de WhatsApp' : 'natural, sem exageros');
  const emLabel = P.usesEmoji ? 'use alguns emojis com moderação' : 'não use emojis';
  const priceLabel = P.priceStyle === 'nao' ? 'NÃO informe valores na conversa; apenas diga que os valores estão no link de agendamento.' : (P.priceStyle === 'detalhada' ? 'informe os valores de forma detalhada (qto pedido, cite nome do serviço e preço).' : 'informe os valores de forma resumida.');
  const services = (s.services || []).slice(0, 20).map(x => '• ' + (x.name || '') + ' — R$ ' + effPrice(x)).join('\n');
  const slotLink = bookingUrl(s.slug);
  const cli = P.client;
  const cliLine = cli
    ? ('O cliente que escreve é: ' + (cli.name || 'uma cliente') + (cli.visits ? (', ' + cli.visits + ' visita(s)') : '') + (cli.lastVisit ? (', última visita em ' + cli.lastVisit) : '') + (cli.nextVisit ? (', próxima visita em ' + cli.nextVisit) : '') + (P.kind === 'vip' ? ', perfil VIP' : '') + (cli.noShowCount ? (', ' + cli.noShowCount + ' falta(s)') : '') + '.')
    : 'É uma cliente nova (sem histórico).';
  return 'Você é o assistente de atendimento do WhatsApp de "' + nome + '" (' + niche + '), no BoraAgendar.\n' +
    'Tom: ' + toneLabel + '. Registro: ' + formLabel + '. ' + emLabel + '.\n' +
    'Identidade: ' + nome + (s.cfg && s.cfg.slogan ? ' — "' + s.cfg.slogan + '"' : '') + '.\n' +
    'Valores dos serviços (use estes valores, não invente):\n' + (services || 'sem serviços cadastrados') + '\n\n' +
    'Sobre valores: ' + priceLabel + '\n\n' +
    'Link para agendar: ' + slotLink + '\n\n' +
    'Informações sobre o cliente: ' + cliLine + '\n\n' +
    'Regras: responda em português do Brasil, em texto de WhatsApp, direto e útil. ' +
    'Se o cliente pedir para agendar, mencione o link de agendamento. ' +
    'Se o cliente tiver um horário marcado (próxima visita), trate-o com cordialidade. ' +
    'Não prometa pagamento, desconto ou condição que não esteja na lista de valores. ' +
    'Mensagens curtas; no máximo 2 a 4 linhas, salvo quando o cliente pedir a lista completa.';
}
async function maybeAiReply(salon, text, P){
  const bot = (salon.cfg && salon.cfg.bot && typeof salon.cfg.bot === 'object') ? salon.cfg.bot : {};
  const own = bot.ai || {};
  /* Se o salão não trouxe o motor, herda o global definido pela administração. */
  const gai = (db.gateway && db.gateway.ai && typeof db.gateway.ai === 'object') ? db.gateway.ai : {};
  const ai = {
    baseUrl: String(own.baseUrl || gai.baseUrl || '').trim(),
    model: String(own.model || gai.model || '').trim(),
    token: String(own.token || gai.token || '').trim(),
    temperature: Number(own.temperature || gai.temperature) || 0.6
  };
  if (!bot.aiEnabled) return null;
  const baseUrl = ai.baseUrl;
  const model = ai.model;
  const token = ai.token;
  if (!baseUrl || !model || !token) return null;
  const sys = buildBotSysPrompt(salon, P);
  try {
    const r = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        model: model,
        temperature: Number(ai.temperature) || 0.6,
        max_tokens: 300,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: String(text || '').slice(0, 600) }]
      })
    });
    const data = await r.json();
    const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof out === 'string' && out.trim()) return out.trim().slice(0, 1000);
    return null;
  } catch (e) { return null; }
}

function buildBotReply(salon, from, text, opts){
  const s = salon || { name:'nosso estabelecimento', services:[], pros:[], cfg:{}, plan:'Pro' };
  const audience = opts && opts.audience;
  let isDono = !!(from && phonesMatch(s.cfg && s.cfg.notifyPhone, from));
  if (audience === 'client') isDono = false;
  if (audience === 'owner') isDono = true;
  const intent = classifyMessage(text, isDono);
  const nome = s.name || 'a gente';
  const P = botVoice(s, from);
  const hoje = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
  const masc = P.tone === 'masculino';
  const usesEmoji = P.usesEmoji;
  const limpa = txt => !usesEmoji ? txt.replace(/[\u{1F300}-\u{1F5FF}\u{1F680}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').replace(/[\uFE0F]/g,'').replace(/\s{2,}/g,' ').trim() : txt;
  const R = txt => limpa(txt);

  /* ---- plano da cliente (pacote): saldo, aulas e renovação ---- */
  if (!isDono && s.slug) {
    const tq = normText(String(text || ''));
    const isPlanoBot = hasAny(tq, ['meu plano', 'meus planos', 'saldo do plano', 'quantos usos', 'quantos servicos', 'renovar', 'renova', 'meu pacote', 'aulas do curso', 'minhas aulas', 'meu curso', 'pacote']);
    if (isPlanoBot) {
      try {
        const mine = packForClient(s, '', from).filter(pk => pk.status === 'ativo' || pk.status === 'pendente' || pk.status === 'expirado');
        if (mine.length) {
          if (hasAny(tq, ['renovar', 'renova', 'quero mais', 'comprar mais', 'garantir mais'])) {
            const pkR = mine.find(x => x.status === 'ativo') || mine[0];
            pkR.renewReq = true;
            (pkR.log = pkR.log || []).unshift({ at: new Date().toISOString(), type: 'renovacao', note: 'Cliente pediu renovação pelo zap' });
            writeSalon(s);
            const ownerPh = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone)) || '';
            if (phoneDigits(ownerPh).length >= 10) sendSalonOut(s, ownerPh, '🔁 *Renovação pedida* — ' + (s.name || '') + '\n\n*' + ((pkR.client && pkR.client.name) || 'Cliente') + '* quer renovar o *' + pkR.planName + '*' + (pkR.usesLeft > 0 ? (' (sobraram ' + pkR.usesLeft + ' uso(s))') : '') + '. WhatsApp: ' + ((pkR.client && pkR.client.phone) || '') + '\nRecebeu o Pix? App → Planos → 🔁 Renovar agora. 🚀', 'plano-acao');
            return R('Anotado! ✨ Já avisei aqui no espaço que você quer renovar o *' + pkR.planName + '*' + (pkR.usesLeft > 0 ? (' — e ainda restam *' + pkR.usesLeft + ' uso(s)*' + (pkR.expiresAt ? (' até ' + fmtD(pkR.expiresAt)) : '') + ', pode agendar sem medo') : '') + '. Assim que o pagamento for confirmado, o novo período ativa na hora e você recebe o aviso por aqui. 😉');
          }
          const lineB = pk => {
            const st = pk.status === 'pendente' ? 'aguardando a confirmação do pagamento'
              : pk.status === 'expirado' ? ('venceu em ' + fmtD(pk.expiresAt) + ' — dá pra renovar me escrevendo *RENOVAR*')
              : ((pk.usesLeft || 0) + ' de ' + (pk.uses || 0) + ' uso(s) restantes' + (pk.expiresAt ? (' · válido até ' + fmtD(pk.expiresAt)) : ' · sem prazo'));
            const sess = (pk.sessions && pk.sessions.length && pk.status === 'ativo') ? '\nAulas em aberto:\n' + pk.sessions.slice(0, 6).map(ss => (pk.sessionsUsed || []).some(u => u.date === ss.date && u.time === ss.time) ? '' : ('• ' + fmtD(ss.date) + ' ' + ss.time + (ss.label ? (' — ' + ss.label) : ''))).filter(Boolean).join('\n') : '';
            return '🎟️ *' + pk.planName + '* — ' + st + (sess ? ('\n\n' + sess) : '');
          };
          return R('Olha seu plano aqui no *' + (s.name || 'nosso espaço') + '*:\n\n' + mine.slice(0, 3).map(lineB).join('\n\n') + '\n\nQuer renovar? Só me escrever *RENOVAR*. E para agendar, é pelo link: ' + bookingUrl(s.slug) + ' (aparece a opção "usar meu plano"). 💛');
        }
      } catch (e) { /* bot nunca trava por causa do plano */ }
    }
  }

  switch(intent.type){
    case 'menu':
      if(isDono){
        const biz = (s.name && s.name !== 'nosso estabelecimento' && s.name !== 'BoraAgendar') ? (' — *' + s.name + '*') : '';
        return R('Oi. Aqui é o suporte do *BoraAgendar*' + biz + '.\n\n1. Senha / acesso\n2. Configurar o espaço\n3. Pagamento da assinatura\n4. Falar com uma pessoa\n\nPode responder com o número ou escrever o que precisa.');
      }
      if (P.greeting) return R(P.greeting);
      if (P.kind !== 'novo' && P.perClient && P.client) {
        const saud = P.saud.replace(/[^\p{L}\p{N}\s!]/gu, '').trim();
        return R(saud + ' ' + P.firstName + '! ' + (P.kind === 'vip' ? 'Que bom falar com você.' : 'Que bom te ver por aqui de novo.') + '\n\n1. Serviços e valores\n2. Agendar\n3. Horário de funcionamento\n4. Endereço e contato\n5. Cancelar\n6. Falar com a gente\n\nPode responder com o número ou escrever direto.');
      }
      return R('Oi. Aqui é o *' + nome + '*.\n\n1. Serviços e valores\n2. Agendar\n3. Horário de funcionamento\n4. Endereço e contato\n5. Cancelar\n6. Falar com a gente\n\nPode responder com o número ou escrever direto.');
    case 'dono_senha':
      return R('Consigo te orientar: a administração redefine a senha pelo painel. Se quiser, escreve o e-mail de acesso que a gente encaminha.');
    case 'dono_config':
      return R('É nesta ordem:\n• identidade, logo e cores — aba do negócio\n• preços — aba *Serviços*\n• expediente — aba *Horários*\n\nSe travar em algum passo, diz qual.');
    case 'dono_pagamento':
      return R('Seu plano agora é *' + (s.plan||'Pro') + '*, cobrado por mês. Para pagar ou pedir segunda via, fala com a administração por aqui mesmo.');
    case 'dono_humano':
      return R('Pode escrever o que aconteceu, com o máximo de detalhe. Uma pessoa lê e responde.');
    case 'dono_generico':
      return R('Me diz em uma frase o que você precisa — senha, configuração, pagamento ou falar com alguém.');
    case 'cli_servicos': {
      const services = s.services || [];
      const shown = services.slice(0, 15);
      const pg = personalGreet(P);
      const link = s.slug ? '\n\nPara marcar: ' + bookingUrl(s.slug) : '';
      if (P.priceStyle === 'nao') {
        return R(pg + 'Os valores e o catálogo estão no nosso link de agendamento:\n' + (s.slug ? bookingUrl(s.slug) : '') + '\n\nSe preferir, me diga qual serviço você quer e eu te ajudo a marcar.');
      }
      const linha = x => P.priceStyle === 'detalhada'
        ? ('• ' + x.name + (x.dur ? ' (' + x.dur + ' min)' : '') + ' — ' + fmtBRL(effPrice(x)))
        : ('• ' + x.name + ' — ' + fmtBRL(effPrice(x)));
      const lista = shown.length ? shown.map(linha).join('\n') : 'A lista ainda está sendo organizada.';
      const more = services.length > 15 ? '\n\nTem mais ' + (services.length - 15) + ' opções no link de agendamento.' : '';
      return R(pg + 'Estes são os valores:\n\n' + lista + more + link);
    }
    case 'cli_agendar': {
      const link = s.slug ? bookingUrl(s.slug) : '';
      const pg = personalGreet(P);
      return R(link
        ? (pg + 'Pode marcar por aqui:\n' + link + '\n\nEscolhe o ' + P.srv + ', o dia e o horário. Se preferir, diz o que você quer que eu te ajudo.')
        : (pg + 'Diz qual ' + P.srv + ' e o dia que você prefere. A gente confirma o horário.'));
    }
    case 'cli_horarios': {
      const p0 = (s.pros||[])[0];
      const cfg = p0 && s.availability && s.availability.schedule && s.availability.schedule[p0.id] ? s.availability.schedule[p0.id] : null;
      let h = 'Nosso horário:\n';
      if(cfg && cfg.mon && cfg.mon.on) h += '• Segunda a sexta: ' + cfg.mon.start + ' às ' + cfg.mon.end + '\n';
      if(cfg && cfg.sat && cfg.sat.on) h += '• Sábado: ' + cfg.sat.start + ' às ' + cfg.sat.end + '\n';
      else h += '• Sábado: fechado\n';
      h += '• Domingo: fechado\n\nHoje é ' + hoje + '. Quer uma vaga?';
      return R(personalGreet(P) + h);
    }
    case 'cli_local': {
      const cfg = cfgDefaults(s.cfg);
      const lines = [personalGreet(P) + '*' + nome + '*'];
      if (cfg.address) lines.push(cfg.address);
      const digits = String(cfg.contactPhone || '').replace(/\D/g, '');
      if (digits) lines.push('WhatsApp: https://wa.me/55' + digits.replace(/^55/, ''));
      if (cfg.instagram) lines.push('Instagram: instagram.com/' + cfg.instagram.replace(/^@/, ''));
      if (lines.length === 1) lines.push('Se precisar do endereço, é só pedir aqui que a equipe manda.');
      return R(lines.join('\n'));
    }
    case 'cli_cancelar':
      return R(personalGreet(P) + 'Sem problema. Se você marcou pelo link, usa o *link de gerenciamento* que chegou na confirmação — cancela e a vaga libera na hora. Se não tiver o link, escreve seu nome e o horário que a equipe resolve.');
    case 'cli_pagamento':
      return R(personalGreet(P) + 'Se tiver sinal na confirmação, o Pix aparece na hora de marcar. Qualquer outra forma, a equipe te diz na conversa.');
    case 'cli_app': {
      const link = s.slug ? bookingUrl(s.slug) : '';
      const pg = personalGreet(P);
      return R(pg + 'Não precisa baixar nenhum aplicativo. É só abrir o link do *' + nome + '* no celular, escolher o ' + P.srv + ', o dia e confirmar.' +
        (link ? ('\n\nLink:\n' + link) : '') +
        '\n\nSe quiser deixar na tela inicial: abre o link e toca em *Adicionar à tela de início*.');
    }
    case 'cli_humano':
      return R(personalGreet(P) + 'Pode escrever aqui. Alguém do *' + nome + '* lê e responde.');
    case 'ignore':
      return null;
    default:
      if (isDono) return R('Pode escrever com um pouco mais de detalhe? Assim eu te aponto o caminho certo.');
      if (P.greeting) return R(P.greeting);
      return R('Oi. Aqui é o *' + nome + '*.\n\n1. Serviços e valores\n2. Agendar\n3. Horário de funcionamento\n4. Endereço e contato\n5. Cancelar\n6. Falar com a gente\n\nPode responder com o número ou escrever direto.');
  }
}

function buildPlatformBotReply(text, from, inst) {
  const t = normText(text);
  if (!t || isNonTextWhats(text)) return null;
  /* Suporte de dono (senha/acesso/painel): segue sendo bot de dono. */
  if (isAppQuestion(t) && !hasAny(t, ['senha','esqueci','login','painel'])) {
    return { reply: platformAppExplain(), lead: null };
  }
  if (hasAny(t, ['senha','esqueci','login','acesso','suporte','nao consigo','não consigo','painel','como configuro','como faco','como faço','entrar no app'])) {
    const reply = buildBotReply({ name:'BoraAgendar', plan:'Pro', cfg:{}, services:[], pros:[] }, '', text, { audience: 'owner' });
    return reply ? { reply, lead: null } : null;
  }
  /* Detecção de VENDA (mais ampla, sem roubar clientes reais por engano). */
  const salesWords = [
    'quero testar','testar o','teste gratis','teste grátis','testar gratis','começar meu','começar um salao','comecar',
    'criar conta','criar um salao','abrir salao','abrir um salao','quero um salao','quero o plano','valor do plano',
    'quanto custa o plano','quanto é o plano','planos','assinatura','preço do plano','preco do plano','orçamento','orcamento',
    'quanto custa','monto meu','meu salao','demonstração','demonstracao','sou do ramo','assinar','nicho',
    'colocar meu','cadastrar meu','na plataforma','divulgar meu','bora agendar','quero o bora','meu espaco'
  ];
  const base = PUBLIC_URL + '/trial?nicho=';
  let niche = 'salao';
  if (hasAny(t, ['estética automotiv','estetica automotiv','automotiva','polimento','vitrifica','lavajato','lava jato','enceramento'])) niche = 'autoest';
  else if (hasAny(t, ['nutricionist','nutricao','nutrição','nutri '])) niche = 'nutri';
  else if (hasAny(t, ['psicolog','psicanal','sessão de terapia','sessao de terapia','terapia online'])) niche = 'psico';
  else if (hasAny(t, ['depila','cera quente','laser'])) niche = 'depilacao';
  else if (hasAny(t, ['fisioterap','fisio'])) niche = 'fisio';
  else if (hasAny(t, ['personal trainer','treino pessoal','treinador','personal '])) niche = 'personal';
  else if (hasAny(t, ['pilates','reformer'])) niche = 'pilates';
  else if (hasAny(t, ['barbearia','barbeiro','corte masculino'])) niche = 'barbearia';
  else if (hasAny(t, ['unha','nail','manicure','pedicure','alongamento'])) niche = 'unhas';
  else if (hasAny(t, ['clinica ','clinica de','clinica medica','clinica estetica','clinica odontologica','policlinica','clinica popular'])) niche = 'clinica';
  else if (hasAny(t, ['clinica'])) niche = 'clinica';
  else if (hasAny(t, ['estetica','estética','pele','limpeza de pele'])) niche = 'estetica';
  else if (hasAny(t, ['tatu','tattoo','piercing'])) niche = 'tattoo';
  else if (hasAny(t, ['sobrancelha','design','henna'])) niche = 'sobrancelha';
  else if (hasAny(t, ['maquiagem','make up','noiva'])) niche = 'maquiagem';
  else if (hasAny(t, ['odonto','dentista','dental'])) niche = 'odonto';
  else if (hasAny(t, ['pet','banho e tosa','tosa'])) niche = 'petshop';

  if (!hasAny(t, salesWords) && !hasAny(t, ['desconto','promo','preço','preco','plano','planos','assinatura','teste','testar','cadastro','conta','bot','salao','barbeiro','unha','estetica','maquiagem','tattoo','sobrancelha','odonto','pet','nutri','pilates','depila','psicolog','fisio','automotiv','personal','clinica','clinicas'])) return null;

  const pp = planPricesMap();
  const leadMsg = 'Depois do teste: Básico R$ ' + pp.basico + ', Pro R$ ' + pp.pro + ' ou Premium R$ ' + pp.premium + ' por mês.';
  let reply;
  if (hasAny(t, ['plano','planos','preco','preço','valor','assinatura','mensalidade','quanto custa','orçamento','orcamento'])) {
    reply = 'Claro.\n\n' + leadMsg + '\nVocê testa *' + ((db.gateway && Number(db.gateway.trialDays)) || 15) + ' dias grátis*, sem cartão.\n\nPara começar:\n' + base + niche + '\n\nSe quiser, me conta o seu segmento (salão, barbearia, unhas, pilates, auto…) que eu te oriento com calma.';
  } else {
    reply = [
      'Que bom ter você aqui.',
      '',
      'O teste é de *' + ((db.gateway && Number(db.gateway.trialDays)) || 15) + ' dias*, sem cartão. ' + leadMsg,
      '',
      'Para abrir seu espaço, é neste link:',
      base + niche,
      '',
      'Se preferir, me diz o nicho que eu te ajudo no passo a passo.'
    ].join('\n');
  }
  if (automationCfg().leadSales) {
    recordLead({ phone: from, niche: niche, note: text.slice(0, 200), source: inst ? 'whatsapp-inst:' + inst : 'whatsapp' });
  }
  return { reply: reply.trim(), lead: { niche, phone: from } };
}
function zapsterSend(cfg, number, message, instanceOverride) {
  const instance = String(instanceOverride || (cfg && cfg.instance) || '');
  if (!message || !String(message).trim()) return Promise.resolve(null);
  if (!cfg || !cfg.baseUrl || !cfg.token || !instance || !number) return Promise.resolve(null);
  let recipient = String(number || '').trim();
  if (looksLikeBrPhone(recipient)) recipient = intlWhatsNumber(recipient);
  else if (/^\d+$/.test(recipient) && recipient.startsWith('55')) recipient = recipient.slice(0, 13);
  return fetch(String(cfg.baseUrl).replace(/\/$/, '') + '/v1/wa/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Content-Type': 'application/json',
      'X-Instance-ID': instance
    },
    body: JSON.stringify({ recipient: recipient, instance_id: instance, text: message })
  }).then(async r => {
    let data = null;
    try { data = await r.json(); } catch (e) { data = { error: !r.ok }; }
    if (!r.ok && data) data.error = data.error || true;
    return data;
  }).catch(() => ({ error: true }));
}
function zapiSend(cfg, number, message, instanceOverride) {
  const instance = String(instanceOverride || (cfg && cfg.instance) || '');
  if (!cfg || !cfg.baseUrl || !instance || !cfg.token) return Promise.resolve(null);
  if (!message || !String(message).trim()) return Promise.resolve(null);
  const digits = String(number || '').replace(/\D/g, '').replace(/^55/, '');
  if (!digits) return Promise.resolve(null);
  return fetch(cfg.baseUrl.replace(/\/$/, '') + '/message/sendText/' + instance, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cfg.token, number: '55' + digits, text: message })
  }).then(r => r.json()).catch(() => null);
}
function runRebookSuggestions() {
  const channel = activeWhatsGateway();
  const today = brazilTodayStr();
  let queued = 0, sent = 0;
  const hRb = brazilHourNow();
  if (hRb < 9 || hRb >= 21) return { queued: 0, sent: 0, skipped: hRb < 9 ? 'too-early' : 'late' };
  db.salons.forEach(meta => {
    const sal = readSalon(meta.slug);
    if (!sal || sal.status === 'suspenso') return;
    const cfg = cfgDefaults(sal.cfg);
    if (!cfg.rebook.enabled) return;
    let changed = false;
    sal.appointments.forEach(a => {
      if (!a || !a.client || !a.client.phone) return;
      if (!isRealizedAppt(a, today)) return;
      if (a.rebookSentAt || a.rebookStatus === 'sent' || a.rebookStatus === 'sending' || a.rebookStatus === 'pending') return;
      if (!a.rebookDue) { a.rebookDue = addDays(String(a.date).slice(0, 10), serviceRebookDays(sal, a.serviceId)); a.rebookStatus = 'scheduled'; changed = true; }
      if (a.rebookDue > today) return;
      const service = sal.services.find(x => x.id === a.serviceId) || {};
      const link = bookingUrl(sal.slug);
      const msg = clientMsgFromSalon(sal, 'Oi, ' + (a.client.name || '') + '.\n\nJá está na hora da sua próxima ' + (service.name || 'visita') + ' no *' + sal.name + '*.\n\nSe quiser, marca pelo link:\n' + link);
      const salonInst = platformInstanceId();
      if (channel && salonInst) {
        if (!claimReportSend('retorno', a.id, meta.slug)) return;
        a.rebookStatus = 'sending';
        a.rebookSentAt = new Date().toISOString();
        changed = true;
        writeSalon(sal);
        whatsSend(String(a.client.phone).replace(/\D/g, ''), msg, salonOwnInst(sal) || salonInst, { proactive: true }).then(function (res) {
          const fresh = readSalon(meta.slug); if (!fresh) return;
          const ap = fresh.appointments.find(x => x.id === a.id); if (!ap) return;
          if (res && res.error && outRetryable(res.message) && (ap.rebookTries || 0) < 3) {
            ap.rebookTries = (ap.rebookTries || 0) + 1;
            ap.rebookStatus = 'scheduled'; ap.rebookSentAt = null;
            releaseReportClaim('retorno', a.id, meta.slug);
            writeSalon(fresh); return;
          }
          ap.rebookStatus = 'sent';
          ap.rebookSentAt = ap.rebookSentAt || new Date().toISOString();
          writeSalon(fresh);
        });
        sent++;
      } else if (!a.rebookNotifAt) {
        a.rebookNotifAt = new Date().toISOString();
        changed = true;
        queued++;
        pushNotif(sal, 'reagendamento', 'Hora de chamar ' + a.client.name + ' para reagendar ' + (service.name || 'o atendimento') + '. Link: ' + link);
      }
    });
    if (changed) writeSalon(sal);
  });
  return { queued, sent };
}


function runReminders() {
  const channel = activeWhatsGateway();
  const plat = platformInstanceId();
  const tomorrow = addDays(brazilTodayStr(), 1);
  let sent = 0, pending = 0;
  if (!channel || !plat) return { sent: 0, pending: 0, skipped: !channel ? 'no-gateway' : 'no-platform-instance' };
  const hRun = brazilHourNow();
  if (hRun < 9 || hRun >= 21) return { sent: 0, pending: 0, skipped: hRun < 9 ? 'too-early' : 'late' };
  db.salons.forEach(x => {
    const sal = readSalon(x.slug);
    if (!sal || sal.status === 'suspenso') return;
    let changed = false;
    (sal.appointments || []).forEach(a => {
      if (!a || a.date !== tomorrow || a.status !== 'confirmed') return;
      if (a.reminderSentAt || a.reminderStatus === 'sent' || a.reminderStatus === 'enviando' || a.reminderStatus === 'sending') return;
      const digits = phoneDigits(a.client && a.client.phone);
      if (!digits || digits.length < 10) return;
      if (!claimReportSend('lembrete', a.id, x.slug)) return;
      const svcName = (sal.services.find(y => y.id === a.serviceId) || {}).name || 'procedimento';
      const message = clientMsgFromSalon(sal, 'Olá ' + (a.client.name || '') + '! Lembrete do seu horário no *' + sal.name + '*:\n📋 ' + svcName + '\n⏰ Amanhã às ' + a.time + '.\n\nTe esperamos! Se precisar remarcar, responda esta mensagem.');
      a.reminderStatus = 'enviando';
      a.reminderSentAt = new Date().toISOString();
      changed = true;
      writeSalon(sal); /* trava ANTES do WhatsApp — job horário não manda de novo */
      sendSalonOut(sal, digits, message, 'lembrete-agendamento').then(res => {
        const sal2 = readSalon(x.slug);
        if (!sal2) return;
        const ap2 = (sal2.appointments || []).find(y => y.id === a.id);
        if (!ap2) return;
        if (res && res.error && outRetryable(res.message) && (ap2.reminderTries || 0) < 3) {
          ap2.reminderTries = (ap2.reminderTries || 0) + 1;
          ap2.reminderStatus = null; ap2.reminderSentAt = null;
          releaseReportClaim('lembrete', a.id, x.slug);
          writeSalon(sal2);
          return;
        }
        ap2.reminderStatus = 'sent';
        ap2.reminderSentAt = ap2.reminderSentAt || new Date().toISOString();
        writeSalon(sal2);
      });
      sent++;
    });
    if (changed) writeSalon(sal);
  });
  return { sent, pending };
}

function brazilHourNow() {
  const m = brazilNowMin();
  return Math.floor(m / 60);
}
function birthdayWishText(s, name) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'você';
  const biz = String((s && s.name) || '').trim() || 'nós';
  const niche = (s.cfg && s.cfg.nicho) || 'salao';
  const sign = '*' + biz + '*';
  const byNiche = {
    salao: '🎂 Feliz aniversário, ' + first + '!\n\nO time do *' + biz + '* deseja um dia lindo, com muito brilho e autocuidado. Se quiser se presentear, estamos com a agenda aberta pra te receber 💖\n\nCom carinho,\n' + sign,
    barbearia: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* manda um abraço e deseja um dia massa. Quando quiser renovar o visual, a cadeira é sua ✂️\n\n' + sign,
    unhas: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* deseja um dia incrível — e unhas à altura da data 💅 Qualquer coisa, é só chamar.\n\nCom carinho,\n' + sign,
    estetica: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* deseja um ano novo de pele, saúde e bem-estar. Quando quiser um mimo, estamos aqui ✨\n\nCom carinho,\n' + sign,
    maquiagem: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* deseja um dia lindo, do jeito que você merece brilhar 💄\n\nCom carinho,\n' + sign,
    tattoo: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* deseja um dia marcante. Se a ideia for comemorar com arte nova, chama a gente 🖋️\n\n' + sign,
    sobrancelha: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* deseja um olhar ainda mais iluminado neste dia ✨\n\nCom carinho,\n' + sign,
    odonto: '🎂 Feliz aniversário, ' + first + '!\n\nA *' + biz + '* deseja um ano novo com saúde e um sorriso ainda mais bonito 😁\n\n' + sign,
    petshop: '🎂 Feliz aniversário, ' + first + '!\n\nO *' + biz + '* deseja um dia especial pra você e seu pet 🐾 Quando quiser um mimo, estamos aqui.\n\n' + sign
  };
  return clientMsgFromSalon(s, byNiche[niche] || byNiche.salao);
}
function collectBirthdayPeople(s) {
  const out = [];
  const seenPhone = new Set();
  const seenCpf = new Set();
  const push = (name, phone, cpf, birthdate, mark) => {
    const bd = cleanBirthdate(birthdate);
    const digits = phoneDigits(phone);
    const id = digitsCpf(cpf);
    if (!bd || !digits) return;
    if (digits && seenPhone.has(digits)) return;
    if (id && seenCpf.has(id)) return;
    if (digits) seenPhone.add(digits);
    if (id) seenCpf.add(id);
    out.push({ name: name || '', phone: digits, cpf: id, birthdate: bd, mark });
  };
  const ledger = ensureClientLedgerMap(s);
  Object.keys(ledger).forEach(cpf => {
    const L = ledger[cpf];
    if (!L) return;
    push(L.name, L.phone, cpf, L.birthdate, { type: 'ledger', cpf });
  });
  Object.keys(s.clientProfiles || {}).forEach(k => {
    const pr = s.clientProfiles[k];
    if (!pr) return;
    push(pr.name, pr.phone, pr.cpf, pr.birthdate, { type: 'profile', key: k });
  });
  return out;
}
function markBirthdaySent(s, person, year) {
  const y = String(year);
  s.birthdaySent = s.birthdaySent && typeof s.birthdaySent === 'object' ? s.birthdaySent : {};
  if (person.phone) s.birthdaySent[person.phone] = y;
  if (person.mark && person.mark.type === 'ledger') {
    const L = getLedger(s, person.mark.cpf);
    if (L) L.birthdayLastSent = y;
  }
  if (person.mark && person.mark.type === 'profile' && s.clientProfiles && s.clientProfiles[person.mark.key]) {
    s.clientProfiles[person.mark.key].birthdayLastSent = y;
  }
  if (person.cpf) {
    const L = getLedger(s, person.cpf);
    if (L) L.birthdayLastSent = y;
  }
}
function alreadySentBirthday(s, person, year) {
  const y = String(year);
  if (person.phone && s.birthdaySent && String(s.birthdaySent[person.phone]) === y) return true;
  if (person.cpf) {
    const L = getLedger(s, person.cpf);
    if (L && String(L.birthdayLastSent) === y) return true;
  }
  if (person.mark && person.mark.type === 'profile' && s.clientProfiles && s.clientProfiles[person.mark.key]) {
    if (String(s.clientProfiles[person.mark.key].birthdayLastSent) === y) return true;
  }
  return false;
}
function whatsInstanceFor(s) {
  /* Respostas e avisos saem sempre da instância da plataforma. */
  return platformInstanceId() || undefined;
}
function runBirthdayWishes() {
  const channel = activeWhatsGateway();
  if (!channel) return { sent: 0, pending: 0, skipped: 'no-gateway' };
  if (!platformInstanceId()) return { sent: 0, pending: 0, skipped: 'no-platform-instance' };
  const hour = brazilHourNow();
  if (hour < 9 || hour >= 21) return { sent: 0, pending: 0, skipped: hour < 9 ? 'too-early' : 'late' };
  const today = brazilTodayStr();
  const year = today.slice(0, 4);
  let sent = 0, pending = 0;
  (db.salons || []).forEach(x => {
    const sal = readSalon(x.slug);
    if (!sal || sal.status === 'suspenso') return;
    let changed = false;
    collectBirthdayPeople(sal).forEach(person => {
      if (!isBirthdayToday(person.birthdate, today)) return;
      if (alreadySentBirthday(sal, person, year)) return;
      if (!claimReportSend('aniversario', year + ':' + person.phone, x.slug)) return;
      const msg = birthdayWishText(sal, person.name);
      markBirthdaySent(sal, person, year);
      changed = true;
      writeSalon(sal); /* uma vez por ano por número */
      sendSalonOut(sal, person.phone, msg, 'aniversario');
      sent++;
    });
    if (changed) writeSalon(sal);
  });
  return { sent, pending };
}

/* ============================================================
   AUTOMAÇÕES DA PLATAFORMA
   Lógica de receita, retenção e estabilidade que roda em segundo
   plano (agendada) e também manualmente pelo painel admin.
   ============================================================ */
/* Recursos por plano: define o que diferencia o Premium e o Pro. */
const PLAN_FEATURES = {
  'Básico': { team: false, multiInstance: false, advancedReports: false, customBrand: false },
  'Pro':    { team: true,  multiInstance: false, advancedReports: true,  customBrand: false },
  'Premium':{ team: true,  multiInstance: true,  advancedReports: true,  customBrand: true }
};
function planFeature(salon, feature){
  const plan = (salon && salon.plan) || 'Básico';
  return !!(PLAN_FEATURES[plan] && PLAN_FEATURES[plan][feature]);
}
function automationCfg(){
  const a = (db && db.gateway && db.gateway.automations && typeof db.gateway.automations === 'object') ? db.gateway.automations : {};
  return {
    autoBilling: !!a.autoBilling,
    weeklyReport: false, /* donas não recebem relatório da semana no WhatsApp */
    whatsMonitor: !!a.whatsMonitor,
    autoBackup: !!a.autoBackup,
    leadSales: !!a.leadSales,
    autoSuspend: !!a.autoSuspend,
    divulgaTips: a.divulgaTips === undefined ? true : !!a.divulgaTips
  };
}

/* --- Programa de indicação (desconto percentual configurável) --- */
function cleanReferral(v){
  const r = v && typeof v === 'object' ? v : {};
  const pct = Math.max(0, Math.min(100, parseInt(r.percent, 10) || 0));
  /* Padrão: programa ligado (a menos que alguém desligue explicitamente). */
  const enabled = r.enabled === undefined ? true : !!r.enabled;
  return { enabled, percent: pct > 0 ? pct : 20, note: clipText(r.note || 'Indique um salão e ganhe desconto na sua próxima mensalidade.', 200) };
}
function referralCfg(){
  return cleanReferral(db && db.gateway && db.gateway.referral);
}
/* Código de indicação de um salão = seu slug (único). */
function referralCodeOf(x){ return String((x && x.slug) || '').toLowerCase().trim(); }
function resolveReferrer(code){
  const c = String(code || '').toLowerCase().trim();
  if (!c) return null;
  const rs = readSalonResolved(c);
  return rs && rs.salon ? rs.salon : null;
}
/* Quando um salão indicado paga pela PRIMEIRA vez, creditamos o desconto ao indicador
   (na próxima fatura dele) e registramos a indicação para auditoria. */
function rewardReferral(forSlug){
  try {
    const cfg = referralCfg();
    if (!cfg.enabled) return { ok: false, reason: 'referral-off' };
    const x = db.salons.find(v => v.slug === forSlug);
    if (!x || !x.referredBy) return { ok: false, reason: 'sem-indicador' };
    if (!x.referralRewardApplied) {
      x.referralRewardApplied = true;
    } else {
      return { ok: false, reason: 'ja-recompensado' };
    }
    const referrer = db.salons.find(v => v.slug === x.referredBy);
    if (!referrer) return { ok: false, reason: 'indicador-inexistente' };
    /* desconto = percentual do plano do INDICADOR */
    const discount = Math.round(planPrice(referrer.plan) * cfg.percent / 100);
    referrer.referralCredits = (referrer.referralCredits || 0) + discount;
    /* Avisa o indicador no WhatsApp + sininho do app dele. */
    try {
      const referrerSalon = readSalon(referrer.slug);
      if (referrerSalon) {
        const msg = '🎁 *Você ganhou R$ ' + discount + ' de desconto!*\n\nSua indicação (' + (x.name || x.slug) + ') virou cliente do *BoraAgendar*.\n\nEsse valor já está somado como crédito e será abatido automaticamente da sua próxima mensalidade.';
        sendOwnerWhats(referrerSalon, msg);
        const nf = pushNotif(referrerSalon, 'indicacao', 'Você ganhou R$ ' + discount + ' de desconto por indicar '+ (x.name || x.slug) + '.');
        sseSend(referrerSalon.slug, nf);
      }
    } catch (e) {}
    const row = {
      id: 'ref' + Date.now() + uid(),
      referredBy: x.referredBy,
      referredTo: forSlug,
      percent: cfg.percent,
      discount,
      creditTo: x.referredBy,
      at: new Date().toISOString(),
      status: 'creditado'
    };
    db.referrals = Array.isArray(db.referrals) ? db.referrals : [];
    db.referrals.unshift(row);
    if (db.referrals.length > 200) db.referrals.length = 200;
    saveDB();
    return { ok: true, discount, row };
  } catch (e) { return { ok: false, reason: e.message }; }
}
/* Desconto a aplicar na prxima cobranca de um salao (consome o credito em aberto). */
function discountForCharge(x){
  if (!x || !(x.referralCredits > 0)) return 0;
  const d = x.referralCredits;
  x.referralCredits = 0;
  x.lastReferralApplied = new Date().toISOString();
  return d;
}
function peekReferralCredit(x){ return (x && x.referralCredits > 0) ? x.referralCredits : 0; }
function normDiscountCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}
function cleanDiscountKey(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const code = normDiscountCode(r.code);
  const percent = Math.max(1, Math.min(100, parseInt(r.percent, 10) || 0));
  const times = Math.max(1, Math.min(24, parseInt(r.times, 10) || 1));
  const maxUses = Math.max(0, Math.min(10000, parseInt(r.maxUses, 10) || 0));
  return {
    id: r.id || ('dk' + Date.now() + uid()),
    code: code,
    percent: percent,
    times: times,
    maxUses: maxUses,
    uses: Math.max(0, parseInt(r.uses, 10) || 0),
    enabled: r.enabled === undefined ? true : !!r.enabled,
    note: clipText(r.note, 80),
    createdAt: r.createdAt || new Date().toISOString()
  };
}
function discountKeysList() {
  if (!db.discountKeys) db.discountKeys = [];
  return db.discountKeys;
}
function findDiscountKey(code) {
  const c = normDiscountCode(code);
  if (!c) return null;
  return discountKeysList().find(k => k && k.enabled !== false && normDiscountCode(k.code) === c) || null;
}
function peekPromoDiscount(x, baseAmt) {
  const base = Math.max(0, Number(baseAmt) || 0);
  if (!x || !(x.discountTimesLeft > 0) || !(x.discountPercent > 0) || !base) return { amount: 0, percent: 0 };
  const percent = Math.max(1, Math.min(100, parseInt(x.discountPercent, 10) || 0));
  const amount = Math.min(base, Math.round(base * percent / 100));
  return { amount: amount, percent: percent };
}
function consumePromoDiscount(x) {
  if (!x || !(x.discountTimesLeft > 0) || !(x.discountPercent > 0)) return 0;
  x.discountTimesLeft = Math.max(0, (parseInt(x.discountTimesLeft, 10) || 0) - 1);
  x.discountUsedCount = (x.discountUsedCount || 0) + 1;
  return x.discountTimesLeft;
}
function planChargeInfo(x) {
  const base = planPrice(x && x.plan);
  const promo = peekPromoDiscount(x, base);
  const afterPromo = Math.max(0, base - promo.amount);
  const referralPeek = peekReferralCredit(x);
  const referral = Math.min(afterPromo, referralPeek);
  return {
    base: base,
    promoAmount: promo.amount,
    promoPercent: promo.percent,
    promoTimesLeft: (x && x.discountTimesLeft) || 0,
    promoCode: (x && x.discountCode) || '',
    referralAmount: referral,
    amount: Math.max(0, afterPromo - referral)
  };
}
/* Liquida a assinatura no MP. A única fonte de verdade é a API do Mercado Pago:
   um POST no webhook, sozinho, NUNCA marca nada como pago. */
function settlePlanPayment(x, pay, expected) {
  const amount = Number(pay.transaction_amount_received || pay.transaction_amount || expected || 0) || 0;
  x.payments = x.payments || [];
  const isFirstPay = !x.payments.some(q => q.amount > 0);
  x.payments.push({ date: todayStr(), amount: amount, via: 'mercadopago', mpId: String(pay.id), auto: true });
  const base = (x.nextDue && x.nextDue > todayStr()) ? x.nextDue : todayStr();
  x.nextDue = addDays(base, 30);
  x.trialEnd = null;
  x.graceUsed = false; x.trialReminderSent = false; x.billReminderSent = false;
  x.status = 'ativo';
  try {
    const td = (pay && pay.transaction_details) || {};
    const fee = Math.round((((+td.total_paid_amount || 0) - (+td.net_received_amount || 0)) || 0) * 100) / 100;
    if (fee > 0) {
      ensureDBShape();
      db.platformExpenses.unshift({ id: 'pe' + Date.now() + uid(), label: 'Taxa Mercado Pago — ' + x.slug, amount: fee, cat: 'pagamentos', date: todayStr(), monthly: false, auto: true, createdAt: new Date().toISOString() });
      if (db.platformExpenses.length > 600) db.platformExpenses.length = 600;
    }
  } catch (e) {}
  const hadPromo = !!x.lastCharge && !!x.lastCharge.promoCode;
  x.lastCharge = null;
  x.pendingCharges = [];
  x.lateNudges = 0;
  if (hadPromo) { try { consumePromoDiscount(x); } catch (e) {} }
  const s = readSalon(x.slug);
  if (s) { s.status = 'ativo'; writeSalon(s); }
  let reward = null;
  if (isFirstPay) { try { reward = rewardReferral(x.slug); } catch (e) {} }
  saveDB();
  if (s && amount > 0) {
    sendOwnerWhats(s, '✅ *Pagamento confirmado* — ' + s.name + '\n\nRecebemos ' + fmtBRL(amount) +
      ' (Pix). Sua assinatura está em dia até ' + String(x.nextDue || '').split('-').reverse().join('/') + '. Não precisa fazer nada.');
  }
  return { ok: true, slug: x.slug, amount, nextDue: x.nextDue };
}
/* Conferência: serve o webhook, o botão manual e o robô de 15 min. Varre a
   cobrança atual e o histórico — paga qualquer código antigo também. */
async function mpSettlePendingCharges() {
  const tok = mpToken();
  if (!tok) return { ran: false, skipped: 'sem-mercadopago-token' };
  let checked = 0, settled = 0;
  for (const x of db.salons) {
    const cands = [];
    if (x.lastCharge && x.lastCharge.mpId && x.lastCharge.status !== 'paid') cands.push(x.lastCharge);
    if (Array.isArray(x.pendingCharges)) x.pendingCharges.forEach(c => { if (c && c.mpId && (Date.now() - new Date(c.createdAt || 0).getTime()) < 8 * 864e5) cands.push(c); });
    const seen = new Set();
    for (const c of cands) {
      const id = String(c.mpId);
      if (seen.has(id)) continue; seen.add(id);
      checked++;
      let pay = null;
      try { pay = await mpFetchPayment(id); } catch (e) { continue; }
      if (!pay || pay.status !== 'approved') continue;
      if (!mpAmountOk(pay, c.amount)) { console.log('⚠️  MP aprovou valor diferente do cobrado p/', x.slug); continue; }
      settlePlanPayment(x, pay, c.amount);
      settled++;
      break;
    }
  }
  return { ran: true, checked, settled };
}
function billingPublic(x) {
  if (!x) return {};
  const info = planChargeInfo(x);
  return {
    plan: x.plan,
    status: x.status,
    trialEnd: x.trialEnd || null,
    nextDue: x.nextDue || null,
    discountCode: x.discountCode || '',
    discountPercent: x.discountPercent || 0,
    discountTimesLeft: x.discountTimesLeft || 0,
    discountTimesTotal: x.discountTimesTotal || 0,
    nextAmount: info.amount,
    nextBase: info.base,
    nextPromoAmount: info.promoAmount
  };
}
function applyDiscountCodeToSalon(x, code, opts) {
  opts = opts || {};
  const c = normDiscountCode(code);
  if (!c) return { ok: false, error: 'Informe a chave de desconto' };
  const k = findDiscountKey(c);
  if (!k) return { ok: false, error: 'Chave inválida ou desativada' };
  if (k.maxUses > 0 && (k.uses || 0) >= k.maxUses) return { ok: false, error: 'Esta chave já esgotou' };
  if (x.discountCode && normDiscountCode(x.discountCode) === c) {
    return { ok: true, already: true, percent: x.discountPercent, timesLeft: x.discountTimesLeft, times: x.discountTimesTotal, code: x.discountCode };
  }
  const usedSome = (x.discountUsedCount > 0) || (x.discountTimesLeft != null && x.discountTimesTotal != null && Number(x.discountTimesLeft) < Number(x.discountTimesTotal));
  if (usedSome && !opts.force) return { ok: false, error: 'Esta conta já está usando a chave ' + x.discountCode };
  k.uses = (k.uses || 0) + 1;
  x.discountCode = k.code;
  x.discountPercent = k.percent;
  x.discountTimesTotal = k.times;
  x.discountTimesLeft = k.times;
  x.discountUsedCount = 0;
  x.discountAppliedAt = new Date().toISOString();
  return { ok: true, percent: k.percent, times: k.times, timesLeft: k.times, code: k.code };
}

/* --- Indicação CLIENTE → CLIENTE (dentro de um salão) ---
   Cliente indica amiga; quando a indicada confirma o 1º horário, a indicadora
   ganha crédito (R$) para abater no próximo pagamento dela.
   Códigos são curtos e fáceis de digitar ("dudinha", "bel"), gerados pelo nome
   e editáveis pela dona no painel.
   TRAVA ANTI-FRAUDE: só pode SER indicadora quem é cliente estabelecida do salão
   (tem ao menos 1 atendimento CONCLUÍDO). Assim uma cliente recém-cadastrada /
   recém-indicada (0 minutos, 0 visitas) NUNCA vira indicadora de outra — evita
   duas clientes novas se indicando e virando VIP sem pagar. */
function cleanClientRef(v){
  const r = v && typeof v === 'object' ? v : {};
  const pct = Math.max(0, Math.min(100, parseInt(r.percent, 10) || 0));
  const welcome = Math.max(0, Math.min(100, parseInt(r.welcomePercent, 10) || 0));
  const expiry = Math.max(0, Math.min(730, parseInt(r.expiryDays, 10) || 0)); // 0 = sem validade
  const maxC = Math.max(0, Math.min(10000, parseInt(r.maxCredits, 10) || 0)); // 0 = sem limite
  return {
    enabled: !!r.enabled, percent: pct > 0 ? pct : 15,
    welcomePercent: welcome > 0 ? welcome : 0,
    expiryDays: expiry > 0 ? expiry : 0,
    maxCredits: maxC > 0 ? maxC : 0
  };
}
function clientRefCfg(){ return cleanClientRef(db && db.gateway && db.gateway.clientReferral); }
/* Config efetiva de um salão: o que a dona definiu (override) sobrepõe o padrão global do admin. */
function clientRefCfgFor(s){
  const base = clientRefCfg();
  const own = (s && s.cfg && s.cfg.clientReferral && typeof s.cfg.clientReferral === 'object') ? s.cfg.clientReferral : {};
  return cleanClientRef({
    enabled: own.enabled !== undefined ? own.enabled : base.enabled,
    percent: (own.percent !== undefined && Number(own.percent) > 0) ? Number(own.percent) : base.percent,
    welcomePercent: own.welcomePercent !== undefined ? Number(own.welcomePercent) : base.welcomePercent,
    expiryDays: own.expiryDays !== undefined ? Number(own.expiryDays) : base.expiryDays,
    maxCredits: own.maxCredits !== undefined ? Number(own.maxCredits) : base.maxCredits
  });
}
/* Crédito em aberto de uma cliente: soma de partes NÃO EXPIRADAS, limitado ao máximo. */
function refCreditParts(r){
  return Array.isArray(r.creditParts) && r.creditParts.length
    ? r.creditParts
    : (r.credit > 0 ? [{ amount: r.credit, at: r.lastCreditAt || Date.now() }] : []);
}
function refAvailableCredit(r, s){
  const cfg = clientRefCfgFor(s);
  const now = Date.now();
  let parts = refCreditParts(r);
  if (cfg.expiryDays > 0) parts = parts.filter(p => now - (Number(p.at) || now) < cfg.expiryDays * 86400000);
  const oldest = parts.reduce((m, p) => Math.min(m, Number(p.at) || now), now);
  let total = parts.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  if (cfg.maxCredits > 0) total = Math.min(total, cfg.maxCredits);
  return { total, parts, oldest, expiryDays: cfg.expiryDays };
}
function refAvailableTotal(r, s){ return refAvailableCredit(r, s).total; }
function refExpiresAt(r, s){ const a = refAvailableCredit(r, s); return a.expiryDays > 0 && a.parts.length ? (a.oldest + a.expiryDays * 86400000) : 0; }
/* Consome crédito (mais antigo primeiro) e regrava as partes. */
function refConsumeCredit(r, amount, s){
  const cfg = clientRefCfgFor(s);
  const now = Date.now();
  let parts = refCreditParts(r)
    .filter(p => !(cfg.expiryDays > 0) || now - (Number(p.at) || now) < cfg.expiryDays * 86400000)
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  let rem = Math.max(0, amount);
  const kept = [];
  for (const p of parts) {
    if (rem <= 0) { kept.push(p); continue; }
    const amt = Number(p.amount) || 0;
    if (amt <= rem) { rem -= amt; }
    else { p.amount = amt - rem; rem = 0; kept.push(p); }
  }
  r.creditParts = kept;
  r.credit = kept.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return r.credit;
}
function baseClientRefCode(name){
  const first = String(name || '').trim().split(/\s+/)[0] || 'cliente';
  return first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function ensureClientRefs(s){
  if (!Array.isArray(s.clientRefs)) s.clientRefs = [];
  try {
    const agg = aggregateClients(s);
    for (const c of agg) {
      /* Deduplica por CPF quando existe; só por nome quando não há CPF. */
      const exists = c.cpf
        ? s.clientRefs.some(r => r.cpf === c.cpf)
        : s.clientRefs.some(r => !r.cpf && normKey(c.name) && normKey(c.name) === normKey(r.name));
      if (exists) continue;
      const base = baseClientRefCode(c.name);
      const used = new Set(s.clientRefs.map(r => r.code));
      let code = base || 'cliente';
      let i = 1;
      while (used.has(code)) { code = base + i; i++; }
      s.clientRefs.push({ code, cpf: c.cpf || '', name: c.name || '', phone: c.phone || '', credit: 0, referredBy: '', rewardedAt: null, createdAt: Date.now() });
    }
  } catch (e) {}
  return s.clientRefs;
}
function findRefByCode(s, code){
  const c = String(code || '').toLowerCase().trim();
  return ensureClientRefs(s).find(r => r.code === c) || null;
}
function findRefByClient(s, client){
  const cpf = digitsCpf(client && client.cpf);
  const name = normKey(client && client.name);
  return ensureClientRefs(s).find(r => (cpf && r.cpf === cpf) || (!cpf && name && normKey(r.name) === name)) || null;
}
/* Cliente estabelecida: tem pelo menos 1 atendimento concluído ('done'). */
function refIsEstablished(s, ref){
  if (!ref) return false;
  return clientAppointments(s, ref.cpf, ref.name).some(a => a.status === 'done');
}
function clientAppointments(s, cpf, name){
  const cpfD = digitsCpf(cpf); const nameK = normKey(name);
  return (s.appointments || []).filter(a => {
    if (cpfD && digitsCpf(a.client && a.client.cpf) === cpfD) return true;
    if (nameK && normKey(a.client && a.client.name) === nameK) return true;
    return false;
  });
}
/* Recompensa a indicadora quando a indicada confirma o 1º horário. */
function rewardClientReferral(s, appt){
  try {
    const cfg = clientRefCfgFor(s);
    if (!cfg.enabled) return { ok: false, reason: 'client-ref-off' };
    const cpf = digitsCpf(appt && appt.client && appt.client.cpf);
    const name = appt && appt.client && appt.client.name;
    const L = cpf ? getLedger(s, cpf) : null;
    const refCode = (appt && appt.referralCode) || (L && L.referredBy);
    if (!refCode) return { ok: false, reason: 'sem-indicador' };
    if (L && L.refRewarded) return { ok: false, reason: 'ja-recompensada' };
    const referrer = findRefByCode(s, refCode);
    if (!referrer) return { ok: false, reason: 'indicador-inexistente' };
    if (!refIsEstablished(s, referrer)) return { ok: false, reason: 'indicador-nao-elegivel' };
    if (referrer.cpf && referrer.cpf === cpf) return { ok: false, reason: 'auto-indicacao' };
    /* Cada indicada só pode recompensar a MESMA indicadora UMA vez (por CPF). */
    referrer.rewardedFor = Array.isArray(referrer.rewardedFor) ? referrer.rewardedFor : [];
    if (referrer.rewardedFor.includes(cpf)) return { ok: false, reason: 'ja-recompensada' };
    const svc = s.services.find(x => x.id === appt.serviceId) || {};
    const credit = Math.round(effPrice(svc) * cfg.percent / 100);
    if (credit <= 0) return { ok: false, reason: 'valor-zero' };
    /* Aplica limite máximo de crédito em aberto. */
    let awarded = credit;
    const curAvail = refAvailableTotal(referrer, s);
    if (cfg.maxCredits > 0 && curAvail + awarded > cfg.maxCredits) awarded = Math.max(0, cfg.maxCredits - curAvail);
    if (awarded <= 0) return { ok: false, reason: 'limite-atingido' };
    referrer.creditParts = Array.isArray(referrer.creditParts) ? referrer.creditParts : [];
    referrer.creditParts.push({ amount: awarded, at: Date.now() });
    referrer.credit = refAvailableTotal(referrer, s);
    referrer.rewardedFor.push(cpf);
    if (L) { L.refRewarded = true; L.referredBy = refCode; pushLedgerEvent(L, 'indica_ganha', 'Ganhou R$ ' + awarded + ' de crédito (indicou ' + (referrer.name || refCode) + ')', {}); }
    const expiryNote = cfg.expiryDays > 0 ? (' Válido por ' + cfg.expiryDays + ' dias.') : '';
    const row = { id: 'cref' + Date.now() + uid(), salon: s.slug, referredBy: referrer.cpf || referrer.name, referredByName: referrer.name, referredTo: name || cpf, percent: cfg.percent, credit: awarded, at: new Date().toISOString(), status: 'creditado' };
    s.clientReferralLog = Array.isArray(s.clientReferralLog) ? s.clientReferralLog : [];
    s.clientReferralLog.unshift(row);
    if (s.clientReferralLog.length > 200) s.clientReferralLog.length = 200;
    /* Avisa a indicadora no WhatsApp. */
    try {
      const ph = referrer.phone || (L.referredBy && findRefByCode(s, refCode).phone);
      const digits = phoneDigits(referrer.phone || '');
      if (digits) sendViaPlatformBot(digits, '🎁 *Você ganhou R$ ' + awarded + ' de crédito!*\n\nSua indicação (' + (name || 'uma pessoa') + ') confirmou o primeiro horário no *' + s.name + '*.\n\nEsse valor será abatido automaticamente da sua próxima visita.' + expiryNote, { salon: s, kind: 'indicacao' });
    } catch (e) {}
    const nf = pushNotif(s, 'indicacao', '💝 ' + (referrer.name || 'Cliente') + ' ganhou R$ ' + awarded + ' por indicar ' + (name || 'cliente') + '.');
    sseSend(s.slug, nf);
    writeSalon(s);
    return { ok: true, credit: awarded };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/* --- Leads de venda (candidatos a assinar) --- */
function recordLead(raw){
  try {
    ensureDBShape();
    db.leads = Array.isArray(db.leads) ? db.leads : [];
    const already = db.leads.some(l => l && l.phone && l.phone === String(phoneDigits(raw.phone || raw.from || '')));
    const row = {
      id: 'lead' + Date.now() + uid(),
      phone: String(phoneDigits(raw.phone || raw.from || '')),
      name: clipText(raw.name || '', 80),
      niche: clipText(raw.niche || '', 40),
      note: clipText(raw.note || '', 200),
      source: clipText(raw.source || 'whatsapp', 40),
      at: new Date().toISOString(),
      status: raw.status || 'novo',
      handled: false
    };
    if (!row.phone) return { pushed: false, reason: 'sem-phone' };
    if (already) { pushBotLog({ ignored: 'lead-duplicado', inst: (raw.inst||''), from: row.phone, text: raw.note }); return { pushed: false, reason: 'duplicado' }; }
    db.leads.unshift(row);
    if (db.leads.length > 200) db.leads.length = 200;
    saveDB();
    return { pushed: true, lead: row };
  } catch (e) { return { pushed: false, reason: e.message }; }
}

/* --- Cobrança recorrente automática + retentativa --- */
/* Gera a cobrança Pix do plano no Mercado Pago. Fonte única: robô de cobrança
   e o botão "Gerar Pix" do painel da dona. Guarda em lastCharge + pendingCharges
   para a conferência de 15 min conseguir achar o pagamento. */
async function createPlanPixCharge(x, source){
  const tok = mpToken();
  if (!tok) return { ok:false, error:'Mercado Pago não configurado.' };
  const s = readSalon(x.slug);
  if (!s) return { ok:false, error:'Salão não encontrado.' };
  const info = planChargeInfo(x);
  const amount = Math.max(0, Number(info.amount) || 0);
  if (!(amount > 0)) return { ok:false, error:'Sem valor a cobrar (verifique o plano).' };
  const mp = await fetch(MP_API + '/v1/payments', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'X-Idempotency-Key': uid() + Date.now() },
    body: JSON.stringify({ transaction_amount: amount, description: 'Assinatura ' + s.name + ' (' + x.plan + ')', payment_method_id: 'pix', expiration_time: new Date(Date.now() + 7 * 864e5).toISOString(), payer: { email: String(x.email || 'cliente@exemplo.com') } })
  });
  let j = {}; try { j = await mp.json(); } catch (e) {}
  if (!(j.status === 'pending' && j.point_of_interaction && j.point_of_interaction.transaction_data)) {
    return { ok:false, error:'Mercado Pago não gerou o Pix (' + String(j.message || j.error || mp.status || 'erro') + ').' };
  }
  const charge = { amount, mpId: j.id, createdAt: new Date().toISOString(), qrCode: j.point_of_interaction.transaction_data.qr_code, status: 'pending', via: source || 'auto',
    discountUsed: (source === 'auto' && info.referralAmount) ? info.referralAmount : undefined, promoCode: info.promoCode || undefined, promoAmount: info.promoAmount || undefined };
  x.lastCharge = charge;
  x.pendingCharges = Array.isArray(x.pendingCharges) ? x.pendingCharges : [];
  x.pendingCharges.push({ mpId: charge.mpId, amount, createdAt: charge.createdAt, status: 'pending' });
  if (x.pendingCharges.length > 8) x.pendingCharges = x.pendingCharges.slice(-8);
  if (source === 'auto' && info.referralAmount > 0 && (x.referralCredits || 0) >= info.referralAmount) { x.referralCredits -= info.referralAmount; x.lastReferralApplied = new Date().toISOString(); }
  return { ok:true, s, info, charge };
}

async function runAutoBilling(){
  const cfg = automationCfg();
  if (!cfg.autoBilling) return { ran: false, skipped: 'autoBilling-off' };
  if (!(db.gateway && db.gateway.mercadopagoToken)) return { ran: false, skipped: 'sem-mercadopago-token' };
  /* Primeiro confirma o que já foi pago; depois pensa em cobrar de novo. */
  let paidNow = 0;
  try { paidNow = (await mpSettlePendingCharges()).settled || 0; } catch (e) {}
  const today = todayStr();
  let charged = 0, reminded = 0, failed = 0, suspended = 0;
  for (const x of db.salons) {
    if (x.status !== 'ativo') continue;
    if (!x.nextDue || x.nextDue >= today) continue;
    const s = readSalon(x.slug);
    if (!s) continue;
    const lateDays = Math.max(1, Math.round((new Date(today + 'T12:00:00') - new Date(x.nextDue + 'T12:00:00')) / 864e5));
    const lastCharge = x.lastCharge && x.lastCharge.createdAt;
    const tooRecent = lastCharge && (Date.now() - new Date(lastCharge).getTime() < 20 * 60 * 60 * 1000);
    if (tooRecent) continue;
    if (!claimReportSend('billing', today, x.slug)) continue;
    try {
      const r = await createPlanPixCharge(x, 'auto');
      if (!r.ok) { failed++; continue; }
      x.lateNudges = (x.lateNudges || 0) + 1;
      const viaTxt = x.lateNudges > 1 ? (' · ' + x.lateNudges + 'ª via') : '';
      const promoNote = r.info.promoAmount ? (' (chave ' + (r.info.promoCode || '') + ': ' + r.info.promoPercent + '% off, restam ' + r.info.promoTimesLeft + ' cobrança' + (r.info.promoTimesLeft === 1 ? '' : 's') + ' com desconto)') : '';
      const refNote = r.info.referralAmount ? (' com ' + fmtBRL(r.info.referralAmount) + ' de crédito de indicação aplicado') : '';
      sendOwnerWhats(s, '💳 *Renovação da assinatura* — ' + s.name + viaTxt + '\n\nO plano *' + x.plan + '* venceu há ' + lateDays + ' dia' + (lateDays === 1 ? '' : 's') + '. Sua cobrança Pix de ' + fmtBRL(r.charge.amount) + (refNote ? ' (' + refNote + ')' : '') + promoNote + ' foi gerada.\n\nCódigo Pix (copie e cole no app do banco):\n' + r.charge.qrCode + '\n\nOu abra seu painel → card "💳 Minha assinatura" → Gerar Pix. Assim que o pagamento cai, a baixa é automática (até 15 min) e o acesso segue normal.\n' + PUBLIC_URL + '/app?slug=' + s.slug);
      charged++;
    } catch (e) { failed++; continue; }
    /* opcional: 3 dias sem pagar pausa o acesso (volta sozinho quando o Pix é aprovado) */
    if (cfg.autoSuspend && lateDays >= 3) {
      if (claimReportSend('billing-pausa', String(x.nextDue), x.slug)) {
        x.status = 'suspenso';
        const s2 = readSalon(x.slug);
        if (s2) { s2.status = 'suspenso'; pushNotif(s2, 'aviso', 'Acesso pausado por pagamento pendente. O Pix continua válido — ao pagar, o acesso volta sozinho em até 15 minutos.'); writeSalon(s2); }
        sendOwnerWhats(s, '⏸️ *Acesso pausado* — ' + s.name + '\n\nA assinatura venceu há ' + lateDays + ' dias e não houve pagamento, então o acesso foi pausado por segurança. Nada se perde: agenda, clientes e fotos estão guardados.\n\n👉 Pague o Pix abaixo (ou gere um novo no painel → "Minha assinatura") e TUDO volta sozinho em até 15 minutos:\n' + (x.lastCharge && x.lastCharge.qrCode ? x.lastCharge.qrCode : '(gere um novo no painel)'));
        suspended++;
      }
    }
  }
  saveDB();
  return { ran: true, charged, reminded, failed, suspended, paidNow };
}

/* --- Dicas de divulgação para as donas ------------------------------------
   Dia sim, dia NÃO — alternado pelo hash do slug, para nunca virar rajada
   igual para todo mundo no mesmo minuto. Passa pela fila lenta (6-16s),
   respeita a janela 9h-21h, trava de 1 envio/dia por salão e teto de
   mensagens por salão (= tamanho do ciclo; ajuste com BOT_TIPS_MAX). Cada salão recebe dicas
   em ordens diferentes. --------------------------------------------------- */
const TIPS_DIVULGA = [
  'Bora arrumar sua **bio do Instagram**? Perfil → Editar → Sites: cola o seu link e escreve na bio \u201CAgende aqui ⤵️\u201D. Quem curte seu post encontra a agenda em 1 toque.',
  'Salve o **QR de balcão** no celular (botão Divulgar) e poste nos **Status** com a legenda: \u201Cmarca aqui que eu confirmo na hora\u201D. Muita gente ainda olha Status todo dia.',
  'Cliente nova atendeu bem? Manda UMA vez no WhatsApp dela: \u201CAgora dá pra marcar direto aqui [link] — sem precisar me chamar\u201D. Sem custo, zero pressão.',
  'Imprima o QR e cole no **espelho e na recepção**. O tempo de espera da cliente é o tempo perfeito pra ela já te seguir e agendar a próxima.',
  'Poste um print da agenda cheia de sábado com a legenda \u201Cquer garantir o seu? link na bio\u201D. Escassez verdadeira vende melhor que promoção.',
  'Clientes fixas primeiro: \u201Cabri a agenda de sexta, quem quiser garante\u201D + link. Quem se sente priorizada, prioriza você.',
  'Troque o recado do seu WhatsApp Business e a assinatura do e-mail por: \u201CAgende seu horário: [seu link]\u201D. É o outdoor grátis que trabalha 24h.',
  'Combine com o comércio do entorno (academia, loja de roupa, pet shop): eles mostram seu QR, você mostra o deles. Vizinho indica vizinha.',
  'Ao finalizar o atendimento, pede: \u201CFotografou o resultado? Marca a gente ⤵️\u201D. Cada story delas traz cliente nova com o SEU link na tela.',
  'Reserve 15 minutinhos hoje: link na bio do Insta, QR nos Status, QR impresso na recepção. Só esses 3 passos já enchem uma semana.',
  'Grave um **Reels antes/depois** de 15s: celular na vertical, sem dancinha. O resultado fala mais alto que qualquer edição caprichada.',
  'Crie o destaque \u201CAgenda aberta\u201D no Instagram com o passo a passo + link. Quem chega no seu perfil pela primeira vez decide em 10 segundos — mostre o caminho.',
  'Lista de transmissão no WhatsApp: no máximo 1 por semana, só coisa útil (vagas, dica). Propaganda diária faz a cliente sumir da lista.',
  'Cartãozinho com QR na sacola e na bancada: \u201Cgaranta o próximo horário — aponte a câmera\u201D. Quem acabou de sair satisfeita é a cliente mais fácil de agendar.',
  'Nos Stories, enquete: \u201Cmarca aqui aquela amiga que precisa cuidar do cabelo\u201D. Amiga marca amiga e o Instagram te entrega para elas de graça.',
  'Cadastre o salão no **Perfil da Empresa do Google** e cole o link de agendar lá. Muita gente busca \u201Csalão perto de mim\u201D no mapa antes de perguntar no Instagram.',
  'Tour do link novo: grave um Stories de 20s mostrando VOCÊ marcando um horário no celular, sem cortes. Legenda: \u201Cé assim que minhas clientes marcam agora, sem me chamar\u201D + [link]. Quem vê o processo, confia e agenda.',
  '17h em ponto, poste: \u201Csobraram 2 vagas pra hoje à noite\u201D + link. Vaga de última hora some em minutos, e o Status é o lugar de caçá-las.',
  'Uma vez por semana, abra a caixinha de perguntas e responda em vídeo. Autoridade se constrói assim — e quem pergunta é cliente em potencial.',
  'Crie o hábito: toda legenda que você postar, feche com \u201Cagenda pelo link da bio ⤵️\u201D. Repetição é o que converte seguidor em cliente.',
  'Tem um dia parado na semana? Crie a \u201Cterça de 15% off\u201D só nele. Você enche o dia vazio sem desvalorizar o sábado — oferta tem que ter dia e hora.',
  'Anote no app a **data de aniversário** da cliente (a cada atendimento, pergunte). Quem tem aniversário no BoraAgendar recebe parabéns automático da plataforma — e volta no dia seguinte.',
  'Cliente sumida há 60 dias? Manda só: \u201Csaudades! Quer retomar? tem vaga quinta 15h\u201D + link. Recuperar quem já te conheceu é o cliente mais barato que existe.',
  'No fim do mês, poste a virada: \u201Cagenda do mês que vem ABERTA a partir de agora\u201D + link. Quem organiza a vida no mês novo, marca em cima.',
  'Respostas salvas do WhatsApp Business: digite \u201C/agenda\u201D e o link sai pronto. Sua equipe toda responde igual, rápido, sem erro de digitação.',
  'TV da recepção (ou um tablet encostado) rodando em loop um vídeo de 10s: \u201Cmarque aqui sem precisar me chamar\u201D + QR grande. Ensina a cliente o dia todo, sem constranger.',
  'Stories com contagem regressiva \u201Cagenda de sexta abre às 9h\u201D: o Instagram avisa as clientes na hora certa. Fila de interesse antes mesmo do link.',
  'Acabou de receber um cancelamento? Poste na hora: \u201Cacabei de liberar uma vaga pra 16h de hoje\u201D + link. O que era prejuízo vira agenda — e no app a vaga volta pro painel sozinha.',
  'Monte pacote \u201Cnoivas e formandas\u201D na agenda (ensaio + dia) e divulgue nos grupos da cidade. Cliente de evento leva 3 amigas junto — vale o triplo e agenda o ano.',
  'Ensine a remarcar sozinha: \u201Cpelo link você troca de horário sem me incomodar\u201D. Ela ganha liberdade, você ganha menos \u201Cpreciso desmarcar\u201D às 22h.',
  'Reaproveite 1 conteúdo em 3 canais: post do Instagram vira Facebook, print vira Status, dica vira resposta rápida. Um trabalho, três presenças — consistência é o que o algoritmo paga.',
  'Fixe 3 posts no topo do perfil: como agendar, antes/depois campeão, serviço mais pedido. Visitante novo decide em 10 segundos o que fazer — facilite o SIM.',
  'Crie a data-símbolo do salão: \u201Cúltima sexta do mês é dia de pé feito\u201D. Data recorrente cria hábito, e hábito é agenda previsível.',
  'Peça o @ da cliente no check-in e salve na ficha dela (no app). Marcar a cliente no antes/depois é dividir a audiência dela com você — story com marcação rende visita pra vocês duas.',
  'Precisa fechar a agenda 30 min pro almoço? Ajuste no app e avise nos Stories com o link: \u201Cmeio dia sigo aqui, marca pelo app que eu te pego às 15h\u201D. Clareza vira confiança.',
  'Treino-relâmpago de 5 min com a equipe: a frase única \u201Cvamos já deixar o próximo garantido no app?\u201D na finalização. Repetida por todas, dobra a taxa de retorno.',
  'QR em todas as superfícies: espelho, cadeira, cartãozinho da sacola, comprovante, embrulho de presente. Cada canto do salão é outdoor do seu link.',
  'Datas de pico (Dia das Mães, virada, festas): abra a agenda com 3 semanas de frente e faça contagem regressiva nos Stories. Quem abre primeiro, lota primeiro.',
  '\u201CHappy hour do salão\u201D: 16h–19h com 10% off, postada ao meio-dia. Horário morto tem preço — desconto é só o nome bonito pra isso.',
  'Borboleta do mês (com permissão): \u201Cescolham a melhor transformação\u201D + enquete. A mais votada ganha hidratação. Todo mundo compartilha — e compartilha com o SEU link ali embaixo.',
  'Avisou mudança de horário/feriado no WhatsApp? Cole o link na mesma mensagem. Comunicado de serviço é carona perfeita: a cliente já está com o celular na mão.',
  '2 Stories por dia bastam: 1 de resultado, 1 \u201Cvagas + link\u201D. Constância bate intensidade — quem aparece todo dia, é lembrada na hora de marcar.',
  'Cliente que agendou a PRIMEIRA vez pelo app? Ganha um mimo na visita seguinte. Ensine o caminho uma vez, premie o hábito — na terceira ela não lembra de como era antes.',
  'Responda dúvidas em grupo do bairro (Facebook, WhatsApp da rua): \u201Csou cabeleireira aqui no bairro, agenda no meu link\u201D. Útil primeiro, vendedora depois — e a vizinhança inteira lê.',
  'Vaga que a cliente desmarcou virou buraco? A mensagem de volta tem que ser leve: \u201Csem problema! Quer trocar pra outro dia? Está tudo no link\u201D. Culpa afasta, praticidade reassenta.',
  'Brinde de indicação que a CLIENTE dá à amiga (hidratação pra quem traz, desconto pra quem vem): anucie 1 mês no Instagram com o seu link e conte quantos vieram. Boca a boca com mensuração.',
  'Na sexta, poste \u201Cminha semana em 3 fotos\u201D + agenda aberta da próxima. Bastidores humanizam, e \u201Cpróxima semana\u201D é o melhor gancho de segunda-feira.',
  'Preço na conversa puxa agenda: toda vez que perguntarem valor (DM, comentário, grupo do bairro), responda \u201Cé R$ X \u2014 quer garantir? marca aqui: [link]\u201D. A cliente que pergunta preço está a UM toque de marcar sozinha.',
  'Adesivo com QR na **vitrine de vidro**: quem passa na rua à noite agenda pra amanhã com a loja fechada. Seu melhor vendedor custa o preço de um adesivo e trabalha 24h.',
  'Escolha o horário nobre da sua cliente: poste entre 19h e 21h — é quando ela está no sofá, rolando o feed e decidindo a semana. Post na hora certa vale por três no meio-dia.',
];
function tipsDayNum(){ return Math.floor(new Date(todayStr() + 'T12:00:00Z').getTime() / 864e5); }
function tipsHash(str){ let h = 0; const t = String(str || ''); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; }
function runDivulgaTips(){
  const cfg = automationCfg();
  if (!cfg.divulgaTips) return { ran: false, skipped: 'divulgaTips-off' };
  const hour = brazilHourNow();
  if (hour < 9 || hour >= 21) return { ran: false, skipped: 'janela-9h-21h' };
  const day = tipsDayNum();
  const MAX = Math.max(1, Number(process.env.BOT_TIPS_MAX || 0) || TIPS_DIVULGA.length);
  let sent = 0;
  for (const x of db.salons) {
    if (x.status === 'suspenso') continue;
    const s = readSalon(x.slug); if (!s) continue;
    const phone = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone || s.cfg.botPhone)) || '';
    if (!phone) continue;
    const done = Number(s.tipsSent) || 0;
    if (done >= MAX) continue;
    if ((day + tipsHash(s.slug)) % 2 !== 0) continue;
    if (!claimReportSend('divulga', String(day), s.slug)) continue;
    const tipRaw = TIPS_DIVULGA[(done + tipsHash(s.slug)) % TIPS_DIVULGA.length];
    const tipUrl = bookingUrl(s.slug);
    /* **x** não é negrito no WhatsApp (é *x*); [link] vira o link REAL do salão */
    const tip = String(tipRaw).replace(/\*\*\s*([^*]+?)\s*\*\*/g, '*$1*').replace(/\[seu link\]|\[link\]/g, tipUrl);
    const msg = '💡 *Dica rápida ' + (done + 1) + '/' + TIPS_DIVULGA.length + '* — ' + s.name + '\n\n' + tip + '\n\n📎 *Seu link (copia e cola):*\n' + tipUrl + '\n\nO QR de balcão fica no app do BoraAgendar, no botão \u201C📣 Divulgar\u201D. Dúvida? Responde aqui que a gente te ajuda.';
    s.tipsSent = done + 1;
    writeSalon(s);
    (function(){
      const pr = sendSalonOut(s, phone, msg, 'divulga');
      if (pr && typeof pr.then === 'function') pr.then(function(res){
        /* barrou por motivo temporário (noite, pausa, cap da hora, engarrafamento)? devolve a vez dela */
        if (res && res.error && outRetryable(res.message)) {
          const fr = readSalon(s.slug);
          if (fr) { fr.tipsSent = Math.max(0, (Number(fr.tipsSent) || 1) - 1); writeSalon(fr); }
          releaseReportClaim('divulga', String(day), s.slug);
        }
      }).catch(function(){});
    })();
    sent++;
  }
  return { ran: true, sent };
}

function packDaysLeft(pk){
  if (!pk || !pk.expiresAt) return null;
  try { return Math.round((new Date(pk.expiresAt + 'T12:00:00') - new Date(brazilTodayStr() + 'T12:00:00')) / 864e5); } catch (e) { return null; }
}
function runPackReminders(){
  for (const x of db.salons) {
    let s; try { s = readSalon(x.slug); } catch (e) { continue; }
    if (!s || !(s.packs || []).length) continue;
    if (packRefreshExpired(s)) writeSalon(s);
    const ownerPh = (s.cfg && (s.cfg.notifyPhone || s.cfg.contactPhone)) || '';
    for (const pk of s.packs) {
      if (pk.status !== 'ativo') continue;
      const pl = (s.plans || []).find(y => y.id === pk.planId) || {};
      const ph = pk.client && pk.client.phone;
      const good = phoneDigits(ph || '').length >= 10;
      const dl = packDaysLeft(pk);
      if (dl == null) continue;
      const total = Math.max(4, Number(pk.days != null ? pk.days : (pl.days || 30)));
      const mid = Math.max(2, Math.floor(total / 2));
      if (dl === mid && (pk.usesLeft || 0) > 0 && claimReportSend('pacote-saldo', pk.id + '|' + pk.expiresAt + '|meio', x.slug)) {
        if (good) sendSalonOut(s, ph, '🎟️ Saldo do seu plano — ' + (s.name || '') + '\n\nDo *' + pk.planName + '* ainda restam *' + pk.usesLeft + ' de ' + pk.uses + ' usos* até ' + fmtD(pk.expiresAt) + '. Aproveite os que sobraram 😉' + (pk.renewable !== false ? '\nQuando acabar (ou vencer), é só responder RENOVAR aqui para garantir o próximo período.' : ''), 'lembrete-plano');
      }
      if (dl >= 0 && dl <= 3 && claimReportSend('pacote-fim', pk.id + '|' + pk.expiresAt + '|fim', x.slug)) {
        if (good) sendSalonOut(s, ph, '⏳ Seu plano *' + pk.planName + '* ' + (dl === 0 ? 'termina HOJE' : ('acaba em ' + dl + ' dia(s)')) + ' — ' + fmtD(pk.expiresAt) + ' · restam ' + (pk.usesLeft || 0) + ' uso(s).' + (pk.usesLeft > 0 ? '\n\nDá tempo de usar! E se quiser renovar, me escreva *RENOVAR* que o espaço confirma o Pix e libera o novo período. 💛' : (pk.renewable !== false ? '\n\nSeus usos acabaram — para renovar é só responder *RENOVAR* aqui. ✨' : '')), 'lembrete-plano');
      }
    }
  }
}

/* --- Resumo semanal: DESLIGADO. Donas não recebem relatório no WhatsApp
     (o job horário disparava de novo toda segunda, sem marca de “já enviei”). --- */
function runWeeklySummary(){
  return { ran: false, skipped: 'desligado', sent: 0 };
  const cfg = automationCfg();
  if (!cfg.weeklyReport) return { ran: false, skipped: 'weeklyReport-off' };
  /* Rodar só às segundas. */
  if (new Date().getDay() !== 1) return { ran: false, skipped: 'nao-e-segunda' };
  const today = todayStr();
  const wk = weekStartStr(today);
  let sent = 0;
  for (const meta of db.salons) {
    const s = readSalon(meta.slug);
    if (!s || s.status === 'suspenso') continue;
    if (!(s.cfg && s.cfg.notifyPhone)) continue;
    const appts = s.appointments.filter(a => a.date >= wk && a.date <= today);
    let revenue = 0, canceled = 0, noShow = 0, done = 0;
    appts.forEach(a => {
      if (a.status === 'canceled') canceled++;
      else if (a.status === 'no_show') noShow++;
      else if (a.status === 'done' || (a.status === 'confirmed' && a.date <= today)) { done++; revenue += appointmentPrice(s, a); }
    });
    if (!appts.length && !revenue && !canceled && !noShow) continue;
    const pct = done ? Math.round((done - canceled - noShow) / done * 100) : 0;
    const msg = '📅 *Resumo da semana* — ' + s.name + ' (' + wk + ')\n\n' +
      '💰 Faturamento: ' + fmtBRL(revenue) + '\n' +
      '✅ Atendimentos: ' + done + '\n' +
      '❌ Cancelamentos: ' + canceled + '\n' +
      '⚠️ Faltas: ' + noShow + '\n' +
      '📊 Aproveitamento: ' + pct + '%\n\n' +
      'Detalhes no app: Relatórios.';
    sendOwnerWhats(s, msg);
    sent++;
  }
  return { ran: true, sent, week: wk };
}

/* --- Monitor da instância do WhatsApp (avisa quando cai) --- */
async function runWhatsMonitor(){
  if (!zapsterAuth()) return { ran: false, skipped: 'zapster-off' };
  const cfg = automationCfg();
  const now = Date.now();
  const wants = !!cfg.whatsMonitor;
  ensureDBShape();
  db.whatsStatus = (db.whatsStatus && typeof db.whatsStatus === 'object') ? db.whatsStatus : {};
  const targets = [];
  for (const meta of db.salons) {
    const s = readSalon(meta.slug);
    const inst = salonBotInstance(s);
    if (inst) targets.push({ target: meta.slug, label: s.name, inst });
  }
  const plat = platformInstanceId();
  if (plat) targets.push({ target: 'plataforma', label: 'WhatsApp da plataforma', inst: plat });
  let down = 0, restored = [];
  for (const t of targets) {
    try {
      const r = await zapsterReq('GET', '/v1/wa/instances/' + encodeURIComponent(t.inst));
      const st = (r.data && r.data.status) || '';
      const connected = isWhatsConnectedStatus(st);
      const prev = db.whatsStatus[t.target];
      db.whatsStatus[t.target] = { inst: t.inst, connected, status: st, at: now, known: true };
      if (wants && prev && prev.known && prev.connected && !connected) {
        // avisamos quando uma instância que estava conectada caiu
        const adminPhone = (db.gateway && db.gateway.adminWhats) || '';
        const msg = '🚨 *Bot desconectado* — ' + t.label + '\nA instância *' + t.inst + '* saiu do ar. Clientes podem estar sem resposta no momento.\n\nVerifique no painel ou reconecte o aparelho.';
        if (adminPhone) whatsSend(adminPhone, msg, plat).catch(()=>{});
        down++;
      }
      if (!wants && !prev) { /* apenas registra o estado */ }
    } catch (e) { /* ignora falha de rede em uma instância */ }
  }
  saveDB();
  if (restored.length) return { ran: true, down, restored };
  return { ran: true, down, checked: targets.length };
}

/* --- Backup automático + histórico rotativo --- */
function runAutoBackup(force){
  const cfg = automationCfg();
  if (!cfg.autoBackup) return { ran: false, skipped: 'autoBackup-off' };
  try {
    const now = new Date();
    const dir = path.join(DATA, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const name = 'backup-' + fmtDate(now) + '.json.gz';
    if (!force && fs.existsSync(path.join(dir, name))) return { ran: false, skipped: 'hoje' };
    if (!force && brazilHourNow() < 3) return { ran: false, skipped: 'cedo' };
    const backup = { createdAt: now.toISOString(), db, salons: {} };
    db.salons.forEach(x => { backup.salons[x.slug] = readSalon(x.slug); });
    zlib.gzip(Buffer.from(JSON.stringify(backup)), function (err, buf) {
      if (err) return;
      fs.writeFile(path.join(dir, name), buf, function () {
        try {
          /* mantém 7 e aposenta os .json antigos do formato velho */
          const files = fs.readdirSync(dir).filter(function (f) { return /^backup-.*\.json(\.gz)?$/.test(f); }).sort().reverse();
          while (files.length > 7) { const old = files.pop(); try { fs.unlinkSync(path.join(dir, old)); } catch (e) {} }
        } catch (e) {}
      });
    });
    return { ran: true, file: name };
  } catch (e) { return { ran: false, error: e.message }; }
}

/* Rodar todas as automações (chamado no intervalo e no painel). */
async function runAllAutomations(){
  const [billing, weekly, monitor, backup] = await Promise.all([
    runAutoBilling().catch(()=>({ran:true,charged:0,failed:0})),
    Promise.resolve(runWeeklySummary()),
    runWhatsMonitor().catch(()=>({ran:true,down:0})),
    Promise.resolve(runAutoBackup())
  ]);
  return { billing, weekly, monitor, backup };
}

/* ---------------- servidor ---------------- */
loadDB();
runReminders();
runBirthdayWishes();
runRebookSuggestions();
try { runDivulgaTips(); } catch (e) {}
setTimeout(function(){ try { runPackReminders(); } catch (e) {} }, 22 * 1000); /* 🎟️ lembretes de pacote ao subir */
expireTrials();
setTimeout(function(){ try { mpSettlePendingCharges().catch(function(){}); } catch (e) {} }, 25000);
runMonthlyReports();
runQuarterlyReports();
runAllAutomations().catch(function () {});
setInterval(runReminders, 60 * 60 * 1000); /* a cada hora */
setInterval(runBirthdayWishes, 60 * 60 * 1000); /* parabéns de aniversário */
setInterval(function(){ try { runDivulgaTips(); } catch (e) {} }, 60 * 60 * 1000); /* dicas de divulgação: dia sim/dia não, na fila lenta */
setInterval(function(){ try { runPackReminders(); } catch (e) {} }, 60 * 60 * 1000); /* 🎟️ saldo no meio do ciclo, contagem final e vencimento */
setInterval(runRebookSuggestions, 60 * 60 * 1000); /* a cada hora */
setInterval(expireTrials, 60 * 60 * 1000); /* a cada hora */
setInterval(function(){ try { mpSettlePendingCharges().catch(function(){}); } catch (e) {} }, 15 * 60 * 1000); /* Pix aprovado no MP → baixa sozinho, mesmo com cobrança automática desligada */
setInterval(runMonthlyReports, 60 * 60 * 1000); /* balanço mensal no dia 1 */
setInterval(runQuarterlyReports, 60 * 60 * 1000); /* balanço trimestral no dia 1 (fechamento do trimestre) */
setInterval(function(){ runAllAutomations().catch(function(){}); }, 60 * 60 * 1000); /* automações da plataforma */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  /* toda resposta sai com os cabeçalhos de segurança, sem tocar rota por rota */
  try {
    const _wh = res.writeHead.bind(res);
    res.writeHead = function (code, a2, b2) {
      const sec = securityHeaders(req);
      if (typeof a2 === 'string') return _wh(code, a2, Object.assign({}, sec, (b2 && typeof b2 === 'object') ? b2 : {}));
      return _wh(code, Object.assign({}, sec, (a2 && typeof a2 === 'object') ? a2 : {}));
    };
  } catch (e) { /* cabeçalho é reforço; se falhar, o site continua servindo */ }
  try {
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    }
    await handle(req, res, url, body);
  } catch (e) {
    console.error('ERRO:', e);
    try { json(res, 500, { ok: false, error: 'Erro interno' }); } catch (_) { }
  }
}).listen(PORT, '0.0.0.0', () => {
  try {
    db.gateway = db.gateway || {};
    db.gateway.zapster = db.gateway.zapster || {};
    /* auto-correção de legado: só força Zapster quando o canal oficial Meta
       NÃO está montado — senão cada restart derrubava o provedor escolhido. */
    const __metaOn = db.gateway.whatsappProvider === 'meta' && db.gateway.meta && db.gateway.meta.token && db.gateway.meta.phoneId;
    if (!__metaOn) db.gateway.whatsappProvider = 'zapster';
    if (!String(db.gateway.zapster.instance || '').trim()) {
      db.gateway.zapster.instance = PLATFORM_ZAPSTER_INSTANCE;
      saveDB();
    }
    const hookInst = String(db.gateway.zapster.instance || PLATFORM_ZAPSTER_INSTANCE);
    zapsterEnsureWebhook(hookInst).then(function (r) {
      console.log('   Webhook Zapster:', (r && r.ok) ? (r.url || 'ok') : ((r && r.error) || 'falhou'));
    }).catch(function (e) { console.log('   Webhook Zapster erro:', e && e.message); });
  } catch (e) {}
  console.log('📅 BoraAgendar rodando em http://0.0.0.0:' + PORT);
  console.log('   DATA  :', DATA, process.env.DATA_DIR ? '(DATA_DIR)' : '(./data local)');
  console.log('   PUBLIC_URL:', PUBLIC_URL);
  console.log('   Salões:', (db.salons || []).map(x => x.slug).join(', ') || '(nenhum)');
  console.log('   Admin :', db.admin && db.admin.email);
  try {
    const byInst = {};
    for (const x of (db.salons || [])) {
      const s = readSalon(x.slug);
      const i = s && s.cfg && String(s.cfg.botInstance || '').trim();
      if (i) (byInst[i] = byInst[i] || []).push(x.slug);
    }
    const dup = Object.keys(byInst).filter(i => byInst[i].length > 1);
    if (dup.length) console.log('⚠️  Mesmo ID de WhatsApp em mais de um espaço (' + dup.map(i => i + ' → ' + byInst[i].join('+')).join(' | ') + ')' + (conciergeOn() ? ' — ok no modo concierge (um número atende todos)' : ' — com o concierge desligado, um deles vai responder pelo catálogo do outro'));
    const pi = platformInstanceId();
    const onPlat = (db.salons || []).filter(x => { const s = readSalon(x.slug); return s && s.cfg && String(s.cfg.botInstance || '') === pi; }).map(x => x.slug);
    if (onPlat.length) console.log('🤝 Instância da plataforma (' + pi + ') também atende: ' + onPlat.join(', ') + (conciergeOn() ? ' — modo concierge ligado: o bot pergunta de qual espaço a cliente fala.' : ' — modo concierge DESLIGADO: esse número virou linha exclusiva de ' + onPlat[0]));
  } catch (e) {}
});
