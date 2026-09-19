const API_BASE = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
const query = new URLSearchParams(window.location.search);
const slug = (query.get('igreja') || query.get('church') || 'bethesda').trim().toLowerCase();

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function assetUrl(value, churchSlug) {
  const source = String(value || '');
  if (/^(data:|https?:|\/)/i.test(source)) return source;
  if (source) return source;
  return churchSlug === 'bethesda' ? 'bethesda-logo.png' : '';
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
function setText(id, value, fallback = '') {
  const element = document.getElementById(id);
  if (element) element.textContent = value || fallback;
}
function setLogo(symbolId, imageId, church, fallbackSymbol = '') {
  const symbol = document.getElementById(symbolId);
  const image = document.getElementById(imageId);
  const source = assetUrl(church.logo_url, church.slug);
  if (source) {
    if (symbol) symbol.hidden = true;
    if (image) { image.hidden = false; image.src = source; image.alt = `Logo da ${church.name}`; }
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
function renderEvents(events = []) {
  const grid = document.getElementById('eventsGrid');
  if (!grid) return;
  if (!events.length) {
    grid.innerHTML = '<div class="loading-card">Ainda não há encontros publicados. Volte em breve para conferir a agenda.</div>';
    return;
  }
  grid.innerHTML = events.slice(0, 6).map(event => `<article class="event-card"><div><div class="event-date">${esc(formatDate(event.event_date))} · ${esc(event.event_time || '19:00')}</div><h3>${esc(event.title)}</h3><div class="event-detail"><span>⌖ ${esc(event.location || 'Templo principal')}</span><span>◉ ${esc(event.audience || 'Toda a igreja')}</span></div></div><span class="event-tag">${esc(event.event_type || 'Encontro')}${event.recurrence_id ? ' · recorrente' : ''}</span></article>`).join('');
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
  setText('pastorsTitle', church.pastors ? `Pastores ${church.pastors}` : 'Sobre os pastores');
  setText('pastorsText', pastorsBio);
  document.getElementById('historySection')?.classList.toggle('is-hidden', !history);
  document.getElementById('pastorsSection')?.classList.toggle('is-hidden', !pastorsBio);
  setText('heroAddress', address);
  setText('heroHours', hours);
  setText('contactAddress', address);
  setText('contactPhone', church.phone || 'Entre em contato conosco');
  setText('contactHours', hours);
  setText('contactDescription', description);
  setText('footerName', church.name, 'Igreja');
  document.title = `${church.name || 'Igreja'} · Emaús`;
  const visitorPath = `visita.html?igreja=${encodeURIComponent(church.slug || slug)}`;
  ['headerCta', 'heroCta', 'contactCta'].forEach(id => { const el = document.getElementById(id); if (el) { el.firstChild.nodeValue = `${cta} `; el.href = visitorPath; } });
  setLogo('brandSymbol', 'brandImage', church, settings.logoSymbol || '');
  setLogo('heroSymbol', 'heroImage', church, settings.logoSymbol || '');
  renderEvents(payload.events || []);
  renderSocials(settings);
  setText('footerYear', String(new Date().getFullYear()));
}
async function init() {
  if (!API_BASE) return showError('Página pública', 'A URL da API da Emaús ainda não foi configurada.');
  try {
    const response = await fetch(`${API_BASE}/api/public/church?slug=${encodeURIComponent(slug)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Igreja não encontrada.');
    renderPage(payload);
  } catch (error) {
    showError('Página indisponível', error.message || 'Não foi possível carregar esta igreja agora.');
  }
}
init();
