/**
 * Prova da segurança do administrador: 2FA TOTP de verdade e ping do PostgreSQL.
 *
 *   node teste-admin-seguranca.js
 */
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const admin = fs.readFileSync('admin.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const schema = fs.readFileSync('schema.sql', 'utf8');
const html = fs.readFileSync('admin.html', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const css = fs.readFileSync('admin.css', 'utf8');

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

console.log('\n===== 1) o banco e as rotas de 2FA existem =====');
check(/two_factor_enabled/.test(schema) && /two_factor_secret_ciphertext/.test(schema), 'users tem colunas de 2FA (ativo, segredo cifrado)');
check(/two_factor_confirmed_at/.test(schema) && /two_factor_recovery_code_hashes/.test(schema), 'users tem confirmação e hashes de recuperação');
check(/app\.post\('\/api\/me\/security\/2fa\/start'/.test(server), 'POST /api/me/security/2fa/start');
check(/app\.post\('\/api\/me\/security\/2fa\/confirm'/.test(server), 'POST /api/me/security/2fa/confirm');
check(/app\.post\('\/api\/me\/security\/2fa\/disable'/.test(server), 'POST /api/me/security/2fa/disable');
check(/app\.post\('\/api\/auth\/login\/2fa'/.test(server), 'POST /api/auth/login/2fa');
check(/requiresTwoFactor/.test(server) && /purpose: '2fa-login'/.test(server), 'o login comum devolve ticket quando o 2FA está ativo');
check(/aes-256-gcm/.test(server) && /emaus-2fa:/.test(server), 'o segredo TOTP fica em AES-256-GCM, não em texto puro');
check(/function pingDatabase/.test(server) && /server_version/.test(server) && /SELECT NOW\(\)/.test(server), 'o ping do banco é SELECT NOW() + versão, sem snapshot inventado');
check(!/prepared:\s*true/.test(server), 'GET /api/me/security não mente com prepared: true');

console.log('\n===== 2) TOTP de verdade: gera, verifica, rejeita, cifra =====');
const totpFonte = [
  "const TOTP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';",
  "const JWT_SECRET = 'emaus-teste-2fa';",
  funcaoDe(server, 'base32Encode'),
  funcaoDe(server, 'base32Decode'),
  funcaoDe(server, 'generateTotpSecret'),
  funcaoDe(server, 'hotp'),
  funcaoDe(server, 'totpAt'),
  funcaoDe(server, 'verifyTotp'),
  funcaoDe(server, 'twoFactorKey'),
  funcaoDe(server, 'encryptTotpSecret'),
  funcaoDe(server, 'decryptTotpSecret'),
  funcaoDe(server, 'generateRecoveryCodes')
].join('\n');
check(totpFonte.split('\n').every((linha, i, arr) => true) && totpFonte.includes('function verifyTotp'), 'as funções TOTP foram extraídas do server.js');
const totpCtx = { console, Math, Number, String, Array, Buffer, crypto, Date };
vm.createContext(totpCtx);
vm.runInContext(totpFonte, totpCtx);
const secret = vm.runInContext('generateTotpSecret()', totpCtx);
check(/^[A-Z2-7]{32}$/.test(secret), 'o segredo TOTP tem 32 caracteres base32', secret);
const codeNow = vm.runInContext(`totpAt(${JSON.stringify(secret)})`, totpCtx);
check(/^\d{6}$/.test(codeNow), 'o código TOTP tem 6 dígitos', codeNow);
check(vm.runInContext(`verifyTotp(${JSON.stringify(secret)}, ${JSON.stringify(codeNow)})`, totpCtx) === true, 'o código atual passa');
check(vm.runInContext(`verifyTotp(${JSON.stringify(secret)}, '000000')`, totpCtx) === false, '000000 não passa');
check(vm.runInContext(`verifyTotp(${JSON.stringify(secret)}, 'abcdef')`, totpCtx) === false, 'letra no lugar do código não passa');
const roundtrip = vm.runInContext(`(() => { const s = ${JSON.stringify(secret)}; return decryptTotpSecret(encryptTotpSecret(s)) === s; })()`, totpCtx);
check(roundtrip === true, 'cifrar e decifrar devolve o mesmo segredo');
const recovery = vm.runInContext('generateRecoveryCodes()', totpCtx);
check(Array.isArray(recovery) && recovery.length === 8, 'são 8 códigos de recuperação', String(recovery.length));
check(recovery.every(item => /^[0-9a-f]{4}-[0-9a-f]{4}$/.test(item)), 'cada código de recuperação tem o formato xxxx-xxxx');

console.log('\n===== 3) a tela do administrador deixa de fingir =====');
check(!/Preparada para ativação guiada/i.test(admin), 'sumiu o selo "preparada para ativação guiada"');
check(!/Backup PostgreSQL/.test(admin), 'o cartão não se chama mais Backup PostgreSQL');
check(!/Não verificado/.test(admin), 'sumiu o selo estático "Não verificado"');
check(/data-admin-action="two-factor-start"/.test(admin) && /Ativar/.test(admin), 'há botão Ativar 2FA');
check(/data-admin-form="two-factor-confirm"/.test(admin) && /Confirmar e ativar/.test(admin), 'há formulário de confirmar o código');
check(/data-admin-form="two-factor-disable"/.test(admin) && /Desativar/.test(admin), 'há formulário de desativar');
check(/data-admin-action="ping-database"/.test(admin) && /Verificar agora/.test(admin), 'há botão de ping no PostgreSQL');
check(/\/api\/auth\/login\/2fa/.test(admin) && /requiresTwoFactor/.test(admin), 'o login pede o código quando a API devolve ticket');
check(/adminOtpField/.test(html) && /name="otp"/.test(html), 'o formulário de entrada tem o campo 2FA escondido');
check(/emaus-shell-v95-admin-seguranca/.test(sw), 'cache novo v95');
check(/admin\.css\?v=63/.test(html) && /admin\.js\?v=62/.test(html), 'a página chama os arquivos com versão nova', (html.match(/admin\.(js|css)\?v=\d+/g) || []).join(' · '));
check(/setting-card\.span-2/.test(css) && /recovery-codes/.test(css), 'o CSS do 2FA e dos códigos de recuperação está na folha');

console.log('\n===== 4) renderSettings monta o HTML a partir do ping e do 2FA reais =====');
const renderFn = funcaoDe(admin, 'renderSettings');
check(!!renderFn, 'renderSettings existe');
function htmlSettings(overrides) {
  const ctx = {
    console, Math, Number, String, Array, Object, Boolean,
    state: { security: null, database: null, audit: [], ...(overrides.state || {}) },
    twoFactorSetup: overrides.twoFactorSetup || null,
    recoveryCodesOnce: overrides.recoveryCodesOnce || null,
    esc: v => String(v ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])),
    number: v => Number(v || 0).toLocaleString('pt-BR'),
    formatDateTime: v => v ? '06/10/2026' : '—'
  };
  vm.createContext(ctx);
  vm.runInContext(renderFn, ctx);
  return vm.runInContext('renderSettings()', ctx);
}
const desligada = htmlSettings({ state: { security: { enabled: false }, database: { ok: true, version: '16.4', roundtripMs: 7, at: '2026-10-06T19:00:00Z' }, audit: [] } });
check(/Desligada/.test(desligada), 'sem 2FA o selo é Desligada');
check(/Ativar/.test(desligada) && /data-admin-action="two-factor-start"/.test(desligada), 'sem 2FA aparece Ativar');
check(/Conectado/.test(desligada) && /16\.4/.test(desligada) && /7/.test(desligada), 'com ping ok o selo é Conectado e mostra a versão');
check(!/Não verificado/.test(desligada) && !/Preparada/.test(desligada), 'nenhum selo de mentira no HTML gerado');
const ativa = htmlSettings({ state: { security: { enabled: true, confirmedAt: '2026-10-06', recoveryRemaining: 8 }, database: { ok: true, version: '16.4', roundtripMs: 4, at: '2026-10-06' }, audit: [] } });
check(/Ativa/.test(ativa) && /Desativar/.test(ativa), 'com 2FA ativo dá para desativar');
check(/8/.test(ativa), 'mostra quantos códigos de recuperação restam');
const setup = htmlSettings({
  twoFactorSetup: { ticket: 't', secret: 'ABCD', manualKey: 'ABCD EFGH', otpauth: 'otpauth://totp/Emaus:a@b' },
  state: { security: { enabled: false }, database: { ok: false }, audit: [] }
});
check(/Confirmar e ativar/.test(setup) && /ABCD EFGH/.test(setup), 'na ativação aparece a chave e o confirmar');
check(/Indisponível/.test(setup), 'ping falho vira Indisponível, não um backup inventado');
const codes = htmlSettings({
  recoveryCodesOnce: ['aaaa-bbbb', 'cccc-dddd'],
  state: { security: { enabled: true, recoveryRemaining: 8 }, database: { ok: true, version: '16', roundtripMs: 1, at: 'x' }, audit: [] }
});
check(/aaaa-bbbb/.test(codes) && /Já anotei/.test(codes), 'os códigos de recuperação aparecem uma vez, para anotar');

console.log('\n===== 5) o comercial da v25 continua no lugar =====');
check(/priceAfterDiscount/.test(server) && /discount_percent/.test(schema), 'desconto da v25 segue no servidor e no schema');
check(/data-admin-form="commercial-discount"/.test(admin), 'a ficha da igreja ainda aplica desconto');
check(/Desempenho real · 12 meses/.test(admin), 'o gráfico de 12 meses continua');
check(/<textarea id="newChurchAdmin" name="admin" rows="2"/.test(admin), 'o cadastro de vários pastores continua');

console.log(`\n${falhas ? 'FALHA' : '  OK    '} ${falhas ? falhas + ' falha(s)' : 'todas as conferências'} — segurança do administrador`);
if (falhas) process.exitCode = 1;
