const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { registerMercadoPagoRoutes } = require('./billing-mercadopago');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@emaus.com.br').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PASTOR_EMAIL = (process.env.PASTOR_EMAIL || 'evandro@bethesda.com.br').trim().toLowerCase();
const PASTOR_PASSWORD = process.env.PASTOR_PASSWORD || '';
const RECEPTION_EMAIL = (process.env.RECEPTION_EMAIL || 'mariana@bethesda.com.br').trim().toLowerCase();
const RECEPTION_PASSWORD = process.env.RECEPTION_PASSWORD || '';
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || 'https://emausplataforma.github.io/Emaus').replace(/\/$/, '');
const ZAPSTER_WEBHOOK_SECRET = String(process.env.ZAPSTER_WEBHOOK_SECRET || '').trim();
const BOT_DEFAULTS = Object.freeze({
  enabled: true,
  provider: 'zapster',
  channel: 'WhatsApp',
  senderMode: 'platform_shared',
  senderLabelMode: 'church_only',
  timezone: 'America/Sao_Paulo',
  visitorSequence: 'once_ever',
  visitorFirstTime: '22:30',
  visitorSecondTime: '17:00',
  cultReminderTime: '17:00',
  youtubeUrl: '',
  visitorFirstTemplate: 'Olá, {name}! Foi uma alegria receber você na {church_name}. Conheça nossa igreja: {public_url}',
  visitorSecondTemplate: 'Olá, {name}! Aqui está um vídeo sobre a {church_name}: {youtube_url}\n\nVocê deseja continuar recebendo convites para festividades e informações da igreja?\nResponda SIM para continuar ou NÃO para parar.'
});

if (!DATABASE_URL) {
  console.error('DATABASE_URL não foi configurada.');
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou curto demais. Configure uma chave aleatória com pelo menos 32 caracteres no Railway.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000
});

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(value => value.trim()), credentials: true }));
app.use(express.json({ limit: '2mb' }));

const loginAttempts = new Map();
const publicVisitAttempts = new Map();
function publicVisitAllowed(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const current = publicVisitAttempts.get(key) || { count: 0, firstAt: now };
  if (now - current.firstAt > 60 * 60 * 1000) {
    publicVisitAttempts.set(key, { count: 1, firstAt: now });
    return true;
  }
  if (current.count >= 20) return false;
  publicVisitAttempts.set(key, { count: current.count + 1, firstAt: current.firstAt });
  return true;
}
function loginRateLimit(email) {
  const key = String(email || '').toLowerCase();
  const now = Date.now();
  const current = loginAttempts.get(key) || { count: 0, firstAt: now };
  if (now - current.firstAt > 15 * 60 * 1000) return loginAttempts.delete(key), false;
  return current.count >= 8;
}
function registerLoginFailure(email) {
  const key = String(email || '').toLowerCase();
  const now = Date.now();
  const current = loginAttempts.get(key) || { count: 0, firstAt: now };
  if (now - current.firstAt > 15 * 60 * 1000) loginAttempts.set(key, { count: 1, firstAt: now });
  else loginAttempts.set(key, { count: current.count + 1, firstAt: current.firstAt });
}
function clearLoginFailures(email) { loginAttempts.delete(String(email || '').toLowerCase()); }

function slugify(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `igreja-${Date.now()}`;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function moneyFromCents(value) {
  return Number(value || 0) / 100;
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}
function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function safeUser(row) {
  if (!row) return null;
  return { id: row.id, churchId: row.church_id, name: row.name, preferredName: row.preferred_name || '', gender: row.gender || 'unspecified', email: row.email, phone: row.phone || '', jobRole: row.job_role || '', role: row.role, status: row.status, permissions: row.permissions || [], twoFactorEnabled: Boolean(row.two_factor_enabled) };
}

function signUser(user) {
  return jwt.sign({ sub: user.id, role: user.role, churchId: user.church_id || null, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
}

async function query(text, params = []) {
  return pool.query(text, params);
}

function botSettingsFromChurch(church = {}) {
  return { ...BOT_DEFAULTS, ...(church.public_settings?.bot || church.publicSettings?.bot || {}) };
}

function botPublicUrl(church = {}) {
  return `${PUBLIC_APP_URL}/publica.html?igreja=${encodeURIComponent(church.slug || 'igreja')}`;
}

function addDaysIso(dateValue, amount) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(dateValue).slice(0, 10);
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeToUtc(dateValue, timeValue, timeZone = BOT_DEFAULTS.timezone) {
  const [year, month, day] = String(dateValue || '').slice(0, 10).split('-').map(Number);
  const [hour, minute] = String(timeValue || '00:00').split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(guess).reduce((acc, part) => { if (part.type !== 'literal') acc[part.type] = part.value; return acc; }, {});
  const localAtGuess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() - (localAtGuess - guess.getTime()));
}

function botScheduledStatus(scheduledFor) {
  return scheduledFor && scheduledFor.getTime() > Date.now() ? 'planned' : 'skipped_window';
}

function renderBotTemplate(template, context = {}) {
  return String(template || '').replace(/\{(name|church_name|public_url|youtube_url|event_title|event_date|event_time|event_location)\}/g, (_, key) => String(context[key] || ''));
}

async function upsertBotContact({ churchId, visitorId = null, memberId = null, name = '', phone = '' }) {
  const phoneNormalized = normalizePhone(phone) || (visitorId ? `visitor:${visitorId}` : memberId ? `member:${memberId}` : '');
  if (!phoneNormalized) return null;
  const result = await query(`INSERT INTO bot_contacts (church_id, phone_normalized, name, visitor_id, member_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (church_id, phone_normalized) DO UPDATE SET name = EXCLUDED.name,
      visitor_id = COALESCE(bot_contacts.visitor_id, EXCLUDED.visitor_id),
      member_id = COALESCE(bot_contacts.member_id, EXCLUDED.member_id), updated_at = NOW()
    RETURNING *`, [churchId, phoneNormalized, String(name || '').slice(0, 180), visitorId, memberId]);
  return result.rows[0] || null;
}

async function enqueueBotDelivery({ churchId, recipientType, recipientId = null, recipientKey, recipientName = '', phone = '', messageType, body, scheduledFor, status = 'planned', metadata = {}, provider = 'zapster', dedupeKey }) {
  if (!churchId || !recipientKey || !messageType || !dedupeKey || !scheduledFor) return null;
  const result = await query(`INSERT INTO bot_delivery_queue
    (church_id, recipient_type, recipient_id, recipient_key, recipient_name, phone_normalized, message_type, body, scheduled_for, status, provider, metadata, dedupe_key)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`, [
    churchId,
    recipientType,
    recipientId,
    recipientKey,
    String(recipientName || '').slice(0, 180),
    normalizePhone(phone),
    messageType,
    String(body || '').slice(0, 4000),
    scheduledFor,
    status,
    provider,
    JSON.stringify(metadata || {}),
    dedupeKey
  ]);
  if (!result.rows[0]) return null;
  return result.rows[0];
}

async function queueVisitorBotSequence(visitor, church) {
  if (!visitor || !church) return { queued: 0, reason: 'missing_data' };
  const settings = botSettingsFromChurch(church);
  if (settings.enabled === false) return { queued: 0, reason: 'disabled' };
  const phone = normalizePhone(visitor.phone || '');
  const contact = await upsertBotContact({ churchId: church.id, visitorId: visitor.id, name: visitor.name, phone });
  if (contact?.status === 'opted_out') return { queued: 0, reason: 'opted_out' };
  const recipientKey = phone || `visitor:${visitor.id}`;
  const existing = (await query(`SELECT id FROM bot_delivery_queue WHERE church_id = $1 AND recipient_key = $2 AND message_type IN ('visitor_public_page', 'visitor_video_optin') LIMIT 1`, [church.id, recipientKey])).rows[0];
  if (existing) return { queued: 0, reason: 'already_planned' };
  const publicUrl = botPublicUrl(church);
  const firstScheduledFor = zonedDateTimeToUtc(visitor.visit_date, settings.visitorFirstTime, settings.timezone);
  const secondScheduledFor = zonedDateTimeToUtc(addDaysIso(visitor.visit_date, 1), settings.visitorSecondTime, settings.timezone);
  const missingPhone = !phone;
  const firstStatus = missingPhone ? 'blocked_missing_phone' : botScheduledStatus(firstScheduledFor);
  const secondStatus = missingPhone ? 'blocked_missing_phone' : !String(settings.youtubeUrl || '').trim() ? 'blocked_missing_video' : firstStatus === 'skipped_window' ? 'skipped_dependency' : botScheduledStatus(secondScheduledFor);
  const first = await enqueueBotDelivery({
    churchId: church.id,
    recipientType: 'visitor',
    recipientId: visitor.id,
    recipientKey,
    recipientName: visitor.name,
    phone,
    messageType: 'visitor_public_page',
    body: renderBotTemplate(settings.visitorFirstTemplate, { name: visitor.name, church_name: church.name, public_url: publicUrl }),
    scheduledFor: firstScheduledFor,
    status: firstStatus,
    metadata: { visitDate: String(visitor.visit_date).slice(0, 10), publicUrl, sequence: 'once_ever', senderMode: 'platform_shared', senderLabel: church.name },
    dedupeKey: `visitor:${church.id}:${recipientKey}:public-page`
  });
  const second = await enqueueBotDelivery({
    churchId: church.id,
    recipientType: 'visitor',
    recipientId: visitor.id,
    recipientKey,
    recipientName: visitor.name,
    phone,
    messageType: 'visitor_video_optin',
    body: renderBotTemplate(settings.visitorSecondTemplate, { name: visitor.name, church_name: church.name, public_url: publicUrl, youtube_url: settings.youtubeUrl }),
    scheduledFor: secondScheduledFor,
    status: secondStatus,
    metadata: { visitDate: String(visitor.visit_date).slice(0, 10), publicUrl, youtubeUrl: settings.youtubeUrl || '', asksOnce: true, senderMode: 'platform_shared', senderLabel: church.name },
    dedupeKey: `visitor:${church.id}:${recipientKey}:video-optin`
  });
  return { queued: Number(Boolean(first)) + Number(Boolean(second)), firstStatus, secondStatus };
}

async function queueCultReminderForEvent(event, church) {
  if (!event || !church || String(event.event_type || '').toLowerCase() !== 'culto' || event.status === 'blocked' || event.status === 'paused') return 0;
  const settings = botSettingsFromChurch(church);
  if (settings.enabled === false) return 0;
  const scheduledFor = zonedDateTimeToUtc(addDaysIso(event.event_date, -1), settings.cultReminderTime, settings.timezone);
  if (!scheduledFor) return 0;
  const members = (await query(`SELECT id, name, preferred_name, phone FROM members
    WHERE church_id = $1 AND status = 'active' AND communication_consent = TRUE AND NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), '') IS NOT NULL`, [church.id])).rows;
  let queued = 0;
  for (const member of members) {
    const displayName = member.preferred_name || member.name;
    const body = `Olá, ${displayName}! Lembramos que amanhã teremos ${event.title} às ${event.event_time || '19:00'}, em ${event.location || 'Templo principal'}, na ${church.name}.`;
    const item = await enqueueBotDelivery({
      churchId: church.id,
      recipientType: 'member',
      recipientId: member.id,
      recipientKey: `member:${member.id}`,
      recipientName: displayName,
      phone: member.phone,
      messageType: 'cult_reminder',
      body,
      scheduledFor,
      status: botScheduledStatus(scheduledFor),
      metadata: { eventId: event.id, eventDate: String(event.event_date).slice(0, 10), eventType: event.event_type, timezone: settings.timezone, senderMode: 'platform_shared', senderLabel: church.name },
      dedupeKey: `cult:${church.id}:${event.id}:${member.id}`
    });
    if (item) queued += 1;
  }
  return queued;
}

async function collectBotBroadcastRecipients(churchId, audience) {
  const normalizedAudience = String(audience || 'Toda a igreja').trim();
  const recipients = new Map();
  const add = (row, type) => {
    const phone = normalizePhone(row.phone || '');
    if (!phone || recipients.has(phone)) return;
    recipients.set(phone, { type, id: row.id, name: row.preferred_name || row.name, phone });
  };
  const addMembers = async (where = '', params = []) => {
    const result = await query(`SELECT id, name, preferred_name, phone FROM members WHERE church_id = $1 AND status = 'active' AND communication_consent = TRUE ${where}`, [churchId, ...params]);
    result.rows.forEach(row => add(row, 'member'));
  };
  const addVisitors = async () => {
    const result = await query(`SELECT c.visitor_id AS id, c.name, c.phone_normalized AS phone FROM bot_contacts c
      WHERE c.church_id = $1 AND c.status = 'opted_in' AND c.visitor_id IS NOT NULL`, [churchId]);
    result.rows.forEach(row => add(row, 'visitor'));
  };
  if (normalizedAudience === 'Toda a igreja' || normalizedAudience === 'Todos') {
    await addMembers();
    await addVisitors();
  } else if (normalizedAudience === 'Membros') {
    await addMembers();
  } else if (normalizedAudience === 'Visitantes') {
    await addVisitors();
  } else {
    const ministry = normalizedAudience.replace(/^Ministério:\s*/i, '').trim();
    await addMembers('AND (LOWER(members.ministry) = LOWER($2) OR LOWER(COALESCE(members.ministry, \'\')) = LOWER($2))', [ministry]);
  }
  return [...recipients.values()];
}

async function queueAnnouncementBotDeliveries(announcement, churchId) {
  if (!announcement || !churchId || !Array.isArray(announcement.channels) || !announcement.channels.includes('WhatsApp')) return 0;
  const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [churchId])).rows[0];
  if (!church || botSettingsFromChurch(church).enabled === false) return 0;
  const recipients = await collectBotBroadcastRecipients(churchId, announcement.audience);
  const scheduledFor = announcement.scheduled_for ? new Date(announcement.scheduled_for) : new Date();
  let queued = 0;
  for (const recipient of recipients) {
    const item = await enqueueBotDelivery({
      churchId,
      recipientType: recipient.type,
      recipientId: recipient.id,
      recipientKey: recipient.phone,
      recipientName: recipient.name,
      phone: recipient.phone,
      messageType: 'pastor_broadcast',
      body: announcement.body,
      scheduledFor,
      status: announcement.status === 'scheduled' ? 'planned' : 'planned',
      metadata: { announcementId: announcement.id, audience: announcement.audience, title: announcement.title, senderMode: 'platform_shared', senderLabel: church.name },
      dedupeKey: `announcement:${churchId}:${announcement.id}:${recipient.phone}`
    });
    if (item) queued += 1;
  }
  return queued;
}

