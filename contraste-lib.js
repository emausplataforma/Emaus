// contraste-lib.js — auditor de contraste (WCAG 2.1) que resolve a cascata de verdade.
//
// Por que isto existe: o app tem tema claro e escuro e algumas cartas chumbam um fundo
// creme (#fffaf0) dentro do tema escuro, héritando `color: var(--ink)` — que no escuro é
// quase branco. O texto fica invisível e nenhum teste de "o HTML tem a classe X" percebe.
// Este arquivo monta a árvore do HTML gerado pelas funções reais do painel, aplica a
// cascata (especificidade, variáveis, herança de cor, alpha, gradiente, opacity) e mede a
// razão de contraste de CADA nó de texto. Sem reescrever a lógica da tela: o que se mede é
// o CSS aplicado ao HTML que o app produz.
//
// Uso: const { auditar } = require('./contraste-lib'); auditar({ html, css, vars })
//      → { ofensores: [...], medidos: N, ignorados: {...} }

// ----------------------------------------------------------------------------- cores
const NOMES = {
  white: '#ffffff', black: '#000000', red: '#ff0000', transparent: 'rgba(0,0,0,0)',
  currentcolor: null, inherit: null, initial: null, unset: null,
};

function hexParaRgba(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}

// aceita #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() com vírgula ou barra, e nomes
function corDe(texto) {
  const s = String(texto || '').trim();
  if (!s) return null;
  if (s[0] === '#') return hexParaRgba(s);
  const m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (m) {
    const partes = m[1].replace(/\//g, ',').split(/[, ]+/).filter(Boolean);
    const num = i => {
      const v = partes[i];
      if (v === undefined) return 1;
      if (v.endsWith('%')) return Math.round(parseFloat(v) * 2.55);
      return parseFloat(v);
    };
    const a = partes.length > 3 ? (/[%]/.test(partes[3]) ? parseFloat(partes[3]) / 100 : parseFloat(partes[3])) : 1;
    return { r: num(0), g: num(1), b: num(2), a };
  }
  const nome = s.toLowerCase();
  if (nome in NOMES) return NOMES[nome] ? hexParaRgba(NOMES[nome]) : null;
  return null;
}

const canalLinear = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminancia(cor) {
  return 0.2126 * canalLinear(cor.r) + 0.7152 * canalLinear(cor.g) + 0.0722 * canalLinear(cor.b);
}
const razao = (a, b) => { const l1 = luminancia(a), l2 = luminancia(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
// foreground rgba sobre background rgb (composição alfa simples)
function compor(fundo, frente) {
  if (frente.a >= 1) return frente;
  const a = frente.a;
  return { r: frente.r * a + fundo.r * (1 - a), g: frente.g * a + fundo.g * (1 - a), b: frente.b * a + fundo.b * (1 - a), a: 1 };
}
function misturar(fundo, frente, opacidade) {
  if (opacidade >= 1) return frente;
  return { r: frente.r * opacidade + fundo.r * (1 - opacidade), g: frente.g * opacidade + fundo.g * (1 - opacidade), b: frente.b * opacidade + fundo.b * (1 - opacidade), a: 1 };
}
// gradiente: extrai as cores das paradas (o texto pode cair em qualquer uma delas)
// `background: radial-gradient(...), var(--paper)` são CAMADAS: a primeira é pintada sobre a
// última. Tratar isso como "um gradiente qualquer" fazia o halo decorativo da página entrar na
// média de fundo de todo elemento do documento — e o rodapé da portaria aparecia denunciado com
// 2,9:1 quando no navegador é texto claro sobre quase-preto.
function camadasDeFundo(texto) {
  const camadas = [];
  let profundidade = 0, atual = '';
  for (const c of texto) {
    if (c === '(') profundidade += 1;
    if (c === ')') profundidade -= 1;
    if (c === ',' && profundidade === 0) { camadas.push(atual.trim()); atual = ''; continue; }
    atual += c;
  }
  if (atual.trim()) camadas.push(atual.trim());
  return camadas;
}

function coresDeGradiente(texto) {
  const cores = [];
  const re = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi;
  let m;
  while ((m = re.exec(texto))) { const c = corDe(m[1]); if (c) cores.push(c); }
  return cores;
}

// ------------------------------------------------------------------- variáveis do tema
function resolverVars(texto, vars, prof = 0) {
  if (prof > 24 || texto == null) return texto;
  let s = String(texto);
  for (let i = 0; i < 24; i += 1) {
    const m = /var\(\s*(--[\w-]+)\s*(,([^()]*|\([^()]*\))?)?\)/.exec(s);
    if (!m) break;
    const bruto = vars[m[1]];
    let substitute = bruto === undefined ? (m[3] || '').trim() : String(bruto).trim();
    if (substitute === undefined) substitute = '';
    s = s.slice(0, m.index) + substitute + s.slice(m.index + m[0].length);
  }
  return s;
}

// --------------------------------------------------------------------------- parser CSS
function regrasDe(css) {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const regras = [];
  const ignoradas = { 'keyframes': 0, 'media-outras': 0 };
  let i = 0;
  const cortarAteFechamento = (desde) => {
    let fundo = 0, em = desde;
    for (; em < limpo.length; em += 1) {
      const c = limpo[em];
      if (c === '{') fundo += 1;
      else if (c === '}') { fundo -= 1; if (fundo === 0) return em; }
    }
    return limpo.length;
  };
  while (i < limpo.length) {
    const abre = limpo.indexOf('{', i);
    if (abre < 0) break;
    // sentenças de at-regra (@import, @charset, @namespace) terminam com ';' ANTES de qualquer
    // bloco. Sem cortar aí, o ';' do @import engolia o seletor seguinte e a folha inteira perdia
    // o seu ':root { --tokens }' — foi assim que a página pública saiu sem nenhuma variável.
    const pontoEVirgula = limpo.lastIndexOf(';', abre);
    if (pontoEVirgula > i && pontoEVirgula < abre && limpo.slice(i, pontoEVirgula).indexOf('}') < 0) { i = pontoEVirgula + 1; continue; }
    const cabeca = limpo.slice(i, abre).trim();
    if (cabeca.startsWith('@')) {
      const fim = cortarAteFechamento(abre);
      const corpo = limpo.slice(abre + 1, fim);
      if (/^@media/i.test(cabeca) || /^@supports/i.test(cabeca)) {
        // @media/@supports só interessa para o que já é cor de texto: entra como regra
        // normal (o layout responsivo não muda cor), então reprocessamos o corpo aqui
        const dentro = regrasDe(corpo);
        regras.push(...dentro.regras);
        Object.keys(dentro.ignoradas).forEach(k => { ignoradas[k] += dentro.ignoradas[k]; });
      } else ignoradas[/@keyframes/.test(cabeca) ? 'keyframes' : 'media-outras'] += 1;
      i = fim + 1;
      continue;
    }
    const fim = cortarAteFechamento(abre);
    const corpo = limpo.slice(abre + 1, fim);
    const decls = {};
    for (const parte of corpo.split(';')) {
      const dois = parte.indexOf(':');
      if (dois < 0) continue;
      const prop = parte.slice(0, dois).trim().toLowerCase();
      const valor = parte.slice(dois + 1).trim();
      if (prop && valor) decls[prop] = valor;
    }
    for (const sel of cabeca.split(',').map(s => s.trim()).filter(Boolean)) {
      if (sel.startsWith('@')) continue;
      regras.push({ sel, decls });
    }
    i = fim + 1;
  }
  return { regras, ignoradas };
}

// vars de :root e :root[data-theme="..."] (o tema escuro só vale quando o root tem o atributo)
function varsDeTema(regras, tema) {
  const vars = {};
  for (const { sel, decls } of regras) {
    const ehRoot = /^:root$/.test(sel) || (tema && new RegExp('^:root\\[data-theme="' + tema + '"\\]$').test(sel));
    if (!ehRoot) continue;
    for (const [prop, valor] of Object.entries(decls)) if (prop.startsWith('--')) vars[prop] = valor;
  }
  // resolve as próprias variáveis entre si (--ink-2 pode usar --ink)
  for (const chave of Object.keys(vars)) vars[chave] = resolverVars(vars[chave], vars);
  return vars;
}

// ---------------------------------------------------------------------- especificidade
const PSEUDO_PROIBIDO = /:(?::)?(?:after|before|first-line|first-letter|selection|marker|backdrop|grammar-error|spelling-error|file-selector-button|hover|active|focus-visible|focus|disabled|checked|not|is|where|nth|first-child|last-child|only-child|placeholder-shown)/;
const PSEUDO_ELEMENTO = /::(placeholder|before|after|first-line|selection)/;

function especificidade(sel) {
  let a = 0, b = 0, c = 0;
  const limpo = sel.replace(/\[[^\]]*\]/g, () => { b += 1; return ''; });
  for (const parte of limpo.split(/\s+|\s*>\s*|\s*\+\s*|\s*~\s*/)) {
    if (!parte) continue;
    if (parte.startsWith('#')) a += 1;
    const classes = (parte.match(/\.[\w-]+/g) || []).length;
    const pseudos = (parte.match(/:[\w-]+/g) || []).length;
    b += classes + pseudos;
    const tag = parte.replace(/[.#:][\s\S]*/g, '');
    if (tag && tag !== '*') c += 1;
  }
  return [a, b, c];
}

// parte composta (.classe[attr], tag, #id, :root) contra um elemento
function parteBate(parte, el) {
  if (parte === ':root') return el.depth === 0;
  if (parte === '*') return true;
  let resto = parte;
  const ids = resto.match(/#[\w-]+/g) || [];
  for (const id of ids) { if (el.id !== id.slice(1)) return false; resto = resto.split(id).join(''); }
  const attrs = resto.match(/\[[^\]]*\]/g) || [];
  for (const at of attrs) {
    const m = /^\[([\w-]+)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]$/.exec(at);
    if (!m) return false;
    const valor = el.attrs[m[1]];
    if (valor === undefined) return false;
    if (m[2] && String(valor) !== m[3]) return false;
    resto = resto.split(at).join('');
  }
  const classes = resto.match(/\.[\w-]+/g) || [];
  for (const cls of classes) if (!el.classList.includes(cls.slice(1))) return false;
  resto = resto.replace(/\.[\w-]+/g, '').replace(/:[\w-]+(\([^)]*\))?/g, '');
  const tag = resto.trim();
  if (tag && tag !== '*' && tag !== el.tag) return false;
  return true;
}

// seletor (com descendentes e ">") batendo no elemento. O último composto TEM de casar o
// próprio elemento: deixar ele subir na cadeia aceitava ":root body" para uma <div> e a
// contagem saía pintando texto sobre o fundo do painel — ou seja, escondia justamente o que
// este auditor existe para achar.
function seletorBate(sel, el) {
  if (PSEUDO_PROIBIDO.test(sel) && !PSEUDO_ELEMENTO.test(sel)) return false;
  const bruto = sel.trim().split(/\s+/).filter(Boolean);
  const compostos = [];
  for (const parte of bruto) {
    if (parte === '>') { if (compostos.length) compostos[compostos.length - 1].direto = true; continue; }
    if (parte === '+' || parte === '~') { if (compostos.length) compostos[compostos.length - 1].direto = true; continue; }
    const pedacos = parte.split('>');
    pedacos.forEach((p, i) => {
      if (i > 0) compostos[compostos.length - 1].direto = true;
      if (p) compostos.push({ parte: p, direto: false });
    });
  }
  if (!compostos.length) return false;
  if (!parteBate(compostos[compostos.length - 1].parte, el)) return false;
  let alvo = el;
  for (let idx = compostos.length - 2; idx >= 0; idx -= 1) {
    const exigePai = Boolean(compostos[idx + 1].direto);
    let no = alvo.parent;
    let achou = null;
    while (no) {
      if (parteBate(compostos[idx].parte, no)) { achou = no; break; }
      if (exigePai) break;
      no = no.parent;
    }
    if (!achou) return false;
    alvo = achou;
  }
  return true;
}

// -------------------------------------------------------------------------- árvore HTML
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'use', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse']);

function arvoreDe(html) {
  const raiz = { tag: '___raiz_fora', attrs: {}, classList: [], children: [], texts: [], depth: -1, parent: null };
  let atual = raiz;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--') || m[0].startsWith('<![')) continue;
    if (m[1]) {
      // fechar sem casar: sobe até achar a abertura correspondente e, se não houver,
      // IGNORA o */*/ — fechar às cegas desmontava a árvore (a sidebar perdia os filhos
      // e o texto dela era medido sobre o fundo do body, não sobre o fundo escuro real)
      const nome = m[1].toLowerCase();
      let no = atual;
      while (no && no.tag !== '___raiz_fora') {
        if (no.tag === nome) { atual = no.parent || atual; break; }
        no = no.parent;
      }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
      const el = {
        tag, attrs, id: attrs.id || '',
        classList: String(attrs.class || '').split(/\s+/).filter(Boolean),
        children: [], texts: [], depth: atual.depth + 1, parent: atual,
      };
      atual.children.push(el);
      if (VOID.has(tag) || m[4] === '/') continue;
      if (tag === 'script' || tag === 'style') {
        const fecha = html.toLowerCase().indexOf('</' + tag, re.lastIndex);
        re.lastIndex = fecha < 0 ? html.length : fecha;
        continue;
      }
      atual = el;
      continue;
    }
    if (m[5]) {
      const texto = m[5].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (texto.trim()) atual.texts.push(texto);
    }
  }
  return raiz;
}

// ------------------------------------------------------------------------ computar estilo
const CORA_PROPS = ['color', 'background-color', 'background', 'border-color'];
const FILTRO_DE = new Set(['style', 'script', 'noscript', 'svg', 'use', 'path']);

function corEfetiva(decls, prop, vars, el) {
  const bruto = decls[prop];
  if (bruto === undefined) return null;
  const resolvido = resolverVars(bruto, vars);
  if (/currentcolor/i.test(resolvido)) return el.__cor || null;
  if (/gradient\(/i.test(resolvido)) return null;
  const cores = [];
  const re = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|transparent)\b)/gi;
  let m;
  while ((m = re.exec(resolvido))) { const c = corDe(m[1]); if (c) cores.push(c); }
  if (!cores.length) { const c = corDe(resolvido); if (c) cores.push(c); }
  return cores.length ? cores : null;
}

// audita: percorre a árvore carregando cor/fundo/tamanho de fonte/opacity
function auditar({ html, css, vars = {}, tema = '', seletorRaiz = null, rotulo = '' }) {
  const { regras, ignoradas } = regrasDe(css);
  const varsTema = { ...varsDeTema(regras, tema === 'dark' ? 'dark' : null), ...vars };
  const compiladas = [];
  let ordem = 0;
  for (const { sel, decls } of regras) {
    ordem += 1;
    if (PSEUDO_PROIBIDO.test(sel) && !PSEUDO_ELEMENTO.test(sel)) { ignoradas['pseudo-estado'] = (ignoradas['pseudo-estado'] || 0) + 1; continue; }
    compiladas.push({ sel, decls, ordem, espec: especificidade(sel), pseudo: (PSEUDO_ELEMENTO.exec(sel) || [])[1] || null });
  }
  const raiz = arvoreDe(seletorRaiz ? recortar(html, seletorRaiz) : html);
  const ofensores = [];
  const trilha = [];
  const chavesVistas = new Set();
  let medidos = 0;
  const ignoradoFinal = { ...ignoradas };

  const aplicaveis = (el, pseudo) => compiladas
    .filter(r => (r.pseudo || null) === pseudo && seletorBate(r.sel, el))
    // especificidade primeiro; empate → quem aparece depois na folha (é assim que o navegador
    // decide, e sem isso .btn { color } passava por cima de .btn-primary { color })
    .sort((x, y) => {
      for (let i = 0; i < 3; i += 1) if (x.espec[i] !== y.espec[i]) return y.espec[i] - x.espec[i];
      return y.ordem - x.ordem;
    });

  // pseudo default nulo: chamar valorDe(el, 'color') sem o terceiro argumento comparava
  // `(r.pseudo || null) === undefined` e NENHUMA regra casava — a cor declarada no próprio
  // elemento desaparecia da conta e sobrava só a herdada da raiz. Foi assim que a varredura
  // denunciou 127 pares, quase todos "herdados", em vez dos pares reais.
  function valorDe(el, prop, pseudo = null) {
    for (const r of aplicaveis(el, pseudo)) {
      const v = r.decls[prop];
      if (v !== undefined) return resolverVars(v, varsTema);
    }
    return null;
  }

  function percorrer(el, herdado, opacidadeAcumulada) {
    const opacidadeLocal = Number(valorDe(el, 'opacity') || 1);
    const opacidade = Math.max(0, Math.min(1, opacidadeLocal)) * opacidadeAcumulada;
    const corBruta = valorDe(el, 'color');
    const cor = corBruta !== null ? corBruta : herdado.cor;
    // fundo: o primeiro ancestral (ou o próprio) que declara background
    let fundo = herdado.fundo;
    let opacidadeFundo = herdado.opacidade ?? 1;
    const decls = aplicaveis(el, null);
    if (process.env.CONTRASTE_CASAS) console.log(`[${el.depth}] ${el.tag}.${el.classList.join('.')} ← ${decls.map(r => r.sel).join(' | ') || '(nada)'}`);
    for (const r of decls) {
      const b = r.decls['background'] ?? r.decls['background-color'] ?? r.decls['background-image'];
      if (b === undefined) continue;
      const resolvido = resolverVars(b, varsTema);
      if (/^(?:none|transparent)$/i.test(resolvido.trim())) { fundo = { tipo: 'vazio' }; continue; }
      if (/gradient\(/i.test(resolvido)) {
        const camadas = camadasDeFundo(resolvido);
        const gradientes = camadas.filter(c => /gradient\(/i.test(c));
        const solidas = camadas.filter(c => !/gradient\(/i.test(c) && !/^(?:none|transparent)$/i.test(c));
        const retro = solidas.length ? corDe(resolverVars(solidas[solidas.length - 1], varsTema)) : null;
        fundo = { tipo: 'gradiente', cores: gradientes.flatMap(g => coresDeGradiente(g)), retro: retro ? [retro] : [] };
        break;
      }
      if (/url\(/i.test(resolvido)) { fundo = { tipo: 'imagem' }; break; }
      const cores = [];
      const re = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi;
      let mm;
      while ((mm = re.exec(resolvido))) { const c = corDe(mm[1]); if (c) cores.push(c); }
      if (cores.length) { fundo = { tipo: 'cor', cores }; break; }
    }
    // pararadas de gradiente e cores com alfa são SEMPRE compostas sobre o que está atrás:
    // rgba(255,255,255,.055) na sidebar escura é um cinza escuro, não branco — usar a cor
    // crua do gradiente/alfa fazia a varredura denunciar texto branco sobre branco num menu
    // que no navegador é branco sobre marrom.
    const baseAnterior = herdado.fundoSolido || { r: 255, g: 255, b: 255, a: 1 };
    let coresEfetivas = null;
    if (fundo.tipo === 'cor') coresEfetivas = [compor(baseAnterior, fundo.cores[0])];
    else if (fundo.tipo === 'gradiente') {
      const baseLocal = fundo.retro && fundo.retro.length ? compor(baseAnterior, fundo.retro[0]) : baseAnterior;
      coresEfetivas = (fundo.cores || []).map(c => compor(baseLocal, c));
      // longe do halo a camada de trás é o que aparece: entra como candidato também
      if (fundo.retro && fundo.retro.length) coresEfetivas.push(compor(baseAnterior, fundo.retro[0]));
    }
    const fundoSolido = coresEfetivas && coresEfetivas.length
      ? { r: coresEfetivas.reduce((a2, c) => a2 + c.r, 0) / coresEfetivas.length, g: coresEfetivas.reduce((a2, c) => a2 + c.g, 0) / coresEfetivas.length, b: coresEfetivas.reduce((a2, c) => a2 + c.b, 0) / coresEfetivas.length, a: 1 }
      : herdado.fundoSolido;

    const tamanhoBruto = valorDe(el, 'font-size');
    const tamanho = tamanhoBruto === null ? herdado.tamanho : (parseFloat(String(tamanhoBruto).replace(/clamp\([^,]*,\s*/, '(').split(/[,)]/)[1] || tamanhoBruto) || herdado.tamanho);
    const pesoBruto = valorDe(el, 'font-weight');
    const peso = pesoBruto === null ? herdado.peso : (parseInt(pesoBruto, 10) || (String(pesoBruto).includes('bold') ? 700 : herdado.peso));

    const proximoHerdado = { cor, fundo, fundoSolido: fundoSolido, tamanho, peso, opacidade };
    for (const filho of el.children) {
      if (FILTRO_DE.has(filho.tag)) continue;
      percorrer(filho, proximoHerdado, opacidade);
    }

    if (!el.texts.length) return;
    const coresFundo = coresEfetivas && coresEfetivas.length
      ? coresEfetivas
      : [herdado.fundoSolido || { r: 255, g: 255, b: 255, a: 1 }];
    if (!coresFundo.some(c => c && c.a !== undefined)) return;
    const frenteBruta = corDe(cor);
    if (!frenteBruta) { ignoradoFinal['sem-cor'] = (ignoradoFinal['sem-cor'] || 0) + 1; return; }

    for (const textoNode of el.texts) {
      const texto = String(textoNode).replace(/\s+/g, ' ').trim();
      if (!texto || !/[\wÀ-ÿ]/.test(texto)) continue;
      medidos += 1;
      const frente = compor({ r: 0, g: 0, b: 0, a: 0 }, frenteBruta);
      let pior = 99; let piorFundo = null;
      for (const f of coresFundo) {
        if (!f) continue;
        const aplicado = misturar(f, compor(f, frente), opacidade);
        const r = razao(aplicado, f);
        if (r < pior) { pior = r; piorFundo = f; }
      }
      if (process.env.CONTRASTE_TRILHA) trilha.push(`${el.tag}.${el.classList.join('.')} "${texto.slice(0, 22)}" cor=${cor} fundo=${fundo.tipo} ${JSON.stringify((fundo.cores || []).map(c => c && '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')))} tam=${Math.round(tamanho)}`);
      const grande = (tamanho >= 24) || (tamanho >= 18.66 && peso >= 700);
      const minimo = grande ? 3 : 4.5;
      const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
      const chave = `${el.tag}.${el.classList.join('.')}|${hex(piorFundo)}|${hex(frente)}|${Math.round(pior * 100)}`;
      if (pior >= minimo) { chavesVistas.add('ok:' + chave); continue; }
      if (chavesVistas.has(chave)) continue;
      chavesVistas.add(chave);
      ofensores.push({
        tema, rotulo, texto: texto.slice(0, 46), tag: el.tag, classes: el.classList.join(' ') || '(sem classe)',
        cor: hex(frente), fundo: hex(piorFundo), razao: Number(pior.toFixed(2)), minimo,
        tamanho: Math.round(tamanho * 10) / 10, peso, ancestral: cadeia(el),
      });
    }
  }

  const inicio = {
    cor: resolverVars('var(--ink)', varsTema),
    fundo: { tipo: 'cor', cores: [corDe(resolverVars('var(--paper)', varsTema)) || { r: 245, g: 243, b: 239, a: 1 }] },
    fundoSolido: corDe(resolverVars('var(--paper)', varsTema)) || { r: 245, g: 243, b: 239, a: 1 },
    tamanho: 16, peso: 400, opacidade: 1,
  };
  for (const filho of raiz.children) percorrer(filho, inicio, 1);
  ofensores.sort((a, b) => a.razao - b.razao);
  return { ofensores, medidos, trilha, ignorados: ignoradoFinal };
}

function cadeia(el) {
  const partes = [];
  let no = el;
  while (no && no.tag !== '___raiz_fora' && partes.length < 4) {
    partes.unshift(no.tag + (no.classList.length ? '.' + no.classList[0] : ''));
    no = no.parent;
  }
  return partes.join(' > ');
}

function recortar(html, seletor) {
  // isola um pedaço do documento ("<aside class="sidebar">…</aside>") para auditar sozinho
  const alvo = seletor.replace(/^\./, '').trim();
  const re = new RegExp('<(\\w+)[^>]*class="[^"]*\\b' + alvo + '\\b[^"]*"', 'i');
  const m = re.exec(html);
  if (!m) return '';
  const tag = m[1];
  const abre = m.index;
  let fundo = 0, i = abre;
  const re2 = new RegExp('</?' + tag + '\\b', 'gi');
  let mm;
  while ((mm = re2.exec(html.slice(abre)))) {
    if (mm[0][1] === '/') { fundo -= 1; if (fundo === 0) { i = abre + mm.index + mm[0].length; break; } }
    else fundo += 1;
  }
  return html.slice(abre, i);
}

// varredura só de folha: toda regra que declara cor E fundo no mesmo bloco
function auditarParesDeFolha(css, varsRaiz = {}) {
  const { regras } = regrasDe(css);
  const porSeletor = new Map();
  for (const { sel, decls } of regras) {
    const cor = decls.color; const fundo = decls['background-color'] || decls.background;
    if (!cor || !fundo) continue;
    const chave = sel + '|' + cor + '|' + fundo;
    if (porSeletor.has(chave)) continue;
    porSeletor.set(chave, { sel, cor, fundo });
  }
  const ruim = [];
  for (const { sel, cor, fundo } of porSeletor.values()) {
    const vars = { ...varsRaiz };
    const frente = corDe(resolverVars(cor, vars));
    if (!frente) continue;
    const resolvido = resolverVars(fundo, vars);
    // só um fundo OPAQUE diz o contraste sozinho: rgba/gradiente dependem do que está
    // atrás (a sidebar é escura, a carta é creme) — esses pares são medidos na cascata
    if (/gradient\(|url\(|^none$|^transparent$/i.test(resolvido.trim())) continue;
    const bruto = corDe(resolvido.split(/\s+(?![^(]*\))/)[0]);
    if (!bruto || bruto.a < 1) continue;
    const base = bruto;
    {
      const r = razao(compor(base, frente), base);
      if (r < 3) {
        // as chaves "cor"/"por"/"caso" vêm de brinde para o relatório agrupar do mesmo jeito
        // que agrupa a varredura da cascata — um só formato de queixa na casa toda
        const ultimo = sel.split(',').pop().trim().split(/\s+(?![^(]*\))/).filter(p => !PSEUDO_PROIBIDO.test(p)).slice(-1)[0] || sel;
        const seletorLimpo = ultimo.replace(/::?[a-z-]+(\([^)]*\))?/g, '');
        // ancestral: o mesmo campo que a varredura da cascata usa para agrupar — assim o
        // relatório das páginas avulsas e o do painel têm a mesma forma
        ruim.push({ sel, texto: cor.trim(), fundo: fundo.trim(), cor: cor.trim(), por: seletorLimpo || sel,
                    ancestral: seletorLimpo || sel, razao: Number(r.toFixed(2)) });
      }
    }
  }
  ruim.sort((a, b) => a.razao - b.razao);
  return ruim;
}

module.exports = { auditar, auditarParesDeFolha, regrasDe, varsDeTema, arvoreDe, razao, corDe, resolverVars, hexParaRgba, misturar, compor, luminancia };
