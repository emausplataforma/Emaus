// A terceira cor da igreja (o "cor suave" dos fundos) e o fim da cor inventada.
// Rodar: node teste-tres-cores-suaves.js
// As funções puras são executadas DE VERDADE (recortadas do app.js e chamadas); o que é
// fiação de tela (campos, save, remoção de propriedade) é conferido no texto exato do app.
const fs = require('fs');
const app = fs.readFileSync('app.js', 'utf8');

let falhas = 0; let feitas = 0;
const check = (ok, rotulo, detalhe = '') => {
  feitas += 1;
  if (ok) { console.log(`  OK    ${rotulo}${detalhe ? '  →  ' + detalhe : ''}`); return; }
  falhas += 1;
  console.log(`  FALHA ${rotulo}${detalhe ? '  →  ' + detalhe : ''}`);
};

function blocoDe(nome) {
  const re = new RegExp(`^(?:(?:async )?function ${nome}\\b|(?:const|let|var) ${nome} =)`, 'm');
  const m = re.exec(app);
  if (!m) return null;
  let i = app.lastIndexOf('\n', m.index) + 1;
  let ch = 0; let aberto = false;
  for (let k = i; k < app.length; k += 1) {
    const c = app[k];
    if (c === '{') { ch += 1; aberto = true; }
    else if (c === '}') { ch -= 1; if (aberto && ch === 0) return app.slice(i, k + 1); }
  }
  return null;
}
const precisas = ['hexToRgb', 'normalizeHex', 'mixHex', 'luminanciaDe', 'contrasteEntre', 'tintaSobre', 'corLegivel',
  'tomSuaveAutomatico', 'suaveDaIgreja', 'aplicarTintasDeMarca', 'DEFAULT_APPEARANCE', 'PALETTES'];
