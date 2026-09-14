const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@emaus.com.br').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PASTOR_EMAIL = (process.env.PASTOR_EMAIL || 'evandro@bethesda.com.br').trim().toLowerCase();
const PASTOR_PASSWORD = process.env.PASTOR_PASSWORD || '';
const RECEPTION_EMAIL = (process.env.RECEPTION_EMAIL || 'mariana@bethesda.com.br').trim().toLowerCase();
const RECEPTION_PASSWORD = process.env.RECEPTION_PASSWORD || '';

if (!DATABASE_URL) {
  console.error('DATABASE_URL não foi configurada.');
  process.exit(1);
}
if (JWT_SECRET === 'change-this-secret-before-production') {
  console.warn('JWT_SECRET ainda está com o valor de desenvolvimento. Troque no Railway antes de produção.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000
});

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(value => value.trim()), credentials: true }));
app.use(express.json({ limit: '2mb' }));

function slugify(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `igreja-${Date.now()}`;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function moneyFromCents(value) {
  return Number(value || 0) / 100;
}

function safeUser(row) {
  if (!row) return null;
  return { id: row.id, churchId: row.church_id, name: row.name, email: row.email, role: row.role, status: row.status, permissions: row.permissions || [] };
}

function signUser(user) {
  return jwt.sign({ sub: user.id, role: user.role, churchId: user.church_id || null, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
}

async function query(text, params = []) {
  return pool.query(text, params);
}

async function audit(actor, action, payload = {}, churchId = actor?.church_id || null) {
  await query('INSERT INTO audit_events (actor_id, church_id, action, payload) VALUES ($1, $2, $3, $4)', [actor?.id || null, churchId, action, JSON.stringify(payload)]);
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
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Login ou senha inválidos.' });
  await audit(user, 'login');
  res.json({ token: signUser(user), user: safeUser(user) });
});

app.get('/api/me', auth(), async (req, res) => {
  res.json({ user: safeUser(req.user) });
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

app.patch('/api/admin/churches/:churchId/status', auth(['platform_admin']), async (req, res) => {
  const status = req.body.status === 'blocked' ? 'blocked' : 'active';
  const result = await query('UPDATE churches SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, req.params.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja não encontrada.' });
  await audit(req.user, status === 'blocked' ? 'church_blocked' : 'church_released', { churchId: req.params.churchId }, req.params.churchId);
  res.json({ church: result.rows[0] });
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

app.get('/api/church/settings', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM churches WHERE id = $1', [req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Igreja não encontrada.' });
  res.json({ church: result.rows[0] });
});

app.put('/api/church/settings', auth(['church_admin']), requireChurch, async (req, res) => {
  const publicSettings = req.body.publicSettings && typeof req.body.publicSettings === 'object' ? req.body.publicSettings : {};
  const result = await query(`UPDATE churches SET name = COALESCE(NULLIF($1, ''), name), city = COALESCE(NULLIF($2, ''), city), phone = $3, pastors = $4, description = $5, logo_url = $6, public_settings = $7, updated_at = NOW() WHERE id = $8 RETURNING *`, [req.body.name || '', req.body.city || '', req.body.phone || '', req.body.pastors || '', req.body.description || '', req.body.logoUrl || '', JSON.stringify(publicSettings), req.churchId]);
  await audit(req.user, 'church_settings_updated', { fields: ['name', 'city', 'phone', 'pastors', 'description', 'logoUrl', 'publicSettings'] }, req.churchId);
  res.json({ church: result.rows[0] });
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
  await audit(req.user, 'reception_user_created', { userId: result.rows[0].id }, req.churchId);
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
  await audit(req.user, 'reception_user_updated', { userId: req.params.userId }, req.churchId);
  res.json({ user: { ...result.rows[0], login: result.rows[0].email, passwordStatus: 'Ativa', role: 'reception' } });
});

app.delete('/api/church/reception-users/:userId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query("DELETE FROM users WHERE id = $1 AND church_id = $2 AND role = 'reception' RETURNING id", [req.params.userId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Acesso da recepção não encontrado.' });
  await audit(req.user, 'reception_user_deleted', { userId: req.params.userId }, req.churchId);
  res.json({ ok: true });
});

