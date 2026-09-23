const ADMIN_SESSION_KEY = 'emaus-admin-session';
const API_BASE = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
const ADMIN_EMAIL = 'admin@emaus.com.br';
const ADMIN_TOKEN_KEY = 'emaus-admin-token';
const ADMIN_USER_KEY = 'emaus-admin-user';

const EMPTY_POLICY = {
  trialDays: null,
  founderChurches: null,
  founderUsed: null,
  priceFreezeMonths: null,
  additionalFees: null,
  billingNote: ''
};

let currentView = 'overview';
let addChurchOpen = false;
let editChurchId = null;
let selectedChurchId = null;
let churchQuery = '';
let churchFilter = 'all';
let filterTimer = null;
const detailCache = new Map();
let state = loadState();

async function apiRequest(path, options = {}) {
  if (!API_BASE) throw new Error('A URL da API da Emaús não foi configurada.');
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = { ...options, headers };
  if (options.body && typeof options.body !== 'string') request.body = JSON.stringify(options.body);
  const response = await fetch(`${API_BASE}${path}`, request);
  let payload = {};
  try { payload = await response.json(); } catch (error) { payload = {}; }
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    throw new Error(payload.error || `A API respondeu com HTTP ${response.status}.`);
  }
  return payload;
}

async function optionalApi(path, fallback) {
  try { return await apiRequest(path); } catch (error) { return fallback; }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'IG';
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function moneyOrUnavailable(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? 'Indisponível' : money(value);
}

function number(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function countOrUnavailable(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? 'Indisponível' : number(value);
}

function numeric(value) {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.')) || 0;
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('pt-BR');
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function currentMonthLabel() {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date()).replace('.', '');
}

function normalizePlan(value, plans = state.platformPlans) {
  const raw = String(value || '').toLowerCase();
  const aliases = { crescimento: 'cuidado', comunidade: 'rede' };
  const normalized = aliases[raw] || raw;
  const found = (plans || []).find(plan => plan.id === normalized || String(plan.name || '').toLowerCase() === normalized);
  return found ? found.id : normalized;
}

function getPlan(id, plans = state.platformPlans) {
  return (plans || []).find(plan => plan.id === id) || null;
}

function churchStatus(church) {
  const raw = church.apiStatus || church.status || '';
  if (raw === 'trial' && church.trialEndsAt && new Date(church.trialEndsAt).getTime() < Date.now()) return { label: 'Vencida', className: 'pending', apiStatus: 'trial' };
  const statuses = {
    active: { label: 'Ativa', className: 'active' },
    trial: { label: 'Em teste', className: 'pending' },
    blocked: { label: 'Bloqueada', className: 'blocked' },
    paused: { label: 'Pausada', className: 'pending' },
    expired: { label: 'Vencida', className: 'pending' }
  };
  return { ...(statuses[raw] || { label: 'Indisponível', className: 'pending' }), apiStatus: raw };
}

function mapPlanFromApi(plan) {
  return {
    id: plan.id,
    name: plan.name,
    price: Number(plan.price ?? Number(plan.price_cents || 0) / 100),
    members: Number(plan.memberLimit ?? plan.member_limit ?? 0),
    users: Number(plan.userLimit ?? plan.user_limit ?? 0),
    description: plan.description || '',
    features: Array.isArray(plan.features) ? plan.features : []
  };
}

function mapChurchFromApi(church) {
  const status = church.status;
  return normalizeChurch({
    id: church.id,
    name: church.name,
    city: church.city,
    phone: church.phone,
    pastors: church.pastors,
    initials: initials(church.name),
    logoImage: String(church.slug || '').toLowerCase() === 'bethesda' ? 'bethesda-logo.png' : '',
    plan: church.plan_id || '',
    planName: church.plan_name || '',
    status: churchStatus({ apiStatus: status, trialEndsAt: church.trial_ends_at }).label,
    apiStatus: status,
    memberCount: church.member_count === null || church.member_count === undefined ? null : Number(church.member_count),
    monthlyValue: church.monthly_price_cents === null || church.monthly_price_cents === undefined ? null : Number(church.monthly_price_cents) / 100,
    memberLimit: church.member_limit === null || church.member_limit === undefined ? null : Number(church.member_limit),
    billingStatus: status === 'trial' ? 'Teste ativo' : status === 'blocked' ? 'Bloqueada' : 'Não informado',
    trialStartedAt: church.trial_started_at,
    trialEndsAt: church.trial_ends_at,
    nextDue: church.trial_ends_at ? formatDate(church.trial_ends_at) : '—',
    founderPriceFreeze: Boolean(church.founder_price_freeze),
    founderPlanPrice: church.founder_plan_price_cents === null || church.founder_plan_price_cents === undefined ? null : Number(church.founder_plan_price_cents) / 100,
    slug: church.slug,
    createdAt: church.created_at,
    updatedAt: church.updated_at
  });
}

function normalizeChurch(church, plans = state.platformPlans) {
  const planId = normalizePlan(church.plan, plans);
  const plan = getPlan(planId, plans);
  const memberCount = church.memberCount === null || church.memberCount === undefined ? null : Number(church.memberCount);
  const memberLimit = church.memberLimit === null || church.memberLimit === undefined ? (plan ? Number(plan.members) : null) : Number(church.memberLimit);
  return {
    ...church,
    name: church.name || 'Igreja sem nome',
    city: church.city || 'Brasil',
    initials: church.initials || initials(church.name),
    plan: planId,
    memberCount: Number.isFinite(memberCount) ? memberCount : null,
    memberLimit: Number.isFinite(memberLimit) ? memberLimit : null,
    monthlyValue: church.monthlyValue === null || church.monthlyValue === undefined ? null : Number(church.monthlyValue),
    billingStatus: church.billingStatus || 'Não informado',
    nextDue: church.nextDue || '—'
  };
}

function loadState() {
  return {
    activeChurchId: null,
    churches: [],
    platformPlans: [],
    platformPolicy: clone(EMPTY_POLICY),
    platformFinance: { months: [], transactions: [] },
    summary: null,
    audit: [],
    support: [],
    leads: [],
    security: null
  };
}

async function loadRemoteState() {
  const [summaryPayload, churchPayload, plansPayload, financePayload, auditPayload, supportPayload, leadsPayload, securityPayload] = await Promise.all([
    apiRequest('/api/admin/summary'),
    apiRequest('/api/admin/churches'),
    apiRequest('/api/admin/plans'),
    apiRequest('/api/admin/finance'),
    optionalApi('/api/audit', { events: [] }),
    optionalApi('/api/admin/support', { requests: [] }),
    optionalApi('/api/admin/leads', { leads: [] }),
    optionalApi('/api/me/security', { twoFactor: null })
  ]);

  state.summary = {
    churches: summaryPayload.churches || {},
    monthlyRevenue: summaryPayload.monthlyRevenue === undefined ? null : Number(summaryPayload.monthlyRevenue),
    monthlyExpenses: summaryPayload.monthlyExpenses === undefined ? null : Number(summaryPayload.monthlyExpenses),
    activePeople: summaryPayload.activePeople === undefined ? null : Number(summaryPayload.activePeople)
  };
  state.platformPlans = (plansPayload.plans || []).map(mapPlanFromApi);
  state.churches = (churchPayload.churches || []).map(mapChurchFromApi);
  state.activeChurchId = state.churches[0]?.id || null;
  state.audit = Array.isArray(auditPayload.events) ? auditPayload.events : [];
  state.support = Array.isArray(supportPayload.requests) ? supportPayload.requests : [];
  state.leads = Array.isArray(leadsPayload.leads) ? leadsPayload.leads : [];
  state.security = securityPayload.twoFactor || null;

  const transactions = (financePayload.expenses || []).map(item => ({
    id: item.id,
    description: item.description,
    category: item.category,
    amount: item.amount === undefined ? (item.amount_cents === undefined ? null : Number(item.amount_cents) / 100) : Number(item.amount),
    date: item.expense_date ? formatDate(`${item.expense_date}T12:00:00`) : formatDateTime(item.created_at)
  }));
  const revenue = state.summary.monthlyRevenue;
  const expense = state.summary.monthlyExpenses;
  state.platformFinance = {
    months: revenue === null && expense === null ? [] : [{ label: currentMonthLabel(), income: revenue, expense }],
    transactions
  };
  state.platformPolicy = clone(EMPTY_POLICY);
  render();
}

function saveState() {
  // Os dados administrativos são mantidos no PostgreSQL. Nenhum espelho local é gravado.
}

function toast(message) {
  const el = document.querySelector('#adminToast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  window.setTimeout(() => el.classList.add('hidden'), 4200);
}

function isLoggedIn() {
  return Boolean(sessionStorage.getItem(ADMIN_TOKEN_KEY));
}

function showLogin() {
  document.querySelector('#adminLoginView').classList.remove('hidden');
  document.querySelector('#adminAppView').classList.add('hidden');
}

function showApp() {
  document.querySelector('#adminLoginView').classList.add('hidden');
  document.querySelector('#adminAppView').classList.remove('hidden');
  render();
}

function activeChurches() {
  return state.churches.filter(church => !['Bloqueada', 'Pausada', 'Vencida'].includes(churchStatus(church).label));
}

function recurringRevenue() {
  return state.summary && state.summary.monthlyRevenue !== null ? state.summary.monthlyRevenue : null;
}

function currentExpenses() {
  return state.summary && state.summary.monthlyExpenses !== null ? state.summary.monthlyExpenses : null;
}

function operatingResult() {
  const revenue = recurringRevenue();
  const expense = currentExpenses();
  return revenue === null || expense === null ? null : revenue - expense;
}

function monthMax() {
  const values = state.platformFinance.months.flatMap(month => [Number(month.income || 0), Number(month.expense || 0)]).filter(Number.isFinite);
  return Math.max(...values, 1);
}

function renderKpis() {
  const counts = state.summary?.churches || {};
  const active = counts.active === undefined ? activeChurches().length : counts.active;
  const total = counts.total === undefined ? state.churches.length : counts.total;
  const people = state.summary?.activePeople;
  const result = operatingResult();
  return `<div class="kpi-grid">
    <article class="kpi-card"><span class="kpi-icon">◈</span><small>Igrejas ativas</small><strong>${countOrUnavailable(active)}</strong><span>${countOrUnavailable(total)} organizações no banco</span></article>
    <article class="kpi-card copper"><span class="kpi-icon">R$</span><small>Receita mensal prevista</small><strong>${moneyOrUnavailable(recurringRevenue())}</strong><span>valor cadastrado para igrejas ativas</span></article>
    <article class="kpi-card green"><span class="kpi-icon">↑</span><small>Resultado operacional</small><strong>${moneyOrUnavailable(result)}</strong><span>receita menos gastos do mês</span></article>
    <article class="kpi-card blue"><span class="kpi-icon">◎</span><small>Pessoas ativas</small><strong>${countOrUnavailable(people)}</strong><span>somatório retornado pela API</span></article>
  </div>`;
}

function renderChart() {
  const months = state.platformFinance.months;
  if (!months.length || months.every(month => month.income === null && month.expense === null)) return '<div class="empty">Histórico financeiro mensal indisponível. Os valores aparecem somente quando registrados no banco.</div>';
  const max = monthMax();
  return `<div class="chart">${months.map(month => `<div class="chart-column"><div class="chart-bars"><i class="chart-bar" style="height:${month.income === null ? 4 : Math.max(4, Number(month.income || 0) / max * 100)}%" title="Receita: ${esc(moneyOrUnavailable(month.income))}"></i><i class="chart-bar expense" style="height:${month.expense === null ? 4 : Math.max(4, Number(month.expense || 0) / max * 100)}%" title="Gastos: ${esc(moneyOrUnavailable(month.expense))}"></i></div></div>`).join('')}</div><div class="chart-labels">${months.map(month => `<span>${esc(month.label)}</span>`).join('')}</div>`;
}

function renderPolicyBanner() {
  return `<section class="policy-banner"><div class="policy-mark">i</div><div><strong>Política comercial sem estimativas</strong><p>Período de teste, preço, limite e situação da assinatura são exibidos somente a partir dos registros da API da Emaús. Esta tela não cria valores fictícios.</p></div><span class="policy-badge">Dados do banco</span></section>`;
}

function renderPipelineSummary() {
  const interested = state.leads.filter(lead => lead.status === 'interested').length;
  const onboarding = state.leads.filter(lead => lead.status === 'onboarding').length;
  const trialLeads = state.leads.filter(lead => lead.status === 'trial').length;
  const trialChurches = state.churches.filter(church => churchStatus(church).label === 'Em teste').length;
  return `<section class="panel pipeline-summary"><div class="panel-head"><div><h2>Pipeline de igrejas</h2><p>Igrejas interessadas, em implantação e em teste, somente quando registradas no banco.</p></div><button class="btn btn-small" data-admin-view="pipeline">Abrir pipeline</button></div><div class="pipeline-stats"><div><span>Interessadas</span><strong>${number(interested)}</strong></div><div><span>Em implantação</span><strong>${number(onboarding)}</strong></div><div><span>Leads em teste</span><strong>${number(trialLeads)}</strong></div><div><span>Igrejas em teste</span><strong>${number(trialChurches)}</strong></div></div></section>`;
}

function renderOverview() {
  const revenue = recurringRevenue();
  const expense = currentExpenses();
  const result = operatingResult();
  const blocked = state.summary?.churches?.blocked === undefined ? state.churches.filter(church => churchStatus(church).label === 'Bloqueada').length : state.summary.churches.blocked;
  const recent = state.churches.slice(0, 6);
  return `<section class="page-head"><div><span class="eyebrow">CENTRAL DO ADMINISTRADOR</span><h1>Visão geral</h1><p>Organizações, planos, status de assinatura, suporte e segurança da plataforma Emaús.</p></div><div class="page-actions"><button class="btn" data-admin-view="finance">Ver finanças</button><button class="btn btn-gold" data-admin-view="churches">Gerenciar igrejas</button></div></section>
  ${renderPolicyBanner()}
  ${renderKpis()}
  <div class="grid-2"><section class="panel"><div class="panel-head"><div><h2>Receita e gastos</h2><p>Mês atual · valores retornados pelo banco.</p></div><div class="legend"><span><i></i>Receita</span><span><i class="expense"></i>Gastos</span></div></div><div class="panel-body">${renderChart()}</div></section><section class="panel"><div class="panel-head"><div><h2>Resumo operacional</h2><p>Sem conciliação fictícia ou números de demonstração.</p></div></div><div class="panel-body"><div class="summary-list"><div class="summary-row"><span>Receita mensal prevista</span><strong>${moneyOrUnavailable(revenue)}</strong></div><div class="summary-row"><span>Gastos registrados no mês</span><strong class="negative">${moneyOrUnavailable(expense)}</strong></div><div class="summary-row"><span>Resultado operacional</span><strong class="positive">${moneyOrUnavailable(result)}</strong></div><div class="summary-row"><span>Contas bloqueadas</span><strong>${countOrUnavailable(blocked)}</strong></div><div class="summary-row"><span>Backup PostgreSQL</span><strong>Não verificado</strong></div></div></div></section></div>
  <section class="panel church-card-section"><div class="panel-head"><div><h2>Igrejas da plataforma</h2><p>Cartões resumidos por organização, com acesso aos detalhes e ações administrativas.</p></div><button class="btn btn-small" data-admin-view="churches">Ver todas</button></div><div class="panel-body">${renderChurchCards(recent)}</div></section>${renderPipelineSummary()}`;
}

function statusBadge(church) {
  const status = churchStatus(church);
  return `<span class="status ${status.className}">${esc(status.label)}</span>`;
}

function churchPlanLabel(church) {
  const plan = getPlan(church.plan);
  return church.planName || plan?.name || 'Indisponível';
}

function renderChurchCard(church) {
  const plan = getPlan(church.plan);
  const limit = church.memberLimit;
  const members = church.memberCount;
  const percentage = limit && members !== null ? Math.min(100, Math.max(0, members / limit * 100)) : null;
  return `<article class="church-card"><div class="church-card-head"><div class="church-cell"><div class="church-avatar">${church.logoImage ? `<img src="${esc(church.logoImage)}" alt="">` : esc(church.initials)}</div><div class="church-meta"><strong>${esc(church.name)}</strong><small>${esc(church.city)}</small></div></div>${statusBadge(church)}</div><div class="church-card-plan"><span>${esc(churchPlanLabel(church))}</span><strong>${moneyOrUnavailable(church.monthlyValue)}<small>/mês</small></strong></div><div class="church-card-stats"><div><small>Pessoas</small><strong>${countOrUnavailable(members)}</strong></div><div><small>Limite</small><strong>${countOrUnavailable(limit)}</strong></div><div><small>Teste/assinatura</small><strong>${esc(church.billingStatus)}</strong></div></div>${percentage === null ? '<div class="meter unavailable-meter"></div>' : `<div class="member-meter"><div class="member-meter-line"><span>Uso do plano</span><strong>${Math.round(percentage)}%</strong></div><div class="meter"><i style="width:${percentage}%"></i></div></div>`}<div class="church-card-actions"><button class="table-btn gold" data-admin-action="view-church" data-id="${esc(church.id)}">Ver detalhes</button><button class="table-btn" data-admin-action="edit-church" data-id="${esc(church.id)}">Editar</button></div></article>`;
}

function renderChurchCards(churches) {
  if (!churches.length) return '<div class="empty">Nenhuma igreja cadastrada no banco.</div>';
  return `<div class="church-card-grid">${churches.map(renderChurchCard).join('')}</div>`;
}

function renderChurchTable(churches) {
  if (!churches.length) return '<div class="empty">Nenhuma igreja corresponde aos filtros.</div>';
  return `<table><thead><tr><th>Organização</th><th>Plano</th><th>Status</th><th>Pessoas / limite</th><th>Mensalidade</th><th>Ações</th></tr></thead><tbody>${churches.map(church => {
    const status = churchStatus(church);
    const memberCount = church.memberCount;
    const limit = church.memberLimit;
    const percentage = limit && memberCount !== null ? Math.min(100, Math.max(0, memberCount / limit * 100)) : null;
    const primaryAction = status.apiStatus === 'blocked' ? `<button class="table-btn gold" data-admin-action="set-church-status" data-status="active" data-id="${esc(church.id)}">Liberar</button>` : status.apiStatus === 'active' ? `<button class="table-btn" data-admin-action="set-church-status" data-status="paused" data-id="${esc(church.id)}">Pausar</button>` : `<button class="table-btn gold" data-admin-action="set-church-status" data-status="active" data-id="${esc(church.id)}">Ativar</button>`;
    const blockAction = status.apiStatus === 'blocked' ? '' : `<button class="table-btn danger" data-admin-action="set-church-status" data-status="blocked" data-id="${esc(church.id)}">Bloquear</button>`;
    return `<tr><td><div class="church-cell"><div class="church-avatar">${church.logoImage ? `<img src="${esc(church.logoImage)}" alt="">` : esc(church.initials)}</div><div class="church-meta"><strong>${esc(church.name)}</strong><small>${esc(church.city)}</small></div></div></td><td><strong>${esc(churchPlanLabel(church))}</strong><br><small style="color:var(--muted-2);">limite: ${countOrUnavailable(limit)} pessoas</small></td><td>${statusBadge(church)}</td><td><div class="member-meter">${percentage === null ? '<span class="muted-inline">Indisponível</span>' : `<div class="member-meter-line"><span>${number(memberCount)} / ${number(limit)}</span><strong>${Math.round(percentage)}%</strong></div><div class="meter"><i style="width:${percentage}%"></i></div>`}</div></td><td>${moneyOrUnavailable(church.monthlyValue)}</td><td><div class="row-actions"><button class="table-btn gold" data-admin-action="view-church" data-id="${esc(church.id)}">Detalhes</button><button class="table-btn" data-admin-action="edit-church" data-id="${esc(church.id)}">Editar</button>${primaryAction}${blockAction}</div></td></tr>`;
  }).join('')}</tbody></table>`;
}

function filteredChurches() {
  const query = churchQuery.trim().toLowerCase();
  return state.churches.filter(church => {
    const status = churchStatus(church).label;
    const matchesQuery = !query || [church.name, church.city, churchPlanLabel(church), church.slug].some(value => String(value || '').toLowerCase().includes(query));
    const matchesFilter = churchFilter === 'all' || (churchFilter === 'active' && status === 'Ativa') || (churchFilter === 'trial' && status === 'Em teste') || (churchFilter === 'blocked' && status === 'Bloqueada') || (churchFilter === 'paused' && status === 'Pausada') || (churchFilter === 'expired' && status === 'Vencida');
    return matchesQuery && matchesFilter;
  });
}

function renderChurchEditForm(church) {
  if (!church || editChurchId !== church.id) return '';
  return `<section class="add-panel edit-panel"><div class="panel-kicker">EDIÇÃO DA ORGANIZAÇÃO</div><h3>Editar ${esc(church.name)}</h3><p>Alterações administrativas são salvas no banco central. O isolamento por igreja permanece vinculado ao identificador da organização.</p><form data-admin-form="edit-church"><input type="hidden" name="id" value="${esc(church.id)}"><div class="form-grid"><div class="field"><label for="editChurchName">Nome da igreja *</label><input id="editChurchName" name="name" value="${esc(church.name)}" required></div><div class="field"><label for="editChurchCity">Cidade e estado</label><input id="editChurchCity" name="city" value="${esc(church.city)}"></div><div class="field"><label for="editChurchPhone">Telefone público</label><input id="editChurchPhone" name="phone" value="${esc(church.phone || '')}"></div><div class="field"><label for="editChurchPastors">Pastores / liderança</label><input id="editChurchPastors" name="pastors" value="${esc(church.pastors || '')}"></div><div class="field"><label for="editChurchPlan">Plano</label><select id="editChurchPlan" name="plan">${state.platformPlans.map(plan => `<option value="${esc(plan.id)}" ${plan.id === church.plan ? 'selected' : ''}>${esc(plan.name)} · ${money(plan.price)}/mês</option>`).join('')}</select></div></div><div class="form-actions"><button type="button" class="btn" data-admin-action="close-edit">Cancelar</button><button type="submit" class="btn btn-gold">Salvar edição</button></div></form></section>`;
}

function renderChurches() {
  const filtered = filteredChurches();
  const editing = state.churches.find(church => church.id === editChurchId);
  return `<section class="page-head"><div><span class="eyebrow">ORGANIZAÇÕES</span><h1>Igrejas cadastradas</h1><p>Cadastre, edite, ative, pause, bloqueie e consulte cada organização sem misturar dados entre igrejas.</p></div><div class="page-actions"><button class="btn btn-gold" data-admin-action="toggle-add-church">${addChurchOpen ? 'Fechar cadastro' : '+ Adicionar igreja'}</button></div></section>
  ${addChurchOpen ? `<section class="add-panel"><div class="panel-kicker">NOVA ORGANIZAÇÃO</div><h3>Cadastrar igreja</h3><p>O cadastro é criado na API central e recebe o plano escolhido. O período de teste só é exibido quando estiver registrado pela API.</p><form data-admin-form="church"><div class="form-grid"><div class="field"><label for="newChurchName">Nome da igreja *</label><input id="newChurchName" name="name" required placeholder="Ex.: Igreja Esperança"></div><div class="field"><label for="newChurchCity">Cidade e estado</label><input id="newChurchCity" name="city" placeholder="Ex.: Niterói • RJ"></div><div class="field"><label for="newChurchPlan">Plano inicial</label><select id="newChurchPlan" name="plan" ${state.platformPlans.length ? '' : 'disabled'}>${state.platformPlans.length ? state.platformPlans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)} · ${money(plan.price)}/mês · até ${number(plan.members)} pessoas</option>`).join('') : '<option>Nenhum plano disponível</option>'}</select></div><div class="field"><label for="newChurchAdmin">Responsável</label><input id="newChurchAdmin" name="admin" placeholder="Nome do pastor"></div></div><div class="form-actions"><button type="button" class="btn" data-admin-action="toggle-add-church">Cancelar</button><button type="submit" class="btn btn-gold" ${state.platformPlans.length ? '' : 'disabled'}>Salvar igreja</button></div></form></section>` : ''}
  ${renderChurchEditForm(editing)}
  <section class="panel"><div class="panel-head"><div><h2>Todas as organizações</h2><p>${number(filtered.length)} resultado${filtered.length === 1 ? '' : 's'} de ${number(state.churches.length)} igrejas carregadas da API.</p></div><span class="status active">${number(activeChurches().length)} ativas</span></div><div class="panel-body"><form class="filter-bar" data-admin-form="church-filter"><div class="field"><label for="churchSearch">Buscar igreja</label><input id="churchSearch" name="query" value="${esc(churchQuery)}" placeholder="Nome, cidade ou slug"></div><div class="field"><label for="churchStatusFilter">Status</label><select id="churchStatusFilter" name="status"><option value="all" ${churchFilter === 'all' ? 'selected' : ''}>Todos</option><option value="active" ${churchFilter === 'active' ? 'selected' : ''}>Ativas</option><option value="trial" ${churchFilter === 'trial' ? 'selected' : ''}>Em teste</option><option value="expired" ${churchFilter === 'expired' ? 'selected' : ''}>Vencidas</option><option value="paused" ${churchFilter === 'paused' ? 'selected' : ''}>Pausadas</option><option value="blocked" ${churchFilter === 'blocked' ? 'selected' : ''}>Bloqueadas</option></select></div><button type="submit" class="btn">Aplicar filtros</button></form><div class="table-wrap">${renderChurchTable(filtered)}</div></div></section>`;
}

function renderPlans() {
  if (!state.platformPlans.length) return `<section class="page-head"><div><span class="eyebrow">MONETIZAÇÃO</span><h1>Planos e preços</h1><p>Nenhum plano foi retornado pela API.</p></div></section><section class="panel"><div class="empty">Cadastre planos no banco da Emaús para habilitar esta área.</div></section>`;
  return `<section class="page-head"><div><span class="eyebrow">MONETIZAÇÃO</span><h1>Planos e preços</h1><p>Limites, preços e recursos registrados no PostgreSQL da Emaús.</p></div><div class="page-actions"><button class="btn btn-gold" data-admin-action="save-plans-top">Salvar tabela de preços</button></div></section>
  ${renderPolicyBanner()}
  <section class="panel"><div class="panel-head"><div><h2>Tabela de preços da Emaús</h2><p>Edite os campos e salve explicitamente. Nenhum preço local é usado como fallback.</p></div><span class="status active">Banco conectado</span></div><div class="panel-body"><form data-admin-form="plans"><div class="table-wrap"><table class="plan-table"><thead><tr><th>Plano</th><th>Mensalidade</th><th>Pessoas ativas</th><th>Acessos</th></tr></thead><tbody>${state.platformPlans.map(plan => `<tr><td><input name="name_${esc(plan.id)}" value="${esc(plan.name)}" aria-label="Nome do plano"></td><td><input name="price_${esc(plan.id)}" value="${esc(plan.price)}" type="number" min="0" step="0.01" aria-label="Preço mensal"></td><td><input name="members_${esc(plan.id)}" value="${esc(plan.members)}" type="number" min="1" step="25" aria-label="Limite de pessoas ativas"></td><td><input name="users_${esc(plan.id)}" value="${esc(plan.users)}" type="number" min="1" step="1" aria-label="Limite de acessos"></td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="submit" class="btn btn-gold">Salvar alterações</button></div></form></div></section>
  <div class="plan-card-grid">${state.platformPlans.map((plan, index) => `<article class="plan-card ${index === 1 ? 'highlight' : ''}"><h3>${esc(plan.name)}</h3><div class="plan-price">${moneyOrUnavailable(plan.price)} <small>/ mês</small></div><div class="plan-limits"><span>Até <strong>${countOrUnavailable(plan.members)}</strong> pessoas ativas</span><span><strong>${countOrUnavailable(plan.users)}</strong> acessos da equipe</span></div><p>${esc(plan.description || 'Descrição não cadastrada.')}</p><ul class="plan-points">${(plan.features || []).map(feature => `<li>${esc(feature)}</li>`).join('')}</ul></article>`).join('')}</div>`;
}

function renderFinance() {
  const revenue = recurringRevenue();
  const expense = currentExpenses();
  const result = operatingResult();
  const margin = revenue !== null && revenue !== 0 && result !== null ? `${Math.round(result / revenue * 100)}%` : 'Indisponível';
  const transactions = state.platformFinance.transactions;
  return `<section class="page-head"><div><span class="eyebrow">FINANCEIRO</span><h1>Ganhos e gastos</h1><p>Receita cadastrada nas igrejas ativas e gastos registrados no banco central, sem números demonstrativos.</p></div><div class="page-actions"><button class="btn btn-gold" data-admin-action="focus-expense">+ Registrar gasto</button></div></section>
  <div class="kpi-grid"><article class="kpi-card copper"><span class="kpi-icon">R$</span><small>Receita mensal cadastrada</small><strong>${moneyOrUnavailable(revenue)}</strong><span>soma retornada pela API</span></article><article class="kpi-card"><span class="kpi-icon">◇</span><small>Gastos do mês</small><strong>${moneyOrUnavailable(expense)}</strong><span>data corrente do banco</span></article><article class="kpi-card green"><span class="kpi-icon">↑</span><small>Resultado</small><strong>${moneyOrUnavailable(result)}</strong><span>receita menos gastos do mês</span></article><article class="kpi-card blue"><span class="kpi-icon">%</span><small>Margem</small><strong>${margin}</strong><span>calculada somente com dados disponíveis</span></article></div>
  <div class="finance-grid"><section class="panel"><div class="panel-head"><div><h2>Desempenho financeiro</h2><p>${state.platformFinance.months.length ? 'Mês atual · série histórica ainda não fornecida pela API.' : 'Série histórica não disponível.'}</p></div><div class="legend"><span><i></i>Receita</span><span><i class="expense"></i>Gastos</span></div></div><div class="panel-body">${renderChart()}</div></section><section class="panel"><div class="panel-head"><div><h2>Registrar gasto</h2><p>O lançamento será gravado com data do servidor.</p></div></div><div class="panel-body"><form data-admin-form="expense"><div class="field"><label for="expenseDescription">Descrição *</label><input id="expenseDescription" name="description" required placeholder="Ex.: Hospedagem da API"></div><div class="field" style="margin-top:12px;"><label for="expenseCategory">Categoria</label><select id="expenseCategory" name="category"><option>Tecnologia</option><option>Operação</option><option>Marketing</option><option>Equipe</option><option>Outro</option></select></div><div class="field" style="margin-top:12px;"><label for="expenseAmount">Valor (R$) *</label><input id="expenseAmount" name="amount" type="number" min="0.01" step="0.01" required placeholder="0,00"></div><div class="form-actions"><button class="btn btn-gold" type="submit">Salvar gasto</button></div></form></div></section></div>
  <section class="panel" style="margin-top:16px;"><div class="panel-head"><div><h2>Gastos registrados</h2><p>Histórico retornado pela API, limitado aos últimos lançamentos disponíveis.</p></div></div><div class="panel-body"><div class="transaction-list">${transactions.length ? transactions.map(item => `<div class="transaction"><div class="transaction-icon">−</div><div class="transaction-copy"><strong>${esc(item.description)}</strong><span>${esc(item.category)} · ${esc(item.date)}</span></div><div class="transaction-value">− ${moneyOrUnavailable(item.amount)}</div></div>`).join('') : '<div class="empty">Nenhum gasto registrado.</div>'}</div></div></section>`;
}

function renderChurchDetail() {
  const church = state.churches.find(item => item.id === selectedChurchId);
  if (!church) return `<section class="page-head"><div><span class="eyebrow">DETALHES</span><h1>Igreja não selecionada</h1><p>Escolha uma igreja na visão geral para consultar os detalhes.</p></div></section>`;
  const detail = detailCache.get(church.id);
  const metrics = detail?.summary || {};
  const members = metrics.members?.active ?? church.memberCount;
  const visitors = metrics.visitors?.total;
  const events = metrics.upcomingEvents;
  const users = metrics.users;
  const botPending = metrics.bot?.pending;
  const activity = detail?.activity || [];
  return `<section class="page-head"><div><button class="back-link" data-admin-view="churches">← Voltar para igrejas</button><span class="eyebrow">DETALHES DA ORGANIZAÇÃO</span><h1>${esc(church.name)}</h1><p>${esc(church.city)} · identificador isolado <code>${esc(church.id)}</code></p></div><div class="page-actions"><button class="btn" data-admin-action="edit-church" data-id="${esc(church.id)}">Editar cadastro</button><button class="btn" data-admin-action="create-billing-checkout" data-id="${esc(church.id)}">Criar cobrança</button><button class="btn btn-gold" data-admin-action="refresh-detail" data-id="${esc(church.id)}">Atualizar dados</button></div></section>
  <div class="detail-hero"><div class="church-cell"><div class="church-avatar large">${church.logoImage ? `<img src="${esc(church.logoImage)}" alt="">` : esc(church.initials)}</div><div class="church-meta"><strong>${esc(church.name)}</strong><small>${esc(church.city)} · ${esc(church.slug || 'slug não informado')}</small><div class="detail-badges">${statusBadge(church)}<span class="soft-badge">Plano: ${esc(churchPlanLabel(church))}</span></div></div></div><div class="detail-hero-side"><span>Mensalidade cadastrada</span><strong>${moneyOrUnavailable(church.monthlyValue)}</strong><small>Limite: ${countOrUnavailable(church.memberLimit)} pessoas</small></div></div>
  ${detail ? '' : '<div class="inline-notice">Os dados detalhados ainda estão sendo carregados ou a rota de detalhes não está publicada na API. Os dados básicos acima vieram da listagem.</div>'}
  <div class="detail-metrics"><article class="metric-card"><small>Membros ativos</small><strong>${countOrUnavailable(members)}</strong><span>cadastro da igreja</span></article><article class="metric-card"><small>Visitantes registrados</small><strong>${countOrUnavailable(visitors)}</strong><span>histórico da organização</span></article><article class="metric-card"><small>Próximos eventos</small><strong>${countOrUnavailable(events)}</strong><span>agenda futura</span></article><article class="metric-card"><small>Acessos ativos</small><strong>${countOrUnavailable(users)}</strong><span>equipe da igreja</span></article><article class="metric-card"><small>Fila do bot pendente</small><strong>${countOrUnavailable(botPending)}</strong><span>sem enviar mensagens automaticamente</span></article></div>
  <div class="grid-2 detail-grid"><section class="panel"><div class="panel-head"><div><h2>Assinatura e limites</h2><p>O status é administrativo; cobrança só aparece quando registrada na API.</p></div></div><div class="panel-body"><div class="summary-list"><div class="summary-row"><span>Status</span><strong>${statusBadge(church)}</strong></div><div class="summary-row"><span>Plano</span><strong>${esc(churchPlanLabel(church))}</strong></div><div class="summary-row"><span>Período de teste</span><strong>${church.trialStartedAt || church.trialEndsAt ? `${formatDate(church.trialStartedAt)} até ${formatDate(church.trialEndsAt)}` : 'Não informado'}</strong></div><div class="summary-row"><span>Atividade atualizada</span><strong>${formatDateTime(church.updatedAt)}</strong></div></div></div></section><section class="panel"><div class="panel-head"><div><h2>Atividade recente</h2><p>Eventos vinculados somente a esta igreja.</p></div></div><div class="panel-body"><div class="activity-list">${activity.length ? activity.map(item => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${esc(item.action || item.activity_type || 'Atividade')}</strong><small>${esc(item.text || item.name || '')}</small></div><time>${formatDateTime(item.created_at)}</time></div>`).join('') : '<div class="empty">Nenhuma atividade detalhada disponível.</div>'}</div></div></section></div>`;
}

function renderPipeline() {
  const labels = { interested: 'Interessada', onboarding: 'Em implantação', trial: 'Em teste', converted: 'Convertida', lost: 'Encerrada' };
  const counts = Object.keys(labels).reduce((acc, key) => { acc[key] = state.leads.filter(lead => lead.status === key).length; return acc; }, {});
  return `<section class="page-head"><div><span class="eyebrow">CRESCIMENTO</span><h1>Pipeline de igrejas</h1><p>Registre contatos, implantação e testes sem transformar interesse em igreja ativa antes da confirmação.</p></div></section>
  <div class="pipeline-stats pipeline-stats-large"><div><span>Interessadas</span><strong>${number(counts.interested)}</strong></div><div><span>Em implantação</span><strong>${number(counts.onboarding)}</strong></div><div><span>Em teste</span><strong>${number(counts.trial)}</strong></div><div><span>Convertidas</span><strong>${number(counts.converted)}</strong></div><div><span>Encerradas</span><strong>${number(counts.lost)}</strong></div></div>
  <div class="support-grid"><section class="panel"><div class="panel-head"><div><h2>Registrar igreja interessada</h2><p>Campos opcionais permanecem vazios até serem informados.</p></div></div><div class="panel-body"><form data-admin-form="lead"><div class="field"><label for="leadChurchName">Nome da igreja *</label><input id="leadChurchName" name="churchName" required placeholder="Ex.: Comunidade Esperança"></div><div class="field" style="margin-top:12px;"><label for="leadCity">Cidade e estado</label><input id="leadCity" name="city" placeholder="Ex.: Itaboraí • RJ"></div><div class="field" style="margin-top:12px;"><label for="leadContact">Pessoa de contato</label><input id="leadContact" name="contactName"></div><div class="field" style="margin-top:12px;"><label for="leadEmail">E-mail</label><input id="leadEmail" name="contactEmail" type="email"></div><div class="field" style="margin-top:12px;"><label for="leadPhone">Telefone</label><input id="leadPhone" name="contactPhone"></div><div class="field" style="margin-top:12px;"><label for="leadSource">Origem</label><input id="leadSource" name="source" value="indicação"></div><div class="field" style="margin-top:12px;"><label for="leadStatus">Etapa</label><select id="leadStatus" name="status"><option value="interested">Interessada</option><option value="onboarding">Em implantação</option><option value="trial">Em teste</option></select></div><div class="field" style="margin-top:12px;"><label for="leadNotes">Observações</label><textarea id="leadNotes" name="notes" placeholder="Não inclua senhas, tokens ou chaves privadas."></textarea></div><div class="form-actions"><button class="btn btn-gold" type="submit">Salvar no pipeline</button></div></form></div></section><section class="panel"><div class="panel-head"><div><h2>Histórico do pipeline</h2><p>${number(state.leads.length)} registro${state.leads.length === 1 ? '' : 's'} retornado${state.leads.length === 1 ? '' : 's'} pela API.</p></div></div><div class="panel-body"><div class="support-list">${state.leads.length ? state.leads.map(lead => `<article class="support-item"><div class="support-item-head"><div><strong>${esc(lead.church_name)}</strong><small>${esc(lead.city || 'Cidade não informada')} · ${esc(lead.contact_name || 'Contato não informado')} · ${formatDateTime(lead.created_at)}</small></div><span class="status ${lead.status === 'converted' ? 'active' : lead.status === 'lost' ? 'blocked' : 'pending'}">${esc(labels[lead.status] || 'Indisponível')}</span></div><p>${esc(lead.notes || 'Sem observações cadastradas.')}</p><div class="support-item-foot"><span>Origem: ${esc(lead.source || 'Não informada')}</span><div class="row-actions"><select class="inline-status-select" data-admin-lead-status="${esc(lead.id)}" aria-label="Etapa do lead"><option value="interested" ${lead.status === 'interested' ? 'selected' : ''}>Interessada</option><option value="onboarding" ${lead.status === 'onboarding' ? 'selected' : ''}>Em implantação</option><option value="trial" ${lead.status === 'trial' ? 'selected' : ''}>Em teste</option><option value="converted" ${lead.status === 'converted' ? 'selected' : ''}>Convertida</option><option value="lost" ${lead.status === 'lost' ? 'selected' : ''}>Encerrada</option></select></div></div></article>`).join('') : '<div class="empty">Nenhuma igreja interessada foi registrada.</div>'}</div></div></section></div>`;
}

function renderSupport() {
  const requests = state.support || [];
  return `<section class="page-head"><div><span class="eyebrow">ATENDIMENTO</span><h1>Suporte e solicitações</h1><p>Registre solicitações internas, acompanhe o status e consulte o histórico real da operação.</p></div></section>
  <div class="support-grid"><section class="panel"><div class="panel-head"><div><h2>Nova solicitação</h2><p>Use para registrar uma demanda recebida pelo canal oficial.</p></div></div><div class="panel-body"><form data-admin-form="support"><div class="field"><label for="supportSubject">Assunto *</label><input id="supportSubject" name="subject" required placeholder="Ex.: Ajuste de acesso da igreja"></div><div class="field" style="margin-top:12px;"><label for="supportChurch">Igreja relacionada</label><select id="supportChurch" name="churchId"><option value="">Nenhuma igreja específica</option>${state.churches.map(church => `<option value="${esc(church.id)}">${esc(church.name)}</option>`).join('')}</select></div><div class="field" style="margin-top:12px;"><label for="supportPriority">Prioridade</label><select id="supportPriority" name="priority"><option value="normal">Normal</option><option value="low">Baixa</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div><div class="field" style="margin-top:12px;"><label for="supportMessage">Descrição *</label><textarea id="supportMessage" name="message" required placeholder="Descreva a solicitação sem incluir senhas, tokens ou chaves privadas."></textarea></div><div class="form-actions"><button class="btn btn-gold" type="submit">Registrar solicitação</button></div></form></div></section><section class="panel"><div class="panel-head"><div><h2>Histórico</h2><p>${number(requests.length)} solicitação${requests.length === 1 ? '' : 'ões'} retornada${requests.length === 1 ? '' : 's'} pela API.</p></div></div><div class="panel-body"><div class="support-list">${requests.length ? requests.map(renderSupportRequest).join('') : '<div class="empty">Nenhuma solicitação registrada.</div>'}</div></div></section></div>`;
}

function renderSupportRequest(request) {
  const statusLabels = { open: 'Aberta', in_progress: 'Em andamento', resolved: 'Resolvida' };
  const priorityLabels = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
  return `<article class="support-item"><div class="support-item-head"><div><strong>${esc(request.subject)}</strong><small>${esc(request.church_name || 'Plataforma')} · ${formatDateTime(request.created_at)}</small></div><span class="status ${request.status === 'resolved' ? 'active' : request.priority === 'urgent' ? 'blocked' : 'pending'}">${esc(statusLabels[request.status] || request.status)}</span></div><p>${esc(request.message)}</p><div class="support-item-foot"><span>Prioridade: ${esc(priorityLabels[request.priority] || request.priority || 'Normal')}</span><div class="row-actions">${request.status !== 'in_progress' && request.status !== 'resolved' ? `<button class="table-btn" data-admin-action="support-status" data-id="${esc(request.id)}" data-status="in_progress">Assumir</button>` : ''}${request.status !== 'resolved' ? `<button class="table-btn gold" data-admin-action="support-status" data-id="${esc(request.id)}" data-status="resolved">Resolver</button>` : ''}</div></div></article>`;
}

function renderSettings() {
  const security = state.security;
  const twoFactorText = security?.enabled ? 'Ativa' : security?.prepared ? 'Preparada para ativação guiada' : 'Indisponível';
  return `<section class="page-head"><div><span class="eyebrow">CONTROLE CENTRAL</span><h1>Configurações e segurança</h1><p>Visão segura das integrações administrativas. Credenciais e segredos não são exibidos nesta interface.</p></div></section>
  <div class="settings-grid"><article class="setting-card"><span class="setting-icon">2F</span><div><h2>Autenticação em dois fatores</h2><p>${esc(twoFactorText)}. A ativação completa deve ser concluída pelo fluxo seguro da API.</p></div><span class="status ${security?.enabled ? 'active' : 'pending'}">${esc(twoFactorText)}</span></article><article class="setting-card"><span class="setting-icon">◎</span><div><h2>Isolamento multi-igreja</h2><p>Cada consulta administrativa usa o identificador da igreja; detalhes, fila, consentimentos e auditoria permanecem vinculados à organização.</p></div><span class="status active">Ativo</span></article><article class="setting-card"><span class="setting-icon">DB</span><div><h2>Backup PostgreSQL</h2><p>O estado do backup não é inventado pela interface. Verifique o provedor e a política operacional antes de considerar o backup confirmado.</p></div><span class="status pending">Não verificado</span></article><article class="setting-card"><span class="setting-icon">API</span><div><h2>API da Emaús</h2><p>O administrador usa somente a API Railway configurada no frontend. Não há envio direto do navegador para provedores de mensagens.</p></div><span class="status active">Conectada</span></article></div>
  <section class="panel audit-panel"><div class="panel-head"><div><h2>Auditoria administrativa</h2><p>Histórico real retornado pela API, sem credenciais ou tokens.</p></div><span class="status active">${number(state.audit.length)} eventos</span></div><div class="panel-body"><div class="audit-list">${state.audit.length ? state.audit.map(event => `<div class="audit-item"><span class="activity-dot"></span><div><strong>${esc(event.action || 'Evento')}</strong><small>Igreja: ${esc(event.church_id || 'plataforma')} · ${formatDateTime(event.created_at)}</small></div><code>${esc(JSON.stringify(event.payload || {}))}</code></div>`).join('') : '<div class="empty">Nenhum evento de auditoria retornado.</div>'}</div></div></section>`;
}

function render() {
  document.querySelectorAll('[data-admin-view]').forEach(button => button.classList.toggle('active', button.dataset.adminView === currentView));
  const content = document.querySelector('#adminContent');
  if (!content) return;
  const renderers = { overview: renderOverview, churches: renderChurches, plans: renderPlans, finance: renderFinance, pipeline: renderPipeline, detail: renderChurchDetail, support: renderSupport, settings: renderSettings };
  content.innerHTML = (renderers[currentView] || renderOverview)();
}

function setView(view) {
  if (!['overview', 'churches', 'plans', 'finance', 'pipeline', 'detail', 'support', 'settings'].includes(view)) return;
  currentView = view;
  if (view !== 'churches') addChurchOpen = false;
  if (view !== 'churches') editChurchId = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function openChurchDetail(id) {
  selectedChurchId = id;
  currentView = 'detail';
  render();
  try {
    const payload = await apiRequest(`/api/admin/churches/${encodeURIComponent(id)}/summary`);
    detailCache.set(id, payload);
    if (currentView === 'detail' && selectedChurchId === id) render();
  } catch (error) {
    toast(`Detalhes adicionais indisponíveis: ${error.message}`);
  }
}

async function createBillingCheckout(id) {
  const church = state.churches.find(item => item.id === id);
  if (!church) return;
  const payerEmail = window.prompt(`E-mail do responsável pelo pagamento de ${church.name}:`, '');
  if (payerEmail === null) return;
  const email = payerEmail.trim().toLowerCase();
  if (!/^\\S+@\\S+\\.\\S+$/.test(email)) return toast('Informe um e-mail válido para criar a cobrança.');
  const popup = window.open('about:blank', '_blank', 'noopener');
  try {
    const payload = await apiRequest(`/api/admin/churches/${encodeURIComponent(id)}/billing/checkout`, { method: 'POST', body: { planId: church.plan, payerEmail: email } });
    if (!payload.checkoutUrl) throw new Error('O Mercado Pago não retornou um link de checkout.');
    if (popup) popup.location = payload.checkoutUrl;
    else window.location.href = payload.checkoutUrl;
    toast('Link de pagamento criado.');
    const detail = await apiRequest(`/api/admin/churches/${encodeURIComponent(id)}/billing`);
    detailCache.set(`${id}:billing`, detail);
  } catch (error) {
    if (popup) popup.close();
    toast(`Não foi possível criar a cobrança: ${error.message}`);
  }
}

async function setChurchStatus(id, requestedStatus) {
  const church = state.churches.find(item => item.id === id);
  if (!church) return;
  const labels = { active: 'ativar', blocked: 'bloquear', paused: 'pausar', trial: 'colocar em teste' };
  const action = labels[requestedStatus] || 'alterar';
  if (!window.confirm(`Deseja ${action} a ${church.name}?`)) return;
  try {
    await apiRequest(`/api/admin/churches/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status: requestedStatus } });
    await loadRemoteState();
    toast(`Status de ${church.name} atualizado.`);
  } catch (error) {
    toast(`Não foi possível atualizar a igreja: ${error.message}`);
  }
}