async function syncBotQueuesForChurch(churchId) {
  try {
    const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1 AND status IN (\'active\', \'trial\')', [churchId])).rows[0];
    if (!church || botSettingsFromChurch(church).enabled === false) return;
    const visitors = (await query(`SELECT * FROM visitors WHERE church_id = $1 AND visit_date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY visit_date ASC`, [churchId])).rows;
    for (const visitor of visitors) {
      if (visitor.communication_consent) await queueVisitorBotSequence(visitor, church);
    }
    const events = (await query(`SELECT * FROM church_events WHERE church_id = $1 AND status = 'active' AND event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + INTERVAL '90 days' AND LOWER(event_type) = 'culto'`, [churchId])).rows;
    for (const event of events) await queueCultReminderForEvent(event, church);
    if (String(botSettingsFromChurch(church).youtubeUrl || '').trim()) {
      await query(`UPDATE bot_delivery_queue SET status = 'planned', updated_at = NOW()
        WHERE church_id = $1 AND message_type = 'visitor_video_optin' AND status = 'blocked_missing_video' AND scheduled_for > NOW()`, [churchId]);
    }
  } catch (error) {
    console.error('Não foi possível preparar a fila do bot:', error.message);
  }
}

async function syncBotQueuesForAllChurches() {
  const churches = (await query("SELECT id FROM churches WHERE status IN ('active', 'trial')")).rows;
  for (const church of churches) await syncBotQueuesForChurch(church.id);
}

function activityInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'EA';
}