app.get('/api/church/visitors', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM visitors WHERE church_id = $1 ORDER BY visit_date DESC, created_at DESC LIMIT 500', [req.churchId]);
  res.json({ visitors: result.rows });
});

app.post('/api/church/visitors', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome do visitante é obrigatório.' });
  const result = await query(`INSERT INTO visitors (church_id, name, family_name, family_members, arrival_type, phone, visit_date, service, invited_by, notes, responsible, created_by)
    VALUES ($1, $2, $3, $4, $5, COALESCE($6, ''), COALESCE($7, CURRENT_DATE), COALESCE($8, 'Culto de Celebração'), COALESCE($9, ''), COALESCE($10, ''), $11, $12) RETURNING *`, [req.churchId, name, req.body.familyName || '', JSON.stringify(req.body.familyMembers || [name]), req.body.arrivalType || 'Sozinho', req.body.phone || '', req.body.visitDate || null, req.body.service || 'Culto de Celebração', req.body.invitedBy || '', req.body.notes || '', req.user.name, req.user.id]);
  await query('UPDATE churches SET member_count = member_count + 1, updated_at = NOW() WHERE id = $1', [req.churchId]);
  await audit(req.user, 'visitor_created', { visitorId: result.rows[0].id }, req.churchId);
  res.status(201).json({ visitor: result.rows[0] });
});

app.get('/api/church/members', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query('SELECT * FROM members WHERE church_id = $1 ORDER BY name ASC LIMIT 2000', [req.churchId]);
  res.json({ members: result.rows });
});

app.post('/api/church/members', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome do membro é obrigatório.' });
  const result = await query(`INSERT INTO members (church_id, name, email, phone, ministry, status, joined_at)
    VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, ''), $6, $7) RETURNING *`, [req.churchId, name, req.body.email || '', req.body.phone || '', req.body.ministry || '', req.body.status === 'inactive' ? 'inactive' : 'active', req.body.joinedAt || null]);
  await query('UPDATE churches SET member_count = (SELECT COUNT(*) FROM members WHERE church_id = $1), updated_at = NOW() WHERE id = $1', [req.churchId]);
  await audit(req.user, 'member_created', { memberId: result.rows[0].id }, req.churchId);
  res.status(201).json({ member: result.rows[0] });
});

app.patch('/api/church/members/:memberId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query(`UPDATE members SET name = COALESCE(NULLIF($1, ''), name), email = COALESCE($2, email), phone = COALESCE($3, phone), ministry = COALESCE($4, ministry), status = COALESCE($5, status), joined_at = COALESCE($6, joined_at), updated_at = NOW()
    WHERE id = $7 AND church_id = $8 RETURNING *`, [req.body.name || '', req.body.email, req.body.phone, req.body.ministry, req.body.status, req.body.joinedAt || null, req.params.memberId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ member: result.rows[0] });
});

app.delete('/api/church/members/:memberId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query('DELETE FROM members WHERE id = $1 AND church_id = $2 RETURNING id', [req.params.memberId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Membro não encontrado.' });
  await query('UPDATE churches SET member_count = (SELECT COUNT(*) FROM members WHERE church_id = $1), updated_at = NOW() WHERE id = $1', [req.churchId]);
  await audit(req.user, 'member_deleted', { memberId: req.params.memberId }, req.churchId);
  res.json({ ok: true });
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
  res.status(201).json({ events: inserted });
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
  res.json({ event: result.rows[0] });
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
    res.json({ events: inserted });
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
  res.json({ ok: true });
});

app.get('/api/church/leaders', auth(['church_admin', 'reception']), requireChurch, async (req, res) => {
  const result = await query("SELECT * FROM leaders WHERE church_id = $1 AND status = 'active' ORDER BY name ASC", [req.churchId]);
  res.json({ leaders: result.rows });
});

app.post('/api/church/leaders', auth(['church_admin']), requireChurch, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome da liderança é obrigatório.' });
  const result = await query(`INSERT INTO leaders (church_id, name, role, phone, group_name) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [req.churchId, name, req.body.role || 'Líder', req.body.phone || '', req.body.group || '']);
  await audit(req.user, 'leader_created', { leaderId: result.rows[0].id }, req.churchId);
  res.status(201).json({ leader: result.rows[0] });
});

