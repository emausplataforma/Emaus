// Painel administrativo, planos, pagamentos (Mercado Pago), mensagens e controle de acesso.
// Regras: nunca apaga contas. Campos novos são opcionais e preenchidos só quando estão vazios.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIA = 86400000;
const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

module.exports = function montarPainel(d) {
  const { app, DATA_DIR, usuarios, salvarUsuarios, hashSenha, exigeLogin, assinar, SEGREDO, webpush, db, salvarDb, normEmail, emailValido, muitasTentativas, registrarFalha } = d;

  // ---------- dados financeiros (arquivo separado das contas) ----------
  const FIN_FILE = path.join(DATA_DIR, 'financeiro.json');
  const PADRAO = {
    planos: {
      basico: { nome: 'Básico', preco: 19.9, dias: 30 },
      plus: { nome: 'Plus', preco: 29.9, dias: 30 },
      premium: { nome: 'Premium', preco: 39.9, dias: 90 },
    },
    config: { diasTeste: 7, diasMigracao: 30 },
    pagamentos: [],
    despesas: [],
    mensagens: [],
  };
  let fin = {};
  try { fin = JSON.parse(fs.readFileSync(FIN_FILE, 'utf8')); } catch (e) { fin = {}; }
  for (const k of Object.keys(PADRAO)) if (fin[k] === undefined) fin[k] = JSON.parse(JSON.stringify(PADRAO[k]));
  for (const k of Object.keys(PADRAO.planos)) if (!fin.planos[k]) fin.planos[k] = { ...PADRAO.planos[k] };
  for (const k of Object.keys(PADRAO.config)) if (fin.config[k] === undefined) fin.config[k] = PADRAO.config[k];

  function salvarFin() {
    fs.writeFileSync(FIN_FILE + '.tmp', JSON.stringify(fin));
    fs.renameSync(FIN_FILE + '.tmp', FIN_FILE);
  }

  // ---------- migração segura das contas existentes ----------
  // Antes de qualquer mudança, guarda uma cópia do arquivo de contas (uma única vez).
  const BACKUP_CONTAS = path.join(DATA_DIR, 'usuarios.backup-antes-painel.json');
  const USERS_FILE = path.join(DATA_DIR, 'usuarios.json');
  let mudouContas = false;
  for (const u of Object.values(usuarios)) {
    if (u.acessoAte === undefined) { u.acessoAte = new Date(Date.now() + fin.config.diasMigracao * DIA).toISOString(); mudouContas = true; }
    if (u.plano === undefined) { u.plano = 'basico'; mudouContas = true; }
    if (u.desconto === undefined) { u.desconto = 0; mudouContas = true; }
    if (u.trocarSenha === undefined) { u.trocarSenha = false; mudouContas = true; }
  }
  if (mudouContas) {
    if (!fs.existsSync(BACKUP_CONTAS) && fs.existsSync(USERS_FILE)) fs.copyFileSync(USERS_FILE, BACKUP_CONTAS);
    salvarUsuarios();
  }
  salvarFin();

  // campos para novas contas (chamado no cadastro)
  function camposNovaConta() {
    return { plano: null, acessoAte: new Date(Date.now() + fin.config.diasTeste * DIA).toISOString(), desconto: 0, trocarSenha: false };
  }

  // ---------- regras de acesso ----------
  function status(u) {
    if (!u || !u.acessoAte) return 'vencido';
    return new Date(u.acessoAte).getTime() > Date.now() ? 'ativo' : 'vencido';
  }
  // Aviso de vencimento: conta por dias do calendário de São Paulo.
  // Níveis: 3 dias, 2 dias e no dia do vencimento. Depois do horário, a conta fica bloqueada.
  const fmtDia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  function avisoVencimento(u) {
    if (!u || !u.acessoAte || status(u) !== 'ativo') return null;
    const [ay, am, ad] = fmtDia(new Date(u.acessoAte)).split('-').map(Number);
    const [hy, hm, hd] = fmtDia(new Date()).split('-').map(Number);
    const diff = Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(hy, hm - 1, hd)) / DIA);
    if (diff === 3) return { nivel: 3, texto: 'Seu acesso vence em 3 dias. Renove para não perder o acompanhamento.' };
    if (diff === 2) return { nivel: 2, texto: 'Seu acesso vence em 2 dias. Renove para continuar sem interrupções.' };
    if (diff === 0) return { nivel: 0, texto: 'Seu acesso vence hoje. Renove para não ser bloqueado amanhã.' };
    return null;
  }
  function podeReceberPush(email) { return status(usuarios[email]) === 'ativo'; }
  function somarDias(u, dias) {
    const base = Math.max(Date.now(), u.acessoAte ? new Date(u.acessoAte).getTime() : 0);
    u.acessoAte = new Date(base + dias * DIA).toISOString();
  }
  function registrarPagamento(p) {
    fin.pagamentos.push({ id: crypto.randomUUID(), data: new Date().toISOString(), ...p });
    salvarFin();
  }
  function listaPlanos(u) {
    const desc = Math.min(100, Math.max(0, Number(u.desconto) || 0));
    return Object.entries(fin.planos).map(([id, p]) => ({
      id, nome: p.nome, dias: p.dias, preco: round(p.preco), precoFinal: round(p.preco * (100 - desc) / 100),
    }));
  }
  function mensagensDo(email) {
    const lidas = (usuarios[email] && usuarios[email].mensagensLidas) || [];
    return fin.mensagens
      .filter(m => m.para === 'todos' || m.para === email)
      .map(m => ({ id: m.id, titulo: m.titulo, texto: m.texto, data: m.data, lida: lidas.includes(m.id) }))
      .reverse();
  }

  // ---------- Mercado Pago ----------
  const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
  function baseUrl(req) { return process.env.PUBLIC_URL || `https://${req.headers.host}`; }

  async function criarPreferencia(req, email, planoId) {
    const u = usuarios[email];
    const p = fin.planos[planoId];
    const desc = Math.min(100, Math.max(0, Number(u.desconto) || 0));
    const valor = round(p.preco * (100 - desc) / 100);
    const base = baseUrl(req);
    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + MP_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: `MomoEquilibrio - Plano ${p.nome} (${p.dias} dias)`, quantity: 1, unit_price: valor, currency_id: 'BRL' }],
        payer: { email },
        external_reference: `${planoId}|${email}`,
        back_urls: { success: base + '/?pagamento=ok', failure: base + '/?pagamento=falhou', pending: base + '/?pagamento=pendente' },
        auto_return: 'approved',
        notification_url: base + '/api/pagamento/webhook',
      }),
    });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.message || 'falha ao criar pagamento');
    return j.init_point;
  }

  app.post('/api/pagamento/webhook', (req, res) => {
    res.sendStatus(200);
    (async () => {
      const id = (req.body && req.body.data && req.body.data.id) || req.query['data.id'] || req.query.id;
      if (!id || !MP_TOKEN) return;
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + MP_TOKEN } });
      const pg = await r.json();
      if (pg.status !== 'approved') return;
      if (fin.pagamentos.some(x => x.mpId === String(pg.id))) return; // já processado
      const [planoId, email] = String(pg.external_reference || '').split('|');
      const u = usuarios[email];
      const p = fin.planos[planoId];
      if (!u || !p) return;
      somarDias(u, p.dias);
      u.plano = planoId;
      salvarUsuarios();
      registrarPagamento({ mpId: String(pg.id), email, plano: planoId, valorBruto: round(p.preco), valorPago: round(pg.transaction_amount), dias: p.dias, origem: 'automatico', situacao: 'aprovado' });
    })().catch(e => console.error('webhook pagamento:', e.message));
  });

  app.post('/api/pagamento/criar', exigeLogin, async (req, res) => {
    const plano = (req.body || {}).plano;
    if (!fin.planos[plano]) return res.status(400).json({ erro: 'plano inválido' });
    if (!MP_TOKEN) return res.status(503).json({ erro: 'Pagamento automático ainda não está configurado. Fale com o suporte.' });
    try {
      const url = await criarPreferencia(req, req.usuario, plano);
      res.json({ url });
    } catch (e) {
      console.error('criar pagamento:', e.message);
      res.status(500).json({ erro: 'não foi possível iniciar o pagamento. Tente de novo.' });
    }
  });

  // ---------- área do cliente ----------
  app.get('/api/conta', exigeLogin, (req, res) => {
    const u = usuarios[req.usuario];
    res.json({
      email: req.usuario,
      plano: u.plano || null,
      planoNome: u.plano && fin.planos[u.plano] ? fin.planos[u.plano].nome : null,
      acessoAte: u.acessoAte || null,
      status: status(u),
      desconto: u.desconto || 0,
      trocarSenha: !!u.trocarSenha,
      planos: listaPlanos(u),
      pagamentoAutomatico: !!MP_TOKEN,
      mensagens: mensagensDo(req.usuario),
      aviso: avisoVencimento(u),
    });
  });

  app.post('/api/conta/mensagens/lidas', exigeLogin, (req, res) => {
    const u = usuarios[req.usuario];
    const ids = new Set(mensagensDo(req.usuario).map(m => m.id));
    u.mensagensLidas = Array.from(new Set([...(u.mensagensLidas || []), ...[...ids]]));
    salvarUsuarios();
    res.json({ ok: true });
  });

  app.post('/api/conta/trocar-senha', exigeLogin, async (req, res) => {
    const u = usuarios[req.usuario];
    const { atual, nova } = req.body || {};
    if (typeof nova !== 'string' || nova.length < 8 || nova.length > 200) return res.status(400).json({ erro: 'a nova senha deve ter entre 8 e 200 caracteres' });
    if (!u.trocarSenha) {
      if (typeof atual !== 'string' || (await hashSenha(atual, u.salt)) !== u.hash) return res.status(401).json({ erro: 'senha atual incorreta' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    u.salt = salt;
    u.hash = await hashSenha(nova, salt);
    u.trocarSenha = false;
    salvarUsuarios();
    res.json({ ok: true });
  });

  // pedido de exclusão feito pelo próprio cliente: fica registrado para a equipe confirmar.
  // Não apaga nada automaticamente.
  app.post('/api/conta/pedido-exclusao', exigeLogin, (req, res) => {
    const u = usuarios[req.usuario];
    if (!u.pedidoExclusao) { u.pedidoExclusao = new Date().toISOString(); salvarUsuarios(); }
    res.json({ ok: true, registrado: u.pedidoExclusao });
  });

  // ---------- login do painel do administrador ----------
  const ADMIN_SENHA = process.env.ADMIN_SENHA;
  function adminLogado(req) {
    const c = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('eq_admin='));
    if (!c) return false;
    const token = decodeURIComponent(c.slice('eq_admin='.length));
    const [corpo, sig] = token.split('.');
    if (!corpo || !sig) return false;
    const esperado = crypto.createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
    if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return false;
    try { const p = JSON.parse(Buffer.from(corpo, 'base64url').toString()); return p.adm === 1 && p.exp > Date.now(); } catch (e) { return false; }
  }
  function exigeAdmin(req, res, next) {
    if (!ADMIN_SENHA) return res.status(503).json({ erro: 'defina a variável ADMIN_SENHA no Railway' });
    if (!adminLogado(req)) return res.status(401).json({ erro: 'entre no painel primeiro' });
    next();
  }

  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

  app.post('/api/admin/entrar', (req, res) => {
    if (!ADMIN_SENHA) return res.status(503).json({ erro: 'defina a variável ADMIN_SENHA no Railway' });
    const chave = 'admin:' + req.ip;
    if (muitasTentativas(chave)) return res.status(429).json({ erro: 'muitas tentativas. Aguarde 15 minutos.' });
    const senha = (req.body || {}).senha;
    const ok = typeof senha === 'string' && senha.length === ADMIN_SENHA.length && crypto.timingSafeEqual(Buffer.from(senha), Buffer.from(ADMIN_SENHA));
    if (!ok) { registrarFalha(chave); return res.status(401).json({ erro: 'senha incorreta' }); }
    const exp = Date.now() + 12 * 3600 * 1000;
    res.setHeader('Set-Cookie', `eq_admin=${encodeURIComponent(assinar({ adm: 1, exp }))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/sair', (req, res) => {
    res.setHeader('Set-Cookie', 'eq_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/admin/eu', exigeAdmin, (req, res) => res.json({ ok: true }));

  // ---------- resumo financeiro ----------
  function noMes(iso, ref) {
    const r = ref || new Date();
    const x = new Date(iso);
    return x.getFullYear() === r.getFullYear() && x.getMonth() === r.getMonth();
  }
  app.get('/api/admin/resumo', exigeAdmin, (req, res) => {
    const contas = Object.entries(usuarios);
    const ativos = contas.filter(([, u]) => status(u) === 'ativo').length;
    const aprovados = fin.pagamentos.filter(p => p.situacao === 'aprovado');
    const receitaMes = aprovados.filter(p => noMes(p.data)).reduce((s, p) => s + (p.valorPago || 0), 0);
    const despesaMes = fin.despesas.filter(x => noMes(x.data)).reduce((s, x) => s + (x.valor || 0), 0);
    const porPlano = {};
    for (const k of Object.keys(fin.planos)) porPlano[k] = contas.filter(([, u]) => u.plano === k && status(u) === 'ativo').length;
    const meses = [];
    const hoje = new Date();
    for (let i = 5; i >= 0; i--) {
      const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      meses.push({
        rotulo: ref.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        receita: round(aprovados.filter(p => noMes(p.data, ref)).reduce((s, p) => s + (p.valorPago || 0), 0)),
        despesa: round(fin.despesas.filter(x => noMes(x.data, ref)).reduce((s, x) => s + (x.valor || 0), 0)),
      });
    }
    res.json({
      totalContas: contas.length, ativos, vencidos: contas.length - ativos,
      receitaMes: round(receitaMes), despesaMes: round(despesaMes), lucroMes: round(receitaMes - despesaMes),
      porPlano, meses, pagamentoAutomatico: !!MP_TOKEN,
    });
  });

  // ---------- clientes ----------
  app.get('/api/admin/clientes', exigeAdmin, (req, res) => {
    const totalPago = {};
    for (const p of fin.pagamentos) if (p.situacao === 'aprovado') totalPago[p.email] = (totalPago[p.email] || 0) + (p.valorPago || 0);
    const lista = Object.entries(usuarios).map(([email, u]) => ({
      email,
      plano: u.plano || null,
      planoNome: u.plano && fin.planos[u.plano] ? fin.planos[u.plano].nome : '—',
      acessoAte: u.acessoAte || null,
      status: status(u),
      diasRestantes: u.acessoAte ? Math.ceil((new Date(u.acessoAte).getTime() - Date.now()) / DIA) : 0,
      desconto: u.desconto || 0,
      criadoEm: u.criadoEm || null,
      totalPago: round(totalPago[email] || 0),
      trocarSenha: !!u.trocarSenha,
      pedidoExclusao: u.pedidoExclusao || null,
    })).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    res.json(lista);
  });

  function contaDaRota(req, res) {
    const email = normEmail(decodeURIComponent(req.params.email));
    if (!usuarios[email]) { res.status(404).json({ erro: 'cliente não encontrado' }); return null; }
    return { email, u: usuarios[email] };
  }

  app.post('/api/admin/cliente/:email/dias', exigeAdmin, (req, res) => {
    const c = contaDaRota(req, res); if (!c) return;
    const dias = Math.round(Number((req.body || {}).dias));
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) return res.status(400).json({ erro: 'informe entre 1 e 3650 dias' });
    somarDias(c.u, dias); salvarUsuarios();
    res.json({ ok: true, acessoAte: c.u.acessoAte });
  });

  app.post('/api/admin/cliente/:email/plano', exigeAdmin, (req, res) => {
    const c = contaDaRota(req, res); if (!c) return;
    const plano = (req.body || {}).plano;
    if (!fin.planos[plano]) return res.status(400).json({ erro: 'plano inválido' });
    c.u.plano = plano; salvarUsuarios();
    res.json({ ok: true });
  });

  app.post('/api/admin/cliente/:email/desconto', exigeAdmin, (req, res) => {
    const c = contaDaRota(req, res); if (!c) return;
    const p = Number((req.body || {}).percentual);
    if (!Number.isFinite(p) || p < 0 || p > 100) return res.status(400).json({ erro: 'desconto entre 0 e 100%' });
    c.u.desconto = Math.round(p); salvarUsuarios();
    res.json({ ok: true });
  });

  app.post('/api/admin/cliente/:email/encerrar', exigeAdmin, (req, res) => {
    const c = contaDaRota(req, res); if (!c) return;
    c.u.acessoAte = new Date().toISOString(); salvarUsuarios();
    res.json({ ok: true });
  });

  app.post('/api/admin/cliente/:email/resetar-senha', exigeAdmin, async (req, res) => {
    const c = contaDaRota(req, res); if (!c) return;
    const temp = crypto.randomBytes(6).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    c.u.salt = salt;
    c.u.hash = await hashSenha(temp, salt);
    c.u.trocarSenha = true;
    salvarUsuarios();
    res.json({ ok: true, senhaTemporaria: temp });
  });

  // ---------- pagamentos manuais ----------
  app.post('/api/admin/pagamento', exigeAdmin, (req, res) => {
    const { email: e, plano, valorPago, dias } = req.body || {};
    const email = normEmail(e);
    const u = usuarios[email];
    const p = fin.planos[plano];
    if (!u) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!p) return res.status(400).json({ erro: 'plano inválido' });
    const diasUsar = Math.round(Number(dias) || p.dias);
    const desc = Math.min(100, Math.max(0, Number(u.desconto) || 0));
    const pago = valorPago !== undefined && valorPago !== '' ? round(valorPago) : round(p.preco * (100 - desc) / 100);
    somarDias(u, diasUsar);
    u.plano = plano;
    salvarUsuarios();
    registrarPagamento({ email, plano, valorBruto: round(p.preco), valorPago: pago, dias: diasUsar, origem: 'manual', situacao: 'aprovado' });
    res.json({ ok: true, acessoAte: u.acessoAte });
  });

  app.get('/api/admin/pagamentos', exigeAdmin, (req, res) => res.json([...fin.pagamentos].reverse()));

  // ---------- despesas ----------
  app.get('/api/admin/despesas', exigeAdmin, (req, res) => res.json([...fin.despesas].reverse()));
  app.post('/api/admin/despesas', exigeAdmin, (req, res) => {
    const { descricao, categoria, valor, data } = req.body || {};
    const v = round(valor);
    if (!descricao || !(v > 0)) return res.status(400).json({ erro: 'informe descrição e valor' });
    fin.despesas.push({ id: crypto.randomUUID(), descricao: String(descricao).slice(0, 120), categoria: String(categoria || 'Outros').slice(0, 40), valor: v, data: data ? new Date(data).toISOString() : new Date().toISOString() });
    salvarFin();
    res.json({ ok: true });
  });

  // ---------- planos ----------
  app.get('/api/admin/planos', exigeAdmin, (req, res) => res.json({ planos: fin.planos, config: fin.config }));
  app.post('/api/admin/planos/:id', exigeAdmin, (req, res) => {
    const p = fin.planos[req.params.id];
    if (!p) return res.status(404).json({ erro: 'plano não encontrado' });
    const { nome, preco, dias } = req.body || {};
    if (nome) p.nome = String(nome).slice(0, 40);
    if (preco !== undefined) p.preco = round(preco);
    if (dias !== undefined) p.dias = Math.max(1, Math.round(Number(dias)));
    salvarFin();
    res.json({ ok: true, plano: p });
  });
  app.post('/api/admin/config', exigeAdmin, (req, res) => {
    const dt = Math.round(Number((req.body || {}).diasTeste));
    if (Number.isFinite(dt) && dt >= 0 && dt <= 90) fin.config.diasTeste = dt;
    salvarFin();
    res.json({ ok: true, config: fin.config });
  });

  // ---------- mensagens e dicas ----------
  app.get('/api/admin/mensagens', exigeAdmin, (req, res) => res.json([...fin.mensagens].reverse()));
  app.post('/api/admin/mensagens', exigeAdmin, (req, res) => {
    const { para, titulo, texto, enviarPush } = req.body || {};
    const alvo = para === 'todos' ? 'todos' : normEmail(para);
    if (alvo !== 'todos' && !usuarios[alvo]) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!titulo || !texto) return res.status(400).json({ erro: 'informe título e texto' });
    const msg = { id: crypto.randomUUID(), para: alvo, titulo: String(titulo).slice(0, 80), texto: String(texto).slice(0, 1000), data: new Date().toISOString() };
    fin.mensagens.push(msg);
    salvarFin();
    let enviados = 0;
    if (enviarPush) {
      for (const entrada of Object.values(db)) {
        if (!entrada.usuario || !podeReceberPush(entrada.usuario)) continue;
        if (alvo !== 'todos' && entrada.usuario !== alvo) continue;
        // texto discreto: sem detalhes na notificação
        webpush.sendNotification(entrada.subscription, JSON.stringify({ titulo: 'MomoEquilibrio', corpo: 'Você tem uma nova dica no app.', tag: 'dica' }), { TTL: 3600 })
          .catch(() => {});
        enviados++;
      }
    }
    res.json({ ok: true, enviados });
  });

  // ---------- exclusão de conta (somente pelo administrador, com confirmação) ----------
  // Apaga a conta do servidor, as inscrições de notificação e as mensagens direcionadas.
  // Os pagamentos ficam sem o e-mail, para manter o registro financeiro anonimizado.
  // O aparelho do cliente não é alterado por este processo.
  app.post('/api/admin/cliente/:email/excluir', exigeAdmin, (req, res) => {
    const c = contaDaRota(req, res); if (!c) return;
    if (normEmail((req.body || {}).confirmacao) !== c.email) return res.status(400).json({ erro: 'a confirmação não confere com o e-mail do cliente' });
    delete usuarios[c.email];
    salvarUsuarios();
    for (const [ep, e] of Object.entries(db)) if (e.usuario === c.email) delete db[ep];
    salvarDb();
    fin.mensagens = fin.mensagens.filter(m => m.para !== c.email);
    for (const pg of fin.pagamentos) if (pg.email === c.email) pg.email = 'conta-excluida';
    salvarFin();
    res.json({ ok: true });
  });

  // ---------- cópia de segurança ----------
  app.get('/api/admin/backup', exigeAdmin, (req, res) => {
    const semSenha = Object.fromEntries(Object.entries(usuarios).map(([e, u]) => { const { salt, hash, ...resto } = u; return [e, resto]; }));
    const pacote = { gerado: new Date().toISOString(), contas: semSenha, financeiro: fin };
    res.setHeader('Content-Disposition', `attachment; filename="backup-momoequilibrio-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(pacote);
  });

  return { camposNovaConta, podeReceberPush, status, avisoVencimento };
};