async function recordActivity(churchId, activity = {}, actor = null) {
  if (!churchId || !activity.name || !activity.text) return;
  try {
    await query(`INSERT INTO church_activity (church_id, activity_type, name, text, initials, tone, metadata, actor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      churchId,
      activity.type || 'general',
      String(activity.name).slice(0, 180),
      String(activity.text).slice(0, 300),
      activity.initials || activityInitials(activity.name),
      activity.tone || 'dark',
      JSON.stringify(activity.metadata || {}),
      actor?.id || null
    ]);
  } catch (error) {
    console.error('Não foi possível registrar a atividade da igreja:', error.message);
  }
}

async function audit(actor, action, payload = {}, churchId = actor?.church_id || null) {
  await query('INSERT INTO audit_events (actor_id, church_id, action, payload) VALUES ($1, $2, $3, $4)', [actor?.id || null, churchId, action, JSON.stringify(payload)]);
  const templates = {
    public_visitor_created: { type: 'visitor', name: payload.name || 'Novo visitante', text: 'foi cadastrado como novo visitante.', tone: 'copper' },
    visitor_created: { type: 'visitor', name: payload.name || 'Novo visitante', text: 'foi cadastrado como novo visitante.', tone: 'copper' },
    visitor_status_updated: { type: 'return', name: payload.name || 'Visitante', text: payload.activityText || 'teve o acompanhamento atualizado.', tone: 'olive' },
    announcement_created: { type: 'announcement', name: payload.title || 'Novo aviso', text: payload.status === 'scheduled' ? 'foi agendado para registro.' : 'foi registrado para comunicação.', tone: 'gold' },
    church_settings_updated: { type: 'settings', name: 'Configurações da igreja', text: 'foram atualizadas.', tone: 'dark' },
    ministry_created: { type: 'ministry', name: payload.name || 'Ministério', text: 'foi adicionado à igreja.', tone: 'olive' },
    reception_user_created: { type: 'access', name: payload.name || 'Novo acesso', text: 'foi criado para a recepção.', tone: 'copper' },
    reception_user_updated: { type: 'access', name: payload.name || 'Acesso da recepção', text: 'foi atualizado.', tone: 'copper' },
    reception_user_deleted: { type: 'access', name: payload.name || 'Acesso da recepção', text: 'foi removido.', tone: 'copper' },
    member_created: { type: 'member', name: payload.name || 'Novo membro', text: 'foi cadastrado como membro.', tone: 'olive' },
    member_updated: { type: 'member', name: payload.name || 'Membro', text: 'teve o cadastro atualizado.', tone: 'olive' },
    member_deleted: { type: 'member', name: payload.name || 'Membro', text: 'foi removido do cadastro.', tone: 'olive' },
    member_attendance_created: { type: 'attendance', name: payload.name || 'Presença', text: 'foi registrada.', tone: 'dark' },
    care_task_created: { type: 'care', name: payload.title || 'Cuidado pastoral', text: 'foi registrado para acompanhamento.', tone: 'copper' },
    care_task_updated: { type: 'care', name: payload.title || 'Cuidado pastoral', text: 'teve o status atualizado.', tone: 'copper' },
    events_created: { type: 'event', name: payload.title || 'Agenda', text: 'teve novo evento registrado.', tone: 'dark' },
    event_updated: { type: 'event', name: payload.title || 'Evento', text: 'foi atualizado na agenda.', tone: 'dark' },
    event_deleted: { type: 'event', name: payload.title || 'Evento', text: 'foi removido da agenda.', tone: 'dark' },
    leader_created: { type: 'leader', name: payload.name || 'Nova liderança', text: 'foi adicionada à equipe.', tone: 'olive' },
    leader_updated: { type: 'leader', name: payload.name || 'Liderança', text: 'teve o cadastro atualizado.', tone: 'olive' },
    leader_deleted: { type: 'leader', name: payload.name || 'Liderança', text: 'foi removida da equipe.', tone: 'olive' }
  };
  const template = templates[action];
  if (template) await recordActivity(churchId, { ...template, metadata: { action, ...payload } }, actor);
}

function auth(requiredRoles = []) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
      const claims = jwt.verify(token, JWT_SECRET);
      const result = await query('SELECT * FROM users WHERE id = $1 AND status = $2', [claims.sub, 'active']);
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Usuário não encontrado ou bloqueado.' });
      if (requiredRoles.length && !requiredRoles.includes(user.role)) return res.status(403).json({ error: 'Permissão insuficiente.' });
      if (user.role !== 'platform_admin' && user.church_id) {
        const church = (await query('SELECT status, trial_ends_at FROM churches WHERE id = $1', [user.church_id])).rows[0];
        if (!church) return res.status(403).json({ error: 'Igreja não encontrada.' });
        if (church.status === 'blocked') return res.status(403).json({ error: 'O acesso desta igreja está bloqueado. Procure o suporte.' });
        if (church.status === 'paused') return res.status(403).json({ error: 'O acesso desta igreja está pausado. Procure o suporte.' });
        if (church.status === 'trial' && church.trial_ends_at && new Date(church.trial_ends_at).getTime() < Date.now()) return res.status(402).json({ error: 'O período de teste desta igreja terminou. Consulte os planos para continuar.' });
      }
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
  };
}

function churchScope(req, requestedChurchId) {
  if (req.user.role === 'platform_admin') return requestedChurchId || null;
  return req.user.church_id;
}

function requireChurch(req, res, next) {
  const churchId = req.params.churchId || req.body.churchId || req.query.churchId;
  if (req.user.role !== 'platform_admin' && churchId && churchId !== req.user.church_id) return res.status(403).json({ error: 'Acesso limitado à igreja correspondente.' });
  req.churchId = churchScope(req, churchId);
  next();
}

registerMercadoPagoRoutes({ app, auth, query, audit, publicAppUrl: PUBLIC_APP_URL });

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'emaus-api', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, error: 'Banco de dados indisponível.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'emaus-api' }));

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Informe login e senha.' });
  if (loginRateLimit(email)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' });
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) {
    registerLoginFailure(email);
    if (user) await audit(user, 'login_failed', { reason: 'invalid_credentials' }, user.church_id);
    return res.status(401).json({ error: 'Login ou senha inválidos.' });
  }
  clearLoginFailures(email);
  await audit(user, 'login');
  res.json({ token: signUser(user), user: safeUser(user) });
});

app.get('/api/me', auth(), async (req, res) => {
  res.json({ user: safeUser(req.user) });
});

app.get('/api/me/security', auth(), async (req, res) => {
  res.json({ twoFactor: { enabled: Boolean(req.user.two_factor_enabled), prepared: true, enforced: false, activation: 'guided' } });
});

app.patch('/api/me/profile', auth(), async (req, res) => {
  const preferredName = String(req.body.preferredName || '').trim();
  const gender = ['female', 'male', 'plural', 'unspecified'].includes(req.body.gender) ? req.body.gender : 'unspecified';
  const result = await query('UPDATE users SET preferred_name = $1, gender = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [preferredName, gender, req.user.id]);
  await audit(req.user, 'profile_updated', { fields: ['preferredName', 'gender'] }, req.user.church_id);
  res.json({ user: safeUser(result.rows[0]) });
});

app.get('/api/admin/summary', auth(['platform_admin']), async (req, res) => {
  const [churches, revenue, expenses, people] = await Promise.all([
    query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked FROM churches"),
    query("SELECT COALESCE(SUM(monthly_price_cents), 0)::int AS cents FROM churches WHERE status = 'active'"),
    query('SELECT COALESCE(SUM(amount_cents), 0)::int AS cents FROM expenses WHERE expense_date >= date_trunc(\'month\', CURRENT_DATE)'),
    query("SELECT COALESCE(SUM(member_count), 0)::int AS total FROM churches WHERE status = 'active'")
  ]);
  res.json({ churches: churches.rows[0], monthlyRevenue: moneyFromCents(revenue.rows[0].cents), monthlyExpenses: moneyFromCents(expenses.rows[0].cents), activePeople: people.rows[0].total });
});

app.get('/api/admin/churches', auth(['platform_admin']), async (req, res) => {
  const result = await query(`SELECT c.*, p.name AS plan_name, p.member_limit, p.user_limit FROM churches c LEFT JOIN plans p ON p.id = c.plan_id ORDER BY c.created_at DESC`);
  res.json({ churches: result.rows });
});

app.post('/api/admin/churches', auth(['platform_admin']), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome da igreja é obrigatório.' });
  const planId = String(req.body.planId || 'essencial');
  const plan = (await query('SELECT * FROM plans WHERE id = $1 AND active = TRUE', [planId])).rows[0];
  if (!plan) return res.status(400).json({ error: 'Plano não encontrado.' });
  const slug = `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;
  const trialDays = 30;
  const church = (await query(`INSERT INTO churches (name, slug, city, phone, pastors, plan_id, status, member_count, monthly_price_cents, trial_started_at, trial_ends_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'trial', 0, $7, NOW(), NOW() + ($8 || ' days')::interval) RETURNING *`, [name, slug, req.body.city || 'Brasil', req.body.phone || '', req.body.pastors || '', plan.id, plan.price_cents, trialDays])).rows[0];
  await audit(req.user, 'church_created', { churchId: church.id, planId: plan.id }, church.id);
  res.status(201).json({ church });
});

app.patch('/api/admin/churches/:churchId', auth(['platform_admin']), async (req, res) => {
  const name = req.body.name === undefined ? null : String(req.body.name || '').trim();
  const city = req.body.city === undefined ? null : String(req.body.city || '').trim();
  const phone = req.body.phone === undefined ? null : String(req.body.phone || '').trim();
  const pastors = req.body.pastors === undefined ? null : String(req.body.pastors || '').trim();
  const planId = req.body.planId === undefined ? null : String(req.body.planId || '').trim();
  if (name !== null && !name) return res.status(400).json({ error: 'Nome da igreja é obrigatório.' });
  if (planId !== null) {
    const plan = (await query('SELECT id FROM plans WHERE id = $1 AND active = TRUE', [planId])).rows[0];
    if (!plan) return res.status(400).json({ error: 'Plano não encontrado.' });
  }
  const result = await query(`UPDATE churches SET
    name = COALESCE($1, name), city = COALESCE($2, city), phone = COALESCE($3, phone), pastors = COALESCE($4, pastors),
    plan_id = COALESCE($5, plan_id),
    monthly_price_cents = CASE WHEN $5 IS NULL THEN monthly_price_cents ELSE COALESCE((SELECT price_cents FROM plans WHERE id = $5), monthly_price_cents) END,
    updated_at = NOW() WHERE id = $6 RETURNING *`, [name, city, phone, pastors, planId, req.params.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja não encontrada.' });
  await audit(req.user, 'church_updated', { churchId: req.params.churchId, fields: Object.keys(req.body).slice(0, 10) }, req.params.churchId);
  res.json({ church: result.rows[0] });
});

app.get('/api/admin/churches/:churchId/summary', auth(['platform_admin']), async (req, res) => {
  const church = (await query(`SELECT c.*, p.name AS plan_name, p.member_limit, p.user_limit
    FROM churches c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = $1`, [req.params.churchId])).rows[0];
  if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
  const [members, visitors, events, users, bot, activity] = await Promise.all([
    query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM members WHERE church_id = $1", [church.id]),
    query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE visit_date >= CURRENT_DATE - INTERVAL '30 days')::int AS recent FROM visitors WHERE church_id = $1", [church.id]),
    query("SELECT COUNT(*)::int AS total FROM church_events WHERE church_id = $1 AND status = 'active' AND event_date >= CURRENT_DATE", [church.id]),
    query("SELECT COUNT(*)::int AS total FROM users WHERE church_id = $1 AND status = 'active'", [church.id]),
    query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('planned', 'blocked_missing_video'))::int AS pending FROM bot_delivery_queue WHERE church_id = $1", [church.id]),
    query("SELECT id, action, payload, created_at FROM audit_events WHERE church_id = $1 ORDER BY created_at DESC LIMIT 8", [church.id])
  ]);
  res.json({ church, summary: { members: members.rows[0], visitors: visitors.rows[0], upcomingEvents: events.rows[0].total, users: users.rows[0].total, bot: bot.rows[0] }, activity: activity.rows });
});

app.patch('/api/admin/churches/:churchId/status', auth(['platform_admin']), async (req, res) => {
  const requestedStatus = String(req.body.status || '').trim();
  const allowedStatuses = ['active', 'blocked', 'trial', 'paused'];
  const status = allowedStatuses.includes(requestedStatus) ? requestedStatus : null;
  if (!status) return res.status(400).json({ error: 'Status administrativo inválido.' });
  const result = await query('UPDATE churches SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, req.params.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja não encontrada.' });
  await audit(req.user, status === 'blocked' ? 'church_blocked' : 'church_status_updated', { churchId: req.params.churchId, status }, req.params.churchId);
  res.json({ church: result.rows[0] });
});

app.get('/api/admin/support', auth(['platform_admin']), async (req, res) => {
  const result = await query(`SELECT s.*, c.name AS church_name
    FROM platform_support_requests s LEFT JOIN churches c ON c.id = s.church_id
    ORDER BY s.created_at DESC LIMIT 100`);
  res.json({ requests: result.rows });
});