async function savePlans(form) {
  const data = new FormData(form);
  const plans = state.platformPlans.map(plan => ({
    id: plan.id,
    name: String(data.get(`name_${plan.id}`) || plan.name).trim(),
    price: numeric(data.get(`price_${plan.id}`)),
    memberLimit: numeric(data.get(`members_${plan.id}`)),
    userLimit: numeric(data.get(`users_${plan.id}`)),
    description: plan.description,
    features: plan.features
  }));
  try {
    await apiRequest('/api/admin/plans', { method: 'PUT', body: { plans } });
    await loadRemoteState();
    toast('Tabela de preços salva no banco de produção.');
  } catch (error) {
    toast(`Não foi possível salvar os planos: ${error.message}`);
  }
}

async function saveExpense(form) {
  const data = new FormData(form);
  const description = String(data.get('description') || '').trim();
  const amount = numeric(data.get('amount'));
  if (!description || amount <= 0) return toast('Informe a descrição e um valor válido.');
  try {
    await apiRequest('/api/admin/expenses', { method: 'POST', body: { description, category: String(data.get('category') || 'Outro'), amount } });
    await loadRemoteState();
    toast('Gasto salvo no banco de produção.');
  } catch (error) {
    toast(`Não foi possível salvar o gasto: ${error.message}`);
  }
}

