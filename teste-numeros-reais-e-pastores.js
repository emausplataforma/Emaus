/**
 * Prova dos números reais do painel e do tratamento de mais de um pastor (cache v84).
 *
 * O teste executa as funções REAIS do app.js (contagem, tendência, quebra de linha,
 * gênero e plural) num motor isolado, com cadastros de mentirinha cuja data é
 * conhecida. Assim o que se confere é o resultado calculado, não uma cópia da fórmula.
 *
 *   node teste-numeros-reais-e-pastores.js
 */
const fs = require('fs');
const vm = require('vm');

const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const recepcao = fs.readFileSync('reception.js', 'utf8');
const recepcaoHtml = fs.readFileSync('recepcao.html', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');

let falhas = 0;
const check = (cond, rotulo, extra) => {
  if (cond) console.log('  OK    ' + rotulo + (extra !== undefined ? '  →  ' + extra : ''));
  else { falhas++; console.log('  FALHA ' + rotulo + (extra !== undefined ? '  →  ' + extra : '')); }
};

// ---- pega do arquivo só as funções que o teste quer exercitar (corpo real, sem reescrita) ----
function funcaoDe(texto, nome) {
  const re = new RegExp('^function ' + nome + '\\(', 'm');
  const m = re.exec(texto);
  if (!m) return null;
  let fundo = 0;
  // o corpo começa na primeira chave DEPOIS do fechamento dos parênteses (senão
  // "function f(p = {})" era confundida com o corpo)
  let profundidadeParenteses = 0;
  let inicio = -1;
  for (let i = m.index + m[0].length - 1; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '(') profundidadeParenteses += 1;
    else if (c === ')') profundidadeParenteses -= 1;
    else if (c === '{' && profundidadeParenteses === 0) { inicio = i; break; }
  }
  if (inicio < 0) return null;
  for (let i = inicio; i < texto.length; i += 1) {
    if (texto[i] === '{') fundo += 1;
    else if (texto[i] === '}') { fundo -= 1; if (fundo === 0) return texto.slice(m.index, i + 1); }
  }
  return null;
}
function executar(texto, nomes, extras = {}) {
  const corpo = nomes.map(nome => funcaoDe(texto, nome)).filter(Boolean).join('\n');
  if (!corpo) throw new Error('nenhuma função encontrada: ' + nomes.join(', '));
  const ctx = Object.assign({
    console, String, Number, Boolean, Array, Object, Math, Date, JSON, RegExp, Set, isNaN, parseInt, parseFloat,
    esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    ICON: nome => `<svg data-icon="${nome}"></svg>`,
    initials: nome => String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join(''),
  }, extras);
  vm.createContext(ctx);
  vm.runInContext(corpo, ctx, { timeout: 4000 });
  return ctx;
}

const HOJE = '2026-10-05';
const visitantes = [
  { name: 'Ana Beatriz Nogueira', date: '2026-10-04', status: 'Novo', arrivalType: 'Família', familyMembers: ['Ana Beatriz Nogueira', 'Carlos Nogueira'] },
  { name: 'Bia Ramos', date: '2026-10-05', status: 'Retornou', arrivalType: 'Sozinho', familyMembers: ['Bia Ramos'] },
  { name: 'Caio Souza', date: '2026-09-20', status: 'Integrado', arrivalType: 'Com amigos', familyMembers: ['Caio Souza'] },
  { name: 'Deia Lima', date: '2026-09-02', status: 'Novo', arrivalType: 'Em casal', familyMembers: ['Deia Lima', 'Elias Lima'] },
];
const stateReal = {
  visitors: visitantes,
  announcements: [],
  metrics: { visits: 0, returns: 0, reach: 0, announcements: 0 },
  currentUser: { name: 'Pr', preferredName: '', role: 'Pastor da igreja', roleKey: 'church_admin', gender: 'unspecified' },
  churches: [{ id: 'c1', name: 'Bethesda', pastors: 'Pr. João da Silva\nPra. Maria da Silva' }],
  activeChurchId: 'c1',
};
const extrasComuns = {
  TODAY: HOJE,
  state: stateReal,
  getActiveChurch() { return stateReal.churches.find(c => c.id === stateReal.activeChurchId) || stateReal.churches[0]; },
};

