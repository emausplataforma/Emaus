const SESSION_KEY = 'emaus-reception-session';
const RECEPTION_TOKEN_KEY = 'emaus-reception-token';
const RECEPTION_USER_KEY = 'emaus-reception-user';
const API_BASE = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
// A portaria não digita mais a data: ela é a de Brasília, calculada na hora de salvar
// (um celular com relógio em UTC anotaria o culto de sábado à noite como domingo).
function brasiliaToday(value = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const pega = tipo => { const parte = partes.find(item => item.type === tipo); return parte ? parte.value : ''; };
  const ano = pega('year'), mes = pega('month'), dia = pega('day');
  if (ano && mes && dia) return `${ano}-${mes}-${dia}`;
  return value.toISOString().slice(0, 10);
}
const TODAY = brasiliaToday();

const fallbackState = {
  activeChurchId: 'batesda',
  metrics: { visits: 0, returns: 0, reach: 0, announcements: 0 },
  churches: [{ id: 'local', name: '', city: '', initials: '', logoSymbol: '', logoImage: '' }],
  visitors: [],
  activity: [],
  receptionUsers: []
};

let state = loadState();
let currentUser = null;

async function apiRequest(path, options = {}) {
  if (!API_BASE) throw new Error('A URL da API da plataforma não foi configurada.');
  const token = sessionStorage.getItem(RECEPTION_TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, cache: 'no-store', headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  let payload = {};
  try { payload = await response.json(); } catch (error) {}
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(RECEPTION_TOKEN_KEY);
    throw new Error(payload.error || `A API respondeu com HTTP ${response.status}.`);
  }
  return payload;
}

async function loadRemoteChurchData() {
  const [churchPayload, visitorPayload] = await Promise.all([apiRequest('/api/church/settings'), apiRequest('/api/church/visitors')]);
  const church = churchPayload.church;
  if (church) {
    state.activeChurchId = church.id;
    state.churches = [{ id: church.id, name: church.name, slug: church.slug || '', city: church.city, initials: initials(church.name), logoSymbol: initials(church.name).slice(0, 2), logoImage: church.logo_url || '', pastors: church.pastors || '' }];
  }
  state.visitors = (visitorPayload.visitors || []).map(visitor => ({
    id: visitor.id, name: visitor.name, familyName: visitor.family_name || '', familyMembers: Array.isArray(visitor.family_members) ? visitor.family_members : [visitor.name], arrivalType: visitor.arrival_type || 'Sozinho', announced: Boolean(visitor.announced), phone: visitor.phone || '', date: String(visitor.visit_date || TODAY).slice(0, 10), service: visitor.service || 'Culto de Celebração', neighborhood: visitor.neighborhood || '', invitedBy: visitor.invited_by || '', status: visitor.status || 'Novo', responsible: visitor.responsible || 'Recepção', notes: visitor.notes || '', consent: Boolean(visitor.communication_consent), communicationConsent: Boolean(visitor.communication_consent), churchId: visitor.church_id
  }));
}

function loadState() {
  try {
    localStorage.removeItem('batesda-platform-state-v1');
    localStorage.removeItem('batesda-platform-backups-v1');
  } catch (error) {
    console.info('Não foi possível limpar o cache legado da recepção.', error);
  }
  return JSON.parse(JSON.stringify(fallbackState));
}

function getChurch() {
  return state.churches.find(church => church.id === state.activeChurchId) || state.churches[0] || fallbackState.churches[0];
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'B';
}

function uniqueNames(names) {
  return [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))];
}

