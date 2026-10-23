// MomoEquilibrio · servidor: entrega o app e envia lembretes push (mesmo com o app fechado).
const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const montarPainel = require('./painel');

const app = express();
app.set('trust proxy', 1); // Railway fica atrás de proxy HTTPS
app.use(express.json({ limit: '100kb' }));
// Entrega somente os arquivos do front-end (lista fechada: dados e código do servidor nunca são expostos)
const ARQUIVOS_PUBLICOS = ['index.html', 'sw.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'logo-completo.png'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(__dirname, 'privacidade.html')));
for (const f of ARQUIVOS_PUBLICOS) {
  app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f)));
}

// ---------- chaves VAPID ----------
// Preferência: variáveis VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no Railway.
// Se não existirem, gera um par uma vez e guarda no volume de dados (DATA_DIR).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// segredo de assinatura das sessões: variável SESSION_SECRET ou arquivo no volume
let SEGREDO = process.env.SESSION_SECRET;
if (!SEGREDO) {
  const arqSeg = path.join(DATA_DIR, 'session.key');
  try { SEGREDO = fs.readFileSync(arqSeg, 'utf8').trim(); } catch (e) { SEGREDO = ''; }
  if (!SEGREDO) {
    SEGREDO = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(arqSeg, SEGREDO);
  }
}
let PUB = process.env.VAPID_PUBLIC_KEY;
let PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJ = process.env.VAPID_SUBJECT || 'mailto:contato@exemplo.com';
if (!PUB || !PRIV) {
  const arq = path.join(DATA_DIR, 'vapid.json');
  let k = null;
  try { k = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { k = null; }
  if (!k || !k.publicKey || !k.privateKey) {
    k = webpush.generateVAPIDKeys();
    fs.writeFileSync(arq, JSON.stringify(k));
    console.warn('[AVISO] Chaves VAPID geradas e salvas em ' + arq + '. Recomendado: definir VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nas variáveis do Railway.');
  }
  PUB = k.publicKey; PRIV = k.privateKey;
}
webpush.setVapidDetails(SUBJ, PUB, PRIV);

// ---------- armazenamento simples em arquivo (use volume no Railway) ----------
const DB_FILE = path.join(DATA_DIR, 'inscricoes.json');
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = {}; }
function salvar() {
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}

// ---------- contas (e-mail e senha) ----------
const USERS_FILE = path.join(DATA_DIR, 'usuarios.json');
let usuarios = {};
try { usuarios = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { usuarios = {}; }
function salvarUsuarios() {
  fs.writeFileSync(USERS_FILE + '.tmp', JSON.stringify(usuarios));
  fs.renameSync(USERS_FILE + '.tmp', USERS_FILE);
}
function hashSenha(senha, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(senha, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))));
}
function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
  return corpo + '.' + sig;
}
// sessões ficam no servidor: sair invalida o acesso mesmo que o cookie antigo seja reutilizado
const SESS_FILE = path.join(DATA_DIR, 'sessoes.json');
let sessoes = {};
try { sessoes = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')); } catch (e) { sessoes = {}; }
function salvarSessoes() {
  const agora = Date.now();
  for (const k of Object.keys(sessoes)) if (sessoes[k].exp < agora) delete sessoes[k];
  fs.writeFileSync(SESS_FILE + '.tmp', JSON.stringify(sessoes));
  fs.renameSync(SESS_FILE + '.tmp', SESS_FILE);
}
function decodificarCookie(req) {
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('eq_sess='));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice('eq_sess='.length));
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try { return JSON.parse(Buffer.from(corpo, 'base64url').toString()); } catch (e) { return null; }
}
function lerSessao(req) {
  const p = decodificarCookie(req);
  if (!p || !p.sid) return null;
  const s = sessoes[p.sid];
  if (!s || s.exp < Date.now() || !usuarios[s.email]) return null;
  return { email: s.email };
}
function exigeLogin(req, res, next) {
  const s = lerSessao(req);
  if (!s) return res.status(401).json({ erro: 'faça login para continuar' });
  req.usuario = s.email;
  next();
}
function criarSessao(req, res, email) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const sid = crypto.randomBytes(24).toString('hex');
  sessoes[sid] = { email, exp };
  salvarSessoes();
  res.setHeader('Set-Cookie', `eq_sess=${encodeURIComponent(assinar({ sid }))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${req.secure ? '; Secure' : ''}`);
}