app.post('/api/admin/support', auth(['platform_admin']), async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  if (!subject || !message) return res.status(400).json({ error: 'Assunto e descrição são obrigatórios.' });
  const priority = ['low', 'normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal';
  const churchId = req.body.churchId ? String(req.body.churchId) : null;
  if (churchId) {
    const church = (await query('SELECT id FROM churches WHERE id = $1', [churchId])).rows[0];
    if (!church) return res.status(400).json({ error: 'Igreja não encontrada.' });
  }
  const result = await query(`INSERT INTO platform_support_requests (church_id, requester_name, requester_email, subject, message, priority)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [churchId, String(req.body.requesterName || '').trim(), String(req.body.requesterEmail || '').trim().toLowerCase(), subject, message, priority]);
  await audit(req.user, 'support_request_created', { requestId: result.rows[0].id, churchId });
  res.status(201).json({ request: result.rows[0] });
});

app.patch('/api/admin/support/:requestId', auth(['platform_admin']), async (req, res) => {
  const status = ['open', 'in_progress', 'resolved'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Status de suporte inválido.' });
  const result = await query(`UPDATE platform_support_requests SET status = $1, resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE NULL END, updated_at = NOW()
    WHERE id = $2 RETURNING *`, [status, req.params.requestId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  await audit(req.user, 'support_request_updated', { requestId: req.params.requestId, status });
  res.json({ request: result.rows[0] });
});

app.get('/api/admin/leads', auth(['platform_admin']), async (req, res) => {
  const result = await query(`SELECT l.*, c.name AS linked_church_name
    FROM platform_leads l LEFT JOIN churches c ON c.id = l.church_id
    ORDER BY l.created_at DESC LIMIT 200`);
  res.json({ leads: result.rows });
});

app.post('/api/admin/leads', auth(['platform_admin']), async (req, res) => {
  const churchName = String(req.body.churchName || '').trim();
  if (!churchName) return res.status(400).json({ error: 'Nome da igreja interessada é obrigatório.' });
  const status = ['interested', 'onboarding', 'trial', 'converted', 'lost'].includes(req.body.status) ? req.body.status : 'interested';
  const result = await query(`INSERT INTO platform_leads (church_name, city, contact_name, contact_email, contact_phone, source, status, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [churchName, String(req.body.city || '').trim(), String(req.body.contactName || '').trim(), String(req.body.contactEmail || '').trim().toLowerCase(), String(req.body.contactPhone || '').trim(), String(req.body.source || 'indicação').trim(), status, String(req.body.notes || '').trim()]);
  await audit(req.user, 'lead_created', { leadId: result.rows[0].id, status });
  res.status(201).json({ lead: result.rows[0] });
});

app.patch('/api/admin/leads/:leadId', auth(['platform_admin']), async (req, res) => {
  const status = ['interested', 'onboarding', 'trial', 'converted', 'lost'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Status de lead inválido.' });
  const result = await query('UPDATE platform_leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, req.params.leadId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja interessada não encontrada.' });
  await audit(req.user, 'lead_status_updated', { leadId: req.params.leadId, status });
  res.json({ lead: result.rows[0] });
});

app.get('/api/admin/plans', auth(['platform_admin']), async (req, res) => {
  const result = await query('SELECT * FROM plans WHERE active = TRUE ORDER BY price_cents ASC');
  res.json({ plans: result.rows.map(plan => ({ ...plan, price: moneyFromCents(plan.price_cents) })) });
});

app.put('/api/admin/plans', auth(['platform_admin']), async (req, res) => {
  const plans = Array.isArray(req.body.plans) ? req.body.plans : [];
  if (plans.length !== 3) return res.status(400).json({ error: 'A Emaús deve manter três planos ativos.' });
  for (const plan of plans) {
    await query(`UPDATE plans SET name = $1, price_cents = $2, member_limit = $3, user_limit = $4, description = $5, features = $6, updated_at = NOW() WHERE id = $7`, [plan.name, cents(plan.price), Number(plan.memberLimit), Number(plan.userLimit), plan.description || '', JSON.stringify(plan.features || []), plan.id]);
  }
  await audit(req.user, 'plans_updated', { count: plans.length });
  const result = await query('SELECT * FROM plans WHERE active = TRUE ORDER BY price_cents ASC');
  res.json({ plans: result.rows });
});

app.get('/api/admin/finance', auth(['platform_admin']), async (req, res) => {
  const result = await query('SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC LIMIT 100');
  res.json({ expenses: result.rows.map(item => ({ ...item, amount: moneyFromCents(item.amount_cents) })) });
});

app.post('/api/admin/expenses', auth(['platform_admin']), async (req, res) => {
  const description = String(req.body.description || '').trim();
  const amountCents = cents(req.body.amount);
  if (!description || amountCents <= 0) return res.status(400).json({ error: 'Descrição e valor são obrigatórios.' });
  const result = await query('INSERT INTO expenses (description, category, amount_cents, created_by) VALUES ($1, $2, $3, $4) RETURNING *', [description, req.body.category || 'Outro', amountCents, req.user.id]);
  await audit(req.user, 'expense_created', { expenseId: result.rows[0].id, amount: moneyFromCents(amountCents) });
  res.status(201).json({ expense: result.rows[0] });
});

app.get('/api/public/church', async (req, res) => {
  const requestedSlug = String(req.query.slug || 'bethesda').trim().toLowerCase();
  const result = await query("SELECT id, name, slug, city, phone, pastors, description, logo_url, public_settings, status FROM churches WHERE slug = $1 AND status IN ('active', 'trial')", [requestedSlug]);
  const church = result.rows[0];
  if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
  const publicSettings = church.public_settings || {};
  if (publicSettings.visible === false) return res.status(404).json({ error: 'A página pública desta igreja está temporariamente indisponível.' });
  const events = await query(`SELECT id, title, event_date, event_time, location, event_type, audience, recurrence_rule, recurrence_id
    FROM church_events WHERE church_id = $1 AND event_date >= CURRENT_DATE ORDER BY event_date ASC, event_time ASC LIMIT 120`, [church.id]);
  res.json({ church: { ...church, publicSettings }, events: events.rows });
});

app.post('/api/public/church/:slug/visitors', async (req, res) => {
  if (!publicVisitAllowed(req.ip)) return res.status(429).json({ error: 'Muitos cadastros neste momento. Tente novamente mais tarde.' });
  const slug = String(req.params.slug || '').trim().toLowerCase();
  const church = (await query("SELECT id, name FROM churches WHERE slug = $1 AND status IN ('active', 'trial')", [slug])).rows[0];
  if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
  const name = String(req.body.name || '').trim();
  const phone = normalizePhone(req.body.phone || '');
  const consent = Boolean(req.body.consent);
  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
  if (!consent) return res.status(400).json({ error: 'É necessário autorizar o contato da igreja.' });
  const result = await query(`INSERT INTO visitors (church_id, name, family_name, family_members, arrival_type, phone, visit_date, service, invited_by, notes, communication_consent, consent_version, consent_updated_at, status, responsible)
    VALUES ($1, $2, '', $3, 'Sozinho', $4, CURRENT_DATE, 'Cadastro pela página pública', '', $5, TRUE, 'public-v1', NOW(), 'Novo', 'Recepção') RETURNING id, name, visit_date, communication_consent` , [church.id, name, JSON.stringify([name]), phone, String(req.body.notes || '').trim()]);
  const visitor = { ...result.rows[0], phone, church_id: church.id };
  await audit(null, 'public_visitor_created', { visitorId: result.rows[0].id, churchId: church.id, name: result.rows[0].name }, church.id);
  await queueVisitorBotSequence(visitor, { id: church.id, name: church.name, slug, public_settings: {} });
  res.status(201).json({ ok: true, church: church.name, visitor: result.rows[0], delivery: 'not_configured' });
});

app.get('/api/church/bot-settings', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja não encontrada.' });
  const bot = botSettingsFromChurch(result.rows[0]);
  const queue = await query(`SELECT status, COUNT(*)::int AS total FROM bot_delivery_queue WHERE church_id = $1 GROUP BY status ORDER BY status`, [req.churchId]);
  res.json({ bot, providerConfigured: false, provider: 'zapster', instanceMode: 'platform_shared', senderLabelMode: 'church_only', queue: queue.rows });
});

app.put('/api/church/bot-settings', auth(['church_admin']), requireChurch, async (req, res) => {
  const churchResult = await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId]);
  const church = churchResult.rows[0];
  if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
  const input = req.body.bot && typeof req.body.bot === 'object' ? req.body.bot : {};
  const current = botSettingsFromChurch(church);
  const youtubeUrl = String(input.youtubeUrl ?? current.youtubeUrl ?? '').trim();
  if (youtubeUrl && !/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(youtubeUrl)) return res.status(400).json({ error: 'Informe um link válido do YouTube ou deixe o campo vazio.' });
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const visitorFirstTime = String(input.visitorFirstTime || current.visitorFirstTime);
  const visitorSecondTime = String(input.visitorSecondTime || current.visitorSecondTime);
  const cultReminderTime = String(input.cultReminderTime || current.cultReminderTime);
  if (![visitorFirstTime, visitorSecondTime, cultReminderTime].every(value => timePattern.test(value))) return res.status(400).json({ error: 'Os horários do bot devem estar no formato HH:MM.' });
  const bot = {
    ...current,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
    youtubeUrl,
    visitorFirstTime,
    visitorSecondTime,
    cultReminderTime,
    timezone: 'America/Sao_Paulo',
    provider: 'zapster',
    channel: 'WhatsApp',
    senderMode: 'platform_shared',
    senderLabelMode: 'church_only',
    visitorSequence: 'once_ever'
  };
  const publicSettings = { ...(church.public_settings || {}), bot };
  const result = await query('UPDATE churches SET public_settings = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, slug, public_settings', [JSON.stringify(publicSettings), req.churchId]);
  await audit(req.user, 'bot_settings_updated', { fields: ['enabled', 'youtubeUrl', 'visitorFirstTime', 'visitorSecondTime', 'cultReminderTime'], provider: 'zapster', sending: false }, req.churchId);
  await syncBotQueuesForChurch(req.churchId);
  res.json({ bot: botSettingsFromChurch(result.rows[0]), providerConfigured: false, instanceMode: 'platform_shared', senderLabelMode: 'church_only', delivery: 'not_configured' });
});

app.get('/api/church/bot-queue', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query(`SELECT id, recipient_type, recipient_name, phone_normalized, message_type, body, scheduled_for, status, provider, metadata, attempts, last_error, sent_at, created_at
    FROM bot_delivery_queue WHERE church_id = $1 ORDER BY scheduled_for ASC, created_at ASC LIMIT 500`, [req.churchId]);
  res.json({ delivery: 'not_configured', provider: 'zapster', instanceMode: 'platform_shared', senderLabelMode: 'church_only', queue: result.rows });
});

app.post('/api/integrations/zapster/visitor-consent', async (req, res) => {
  if (!ZAPSTER_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook do Zapster ainda não foi ativado.' });
  const received = String(req.headers['x-emaus-webhook-secret'] || '').trim();
  const expected = Buffer.from(ZAPSTER_WEBHOOK_SECRET);
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return res.status(401).json({ error: 'Assinatura do webhook inválida.' });
  const slug = String(req.body.slug || req.body.church || '').trim().toLowerCase();
  const phone = normalizePhone(req.body.phone || req.body.from || '');
  const answer = String(req.body.answer || req.body.text || '').trim().toLowerCase();
  if (!slug || !phone || !answer) return res.status(400).json({ error: 'slug, telefone e resposta são obrigatórios.' });
  const church = (await query("SELECT id FROM churches WHERE slug = $1 AND status IN ('active', 'trial')", [slug])).rows[0];
  if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
  const granted = ['sim', 's', 'yes', 'y', '1'].includes(answer);
  const revoked = ['não', 'nao', 'n', 'no', '0'].includes(answer);
  if (!granted && !revoked) return res.status(400).json({ error: 'Responda SIM para continuar ou NÃO para parar.' });
  const contact = (await query('SELECT id FROM bot_contacts WHERE church_id = $1 AND phone_normalized = $2', [church.id, phone])).rows[0];
  if (!contact) return res.status(404).json({ error: 'Contato não encontrado na sequência de visitantes.' });
  const status = granted ? 'opted_in' : 'opted_out';
  await query(`UPDATE bot_contacts SET status = $1, responded_at = NOW(), opted_in_at = CASE WHEN $2 THEN NOW() ELSE opted_in_at END, opted_out_at = CASE WHEN $3 THEN NOW() ELSE opted_out_at END, updated_at = NOW() WHERE id = $4`, [status, granted, revoked, contact.id]);
  if (revoked) await query(`UPDATE bot_delivery_queue SET status = 'cancelled', updated_at = NOW(), last_error = 'Contato optou por não receber novas informações.' WHERE church_id = $1 AND phone_normalized = $2 AND status IN ('planned', 'blocked_missing_video')`, [church.id, phone]);
  res.json({ ok: true, status, furtherMessages: granted });
});

app.get('/api/church/settings', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM churches WHERE id = $1', [req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja não encontrada.' });
  res.json({ church: result.rows[0] });
});

app.put('/api/church/settings', auth(['church_admin']), requireChurch, async (req, res) => {
  const publicSettings = req.body.publicSettings && typeof req.body.publicSettings === 'object' ? req.body.publicSettings : {};
  const result = await query(`UPDATE churches SET name = COALESCE(NULLIF($1, ''), name), city = COALESCE(NULLIF($2, ''), city), phone = $3, pastors = $4, description = $5, logo_url = $6, public_settings = $7, updated_at = NOW() WHERE id = $8 RETURNING *`, [req.body.name || '', req.body.city || '', req.body.phone || '', req.body.pastors || '', req.body.description || '', req.body.logoUrl || '', JSON.stringify(publicSettings), req.churchId]);
  await audit(req.user, 'church_settings_updated', { fields: ['name', 'city', 'phone', 'pastors', 'description', 'logoUrl', 'publicSettings'] }, req.churchId);
  await syncBotQueuesForChurch(req.churchId);
  res.json({ church: result.rows[0], delivery: 'not_configured' });
});

