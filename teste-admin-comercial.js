/**
 * Prova da área comercial do administrador: teste grátis, desconto,
 * dias promocionais e gráfico real de recebido × gastos × lucro.
 *
 *   node teste-admin-comercial.js
 */
const fs = require('fs');
const vm = require('vm');

const admin = fs.readFileSync('admin.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const schema = fs.readFileSync('schema.sql', 'utf8');
const billing = fs.readFileSync('billing-mercadopago.js', 'utf8');
const html = fs.readFileSync('admin.html', 'utf8');

let falhas = 0;
const check = (cond, rotulo, extra) => {
  if (cond) console.log('  OK    ' + rotulo + (extra !== undefined ? '  →  ' + extra : ''));
  else { falhas++; console.log('  FALHA ' + rotulo + (extra !== undefined ? '  →  ' + extra : '')); }
};

function funcaoDe(texto, nome) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(texto);
  if (!m) return null;
  let fundo = 0, profundidadeParenteses = 0, inicio = -1;
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

console.log('\n===== 1) o banco aceita desconto e a regra de teste =====');
check(/discount_percent/.test(schema) && /discount_cents/.test(schema) && /discount_note/.test(schema), 'igreja ganhou colunas de desconto (percentual, reais e motivo)');
check(/commercial_policy/.test(schema) && /trialDays/.test(schema), 'a regra de teste grátis padrão mora em platform_settings');
check(/function priceAfterDiscount/.test(server), 'a conta do desconto é uma função, não um número chumbado');
check(/app\.(get|put)\('\/api\/admin\/policy'/.test(server), 'há rota para ler e gravar os dias de teste padrão');
check(/app\.post\('\/api\/admin\/churches\/:churchId\/commercial'/.test(server), 'há rota por igreja: dias promocionais, teste e desconto');
check(/grant-days/.test(server) && /set-trial/.test(server) && /set-discount/.test(server) && /clear-discount/.test(server) && /end-trial/.test(server), 'as cinco ações comerciais existem no servidor');

console.log('\n===== 2) a conta do desconto, executada de verdade =====');
const ctx = { console, Math, Number };
vm.createContext(ctx);
vm.runInContext(
  funcaoDe(server, 'clampDiscountPercent') + '\n' +
  funcaoDe(server, 'clampDiscountCents') + '\n' +
  funcaoDe(server, 'priceAfterDiscount'),
  ctx
);
const preco = (plano, pct, extra) => vm.runInContext(`priceAfterDiscount(${plano}, ${pct}, ${extra})`, ctx);
check(preco(10000, 0, 0) === 10000, 'sem desconto, a mensalidade é a do plano', 'R$ 100,00');
check(preco(10000, 20, 0) === 8000, '20% de R$ 100,00 = R$ 80,00');
check(preco(10000, 0, 1500) === 8500, 'R$ 15,00 a menos em R$ 100,00 = R$ 85,00');
check(preco(10000, 10, 500) === 8500, '10% e mais R$ 5,00 = R$ 85,00');
check(preco(10000, 100, 0) === 0, '100% zera a mensalidade (igreja de cortesia)');
check(preco(10000, 200, 0) === 0, 'percentual acima de 100 não vira negativo');

console.log('\n===== 3) gráfico e lucro saem do que foi pago e do que foi gasto =====');
check(/function monthFinanceSeries/.test(server), 'a série mensal é montada no servidor');
check(/billing_payments/.test(server) && /PAID_PAYMENT_STATUSES/.test(server), 'recebido = pagamentos aprovados, não a mensalidade cadastrada');
check(/generate_series/.test(server) && /11 months/.test(server), 'são 12 meses, inclusive os zerados');
check(/paidThisMonth/.test(server) && /profitThisMonth/.test(server), 'o resumo do mês separa recebido e lucro');
check(/expense_date/.test(server) && /req\.body\.date/.test(server), 'o gasto aceita a data — entra no mês certo do gráfico');
check(/amountCents/.test(billing) && /monthly_price_cents/.test(billing), 'a cobrança do Mercado Pago usa a mensalidade já com desconto');

console.log('\n===== 4) a tela do administrador =====');
check(/data-admin-form="policy"/.test(admin) && /policyTrialDays/.test(admin), 'em Planos dá para gravar os dias de teste padrão');
check(/data-admin-form="commercial-days"/.test(admin), 'na igreja dá para somar dias promocionais');
check(/data-admin-form="commercial-trial"/.test(admin), 'e recomeçar o teste');
check(/data-admin-form="commercial-discount"/.test(admin), 'e aplicar desconto em % ou em reais');
check(/data-admin-action="clear-discount"/.test(admin) && /data-admin-action="end-trial"/.test(admin), 'dá para tirar o desconto e encerrar o teste');
check(/newChurchTrial/.test(admin), 'ao cadastrar igreja nova já escolhe os dias de teste');
check(/Desempenho real · 12 meses/.test(admin), 'o financeiro diz que o gráfico é real e de 12 meses');
check(/pagamentos aprovados/.test(admin), 'não mistura previsto com recebido');
check(/expenseDate/.test(admin), 'o lançamento de gasto tem data');
check(/<textarea id="newChurchAdmin" name="admin" rows="2"/.test(admin), 'o cadastro de pastores (várias linhas) continua no lugar');
check(/name="pastors"/.test(admin), 'a edição da igreja continua com a caixa de pastores');

console.log('\n===== 5) o gráfico monta 12 colunas, sem número inventado =====');
const chartFn = funcaoDe(admin, 'renderChart');
check(!!chartFn, 'renderChart existe');
const chartCtx = {
  console, Math, Number, String, Array, Object,
  state: { platformFinance: { months: Array.from({ length: 12 }, (_, i) => ({ label: `m${i + 1}`, income: i === 11 ? 100 : 0, expense: i === 11 ? 40 : 0 })) } },
  monthMax: () => 100,
  esc: v => String(v ?? ''),
  money: v => String(v),
  moneyOrUnavailable: v => String(v)
};
vm.createContext(chartCtx);
vm.runInContext(chartFn, chartCtx);
const htmlChart = vm.runInContext('renderChart()', chartCtx);
check((htmlChart.match(/chart-column/g) || []).length === 12, 'doze colunas no gráfico', String((htmlChart.match(/chart-column/g) || []).length));
check(/Recebido:/.test(htmlChart) && /Gastos:/.test(htmlChart), 'cada barra diz se é recebido ou gasto');
check(!/18,4%|12,8%|47,4%/.test(admin), 'nenhum percentual de demonstração no administrador');

console.log('\n===== 6) cache da área administrativa =====');
check(/admin\.css\?v=62/.test(html) && /admin\.js\?v=61/.test(html), 'a página chama os arquivos com versão nova', (html.match(/admin\.(js|css)\?v=\d+/g) || []).join(' · '));

console.log(`\n${falhas ? 'FALHA' : '  OK    '} ${falhas ? falhas + ' falha(s)' : 'todas as conferências'} — comercial do administrador`);
if (falhas) process.exitCode = 1;