// limite simples de tentativas de login (por e-mail e por IP)
const tentativas = new Map();
function muitasTentativas(chave) {
  const agora = Date.now();
  const t = (tentativas.get(chave) || []).filter(x => agora - x < 15 * 60000);
  tentativas.set(chave, t);
  return t.length >= 10;
}
function registrarFalha(chave) {
  tentativas.set(chave, [...(tentativas.get(chave) || []), Date.now()]);
}

function normEmail(e) { return typeof e === 'string' ? e.trim().toLowerCase() : ''; }
function emailValido(e) { return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

app.post('/api/auth/cadastro', async (req, res) => {
  const email = normEmail((req.body || {}).email);
  const senha = typeof (req.body || {}).senha === 'string' ? req.body.senha : '';
  if (!emailValido(email)) return res.status(400).json({ erro: 'e-mail inválido' });
  if (senha.length < 8 || senha.length > 200) return res.status(400).json({ erro: 'a senha deve ter entre 8 e 200 caracteres' });
  if (usuarios[email]) return res.status(409).json({ erro: 'já existe uma conta com este e-mail' });
  const salt = crypto.randomBytes(16).toString('hex');
  usuarios[email] = { salt, hash: await hashSenha(senha, salt), criadoEm: new Date().toISOString(), ...painel.camposNovaConta() };
  salvarUsuarios();
  criarSessao(req, res, email);
  res.json({ ok: true, email });
});

app.post('/api/auth/entrar', async (req, res) => {
  const email = normEmail((req.body || {}).email);
  const senha = typeof (req.body || {}).senha === 'string' ? req.body.senha : '';
  const chaveIp = 'ip:' + req.ip;
  const chaveMail = 'mail:' + email;
  if (muitasTentativas(chaveIp) || muitasTentativas(chaveMail)) {
    return res.status(429).json({ erro: 'muitas tentativas. Aguarde 15 minutos e tente de novo.' });
  }
  const u = usuarios[email];
  const ok = u && (await hashSenha(senha, u.salt)) === u.hash;
  if (!ok) {
    registrarFalha(chaveIp); registrarFalha(chaveMail);
    return res.status(401).json({ erro: 'e-mail ou senha incorretos' });
  }
  criarSessao(req, res, email);
  res.json({ ok: true, email });
});

app.post('/api/auth/sair', (req, res) => {
  const p = decodificarCookie(req);
  if (p && p.sid && sessoes[p.sid]) { delete sessoes[p.sid]; salvarSessoes(); }
  res.setHeader('Set-Cookie', 'eq_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/auth/eu', (req, res) => {
  const s = lerSessao(req);
  if (!s) return res.status(401).json({ erro: 'não logado' });
  res.json({ email: s.email });
});

// ---------- painel administrativo, planos e pagamentos ----------
const painel = montarPainel({ app, DATA_DIR, usuarios, salvarUsuarios, hashSenha, exigeLogin, assinar, SEGREDO, webpush, db, salvarDb: salvar, normEmail, emailValido, muitasTentativas, registrarFalha });

// ---------- API ----------
app.get('/api/health', (req, res) => res.json({ ok: true, inscricoes: Object.keys(db).length }));
app.get('/api/vapid-public-key', (req, res) => res.json({ publicKey: PUB }));

app.post('/api/subscribe', exigeLogin, (req, res) => {
  const { subscription, schedule } = req.body || {};
  if (!subscription || typeof subscription.endpoint !== 'string') return res.status(400).json({ erro: 'inscrição inválida' });
  const s = schedule || {};
  const tz = typeof s.tz === 'string' ? s.tz : 'America/Sao_Paulo';
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: tz }); } catch (e) { return res.status(400).json({ erro: 'fuso inválido' }); }
  const atual = db[subscription.endpoint] || {};
  db[subscription.endpoint] = {
    usuario: req.usuario,
    subscription,
    schedule: {
      tz,
      aguaIntervalo: Math.max(30, Math.min(240, Number(s.aguaIntervalo) || 120)),
      refs: s.refs && typeof s.refs === 'object' ? s.refs : { cafe: '08:00', almoco: '12:30', lanche: '16:00', jantar: '19:30' },
      aplic: s.aplic && Number.isInteger(s.aplic.dia) ? { dia: s.aplic.dia, hora: String(s.aplic.hora || '08:00') } : null
    },
    ultimaAgua: atual.ultimaAgua || Date.now(),
    enviados: atual.enviados || {}
  };
  salvar();
  res.json({ ok: true });
});