app.get('/api/church/announcements', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM church_announcements WHERE church_id = $1 ORDER BY created_at DESC LIMIT 200', [req.churchId]);
  res.json({ announcements: result.rows });
});

app.post('/api/church/announcements', auth(['church_admin']), requireChurch, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const audience = String(req.body.audience || 'Toda a igreja').trim();
  const channels = Array.isArray(req.body.channels) ? [...new Set(req.body.channels.map(channel => String(channel).trim()).filter(Boolean))].slice(0, 10) : [];
  const mode = req.body.mode === 'scheduled' ? 'scheduled' : 'published';
  if (!title || !body) return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
  if (!channels.length) return res.status(400).json({ error: 'Escolha pelo menos um canal para registrar o aviso.' });
  const scheduledFor = req.body.scheduledFor ? new Date(req.body.scheduledFor) : null;
  const validScheduledFor = scheduledFor && !Number.isNaN(scheduledFor.getTime()) ? scheduledFor : null;
  const result = await query(`INSERT INTO church_announcements (church_id, title, body, audience, channels, personalize_greeting, status, scheduled_for, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [req.churchId, title, body, audience, JSON.stringify(channels), Boolean(req.body.personalizeGreeting), mode, mode === 'scheduled' ? validScheduledFor : null, req.user.id]);
  await audit(req.user, 'announcement_created', { announcementId: result.rows[0].id, title, status: mode }, req.churchId);
  const botQueued = await queueAnnouncementBotDeliveries(result.rows[0], req.churchId);
  res.status(201).json({ announcement: result.rows[0], delivery: 'not_configured', botQueued });
});

app.get('/api/church/activity', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query(`SELECT id, activity_type, name, text, initials, tone, metadata, created_at
    FROM church_activity WHERE church_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.churchId]);
  res.json({ activity: result.rows });
});

app.get('/api/church/ministries', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query("SELECT id, church_id, name, status, created_at, updated_at FROM ministries WHERE church_id = $1 AND status = 'active' ORDER BY name ASC", [req.churchId]);
  res.json({ ministries: result.rows });
});

app.post('/api/church/ministries', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\\s+/g, ' ');
  if (!name) return res.status(400).json({ error: 'Informe o nome do ministério.' });
  const existing = (await query('SELECT id, church_id, name, status, created_at, updated_at FROM ministries WHERE church_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [req.churchId, name])).rows[0];
  if (existing) return res.json({ ministry: existing, created: false });
  const result = await query('INSERT INTO ministries (church_id, name) VALUES ($1, $2) RETURNING id, church_id, name, status, created_at, updated_at', [req.churchId, name]);
  await audit(req.user, 'ministry_created', { ministryId: result.rows[0].id, name }, req.churchId);
  res.status(201).json({ ministry: result.rows[0], created: true });
});

app.get('/api/church/reception-users', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query(`SELECT id, church_id, name, email, phone, job_role, status, permissions, created_at, updated_at
    FROM users WHERE church_id = $1 AND role = 'reception' ORDER BY name ASC`, [req.churchId]);
  res.json({ users: result.rows.map(user => ({ ...user, login: user.email, passwordStatus: 'Ativa', role: 'reception' })) });
});

app.post('/api/church/reception-users', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.login || req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !email || password.length < 6) return res.status(400).json({ error: 'Nome, login e senha com pelo menos 6 caracteres são obrigatórios.' });
  const duplicate = (await query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
  if (duplicate) return res.status(409).json({ error: 'Este login já está cadastrado.' });
  const hash = await bcrypt.hash(password, 12);
  const result = await query(`INSERT INTO users (church_id, name, email, phone, password_hash, role, job_role, status, permissions)
    VALUES ($1, $2, $3, $4, $5, 'reception', $6, 'active', $7) RETURNING id, church_id, name, email, phone, job_role, status, permissions`, [req.churchId, name, email, req.body.phone || '', hash, req.body.role || 'Recepção', JSON.stringify(['acolhimento'])]);
  await audit(req.user, 'reception_user_created', { userId: result.rows[0].id, name: result.rows[0].name }, req.churchId);
  res.status(201).json({ user: { ...result.rows[0], login: result.rows[0].email, passwordStatus: 'Ativa', role: 'reception' } });
});

app.patch('/api/church/reception-users/:userId', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.login || req.body.email || '').trim().toLowerCase();
  const jobRole = String(req.body.role || 'Recepção').trim();
  const status = req.body.status === 'blocked' || req.body.status === 'Bloqueado' ? 'blocked' : 'active';
  if (!name || !email) return res.status(400).json({ error: 'Nome e login são obrigatórios.' });
  const duplicate = (await query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, req.params.userId])).rows[0];
  if (duplicate) return res.status(409).json({ error: 'Este login já está cadastrado.' });
  let result;
  if (String(req.body.password || '').length >= 6) {
    const hash = await bcrypt.hash(String(req.body.password), 12);
    result = await query(`UPDATE users SET name = $1, email = $2, phone = $3, job_role = $4, status = $5, password_hash = $6, updated_at = NOW()
      WHERE id = $7 AND church_id = $8 AND role = 'reception' RETURNING id, church_id, name, email, phone, job_role, status, permissions`, [name, email, req.body.phone || '', jobRole, status, hash, req.params.userId, req.churchId]);
  } else {
    result = await query(`UPDATE users SET name = $1, email = $2, phone = $3, job_role = $4, status = $5, updated_at = NOW()
      WHERE id = $6 AND church_id = $7 AND role = 'reception' RETURNING id, church_id, name, email, phone, job_role, status, permissions`, [name, email, req.body.phone || '', jobRole, status, req.params.userId, req.churchId]);
  }
  if (!result.rows[0]) return res.status(404).json({ error: 'Acesso da recepção não encontrado.' });
  await audit(req.user, 'reception_user_updated', { userId: req.params.userId, name: result.rows[0].name }, req.churchId);
  res.json({ user: { ...result.rows[0], login: result.rows[0].email, passwordStatus: 'Ativa', role: 'reception' } });
});

app.delete('/api/church/reception-users/:userId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query("DELETE FROM users WHERE id = $1 AND church_id = $2 AND role = 'reception' RETURNING id", [req.params.userId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Acesso da recepção não encontrado.' });
  await audit(req.user, 'reception_user_deleted', { userId: req.params.userId, name: 'Acesso da recepção' }, req.churchId);
  res.json({ ok: true });
});

app.get('/api/church/visitors', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM visitors WHERE church_id = $1 ORDER BY visit_date DESC, created_at DESC LIMIT 500', [req.churchId]);
  res.json({ visitors: result.rows });
});

app.post('/api/church/visitors', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome do visitante é obrigatório.' });
  const communicationConsent = Boolean(req.body.communicationConsent);
  const consentVersion = communicationConsent ? String(req.body.consentVersion || 'reception-v1') : '';
  const result = await query(`INSERT INTO visitors (church_id, name, family_name, family_members, arrival_type, phone, neighborhood, visit_date, service, invited_by, notes, communication_consent, consent_version, consent_updated_at, responsible, created_by)
    VALUES ($1, $2, $3, $4, $5, COALESCE($6, ''), COALESCE($7, ''), COALESCE($8, CURRENT_DATE), COALESCE($9, 'Culto de Celebração'), COALESCE($10, ''), COALESCE($11, ''), $12, $13, CASE WHEN $12 THEN NOW() ELSE NULL END, $14, $15) RETURNING *`, [req.churchId, name, req.body.familyName || '', JSON.stringify(req.body.familyMembers || [name]), req.body.arrivalType || 'Sozinho', req.body.phone || '', req.body.neighborhood || '', req.body.visitDate || null, req.body.service || 'Culto de Celebração', req.body.invitedBy || '', req.body.notes || '', communicationConsent, consentVersion, req.user.name, req.user.id]);
  await audit(req.user, 'visitor_created', { visitorId: result.rows[0].id, name: result.rows[0].name, communicationConsent }, req.churchId);
  if (communicationConsent) {
    const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId])).rows[0];
    await queueVisitorBotSequence(result.rows[0], church);
  }
  res.status(201).json({ visitor: result.rows[0], delivery: 'not_configured' });
});

app.patch('/api/church/visitors/:visitorId', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const hasStatus = Object.prototype.hasOwnProperty.call(req.body, 'status');
  const hasResponsible = Object.prototype.hasOwnProperty.call(req.body, 'responsible');
  const hasNotes = Object.prototype.hasOwnProperty.call(req.body, 'notes');
  const hasNeighborhood = Object.prototype.hasOwnProperty.call(req.body, 'neighborhood');
  const hasAnnounced = Object.prototype.hasOwnProperty.call(req.body, 'announced');
  const hasPhone = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const hasCommunicationConsent = Object.prototype.hasOwnProperty.call(req.body, 'communicationConsent');
  const status = hasStatus ? String(req.body.status || '').trim() : null;
  const responsible = hasResponsible ? String(req.body.responsible || '').trim() : null;
  const notes = hasNotes ? String(req.body.notes || '').trim() : null;
  const neighborhood = hasNeighborhood ? String(req.body.neighborhood || '').trim() : null;
  const announced = hasAnnounced ? Boolean(req.body.announced) : null;
  const phone = hasPhone ? normalizePhone(req.body.phone || '') : null;
  const communicationConsent = hasCommunicationConsent ? Boolean(req.body.communicationConsent) : null;
  if (!hasStatus && !hasResponsible && !hasNotes && !hasNeighborhood && !hasAnnounced && !hasPhone && !hasCommunicationConsent) return res.status(400).json({ error: 'Nenhuma alteração foi informada.' });
  const result = await query(`UPDATE visitors SET status = COALESCE($1, status), responsible = COALESCE($2, responsible), notes = COALESCE($3, notes), neighborhood = COALESCE($4, neighborhood), announced = COALESCE($5, announced), phone = COALESCE($6, phone), communication_consent = COALESCE($7, communication_consent), consent_version = CASE WHEN $7 IS NOT NULL THEN COALESCE(NULLIF($8, ''), consent_version) ELSE consent_version END, consent_updated_at = CASE WHEN $7 IS NOT NULL THEN NOW() ELSE consent_updated_at END, updated_at = NOW()
    WHERE id = $9 AND church_id = $10 RETURNING *`, [status || null, responsible, notes, neighborhood, announced, phone, communicationConsent, String(req.body.consentVersion || ''), req.params.visitorId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Visitante não encontrado.' });
  const visitor = result.rows[0];
  const activityText = hasStatus && status === 'Contatado' ? 'foi marcado para acompanhamento.' : hasAnnounced && announced ? 'foi marcado para anúncio.' : 'teve o acompanhamento atualizado.';
  await audit(req.user, 'visitor_status_updated', { visitorId: visitor.id, name: visitor.name, status: visitor.status, announced: visitor.announced, activityText, communicationConsent: visitor.communication_consent }, req.churchId);
  if (visitor.communication_consent) {
    const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId])).rows[0];
    await queueVisitorBotSequence(visitor, church);
  }
  res.json({ visitor, delivery: 'not_configured' });
});