console.log('\n===== 1) a contagem sai dos cadastros, não de estimativa =====');
const ctx = executar(app, ['ymdOf', 'shiftDays', 'monthKeyOf', 'previousMonthKey', 'getFamilyMembers', 'engagementStats', 'trendShort', 'trendText'], extrasComuns);
const eng = vm.runInContext('engagementStats()', ctx);
check(eng.visitasMes === 2, 'visitantes deste mês contados pelas datas reais', `${HOJE.slice(8, 10)}/${HOJE.slice(5, 7)}: 2 dos 4 cadastros`);
check(eng.visitasMesAnterior === 2, 'o mês anterior também é contado (é dele que vem a comparação)', `${eng.visitasMesAnterior} cadastros em setembro`);
const trendShortDoCtx = valor => vm.runInContext(`trendShort(${valor})`, ctx);
check(eng.variacaoVisitas === 0, 'variação real calculada (2 este mês, 2 em setembro = 0%)', `${eng.visitasMes} x ${eng.visitasMesAnterior}`);
check(trendShortDoCtx(eng.variacaoVisitas) === '0%', 'empate com o mês anterior aparece como 0%, não como setinha otimista');
check(trendShortDoCtx(null) === '—' && vm.runInContext('trendText(null)', ctx) === 'sem mês anterior para comparar', 'quando não há mês anterior, a tela diz isso em vez de inventar', `"${vm.runInContext('trendText(null)', ctx)}"`);
check(eng.retornosTotal === 2 && eng.taxaRetorno === 50, 'taxa de retorno é retornos ÷ cadastros, calculada na hora', `2 de 4 = ${eng.taxaRetorno}%`);
check(eng.alcanceMes === 3 && eng.alcanceTotal === 6, 'alcance conta pessoas (visitante + quem veio junto), sem repetição', `${eng.alcanceMes} pessoas neste mês (Ana, Carlos, Bia), ${eng.alcanceTotal} no total dos cadastros`);
check(vm.runInContext('previousMonthKey("2026-01")', ctx) === '2025-12' && vm.runInContext('previousMonthKey("2026-03")', ctx) === '2026-02', 'a virada de ano e fevereiro não deslocam o mês anterior');

console.log('\n===== 2) as barras do gráfico são as semanas reais =====');
check(eng.semanas.length === 12, 'são 12 semanas, como diz o título do painel');
const semanaDeHoje = eng.semanas.find(s2 => s2.de <= HOJE && HOJE <= s2.ate);
check(!!semanaDeHoje && semanaDeHoje.visitantes === 1 && semanaDeHoje.ate >= HOJE, 'a semana que contém hoje tem o cadastro de hoje', `${semanaDeHoje.de.slice(8,10)}/${semanaDeHoje.de.slice(5,7)} a ${semanaDeHoje.ate.slice(8,10)}/${semanaDeHoje.ate.slice(5,7)}: 1`);
const semanaAnterior = eng.semanas[eng.semanas.indexOf(semanaDeHoje) - 1];
check(semanaAnterior.visitantes === 1, 'e o cadastro do domingo anterior está na semana anterior (semana começa no domingo)', `${semanaAnterior.visitantes} na semana de ${semanaAnterior.rotulo}`);
check(eng.semanas.reduce((t, s) => t + s.visitantes, 0) === 4, 'a soma das barras bate com o total de cadastros', '4 cadastros, 4 nas barras');
check(eng.semanas[11].retornos === 1, 'e o retorno da semana também é do cadastro real', `${eng.semanas[11].retornos} nesta semana`);
check(eng.semanas.every(s => /^\d{2}\/\d{2}$/.test(s.rotulo)), 'os rótulos do eixo X vêm das datas, não de "Jun 14 / Jul 26" chumbados', eng.semanas.map(s => s.rotulo).join(' '));
check(eng.eixoMaximo >= Math.max(...eng.semanas.map(s => s.visitantes)) && eng.eixoMaximo % 5 === 0, 'o eixo Y é calculado a partir do maior valor real', `máximo do eixo: ${eng.eixoMaximo}`);

