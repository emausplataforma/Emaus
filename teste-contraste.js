// teste-contraste.js — toda tela do painel, nos dois temas, medida com a cascata real.
//
// O pastor pediu: "quero que resolva todos os problemas de contrastes pois não dá para
// enxergar direito". Isso não se resolve olhando um print: este arquivo monta as nove telas
// com as funções de render do app.js, aplica styles.css por cima do HTML gerado (especifi-
// cidade, variáveis de tema, herança de cor, alpha, gradiente, opacity) e exige que CADA
// texto tenha a razão de contraste da WCAG (4.5:1 normal, 3:1 para texto grande) tanto no
// tema claro quanto no escuro. Enquanto houver um par abaixo disso, o teste chumba.
const fs = require('fs');
const vm = require('vm');
const { auditar, auditarParesDeFolha, regrasDe, varsDeTema, corDe, razao } = require('./contraste-lib');
const hexDe = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const shell = fs.readFileSync('index.html', 'utf8');
const HOJE = '2026-10-05';

let falhas = 0;
const check = (ok, msg, extra) => { if (!ok) falhas += 1; console.log(`  ${ok ? 'OK    ' : 'FALHA '}${msg}${extra !== undefined ? '  →  ' + extra : ''}`); };

// ---------------------------------------------------------------- recorte de funções do app
// Mesmo princípio dos outros testes: extrair do arquivo, linha a linha, sem reescrever nada.
const LINHAS = app.split('\n');
function blocoDe(nome) {
  const re = new RegExp('^(\\s*)(?:(?:async )?function ' + nome + '\\s*\\(|((?:const|let|var) ' + nome + '\\s*=))');
  for (let i = 0; i < LINHAS.length; i += 1) {
    const m = re.exec(LINHAS[i]);
    if (!m) continue;
    const recuo = m[1].length;
    const declaracao = Boolean(m[2]);
    for (let k = declaracao ? i : i + 1; k < LINHAS.length; k += 1) {
      const l = LINHAS[k];
      if (!l.trim()) continue;
      if (/^(\s*)/.exec(l)[1].length > recuo) continue;
      const fechaBloco = /^(?:\s*)(?:\}|\};)\s*$/.test(l);
      const fechaDeclaracao = declaracao && /;\s*(?:(?:\/\/|\/\*)[^]*)?$/.test(l);
      if (!fechaBloco && !fechaDeclaracao) continue;
      const fatia = LINHAS.slice(i, k + 1).join('\n');
      try { new Function(fatia); return fatia; } catch (error) { /* fechou cedo demais */ }
    }
    return null;
  }
  return null;
}
// se a peça engoliu declarações alheias (um "}" no mesmo recuo que não compilou na hora
// certa), corta na primeira declaração estranha e fica só com o corpo pedido — sem isso,
// o bloco puxado arrastava o laço de clique do documento e o teste morria antes de renderizar
function aparar(texto, nome) {
  const linhas = texto.split('\n');
  for (let k = 1; k < linhas.length; k += 1) {
    const d = /^(?:async function|function|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(linhas[k]);
    if (d && d[1] !== nome) {
      const corta = linhas.slice(0, k).join('\n');
      try { new Function(corta); return corta; } catch (error) { break; }
    }
  }
  return texto;
}
const trechoDe = nome => { const t = blocoDe(nome); return t ? aparar(t, nome) : null; };

// --------------------------------------------------------------------------- fixture mínima
const membros = [
  { id: 'm1', name: 'Marcos Vieira', ministry: 'Diaconia', phone: '(21) 90000-0001', status: 'active', joinedAt: '2025-02-02', lastAttendedAt: null },
  { id: 'm2', name: 'Ruta Nunes', ministry: 'Louvor', phone: '', status: 'active', joinedAt: null, lastAttendedAt: null },
  { id: 'm3', name: 'Ilan Prado', ministry: 'Membros', phone: '', status: 'inactive', joinedAt: null, lastAttendedAt: null },
];
const visitantes = [
  { name: 'Ana Souza', date: '2026-10-04', status: 'Novo', arrivalType: 'Família', familyMembers: ['Ana', 'Carlos'], service: 'Culto', communicationConsent: true, consent: true, phone: '(21) 98888-0001', neighborhood: 'Centro' },
  { name: 'Bia Lima', date: '2026-10-05', status: 'Retornou', arrivalType: 'Sozinho', familyMembers: ['Bia'], service: 'Culto', communicationConsent: false, consent: false, phone: '', neighborhood: 'Varginha' },
  { name: 'Caio Prado', date: '2026-08-20', status: 'Integrado', arrivalType: 'Casal', familyMembers: ['Caio', 'Deia'], service: 'Culto', communicationConsent: true, consent: true, phone: '', neighborhood: '' },
];
const eventos = [
  { id: 'e1', title: 'Culto de Celebração', date: '2026-10-11', time: '19:00', location: 'Templo', type: 'Culto', status: 'active', recurrenceId: 'rec-1', recurrenceRule: { type: 'weekly-year', weekday: 0, ordinal: 1, ordinais: [1, 3], intervaloSemanas: 1 } },
  { id: 'e2', title: 'Reunião de Líderes', date: '2026-10-15', time: '20:00', location: 'Salão 2', type: 'Reunião', status: 'active', recurrenceId: '', recurrenceRule: {} },
];
const igrejas = [{
  id: 'c1', name: 'Bethesda', slug: 'bethesda', city: 'Itaboraí', phone: '(21) 99999-0000',
  pastors: 'Pr. Evandro Silva\nPra. Simone Silva', description: 'Uma igreja que acolhe com cuidado.',
  initials: 'BE', logoSymbol: 'BE', logoImage: '',
  appearance: { theme: 'dark', font: 'editorial', primary: '#0B0B0C', accent: '#C08A3E' },
  publicSettings: { visible: true, growthGoals: { target: 50, current: 1, milestoneLabel: 'Conhecer pessoas pelo nome e acolher com verdade.' } },
  members: 246, status: 'Ativa', plan: 'cuidado',
}];

function montarCtx(estado, extras = {}, captura = null) {
  // peça-cênica que serve aos DOIS usos de uma vez: o app chama função desconhecida esperando
  // string (`.trim().toLowerCase()`) e esperando lista (`.map().join()`). Um array com os
  // métodos de texto colados dentro satisfaz os dois — e String(array) é '', então o HTML que
  // sai de um pedaço cenário vem vazio em vez de "[object Object]".
  const cenario = [];
  for (const nome of ['trim', 'trimEnd', 'trimStart', 'toLowerCase', 'toUpperCase', 'normalize']) cenario[nome] = () => '';
  for (const nome of ['split', 'match', 'matchAll', 'filter', 'flatMap', 'slice']) cenario[nome] = () => [];
  cenario.includes = () => false;
  cenario.startsWith = () => false;
  cenario.endsWith = () => false;
  cenario.replace = () => cenario;
  cenario.padStart = () => '';
  cenario.charAt = () => '';
  cenario.at = () => undefined;
  const nada = new Proxy(function () { return ''; }, {
    get: (alvo, chave) => (chave === Symbol.toPrimitive ? () => '' : nada),
    apply: () => cenario,
  });
  const ctx = {
    console, state: estado, TODAY: HOJE,
    getActiveChurch: () => igrejas[0], isPlatformAdmin: () => false, canAccessAcolhimento: () => true,
    esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    ICON: nome => `<svg class="icon" data-i="${nome}"></svg>`,
    initials: nome => String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join(''),
    // o que importa aqui é a STRING de HTML que cada render devolve; o DOM é peça-cênica
    // (nada Proxy, não null: as telas chamam $('x').closest(...) e null quebrava antes do HTML sair)
    $: () => nada, $$: () => [], document: { querySelector: () => nada, querySelectorAll: () => [], createElement: () => nada, getElementById: () => nada, body: nada, head: nada, documentElement: {
      style: { setProperty: (chave, valor) => { if (captura) captura[chave] = String(valor); } },
      dataset: captura || {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false } } },
    window: { EMAUS_API_URL: '', location: { pathname: '/Emaus/index.html', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    // `event` é global de handler no navegador; as funções puxadas pelo fecho o citam
    event: { target: { closest: () => null, matches: () => false }, currentTarget: null, preventDefault() {}, stopPropagation() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { pathname: '/Emaus/index.html', search: '' },
    addEventListener() {}, Intl, Date, JSON, Math, Number, String, Boolean, Array, Object, RegExp, Set, Map, Promise, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout() {},
    ...extras,
  };
  return { ctx, nada };
}

// executa a função de render de verdade, puxando o fecho transitivo do app.js
function renderizar(nomeFuncao, estado, opcoes = {}) {
  const EXCLUIDAS = new Set(['esc', 'ICON', 'initials', '$', '$$', 'apiRequest', 'showToast', 'render', 'updateShell', 'applyAppearance', 'applySettingsSection', 'loadRemoteChurchState', 'openModal', 'closeModal', 'saveState', 'navigate']);
  const raiz = new Set();
  const fila = [nomeFuncao, 'engagementStats', 'trendShort', 'trendText', 'activeMemberCount', 'currentGrowthGoals', 'renderGrowthGoalsPanel', 'upcomingEvents', 'statCard', 'iconTone', 'eventStatusClass', 'eventStatusLabel', 'dateDay', 'dateMonth', 'formatDate', 'visitorCountByStatus', 'engagementStats'].concat(opcoes.sementes || []);
  const { ctx, nada } = montarCtx(estado, opcoes.extras || {}, opcoes.captura || null);
  if (opcoes.captura) { EXCLUIDAS.delete('applyAppearance'); }
  while (fila.length) {
    const nome = fila.shift();
    if (raiz.has(nome) || EXCLUIDAS.has(nome)) continue;
    const texto = trechoDe(nome);
    if (!texto) continue;
    raiz.add(nome);
    for (const m of texto.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) fila.push(m[1]);
  }
  // o fecho varre "nome(" e acaba pedindo também variáveis LOCAIS da própria função: se a
  // declaração delas entrasse duas vezes (a de topo + a dentro do corpo) o vm chumbava com
  // "already declared", então peça repetida dentro de outra peça fica de fora
  const pecas = new Map([...raiz].map(nome => [nome, trechoDe(nome)]).filter(([, texto]) => texto));
  const codigoDe = () => {
    const listadas = [...pecas.entries()];
    const vistas = new Set();
    const filtradas = listadas.filter(([nome, texto]) => {
      // (1) declaração do nome já vem dentro de outra peça; (2) a peça inteira é cópia ou
      // pedaço de outra — as duas hipóteses dão "already declared" no vm
      if (listadas.some(([outro, outroTexto]) => outro !== nome && new RegExp('(?:const|let|var|function)\\s+' + nome + '\\b').test(outroTexto))) return false;
      if (listadas.some(([outro, outroTexto]) => outro !== nome && (outroTexto === texto || outroTexto.includes(texto)))) return false;
      if (vistas.has(texto)) return false;
      vistas.add(texto);
      return true;
    });
    return filtradas.map(([, texto]) => texto).join('\n');
  };
  let codigo = codigoDe();
  for (let tentativa = 0; tentativa < 90; tentativa += 1) {
    for (const m of codigo.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) if (!(m[1] in ctx)) ctx[m[1]] = nada;
    vm.createContext(ctx);
    try {
      vm.runInContext(codigo, ctx, { timeout: 20000 });
      if (opcoes.captura) { vm.runInContext(nomeFuncao + '();', ctx, { timeout: 20000 }); return ''; }
      return String(vm.runInContext(nomeFuncao + '();', ctx, { timeout: 20000 }) || '');
    } catch (error) {
      // "X is not a function/defined" → puxa X de verdade; "X already declared" → tira a
      // peça isolada de X (ela veio embutida em outra) e remonta. Sem isso a varredura de
      // fecho fica presa em detalhe do recorte e não no que se quer medir.
      const reusa = String(error.message).match(/Identifier '([A-Za-z_$][\w$]*)' has already been declared/);
      if (reusa && pecas.has(reusa[1])) { pecas.delete(reusa[1]); raiz.delete(reusa[1]); codigo = codigoDe(); continue; }
      const nome = (String(error.message).match(/([A-Za-z_$][\w$]*) is not a function/) || String(error.message).match(/([A-Za-z_$][\w$]*) is not defined/) || [])[1];
      if (nome && !raiz.has(nome) && !EXCLUIDAS.has(nome) && trechoDe(nome)) { raiz.add(nome); pecas.set(nome, trechoDe(nome)); codigo = codigoDe(); continue; }
      if (process.env.CONTRASTE_DEBUG) console.log(error.stack.split('\n').slice(0, 7).join('\n'));
      throw new Error(`${nomeFuncao}: ${error.message}`);
    }
  }
  throw new Error(nomeFuncao + ': não montou');
}


// Quatro leituras por tela: a FOLHA sozinha (o que aparece se o JS de aparência não rodar)
// e a cor EFETIVA da igreja, nos dois temas — applyAppearance é quem decide --gold/--copper
// (--gold-soft, --copper-soft) a partir da ficha da igreja, então o contraste real depende
// dela: uma igreja com acento claro tem de continuar legível.
function varsDaIgreja(tema) {
  const definido = {};
  igrejas[0] = { ...igrejas[0], appearance: { theme: tema, font: 'editorial', primary: '#0B0B0C', accent: '#C08A3E' } };
  renderizar('applyAppearance', estado, {
    captura: definido,
    sementes: ['DEFAULT_APPEARANCE', 'mixHex', 'normalizeHex', 'churchAppearance', 'isPlatformAdmin'],
  });
  igrejas[0] = { ...igrejas[0], appearance: { theme: 'dark', font: 'editorial', primary: '#0B0B0C', accent: '#C08A3E' } };
  return definido;
}

const CONFIGS = [
  { nome: 'folha no claro', tema: '', vars: {} },
  { nome: 'folha no escuro', tema: 'dark', vars: {} },
  { nome: 'igreja no claro', tema: '', vars: null },
  { nome: 'igreja no escuro', tema: 'dark', vars: null },
];

const agrupar = lista => {
  const g = new Map();
  for (const o of lista) {
    const chave = `${o.fundo} ← ${o.cor}   por ${o.ancestral.split(' > ').slice(-2).join(' ')}`;
    const g2 = g.get(chave) || { chave, qtd: 0, pior: 99, exemplos: new Set(), classes: new Set() };
    g2.qtd += 1; g2.pior = Math.min(g2.pior, o.razao); g2.exemplos.add(o.texto.slice(0, 24)); g2.classes.add(o.classes || '(sem classe)');
    g.set(chave, g2);
  }
  return [...g.values()].sort((a, b) => a.pior - b.pior || b.qtd - a.qtd);
};
// --------------------------------------------------------------------- telas e estado fictício
const TELAS = {
  dashboard: 'renderDashboard', acolhimento: 'renderAcolhimento', members: 'renderMembers',
  visitors: 'renderVisitors', pulpit: 'renderPulpit', communication: 'renderCommunication',
  agenda: 'renderAgenda', leaders: 'renderLeaders', settings: 'renderSettings',
};
const estado = {
  activeView: 'dashboard', churches: igrejas, activeChurchId: 'c1',
  visitors: visitantes, members: membros, ministries: [], announcements: [
    { id: 'a1', title: 'Culto de gratidão', body: 'Neste domingo teremos santa ceia.', date: '2026-10-11', audience: 'Todos', pinned: true, tone: 'copper', status: 'publicado', reach: '40 pessoas', channels: ['WhatsApp', 'E-mail'], personalizeGreeting: true },
  ], activity: [
    { id: 'x1', text: 'Ana Souza foi registrada na portaria', initials: 'AS', tone: 'gold', at: '2026-10-04T20:00:00Z' },
  ], events: eventos, leaders: [
    { id: 'l1', name: 'Pr. Evandro Silva', role: 'Pastor', phone: '(21) 90000-0009', status: 'active', ministry: 'Liderança' },
  ], receptionUsers: [{ id: 'r1', name: 'Simone', role: 'Recepção', status: 'active', lastSeen: '2026-10-05' }],
  careTasks: [{ id: 't1', name: 'Visitar Ana', status: 'aberta', due: '2026-10-12' }], attendance: [],
  calendarMonth: '2026-10',
  attendanceSummary: { today: 3, month: 24, members: { total: 3, with_attendance: 2 } },
  growthGoals: igrejas[0].publicSettings.growthGoals,
  currentUser: { name: 'Pr. Evandro Silva', preferredName: 'Evandro', role: 'Pastor da igreja', roleKey: 'church_admin', gender: 'masculine' },
  metrics: { visits: 2, visitsTotal: 4, returns: 2, reach: 3, announcements: 2 },
  settingsSection: 'identidade',
};

console.log('\n===== 1) as telas montam (sem isso o resto seria ventaria no vazio) =====');
const geradas = {};
let montou = 0;
for (const [view, fn] of Object.entries(TELAS)) {
  try { geradas[view] = renderizar(fn, { ...estado, activeView: view }); montou += 1; }
  catch (error) { geradas[view] = ''; console.log('  FALHA ' + error.message); falhas += 1; }
}
if (process.env.CONTRASTE_DUMP) for (const [v, h] of Object.entries(geradas)) fs.writeFileSync('/tmp/contraste-' + v + '.html', h);
check(montou === Object.keys(TELAS).length, 'as 9 telas renderizam com o código real', montou + '/' + Object.keys(TELAS).length + ' · ' + Object.entries(geradas).map(([v, h]) => v + ' ' + h.length).join(' · '));

console.log('\n===== 2) contraste medido em cada tela, nas quatro combinações de tema =====');
const casca = (() => {
  const aside = shell.slice(shell.indexOf('<aside class="sidebar"'), shell.indexOf('</aside>', shell.indexOf('<aside class="sidebar"')) + 8);
  const topo = shell.slice(shell.indexOf('<header class="topbar"'), shell.indexOf('</header>', shell.indexOf('<header class="topbar"')) + 9);
  return (aside + topo)
    .replace(/id="sidebarBrandName">[^<]*</, 'id="sidebarBrandName">Bethesda<')
    .replace(/id="sidebarUserName">[^<]*</, 'id="sidebarUserName">Pr. Evandro<')
    .replace(/id="sidebarUserRole">[^<]*</, 'id="sidebarUserRole">Pastor da igreja<')
    .replace(/id="topbarChurchName">[^<]*</, 'id="topbarChurchName">Bethesda<');
})();

let medidosTotal = 0;
for (const config of CONFIGS) {
  const vars = config.vars === null ? varsDaIgreja(config.tema === 'dark' ? 'dark' : 'light') : config.vars;
  if (process.env.CONTRASTE_VARS) console.log('  vars[' + config.nome + '] = ' + JSON.stringify(vars));
  const todos = [];
  let medidos = 0;
  for (const view of Object.keys(TELAS)) {
    const corpo = geradas[view] || '';
    const html = `<html${config.tema ? ` data-theme="${config.tema}"` : ''}><body><div class="app-shell">${casca}<main class="main-content"><div id="appContent">${corpo}</div></main></div></body></html>`;
    const r = auditar({ html, css, vars, tema: config.tema, rotulo: view });
    todos.push(...r.ofensores.map(o => ({ ...o, tela: view })));
    medidos += r.medidos;
  }
  medidosTotal += medidos;
  const grupos = agrupar(todos);
  console.log(`\n  --- ${config.nome}: ${todos.length} textos abaixo do mínimo, em ${grupos.length} famílias (de ${medidos} medidos; vars da igreja: ${Object.keys(vars).length}) ---`);
  for (const g of grupos.slice(0, 14)) {
    console.log(`   ${String(g.qtd).padStart(3)}×  pior ${String(g.pior).padEnd(5)}  ${g.chave.slice(0, 92)}`);
    console.log(`        classes: ${[...g.classes].slice(0, 5).join(' · ').slice(0, 150)}`);
    console.log(`        textos : ${[...g.exemplos].slice(0, 4).join(' | ').slice(0, 140)}`);
  }
  if (grupos.length > 14) console.log(`   … ${grupos.length - 14} famílias a mais (todas contam para chumbar)`);
  check(todos.length === 0, `${config.nome}: todo texto das 9 telas atinge o mínimo de contraste`, todos.length ? `${todos.length} textos · ${grupos.length} famílias · pior ${grupos[0].pior}:1` : 'nenhum');
}

console.log('\n===== 3) varredura da folha inteira (o que não está nas telas montadas) =====');
const { regras } = regrasDe(css);
const pares = auditarParesDeFolha(css);
const familiasFolha = agrupar(pares);
check(pares.length === 0, 'nenhuma regra da folha chumba texto claro sobre fundo claro (ou escuro sobre escuro)',
  familiasFolha.length ? familiasFolha.slice(0, 12).map(fa => `${fa.qtd}\u00d7  ${fa.chave}   exemplos: ${[...fa.exemplos].slice(0, 3).join(' / ')}`).join('\n          ') : 'nenhum');


// ----- 4) as páginas que não são o painel: portaria, página pública, Administração, splash
// Nelas o CSS vem amarrado na própria página (e boa parte dele nasce de string no JS), então não
// há como injetar variáveis: sobra a varredura chumbo-a-chumbo, que pega justamente o erro mais
// comum nelas — texto claro sobre fundo claro, ou o contrário, porque quem escreveu a folha só
// olhou um dos temas.
console.log('\n===== 4) portaria, página pública, Administração e splash =====');
const OUTRAS = ['splash.css', 'publica.css', 'admin.css', 'recepcao.html', 'index.html', 'publica.html', 'admin.html'];
let outrasFalhas = 0;
for (const arquivo of OUTRAS) {
  const bruto = fs.readFileSync(__dirname + '/' + arquivo, 'utf8');
  const folha = arquivo.endsWith('.html')
    ? (bruto.match(/<style>[\s\S]*?<\/style>/g) || []).map(bloco => bloco.replace(/<\/?style>/g, '')).join('\n')
    : bruto;
  const familias = agrupar(auditarParesDeFolha(folha));
  if (familias.length) outrasFalhas++;
  if (familias.length) console.log('          ' + familias.map(fa => `${fa.qtd}\u00d7  ${fa.pior.toFixed(2)}   ${fa.chave}`).join('\n          '));
  const detalhe = familias.length
    ? familias.map(fa => `${fa.qtd}\u00d7  pior ${fa.pior.toFixed(2)}   ${fa.chave}   exemplos: ${[...fa.exemplos].slice(0, 3).join(' / ')}`).join('\n          ')
    : 'nenhum';
  console.log((familias.length ? '  FALHA ' : '  OK    ') + `${arquivo}: nenhum texto chumbado sem contraste  \u2192  ${detalhe}`);
}

// E além da varredura chumbo-a-chumbo, as duas páginas auto-suficientes vão pelo medidor de
// cascata: o HTML delas é o HTML real do arquivo, com a folha que o navegador carregaria.
const PAGES = [
  { rotulo: 'página pública', html: 'publica.html', css: ['publica.css', 'splash.css'], vars: {} },
  { rotulo: 'portaria', html: 'recepcao.html', css: ['splash.css'], vars: {} },
];
let paginasFalhas = 0;
for (const pagina of PAGES) {
  const bruto = fs.readFileSync(__dirname + '/' + pagina.html, 'utf8');
  const embutido = (bruto.match(/<style>[\s\S]*?<\/style>/g) || []).map(bloco => bloco.replace(/<\/?style>/g, '')).join('\n');
  const css = pagina.css.map(nome => fs.readFileSync(__dirname + '/' + nome, 'utf8')).join('\n') + '\n' + embutido;
  const tema = '';
  const resultado = auditar({ html: bruto, css, vars: pagina.vars, tema, rotulo: pagina.rotulo,
    claro: varsDeTema(regrasDe(css).regras, 'light'), escuro: varsDeTema(regrasDe(css).regras, 'dark') });
  if (process.env.CONTRASTE_PAGINAS) console.log(pagina.rotulo + ' :: ' + JSON.stringify(resultado.ofensores.map(o => ({ sel: o.por, cor: o.cor, fundo: o.fundo, r: o.razao, t: (o.texto || '(marcador)').slice(0, 40) }))));
  const familias = agrupar(resultado.ofensores);
  paginasFalhas += familias.length ? 1 : 0;
  const detalhe = familias.length
    ? familias.map(fa => `${fa.qtd}\u00d7  pior ${fa.pior.toFixed(2)}   ${fa.chave}   exemplos: ${[...fa.exemplos].slice(0, 3).join(' / ')}`).join('\n          ')
    : `nenhum dos ${resultado.medidos}`;
  console.log((familias.length ? '  FALHA ' : '  OK    ') + `${pagina.rotulo}: texto da pr\u00e1gina medido na cascata  \u2192  ${detalhe}`);
}


// ----- 5) as tintas neutras das folhas avulsas sobre as superfícies que elas mesmas criam
// O medidor de cascata só vê o HTML estático do arquivo; o que o JS injeta depois (listas,
// cartões, tabelas do Admin) não aparece lá. Estas três variáveis são o que quase todo texto
// miúdo herda — se elas passam sobre cada superfície da folha, o resto do conteúdo passa junto.
console.log('\n===== 5) tintas neutras × superfícies de cada folha avulsa =====');
const NEUTRAS = { 'admin.css': ['--ink', '--muted', '--muted-2'], 'recepcao.html': ['--ink', '--muted', '--muted-2'], 'publica.css': ['--ink', '--muted'] };
let tintasFalhas = 0;
for (const [arquivo, chaves] of Object.entries(NEUTRAS)) {
  const bruto = fs.readFileSync(__dirname + '/' + arquivo, 'utf8');
  const folha = arquivo.endsWith('.html')
    ? (bruto.match(/<style>[\s\S]*?<\/style>/g) || []).map(bloco => bloco.replace(/<\/?style>/g, '')).join('\n')
    : bruto;
  const { regras } = regrasDe(folha);
  const vars = varsDeTema(regras, 'light');
  const superficies = new Set();
  for (const { decls } of regras) {
    const bruto2 = decls['background-color'] || decls.background;
    if (!bruto2 || /gradient|url\(/i.test(bruto2)) continue;
    for (const parte of bruto2.split(',')) {
      const c = corDe(parte.trim().replace(/^\s*var\((--[\w-]+)\)\s*$/, (_, n) => vars[n] || ''));
      if (!c) continue;
      // só as superfícies NEUTRAS (papel, carta, painel): dourado, verde e vermelho de botão
      // são fundos para tinta escura — medir --ink contra eles seria denunciar o que está certo
      if (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 26) continue;
      superficies.add(hexDe(c));
    }
  }
  const piores = [];
  for (const chave of chaves) {
    const tinta = corDe(vars[chave]);
    if (!tinta) { piores.push(`${chave}: não resolvido`); continue; }
    let pior = 99; let onde = '';
    for (const fundo of superficies) {
      const r = razao(tinta, corDe(fundo));
      if (r < pior) { pior = r; onde = fundo; }
    }
    if (pior < 4.5) piores.push(`${chave} ${hexDe(tinta)} sobre ${onde}: ${pior.toFixed(2)}`);
  }
  tintasFalhas += piores.length ? 1 : 0;
  console.log((piores.length ? '  FALHA ' : '  OK    ') + `${arquivo}: ${chaves.join(', ')} legíveis sobre as ${superficies.size} superfícies da folha  →  ${piores.length ? piores.join(' · ') : 'nenhuma queixa'}`);
}

console.log('\n=============================');
if (outrasFalhas) console.log(`FALHAS nas páginas avulsas: ${outrasFalhas} arquivo(s) com texto chumbado.`);
if (falhas || outrasFalhas || paginasFalhas || tintasFalhas) { console.log(`${falhas + outrasFalhas + paginasFalhas + tintasFalhas} FALHA(S)`); process.exitCode = 1; }
else console.log('TODOS os testes passaram — contraste medido com a cascata, não no olho.');
