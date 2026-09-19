const ADMIN_SESSION_KEY = 'emaus-admin-session';
const API_BASE = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
const ADMIN_EMAIL = 'admin@emaus.com.br';
const ADMIN_TOKEN_KEY = 'emaus-admin-token';
const ADMIN_USER_KEY = 'emaus-admin-user';
const TODAY = new Date().toISOString().slice(0, 10);

const DEFAULT_PLANS = [
  { id: 'essencial', name: 'Essencial', price: 49.90, members: 100, users: 5, description: 'Para igrejas que estão começando a organizar o cuidado.', features: ['Até 100 pessoas ativas', 'Acolhimento, visitantes e famílias', 'Agenda e relatórios essenciais', 'Até 5 acessos administrativos', 'Todos os recursos incluídos'] },
  { id: 'cuidado', name: 'Cuidado', price: 99.90, members: 300, users: 12, description: 'Para igrejas em crescimento com equipes e ministérios ativos.', features: ['Até 300 pessoas ativas', 'Tudo do Essencial', 'Comunicação e relatórios avançados', 'Identidade visual personalizada', 'Até 12 acessos administrativos'] },
  { id: 'rede', name: 'Rede', price: 179.90, members: 800, users: 25, description: 'Para igrejas maiores, redes e operações com várias equipes.', features: ['Até 800 pessoas ativas', 'Tudo do Cuidado', 'Até 3 congregações ou unidades', 'Indicadores financeiros e gestão avançada', 'Até 25 acessos administrativos'] }
];

const DEFAULT_POLICY = {
  trialDays: 30,
  founderChurches: 40,
  founderUsed: 0,
  priceFreezeMonths: 12,
  additionalFees: false,
  billingNote: 'Sem cobrança por usuário, mensagem, congregação extra ou módulo adicional.'
};

const DEFAULT_FINANCE = {
  months: [
    { label: 'Abr', income: 980, expense: 410 },
    { label: 'Mai', income: 1320, expense: 520 },
    { label: 'Jun', income: 1680, expense: 690 },
    { label: 'Jul', income: 2130, expense: 760 },
    { label: 'Ago', income: 2640, expense: 910 },
    { label: 'Set', income: 3190, expense: 1120 }
  ],
  transactions: [
    { id: 'expense-1', description: 'Servidor e infraestrutura', category: 'Tecnologia', amount: 680, date: '05 set 2026' },
    { id: 'expense-2', description: 'Comunicação e suporte', category: 'Operação', amount: 290, date: '03 set 2026' },
    { id: 'expense-3', description: 'Design e conteúdo', category: 'Marketing', amount: 150, date: '28 ago 2026' }
  ]
};

let currentView = 'overview';
let addChurchOpen = false;
let state = loadState();
let remoteStateLoaded = false;

async function apiRequest(path, options = {}) {
  if (!API_BASE) throw new Error('A URL da API da Emaús não foi configurada.');
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  let payload = null;
  try { payload = await response.json(); } catch (error) { payload = {}; }
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    throw new Error(payload.error || `A API respondeu com HTTP ${response.status}.`);
  }
  return payload;
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
  const status = church.status === 'blocked' ? 'Bloqueada' : church.status === 'trial' ? 'Em teste' : 'Ativa';
  return normalizeChurch({
    id: church.id,
    name: church.name,
    city: church.city,
    initials: initials(church.name),
    logoSymbol: initials(church.name).slice(0, 2),
    logoImage: String(church.slug || '').toLowerCase() === 'bethesda' ? 'bethesda-logo.png' : '',
    plan: church.plan_id || 'essencial',
    status,
    memberCount: Number(church.member_count || 0),
    monthlyValue: Number(church.monthly_price_cents || 0) / 100,
    memberLimit: Number(church.member_limit || 0),
    billingStatus: status === 'Em teste' ? 'Teste grátis' : 'Em dia',
    nextDue: church.trial_ends_at ? new Date(church.trial_ends_at).toLocaleDateString('pt-BR') : '—',
    founderPriceFreeze: Boolean(church.founder_price_freeze),
    founderPlanPrice: church.founder_plan_price_cents ? Number(church.founder_plan_price_cents) / 100 : null,
    apiStatus: church.status,
    slug: church.slug
  });
}