app.get('/api/church/members', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query(`SELECT m.*, MAX(a.checked_in_at) AS latest_attendance
    FROM members m LEFT JOIN member_attendance a ON a.member_id = m.id AND a.church_id = m.church_id
    WHERE m.church_id = $1 GROUP BY m.id ORDER BY m.name ASC LIMIT 2000`, [req.churchId]);
  res.json({ members: result.rows });
});

app.post('/api/church/members', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = normalizeEmail(req.body.email || '');
  const phone = normalizePhone(req.body.phone || '');
  if (!name) return res.status(400).json({ error: 'Nome do membro é obrigatório.' });
  const duplicate = (await query(`SELECT id, name, email, phone FROM members WHERE church_id = $1 AND ((NULLIF($2, '') IS NOT NULL AND email <> '' AND LOWER(email) = $2) OR (NULLIF($3, '') IS NOT NULL AND phone <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') = $3)) LIMIT 1`, [req.churchId, email, phone])).rows[0];
  if (duplicate) return res.status(409).json({ error: `Já existe um cadastro semelhante para ${duplicate.name}.`, duplicate });
  const gender = ['female', 'male', 'unspecified'].includes(req.body.gender) ? req.body.gender : 'unspecified';
  const communicationConsent = Boolean(req.body.communicationConsent);
  const locationConsent = Boolean(req.body.locationConsent);
  const consentVersion = communicationConsent || locationConsent ? String(req.body.consentVersion || 'web-v1') : '';
  const result = await query(`INSERT INTO members (church_id, name, preferred_name, gender, email, phone, ministry, ministry_id, status, joined_at, communication_consent, location_consent, consent_version, consent_updated_at)
    VALUES ($1, $2, COALESCE($3, ''), $4, COALESCE($5, ''), COALESCE($6, ''), COALESCE($7, ''), $8, $9, $10, $11, $12, $13, CASE WHEN $11 OR $12 THEN NOW() ELSE NULL END) RETURNING *`, [req.churchId, name, req.body.preferredName || '', gender, email, phone, req.body.ministry || '', req.body.ministryId || null, req.body.status === 'inactive' ? 'inactive' : 'active', req.body.joinedAt || null, communicationConsent, locationConsent, consentVersion]);
  await query('UPDATE churches SET member_count = (SELECT COUNT(*) FROM members WHERE church_id = $1 AND status = \'active\'), updated_at = NOW() WHERE id = $1', [req.churchId]);
  await audit(req.user, 'member_created', { memberId: result.rows[0].id, name: result.rows[0].name, communicationConsent, locationConsent }, req.churchId);
  res.status(201).json({ member: result.rows[0] });
});

app.patch('/api/church/members/:memberId', auth(['church_admin']), requireChurch, async (req, res) => {
  const gender = ['female', 'male', 'unspecified'].includes(req.body.gender) ? req.body.gender : null;
  const email = Object.prototype.hasOwnProperty.call(req.body, 'email') ? normalizeEmail(req.body.email) : null;
  const phone = Object.prototype.hasOwnProperty.call(req.body, 'phone') ? normalizePhone(req.body.phone) : null;
  const duplicate = (await query(`SELECT id, name FROM members WHERE church_id = $1 AND id <> $2 AND ((NULLIF($3, '') IS NOT NULL AND email <> '' AND LOWER(email) = $3) OR (NULLIF($4, '') IS NOT NULL AND phone <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') = $4)) LIMIT 1`, [req.churchId, req.params.memberId, email, phone])).rows[0];
  if (duplicate) return res.status(409).json({ error: `Os dados informados já pertencem a ${duplicate.name}.`, duplicate });
  const hasCommunicationConsent = Object.prototype.hasOwnProperty.call(req.body, 'communicationConsent');
  const hasLocationConsent = Object.prototype.hasOwnProperty.call(req.body, 'locationConsent');
  const communicationConsent = hasCommunicationConsent ? Boolean(req.body.communicationConsent) : null;
  const locationConsent = hasLocationConsent ? Boolean(req.body.locationConsent) : null;
  const result = await query(`UPDATE members SET name = COALESCE(NULLIF($1, ''), name), preferred_name = COALESCE($2, preferred_name), gender = COALESCE($3, gender), email = COALESCE($4, email), phone = COALESCE($5, phone), ministry = COALESCE($6, ministry), ministry_id = COALESCE($7, ministry_id), status = COALESCE($8, status), joined_at = COALESCE($9, joined_at), communication_consent = COALESCE($10, communication_consent), location_consent = COALESCE($11, location_consent), consent_version = CASE WHEN $10 IS NOT NULL OR $11 IS NOT NULL THEN COALESCE(NULLIF($12, ''), consent_version) ELSE consent_version END, consent_updated_at = CASE WHEN $10 IS NOT NULL OR $11 IS NOT NULL THEN NOW() ELSE consent_updated_at END, updated_at = NOW()
    WHERE id = $13 AND church_id = $14 RETURNING *`, [req.body.name || '', req.body.preferredName, gender, email, phone, req.body.ministry, req.body.ministryId, req.body.status, req.body.joinedAt || null, communicationConsent, locationConsent, String(req.body.consentVersion || ''), req.params.memberId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Membro não encontrado.' });
  await audit(req.user, 'member_updated', { memberId: req.params.memberId, name: result.rows[0].name, consentChanged: hasCommunicationConsent || hasLocationConsent }, req.churchId);
  res.json({ member: result.rows[0] });
});

app.delete('/api/church/members/:memberId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query('DELETE FROM members WHERE id = $1 AND church_id = $2 RETURNING id', [req.params.memberId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Membro não encontrado.' });
  await query('UPDATE churches SET member_count = (SELECT COUNT(*) FROM members WHERE church_id = $1 AND status = \'active\'), updated_at = NOW() WHERE id = $1', [req.churchId]);
  await audit(req.user, 'member_deleted', { memberId: req.params.memberId, name: 'Membro' }, req.churchId);
  res.json({ ok: true });
});

app.get('/api/church/attendance', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const result = await query(`SELECT a.*, m.name AS member_name, m.preferred_name, e.title AS event_title
    FROM member_attendance a JOIN members m ON m.id = a.member_id
    LEFT JOIN church_events e ON e.id = a.event_id
    WHERE a.church_id = $1 ORDER BY a.checked_in_at DESC LIMIT $2`, [req.churchId, limit]);
  res.json({ attendance: result.rows });
});

app.post('/api/church/attendance', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const memberId = String(req.body.memberId || '').trim();
  if (!memberId) return res.status(400).json({ error: 'Membro é obrigatório.' });
  const member = (await query("SELECT * FROM members WHERE id = $1 AND church_id = $2 AND status = 'active'", [memberId, req.churchId])).rows[0];
  if (!member) return res.status(404).json({ error: 'Membro ativo não encontrado nesta igreja.' });
  const recent = (await query(`SELECT * FROM member_attendance WHERE member_id = $1 AND church_id = $2 AND checked_in_at > NOW() - INTERVAL '3 hours' ORDER BY checked_in_at DESC LIMIT 1`, [memberId, req.churchId])).rows[0];
  if (recent) return res.json({ attendance: recent, duplicate: true, message: 'A presença deste membro já foi registrada recentemente.' });
  const source = ['manual', 'web', 'qr', 'import'].includes(req.body.source) ? req.body.source : 'manual';
  const geoVerified = Boolean(req.body.geoVerified);
  const distanceM = Number.isFinite(Number(req.body.distanceM)) ? Number(req.body.distanceM) : null;
  const accuracyM = Number.isFinite(Number(req.body.accuracyM)) ? Number(req.body.accuracyM) : null;
  const result = await query(`INSERT INTO member_attendance (church_id, member_id, event_id, source, geo_verified, distance_m, accuracy_m, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [req.churchId, memberId, req.body.eventId || null, source, geoVerified, distanceM, accuracyM, String(req.body.notes || '').trim(), req.user.id]);
  await query('UPDATE members SET last_attended_at = NOW(), updated_at = NOW() WHERE id = $1 AND church_id = $2', [memberId, req.churchId]);
  await audit(req.user, 'member_attendance_created', { memberId, name: member.preferred_name || member.name, attendanceId: result.rows[0].id, source, geoVerified }, req.churchId);
  res.status(201).json({ attendance: result.rows[0], duplicate: false });
});

app.get('/api/church/attendance/summary', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const [today, month, members] = await Promise.all([
    query("SELECT COUNT(DISTINCT member_id)::int AS total FROM member_attendance WHERE church_id = $1 AND checked_in_at::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date", [req.churchId]),
    query("SELECT COUNT(DISTINCT member_id)::int AS total FROM member_attendance WHERE church_id = $1 AND checked_in_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'", [req.churchId]),
    query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE last_attended_at IS NOT NULL)::int AS with_attendance FROM members WHERE church_id = $1 AND status = 'active'", [req.churchId])
  ]);
  res.json({ today: today.rows[0].total, month: month.rows[0].total, members: members.rows[0] });
});

app.post('/api/church/members/:memberId/consents', auth(['church_admin']), requireChurch, async (req, res) => {
  const memberId = req.params.memberId;
  const member = (await query('SELECT id FROM members WHERE id = $1 AND church_id = $2', [memberId, req.churchId])).rows[0];
  if (!member) return res.status(404).json({ error: 'Membro não encontrado.' });
  const consentType = ['communication', 'location', 'privacy'].includes(req.body.consentType) ? req.body.consentType : null;
  if (!consentType) return res.status(400).json({ error: 'Tipo de consentimento inválido.' });
  const granted = Boolean(req.body.granted);
  const version = String(req.body.version || 'web-v1');
  const result = await query(`INSERT INTO member_consents (church_id, member_id, consent_type, granted, version, source, granted_at, revoked_at)
    VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 THEN NOW() ELSE NULL END, CASE WHEN NOT $4 THEN NOW() ELSE NULL END)
    ON CONFLICT (member_id, consent_type) DO UPDATE SET granted = EXCLUDED.granted, version = EXCLUDED.version, source = EXCLUDED.source, granted_at = EXCLUDED.granted_at, revoked_at = EXCLUDED.revoked_at
    RETURNING *`, [req.churchId, memberId, consentType, granted, version, String(req.body.source || 'church_admin')]);
  const column = consentType === 'communication' ? 'communication_consent' : consentType === 'location' ? 'location_consent' : null;
  if (column) await query(`UPDATE members SET ${column} = $1, consent_version = $2, consent_updated_at = NOW(), updated_at = NOW() WHERE id = $3 AND church_id = $4`, [granted, version, memberId, req.churchId]);
  await audit(req.user, 'member_consent_updated', { memberId, consentType, granted, version }, req.churchId);
  res.json({ consent: result.rows[0] });
});

app.get('/api/church/care-tasks', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query(`SELECT t.*, m.name AS member_name, m.preferred_name, v.name AS visitor_name, u.name AS assignee_name
    FROM care_tasks t LEFT JOIN members m ON m.id = t.member_id LEFT JOIN visitors v ON v.id = t.visitor_id LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.church_id = $1 ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.due_date NULLS LAST, t.created_at DESC LIMIT 500`, [req.churchId]);
  res.json({ tasks: result.rows });
});

app.post('/api/church/care-tasks', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const memberId = req.body.memberId || null;
  const visitorId = req.body.visitorId || null;
  if (!title || (!memberId && !visitorId)) return res.status(400).json({ error: 'Título e pessoa vinculada são obrigatórios.' });
  if (memberId && !(await query('SELECT id FROM members WHERE id = $1 AND church_id = $2', [memberId, req.churchId])).rows[0]) return res.status(404).json({ error: 'Membro não encontrado nesta igreja.' });
  if (visitorId && !(await query('SELECT id FROM visitors WHERE id = $1 AND church_id = $2', [visitorId, req.churchId])).rows[0]) return res.status(404).json({ error: 'Visitante não encontrado nesta igreja.' });
  const taskType = ['follow_up', 'prayer', 'visit', 'integration', 'other'].includes(req.body.taskType) ? req.body.taskType : 'follow_up';
  const priority = ['low', 'normal', 'high'].includes(req.body.priority) ? req.body.priority : 'normal';
  const result = await query(`INSERT INTO care_tasks (church_id, member_id, visitor_id, title, description, task_type, priority, due_date, assigned_to, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [req.churchId, memberId, visitorId, title, String(req.body.description || '').trim(), taskType, priority, req.body.dueDate || null, req.body.assignedTo || null, req.user.id]);
  await audit(req.user, 'care_task_created', { taskId: result.rows[0].id, title: result.rows[0].title, memberId, visitorId, taskType }, req.churchId);
  res.status(201).json({ task: result.rows[0] });
});