function namesAsSentence(names) {
  const clean = uniqueNames(names);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} e ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} e ${clean[clean.length - 1]}`;
}

function groupLabel(type, familyName) {
  if (type === 'Família') return familyName || 'Família';
  if (type === 'Em casal') return 'Casal';
  if (type === 'Com amigos') return 'Amigos';
  return 'Sozinho';
}

function groupRowsFor(type) {
  if (type === 'Em casal') return 1;
  if (type === 'Família' || type === 'Com amigos') return 2;
  return 1;
}

// "Família Nogueira" sem ninguém precisar digitar: vale quando todos os nomes
// terminam com o mesmo sobrenome. Caso contrário a lacuna fica para o pastor preencher.
function autoFamilyName(type, members) {
  if (type !== 'Família' || members.length < 2) return '';
  const sobrenomes = members.map(member => String(member).trim().split(/\s+/).pop() || '');
  if (sobrenomes.some(item => !item || item.length <= 2)) return '';
  if (new Set(sobrenomes.map(item => item.toLowerCase())).size !== 1) return '';
  return `Família ${sobrenomes[0]}`;
}

function companionPhones() {
  const linhas = [...document.querySelectorAll('.family-row')];
  const registros = [];
  for (const linha of linhas) {
    const campoNome = linha.querySelector('input[name="familyMember"]');
    const campoTelefone = linha.querySelector('input[name="familyMemberPhone"]');
    const nome = String(campoNome && campoNome.value || '').trim();
    const telefone = String(campoTelefone && campoTelefone.value || '').trim();
    if (nome && telefone) registros.push(`${nome} ${telefone}`);
  }
  return registros;
}

function getFormValues() {
  const form = document.querySelector('#visitorForm');
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const type = String(data.get('arrivalType') || 'Sozinho');
  const additionalNames = [...document.querySelectorAll('input[name="familyMember"]')].map(input => input.value);
  const members = uniqueNames([name, ...additionalNames]);
  const familyName = autoFamilyName(type, members);
  const phones = companionPhones();
  return {
    name,
    type,
    familyName,
    members,
    phones,
    notesExtra: phones.length ? `Telefones de quem veio junto: ${phones.join(' · ')}` : '',
    message: members.length ? `${groupLabel(type, familyName)}: ${namesAsSentence(members)}` : `${groupLabel(type, familyName)}: informe o nome do visitante.`
  };
}

function updatePreview() {
  const values = getFormValues();
  const church = getChurch();
  const lines = values.name ? `${values.message}\nSejam muito bem-vindos à ${church.name}!` : `${values.message}`;
  document.querySelector('#messagePreview').textContent = lines;
}

function showFamilyFields(force = false) {
  const checkbox = document.querySelector('#registerGroup');
  const arrival = document.querySelector('#visitorArrival');
  const fields = document.querySelector('#familyFields');
  const shouldShow = force || checkbox.checked || arrival.value !== 'Sozinho';
  fields.classList.toggle('hidden', !shouldShow);
  checkbox.checked = shouldShow;
  if (shouldShow) {
    // ao classificar como casal, família ou amigos, as lacunas já abrem na quantidade certa
    const existentes = document.querySelectorAll('input[name="familyMember"]').length;
    const desejadas = groupRowsFor(arrival.value);
    for (let indice = existentes; indice < desejadas; indice += 1) addFamilyMember(indice === existentes);
  }
  updatePreview();
}

function addFamilyMember() {
  const list = document.querySelector('#familyList');
  const row = document.createElement('div');
  row.className = 'family-row';
  row.innerHTML = '<input class="member-name" name="familyMember" placeholder="Nome de quem veio junto" autocomplete="off" inputmode="text"><input class="member-phone" name="familyMemberPhone" type="tel" inputmode="tel" placeholder="Telefone (opcional)" autocomplete="off"><button class="remove-member" type="button" aria-label="Remover pessoa">×</button>';
  list.appendChild(row);
  const primeiro = row.querySelector('input');
  if (primeiro) primeiro.focus();
  updatePreview();
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.setTimeout(() => toast.classList.add('hidden'), 4200);
}

function renderChurchIdentity() {
  const church = getChurch();
  const logo = document.querySelector('#churchLogo');
  document.querySelector('#churchName').textContent = church.name || 'Igreja';
  const receptionBrandLabel = document.querySelector('#receptionBrandLabel');
  if (receptionBrandLabel) receptionBrandLabel.textContent = `Recepção · ${church.name || 'Igreja'}`;
  document.querySelector('#footerChurchName').textContent = church.name || 'Igreja';
  document.querySelector('#churchCity').textContent = `${church.city || 'Sua cidade'} · área de acolhimento`;
  document.title = `Recepção · ${church.name || 'Igreja'}`;
  // Salva a identidade para o splash das proximas aberturas (logo desta igreja).
  try {
    const logoSource = church.logoImage || '';
    localStorage.setItem('emaus-church-splash-v1', JSON.stringify({ name: church.name || '', logo: logoSource && !/^(data:|https?:|\/|\.)/i.test(logoSource) ? `./${logoSource}` : logoSource, at: Date.now() }));
  } catch (error) {}
  const fallbackSymbol = church.logoSymbol || initials(church.name);
  if (church.logoImage) {
    const nestedReceptionPage = /\/recepcao(?:\/|\/index\.html$)/i.test(window.location.pathname);
    const assetPrefix = nestedReceptionPage ? '../' : './';
    const logoSource = /^(data:|https?:|\/)/i.test(church.logoImage) ? church.logoImage : `${assetPrefix}${church.logoImage.replace(/^\.\//, '')}`;
    // Se o arquivo da logo nao existir no site, a caixa mostra as iniciais da igreja
    // em vez do icone de imagem quebrada.
    logo.innerHTML = `<img src="${logoSource}" alt="Logo da ${church.name}" onerror="this.parentNode.textContent='${esc(fallbackSymbol)}'">`;
  } else {
    logo.textContent = fallbackSymbol;
  }
}