app.patch('/api/church/leaders/:leaderId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query(`UPDATE leaders SET name = COALESCE(NULLIF($1, ''), name), role = COALESCE(NULLIF($2, ''), role), phone = COALESCE($3, phone), group_name = COALESCE($4, group_name), updated_at = NOW()
    WHERE id = $5 AND church_id = $6 RETURNING *`, [req.body.name || '', req.body.role || '', req.body.phone, req.body.group, req.params.leaderId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Liderança não encontrada.' });
  await audit(req.user, 'leader_updated', { leaderId: req.params.leaderId }, req.churchId);
  res.json({ leader: result.rows[0] });
});

app.delete('/api/church/leaders/:leaderId', auth(['church_admin']), requireChurch, async (req, res) => {
  const result = await query('UPDATE leaders SET status = \'inactive\', updated_at = NOW() WHERE id = $1 AND church_id = $2 RETURNING id', [req.params.leaderId, req.churchId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Liderança não encontrada.' });
  await audit(req.user, 'leader_deleted', { leaderId: req.params.leaderId }, req.churchId);
  res.json({ ok: true });
});

app.get('/api/audit', auth(['platform_admin']), async (req, res) => {
  const result = await query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200');
  res.json({ events: result.rows });
});

async function ensureColumnCompatibility() {
  await query("ALTER TABLE churches ADD COLUMN IF NOT EXISTS founder_price_freeze BOOLEAN NOT NULL DEFAULT FALSE");
  await query("ALTER TABLE churches ADD COLUMN IF NOT EXISTS public_settings JSONB NOT NULL DEFAULT '{}'::jsonb");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role TEXT NOT NULL DEFAULT 'Recepção'");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE church_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
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
  const leaderCount = Number((await query('SELECT COUNT(*)::int AS total FROM leaders WHERE church_id = $1', [church.id])).rows[0].total || 0);
  if (!leaderCount) {
    const initialLeaders = [
      ['Evandro', 'Pastor titular', '(21) 99921-4421', 'Administração'],
      ['Simone', 'Pastora e cuidado', '(21) 99812-7310', 'Acolhimento'],
      ['João Pedro', 'Líder de obreiros', '(21) 99634-1822', 'Obreiros'],
      ['Mariana Alves', 'Líder de recepção', '(21) 99704-2118', 'Recepção'],
      ['Camila Martins', 'Líder de célula', '(21) 99572-3188', 'Célula Centro'],
      ['Daniel Souza', 'Ministério de louvor', '(21) 99280-4471', 'Louvor']
    ];
    for (const leader of initialLeaders) await query('INSERT INTO leaders (church_id, name, role, phone, group_name) VALUES ($1, $2, $3, $4, $5)', [church.id, ...leader]);
  }
  const eventCount = Number((await query('SELECT COUNT(*)::int AS total FROM church_events WHERE church_id = $1', [church.id])).rows[0].total || 0);
  if (!eventCount) {
    const initialEvents = [
      ['Culto de Celebração', 3, '19:00', 'Templo principal', 'Culto', 'Toda a igreja'],
      ['Encontro de Mulheres', 9, '18:30', 'Salão social', 'Encontro', 'Ministério de Mulheres'],
      ['Culto de Ensino', 13, '19:30', 'Templo principal', 'Culto', 'Toda a igreja'],
      ['Café com líderes', 16, '08:30', 'Sala de reuniões', 'Liderança', 'Lideranças']
    ];
    for (const item of initialEvents) await query(`INSERT INTO church_events (church_id, title, event_date, event_time, location, event_type, audience)
      VALUES ($1, $2, CURRENT_DATE + ($3 || ' days')::interval, $4, $5, $6, $7)`, [church.id, item[0], item[1], item[2], item[3], item[4], item[5]]);
  }
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
    app.listen(PORT, '0.0.0.0', () => console.log(`Emaús API online na porta ${PORT}`));
  } catch (error) {
    console.error('Falha ao iniciar Emaús API:', error);
    process.exit(1);
  }
}

start();