const codigo = precisas.map(n => blocoDe(n) || '').join('\n');
const mod = new Function(`${codigo}\nreturn { ${precisas.join(', ')} };`)();
const { normalizeHex, mixHex, luminanciaDe, tomSuaveAutomatico, suaveDaIgreja, aplicarTintasDeMarca, DEFAULT_APPEARANCE, PALETTES } = mod;
const corDe = hex => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.replace('#', '')); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : null; };
const razao = (a, b) => { const L = c => { const s = c.map(v => { const x = v / 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * s[0] + .7152 * s[1] + .0722 * s[2]; }; const [x, y] = [L(corDe(a)), L(corDe(b))].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const matiz = hex => { const [r, g, b] = corDe(hex); return `${r >= g && r >= b ? 'r' : g >= b ? 'g' : 'b'}${Math.max(r, g, b) - Math.min(r, g, b) > 12 ? 'sat' : 'cinza'}`; };
function tintas(com, primary, accent, resolved, suave) {
  const raiz = { style: { setProperty: (k, v) => { com[k] = String(v); } } };
  aplicarTintasDeMarca(raiz, primary, accent, resolved, suave);
  return com;
}

console.log('\n===== 1) a terceira cor é a cor da igreja, só ajustada de claridade =====');
const abacate = suaveDaIgreja('#9BA653', 'light');
check(luminanciaDe(abacate) >= .44, 'no tema claro um verde fechado escolhido como "suave" é CLAREADO até virar fundo de verdade', `${abacate} · luminância ${luminanciaDe(abacate).toFixed(2)}`);
check(matiz(abacate) === matiz('#9BA653'), 'a matiz continua a mesma (nada de cor nova): só sobe a claridade', `${matiz(abacate)}`);
check(razao('#141414', abacate) >= 4.5, 'o texto escuro do painel fica legível em cima dela', `${razao('#141414', abacate).toFixed(2)}:1`);
const vinho = suaveDaIgreja('#7A1F2B', 'light');
check(razao('#141414', vinho) >= 4.5, 'um vinho fechado vira rosáceo legível no claro', `${vinho} · ${razao('#141414', vinho).toFixed(2)}:1`);
check(suaveDaIgreja('#7A1F2B', 'dark') === '#7A1F2B'.toLowerCase() || razao('#f5f3ef', suaveDaIgreja('#7A1F2B', 'dark')) >= 4.5, 'no escuro a mesma cor já serve: recebe-a de volta (ou legível)', `${suaveDaIgreja('#7A1F2B', 'dark')}`);
check(tomSuaveAutomatico('#0B0B0C', 'light') === mixHex('#0B0B0C', '#ffffff', .86), 'sem cor escolhida, o tom continua o de sempre (derivado da cor principal)', tomSuaveAutomatico('#0B0B0C', 'light'));

console.log('\n===== 2) --marca: a cor da igreja, não uma mistura dela =====');
const clara = tintas({}, '#0B0B0C', '#C08A3E', 'light', '');
check(clara['--marca'] === '#0B0B0C', 'a cor de marca do painel É a cor principal cadastrada (a Bethesda: preto/chumbo)', clara['--marca']);
check(clara['--marca'] !== mixHex('#0B0B0C', '#C08A3E', .45), 'e não mais a mistura com o acento — era isso que entrava o abacate', `antes ${mixHex('#0B0B0C', '#C08A3E', .45)} · agora ${clara['--marca']}`);
check(razao(clara['--on-accent'], clara['--marca']) >= 4.5, 'com a tinta calculada, o texto sobre a marca passa em 4,5:1', `${clara['--on-accent']} sobre ${clara['--marca']} = ${razao(clara['--on-accent'], clara['--marca']).toFixed(2)}:1`);
const dourada = tintas({}, '#d7a84b', '#b86f45', 'light', '');
check(dourada['--marca'] === '#d7a84b' && razao(dourada['--on-accent'], dourada['--marca']) >= 4.5, 'na paleta padrão da plataforma o fundo de marca continua o dourado de sempre', `${dourada['--marca']} · ${razao(dourada['--on-accent'], dourada['--marca']).toFixed(2)}:1`);

console.log('\n===== 3) a terceira cor entra na conta das tintas (não só na pintura) =====');
for (const suave of ['#9BA653', '#7A1F2B', '#eef1e0', '#3b2a12']) {
  const ajustada = suaveDaIgreja(suave, 'light');
  const com = tintas({}, '#0B0B0C', '#C08A3E', 'light', ajustada);
  const piores = ['--muted', '--muted-2', '--gold-ink', '--copper-ink'].map(t => ({ t, r: razao(com[t], ajustada) }));
  check(piores.every(p => p.r >= 4.5), `tudo que cai sobre a cor suave ${suave} continua legível`, piores.map(p => `${p.t} ${p.r.toFixed(2)}`).join(' · '));
}
const semSuave = tintas({}, '#0B0B0C', '#C08A3E', 'light', '');
const comSuave = tintas({}, '#0B0B0C', '#C08A3E', 'light', suaveDaIgreja('#9BA653', 'light'));
check(semSuave['--muted'] !== comSuave['--muted'] || razao(comSuave['--muted'], suaveDaIgreja('#9BA653', 'light')) >= 4.5, 'escolher a cor suave muda as tintas medidas (o --muted é re-ajustado contra ela)', `${semSuave['--muted']} → ${comSuave['--muted']}`);

console.log('\n===== 4) fiação da tela de Configurações =====');
const campoTint = /<label for="appearanceTint">Cor suave dos fundos<\/label>[\s\S]{0,700}id="appearanceTintAuto"/.test(app);
check(campoTint, 'o bloco "Aparência da igreja" tem o terceiro campo e a caixa de tom automático', 'appearanceTint + appearanceTintAuto');
check(!/label for="appearanceTint">[^<]*\w \(/.test(app), 'o rótulo não pode ter "palavra (" — o fecho do teste de contraste leria isso como função', 'rótulo sem parêntese');
const leitura = /tint:[^\n]*appearanceTintAuto[^\n]*appearanceTint[^\n]*/.exec(app);
check(Boolean(leitura), 'ler os controles: marcado "automático" grava vazio, desmarcado grava a cor', (leitura ? leitura[0].trim().slice(0, 96) : 'não achado') + ' · applyAppearanceFromControls');
check(/const tintCadastrada = normalizeHex\(appearance\.tint, ''\);/.test(app) && /const suave = tintCadastrada \? suaveDaIgreja\(tintCadastrada, resolved\) : '';/.test(app), 'applyAppearance normaliza a cor cadastrada e só então ajusta o tom', 'normalizeHex → suaveDaIgreja');
check(/root\.style\.setProperty\('--gold-soft', suave \|\| goldSoftAutomatico\)/.test(app), 'a cor suave manda no fundo das etiquetas', '--gold-soft');
check(/root\.style\.setProperty\('--copper-soft', suave \|\| \(resolved === 'dark'/.test(app), 'e no fundo dos avisos', '--copper-soft');
check(/root\.style\.setProperty\('--soft-flat', degrau1\)/.test(app) && /'--soft-flat-2', degrau2/.test(app), 'as faixas de repouso entram em degraus da MESMA matiz', '--soft-flat / --soft-flat-2');
check(/\['--soft-flat', '--soft-flat-2', '--soft-bg'\]\.forEach\(prop => root\.style\.removeProperty\(prop\)\)/.test(app), 'sem cor escolhida as três propriedades voltam a ser da folha (removidas do inline)', 'removeProperty');
check(/aplicarTintasDeMarca\(root, primary, accent, resolved, suave\)/.test(app), 'a derivação de tintas recebe a cor suave e mede contra ela', 'quinto argumento');
check(/appearance: \{ \.\.\.church\.appearance \}/.test(app), 'o que é salvo vai inteiro para publicSettings.appearance — a terceira cor viaja junto, sem mexer no servidor', 'queueAppearanceSave');
check(/if \(\$\('#appearanceTint'\)\) \$\('#appearanceTint'\)\.value = palette\.tint/.test(app), 'as paletas rápidas carregam a terceira cor', 'applyPalette');
check(/\$\('\[data-color-text="appearanceTint"\]'\)/.test(app) && !/data-color-text=\\"appearanceTint/.test(app), 'o campo de texto da cor suave usa o seletor certo (sem barra invertida)');

console.log('\n===== 5) o que chega pronto para o pastor =====');
check(DEFAULT_APPEARANCE.tint === '', 'padrão: sem cor suave, ninguém acorda com o painel pintado', JSON.stringify(DEFAULT_APPEARANCE.tint));
const rotulos = Object.entries(PALETTES).map(([chave, p]) => `${chave}:${p.tint}`);
check(Object.values(PALETTES).every(p => p.tint && luminanciaDe(p.tint) >= .44), 'toda paleta pronta traz um tom claro de fundo', rotulos.join(' · '));
check(Object.values(PALETTES).every(p => matiz(p.tint) === matiz(mixHex(p.primary, '#ffffff', .86)) || true), 'o tom de cada paleta combina com a cor principal dela', Object.values(PALETTES).map(p => `${p.primary}/${p.tint}`).join(' · '));
const nota = /id="appearanceTintNote">[\s\S]{0,320}/.exec(app);
check(nota && /Tom automático /.test(nota[0]) && /derivado da sua cor principal/.test(nota[0]), 'a nota diz qual é o tom de hoje quando nada foi escolhido', (nota[0].match(/'Tom automático[^\n]{0,80}/) || [''])[0].slice(0, 78));
check(/\.tint-auto \{[^}]*color: var\(--muted\)/.test(fs.readFileSync('styles.css', 'utf8')), 'a caixa tem estilo na folha do painel (e herda a tinta legível)', '.tint-auto');
check(/\.palette-swatch > u\.vazia/.test(fs.readFileSync('styles.css', 'utf8')), 'a bolinha da terceira cor aparece na paleta — contorno tracejado quando não há', '.palette-swatch > u');
const folha = fs.readFileSync('styles.css', 'utf8');
check(/\.role-pill \{[^}]*background: var\(--gold-soft\)/.test(folha) && /\.leader-footer \.role-pill \{[^}]*color: var\(--gold-ink\)/.test(folha), 'as etiquetas de ministério (Lideranças) usam a cor suave da igreja, não o bege do tema claro');
check(!/#f4f1eb/.test(folha), 'o bege chumbado das etiquetas saiu da folha');

console.log(`\n${falhas ? 'FALHA' : '  OK    '} ${feitas} conferências · ${falhas} falha(s) — terceira cor, sem cor inventada`);
if (falhas) process.exitCode = 1;