function showLoggedInView(user) {
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, user.id);
  sessionStorage.setItem(RECEPTION_USER_KEY, JSON.stringify(user));
  document.querySelector('#loginView').classList.add('hidden');
  document.querySelector('#appView').classList.remove('hidden');
  document.querySelector('#logoutButton').classList.remove('hidden');
  document.querySelector('#welcomeTitle').textContent = `Olá, ${user.name.split(' ')[0]}!`;
  renderChurchIdentity();
  document.querySelector('#visitorDate').value = brasiliaToday();
  updatePreview();
}

function showLoggedOutView() {
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(RECEPTION_TOKEN_KEY);
  sessionStorage.removeItem(RECEPTION_USER_KEY);
  document.querySelector('#loginView').classList.remove('hidden');
  document.querySelector('#appView').classList.add('hidden');
  document.querySelector('#logoutButton').classList.add('hidden');
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.querySelector('#loginEmail').value.trim().toLowerCase();
  const password = document.querySelector('#loginPassword').value;
  const message = document.querySelector('#loginMessage');
  const button = document.querySelector('#loginForm button[type=submit]');
  if (!email || !password) { message.textContent = 'Informe o login e a senha.'; message.classList.remove('hidden'); return; }
  button.disabled = true;
  button.textContent = 'Conectando...';
  try {
    const payload = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
    if (!['church_admin', 'reception'].includes(payload.user?.role)) throw new Error('Este acesso não pertence à área da igreja.');
    sessionStorage.setItem(RECEPTION_TOKEN_KEY, payload.token);
    await loadRemoteChurchData();
    message.classList.add('hidden');
    showLoggedInView(payload.user);
  } catch (loginError) {
    sessionStorage.removeItem(RECEPTION_TOKEN_KEY);
    message.textContent = loginError.message || 'Não foi possível conectar à API da plataforma.';
    message.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar na recepção';
  }
}