async function addChurch(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  if (!name) return toast('Informe o nome da igreja.');
  const planId = String(data.get('plan') || '');
  if (!planId) return toast('Nenhum plano real está disponível para o cadastro.');
  try {
    await apiRequest('/api/admin/churches', { method: 'POST', body: { name, city: String(data.get('city') || 'Brasil').trim(), planId, pastors: String(data.get('admin') || '').trim() } });
    await loadRemoteState();
    addChurchOpen = false;
    toast(`${name} foi cadastrada no banco de produção.`);
  } catch (error) {
    toast(`Não foi possível cadastrar a igreja: ${error.message}`);
  }
}

async function saveChurchEdit(form) {
  const data = new FormData(form);
  const id = String(data.get('id') || '');
  const name = String(data.get('name') || '').trim();
  if (!id || !name) return toast('Informe o nome da igreja.');
  try {
    await apiRequest(`/api/admin/churches/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name, city: String(data.get('city') || '').trim(), phone: String(data.get('phone') || '').trim(), pastors: String(data.get('pastors') || '').trim(), planId: String(data.get('plan') || '') } });
    editChurchId = null;
    await loadRemoteState();
    toast('Cadastro da igreja atualizado.');
  } catch (error) {
    toast(`Não foi possível editar a igreja: ${error.message}`);
  }
}

async function saveLead(form) {
  const data = new FormData(form);
  const churchName = String(data.get('churchName') || '').trim();
  if (!churchName) return toast('Informe o nome da igreja interessada.');
  try {
    await apiRequest('/api/admin/leads', { method: 'POST', body: { churchName, city: String(data.get('city') || '').trim(), contactName: String(data.get('contactName') || '').trim(), contactEmail: String(data.get('contactEmail') || '').trim(), contactPhone: String(data.get('contactPhone') || '').trim(), source: String(data.get('source') || 'indicação').trim(), status: String(data.get('status') || 'interested'), notes: String(data.get('notes') || '').trim() } });
    const leadsPayload = await apiRequest('/api/admin/leads');
    state.leads = leadsPayload.leads || [];
    render();
    toast('Igreja interessada registrada no pipeline.');
  } catch (error) {
    toast(`Não foi possível salvar o lead: ${error.message}`);
  }
}

async function updateLeadStatus(id, status) {
  try {
    await apiRequest(`/api/admin/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
    const leadsPayload = await apiRequest('/api/admin/leads');
    state.leads = leadsPayload.leads || [];
    render();
    toast('Etapa do pipeline atualizada.');
  } catch (error) {
    toast(`Não foi possível atualizar o pipeline: ${error.message}`);
  }
}

async function saveSupport(form) {
  const data = new FormData(form);
  const subject = String(data.get('subject') || '').trim();
  const message = String(data.get('message') || '').trim();
  if (!subject || !message) return toast('Informe o assunto e a descrição.');
  try {
    await apiRequest('/api/admin/support', { method: 'POST', body: { subject, message, priority: String(data.get('priority') || 'normal'), churchId: String(data.get('churchId') || '') || null } });
    const supportPayload = await apiRequest('/api/admin/support');
    state.support = supportPayload.requests || [];
    render();
    toast('Solicitação registrada no histórico de suporte.');
  } catch (error) {
    toast(`Não foi possível registrar a solicitação: ${error.message}`);
  }
}

async function updateSupportStatus(id, status) {
  try {
    await apiRequest(`/api/admin/support/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
    const supportPayload = await apiRequest('/api/admin/support');
    state.support = supportPayload.requests || [];
    render();
    toast('Status da solicitação atualizado.');
  } catch (error) {
    toast(`Não foi possível atualizar o suporte: ${error.message}`);
  }
}

function handleInput(event) {
  if (event.target.id !== 'churchSearch') return;
  churchQuery = event.target.value;
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    const caret = event.target.selectionStart;
    render();
    const input = document.querySelector('#churchSearch');
    if (input) { input.focus(); input.setSelectionRange(caret, caret); }
  }, 120);
}

function handleChange(event) {
  if (event.target.id === 'churchStatusFilter') {
    churchFilter = event.target.value;
    render();
    return;
  }
  if (event.target.matches('[data-admin-lead-status]')) {
    updateLeadStatus(event.target.dataset.adminLeadStatus, event.target.value);
  }
}

function handleClick(event) {
  const nav = event.target.closest('[data-admin-view]');
  if (nav) { event.preventDefault(); setView(nav.dataset.adminView); return; }
  const action = event.target.closest('[data-admin-action]');
  if (!action) return;
  event.preventDefault();
  const type = action.dataset.adminAction;
  if (type === 'toggle-add-church') { addChurchOpen = !addChurchOpen; editChurchId = null; render(); return; }
  if (type === 'close-edit') { editChurchId = null; render(); return; }
  if (type === 'view-church') { openChurchDetail(action.dataset.id); return; }
  if (type === 'edit-church') { editChurchId = action.dataset.id; currentView = 'churches'; render(); return; }
  if (type === 'set-church-status') { setChurchStatus(action.dataset.id, action.dataset.status); return; }
  if (type === 'refresh-detail') { openChurchDetail(action.dataset.id); return; }
  if (type === 'create-billing-checkout') { createBillingCheckout(action.dataset.id); return; }
  if (type === 'save-plans-top') { document.querySelector('[data-admin-form="plans"]')?.requestSubmit(); return; }
  if (type === 'focus-expense') { document.querySelector('#expenseDescription')?.focus(); return; }
  if (type === 'support-status') { updateSupportStatus(action.dataset.id, action.dataset.status); }
}

async function handleSubmit(event) {
  const form = event.target.closest('[data-admin-form]');
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.adminForm;
  if (type === 'church-filter') {
    const data = new FormData(form);
    churchQuery = String(data.get('query') || '');
    churchFilter = String(data.get('status') || 'all');
    render();
    return;
  }
  if (type === 'login') {
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim().toLowerCase();
    const password = String(data.get('password') || '');
    const error = document.querySelector('#adminLoginError');
    const button = form.querySelector('button[type="submit"]');
    if (!email || !password) {
      error.textContent = 'Informe o e-mail e a senha.';
      error.classList.remove('hidden');
      return;
    }
    button.disabled = true;
    button.textContent = 'Conectando...';
    try {
      const payload = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
      sessionStorage.setItem(ADMIN_TOKEN_KEY, payload.token);
      sessionStorage.setItem(ADMIN_USER_KEY, JSON.stringify(payload.user || {}));
      await loadRemoteState();
      error.classList.add('hidden');
      showApp();
    } catch (loginError) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_USER_KEY);
      error.textContent = loginError.message || 'Não foi possível conectar à API da Emaús.';
      error.classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar no administrador';
    }
    return;
  }
  if (type === 'church') await addChurch(form);
  if (type === 'edit-church') await saveChurchEdit(form);
  if (type === 'plans') await savePlans(form);
  if (type === 'expense') await saveExpense(form);
  if (type === 'support') await saveSupport(form);
  if (type === 'lead') await saveLead(form);
}

async function init() {
  document.querySelector('#adminEmail').value = ADMIN_EMAIL;
  document.querySelector('#adminLoginForm').dataset.adminForm = 'login';
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit);
  document.querySelector('#adminLogout').addEventListener('click', () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_USER_KEY);
    showLogin();
  });
  if (isLoggedIn()) {
    try {
      await loadRemoteState();
      showApp();
    } catch (error) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_USER_KEY);
      showLogin();
    }
  } else {
    showLogin();
  }
}

init();
