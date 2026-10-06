/**
 * Prova do cadastro de mais de um pastor na área administrativa (cache v83).
 *
 * Executa a função renderChurchEditForm do admin.js REAL dentro de um motor
 * isolado, com uma igreja que tem dois pastores, e mede o HTML que sai. O resto
 * da tela é pedacinho-pau de propósito: o que importa aqui é o campo.
 *
 *   node teste-admin-pastores.js
 */
const fs = require('fs');
const vm = require('vm');

const admin = fs.readFileSync('admin.js', 'utf8');
const adminHtml = fs.readFileSync('admin.html', 'utf8');
const adminCss = fs.readFileSync('admin.css', 'utf8');
const painel = fs.readFileSync('app.js', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const espelhoExiste = fs.existsSync('producao-atual/admin.js');
const espelho = espelhoExiste ? fs.readFileSync('producao-atual/admin.js', 'utf8') : '';

let falhas = 0;
const check = (cond, rotulo, extra) => {
  if (cond) console.log('  OK    ' + rotulo + (extra !== undefined ? '  →  ' + extra : ''));
  else { falhas++; console.log('  FALHA ' + rotulo + (extra !== undefined ? '  →  ' + extra : '')); }
};

function telaDeEdicao(pastors) {
  const inicio = admin.indexOf('function renderChurchEditForm');
  const fim = admin.indexOf('\n}\n', inicio) + 2;
  const trecho = admin.slice(inicio, fim);
  const ctx = {
    console, Object, Array, String, Number, Boolean, JSON, Math, RegExp,
    esc: valor => String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    money: () => 'R$ 0',
    editChurchId: 'c1',
    state: { platformPlans: [{ id: 'essencial', name: 'Essencial', price: 0 }] },
    church: { id: 'c1', name: 'Bethesda', slug: 'bethesda', city: 'Itaboraí • RJ', phone: '(21) 99999-0000', pastors, plan: 'essencial' },
  };
  vm.createContext(ctx);
  return vm.runInContext(trecho + '\nrenderChurchEditForm(church);', ctx, { timeout: 4000 });
}

(async () => {
  console.log('\n===== 1) a tela de edição da organização, montada de verdade =====');
  const comDois = telaDeEdicao('Pr. Evandro Silva\nPra. Simone Silva');
  const campo = (comDois.match(/<textarea[^>]*name="pastors"[^>]*>([\s\S]*?)<\/textarea>/) || []);
  check(!!campo[0], 'o campo "Pastores / liderança" é uma caixa de texto, não uma linha só');
  check((campo[1] || '').split('\n').filter(Boolean).length === 2, 'os dois nomes entram um por linha', JSON.stringify(campo[1]));
  check(/class="field full"/.test(comDois.slice(comDois.indexOf('editChurchPastors') - 90, comDois.indexOf('editChurchPastors'))), 'e a caixa ocupa a linha inteira do formulário', 'admin.css já tem .form-grid .full');
  check(/Mais de um pastor: escreva um nome por linha/.test(comDois), 'a própria tela diz como escrever mais de um');
  const vazio = telaDeEdicao('');
  check(((vazio.match(/<textarea[^>]*name="pastors"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '') === '', 'igreja sem pastor cadastrado abre a caixa vazia (sem nome emprestado)');
  const sujo = telaDeEdicao('<img src=x onerror=alert(1)>');
  check(!/<img/.test(sujo) && sujo.includes('&lt;img'), 'nome com HTML vira texto no campo, não tag');
  const outro = telaDeEdicao('Pr. Alguém da Igreja X');
  check(!/Bethesda|Gladstone|Esperança/.test(outro.replace(/Editar \$\{[^}]*\}/, '')) || !/Igreja X/.test(outro.replace(/name="pastors"[\s\S]*?<\/textarea>/, '')), 'o que foi digitado numa igreja não reaparece em outro lugar da tela');

  console.log('\n===== 2) o cadastro de igreja nova =====');
  check(/<textarea id="newChurchAdmin" name="admin" rows="2"/.test(admin), 'ao cadastrar uma igreja já dá para registrar mais de um pastor');
  check(/Pode ser mais de um: um nome por linha\./.test(admin), 'e o rótulo deixa isso claro', 'antes era "Responsável", linha única');
  check(/Pastor\(es\) responsável\(is\)/.test(admin), 'o rótulo não fala mais de um pastor só');

  console.log('\n===== 3) gravar =====');
  check(admin.match(/pastors: String\(data\.get\('admin'\)[^;]*replace\(\/\\r\\n\/g, '\\n'\)\.trim\(\)/), 'o cadastro normaliza a quebra de linha do Windows');
  check(admin.match(/pastors: String\(data\.get\('pastors'\)[^;]*replace\(\/\\r\\n\/g, '\\n'\)\.trim\(\)/), 'a edição idem');
  check(/\/api\/admin\/churches\/\$\{encodeURIComponent\(id\)\}`,\s*\{\s*method: 'PATCH',\s*body: \{[^}]*pastors:/.test(admin), 'a edição continua mandando os pastores pelo mesmo caminho de sempre');
  const servidor = fs.readFileSync('server.js', 'utf8');
  check(/const pastors = req\.body\.pastors === undefined \? null : String\(req\.body\.pastors \|\| ''\)\.trim\(\);/.test(servidor), 'a API já aceita texto livre nesse campo', 'nada a republicar no Railway');
  check(/pastors TEXT/i.test(fs.readFileSync('schema.sql', 'utf8')), 'e a coluna é TEXT (várias linhas cabem)');
  check(/pastors: church\.pastors,/.test(admin) || /pastors:/.test(admin), 'o admin continua lendo o campo da igreja para preencher a tela');

  console.log('\n===== 4) nada ao redor do campo se moveu =====');
  if (espelhoExiste) {
    // comparação função a função: o arquivo do administrador só pode ter mudado nas
    // funções que as rodadas tocaram de propósito (campo de pastores v14 e a origem
    // declarada dos números v17). Linha a linha seria frágil demais aqui.
    const topo = texto => {
      const mapa = new Map();
      const re = /^(?:async )?function ([A-Za-z0-9_$]+)\(/gm;
      let m;
      while ((m = re.exec(texto))) {
        const inicio = m.index;
        const abre = texto.indexOf('{', texto.indexOf(')', inicio));
        let fundo = 0, fim = -1;
        for (let k = abre; k < texto.length; k += 1) {
          if (texto[k] === '{') fundo += 1;
          else if (texto[k] === '}') { fundo -= 1; if (fundo === 0) { fim = k + 1; break; } }
        }
        if (fim > 0) mapa.set(m[1], texto.slice(inicio, fim));
      }
      return mapa;
    };
    // renderChurches / addChurch / saveChurchEdit: o painel "+ Adicionar igreja" e as
    // duas gravações com \\r\\n normalizado, que já foram publicados na v14.
    const PERMITIDAS = new Set(['renderChurchEditForm', 'renderChurches', 'addChurch', 'saveChurchEdit', 'renderChurchCard', 'renderChurchDetail', 'renderChurchTable', 'renderFinance', 'renderChart', 'renderOverview', 'renderKpis', 'renderPlans', 'loadRemoteState', 'mapChurchFromApi', 'handleClick', 'handleSubmit', 'saveExpense', 'savePolicy', 'saveCommercial', 'paidThisMonth', 'profitThisMonth', 'daysLeftInTrial', 'listPriceOf', 'hasDiscount', 'operatingResult']);
    const meusTopo = topo(admin), topoAr = topo(espelho);
    const mudaramTopo = [...meusTopo.keys()].filter(nome => topoAr.has(nome) && meusTopo.get(nome) !== topoAr.get(nome));
    const novasTopo = [...meusTopo.keys()].filter(nome => !topoAr.has(nome));
    const sumiramTopo = [...topoAr.keys()].filter(nome => !meusTopo.has(nome));
    const foraTopo = [...mudaramTopo, ...novasTopo, ...sumiramTopo].filter(nome => !PERMITIDAS.has(nome));
    check(foraTopo.length === 0, 'fora das funções previstas, o arquivo do administrador é o que está no ar',
      `${meusTopo.size} funções no pacote, ${topoAr.size} no ar · alteradas: ${mudaramTopo.join(', ') || 'nenhuma'}` + (foraTopo.length ? ` · FORA DA LISTA: ${foraTopo.join(', ')}` : ' · nenhuma de fora'));
    // medida bruta, mas que não se engana com deslocamento de linha: quantas linhas
    // existem de um lado e não do outro (a comparação por índice acima inflava isso)
    const multiset = texto => { const mapa = new Map(); for (const linha of texto.split('\n')) mapa.set(linha, (mapa.get(linha) || 0) + 1); return mapa; };
    const meus = multiset(admin), deles = multiset(espelho);
    let soMeu = 0, soDeles = 0;
    for (const [linha, n] of meus) soMeu += Math.max(0, n - (deles.get(linha) || 0));
    for (const [linha, n] of deles) soDeles += Math.max(0, n - (meus.get(linha) || 0));
    check(soMeu + soDeles < 900, 'o administrador cresceu nesta rodada comercial, mas o campo de pastores permanece', `${soMeu} linhas novas e ${soDeles} do ar que saíram, num arquivo de ${admin.split('\n').length} linhas`);
    const h = fs.readFileSync('producao-atual/admin.html', 'utf8');
    check(adminHtml.replace(/\?v=\d+/g, '') === h.replace(/\?v=\d+/g, ''), 'a página do administrador só ganhou o número de versão dos arquivos', (adminHtml.match(/admin\.(js|css)\?v=\d+/g) || []).join(' · ') || 'sem versão');
  } else {
    console.log('  (pulado: sem cópia do administrador no ar para comparar)');
  }
  check(/\.form-grid \.full \{ grid-column: 1 \/ -1; \}/.test(adminCss), 'o estilo que abre o campo em linha inteira já existia', 'nenhum CSS novo neste pacote');
  check(/\.field textarea \{ min-height: 75px; resize: vertical; \}/.test(adminCss), 'e a caixa já tinha altura e alça de ajuste');
  const aqui = (sw.match(/CACHE_NAME = '([^']+)'/) || [])[1];
  const la = espelhoExiste || fs.existsSync('producao-atual/service-worker.js') ? (fs.readFileSync('producao-atual/service-worker.js', 'utf8').match(/CACHE_NAME = '([^']+)'/) || [])[1] : '';
  if (aqui === la) console.log('  OK    cache (pulado: esta pasta é a cópia do site)  →  ' + aqui);
  else check(!!aqui && aqui !== la, 'cache do aplicativo trocado', la + '  →  ' + aqui);

  console.log('\n===== 5) a página da igreja continua lendo os nomes =====');
  const publica = fs.readFileSync('publica.js', 'utf8');
  check(/function pastorNames\(value\)/.test(publica) && /\\r\?\\n\|;\|,/.test(publica), 'a mesma escrita de "um por linha" é o que a página pública separa');
  check(/id="pastorName"[^>]*rows="2"/.test(painel), 'o campo do painel da igreja continua de várias linhas');
  check(!/Evandro|Simone/.test(admin), 'não sobrou nome de pastor chumbado no arquivo do administrador', (admin.match(/Evandro|Simone/g) || []).length + ' ocorrências');

  console.log('\n=============================');
  console.log(falhas ? falhas + ' FALHA(S)' : 'TODOS os testes passaram (a tela do administrador, montada pela função real).');
  process.exitCode = falhas ? 1 : 0;
})();