app.patch('/api/church/care-tasks/:taskId', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const status = ['pending', 'in_progress', 'done', 'cancelled'].includes(req.body.status) ? req.body.status : null;
  const result = await query(`UPDATE care_tasks SET title = COALESCE(NULLIF($1, ''), title), description = COALESCE($2, description), priority = COALESCE($3, priority), due_date = COALESCE($4, due_date), status = COALESCE($5, status), completed_at = CASE WHEN $5 = 'done' THEN NOW() WHEN $5 IS NOT NULL THEN NULL ELSE completed_at END, updated_at = NOW()
    WHERE id = $6 AND church_id = $7 RETURNING *`, [String(req.body.title || '').trim(), req.body.description, ['low', 'normal', 'high'].includes(req.body.priority) ? req.body.priority : null, req.body.dueDate || null, status, req.params.taskId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Tarefa de cuidado não encontrada.' });
  await audit(req.user, 'care_task_updated', { taskId: req.params.taskId, title: result.rows[0].title, status }, req.churchId);
  res.json({ task: result.rows[0] });
});

app.get('/api/church/events', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM church_events WHERE church_id = $1 ORDER BY event_date ASC, event_time ASC LIMIT 1000', [req.churchId]);
  res.json({ events: result.rows });
});

app.post('/api/church/events/bulk', auth(['church_admin']), requireChurch, async (req, res) => {
  const events = Array.isArray(req.body.events) ? req.body.events : [];
  if (!events.length) return res.status(400).json({ error: 'Inclua pelo menos um evento.' });
  const inserted = [];
  for (const item of events.slice(0, 500)) {
    if (!item.title || !item.date) continue;
    const eventStatus = ['active', 'paused', 'blocked'].includes(item.status) ? item.status : 'active';
    const result = await query(`INSERT INTO church_events (church_id, title, event_date, event_time, location, event_type, audience, status, recurrence_rule, recurrence_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [req.churchId, String(item.title).trim(), item.date, item.time || '19:00', item.location || 'Templo principal', item.type || 'Outro', item.audience || 'Toda a igreja', eventStatus, JSON.stringify(item.recurrenceRule || {}), item.recurrenceId || '']);
    inserted.push(result.rows[0]);
  }
  await audit(req.user, 'events_created', { count: inserted.length }, req.churchId);
  const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId])).rows[0];
  let botQueued = 0;
  for (const event of inserted) botQueued += await queueCultReminderForEvent(event, church);
  res.status(201).json({ events: inserted, delivery: 'not_configured', botQueued });
});

app.patch('/api/church/events/:eventId', auth(['church_admin']), requireChurch, async (req, res) => {
  const eventStatus = ['active', 'paused', 'blocked'].includes(req.body.status) ? req.body.status : null;
  const hasRecurrenceId = Object.prototype.hasOwnProperty.call(req.body, 'recurrenceId');
  const recurrenceIdValue = hasRecurrenceId ? String(req.body.recurrenceId || '').trim() : null;
  const recurrenceId = recurrenceIdValue || '';
  const recurrenceRuleValue = req.body.recurrenceRule && typeof req.body.recurrenceRule === 'object' ? JSON.stringify(req.body.recurrenceRule) : null;
  const updateSeries = Boolean(req.body.updateSeries) && Boolean(recurrenceId);
  const result = await query(`UPDATE church_events SET title = COALESCE(NULLIF($1, ''), title), event_date = COALESCE($2::date, event_date), event_time = COALESCE($3, event_time), location = COALESCE($4, location), event_type = COALESCE($5, event_type), audience = COALESCE($6, audience), status = COALESCE($7, status), recurrence_rule = COALESCE($8::jsonb, recurrence_rule), recurrence_id = COALESCE($9, recurrence_id), updated_at = NOW()
    WHERE id = $10 AND church_id = $11 RETURNING *`, [String(req.body.title || '').trim(), req.body.date || null, req.body.time ?? null, req.body.location ?? null, req.body.type ?? null, req.body.audience ?? null, eventStatus, recurrenceRuleValue, recurrenceIdValue, req.params.eventId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Evento não encontrado.' });
  if (updateSeries) {
    await query(`UPDATE church_events SET title = COALESCE(NULLIF($1, ''), title), event_time = COALESCE($2, event_time), location = COALESCE($3, location), event_type = COALESCE($4, event_type), audience = COALESCE($5, audience), status = COALESCE($6, status), recurrence_rule = COALESCE($7::jsonb, recurrence_rule), updated_at = NOW()
      WHERE church_id = $8 AND recurrence_id = $9 AND id <> $10`, [String(req.body.title || '').trim(), req.body.time ?? null, req.body.location ?? null, req.body.type ?? null, req.body.audience ?? null, eventStatus, recurrenceRuleValue, req.churchId, recurrenceId, req.params.eventId]);
  }
  await audit(req.user, 'event_updated', { eventId: req.params.eventId, updateSeries }, req.churchId);
  await query(`DELETE FROM bot_delivery_queue WHERE church_id = $1 AND message_type = 'cult_reminder' AND metadata->>'eventId' = $2 AND status IN ('planned', 'skipped_window')`, [req.churchId, req.params.eventId]);
  const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId])).rows[0];
  const botQueued = await queueCultReminderForEvent(result.rows[0], church);
  res.json({ event: result.rows[0], delivery: 'not_configured', botQueued });
});

app.put('/api/church/events/:eventId/series', auth(['church_admin']), requireChurch, async (req, res) => {
  const events = Array.isArray(req.body.events) ? req.body.events.filter(item => item && item.title && item.date).slice(0, 500) : [];
  if (!events.length) return res.status(400).json({ error: 'Inclua pelo menos uma ocorrência válida.' });
  const existing = (await query('SELECT id, recurrence_id FROM church_events WHERE id = $1 AND church_id = $2', [req.params.eventId, req.churchId])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Evento não encontrado.' });
  const client = await pool.connect();
  const inserted = [];
  try {
    await client.query('BEGIN');
    if (existing.recurrence_id) await client.query('DELETE FROM church_events WHERE church_id = $1 AND recurrence_id = $2', [req.churchId, existing.recurrence_id]);
    else await client.query('DELETE FROM church_events WHERE id = $1 AND church_id = $2', [req.params.eventId, req.churchId]);
    for (const item of events) {
      const eventStatus = ['active', 'paused', 'blocked'].includes(item.status) ? item.status : 'active';
      const result = await client.query(`INSERT INTO church_events (church_id, title, event_date, event_time, location, event_type, audience, status, recurrence_rule, recurrence_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [req.churchId, String(item.title).trim(), item.date, item.time || '19:00', item.location || 'Templo principal', item.type || 'Outro', item.audience || 'Toda a igreja', eventStatus, JSON.stringify(item.recurrenceRule || {}), item.recurrenceId || '']);
      inserted.push(result.rows[0]);
    }
    await client.query('COMMIT');
    await audit(req.user, 'event_series_replaced', { eventId: req.params.eventId, count: inserted.length }, req.churchId);
    await query(`DELETE FROM bot_delivery_queue WHERE church_id = $1 AND message_type = 'cult_reminder' AND status IN ('planned', 'skipped_window')`, [req.churchId]);
    const church = (await query('SELECT id, name, slug, public_settings FROM churches WHERE id = $1', [req.churchId])).rows[0];
    let botQueued = 0;
    for (const event of inserted) botQueued += await queueCultReminderForEvent(event, church);
    res.json({ events: inserted, delivery: 'not_configured', botQueued });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Não foi possível atualizar a série de eventos.' });
  } finally {
    client.release();
  }
});

app.delete('/api/church/events/:eventId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query('DELETE FROM church_events WHERE id = $1 AND church_id = $2 RETURNING id', [req.params.eventId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Evento não encontrado.' });
  await audit(req.user, 'event_deleted', { eventId: req.params.eventId }, req.churchId);
  await query(`UPDATE bot_delivery_queue SET status = 'cancelled', updated_at = NOW(), last_error = 'Evento removido da agenda.' WHERE church_id = $1 AND message_type = 'cult_reminder' AND metadata->>'eventId' = $2 AND status IN ('planned', 'skipped_window')`, [req.churchId, req.params.eventId]);
  res.json({ ok: true, delivery: 'not_configured' });
});

app.get('/api/church/leaders', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query("SELECT * FROM leaders WHERE church_id = $1 AND status = 'active' ORDER BY name ASC", [req.churchId]);
  res.json({ leaders: result.rows });
});