app.post('/api/unsubscribe', exigeLogin, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint && db[endpoint] && db[endpoint].usuario === req.usuario) { delete db[endpoint]; salvar(); }
  res.json({ ok: true });
});

// ---------- agendador: roda a cada minuto, no fuso de cada usuário ----------
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function agoraNoFuso(tz) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
  return {
    dataKey: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
    hora: Number(p.hour),
    dia: DIAS[p.weekday]
  };
}

async function enviar(entrada, titulo, corpo, tag) {
  try {
    await webpush.sendNotification(entrada.subscription, JSON.stringify({ titulo, corpo, tag }), { TTL: 3600 });
    return true;
  } catch (err) {
    // 404/410: a inscrição expirou ou foi revogada no navegador
    if (err.statusCode === 404 || err.statusCode === 410) return 'remover';
    console.error('falha ao enviar push:', err.statusCode || err.message);
    return false;
  }
}

async function ciclo() {
  const agora = Date.now();
  let mudou = false;
  for (const [endpoint, entrada] of Object.entries(db)) {
    if (!painel.podeReceberPush(entrada.usuario)) continue; // conta vencida: sem lembretes
    const { schedule: s } = entrada;
    const n = agoraNoFuso(s.tz);

    // limpa marcações de dias anteriores
    for (const k of Object.keys(entrada.enviados)) {
      if (!k.startsWith(n.dataKey)) { delete entrada.enviados[k]; mudou = true; }
    }

    const fila = [];
    // aviso de vencimento: faltando 3 dias, 2 dias e no dia. Uma vez por dia, entre 9h e 20h.
    const av = painel.avisoVencimento(usuarios[entrada.usuario]);
    if (av && n.hora >= 9 && n.hora < 20) {
      const chave = n.dataKey + 'venc' + av.nivel;
      if (!entrada.enviados[chave]) {
        entrada.enviados[chave] = true; mudou = true;
        fila.push(['MomoEquilibrio', av.texto, 'vencimento']);
      }
    }
    // água: entre 7h e 21h, no intervalo configurado
    if (n.hora >= 7 && n.hora < 21 && agora - entrada.ultimaAgua >= s.aguaIntervalo * 60000) {
      entrada.ultimaAgua = agora; mudou = true;
      fila.push(['💧 Hora de beber água', 'Lembrete de hidratação. Registre o que já tomou no app.', 'agua']);
    }
    // refeições
    for (const [nome, hora] of Object.entries(s.refs)) {
      const chave = n.dataKey + nome;
      if (hora === n.hhmm && !entrada.enviados[chave]) {
        entrada.enviados[chave] = true; mudou = true;
        fila.push([`🍽️ Hora do ${nome}`, 'Confira a receita da sua fase no app.', nome]);
      }
    }
    // aplicação
    if (s.aplic && s.aplic.dia === n.dia && s.aplic.hora === n.hhmm) {
      const chave = n.dataKey + 'aplic';
      if (!entrada.enviados[chave]) {
        entrada.enviados[chave] = true; mudou = true;
        fila.push(['💉 Lembrete', 'Hoje é dia do seu acompanhamento. Abra o app para ver os detalhes.', 'aplic']);
      }
    }

    for (const [t, c, tag] of fila) {
      const r = await enviar(entrada, t, c, tag);
      if (r === 'remover') { delete db[endpoint]; mudou = true; break; }
    }
  }
  if (mudou) salvar();
}
setInterval(() => { ciclo().catch(e => console.error('erro no agendador:', e.message)); }, 60000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`MomoEquilibrio rodando na porta ${PORT}`));