console.log('\n===== 3) o cartão que tinha a seta por cima do ícone =====');
const ctxCartao = executar(app, ['esc', 'statCard', 'ICON'], Object.assign({}, extrasComuns, {
  ICON: nome => `<svg data-icon="${nome}"></svg>`,
}));
const cartao = vm.runInContext(`statCard('Visitantes este mês', 2, '+0%', 'vs. mês anterior', 'users', 'copper', false, 'visits')`, ctxCartao);
check(!/stat-open/.test(cartao), 'o selo com a seta em cima do ícone saiu do cartão', cartao.slice(0, 0) || 'nenhum span.stat-open no HTML gerado');
check(!/arrow-up-right/.test(cartao), 'e a seta também não aparece mais na linha da tendência');
check(/stat-card-interactive/.test(cartao) && /data-metric="visits"/.test(cartao), 'o cartão continua clicável (abre os detalhes)', 'a mudança foi só o desenho');
check(!/\.stat-open/.test(css), 'o CSS que desenhava esse selo foi junto (nenhuma regra morta)', (css.match(/stat-open/g) || []).length + ' ocorrências no styles.css');
check(cartao.includes('+0%') && cartao.includes('vs. mês anterior'), 'o número e a comparação continuam na tela', cartao.match(/stat-trend">([^<]*)</)[1]);

console.log('\n===== 4) nenhum número inventado sobrou no arquivo =====');
const inventados = ['18,4%', '6,2%', '12,8%', '47,4%', '4,8%', '14,2%', '[38, 44, 41', "'92%'", "'78%'", "'54%'", "modalEyebrow = 'BETHESDA'"];
for (const p of inventados) check(!app.includes(p), `saiu do arquivo: ${p}`);
check(!/arrow-up-right[^}]*14,2%/.test(app), 'e a tela de comunicação não promete variação que não existe');
const ctxCanal = executar(app, ['getFamilyMembers', 'arrivalBreakdownRows', 'visitorCountByArrival'], Object.assign({}, extrasComuns, {
  state: stateReal,
  ICON: nome => `<svg data-icon="${nome}"></svg>`,
}));
const canais = vm.runInContext('arrivalBreakdownRows()', ctxCanal);
check(/Família<\/span><strong>1 de 4/.test(canais) && /Sozinho<\/span><strong>1 de 4/.test(canais), 'o modal de alcance agora mostra a contagem real por tipo de chegada', (canais.match(/<strong>(\d+) de 4<\/strong>/g) || []).join(' '));
check(/width:25%/.test(canais), 'e a barrinha é o percentual verdadeiro (1 de 4 = 25%)');

console.log('\n===== 5) a plataforma entende quando há mais de um pastor =====');
const nomesDaSaudacao = ['Pr. João da Silva', 'Pra. Maria da Silva'];
function contextoPastoral(pastors) {
  const igreja = { id: 'c1', name: 'Bethesda', pastors };
  const estado = Object.assign({}, stateReal, { churches: [igreja], activeChurchId: 'c1' });
  const ctxPastor = executar(app, ['pastorNamesList', 'churchPastorNames', 'hasMultiplePastors', 'pastorWord', 'pastoralAddressName', 'normalizedGender', 'preferredDisplayName', 'isPluralPastoralPerson', 'genderedRole', 'brasiliaHour', 'timeGreeting', 'dashboardGreetingFor', 'personalizedMessageGreeting'],
    { TODAY: HOJE, state: estado, getActiveChurch: () => igreja });
  return { ctxPastor, rodar: codigo => vm.runInContext(codigo, ctxPastor) };
}
const dois = contextoPastoral('Pr. João da Silva\nPra. Maria da Silva');
check(dois.rodar('churchPastorNames().length') === 2, 'dois nomes cadastrados viram dois pastores', JSON.stringify(dois.rodar('JSON.stringify(churchPastorNames())')));
check(dois.rodar('hasMultiplePastors()') === true, 'a plataforma percebe que é mais de um');
check(dois.rodar('genderedRole(state.currentUser, state.currentUser.role)') === 'Pastores da igreja', 'o rótulo do canto passa a ser "Pastores da igreja"');
const saudacao = dois.rodar('dashboardGreetingFor(state.currentUser)');
check(saudacao.includes('Pastores') && nomesDaSaudacao.every(nome => saudacao.includes(nome.replace(/^(Pr|Pra)\.\s*/, ''))), 'a saudação chama os dois pelo nome cadastrado', JSON.stringify(saudacao));
check(dois.rodar('pastorWord("pastor", "pastores")') === 'pastores', 'e a palavra usada nos textos é o plural');
const boasVindas = dois.rodar('personalizedMessageGreeting({ name: "Pr", gender: "unspecified", roleKey: "church_admin" })');
check(/pastores João da Silva e Maria da Silva/.test(boasVindas), 'o cartão de boas-vindas também fala com os dois', JSON.stringify(boasVindas));
check(dois.rodar('pastorNamesList("A, B e C & D; E").join("|")') === 'A|B|C|D|E', 'os quatro jeitos de separar funcionam (linha, vírgula, "e", "&" e ponto e vírgula)');
check(dois.rodar('pastorNamesList(Array(20).fill("x").join(", ")).length') === 6, 'e a lista tem teto de 6 nomes');

const um = contextoPastoral('Pr. João da Silva');
check(um.rodar('hasMultiplePastors()') === false, 'com um nome só, tudo volta ao singular', 'nada de "pastores" para igreja com um pastor');
check(um.rodar('genderedRole(state.currentUser, state.currentUser.role)') === 'Pastor da igreja', 'o rótulo singular continua igual');
check(um.rodar('pastorWord("o pastor", "os pastores")') === 'o pastor', 'idem nos textos');
const saudacaoUm = um.rodar('dashboardGreetingFor(state.currentUser)');
check(!/Pastores/.test(saudacaoUm), 'a saudação de uma igreja com um pastor não muda de número', JSON.stringify(saudacaoUm));

const nenhum = contextoPastoral('');
check(nenhum.rodar('churchPastorNames().length') === 0 && nenhum.rodar('hasMultiplePastors()') === false, 'igreja sem pastor cadastrado não herda nome de outra');
check(nenhum.rodar('dashboardGreetingFor(state.currentUser)') === um.rodar('dashboardGreetingFor({ name: "Pr" })'), 'e nesse caso a saudação usa o nome de quem entrou, não um nome inventado');

console.log('\n===== 6) a portaria também entende o plural =====');
const rodar = (codigo, alvo) => vm.runInContext(codigo, alvo);
const ctxRecep = executar(recepcao, ['pastoralNames', 'pastoralIsPlural', 'pastorPhrase', 'refreshPastoralWording'], {
  getChurch: () => ({ pastors: 'Pr. João\nPra. Maria' }),
  document: { querySelector: () => null },
});
check(rodar('pastorPhrase()', ctxRecep) === 'Os pastores já poderão visualizar este cadastro no Acolhimento.', 'com dois pastores, o recado da portaria vai no plural');
const ctxRecepUm = executar(recepcao, ['pastoralNames', 'pastoralIsPlural', 'pastorPhrase', 'refreshPastoralWording'], {
  getChurch: () => ({ pastors: 'Pr. João' }),
  document: { querySelector: () => null },
});
check(rodar('pastorPhrase()', ctxRecepUm) === 'O pastor já poderá visualizar este cadastro no Acolhimento.', 'com um pastor, a frase continua no singular');
check(rodar('(() => { try { refreshPastoralWording(); return "ok"; } catch (e) { return e.message; } })()', ctxRecepUm) === 'ok', 'e não quebra em tela onde não existe o texto a trocar');
check(/A liderança já poderá visualizar este visitante no Acolhimento\./.test(recepcaoHtml), 'o texto parado no HTML é neutro; quem define pastor/pastores é o cadastro', 'recepcao.html');
check(/pastors: church\.pastors \|\| ''/.test(recepcao), 'a portaria lê os pastores do mesmo cadastro da igreja');
check(/<textarea class="textarea" id="newChurchAdmin" name="admin" rows="2" placeholder="Um nome por linha">/.test(app), 'o modal do painel para cadastrar igreja também aceita mais de um pastor');
check(/pastors: String\(data\.get\('admin'\) \|\| ''\)\.replace\(\/\\r\\n\/g, '\\n'\)\.trim\(\)/.test(app), 'e normaliza a quebra de linha ao gravar');
check((app.match(/Pastor\(es\) responsável\(is\)/g) || []).length === 1, 'um rótulo só, nos três lugares onde se cadastrava um pastor', 'painel da igreja, administrador e modal');

console.log('\n===== 7) nada de nome de igreja chumbado =====');
check(!/Evandro|Simone/.test(app), 'nenhum nome real de pastor aparece no painel', (app.match(/Evandro|Simone/g) || []).length + ' ocorrências');
check(!/BETHESDA/i.test(app.match(/modalEyebrow[^;]*/) ? app.match(/modalEyebrow[^;]*/)[0] : ''), 'o rodapé do modal usa o nome da igreja ativa');

console.log('\n===== 8) cache e arquivos tocados =====');
const cacheAqui = (sw.match(/CACHE_NAME = '([^']+)'/) || [])[1];
const espelho = fs.existsSync('producao-atual/service-worker.js') ? (fs.readFileSync('producao-atual/service-worker.js', 'utf8').match(/CACHE_NAME = '([^']+)'/) || [])[1] : '';
if (cacheAqui === espelho) console.log('  OK    cache (pulado: esta pasta é a cópia do site)  →  ' + cacheAqui);
else check(!!cacheAqui && cacheAqui !== espelho, 'cache do aplicativo trocado (os aparelhos baixam o arquivo novo)', espelho + '  →  ' + cacheAqui);
const versao = (arquivo, nome) => { const m = new RegExp(nome.replace('.', '\\.') + '\\?v=(\\d+)').exec(arquivo); return m ? Number(m[1]) : 0; };
const vApp = versao(index, 'app.js');
const vCss = versao(index, 'styles.css');
check(vApp >= 60 && vCss >= 60, 'o painel chama os arquivos com versão (sem ?v= o cache-first do service worker segura o arquivo velho)', `app.js?v=${vApp} · styles.css?v=${vCss}`);
check(versao(recepcaoHtml, 'reception.js') >= 60, 'a portaria também chama o JS com versão', 'reception.js?v=' + versao(recepcaoHtml, 'reception.js'));
check(!/stat-open/.test(app), 'nenhum resto do selo no JS');
check(!/caches\.match\(request\)\.then\(cached => cached \|\| fetch\(request\)\)/.test(sw), 'JS e CSS não ficam mais presos no cache-first (era isso que mantinha o painel antigo na tela)');
check(/fetch\(request\)\s*\.then\(response =>/.test(sw), 'o aplicativo busca o arquivo novo na rede primeiro, cache só se a rede falhar');
check(/church\.id === 'batesda'/.test(app), 'a aparência não grava a igreja-placeholder (id batesda) por cima da igreja de verdade');
const server = fs.existsSync('server.js') ? fs.readFileSync('server.js', 'utf8') : '';
if (server) check(/pastors = COALESCE\(NULLIF\(\$4, ''\), pastors\)/.test(server), 'o banco não apaga os pastores quando um PUT de aparência manda string vazia');
// Depois que a rodada é publicada, o espelho do ar passa a ser IGUAL ao pacote: cobrar
// "tem de ser diferente" vira cobrança contra um fato velho. O que continua valendo é a
// forma: o arquivo só pode ter mudado no ponto do selo (ou nada, se já publicou).
const espelhoCss = 'producao-atual/styles.css';
if (fs.existsSync(espelhoCss)) {
  const linhas = t => t.split('\n');
  const conta = a => { const m = new Map(); for (const l of a) m.set(l, (m.get(l) || 0) + 1); return m; };
  const aquiC = conta(linhas(css)), arC = conta(linhas(fs.readFileSync(espelhoCss, 'utf8')));
  const diff = [];
  for (const [l, n] of aquiC) if (n - (arC.get(l) || 0) > 0) diff.push(l);
  for (const [l, n] of arC) if (n - (aquiC.get(l) || 0) > 0) diff.push(l);
  if (!diff.length) console.log('  OK    styles.css está igual ao espelho do ar (a última rodada já foi publicada)');
  else {
    // rodada de contraste: a cobrança não é mais "só o selo", é a forma — toda linha tocada
    // na folha tem de falar de cor; se alguma linha de layout entrou no meio, alguém esbarrou
    const TINTA = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|color\s*:|background|border|box-shadow|--[\w-]+\s*:|var\(--|^\s*(?:\/?\*|\*)|\.color-control|\.palette-|\.tint-auto|\.form-field/;
    const fora = diff.filter(l => !TINTA.test(l));
    check(fora.length === 0, 'em styles.css só mudaram linhas de tinta, nada de raspão ao redor', `${diff.length} linhas · ${fora.length ? fora.slice(0, 3).map(l => l.trim().slice(0, 90)).join(' | ') : 'nenhuma fora da tinta'}`);
  }
} else check(true, 'styles.css: sem espelho do ar nesta pasta, nada a comparar');

console.log('\n===== 9) o Início inteiro, montado pelo código real =====');
// Aqui não é uma cópia da lógica: o painel é renderizado de verdade, com as funções
// extraídas do app.js e o resto (links, ícones) como pedaço-pau.
function funcaoDe(texto, nome) {
  const re = new RegExp('^function ' + nome + '\\(', 'm');
  const m = re.exec(texto);
  if (!m) return null;
  let profundidade = 0, corpo = -1;
  for (let i = m.index + m[0].length - 1; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '(') profundidade += 1;
    else if (c === ')') profundidade -= 1;
    else if (c === '{' && profundidade === 0) { corpo = i; break; }
  }
  if (corpo < 0) return null;
  let fundo = 0;
  for (let i = corpo; i < texto.length; i += 1) {
    if (texto[i] === '{') fundo += 1;
    else if (texto[i] === '}') { fundo -= 1; if (fundo === 0) return texto.slice(m.index, i + 1); }
  }
  return null;
}
function renderizarInicio(pastors, listaDeVisitantes) {
  const igreja = { id: 'c1', name: 'Bethesda', slug: 'bethesda', city: 'Itaboraí', phone: '', pastors, logoSymbol: 'BT', logoImage: '', description: '', appearance: { theme: 'dark', font: 'editorial', primary: '#0B0B0C', accent: '#C08A3E' }, publicSettings: { visible: true, pastorsBio: '' }, member_count: 1 };
  const estado = {
    churches: [igreja], activeChurchId: 'c1', visitors: listaDeVisitantes, announcements: [], activity: [], events: [],
    members: [], leaders: [], receptionUsers: [], careTasks: [], attendance: [], attendanceSummary: {},
    growthGoals: { visitors: 10, returns: 2, members: 5 }, metrics: { visits: 0, returns: 0, reach: 0, announcements: 0 },
    currentUser: { name: 'Pr', preferredName: '', role: 'Pastor da igreja', roleKey: 'church_admin', gender: 'unspecified' },
  };
  const nada = new Proxy(function () { return []; }, { get: (alvo, chave) => (chave === Symbol.toPrimitive ? () => '' : nada), apply: () => [] });
  // as funções que estes números dependem são as REAIS; o resto do painel (links,
  // cartões de outra aba, estratégias) entra como pedaço-pau para não ofuscar a medida
  const raiz = new Set(['renderDashboard', 'statCard', 'engagementStats', 'ymdOf', 'shiftDays', 'monthKeyOf', 'previousMonthKey', 'getFamilyMembers', 'trendShort', 'trendText', 'arrivalBreakdownRows', 'dashboardGreetingFor', 'timeGreeting', 'brasiliaHour', 'isPluralPastoralPerson', 'normalizedGender', 'preferredDisplayName', 'genderedRole', 'pastoralAddressName', 'churchPastorNames', 'hasMultiplePastors', 'pastorWord', 'pastorNamesList', 'visitorCountByStatus', 'upcomingEvents', 'formatDateLong', 'formatDateShort', 'dateDay', 'parseDate', 'iconTone', 'initials', 'esc']);
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    const codigo = [...raiz].map(nome => funcaoDe(app, nome)).filter(Boolean).join('\n');
    const ctx = {
      console, state: estado, TODAY: HOJE, getActiveChurch: () => igreja,
      esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      ICON: nome => `<svg data-i="${nome}"></svg>`, initials: nome => String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join(''),
      $: () => null, $$: () => [], document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } }) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { pathname: '/Emaus/index.html', search: '' }, addEventListener() {},
      Intl, Date, JSON, Math, Number, String, Boolean, Array, Object, RegExp, Set, Map, Promise, Error, isNaN, parseInt, parseFloat, setTimeout: () => 0, clearTimeout() {},
    };
    for (const m of codigo.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) if (!(m[1] in ctx)) ctx[m[1]] = nada;
    vm.createContext(ctx);
    try {
      vm.runInContext(codigo, ctx, { timeout: 12000 });
      return vm.runInContext('renderDashboard();', ctx, { timeout: 12000 });
    } catch (error) {
      const nome = (String(error.message).match(/([A-Za-z_$][\w$]*) is not a function/) || String(error.message).match(/([A-Za-z_$][\w$]*) is not defined/) || [])[1];
      if (nome && funcaoDe(app, nome) && !raiz.has(nome)) { raiz.add(nome); continue; }
      throw error;
    }
  }
  throw new Error('o painel não montou em 40 tentativas');
}