async function handleVisitorSubmit(event) {
  event.preventDefault();
  const values = getFormValues();
  if (!values.name) return showToast('Informe o nome principal do visitante.');
  const form = document.querySelector('#visitorForm');
  // a data entra sozinha, no instante do cadastro, e é a de Brasília
  document.querySelector('#visitorDate').value = brasiliaToday();
  const data = new FormData(form);
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await apiRequest('/api/church/visitors', { method: 'POST', body: {
      name: values.name,
      familyName: values.familyName,
      familyMembers: values.members.length ? values.members : [values.name],
      arrivalType: values.type,
      phone: String(data.get('phone') || '').trim(), neighborhood: String(data.get('neighborhood') || '').trim(),
      visitDate: String(data.get('date') || brasiliaToday()),
      service: String(data.get('service') || 'Culto de Celebração'),
      invitedBy: String(data.get('invitedBy') || '').trim(),
      notes: [String(data.get('notes') || '').trim(), values.notesExtra].filter(Boolean).join('\n'),
      communicationConsent: data.get('communicationConsent') === 'on',
      consentVersion: 'reception-v1'
    }});
    await loadRemoteChurchData();
    document.querySelector('#successText').textContent = `${values.message}. ${pastorPhrase()}`;
    document.querySelector('#successText').dataset.manual = '1';
    document.querySelector('#successMessage').classList.remove('hidden');
    form.reset();
    document.querySelector('#visitorDate').value = brasiliaToday();
    document.querySelector('#familyList').innerHTML = '';
    document.querySelector('#familyFields').classList.add('hidden');
    updatePreview();
    showToast('Visitante salvo no banco de produção.');
  } catch (error) {
    showToast(`Não foi possível salvar o visitante: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function init() {
  renderChurchIdentity();
  document.querySelector('#loginForm').addEventListener('submit', handleLogin);
  document.querySelector('#visitorForm').addEventListener('submit', handleVisitorSubmit);
  document.querySelector('#visitorForm').addEventListener('input', () => {
    document.querySelector('#successMessage').classList.add('hidden');
    updatePreview();
  });
  document.querySelector('#visitorArrival').addEventListener('change', () => showFamilyFields());
  document.querySelector('#registerGroup').addEventListener('change', () => showFamilyFields());
  document.querySelector('#addMember').addEventListener('click', addFamilyMember);
  document.querySelector('#familyList').addEventListener('click', event => {
    if (!event.target.matches('.remove-member')) return;
    event.target.closest('.family-row').remove();
    updatePreview();
  });
  document.querySelector('#clearForm').addEventListener('click', () => {
    document.querySelector('#visitorForm').reset();
    document.querySelector('#visitorDate').value = brasiliaToday();
    document.querySelector('#familyList').innerHTML = '';
    document.querySelector('#familyFields').classList.add('hidden');
    document.querySelector('#successMessage').classList.add('hidden');
    updatePreview();
  });
  document.querySelector('#logoutButton').addEventListener('click', showLoggedOutView);
  document.querySelector('#visitorDate').value = brasiliaToday();
  const sessionUserId = sessionStorage.getItem(SESSION_KEY);
  const savedUser = sessionStorage.getItem(RECEPTION_USER_KEY);
  if (sessionUserId && sessionStorage.getItem(RECEPTION_TOKEN_KEY) && savedUser) {
    try {
      const me = await apiRequest('/api/me');
      await loadRemoteChurchData();
      showLoggedInView(me.user || JSON.parse(savedUser));
    } catch (error) {
      showLoggedOutView();
    }
  } else {
    showLoggedOutView();
  }
  refreshPastoralWording();
  updatePreview();
}

// A recepção fala "pastor" ou "pastores" conforme o cadastro da igreja tiver um ou
// mais nomes em "Pastores responsáveis". Nenhum nome de igreja é chumbado aqui.
function pastoralNames() {
  return String(getChurch()?.pastors || '')
    .split(/\r?\n|;|,|\s+e\s+|\s*&\s*/)
    .map(nome => nome.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6);
}
function pastoralIsPlural() { return pastoralNames().length > 1; }
function pastorPhrase() {
  return pastoralIsPlural()
    ? 'Os pastores já poderão visualizar este cadastro no Acolhimento.'
    : 'O pastor já poderá visualizar este cadastro no Acolhimento.';
}
function refreshPastoralWording() {
  const alvo = document.querySelector('#successText');
  if (alvo && !alvo.dataset.manual) alvo.textContent = pastorPhrase();
}

document.addEventListener('DOMContentLoaded', init);