async function loadRemoteState() {
  const [churchPayload, plansPayload, financePayload] = await Promise.all([
    apiRequest('/api/admin/churches'),
    apiRequest('/api/admin/plans'),
    apiRequest('/api/admin/finance')
  ]);
  const plans = (plansPayload.plans || []).map(mapPlanFromApi);
  state.platformPricingVersion = 3;
  state.platformPlans = plans.length ? plans : clone(DEFAULT_PLANS);
  state.churches = (churchPayload.churches || []).map(mapChurchFromApi);
  state.activeChurchId = state.churches[0]?.id || null;
  const transactions = (financePayload.expenses || []).map(item => ({
    id: item.id,
    description: item.description,
    category: item.category,
    amount: Number(item.amount ?? Number(item.amount_cents || 0) / 100),
    date: item.expense_date ? new Date(`${item.expense_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'
  }));
  const revenue = activeChurches().reduce((total, church) => total + Number(church.monthlyValue || 0), 0);
  const months = clone(DEFAULT_FINANCE.months).map(month => ({ ...month, income: 0, expense: 0 }));
  if (months.length) months[months.length - 1].income = revenue;
  state.platformFinance = { months, transactions };
  state.platformPolicy = { ...DEFAULT_POLICY, founderUsed: state.churches.filter(church => church.founderPriceFreeze).length };
  remoteStateLoaded = true;
  saveState('Dados carregados da API de produção');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function number(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function numeric(value) {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.')) || 0;
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'IG';
}

function normalizePlan(value, plans = state.platformPlans || DEFAULT_PLANS) {
  const rawValue = String(value || '').toLowerCase();
  const aliases = { crescimento: 'cuidado', comunidade: 'rede' };
  const raw = aliases[rawValue] || rawValue;
  const found = plans.find(plan => plan.id === raw || plan.name.toLowerCase() === raw);
  return found ? found.id : 'essencial';
}

function getPlan(id, plans = state.platformPlans || DEFAULT_PLANS) {
  return plans.find(plan => plan.id === id) || plans[0];
}

function normalizeChurch(church, plans = state.platformPlans || DEFAULT_PLANS) {
  const knownPeople = Number(church.memberCount ?? church.members ?? 0);
  const inferredPlan = church.plan || (knownPeople > 300 ? 'rede' : knownPeople > 100 ? 'cuidado' : 'essencial');
  const planId = normalizePlan(inferredPlan, plans);
  const plan = getPlan(planId, plans);
  return {
    ...church,
    name: church.name || 'Igreja sem nome',
    city: church.city || 'Brasil',
    initials: church.initials || initials(church.name),
    plan: planId,
    memberLimit: Number.isFinite(Number(church.memberLimit)) ? Number(church.memberLimit) : plan.members,
    memberCount: Number.isFinite(Number(church.memberCount)) ? Number(church.memberCount) : Number(church.members || 0),
    status: church.status === 'Bloqueada' ? 'Bloqueada' : (church.status || 'Ativa'),
    monthlyValue: Number.isFinite(Number(church.monthlyValue)) ? Number(church.monthlyValue) : plan.price,
    billingStatus: church.billingStatus || 'Em dia',
    nextDue: church.nextDue || '10 set 2026'
  };
}

function loadState() {
  const base = {
    activeChurchId: null,
    churches: [],
    visitors: [],
    receptionUsers: []
  };
  const plans = clone(DEFAULT_PLANS);
  const policy = { ...DEFAULT_POLICY };
  return { ...base, platformPricingVersion: 3, platformPlans: plans, platformPolicy: policy, platformFinance: clone(DEFAULT_FINANCE) };
}

function saveState(reason = 'Alteração administrativa salva') {
  state.platformPricingVersion = 3;
  state.platformPolicy = { ...DEFAULT_POLICY, ...(state.platformPolicy || {}) };
  state.churches = state.churches.map(church => normalizeChurch(church));
  // Dados administrativos permanecem no PostgreSQL; não são espelhados no navegador.
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
  return state.churches.filter(church => church.status !== 'Bloqueada');
}

function recurringRevenue() {
  return activeChurches().reduce((total, church) => total + Number(church.monthlyValue || getPlan(church.plan)?.price || 0), 0);
}

function currentExpenses() {
  return (state.platformFinance.transactions || []).reduce((total, item) => total + Number(item.amount || 0), 0);
}

function monthMax() {
  return Math.max(...state.platformFinance.months.flatMap(month => [Number(month.income || 0), Number(month.expense || 0)]), 1);
}

function renderKpis() {
  const active = activeChurches().length;
  const revenue = recurringRevenue();
  const expense = currentExpenses();
  const people = activeChurches().reduce((total, church) => total + Number(church.memberCount || 0), 0);
  return `<div class="kpi-grid">
    <article class="kpi-card"><span class="kpi-icon">◈</span><small>Igrejas ativas</small><strong>${number(active)}</strong><span>${number(state.churches.length)} organizações cadastradas</span></article>
    <article class="kpi-card copper"><span class="kpi-icon">R$</span><small>Receita mensal prevista</small><strong>${money(revenue)}</strong><span>planos ativos</span></article>
    <article class="kpi-card green"><span class="kpi-icon">↑</span><small>Resultado operacional</small><strong>${money(revenue - expense)}</strong><span>receita menos gastos registrados</span></article>
    <article class="kpi-card blue"><span class="kpi-icon">◎</span><small>Pessoas gerenciadas</small><strong>${number(people)}</strong><span>cadastros ativos nas igrejas</span></article>
  </div>`;
}

function renderChart() {
  const max = monthMax();
  return `<div class="chart">${state.platformFinance.months.map(month => `<div class="chart-column"><div class="chart-bars"><i class="chart-bar" style="height:${Math.max(4, Number(month.income || 0) / max * 100)}%" title="Receita: ${money(month.income)}"></i><i class="chart-bar expense" style="height:${Math.max(4, Number(month.expense || 0) / max * 100)}%" title="Gastos: ${money(month.expense)}"></i></div></div>`).join('')}</div><div class="chart-labels">${state.platformFinance.months.map(month => `<span>${esc(month.label)}</span>`).join('')}</div>`;
}

function renderOverview() {
  const revenue = recurringRevenue();
  const expense = currentExpenses();
  const recent = state.churches.slice(0, 5);
  return `<section class="page-head"><div><span class="eyebrow">CENTRAL DO ADMINISTRADOR</span><h1>Visão geral</h1><p>Controle as organizações, os planos e a saúde financeira da plataforma Emaús.</p></div><div class="page-actions"><button class="btn" data-admin-view="finance">Ver finanças</button><button class="btn btn-gold" data-admin-view="churches">Gerenciar igrejas</button></div></section>
  ${renderPolicyBanner()}
  ${renderKpis()}
  <div class="grid-2"><section class="panel"><div class="panel-head"><div><h2>Receita e gastos</h2><p>Visão demonstrativa dos últimos seis meses.</p></div><div class="legend"><span><i></i>Receita</span><span><i class="expense"></i>Gastos</span></div></div><div class="panel-body">${renderChart()}</div></section><section class="panel"><div class="panel-head"><div><h2>Resumo operacional</h2><p>Indicadores da administração central.</p></div></div><div class="panel-body"><div class="summary-list"><div class="summary-row"><span>Receita mensal prevista</span><strong>${money(revenue)}</strong></div><div class="summary-row"><span>Gastos registrados</span><strong class="negative">${money(expense)}</strong></div><div class="summary-row"><span>Resultado estimado</span><strong class="positive">${money(revenue - expense)}</strong></div><div class="summary-row"><span>Contas bloqueadas</span><strong>${number(state.churches.filter(church => church.status === 'Bloqueada').length)}</strong></div><div class="summary-row"><span>Backup PostgreSQL</span><strong>Guiado</strong></div></div></div></section></div>
  <section class="panel" style="margin-top:16px;"><div class="panel-head"><div><h2>Organizações recentes</h2><p>Ative ou bloqueie cada igreja e acompanhe o limite de pessoas do plano.</p></div><button class="btn btn-small" data-admin-view="churches">Ver todas</button></div><div class="table-wrap">${renderChurchTable(recent)}</div></section>`;
}

function renderChurchTable(churches) {
  if (!churches.length) return '<div class="empty">Nenhuma igreja cadastrada.</div>';
  return `<table><thead><tr><th>Organização</th><th>Plano</th><th>Status</th><th>Pessoas ativas</th><th>Mensalidade</th><th>Ações</th></tr></thead><tbody>${churches.map(church => {
    const plan = getPlan(church.plan);
    const isBlocked = church.status === 'Bloqueada';
    const memberCount = Number(church.memberCount || 0);
    const limit = Number(church.memberLimit || plan?.members || 0);
    const percentage = limit ? Math.min(100, memberCount / limit * 100) : 0;
    return `<tr><td><div class="church-cell"><div class="church-avatar">${church.logoImage ? `<img src="${esc(church.logoImage)}" alt="">` : esc(church.initials || initials(church.name))}</div><div class="church-meta"><strong>${esc(church.name)}</strong><small>${esc(church.city)}</small></div></div></td><td><strong>${esc(plan?.name || church.plan)}</strong><br><small style="color:var(--muted-2);">até ${number(limit)} pessoas</small>${church.founderPriceFreeze ? '<br><small class="founder-label">Preço congelado por 12 meses</small>' : ''}</td><td><span class="status ${isBlocked ? 'blocked' : 'active'}">${isBlocked ? 'Bloqueada' : 'Ativa'}</span></td><td><div class="member-meter"><div class="member-meter-line"><span>${number(memberCount)} / ${number(limit)}</span><strong>${Math.round(percentage)}%</strong></div><div class="meter"><i style="width:${percentage}%"></i></div></div></td><td>${money(church.monthlyValue || plan?.price)}</td><td><div class="row-actions"><button class="table-btn ${isBlocked ? 'gold' : 'danger'}" data-admin-action="toggle-church" data-id="${esc(church.id)}">${isBlocked ? 'Liberar' : 'Bloquear'}</button></div></td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderChurches() {
  return `<section class="page-head"><div><span class="eyebrow">ORGANIZAÇÕES</span><h1>Igrejas cadastradas</h1><p>Gerencie o acesso, os planos e a situação de cada igreja.</p></div><div class="page-actions"><button class="btn btn-gold" data-admin-action="toggle-add-church">${addChurchOpen ? 'Fechar cadastro' : '+ Adicionar igreja'}</button></div></section>
  ${addChurchOpen ? `<section class="add-panel"><h3>Nova igreja</h3><p>O administrador cria a organização e libera o primeiro plano de acesso.</p><form data-admin-form="church"><div class="form-grid"><div class="field"><label for="newChurchName">Nome da igreja *</label><input id="newChurchName" name="name" required placeholder="Ex.: Igreja Esperança"></div><div class="field"><label for="newChurchCity">Cidade e estado</label><input id="newChurchCity" name="city" placeholder="Ex.: Niterói • RJ"></div><div class="field"><label for="newChurchPlan">Plano inicial</label><select id="newChurchPlan" name="plan">${state.platformPlans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)} · ${money(plan.price)}/mês · até ${number(plan.members)} pessoas</option>`).join('')}</select></div><div class="field"><label for="newChurchAdmin">Responsável</label><input id="newChurchAdmin" name="admin" placeholder="Nome do pastor"></div></div><p class="founder-form-note">Se ainda houver vaga, esta igreja será marcada entre as 40 primeiras e terá o valor congelado por 12 meses.</p><div class="form-actions"><button type="button" class="btn" data-admin-action="toggle-add-church">Cancelar</button><button type="submit" class="btn btn-gold">Salvar igreja</button></div></form></section>` : ''}
  <section class="panel"><div class="panel-head"><div><h2>Todas as organizações</h2><p>${number(state.churches.length)} igreja${state.churches.length === 1 ? '' : 's'} no controle administrativo.</p></div><span class="status active">${number(activeChurches().length)} ativas</span></div><div class="table-wrap">${renderChurchTable(state.churches)}</div></section>`;
}

function renderPolicyBanner() {
  const policy = state.platformPolicy || DEFAULT_POLICY;
  const remaining = Math.max(0, Number(policy.founderChurches || 0) - Number(policy.founderUsed || 0));
  return `<section class="policy-banner"><div class="policy-mark">✓</div><div><strong>Oferta de lançamento da Emaús</strong><p>${number(policy.trialDays)} dias grátis · as primeiras ${number(policy.founderChurches)} igrejas têm o valor congelado por ${number(policy.priceFreezeMonths)} meses · sem cobranças adicionais.</p></div><span class="policy-badge">${number(remaining)} vagas restantes</span></section>`;
}

function renderPlans() {
  return `<section class="page-head"><div><span class="eyebrow">MONETIZAÇÃO</span><h1>Planos e preços</h1><p>Três planos simples, com limite claro de pessoas ativas e sem taxas adicionais escondidas.</p></div><div class="page-actions"><button class="btn btn-gold" data-admin-action="save-plans-top">Salvar tabela de preços</button></div></section>
  ${renderPolicyBanner()}
  <section class="panel"><div class="panel-head"><div><h2>Tabela de preços da Emaús</h2><p>Valores iniciais sugeridos para o mercado brasileiro. O administrador pode editar e salvar.</p></div><span class="status active">Editável</span></div><div class="panel-body"><form data-admin-form="plans"><div class="table-wrap"><table class="plan-table"><thead><tr><th>Plano</th><th>Mensalidade</th><th>Pessoas ativas</th><th>Acessos</th></tr></thead><tbody>${state.platformPlans.map(plan => `<tr><td><input name="name_${esc(plan.id)}" value="${esc(plan.name)}" aria-label="Nome do plano"></td><td><input name="price_${esc(plan.id)}" value="${esc(plan.price)}" type="number" min="0" step="0.01" aria-label="Preço mensal"></td><td><input name="members_${esc(plan.id)}" value="${esc(plan.members)}" type="number" min="1" step="25" aria-label="Limite de pessoas ativas"></td><td><input name="users_${esc(plan.id)}" value="${esc(plan.users)}" type="number" min="1" step="1" aria-label="Limite de acessos"></td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="submit" class="btn btn-gold">Salvar alterações</button></div></form></div></section>
  <div class="plan-card-grid">${state.platformPlans.map((plan, index) => `<article class="plan-card ${index === 1 ? 'highlight' : ''}"><h3>${esc(plan.name)}</h3><div class="plan-price">${money(plan.price)} <small>/ mês</small></div><div class="plan-limits"><span>Até <strong>${number(plan.members)}</strong> pessoas ativas</span><span><strong>${number(plan.users)}</strong> acessos da equipe</span></div><p>${esc(plan.description || 'Plano da plataforma Emaús.')}</p><ul class="plan-points">${(plan.features || []).map(feature => `<li>${esc(feature)}</li>`).join('')}</ul></article>`).join('')}</div>`;
}
function renderFinance() {
  const revenue = recurringRevenue();
  const expense = currentExpenses();
  return `<section class="page-head"><div><span class="eyebrow">FINANCEIRO</span><h1>Ganhos e gastos</h1><p>Acompanhe a receita prevista, as despesas e o resultado da administração.</p></div><div class="page-actions"><button class="btn btn-gold" data-admin-action="focus-expense">+ Registrar gasto</button></div></section>
  <div class="kpi-grid"><article class="kpi-card copper"><span class="kpi-icon">R$</span><small>Ganhos mensais</small><strong>${money(revenue)}</strong><span>assinaturas ativas</span></article><article class="kpi-card"><span class="kpi-icon">◇</span><small>Gastos registrados</small><strong>${money(expense)}</strong><span>operação demonstrativa</span></article><article class="kpi-card green"><span class="kpi-icon">↑</span><small>Saldo estimado</small><strong>${money(revenue - expense)}</strong><span>resultado operacional</span></article><article class="kpi-card blue"><span class="kpi-icon">%</span><small>Margem estimada</small><strong>${revenue ? `${Math.round((revenue - expense) / revenue * 100)}%` : '0%'}</strong><span>sobre a receita</span></article></div>
  <div class="finance-grid"><section class="panel"><div class="panel-head"><div><h2>Desempenho financeiro</h2><p>Comparação mensal de receitas e gastos.</p></div><div class="legend"><span><i></i>Receita</span><span><i class="expense"></i>Gastos</span></div></div><div class="panel-body">${renderChart()}</div></section><section class="panel"><div class="panel-head"><div><h2>Registrar gasto</h2><p>Todos os campos possuem salvamento explícito.</p></div></div><div class="panel-body"><form data-admin-form="expense"><div class="field"><label for="expenseDescription">Descrição *</label><input id="expenseDescription" name="description" required placeholder="Ex.: Hospedagem da API"></div><div class="field" style="margin-top:12px;"><label for="expenseCategory">Categoria</label><select id="expenseCategory" name="category"><option>Tecnologia</option><option>Operação</option><option>Marketing</option><option>Equipe</option><option>Outro</option></select></div><div class="field" style="margin-top:12px;"><label for="expenseAmount">Valor (R$) *</label><input id="expenseAmount" name="amount" type="number" min="0.01" step="0.01" required placeholder="0,00"></div><div class="form-actions"><button class="btn btn-gold" type="submit">Salvar gasto</button></div></form></div></section></div>
  <section class="panel" style="margin-top:16px;"><div class="panel-head"><div><h2>Gastos registrados</h2><p>Histórico financeiro mantido pelo administrador.</p></div></div><div class="panel-body"><div class="transaction-list">${state.platformFinance.transactions.length ? state.platformFinance.transactions.map(item => `<div class="transaction"><div class="transaction-icon">−</div><div class="transaction-copy"><strong>${esc(item.description)}</strong><span>${esc(item.category)} · ${esc(item.date)}</span></div><div class="transaction-value">− ${money(item.amount)}</div></div>`).join('') : '<div class="empty">Nenhum gasto registrado.</div>'}</div></div></section>`;
}

function render() {
  document.querySelectorAll('[data-admin-view]').forEach(button => button.classList.toggle('active', button.dataset.adminView === currentView));
  const content = document.querySelector('#adminContent');
  const renderers = { overview: renderOverview, churches: renderChurches, plans: renderPlans, finance: renderFinance };
  content.innerHTML = (renderers[currentView] || renderOverview)();
}

function setView(view) {
  if (!['overview', 'churches', 'plans', 'finance'].includes(view)) return;
  currentView = view;
  if (view !== 'churches') addChurchOpen = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function toggleChurch(id) {
  const church = state.churches.find(item => item.id === id);
  if (!church) return;
  const willBlock = church.status !== 'Bloqueada';
  const question = willBlock ? `Bloquear o acesso da ${church.name}?` : `Liberar novamente o acesso da ${church.name}?`;
  if (!window.confirm(question)) return;
  try {
    await apiRequest(`/api/admin/churches/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status: willBlock ? 'blocked' : 'active' } });
    await loadRemoteState();
    render();
    toast(willBlock ? `${church.name} foi bloqueada.` : `${church.name} foi liberada.`);
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
    render();
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
    render();
    toast('Gasto salvo no banco de produção.');
  } catch (error) {
    toast(`Não foi possível salvar o gasto: ${error.message}`);
  }
}

async function addChurch(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  if (!name) return toast('Informe o nome da igreja.');
  const planId = String(data.get('plan') || 'essencial');
  try {
    await apiRequest('/api/admin/churches', { method: 'POST', body: { name, city: String(data.get('city') || 'Brasil').trim(), planId, pastors: String(data.get('admin') || '').trim() } });
    await loadRemoteState();
    addChurchOpen = false;
    render();
    toast(`${name} foi cadastrada no banco de produção.`);
  } catch (error) {
    toast(`Não foi possível cadastrar a igreja: ${error.message}`);
  }
}

function handleClick(event) {
  const nav = event.target.closest('[data-admin-view]');
  if (nav) { event.preventDefault(); setView(nav.dataset.adminView); return; }
  const action = event.target.closest('[data-admin-action]');
  if (!action) return;
  event.preventDefault();
  const type = action.dataset.adminAction;
  if (type === 'toggle-add-church') { addChurchOpen = !addChurchOpen; render(); return; }
  if (type === 'toggle-church') { toggleChurch(action.dataset.id); return; }
  if (type === 'save-plans-top') { document.querySelector('[data-admin-form="plans"]')?.requestSubmit(); return; }
  if (type === 'focus-expense') { document.querySelector('#expenseDescription')?.focus(); return; }
}

async function handleSubmit(event) {
  const form = event.target.closest('[data-admin-form]');
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.adminForm;
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
  if (type === 'plans') await savePlans(form);
  if (type === 'expense') await saveExpense(form);
}

async function init() {
  document.querySelector('#adminEmail').value = ADMIN_EMAIL;
  document.querySelector('#adminLoginForm').dataset.adminForm = 'login';
  document.addEventListener('click', handleClick);
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
