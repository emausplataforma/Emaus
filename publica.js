const API_BASE = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
const query = new URLSearchParams(window.location.search);
const slug = (query.get('igreja') || query.get('church') || 'bethesda').trim().toLowerCase();

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function assetUrl(value, churchSlug) {
  const source = String(value || '');
  if (source) return /^(data:|https?:|\/|\.)/i.test(source) ? source : `./${source}`;
  // Sem logo cadastrado: a pagina mostra as iniciais da propria igreja (setLogo).
  // Nao existe mais arquivo de uma igreja especifica como padrao aqui.
  return '';
}
function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
}
function safeExternalUrl(value) {
  const source = String(value || '').trim();
  return /^https?:\/\//i.test(source) ? source : '';
}
// "Evandro e Simone", "Evandro, Simone" ou um por linha: todos viram uma lista.
function pastorNames(value) {
  return String(value || '')
    .split(/\r?\n|;|,|\s+e\s+|\s*&\s*/)
    .map(nome => nome.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6);
}
function renderPastors(church, bio) {
  const secao = document.getElementById('pastorsSection');
  if (!secao) return;
  const nomes = pastorNames((church && church.pastors) || '');
  const lista = document.getElementById('pastorsList');
  const titulo = document.getElementById('pastorsTitle');
  const paragrafo = document.getElementById('pastorsText');
  if (lista) {
    lista.innerHTML = nomes.map(nome => `<span class="pastor-name">${esc(nome)}</span>`).join('');
    lista.hidden = !nomes.length;
  }
  if (titulo) titulo.textContent = nomes.length > 1 ? 'Nossos pastores' : nomes.length === 1 ? 'Nosso pastor' : 'Sobre os pastores';
  if (paragrafo) { paragrafo.textContent = bio || ''; paragrafo.hidden = !bio; }
  // a lista dos nomes basta para a seção aparecer; a biografia segue opcional
  secao.classList.toggle('is-hidden', !nomes.length && !bio);
}
function setText(id, value, fallback = '') {
  const element = document.getElementById(id);
  if (element) element.textContent = value || fallback;
}
function setLogo(symbolId, imageId, church, fallbackSymbol = '') {
  const symbol = document.getElementById(symbolId);
  const image = document.getElementById(imageId);
  const source = assetUrl(church.logo_url, church.slug);
  const fallbackText = String(fallbackSymbol || church.name || 'I').trim().slice(0, 2).toUpperCase();
  if (source) {
    if (symbol) symbol.hidden = true;
    if (image) {
      image.hidden = false; image.src = source; image.alt = `Logo da ${church.name}`;
      // Arquivo de logo ausente: mostra as iniciais, nao o icone de imagem quebrada.
      image.onerror = () => { image.hidden = true; if (symbol) { symbol.hidden = false; symbol.textContent = fallbackText; } };
    }
  } else {
    if (symbol) { symbol.hidden = false; symbol.textContent = String(fallbackSymbol || church.name || 'I').trim().slice(0, 2).toUpperCase(); }
    if (image) image.hidden = true;
  }
}
function showError(title, text) {
  document.getElementById('publicShell')?.classList.add('is-hidden');
  const message = document.getElementById('stateMessage');
  message?.classList.remove('is-hidden');
  setText('stateTitle', title);
  setText('stateText', text);
}
// Série recorrente não pode virar muro de cartões iguais na página de visitas: a agenda
// pública mostra a próxima data com o aviso de que ela se repete, e as ocorrências
// seguintes ficam de fora. A lista completa continua no painel da igreja.
function ruleDeEvento(event) {
  const bruto = event && (event.recurrence_rule || event.recurrenceRule);
  if (!bruto) return {};
  if (typeof bruto === 'string') { try { return JSON.parse(bruto) || {}; } catch (error) { return {}; } }
  return typeof bruto === 'object' ? bruto : {};
}
function rotuloRecorrencia(event) {
  const regra = ruleDeEvento(event);
  const tipo = String(regra.type || '');
  if (tipo === 'weekly-month' || tipo === 'weekly-year') {
    const semanas = Number(regra.intervaloSemanas || 1);
    return semanas > 1 ? `repete a cada ${semanas} semanas` : 'repete toda semana';
  }
  if (tipo === 'monthly-date' || tipo === 'monthly-weekday') return 'repete todo mês';
  if (tipo === 'yearly-date' || tipo === 'yearly-weekday') return 'repete uma vez por ano';
  return '';
}
function colapsaSerie(events = []) {
  const vistas = new Set();
  const saida = [];
  for (const event of events) {
    const serie = String((event && event.recurrence_id) || '');
    if (!serie) { saida.push(event); continue; }
    if (vistas.has(serie)) continue;
    vistas.add(serie);
    saida.push(event);
  }
  return saida;
}
function renderEvents(events = []) {
  const grid = document.getElementById('eventsGrid');
  if (!grid) return;
  if (!events.length) {
    grid.innerHTML = '<div class="loading-card">Ainda não há encontros publicados. Volte em breve para conferir a agenda.</div>';
    return;
  }
  const visiveis = colapsaSerie(events);
  grid.innerHTML = visiveis.slice(0, 6).map(event => `<article class="event-card"><div><div class="event-date">${esc(formatDate(event.event_date))} · ${esc(event.event_time || '19:00')}${rotuloRecorrencia(event) ? ` · ${esc(rotuloRecorrencia(event))}` : ''}</div><h3>${esc(event.title)}</h3><div class="event-detail"><span>⌖ ${esc(event.location || 'Templo principal')}</span><span>◉ ${esc(event.audience || 'Toda a igreja')}</span></div></div><span class="event-tag">${esc(event.event_type || 'Encontro')}${event.recurrence_id ? ' · série' : ''}</span></article>`).join('');
}
function renderSocials(settings) {
  const links = [['Instagram', settings.instagram], ['Facebook', settings.facebook], ['YouTube', settings.youtube]].filter(([, value]) => safeExternalUrl(value));
  const target = document.getElementById('socialLinks');
  if (target) target.innerHTML = links.map(([label, value]) => `<a href="${esc(safeExternalUrl(value))}" target="_blank" rel="noopener">${esc(label)}</a>`).join('');
}
function renderPage(payload) {
  const church = payload.church || {};
  const settings = { visible: true, ...(church.publicSettings || church.public_settings || {}) };
  const description = church.description || 'Um lugar para pertencer, crescer e viver a fé em comunidade.';
  const headline = settings.headline || description;
  const address = settings.address || church.city || 'Nossa cidade';
  const hours = settings.hours || 'Confira nossos horários';
  const cta = settings.cta || 'Venha nos visitar';
  setText('brandName', church.name, 'Igreja');
  setText('heroChurchName', church.name, 'Igreja');
  setText('heroTitle', headline, description);
  setText('heroDescription', description, 'Uma comunidade pronta para receber você.');
  setText('aboutTitle', 'Uma comunidade que caminha com você.');
  setText('aboutText', description, 'Nossa igreja é um lugar para encontrar pessoas, crescer na fé e servir com alegria.');
  const history = String(settings.history || '').trim();
  const pastorsBio = String(settings.pastorsBio || '').trim();
  setText('historyText', history);
  renderPastors(church, pastorsBio);
  document.getElementById('historySection')?.classList.toggle('is-hidden', !history);
  setText('heroAddress', address);
  setText('heroHours', hours);
  setText('contactAddress', address);
  setText('contactPhone', church.phone || 'Entre em contato conosco');
  setText('contactHours', hours);
  setText('contactDescription', description);
  setText('footerName', church.name, 'Igreja');
  document.title = `${church.name || 'Igreja'} · Página da igreja`;
  // O cartao de espera (4 s) mostra a marca desta igreja; quem abre de novo ja
  // tem a identidade guardada e ve o logo imediatamente.
  try { window.__emausSplash?.update({ name: church.name || '', logo: church.logo_url || '' }); } catch (error) {}
  try { localStorage.setItem('emaus-church-splash-v1', JSON.stringify({ name: church.name || '', logo: String(church.logo_url || '').trim() && !/^(data:|https?:|\/|\.)/i.test(church.logo_url) ? `./${church.logo_url}` : (church.logo_url || ''), at: Date.now() })); } catch (error) {}
  const visitorPath = `visita.html?igreja=${encodeURIComponent(church.slug || slug)}`;
  ['headerCta', 'heroCta', 'contactCta'].forEach(id => { const el = document.getElementById(id); if (el) { el.firstChild.nodeValue = `${cta} `; el.href = visitorPath; } });
  setLogo('brandSymbol', 'brandImage', church, settings.logoSymbol || '');
  setLogo('heroSymbol', 'heroImage', church, settings.logoSymbol || '');
  renderEvents(payload.events || []);
  renderSocials(settings);
  setText('footerYear', String(new Date().getFullYear()));
}
async function init() {
  if (!API_BASE) return showError('Página pública', 'A URL da API da plataforma ainda não foi configurada.');
  try {
    const response = await fetch(`${API_BASE}/api/public/church?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Igreja não encontrada.');
    renderPage(payload);
  } catch (error) {
    showError('Página indisponível', error.message || 'Não foi possível carregar esta igreja agora.');
  }
}
init();