app.post('/api/church/leaders', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome da liderança é obrigatório.' });
  const gender = ['female', 'male', 'unspecified'].includes(req.body.gender) ? req.body.gender : 'unspecified';
  const result = await query(`INSERT INTO leaders (church_id, name, preferred_name, gender, role, phone, group_name) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [req.churchId, name, req.body.preferredName || '', gender, req.body.role || 'Líder', req.body.phone || '', req.body.group || '']);
  await audit(req.user, 'leader_created', { leaderId: result.rows[0].id, name: result.rows[0].name }, req.churchId);
  res.status(201).json({ leader: result.rows[0] });
});

app.patch('/api/church/leaders/:leaderId', auth(['church_admin']), requireChurch, async (req, res) => {
  const gender = ['female', 'male', 'unspecified'].includes(req.body.gender) ? req.body.gender : null;
  const result = await query(`UPDATE leaders SET name = COALESCE(NULLIF($1, ''), name), preferred_name = COALESCE($2, preferred_name), gender = COALESCE($3, gender), role = COALESCE(NULLIF($4, ''), role), phone = COALESCE($5, phone), group_name = COALESCE($6, group_name), updated_at = NOW()
    WHERE id = $7 AND church_id = $8 RETURNING *`, [req.body.name || '', req.body.preferredName, gender, req.body.role || '', req.body.phone, req.body.group, req.params.leaderId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Liderança não encontrada.' });
  await audit(req.user, 'leader_updated', { leaderId: req.params.leaderId, name: result.rows[0].name }, req.churchId);
  res.json({ leader: result.rows[0] });
});

app.delete('/api/church/leaders/:leaderId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query('UPDATE leaders SET status = \'inactive\', updated_at = NOW() WHERE id = $1 AND church_id = $2 RETURNING id', [req.params.leaderId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Liderança não encontrada.' });
  await audit(req.user, 'leader_deleted', { leaderId: req.params.leaderId, name: 'Liderança' }, req.churchId);
  res.json({ ok: true });
});

app.get('/api/audit', auth(['platform_admin']), async (req, res) => {
  const result = await query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200');
  res.json({ events: result.rows });
});

async function ensureColumnCompatibility() {
  await query(`CREATE TABLE IF NOT EXISTS platform_support_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID REFERENCES churches(id) ON DELETE SET NULL,
    requester_name TEXT NOT NULL DEFAULT '', requester_email TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
  )`);
  await query(`CREATE TABLE IF NOT EXISTS platform_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), church_id UUID REFERENCES churches(id) ON DELETE SET NULL,
    church_name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'indicação',
    status TEXT NOT NULL DEFAULT 'interested', notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query("ALTER TABLE churches DROP CONSTRAINT IF EXISTS churches_status_check");
  await query("ALTER TABLE churches ADD CONSTRAINT churches_status_check CHECK (status IN ('active', 'blocked', 'trial', 'paused'))");
  await query(`CREATE TABLE IF NOT EXISTS church_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'Toda a igreja',
    channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    personalize_greeting BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'published',
    scheduled_for TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS church_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL DEFAULT 'general',
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    initials TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT 'dark',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS bot_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    phone_normalized TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    asked_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    opted_in_at TIMESTAMPTZ,
    opted_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (church_id, phone_normalized)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS bot_delivery_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    recipient_type TEXT NOT NULL,
    recipient_id UUID,
    recipient_key TEXT NOT NULL,
    recipient_name TEXT NOT NULL DEFAULT '',
    phone_normalized TEXT NOT NULL DEFAULT '',
    message_type TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    provider TEXT NOT NULL DEFAULT 'zapster',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query("CREATE INDEX IF NOT EXISTS idx_bot_contacts_church_status ON bot_contacts(church_id, status)");
  await query("CREATE INDEX IF NOT EXISTS idx_bot_queue_church_scheduled ON bot_delivery_queue(church_id, status, scheduled_for)");
  await query("CREATE INDEX IF NOT EXISTS idx_bot_queue_recipient ON bot_delivery_queue(church_id, recipient_key, message_type)");
  await query("CREATE INDEX IF NOT EXISTS idx_announcements_church_created ON church_announcements(church_id, created_at DESC)");
  await query("CREATE INDEX IF NOT EXISTS idx_activity_church_created ON church_activity(church_id, created_at DESC)");
  await query("ALTER TABLE churches ADD COLUMN IF NOT EXISTS founder_price_freeze BOOLEAN NOT NULL DEFAULT FALSE");
  await query("ALTER TABLE churches ADD COLUMN IF NOT EXISTS public_settings JSONB NOT NULL DEFAULT '{}'::jsonb");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role TEXT NOT NULL DEFAULT 'Recepção'");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_name TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unspecified'");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret_ciphertext TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_confirmed_at TIMESTAMPTZ");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_recovery_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb");
  await query("ALTER TABLE church_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
  await query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS neighborhood TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS communication_consent BOOLEAN NOT NULL DEFAULT FALSE");
  await query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS consent_version TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMPTZ");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS preferred_name TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unspecified'");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS ministry_id UUID REFERENCES ministries(id) ON DELETE SET NULL");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS communication_consent BOOLEAN NOT NULL DEFAULT FALSE");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS location_consent BOOLEAN NOT NULL DEFAULT FALSE");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS consent_version TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMPTZ");
  await query("ALTER TABLE members ADD COLUMN IF NOT EXISTS last_attended_at TIMESTAMPTZ");
  await query("CREATE TABLE IF NOT EXISTS member_attendance (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE, member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE, event_id UUID REFERENCES church_events(id) ON DELETE SET NULL, source TEXT NOT NULL DEFAULT 'manual', checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), geo_verified BOOLEAN NOT NULL DEFAULT FALSE, distance_m NUMERIC(8,2), accuracy_m NUMERIC(8,2), notes TEXT NOT NULL DEFAULT '', created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS member_consents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE, member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE, consent_type TEXT NOT NULL, granted BOOLEAN NOT NULL DEFAULT FALSE, version TEXT NOT NULL DEFAULT 'v1', source TEXT NOT NULL DEFAULT 'church_admin', granted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (member_id, consent_type))");
  await query("CREATE TABLE IF NOT EXISTS care_tasks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE, member_id UUID REFERENCES members(id) ON DELETE CASCADE, visitor_id UUID REFERENCES visitors(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', task_type TEXT NOT NULL DEFAULT 'follow_up', priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'pending', due_date DATE, assigned_to UUID REFERENCES users(id) ON DELETE SET NULL, created_by UUID REFERENCES users(id), completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE UNIQUE INDEX IF NOT EXISTS idx_member_consents_unique ON member_consents(member_id, consent_type)");
  await query("CREATE INDEX IF NOT EXISTS idx_attendance_church_member ON member_attendance(church_id, member_id, checked_in_at DESC)");
  await query("CREATE INDEX IF NOT EXISTS idx_care_tasks_church_status ON care_tasks(church_id, status, due_date)");
  await query("ALTER TABLE leaders ADD COLUMN IF NOT EXISTS preferred_name TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE leaders ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unspecified'");
  await query("CREATE UNIQUE INDEX IF NOT EXISTS idx_ministries_church_name_lower ON ministries(church_id, LOWER(name))");
  await query("CREATE INDEX IF NOT EXISTS idx_members_church_name ON members(church_id, name)");
  await query("CREATE INDEX IF NOT EXISTS idx_events_church_date ON church_events(church_id, event_date, event_time)");
  await query("CREATE INDEX IF NOT EXISTS idx_leaders_church ON leaders(church_id, status)");
}

async function seed() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
  await ensureColumnCompatibility();
  const plans = [
    ['essencial', 'Essencial', 4990, 100, 5, 'Para igrejas que estão começando a organizar o cuidado.', ['Acolhimento', 'Visitantes e famílias', 'Agenda', 'Relatórios essenciais']],
    ['cuidado', 'Cuidado', 9990, 300, 12, 'Para igrejas em crescimento.', ['Tudo do Essencial', 'Comunicação avançada', 'Relatórios avançados', 'Identidade personalizada']],
    ['rede', 'Rede', 17990, 800, 25, 'Para igrejas maiores e redes.', ['Tudo do Cuidado', 'Até 3 unidades', 'Indicadores financeiros', 'Gestão avançada']]
  ];
  for (const plan of plans) await query(`INSERT INTO plans (id, name, price_cents, member_limit, user_limit, description, features) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`, [...plan.slice(0, 6), JSON.stringify(plan[6])]);
  const existing = (await query('SELECT * FROM churches WHERE slug = $1', ['bethesda'])).rows[0];
  const church = existing || (await query(`INSERT INTO churches (name, slug, city, phone, pastors, description, plan_id, status, member_count, monthly_price_cents)
    VALUES ('Bethesda', 'bethesda', 'Itaboraí • RJ', '', 'Evandro e Simone', 'Um lugar para pertencer, crescer e viver a fé em comunidade.', 'cuidado', 'active', 246, 9990) RETURNING *`)).rows[0];
  if (ADMIN_PASSWORD) await seedUser(ADMIN_EMAIL, 'Administrador da plataforma', ADMIN_PASSWORD, 'platform_admin', null, []);
  if (PASTOR_PASSWORD) await seedUser(PASTOR_EMAIL, 'Evandro e Simone', PASTOR_PASSWORD, 'church_admin', church.id, ['church_settings', 'acolhimento']);
  if (RECEPTION_PASSWORD) await seedUser(RECEPTION_EMAIL, 'Mariana Alves', RECEPTION_PASSWORD, 'reception', church.id, ['acolhimento']);
  // Não há lideranças ou eventos fictícios. Eles só entram por cadastro autorizado.
  await zeroBethesdaDemoMetrics(church);
}

async function zeroBethesdaDemoMetrics(church) {
  if (!church || church.slug !== 'bethesda') return;
  const marker = (await query("SELECT value FROM platform_settings WHERE key = 'bethesda_demo_metrics_zeroed_v1'")).rows[0];
  if (marker) return;
  const memberRows = Number((await query('SELECT COUNT(*)::int AS total FROM members WHERE church_id = $1', [church.id])).rows[0].total || 0);
  if (memberRows === 0) await query('UPDATE churches SET member_count = 0, updated_at = NOW() WHERE id = $1', [church.id]);
  await query("INSERT INTO platform_settings (key, value) VALUES ('bethesda_demo_metrics_zeroed_v1', '{\"done\":true}'::jsonb) ON CONFLICT (key) DO NOTHING");
}

async function seedUser(email, name, password, role, churchId, permissions) {
  const hash = await bcrypt.hash(password, 12);
  await query(`INSERT INTO users (name, email, password_hash, role, church_id, permissions) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, church_id = EXCLUDED.church_id, permissions = EXCLUDED.permissions, updated_at = NOW()`, [name, email, hash, role, churchId, JSON.stringify(permissions)]);
}

async function start() {
  try {
    await seed();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Emaús API online na porta ${PORT}`);
      console.log('Bot WhatsApp preparado em modo registro: nenhum envio externo está habilitado.');
      setTimeout(() => syncBotQueuesForAllChurches().catch(error => console.error('Falha na preparação inicial do bot:', error.message)), 1500);
      setInterval(() => syncBotQueuesForAllChurches().catch(error => console.error('Falha na sincronização do bot:', error.message)), 5 * 60 * 1000);
    });
  } catch (error) {
    console.error('Falha ao iniciar Emaús API:', error);
    process.exit(1);
  }
}

start();