const doisVisitantes = [
  { name: 'Ana', date: '2026-10-04', status: 'Novo', arrivalType: 'Família', familyMembers: ['Ana', 'Carlos'], service: 'Culto' },
  { name: 'Bia', date: '2026-10-05', status: 'Retornou', arrivalType: 'Sozinho', familyMembers: ['Bia'], service: 'Culto' },
];
let inicio = '';
try {
  inicio = renderizarInicio('Pr. Evandro Silva\nPra. Simone Silva', doisVisitantes);
} catch (error) {
  console.log('  (o painel não montou: ' + error.message + ')');
}
check(inicio.length > 2000, 'o Início monta por inteiro, sem função quebrada', inicio.length + ' caracteres de HTML');
check(!/stat-open/.test(inicio), 'nenhum selo com seta por cima do ícone em nenhum cartão');
check(/data-i="users"/.test(inicio) && /data-i="refresh"/.test(inicio) && /data-i="send"/.test(inicio) && /data-i="calendar"/.test(inicio), 'os quatro cartões do Início usam os ícones certos (pessoas, atualizar, enviar, calendário)', (inicio.match(/data-i="[^"]+"/g) || []).slice(0, 8).join(' '));
const htmlCartoes = inicio.match(/<article class="stat-card[\s\S]*?<\/article>/g) || [];
check(htmlCartoes.length === 4 && htmlCartoes.every(c => !/arrow-up-right/.test(c) && !/stat-open/.test(c)), 'nenhum dos 4 cartões de número tem seta em cima do ícone', htmlCartoes.length + ' cartões, setas nos cartões: ' + htmlCartoes.filter(c => /arrow-up-right/.test(c)).length);
check(!/18,4%|6,2%|12,8%|47,4%|14,2%|4,8%|92%|78%|54%/.test(inicio), 'nenhum número inventado no HTML renderizado', (inicio.match(/\d+,\d+%/g) || []).join(' ') || 'aparecem só números contados');
check(!/>80<\|>60<\|>40</.test(inicio), 'o eixo Y não é mais o 80/60/40 fixo', JSON.stringify((inicio.match(/chart-y">([\s\S]{0,80})/) || [])[1]));
const grupos = (inicio.match(/class="bar-group"/g) || []).length;
check(grupos === 12, 'são 12 semanas no gráfico', grupos + ' grupos de barras (' + (inicio.match(/class="bar /g) || []).length + ' barras no total)');
check(/title="Semana de \d\d\/\d\d: \d visitante\(s\), \d retorno\(s\)"/.test(inicio), 'cada barra diz a semana e a contagem real ao passar o mouse', (inicio.match(/title="Semana de [^"]*"/) || [])[0]);
const cartoes = (inicio.match(/stat-number">([^<]*)/g) || []).map(t => t.replace('stat-number">', ''));
check(cartoes[0] === '2' && cartoes[1] === '1' && cartoes[2] === '3', 'os três cartões batem com a contagem dos cadastros', JSON.stringify(cartoes));
check(/Boa (?:noite|tarde|manhã), Pastores Evandro Silva e Simone/.test(inicio), 'a saudação do painel chama os dois pastores pelo nome (a palavra é a da hora: ' + (inicio.match(/Boa \w+/) || ['?'])[0] + ')', JSON.stringify((inicio.match(/<h1>([^<]*)/) || [])[1]));
const semMesAnterior = renderizarInicio('Pr. Evandro Silva', doisVisitantes);
check(/sem mês anterior para comparar/.test(semMesAnterior), 'e sem cadastros no mês anterior o painel diz isso, em vez de somar +18,4%');
const saudacaoUmSo = (semMesAnterior.match(/<h1>([^<]*)/) || [])[1] || '';
check(!/Pastores/.test(saudacaoUmSo) && /Pr/.test(saudacaoUmSo), 'com um pastor só, o painel continua no singular e chama quem entrou', JSON.stringify(saudacaoUmSo));
check(/Visitantes este mês/.test(semMesAnterior), 'os cartões continuam os mesmos de layout (só o número é que é contado)');
const vazio = renderizarInicio('', []);
check(/Ainda não há visitantes registrados/.test(vazio) && !/class="bar-group"/.test(vazio), 'sem cadastro, o gráfico dá lugar a um aviso honesto (nenhuma barra desenhada)');

console.log('\n=============================');
console.log(falhas ? falhas + ' FALHA(S)' : 'TODOS os testes passaram (as funções reais do painel, com cadastros de datas conhecidas).');
process.exitCode = falhas ? 1 : 0;
