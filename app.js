const ICON = (name, className = 'icon') => `<svg class="${className}"><use href="#icon-${name}"></use></svg>`;
const PLATFORM_NAME = 'Emaús';
const STORAGE_KEY = 'batesda-platform-state-v1';
const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_APPEARANCE = { theme: 'light', font: 'editorial', primary: '#d7a84b', accent: '#b86f45' };
const API_BASE = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
const CHURCH_TOKEN_KEY = 'emaus-church-token';
const CHURCH_USER_KEY = 'emaus-church-user';
const PALETTES = {
  batesda: { label: 'Dourado & cobre', primary: '#d7a84b', accent: '#b86f45' },
  oceano: { label: 'Oceano & areia', primary: '#5b8396', accent: '#c88955' },
  olive: { label: 'Oliva & bronze', primary: '#9b9b5a', accent: '#8b623d' },
  vinho: { label: 'Vinho & dourado', primary: '#b35d62', accent: '#d19a4e' }
};

const GROWTH_STRATEGY = [
  { milestone: 50, title: 'Fundamentos do cuidado', focus: 'Conhecer pessoas pelo nome e acolher com verdade.', tips: ['Separar um momento semanal de oração pelos nomes e pelas famílias, sem transformar pessoas em números.', 'Registrar visitantes com consentimento e fazer um primeiro contato cuidadoso em até 48 horas.', 'Treinar uma pequena equipe de acolhimento para receber, ouvir e apresentar a igreja sem pressão.', 'Criar um encontro simples de integração bíblica para quem desejar conhecer melhor a fé e a comunidade.'] },
  { milestone: 100, title: 'Comunhão que permanece', focus: 'Transformar a primeira visita em relacionamento e pertencimento.', tips: ['Fazer uma conversa de acompanhamento depois da visita e perguntar como a pessoa se sentiu.', 'Convidar cada novo membro para um pequeno grupo, classe ou encontro adequado à sua fase de vida.', 'Celebrar testemunhos com autorização, sempre apontando para a graça de Deus e não para a performance humana.', 'Estabelecer um responsável de cuidado para que ninguém fique sem resposta ou acompanhamento.'] },
  { milestone: 150, title: 'Discipulado e serviço', focus: 'Ajudar cada pessoa a crescer e descobrir como servir.', tips: ['Oferecer uma trilha de discipulado com Bíblia, oração, comunhão, serviço e cuidado pastoral.', 'Identificar dons e interesses em conversas pessoais, sem colocar ninguém em uma função por obrigação.', 'Formar novos líderes com acompanhamento próximo, humildade e prestação de contas.', 'Manter uma rotina de oração e estudo para quem serve, respeitando limites e família.'] },
  { milestone: 200, title: 'Igreja presente no bairro', focus: 'Servir a comunidade antes de pedir qualquer coisa dela.', tips: ['Ouvir as necessidades reais do bairro antes de escolher uma ação social.', 'Organizar uma ação de serviço com parceiros locais, com transparência e sem usar a vulnerabilidade para autopromoção.', 'Criar espaços de escuta, oração e orientação para famílias, jovens e idosos.', 'Convidar a comunidade para atividades abertas e acolhedoras, deixando clara a liberdade de participar.'] },
  { milestone: 250, title: 'Cuidado e permanência', focus: 'Crescer com saúde, protegendo vínculos e pessoas.', tips: ['Revisar mensalmente quem está chegando, quem está se afastando e quem precisa de cuidado.', 'Fazer visitas ou contatos pastorais com consentimento, discrição e respeito à privacidade.', 'Criar um caminho claro para novos membros saberem a quem procurar em cada necessidade.', 'Tratar conflitos com verdade, reconciliação e mediação, sem fofoca ou exposição.'] },
  { milestone: 300, title: 'Ministérios saudáveis', focus: 'Organizar o serviço para que a igreja cresça sem sobrecarregar poucos.', tips: ['Definir propósito, responsável e rotina para cada ministério, evitando atividades sem direção.', 'Criar escalas equilibradas e períodos de descanso para voluntários.', 'Acompanhar frutos de cuidado, discipulado e serviço, não apenas quantidade de eventos.', 'Manter registros financeiros, decisões e responsabilidades com clareza para toda a liderança.'] },
  { milestone: 350, title: 'Famílias e gerações', focus: 'Cuidar de crianças, adolescentes, adultos e idosos como uma só família.', tips: ['Construir uma programação segura e adequada para crianças e adolescentes, com responsáveis preparados.', 'Criar momentos que aproximem gerações, permitindo que histórias e dons sejam compartilhados.', 'Oferecer cuidado para casais, pais, pessoas solteiras e enlutadas sem pressupor uma única realidade familiar.', 'Adotar protocolos de proteção, escuta e encaminhamento para situações de risco.'] },
  { milestone: 400, title: 'Multiplicação com maturidade', focus: 'Multiplicar grupos e líderes sem perder presença pastoral.', tips: ['Multiplicar um pequeno grupo somente quando houver cuidado, liderança e comunhão suficientes.', 'Preparar líderes auxiliares antes de iniciar novas frentes de trabalho.', 'Manter a centralidade da Palavra, da oração e da comunhão em cada grupo.', 'Celebrar novos grupos como extensão do cuidado da igreja, não como competição entre equipes.'] },
  { milestone: 450, title: 'Liderança com saúde', focus: 'Cuidar de quem cuida e fortalecer a unidade.', tips: ['Estabelecer reuniões de liderança com oração, decisões registradas e espaço para escuta.', 'Criar uma cultura de feedback respeitoso, correção com amor e reconciliação rápida.', 'Proteger o descanso, a família e a saúde emocional de pastores, líderes e voluntários.', 'Revisar o que está funcionando e encerrar atividades que não servem mais ao propósito da igreja.'] },
  { milestone: 500, title: 'Comunidade madura e missionária', focus: 'Consolidar uma igreja que acolhe, discipula e serve com alegria.', tips: ['Reafirmar anualmente a visão, os valores e o compromisso da igreja com o evangelho.', 'Investir em discipulado contínuo para novos convertidos, membros antigos e líderes.', 'Manter ações de misericórdia, evangelização e serviço como expressão de amor ao próximo.', 'Planejar os próximos passos com oração, dados reais, transparência e dependência de Deus.'] }
];
const GROWTH_STRATEGY_PRINCIPLES = ['Pessoas não são metas: os marcos servem para organizar o cuidado, não para pressionar conversões ou permanência.', 'Toda ação deve respeitar o evangelho: verdade, graça, liberdade de consciência, serviço ao próximo e centralidade de Cristo.', 'Não comprar, manipular ou constranger pessoas. Convites, contatos e testemunhos devem acontecer com consentimento.', 'Crescimento saudável inclui discipulado, proteção, prestação de contas, descanso da equipe e cuidado com quem já está na igreja.'];

const defaultState = {
  activeView: 'dashboard',
  activeChurchId: 'batesda',
  settingsSection: 'organization',
  calendarMonth: TODAY.slice(0, 7),
  growthGoals: { visitors: 50, returns: 25, members: 300 },
  members: [],
  ministries: [],
  attendance: [],
  attendanceSummary: { today: 0, month: 0, members: { total: 0, with_attendance: 0 } },
  careTasks: [],
  currentUser: { name: 'Evandro & Simone', preferredName: '', gender: 'unspecified', role: 'Pastor da igreja', roleKey: 'church_admin' },
  metrics: {
    visits: 0,
    returns: 0,
    reach: 0,
    announcements: 0
  },
  churches: [
    { id: 'batesda', name: 'Bethesda', slug: 'bethesda', city: 'Itaboraí • RJ', phone: '(21) 00000-0000', pastors: 'Evandro e Simone', description: 'Um lugar para pertencer, crescer e viver a fé em comunidade.', initials: 'BE', logoSymbol: 'B', logoImage: 'bethesda-logo.png', appearance: { ...DEFAULT_APPEARANCE }, publicSettings: { visible: true, headline: 'Um lugar para pertencer, crescer e viver a fé em comunidade.', address: 'Itaboraí • RJ', hours: 'Domingos às 19h', instagram: '', facebook: '', youtube: '', cta: 'Venha nos visitar' }, members: 0, status: 'Ativa', plan: 'Essencial' }
  ],
  visitors: [
    { id: 'v-1', name: 'Ana Clara Nogueira', familyName: 'Família Nogueira', familyMembers: ['Ana Clara Nogueira', 'Paulo Nogueira', 'Lara Nogueira'], arrivalType: 'Família', phone: '(21) 99842-1874', date: '2026-09-02', service: 'Culto de Celebração', neighborhood: 'Centro', invitedBy: 'Mariana Alves', status: 'Novo', responsible: 'Recepção', notes: 'Veio com a família.', consent: true },
    { id: 'v-2', name: 'Marcos Vinícius Ribeiro', familyName: '', familyMembers: ['Marcos Vinícius Ribeiro'], arrivalType: 'Sozinho', phone: '(21) 99118-4420', date: '2026-08-30', service: 'Culto da Família', neighborhood: 'Manilha', invitedBy: 'João Pedro', status: 'Contatado', responsible: 'Pr. Evandro', notes: 'Agradeceu a recepção.', consent: true },
    { id: 'v-3', name: 'Júlia Souza', familyName: '', familyMembers: ['Júlia Souza', 'Carlos Souza'], arrivalType: 'Em casal', phone: '(21) 99731-9002', date: '2026-08-23', service: 'Culto de Celebração', neighborhood: 'Outeiro', invitedBy: 'Camila Martins', status: 'Retornou', responsible: 'Simone', notes: 'Retornou no encontro de quarta.', consent: true },
    { id: 'v-4', name: 'Rafael Oliveira', familyName: '', familyMembers: ['Rafael Oliveira'], arrivalType: 'Com amigos', phone: '(21) 98877-2106', date: '2026-08-16', service: 'Culto de Celebração', neighborhood: 'Nancilândia', invitedBy: '—', status: 'Novo', responsible: 'Recepção', notes: '', consent: true },
    { id: 'v-5', name: 'Camila Martins', familyName: '', familyMembers: ['Camila Martins'], arrivalType: 'Família', phone: '(21) 99612-7361', date: '2026-08-09', service: 'Santa Ceia', neighborhood: 'Centro', invitedBy: 'Equipe de louvor', status: 'Integrado', responsible: 'Líder de célula', notes: 'Participa da célula do Centro.', consent: true }
  ],
  announcements: [
    { id: 'a-1', title: 'Culto de Celebração', body: 'Neste domingo, às 19h. Convide alguém especial para estar conosco.', audience: 'Toda a igreja', channels: ['Push', 'WhatsApp'], date: '04 set 2026', status: 'Enviado', reach: '246 pessoas', tone: 'gold' },
    { id: 'a-2', title: 'Encontro de Mulheres', body: 'Uma noite de comunhão, palavra e cuidado. Inscrições abertas na recepção.', audience: 'Ministério de Mulheres', channels: ['Push', 'E-mail'], date: '02 set 2026', status: 'Enviado', reach: '64 pessoas', tone: 'copper' },
    { id: 'a-3', title: 'Escala de setembro', body: 'A escala dos obreiros já está disponível para consulta.', audience: 'Obreiros', channels: ['Push'], date: '30 ago 2026', status: 'Enviado', reach: '31 pessoas', tone: 'gold' }
  ],
  events: [
    { id: 'e-1', title: 'Culto de Celebração', date: '2026-09-06', time: '19:00', location: 'Templo principal', type: 'Culto', audience: 'Toda a igreja' },
    { id: 'e-2', title: 'Encontro de Mulheres', date: '2026-09-12', time: '18:30', location: 'Salão social', type: 'Encontro', audience: 'Ministério de Mulheres' },
    { id: 'e-3', title: 'Culto de Ensino', date: '2026-09-16', time: '19:30', location: 'Templo principal', type: 'Culto', audience: 'Toda a igreja' },
    { id: 'e-4', title: 'Café com líderes', date: '2026-09-19', time: '08:30', location: 'Sala de reuniões', type: 'Liderança', audience: 'Lideranças' }
  ],
  receptionUsers: [
    { id: 'r-1', name: 'Mariana Alves', role: 'Recepção', roleKey: 'reception', churchId: 'batesda', login: 'mariana@bethesda.com.br', password: '123456', phone: '(21) 99704-2118', passwordStatus: 'Ativa', status: 'Ativo', lastAccess: 'Hoje, 10:42', permissions: ['acolhimento'], initials: 'MA', tone: 'copper' },
    { id: 'r-2', name: 'João Pedro', role: 'Obreiro', roleKey: 'reception', churchId: 'batesda', login: 'joao@bethesda.com.br', password: '123456', phone: '(21) 99634-1822', passwordStatus: 'Ativa', status: 'Ativo', lastAccess: 'Domingo, 18:21', permissions: ['acolhimento'], initials: 'JP', tone: 'olive' }
  ],
  leaders: [
    { id: 'l-1', name: 'Evandro', role: 'Pastor titular', phone: '(21) 99921-4421', group: 'Administração', initials: 'EV', tone: 'gold' },
    { id: 'l-2', name: 'Simone', role: 'Pastora e cuidado', phone: '(21) 99812-7310', group: 'Acolhimento', initials: 'SI', tone: 'copper' },
    { id: 'l-3', name: 'João Pedro', role: 'Líder de obreiros', phone: '(21) 99634-1822', group: 'Obreiros', initials: 'JP', tone: 'olive' },
    { id: 'l-4', name: 'Mariana Alves', role: 'Líder de recepção', phone: '(21) 99704-2118', group: 'Recepção', initials: 'MA', tone: 'dark' },
    { id: 'l-5', name: 'Camila Martins', role: 'Líder de célula', phone: '(21) 99572-3188', group: 'Célula Centro', initials: 'CM', tone: 'copper' },
    { id: 'l-6', name: 'Daniel Souza', role: 'Ministério de louvor', phone: '(21) 99280-4471', group: 'Louvor', initials: 'DS', tone: 'olive' }
  ],
  activity: [
    { type: 'visitor', name: 'Ana Clara Nogueira', text: 'foi cadastrada como nova visitante.', time: 'Hoje, 10:42', initials: 'AN', tone: 'copper' },
    { type: 'announcement', name: 'Culto de Celebração', text: 'foi enviado para toda a igreja.', time: 'Hoje, 09:15', initials: 'CC', tone: 'gold' },
    { type: 'return', name: 'Júlia Souza', text: 'retornou pela segunda vez.', time: 'Ontem, 20:18', initials: 'JS', tone: 'olive' },
    { type: 'event', name: 'Encontro de Mulheres', text: 'foi adicionado à agenda.', time: '01 set, 14:06', initials: 'EM', tone: 'dark' }
  ]
};

let state = loadState();
let pendingLogoImage = null;
let appearanceSaveTimer = null;
let churchAuthReady = false;
const viewHistory = [];

async function apiRequest(path, options = {}) {
  if (!API_BASE) throw new Error('A URL da API da Emaús não foi configurada.');
  const token = sessionStorage.getItem(CHURCH_TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  let payload = {};
  try { payload = await response.json(); } catch (error) {}
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(CHURCH_TOKEN_KEY);
    throw new Error(payload.error || `A API respondeu com HTTP ${response.status}.`);
  }
  return payload;
}

function mapApiVisitor(visitor) {
  return {
    id: visitor.id,
    name: visitor.name,
    familyName: visitor.family_name || '',
    familyMembers: Array.isArray(visitor.family_members) ? visitor.family_members : [visitor.name],
    arrivalType: visitor.arrival_type || 'Sozinho',
    announced: Boolean(visitor.announced),
    phone: visitor.phone || '',
    date: String(visitor.visit_date || TODAY).slice(0, 10),
    service: visitor.service || 'Culto de Celebração',
    neighborhood: visitor.neighborhood || '',
    invitedBy: visitor.invited_by || '',
    status: visitor.status || 'Novo',
    responsible: visitor.responsible || 'Recepção',
    notes: visitor.notes || '',
    consent: true,
    churchId: visitor.church_id
  };
}

function mapApiEvent(event) {
  return {
    id: event.id,
    title: event.title,
    date: String(event.event_date || event.date || TODAY).slice(0, 10),
    time: event.event_time || event.time || '19:00',
    location: event.location || 'Templo principal',
    type: event.event_type || event.type || 'Outro',
    audience: event.audience || 'Toda a igreja',
    recurrenceRule: event.recurrence_rule || event.recurrenceRule || {},
    recurrenceId: event.recurrence_id || event.recurrenceId || '',
    status: event.status || 'active'
  };
}
function mapApiMember(member) {
  return { id: member.id, name: member.name, preferredName: member.preferred_name || member.preferredName || '', gender: member.gender || 'unspecified', email: member.email || '', phone: member.phone || '', ministry: member.ministry || '', ministryId: member.ministry_id || '', status: member.status || 'active', joinedAt: member.joined_at || '', communicationConsent: Boolean(member.communication_consent), locationConsent: Boolean(member.location_consent), consentVersion: member.consent_version || '', lastAttendedAt: member.latest_attendance || member.last_attended_at || '' };
}
function mapApiAttendance(item) {
  return { id: item.id, memberId: item.member_id, memberName: item.preferred_name || item.member_name || '', eventId: item.event_id || '', eventTitle: item.event_title || '', source: item.source || 'manual', checkedInAt: item.checked_in_at || '', geoVerified: Boolean(item.geo_verified), distanceM: item.distance_m == null ? null : Number(item.distance_m), accuracyM: item.accuracy_m == null ? null : Number(item.accuracy_m), notes: item.notes || '' };
}
function mapApiCareTask(task) {
  return { id: task.id, memberId: task.member_id || '', visitorId: task.visitor_id || '', memberName: task.preferred_name || task.member_name || '', visitorName: task.visitor_name || '', title: task.title, description: task.description || '', taskType: task.task_type || 'follow_up', priority: task.priority || 'normal', status: task.status || 'pending', dueDate: task.due_date || '', assignedTo: task.assigned_to || '', assigneeName: task.assignee_name || '' };
}
function mapApiMinistry(ministry) {
  return { id: ministry.id, name: ministry.name, churchId: ministry.church_id, status: ministry.status || 'active' };
}
function activityTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'Agora';
  if (diffMinutes < 60) return `Há ${diffMinutes} min`;
  if (diffMinutes < 1440) return `Há ${Math.round(diffMinutes / 60)} h`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function mapApiAnnouncement(announcement) {
  const status = announcement.status === 'scheduled' ? 'Agendado — não enviado' : announcement.status === 'draft' ? 'Rascunho' : announcement.status === 'cancelled' ? 'Cancelado' : 'Registrado — envio não configurado';
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    audience: announcement.audience || 'Toda a igreja',
    channels: Array.isArray(announcement.channels) ? announcement.channels : [],
    personalizeGreeting: Boolean(announcement.personalize_greeting),
    date: activityTime(announcement.created_at) || 'Agora',
    status,
    reach: announcement.status === 'scheduled' ? 'Aguardando configuração' : 'Sem envio real nesta fase',
    tone: 'gold'
  };
}
function mapApiActivity(item) {
  return {
    type: item.activity_type || 'general',
    name: item.name || 'Emaús',
    text: item.text || 'teve uma alteração registrada.',
    time: activityTime(item.created_at),
    initials: item.initials || initials(item.name || 'Emaús'),
    tone: item.tone || 'dark'
  };
}
function mapApiLeader(leader) {
  return { id: leader.id, name: leader.name, preferredName: leader.preferred_name || leader.preferredName || '', gender: leader.gender || 'unspecified', role: leader.role || 'Líder', phone: leader.phone || '', group: leader.group_name || leader.group || '', initials: initials(leader.name), tone: 'dark', status: leader.status || 'active' };
}
function mapApiReceptionUser(user) {
  return { id: user.id, name: user.name, login: user.login || user.email || '', role: user.job_role || user.roleLabel || 'Recepção', roleKey: 'reception', churchId: user.church_id, phone: user.phone || '', passwordStatus: user.passwordStatus || 'Ativa', status: user.status === 'blocked' ? 'Bloqueado' : 'Ativo', permissions: Array.isArray(user.permissions) && user.permissions.length ? user.permissions : ['acolhimento'], lastAccess: user.lastAccess || 'ainda não acessou', initials: initials(user.name), tone: 'dark' };
}

async function loadRemoteChurchState(user) {
  const endpoints = ['/api/church/settings', '/api/church/visitors', '/api/church/events', '/api/church/members', '/api/church/leaders', '/api/church/reception-users', '/api/church/ministries', '/api/church/attendance', '/api/church/attendance/summary', '/api/church/care-tasks', '/api/church/announcements', '/api/church/activity'];
  const results = await Promise.all(endpoints.map(endpoint => apiRequest(endpoint).then(payload => ({ ok: true, payload })).catch(error => ({ ok: false, error }))));
  const settingsPayload = results[0].payload || {};
  const visitorsPayload = results[1].payload || {};
  const eventsPayload = results[2].payload || {};
  const membersPayload = results[3].payload || {};
  const leadersPayload = results[4].payload || {};
  const receptionUsersPayload = results[5].payload || {};
  const ministriesPayload = results[6].payload || {};
  const attendancePayload = results[7].payload || {};
  const attendanceSummaryPayload = results[8].payload || {};
  const careTasksPayload = results[9].payload || {};
  const announcementsPayload = results[10].payload || {};
  const activityPayload = results[11].payload || {};
  const church = settingsPayload.church;
  const localChurch = (state.churches || []).find(item => item.id === church?.id || item.slug === church?.slug || item.name === church?.name);
  const serverPublicSettings = church?.public_settings && typeof church.public_settings === 'object' ? church.public_settings : {};
  if (church) {
    state.activeChurchId = church.id;
    state.churches = [{
      id: church.id,
      name: church.name,
      slug: church.slug || slugify(church.name),
      city: church.city,
      phone: church.phone || '',
      pastors: church.pastors || '',
      description: church.description || '',
      initials: initials(church.name),
      logoSymbol: serverPublicSettings.logoSymbol || localChurch?.logoSymbol || initials(church.name).slice(0, 2),
      logoImage: church.logo_url || localChurch?.logoImage || (String(church.slug || '').toLowerCase() === 'bethesda' ? 'bethesda-logo.png' : ''),
      appearance: { ...DEFAULT_APPEARANCE, ...(localChurch?.appearance || {}), ...(serverPublicSettings.appearance || {}) },
      publicSettings: { visible: true, ...(localChurch?.publicSettings || {}), ...serverPublicSettings },
      members: Number(church.member_count || 0),
      status: church.status === 'blocked' ? 'Bloqueada' : 'Ativa',
      plan: church.plan_id || 'cuidado'
    }];
  }
  if (serverPublicSettings.growthGoals) state.growthGoals = { ...(state.growthGoals || {}), ...serverPublicSettings.growthGoals };
  if (results[1].ok) state.visitors = (visitorsPayload.visitors || []).map(mapApiVisitor);
  if (results[2].ok) state.events = (eventsPayload.events || []).map(mapApiEvent);
  if (results[3].ok) state.members = (membersPayload.members || []).map(mapApiMember);
  if (results[4].ok) state.leaders = (leadersPayload.leaders || []).map(mapApiLeader);
  if (results[5].ok) state.receptionUsers = (receptionUsersPayload.users || []).map(mapApiReceptionUser);
  if (results[6].ok) state.ministries = (ministriesPayload.ministries || []).map(mapApiMinistry);
  if (results[7].ok) state.attendance = (attendancePayload.attendance || []).map(mapApiAttendance);
  if (results[8].ok) state.attendanceSummary = { ...(state.attendanceSummary || {}), ...(attendanceSummaryPayload || {}) };
  if (results[9].ok) state.careTasks = (careTasksPayload.tasks || []).map(mapApiCareTask);
  if (results[10].ok) state.announcements = (announcementsPayload.announcements || []).map(mapApiAnnouncement);
  if (results[11].ok) state.activity = (activityPayload.activity || []).map(mapApiActivity);
  state.metrics = { ...(state.metrics || {}), visits: state.visitors.length, returns: state.visitors.filter(visitor => ['Retornou', 'Integrado'].includes(visitor.status)).length, reach: Number(church?.member_count || 0), announcements: state.announcements.length };
  state.currentUser = { id: user?.id || '', name: user?.name || 'Pastor', preferredName: user?.preferredName || '', gender: user?.gender || 'unspecified', role: user?.role === 'reception' ? (user?.jobRole || 'Recepção') : genderedRole(user || {}, 'Pastor da igreja'), roleKey: user?.role || 'church_admin', churchId: user?.churchId || state.activeChurchId, permissions: Array.isArray(user?.permissions) ? user.permissions : [], status: user?.status || 'active', login: user?.email || '' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showChurchLogin() {
  $('#churchLoginView')?.classList.remove('is-hidden');
  $('#appShell')?.classList.add('is-hidden');
}

function showChurchApp() {
  $('#churchLoginView')?.classList.add('is-hidden');
  $('#appShell')?.classList.remove('is-hidden');
  churchAuthReady = true;
  applyAppearance();
  render();
}

async function handleChurchLogin(event) {
  event.preventDefault();
  const form = event.target;
  const email = String(new FormData(form).get('email') || '').trim().toLowerCase();
  const password = String(new FormData(form).get('password') || '');
  const error = $('#churchLoginError');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Conectando...';
  try {
    const payload = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
    if (!['church_admin', 'reception'].includes(payload.user?.role)) throw new Error('Este acesso não pertence à área da igreja.');
    sessionStorage.setItem(CHURCH_TOKEN_KEY, payload.token);
    sessionStorage.setItem(CHURCH_USER_KEY, JSON.stringify(payload.user));
    await loadRemoteChurchState(payload.user);
    error.classList.add('is-hidden');
    showChurchApp();
  } catch (loginError) {
    sessionStorage.removeItem(CHURCH_TOKEN_KEY);
    sessionStorage.removeItem(CHURCH_USER_KEY);
    error.textContent = loginError.message || 'Não foi possível conectar à API da Emaús.';
    error.classList.remove('is-hidden');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar na área da igreja';
  }
}

async function bootstrapChurchAuth() {
  showChurchLogin();
  $('#churchLoginForm')?.addEventListener('submit', handleChurchLogin);
  const token = sessionStorage.getItem(CHURCH_TOKEN_KEY);
  const savedUser = sessionStorage.getItem(CHURCH_USER_KEY);
  if (!token || !savedUser) return;
  try {
    const me = await apiRequest('/api/me');
    if (!['church_admin', 'reception'].includes(me.user?.role)) throw new Error('Acesso não autorizado.');
    await loadRemoteChurchState(me.user);
    showChurchApp();
  } catch (error) {
    sessionStorage.removeItem(CHURCH_TOKEN_KEY);
    sessionStorage.removeItem(CHURCH_USER_KEY);
    showChurchLogin();
  }
}

function logoutChurch() {
  sessionStorage.removeItem(CHURCH_TOKEN_KEY);
  sessionStorage.removeItem(CHURCH_USER_KEY);
  churchAuthReady = false;
  showChurchLogin();
}

const viewMeta = {
  dashboard: { label: 'Início' },
  acolhimento: { label: 'Acolhimento' },
  members: { label: 'Membros' },
  visitors: { label: 'Visitantes' },
  pulpit: { label: 'Modo púlpito' },
  communication: { label: 'Comunicação' },
  agenda: { label: 'Agenda' },
  leaders: { label: 'Lideranças' },
  settings: { label: 'Configurações' }
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.visitors && saved.events && saved.churches) {
      const merged = { ...structuredClone(defaultState), ...saved, currentUser: { ...defaultState.currentUser, ...(saved.currentUser || {}) }, metrics: { ...defaultState.metrics, ...(saved.metrics || {}) }, growthGoals: { ...defaultState.growthGoals, ...(saved.growthGoals || {}) }, members: Array.isArray(saved.members) ? saved.members : [], ministries: Array.isArray(saved.ministries) ? saved.ministries : [], attendance: Array.isArray(saved.attendance) ? saved.attendance : [], attendanceSummary: { ...defaultState.attendanceSummary, ...(saved.attendanceSummary || {}) }, careTasks: Array.isArray(saved.careTasks) ? saved.careTasks : [], calendarMonth: saved.calendarMonth || defaultState.calendarMonth };
      merged.visitors = merged.visitors.map(visitor => {
        const defaultVisitor = defaultState.visitors.find(item => item.id === visitor.id);
        return {
          ...visitor,
          familyName: visitor.familyName || defaultVisitor?.familyName || '',
          familyMembers: Array.isArray(visitor.familyMembers) && visitor.familyMembers.length ? visitor.familyMembers : (defaultVisitor?.familyMembers || [visitor.name]),
          arrivalType: visitor.arrivalType || defaultVisitor?.arrivalType || 'Sozinho',
          announced: Boolean(visitor.announced)
        };
      });
      merged.churches = merged.churches.map(church => ({
        ...church,
        name: church.id === 'batesda' ? 'Bethesda' : church.name,
        initials: church.id === 'batesda' ? 'BE' : (church.initials || initials(church.name)),
        logoSymbol: church.logoSymbol || (church.id === 'batesda' ? 'B' : initials(church.name).slice(0, 2)),
        logoImage: church.id === 'batesda' ? 'bethesda-logo.png' : (church.logoImage || ''),
        phone: church.phone || '(21) 00000-0000',
        pastors: church.pastors || 'Evandro e Simone',
        description: church.description || 'Um lugar para pertencer, crescer e viver a fé em comunidade.',
        slug: church.slug || slugify(church.name),
        publicSettings: { visible: true, ...(church.publicSettings || {}) },
        appearance: { ...DEFAULT_APPEARANCE, ...(church.appearance || {}) }
      }));
      merged.receptionUsers = (merged.receptionUsers || []).map((user, index) => ({
        ...user,
        roleKey: user.roleKey || 'reception',
        churchId: user.churchId || 'batesda',
        login: (user.login || `${slugify(user.name)}@${slugify(defaultState.churches[0]?.name || 'igreja')}.com.br`).replace(/@batesda\.com\.br$/i, '@bethesda.com.br'),
        password: user.password || (/^(mariana|joao)@(batesda|bethesda)\.com\.br$/i.test(String(user.login || '')) ? '123456' : ''),
        passwordStatus: user.passwordStatus || 'Ativa',
        permissions: Array.isArray(user.permissions) && user.permissions.length ? user.permissions : ['acolhimento']
      }));
      return merged;
    }
  } catch (error) {
    console.info('Iniciando uma nova área de trabalho.', error);
  }
  return structuredClone(defaultState);
}

const BACKUP_STORAGE_KEY = 'batesda-platform-backups-v1';
const BACKUP_LIMIT = 30;

function getBackupHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(BACKUP_STORAGE_KEY));
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.info('Não foi possível ler os backups automáticos.', error);
    return [];
  }
}

function persistBackupHistory(history) {
  for (let limit = history.length; limit > 0; limit -= 1) {
    try {
      localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(history.slice(0, limit)));
      return true;
    } catch (error) {
      // Se o navegador atingir o limite do armazenamento, conserva as versões mais recentes.
    }
  }
  return false;
}

function createAutomaticBackup(reason = 'Alteração salva') {
  const snapshot = structuredClone(state);
  const history = getBackupHistory();
  history.unshift({
    id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    reason,
    churchId: state.activeChurchId,
    state: snapshot
  });
  const saved = persistBackupHistory(history.slice(0, BACKUP_LIMIT));
  if (!saved) console.info('Não foi possível criar o backup automático.');
  return saved;
}

function formatBackupDate(date) {
  if (!date) return 'ainda não realizado';
  try {
    return new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (error) {
    return 'agora';
  }
}

function saveState(reason = 'Alteração salva') {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    createAutomaticBackup(reason);
  } catch (error) {
    console.info('Não foi possível salvar o protótipo.', error);
  }
}

function $(selector, root = document) { return root.querySelector(selector); }
function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}
function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—';
}
function iconTone(tone = 'gold') {
  return tone === 'copper' ? 'avatar-copper' : tone === 'olive' ? 'avatar-olive' : tone === 'dark' ? 'avatar-dark' : 'avatar-gold';
}
function parseDate(date) {
  return new Date(`${date}T12:00:00`);
}
function formatDateShort(date) {
  if (!date) return '—';
  const d = parseDate(date);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '').replace(' de ', ' ');
}
function formatDateLong(date) {
  if (!date) return '—';
  const d = parseDate(date);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function monthLabel(date) {
  return parseDate(date).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, char => char.toUpperCase());
}
function statusClass(status) {
  return ({ 'Novo': 'status-new', 'Contatado': 'status-contacted', 'Retornou': 'status-returned', 'Integrado': 'status-integrated' }[status] || 'status-new');
}
function normalizedGender(person = {}) {
  return ['female', 'male', 'plural'].includes(person.gender) ? person.gender : 'unspecified';
}
function isPluralPastoralPerson(person = {}) {
  if (normalizedGender(person) === 'plural' || person.isPlural === true) return true;
  const name = String(person.preferredName || person.preferred_name || person.name || '').toLowerCase();
  return /\s(?:&|e)\s/.test(name);
}
function preferredDisplayName(person = {}) {
  return String(person.preferredName || person.preferred_name || person.name || '').trim();
}
function genderedGreeting(person = {}) {
  const name = preferredDisplayName(person) || 'pessoa querida';
  if (isPluralPastoralPerson(person)) return `Sejam bem-vindos, ${name}`;
  if (normalizedGender(person) === 'female') return `Seja bem-vinda, ${name}`;
  if (normalizedGender(person) === 'male') return `Seja bem-vindo, ${name}`;
  return `Olá, ${name}`;
}
function genderedRole(person = {}, role = '') {
  const value = String(role || person.role || '').trim();
  if (isPluralPastoralPerson(person)) return value.replace(/^Pastora? da igreja$/i, 'Pastores da igreja').replace(/^Pastora? titular$/i, 'Pastores titulares');
  if (normalizedGender(person) === 'female') return value.replace(/^Pastor da igreja$/i, 'Pastora da igreja').replace(/^Pastor titular$/i, 'Pastora titular').replace(/^Líder de/i, 'Líder de');
  if (normalizedGender(person) === 'male') return value.replace(/^Pastora da igreja$/i, 'Pastor da igreja').replace(/^Pastora titular$/i, 'Pastor titular');
  return value;
}
function personalizedMessageGreeting(person = {}) {
  const name = preferredDisplayName(person) || 'pessoa querida';
  const greeting = timeGreeting();
  if (isPluralPastoralPerson(person)) return `${greeting}, pastores ${name}!`;
  if (normalizedGender(person) === 'female') return `${greeting}, ${name}! Seja bem-vinda.`;
  if (normalizedGender(person) === 'male') return `${greeting}, ${name}! Seja bem-vindo.`;
  return `${greeting}, ${name}!`;
}
function brasiliaHour(value = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
  return hour === 24 ? 0 : hour;
}
function timeGreeting(value = new Date()) {
  const hour = brasiliaHour(value);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
function dashboardGreetingFor(person = {}) {
  const name = preferredDisplayName(person) || 'Pastor';
  const greeting = timeGreeting();
  if (isPluralPastoralPerson(person)) return `${greeting}, Pastores ${name}`;
  if (normalizedGender(person) === 'female') return `${greeting}, Pastora ${name}`;
  if (normalizedGender(person) === 'male') return `${greeting}, Pastor ${name}`;
  return `${greeting}, ${name}`;
}
function eventStatusLabel(status) {
  return ({ active: 'Ativo', paused: 'Pausado', blocked: 'Bloqueado' }[status] || 'Ativo');
}
function eventStatusClass(status) {
  return ({ active: 'status-integrated', paused: 'status-contacted', blocked: 'status-new' }[status] || 'status-integrated');
}
function getActiveChurch() {
  return state.churches.find(church => church.id === state.activeChurchId) || state.churches[0];
}
function isPlatformAdmin() {
  return state.currentUser?.roleKey === 'platform_admin';
}
function getCurrentReceptionAccess() {
  if (state.currentUser?.roleKey !== 'reception') return null;
  const users = state.receptionUsers || [];
  const access = users.find(user => (user.id === state.currentUser.receptionUserId || user.login === state.currentUser.login || user.name === state.currentUser.name) && (!user.churchId || user.churchId === state.activeChurchId));
  return access || { permissions: state.currentUser.permissions || ['acolhimento'], status: state.currentUser.status || 'active' };
}
function canAccessAcolhimento() {
  if (state.currentUser?.roleKey !== 'reception') return true;
  const access = getCurrentReceptionAccess();
  return Boolean(access && access.status !== 'Bloqueado' && access.status !== 'blocked' && (access.permissions || []).includes('acolhimento'));
}
function slugify(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'igreja';
}
function receptionLink(church = getActiveChurch()) {
  const pathname = window.location?.pathname || '/';
  const basePath = pathname.endsWith('/') ? pathname : pathname.slice(0, pathname.lastIndexOf('/') + 1);
  const slug = church?.slug || slugify(church?.name || 'igreja');
  return `${window.location.origin}${basePath}recepcao.html?igreja=${encodeURIComponent(slug)}`;
}
function churchLogoText(church) {
  return String(church?.logoSymbol || (church?.id === 'batesda' ? 'B' : initials(church?.name || 'B'))).trim().slice(0, 2).toUpperCase() || 'B';
}
function normalizeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}
function hexToRgb(hex) {
  const value = normalizeHex(hex, '#000000').slice(1);
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}
function mixHex(first, second, secondWeight = .5) {
  const a = hexToRgb(first); const b = hexToRgb(second); const weight = Math.max(0, Math.min(1, secondWeight));
  const channel = key => Math.round(a[key] * (1 - weight) + b[key] * weight).toString(16).padStart(2, '0');
  return `#${channel('r')}${channel('g')}${channel('b')}`;
}
function applyAppearance() {
  const church = getActiveChurch();
  const appearance = { ...DEFAULT_APPEARANCE, ...(church?.appearance || {}) };
  const primary = normalizeHex(appearance.primary, DEFAULT_APPEARANCE.primary);
  const accent = normalizeHex(appearance.accent, DEFAULT_APPEARANCE.accent);
  const preference = ['light', 'dark', 'auto'].includes(appearance.theme) ? appearance.theme : 'light';
  const resolved = preference === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.setProperty('--gold', primary);
  root.style.setProperty('--gold-2', mixHex(primary, '#ffffff', .22));
  root.style.setProperty('--gold-soft', resolved === 'dark' ? mixHex(primary, '#181817', .68) : mixHex(primary, '#ffffff', .86));
  root.style.setProperty('--copper', accent);
  root.style.setProperty('--copper-soft', resolved === 'dark' ? mixHex(accent, '#181817', .67) : mixHex(accent, '#ffffff', .87));
  const fontMap = {
    editorial: { sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', display: 'Georgia, "Times New Roman", serif' },
    modern: { sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', display: 'Inter, ui-sans-serif, system-ui, sans-serif' },
    classic: { sans: 'Trebuchet MS, Arial, sans-serif', display: 'Georgia, "Times New Roman", serif' },
    clean: { sans: 'Arial, Helvetica, sans-serif', display: 'Arial, Helvetica, sans-serif' }
  };
  const fonts = fontMap[appearance.font] || fontMap.editorial;
  root.style.setProperty('--font-sans', fonts.sans);
  root.style.setProperty('--font-display', fonts.display);
}
function applyAppearanceFromControls() {
  const church = getActiveChurch();
  if (!church) return;
  church.appearance = {
    ...DEFAULT_APPEARANCE,
    ...(church.appearance || {}),
    theme: $('#appearanceTheme')?.value || church.appearance?.theme || DEFAULT_APPEARANCE.theme,
    font: $('#appearanceFont')?.value || church.appearance?.font || DEFAULT_APPEARANCE.font,
    primary: normalizeHex($('#appearancePrimary')?.value, church.appearance?.primary || DEFAULT_APPEARANCE.primary),
    accent: normalizeHex($('#appearanceAccent')?.value, church.appearance?.accent || DEFAULT_APPEARANCE.accent)
  };
  const primaryText = $('[data-color-text="appearancePrimary"]');
  const accentText = $('[data-color-text="appearanceAccent"]');
  if (primaryText) primaryText.value = church.appearance.primary.toUpperCase();
  if (accentText) accentText.value = church.appearance.accent.toUpperCase();
  applyAppearance();
  saveState('Aparência atualizada localmente');
  if (churchAuthReady && sessionStorage.getItem(CHURCH_TOKEN_KEY)) queueAppearanceSave();
}
function queueAppearanceSave() {
  clearTimeout(appearanceSaveTimer);
  appearanceSaveTimer = setTimeout(async () => {
    const church = getActiveChurch();
    if (!church || !churchAuthReady || !sessionStorage.getItem(CHURCH_TOKEN_KEY)) return;
    const publicSettings = { ...(church.publicSettings || {}), appearance: { ...church.appearance }, logoSymbol: church.logoSymbol || initials(church.name) };
    try {
      await apiRequest('/api/church/settings', { method: 'PUT', body: { name: church.name, city: church.city, phone: church.phone || '', pastors: church.pastors || '', description: church.description || '', logoUrl: church.logoImage || '', publicSettings } });
      showToast('Aparência salva no banco da igreja.');
    } catch (error) {
      showToast(`A aparência ficou apenas neste navegador: ${error.message}`, 'error');
    }
  }, 650);
}
async function saveCommunicationChannels() {
  const church = getActiveChurch();
  if (!church || !churchAuthReady || !sessionStorage.getItem(CHURCH_TOKEN_KEY)) return;
  const communicationChannels = {
    push: Boolean(document.querySelector('[data-toggle="push"]')?.classList.contains('on')),
    whatsapp: Boolean(document.querySelector('[data-toggle="whatsapp"]')?.classList.contains('on')),
    email: Boolean(document.querySelector('[data-toggle="email"]')?.classList.contains('on'))
  };
  church.publicSettings = { ...(church.publicSettings || {}), communicationChannels };
  try {
    await apiRequest('/api/church/settings', { method: 'PUT', body: { name: church.name, city: church.city, phone: church.phone || '', pastors: church.pastors || '', description: church.description || '', logoUrl: church.logoImage || '', publicSettings: church.publicSettings } });
    saveState('Canais de comunicação salvos');
    showToast('Preferências de canais salvas no banco. Nenhum envio foi ativado.');
  } catch (error) {
    showToast(`Não foi possível salvar os canais: ${error.message}`, 'error');
  }
}
function applyPalette(key) {
  const palette = PALETTES[key];
  if (!palette) return;
  if ($('#appearancePrimary')) $('#appearancePrimary').value = palette.primary;
  if ($('#appearanceAccent')) $('#appearanceAccent').value = palette.accent;
  applyAppearanceFromControls();
  showToast(`Paleta “${palette.label}” aplicada nesta igreja.`);
}
function updateLogoMark(textId, imageId, church) {
  const text = document.getElementById(textId);
  const image = document.getElementById(imageId);
  if (text) { text.textContent = churchLogoText(church); text.hidden = Boolean(church?.logoImage); }
  if (image) {
    image.hidden = !church?.logoImage;
    if (church?.logoImage) { image.src = church.logoImage; image.alt = `${church.name} — logo`; }
  }
}
function visitorCountByStatus(status) {
  return state.visitors.filter(visitor => visitor.status === status).length;
}
function getFamilyMembers(visitor) {
  const members = Array.isArray(visitor?.familyMembers) && visitor.familyMembers.length ? visitor.familyMembers : [visitor?.name];
  return [...new Set(members.filter(Boolean).map(member => String(member).trim()).filter(Boolean))];
}
function familySummary(visitor) {
  const members = getFamilyMembers(visitor);
  if (members.length <= 1) return '';
  const label = visitor.familyName || `${members.length} pessoas`;
  return `<span class="family-summary">${ICON('users')} ${esc(label)} · ${members.map(esc).join(', ')}</span>`;
}
function arrivalIcon(type) {
  return ({ 'Sozinho': 'user-round', 'Com amigos': 'sparkle', 'Em casal': 'heart', 'Família': 'users' }[type] || 'users');
}
function arrivalTone(type) {
  return ({ 'Sozinho': 'alone', 'Com amigos': 'friends', 'Em casal': 'couple', 'Família': 'family' }[type] || 'family');
}
function arrivalPill(type = 'Sozinho') {
  return `<span class="arrival-pill arrival-${arrivalTone(type)}">${ICON(arrivalIcon(type))} ${esc(type)}</span>`;
}
function visitorCountByArrival(type) {
  return state.visitors.filter(visitor => (visitor.arrivalType || 'Sozinho') === type).length;
}
function familyNamesForVisitors(visitors) {
  return [...new Set(visitors.flatMap(getFamilyMembers))];
}
function namesAsSentence(names) {
  const clean = [...new Set(names.filter(Boolean))];
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} e ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} e ${clean[clean.length - 1]}`;
}
function visitorAnnouncementGroups(visitors = []) {
  return visitors.map(visitor => {
    const type = visitor.arrivalType || 'Sozinho';
    const label = type === 'Família' ? (visitor.familyName || 'Família') : type === 'Em casal' ? 'Casal' : type === 'Com amigos' ? 'Amigos' : 'Sozinho';
    return { label, type, names: getFamilyMembers(visitor) };
  }).filter(group => group.names.length);
}
function renderVisitorAnnouncementGroups(visitors = []) {
  return visitorAnnouncementGroups(visitors).map(group => `<div class="announcement-preview-line"><span class="announcement-preview-label">${arrivalPill(group.type)}</span><strong>${esc(group.label)}:</strong><span>${esc(namesAsSentence(group.names))}</span></div>`).join('');
}
function buildVisitorAnnouncement(visitors) {
  const groups = visitorAnnouncementGroups(visitors);
  const churchName = getActiveChurch()?.name || 'nossa igreja';
  const lines = groups.map(group => `${group.label}: ${namesAsSentence(group.names)}`);
  return {
    title: groups.length ? 'Sejam bem-vindos, visitantes!' : 'Boas-vindas aos visitantes',
    body: groups.length ? `Recebemos com alegria os nossos visitantes:\n${lines.join('\n')}\nSejam muito bem-vindos à ${churchName}!` : `Recebemos novos visitantes com alegria. Sejam muito bem-vindos à ${churchName}!`
  };
}
function familyMemberRow(value = '', index = 1) {
  return `<div class="family-member-row"><span class="family-member-number">${index}</span><input class="input" name="familyMembers" value="${esc(value)}" placeholder="Nome completo do familiar"><button type="button" class="table-action family-remove" data-action="remove-family-member" aria-label="Remover pessoa">${ICON('x')}</button></div>`;
}
function dateDay(date) { return parseDate(date).getDate(); }
function dateMonth(date) { return parseDate(date).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(); }
function sortedEvents() { return [...state.events].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)); }
function upcomingEvents() { return sortedEvents().filter(event => !['paused', 'blocked'].includes(event.status || 'active')); }
function escapeCSV(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

function applySettingsSection(section = state.settingsSection || 'organization') {
  const validSections = ['organization', 'public', 'notifications', 'team', 'saas'];
  state.settingsSection = validSections.includes(section) ? section : 'organization';
  $$('.settings-nav button').forEach(button => button.classList.toggle('active', button.dataset.settingsSection === state.settingsSection));
  $$('.settings-panels [data-settings-panel]').forEach(panel => {
    panel.classList.toggle('is-hidden', panel.dataset.settingsPanel !== state.settingsSection);
  });
}

function render() {
  applyAppearance();
  updateShell();
  const content = $('#appContent');
  if (!content) return;
  if (state.activeView === 'acolhimento' && !canAccessAcolhimento()) state.activeView = 'dashboard';
  const renderers = { dashboard: renderDashboard, acolhimento: renderAcolhimento, members: renderMembers, visitors: renderVisitors, pulpit: renderPulpit, communication: renderCommunication, agenda: renderAgenda, leaders: renderLeaders, settings: renderSettings };
  content.innerHTML = (renderers[state.activeView] || renderDashboard)();
  updateShell();
  if (state.activeView === 'settings') applySettingsSection();
}

function updateShell() {
  const meta = viewMeta[state.activeView] || viewMeta.dashboard;
  const current = $('#breadcrumbCurrent');
  if (current) current.textContent = meta.label;
  const church = getActiveChurch();
  const churchName = $('#activeChurchName');
  if (churchName) churchName.textContent = church?.name || 'Bethesda';
  const sidebarBrandName = $('#sidebarBrandName');
  if (sidebarBrandName) sidebarBrandName.textContent = church?.name || 'Bethesda';
  const topbarChurchName = $('#topbarChurchName');
  if (topbarChurchName) topbarChurchName.textContent = church?.name || 'Bethesda';
  document.title = `${church?.name || 'Bethesda'} · ${PLATFORM_NAME}`;
  const userName = preferredDisplayName(state.currentUser) || 'Evandro & Simone';
  const userRole = genderedRole(state.currentUser, state.currentUser?.role || 'Pastor da igreja');
  if ($('#sidebarUserName')) $('#sidebarUserName').textContent = userName;
  if ($('#sidebarUserRole')) $('#sidebarUserRole').textContent = userRole;
  if ($('#topProfileName')) $('#topProfileName').textContent = userName;
  if ($('#topProfileRole')) $('#topProfileRole').textContent = userRole;
  const sidebarChurchSymbol = $('#sidebarChurchSymbol');
  if (sidebarChurchSymbol) sidebarChurchSymbol.textContent = church?.logoImage ? (church.initials || initials(church.name)) : churchLogoText(church);
  updateLogoMark('sidebarLogoSymbol', 'sidebarLogoImage', church);
  updateLogoMark('topbarLogoSymbol', 'topbarLogoImage', church);
  const visitorNavCount = $('#visitorNavCount');
  if (visitorNavCount) visitorNavCount.textContent = String(state.visitors.length || 0);
  const notificationCount = $('#notificationCount');
  if (notificationCount) notificationCount.textContent = String(state.metrics.announcements || 0);
  $$('.nav-item, .mobile-nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.activeView));
  const acolhimentoAvailable = canAccessAcolhimento();
  $$('[data-view="acolhimento"]').forEach(button => {
    button.classList.toggle('is-hidden', !acolhimentoAvailable);
    button.setAttribute('aria-hidden', String(!acolhimentoAvailable));
  });
  const backButton = $('#backBtn');
  if (backButton) {
    const canGoBack = state.activeView !== 'dashboard';
    backButton.classList.toggle('is-hidden', !canGoBack);
    backButton.setAttribute('aria-hidden', String(!canGoBack));
    backButton.tabIndex = canGoBack ? 0 : -1;
  }
}

function activeMemberCount() {
  return (state.members || []).filter(member => member.status !== 'inactive').length;
}
function nextGrowthMilestone() {
  const count = activeMemberCount();
  return GROWTH_STRATEGY.find(stage => stage.milestone > count) || null;
}
function growthProgress() {
  const count = activeMemberCount();
  const next = nextGrowthMilestone();
  if (!next) return { count, next: null, previous: 500, percent: 100 };
  const previous = Math.max(0, next.milestone - 50);
  const percent = Math.max(0, Math.min(100, Math.round(((count - previous) / 50) * 100)));
  return { count, next, previous, percent };
}
function growthStageState(stage, count) {
  if (count >= stage.milestone) return 'done';
  const previous = stage.milestone - 50;
  return count >= previous ? 'current' : 'upcoming';
}
function renderGrowthStrategyPanel() {
  const progress = growthProgress();
  const stage = progress.next || GROWTH_STRATEGY[GROWTH_STRATEGY.length - 1];
  const label = progress.next ? `Próximo marco: ${progress.next.milestone} membros` : 'Marco de 500 membros alcançado';
  const amount = progress.next ? `${progress.count} / ${progress.next.milestone}` : `${progress.count} membros ativos`;
  return `<section class="panel growth-strategy-card"><div class="panel-header"><div class="panel-heading"><h2>Estratégia de crescimento com cuidado</h2><p>Marcos de 50 em 50 membros, com práticas de acolhimento, discipulado e serviço.</p></div><button class="btn btn-secondary" data-action="growth-strategy">${ICON('sparkle')} Ver estratégia</button></div><div class="growth-strategy-summary"><div class="growth-strategy-milestone"><span class="scope-label">${esc(label)}</span><strong>${esc(amount)}</strong><p>${esc(stage.focus)}</p></div><div class="growth-strategy-progress"><div class="growth-strategy-progress-head"><span>Progresso do próximo marco</span><strong>${progress.percent}%</strong></div><div class="mini-progress"><span style="width:${progress.percent}%"></span></div><small>O número é calculado somente com membros ativos cadastrados.</small></div></div></section>`;
}
function renderGrowthStrategyModal() {
  const progress = growthProgress();
  const stages = GROWTH_STRATEGY.map(stage => {
    const stateClass = growthStageState(stage, progress.count);
    const stateLabel = stateClass === 'done' ? 'Concluído' : stateClass === 'current' ? 'Foco atual' : 'Próximo passo';
    return `<article class="growth-stage growth-stage-${stateClass}"><div class="growth-stage-head"><div class="growth-stage-number">${stage.milestone}</div><div><span class="scope-label">${esc(stateLabel)}</span><h3>${esc(stage.title)}</h3><p>${esc(stage.focus)}</p></div></div><ol>${stage.tips.map(tip => `<li>${esc(tip)}</li>`).join('')}</ol></article>`;
  }).join('');
  return `<div class="growth-strategy-intro"><div class="icon-tile gold">${ICON('sparkle')}</div><div><strong>Uma estratégia de crescimento fiel ao evangelho</strong><p>Use cada marco como um convite para cuidar melhor das pessoas, formar discípulos e servir a comunidade. Nunca como pressão por números.</p></div></div><div class="growth-principles"><h3>Diretrizes para todos os marcos</h3><ul>${GROWTH_STRATEGY_PRINCIPLES.map(principle => `<li>${ICON('check-circle')}<span>${esc(principle)}</span></li>`).join('')}</ul></div><div class="growth-stage-list">${stages}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-action="growth-goals">${ICON('sparkle')} Ajustar meta de membros</button></div>`;
}

function renderCareSummaryPanel() {
  const tasks = (state.careTasks || []).filter(task => !['done', 'cancelled'].includes(task.status));
  const summary = state.attendanceSummary || {};
  const taskRows = tasks.slice(0, 4).map(task => `<div class="care-task-row"><span class="care-task-dot care-task-${esc(task.priority || 'normal')}"></span><div><strong>${esc(task.title)}</strong><small>${esc(task.memberName || task.visitorName || 'Pessoa vinculada')}${task.dueDate ? ` · até ${esc(formatDateShort(task.dueDate))}` : ''}</small></div><button class="table-action" data-action="care-task-detail" data-id="${esc(task.id)}" aria-label="Abrir cuidado">${ICON('chevron-right')}</button></div>`).join('');
  return `<section class="care-dashboard-grid"><article class="panel"><div class="panel-header"><div class="panel-heading"><h2>Cuidado em andamento</h2><p>Próximos acompanhamentos da igreja.</p></div><button class="panel-link" data-action="new-care-task">Novo cuidado ${ICON('plus')}</button></div><div class="care-task-list">${taskRows || `<div class="empty-state compact-empty"><div class="icon-tile green">${ICON('heart')}</div><h3>Nenhum cuidado pendente</h3><p>Quando houver alguém para acompanhar, registre aqui.</p></div>`}</div>${tasks.length > 4 ? `<button class="btn btn-secondary btn-full" data-view="acolhimento">Ver todos os acompanhamentos</button>` : ''}</article><article class="panel info-card"><div class="card-topline"><div><h3>Presença dos membros</h3><p>Registros internos da ${esc(getActiveChurch()?.name || 'igreja')}.</p></div><div class="icon-tile olive">${ICON('check-circle')}</div></div><div class="split-stat"><div><small>Hoje</small><strong>${esc(summary.today || 0)}</strong></div><div><small>Este mês</small><strong>${esc(summary.month || 0)}</strong></div><div><small>Com registro</small><strong>${esc(summary.members?.with_attendance || 0)}</strong></div></div><p class="field-note" style="margin-top:14px;">A presença é um registro pastoral, não um ranking de pessoas.</p><button class="btn btn-secondary btn-full" style="margin-top:16px;" data-action="attendance-report">${ICON('clipboard-check')} Ver registros</button></article></section>`;
}

function renderDashboard() {
  const church = getActiveChurch();
  const events = upcomingEvents();
  const chartValues = state.visitors.length ? [38, 44, 41, 52, 48, 60, 54, 67, 63, 71, 69, 82] : Array(12).fill(0);
  const dashboardGreeting = dashboardGreetingFor(state.currentUser);
  return `
    <section class="page-head">
      <div>
        <span class="eyebrow">${formatDateLong(TODAY)}</span>
        <h1>${esc(dashboardGreeting)} <span class="heading-sparkle">${ICON('sparkle')}</span></h1>
        <p>Uma visão clara para cuidar melhor das pessoas e da sua igreja.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" data-view="acolhimento"><span>${ICON('heart')}</span> Acolhimento</button>
        <button class="btn btn-secondary" data-view="members"><span>${ICON('users')}</span> Membros</button>
        <button class="btn btn-gold" data-action="new-visitor"><span>${ICON('plus')}</span> Novo visitante</button>
      </div>
    </section>

    <div class="welcome-banner">
      <div class="welcome-copy"><div class="welcome-icon">${ICON('sparkle')}</div><div><strong>O cuidado começa na chegada.</strong><p>Há <b>${visitorCountByStatus('Novo')}</b> visitantes esperando um primeiro contato hoje.</p></div></div>
      <button class="btn btn-quiet welcome-action" data-view="pulpit">Abrir modo púlpito ${ICON('arrow-up-right')}</button>
    </div>

    <section class="stat-grid">
      ${statCard('Visitantes este mês', state.metrics.visits, state.metrics.visits ? '+18,4%' : '—', 'vs. mês anterior', 'users', 'copper', false, 'visits')}
      ${statCard('Retornos confirmados', state.metrics.returns, state.metrics.returns ? '+6,2%' : '—', 'da base de visitantes', 'refresh', 'gold', false, 'returns')}
      ${statCard('Alcance da comunidade', state.metrics.reach, state.metrics.reach ? '+12,8%' : '—', 'pessoas alcançadas', 'send', 'green', false, 'reach')}
      ${statCard('Próximo culto', events[0] ? `${String(dateDay(events[0].date)).padStart(2, '0')}/${String(parseDate(events[0].date).getMonth() + 1).padStart(2, '0')}` : '—', events[0]?.time || '—', events[0]?.title || 'Nenhum evento agendado', 'calendar', 'dark', true, 'next')}
    </section>

    <div class="dashboard-grid">
      <div class="side-stack">
        <section class="panel activity-panel"><div class="panel-header"><div class="panel-heading"><h2>Atividade recente</h2><p>O que está acontecendo na ${esc(church.name)}</p></div><button class="panel-link" data-view="visitors">Ver tudo ${ICON('arrow-up-right')}</button></div><ul class="activity-list">${renderActivityItems()}</ul></section>
        <section class="panel upcoming-panel"><div class="panel-header"><div class="panel-heading"><h2>Próximos eventos</h2><p>Programação da igreja</p></div><button class="panel-link" data-view="agenda">Agenda ${ICON('arrow-up-right')}</button></div><div class="event-list">${events.slice(0, 3).map(renderEventRow).join('')}</div></section>
      </div>
    </div>

    <section class="panel chart-panel growth-panel">
      <div class="panel-header"><div class="panel-heading"><h2>Visão de crescimento</h2><p>Visitantes registrados nas últimas 12 semanas</p></div><div class="chart-legend"><span class="legend-key"><i class="legend-dot"></i> Visitantes</span><span class="legend-key"><i class="legend-dot copper"></i> Retornos</span></div></div>
      <div class="chart-wrap"><div class="chart-y"><span>80</span><span>60</span><span>40</span><span>20</span><span>0</span></div><div class="chart-area"><div class="chart-grid"><span></span><span></span><span></span><span></span><span></span></div><div class="bars">${chartValues.map((value, index) => `<div class="bar-group"><i class="bar copper" style="height:${Math.max(12, value * .55)}%"></i><i class="bar gold" style="height:${value}%"></i></div>`).join('')}</div><div class="x-labels"><span>Jun 14</span><span>Jun 28</span><span>Jul 12</span><span>Jul 26</span><span>Ago 09</span><span>Ago 23</span><span>Set 04</span></div></div></div>
      <div class="chart-footer"><span>Este mês</span><strong>${state.metrics.visits} visitantes</strong><span class="stat-trend">${state.metrics.visits ? `${ICON('arrow-up-right')} 18,4%` : '—'}</span><button class="panel-link" data-action="growth-goals">${ICON('sparkle')} Metas de crescimento</button></div>
    </section>
    <section class="panel" style="margin-top:20px;"><div class="panel-header"><div class="panel-heading"><h2>Metas de crescimento</h2><p>Acompanhe objetivos simples para a próxima fase da igreja.</p></div><button class="btn btn-secondary" data-action="growth-goals">Editar metas</button></div><div class="split-stat" style="padding:0 22px 22px;"><div><small>Visitantes</small><strong>${esc(state.metrics.visits)} / ${esc(state.growthGoals?.visitors || 0)}</strong></div><div><small>Retornos</small><strong>${esc(state.metrics.returns)} / ${esc(state.growthGoals?.returns || 0)}</strong></div><div><small>Membros</small><strong>${esc(activeMemberCount())} / ${esc(state.growthGoals?.members || 0)}</strong></div></div></section>
    ${renderCareSummaryPanel()}
    ${renderGrowthStrategyPanel()}
  `;
}

function statCard(label, value, trendOrSubtitle, subtitleOrIcon, icon, tone = 'gold', special = false, metric = '') {
  const interactive = metric ? 'stat-card-interactive' : '';
  const actionAttrs = metric ? `data-action="open-metric" data-metric="${esc(metric)}" role="button" tabindex="0" aria-label="Abrir detalhes de ${esc(label)}"` : '';
  const openIcon = metric ? `<span class="stat-open">${ICON('arrow-up-right')}</span>` : '';
  if (special) {
    return `<article class="stat-card ${interactive}" ${actionAttrs}><div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon ${tone}">${ICON(icon)}</span></div><div class="stat-number">${esc(value)}</div><div class="stat-bottom"><span class="stat-trend copper">${esc(trendOrSubtitle)}</span><span>${esc(subtitleOrIcon)}</span></div>${openIcon}</article>`;
  }
  return `<article class="stat-card ${interactive}" ${actionAttrs}><div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon ${tone}">${ICON(icon)}</span></div><div class="stat-number">${esc(value)}</div><div class="stat-bottom"><span class="stat-trend">${ICON('arrow-up-right')} ${esc(trendOrSubtitle)}</span><span>${esc(subtitleOrIcon)}</span></div>${openIcon}</article>`;
}

function renderActivityItems() {
  return state.activity.slice(0, 4).map(item => `<li class="activity-item"><div class="activity-avatar ${iconTone(item.tone)}">${esc(item.initials)}</div><div class="activity-content"><p><strong>${esc(item.name)}</strong> ${esc(item.text)}</p><span class="activity-time">${esc(item.time)}</span></div></li>`).join('');
}

function renderMembers() {
  const church = getActiveChurch();
  const members = state.members || [];
  const total = members.length || Number(church?.members || 0);
  const active = members.filter(member => member.status !== 'inactive').length || total;
  const rows = members.length ? members.map(member => `<div class="team-user-row"><div class="avatar avatar-olive">${esc(initials(member.name))}</div><div class="team-user-copy"><strong>${esc(preferredDisplayName(member))}</strong><span>${esc(member.ministry || 'Membro')} · ${esc(member.phone || 'Telefone não informado')}</span><small>${member.email ? esc(member.email) : 'E-mail não informado'}${member.lastAttendedAt ? ` · última presença ${esc(formatDateShort(String(member.lastAttendedAt).slice(0, 10)))}` : ''}</small></div><span class="team-status">${member.status === 'inactive' ? 'Inativo' : 'Ativo'}</span><button class="table-action" data-action="member-detail" data-id="${esc(member.id)}" aria-label="Abrir membro">${ICON('more')}</button></div>`).join('') : `<div class="empty-state"><div class="icon-tile">${ICON('users')}</div><h3>A base de membros está pronta</h3><p>Cadastre os membros da ${esc(church.name)} para começar o acompanhamento.</p><button class="btn btn-gold" data-action="new-member">${ICON('plus')} Cadastrar primeiro membro</button></div>`;
  return `<section class="page-head"><div><span class="eyebrow">COMUNIDADE</span><h1>Membros</h1><p>Uma base organizada para cuidar das pessoas que fazem parte da ${esc(church.name)}.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="export-members">${ICON('download')} Exportar membros</button><button class="btn btn-gold" data-action="new-member">${ICON('plus')} Novo membro</button></div></section><div class="stat-grid"><article class="stat-card"><div class="stat-top"><span class="stat-label">Membros cadastrados</span><span class="stat-icon copper">${ICON('users')}</span></div><div class="stat-number">${esc(total)}</div><div class="stat-bottom"><span>base da igreja</span><span>multi-igreja</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Ativos</span><span class="stat-icon green">${ICON('check-circle')}</span></div><div class="stat-number">${esc(active)}</div><div class="stat-bottom"><span>em acompanhamento</span><span>status atualizado</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Meta de crescimento</span><span class="stat-icon gold">${ICON('arrow-up-right')}</span></div><div class="stat-number">${esc(state.growthGoals?.members || 0)}</div><div class="stat-bottom"><span>membros até o fim do ciclo</span><button class="panel-link" data-action="growth-goals">Editar meta ${ICON('arrow-up-right')}</button></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Presenças no mês</span><span class="stat-icon green">${ICON('check-circle')}</span></div><div class="stat-number">${esc(state.attendanceSummary?.month || 0)}</div><div class="stat-bottom"><span>membros registrados</span><span>cuidado, não ranking</span></div></article></div><section class="panel"><div class="panel-header"><div class="panel-heading"><h2>Cadastro de membros</h2><p>Dados separados e protegidos para esta igreja.</p></div><span class="status-pill status-integrated">${esc(total)} ${total === 1 ? 'membro' : 'membros'}</span></div><div class="team-list" style="padding:0 22px 22px;">${rows}</div></section>`;
}

function renderAcolhimento() {
  const church = getActiveChurch();
  const pending = pendingPulpitVisitors();
  const recent = state.visitors.slice(0, 8);
  const groups = visitorAnnouncementGroups(recent);
  const messageVisitors = pending.length ? pending : recent.slice(0, 4);
  const suggestedMessage = buildVisitorAnnouncement(messageVisitors);
  const totalPeople = recent.reduce((total, visitor) => total + getFamilyMembers(visitor).length, 0);
  const groupMarkup = groups.length ? groups.map(group => `<div class="acolhimento-group-row"><div class="acolhimento-group-icon arrival-${arrivalTone(group.type)}">${ICON(arrivalIcon(group.type))}</div><div class="acolhimento-group-copy"><div class="acolhimento-group-title">${arrivalPill(group.type)}<strong>${esc(group.label)}</strong></div><p>${esc(namesAsSentence(group.names))}</p></div></div>`).join('') : `<div class="empty-state"><div class="icon-tile">${ICON('users')}</div><h3>Nenhum cadastro ainda</h3><p>Os visitantes cadastrados na recepção aparecerão aqui.</p></div>`;
  return `
    <section class="page-head"><div><span class="eyebrow">RECEPÇÃO · ACOLHIMENTO</span><h1>Acolhimento</h1><p>Uma visão simples para a equipe receber cada pessoa pelo nome e respeitar seus grupos.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="announce-visitors">${ICON('megaphone')} Preparar mensagem</button><button class="btn btn-gold" data-action="new-visitor">${ICON('plus')} Novo visitante</button></div></section>
    <section class="welcome-banner acolhimento-welcome"><div class="welcome-copy"><div class="welcome-icon">${ICON('heart')}</div><div><strong>Todos os cadastros da recepção chegam a esta aba.</strong><p>Famílias, casais, amigos e visitantes individuais ficam organizados para facilitar o cuidado e o anúncio.</p></div></div><span class="access-scope-badge">ACESSO DA RECEPÇÃO</span></section>
    <div class="section-grid acolhimento-layout"><section class="panel acolhimento-message-panel"><div class="panel-header"><div class="panel-heading"><h2>Mensagem sugerida</h2><p>${pending.length ? `${pending.length} cadastro${pending.length === 1 ? '' : 's'} novo${pending.length === 1 ? '' : 's'} para anunciar` : 'Mensagem baseada nos cadastros mais recentes'}</p></div><span class="status-pill ${pending.length ? 'status-new' : 'status-integrated'}">${pending.length ? 'Pendente' : 'Em dia'}</span></div><div class="acolhimento-message-box"><span class="scope-label">PRÉVIA PARA A IGREJA</span><p>${esc(suggestedMessage.body)}</p></div><div class="acolhimento-panel-actions"><button class="btn btn-secondary" data-action="announce-visitors">${ICON('send')} Editar mensagem</button><button class="btn btn-quiet" data-view="pulpit">${ICON('expand')} Modo púlpito</button></div></section><section class="panel info-card acolhimento-summary"><div class="card-topline"><div><h3>Resumo da recepção</h3><p>Cadastros disponíveis para o acolhimento.</p></div><div class="icon-tile copper">${ICON('users')}</div></div><div class="split-stat"><div><small>Pessoas</small><strong>${totalPeople}</strong></div><div><small>Grupos</small><strong>${groups.length}</strong></div><div><small>Novos</small><strong>${pending.length}</strong></div></div><button class="btn btn-secondary btn-full" style="margin-top:22px;" data-view="visitors">${ICON('users')} Ver cadastros</button></section></div>
    <section class="panel acolhimento-groups-panel"><div class="panel-header"><div class="panel-heading"><h2>Visitantes por grupo</h2><p>Os nomes permanecem juntos para facilitar o entendimento dos pastores e da recepção.</p></div><span class="panel-link">${ICON('shield')} Igreja: ${esc(church.name)}</span></div><div class="acolhimento-group-list">${groupMarkup}</div></section>
  `;
}

function renderEventRow(event) {
  return `<div class="event-row"><div class="event-date"><strong>${String(dateDay(event.date)).padStart(2, '0')}</strong><span>${esc(dateMonth(event.date))}</span></div><div class="event-info"><strong>${esc(event.title)}</strong><span>${ICON('clock')} ${esc(event.time)} · ${esc(event.location)}</span></div><div class="event-row-meta"><span class="event-tag">${esc(event.type)}${event.recurrenceId ? ' · recorrente' : ''}</span><span class="status-pill ${eventStatusClass(event.status)}">${eventStatusLabel(event.status)}</span></div><button class="table-action" data-action="edit-event" data-id="${esc(event.id)}" aria-label="Editar ${esc(event.title)}">${ICON('settings')}</button></div>`;
}

function renderAgendaEvent(event) {
  return `<div class="agenda-event ${event.status !== 'active' ? 'agenda-event-muted' : ''}"><div class="event-date"><strong>${String(dateDay(event.date)).padStart(2, '0')}</strong><span>${esc(dateMonth(event.date))}</span></div><div class="event-info"><strong>${esc(event.title)}</strong><span>${ICON('clock')} ${esc(event.time)} · ${esc(event.location)}</span></div><div class="event-row-meta"><span class="event-tag">${esc(event.type)}</span><span class="status-pill ${eventStatusClass(event.status)}">${eventStatusLabel(event.status)}</span></div><button class="btn btn-secondary btn-small" data-action="edit-event" data-id="${esc(event.id)}">${ICON('settings')} Editar</button></div>`;
}

function renderVisitors() {
  const church = getActiveChurch();
  const newCount = visitorCountByStatus('Novo');
  const returned = visitorCountByStatus('Retornou') + visitorCountByStatus('Integrado');
  const hasVisitors = state.metrics.visits > 0;
  const returnRate = hasVisitors ? '47,4%' : '0%';
  const returnTrend = hasVisitors ? `${ICON('arrow-up-right')} 4,8%` : '—';
  return `
    <section class="page-head"><div><span class="eyebrow">RELACIONAMENTO</span><h1>Visitantes</h1><p>Receba, acompanhe e cuide de cada nova história que chega à ${esc(church.name)}.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="announce-visitors">${ICON('megaphone')} Preparar anúncio</button><button class="btn btn-secondary" data-view="pulpit">${ICON('expand')} Modo púlpito</button><button class="btn btn-gold" data-action="new-visitor">${ICON('plus')} Novo visitante</button></div></section>
    <section class="stat-grid"><article class="stat-card"><div class="stat-top"><span class="stat-label">Novos para acompanhar</span><span class="stat-icon copper">${ICON('clipboard-check')}</span></div><div class="stat-number">${newCount}</div><div class="stat-bottom"><span>precisam de atenção</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Retornaram</span><span class="stat-icon green">${ICON('refresh')}</span></div><div class="stat-number">${returned}</div><div class="stat-bottom"><span class="stat-trend">${hasVisitors ? `${ICON('arrow-up-right')} 9,4%` : '—'}</span><span>neste mês</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Total no mês</span><span class="stat-icon gold">${ICON('users')}</span></div><div class="stat-number">${state.metrics.visits}</div><div class="stat-bottom"><span>cadastros realizados</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Taxa de retorno</span><span class="stat-icon dark">${ICON('check-circle')}</span></div><div class="stat-number">${returnRate}</div><div class="stat-bottom"><span class="stat-trend">${returnTrend}</span><span>vs. mês anterior</span></div></article></section>
    <section class="panel arrival-overview"><div class="panel-header"><div class="panel-heading"><h2>Como chegaram à ${esc(church.name)}</h2><p>Identificação rápida para o cuidado e o anúncio dos pastores.</p></div><span class="panel-link">${ICON('shield')} Informação da recepção</span></div><div class="arrival-grid"><div class="arrival-card arrival-alone"><div class="arrival-card-icon">${ICON('user-round')}</div><div><strong>${visitorCountByArrival('Sozinho')}</strong><span>Sozinho</span></div></div><div class="arrival-card arrival-friends"><div class="arrival-card-icon">${ICON('sparkle')}</div><div><strong>${visitorCountByArrival('Com amigos')}</strong><span>Com amigos</span></div></div><div class="arrival-card arrival-couple"><div class="arrival-card-icon">${ICON('heart')}</div><div><strong>${visitorCountByArrival('Em casal')}</strong><span>Em casal</span></div></div><div class="arrival-card arrival-family"><div class="arrival-card-icon">${ICON('users')}</div><div><strong>${visitorCountByArrival('Família')}</strong><span>Família</span></div></div></div></section>
    <section class="panel table-panel"><div class="panel-header"><div class="panel-heading"><h2>Todos os visitantes</h2><p>${state.visitors.length} registros recentes na área de trabalho</p></div><button class="btn btn-secondary" data-action="filter-help">${ICON('filter')} Filtros</button></div><div class="toolbar" style="padding: 0 21px;"><div class="toolbar-left"><div class="input-wrap">${ICON('search')}<input class="input" id="visitorSearch" type="search" placeholder="Buscar por nome ou telefone" autocomplete="off"></div></div><div class="toolbar-right"><select class="select" id="visitorArrival" aria-label="Filtrar como chegou"><option value="">Como chegou?</option><option value="Sozinho">Sozinho</option><option value="Com amigos">Com amigos</option><option value="Em casal">Em casal</option><option value="Família">Família</option></select><select class="select" id="visitorStatus" aria-label="Filtrar status"><option value="">Todos os status</option><option value="Novo">Novos</option><option value="Contatado">Contatados</option><option value="Retornou">Retornaram</option><option value="Integrado">Integrados</option></select></div></div><div class="table-scroll"><table><thead><tr><th>Visitante</th><th>Como veio</th><th>Data da visita</th><th>Contato</th><th>Status</th><th>Responsável</th><th></th></tr></thead><tbody id="visitorRows">${renderVisitorRows()}</tbody></table></div></section>
  `;
}

function renderVisitorRows() {
  const search = ($('#visitorSearch')?.value || '').trim().toLowerCase();
  const statusFilter = $('#visitorStatus')?.value || '';
  const arrivalFilter = $('#visitorArrival')?.value || '';
  const visitors = state.visitors.filter(visitor => {
    const matchesSearch = !search || `${visitor.name} ${visitor.phone} ${getFamilyMembers(visitor).join(' ')}`.toLowerCase().includes(search);
    const matchesStatus = !statusFilter || visitor.status === statusFilter;
    const matchesArrival = !arrivalFilter || (visitor.arrivalType || 'Sozinho') === arrivalFilter;
    return matchesSearch && matchesStatus && matchesArrival;
  });
  if (!visitors.length) return `<tr><td colspan="7"><div class="empty-state"><div class="icon-tile">${ICON('search')}</div><h3>Nenhum visitante encontrado</h3><p>Tente mudar o termo de busca ou o filtro selecionado.</p></div></td></tr>`;
  return visitors.map(visitor => `<tr><td><div class="person-cell"><div class="avatar ${iconTone(visitor.status === 'Novo' ? 'copper' : visitor.status === 'Retornou' ? 'olive' : 'dark')}">${esc(initials(visitor.name))}</div><div><strong>${esc(visitor.name)}</strong><span>${esc(visitor.service)}</span>${familySummary(visitor)}</div></div></td><td>${arrivalPill(visitor.arrivalType || 'Sozinho')}</td><td>${esc(formatDateShort(visitor.date))}</td><td>${esc(visitor.phone || 'Sem telefone')}</td><td><span class="status-pill ${statusClass(visitor.status)}">${esc(visitor.status)}</span></td><td>${esc(visitor.responsible)}</td><td><button class="table-action" data-action="visitor-detail" data-id="${esc(visitor.id)}" aria-label="Ver detalhes de ${esc(visitor.name)}">${ICON('more')}</button></td></tr>`).join('');
}

function pendingPulpitVisitors() {
  return state.visitors.filter(visitor => visitor.status === 'Novo' && !visitor.announced);
}

function renderPulpitPerson(visitor) {
  const members = getFamilyMembers(visitor);
  const heading = members.length > 1 ? (visitor.familyName || `${members.length} pessoas juntas`) : visitor.name;
  return `<article class="pulpit-person"><div class="pulpit-person-top"><span class="arrival-pill arrival-${arrivalTone(visitor.arrivalType || 'Sozinho')}">${ICON(arrivalIcon(visitor.arrivalType || 'Sozinho'))} ${esc(visitor.arrivalType || 'Sozinho')}</span><span class="pulpit-person-date">${esc(formatDateShort(visitor.date))}</span></div><h3>${esc(heading)}</h3>${members.length > 1 ? `<div class="pulpit-names">${members.map((member, index) => `<div class="pulpit-name"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(member)}</strong></div>`).join('')}</div>` : `<div class="pulpit-single-name">${ICON('user-round')} <strong>${esc(members[0] || visitor.name)}</strong></div>`}<p class="pulpit-service">${esc(visitor.service)}${visitor.invitedBy && visitor.invitedBy !== '—' ? ` · convidado por ${esc(visitor.invitedBy)}` : ''}</p></article>`;
}

function renderPulpitGroup(type, visitors) {
  if (!visitors.length) return '';
  return `<section class="pulpit-group"><div class="pulpit-group-head"><div class="pulpit-group-title"><span class="arrival-group-icon arrival-${arrivalTone(type)}">${ICON(arrivalIcon(type))}</span><div><h2>${esc(type)}</h2><p>${visitors.length === 1 ? '1 cadastro' : `${visitors.length} cadastros`}</p></div></div><span class="pulpit-group-count">${visitors.reduce((total, visitor) => total + getFamilyMembers(visitor).length, 0)} ${visitors.reduce((total, visitor) => total + getFamilyMembers(visitor).length, 0) === 1 ? 'pessoa' : 'pessoas'}</span></div><div class="pulpit-people">${visitors.map(renderPulpitPerson).join('')}</div></section>`;
}

function renderPulpit() {
  const pending = pendingPulpitVisitors();
  const names = familyNamesForVisitors(pending);
  const grouped = ['Sozinho', 'Com amigos', 'Em casal', 'Família'].map(type => renderPulpitGroup(type, pending.filter(visitor => (visitor.arrivalType || 'Sozinho') === type))).join('');
  return `
    <section class="pulpit-hero"><div class="pulpit-hero-top"><div><span class="pulpit-live">${ICON('megaphone')} MODO PÚLPITO · ATUALIZADO AGORA</span><h1>Visitantes para anunciar</h1><p>Uma tela limpa para os pastores consultarem no púlpito e darem as boas-vindas com carinho.</p></div><div class="pulpit-hero-actions"><button class="pulpit-outline-btn" data-action="fullscreen-pulpit">${ICON('expand')} Tela cheia</button><button class="pulpit-gold-btn" data-action="announce-visitors">${ICON('send')} Preparar mensagem</button></div></div><div class="pulpit-stats"><div><strong>${names.length}</strong><span>pessoas para receber</span></div><i></i><div><strong>${pending.length}</strong><span>cadastros novos</span></div><i></i><div><strong>${pending.filter(visitor => getFamilyMembers(visitor).length > 1).length}</strong><span>grupos ou famílias</span></div></div></section>
    <div class="pulpit-instruction"><span class="pulpit-instruction-icon">${ICON('check-circle')}</span><div><strong>Leia os nomes abaixo durante o culto</strong><p>Os visitantes estão separados por como chegaram. Depois do anúncio, marque tudo como apresentado.</p></div>${pending.length ? `<button class="btn btn-primary" data-action="mark-pulpit-announced">${ICON('check')} Marcar como apresentados</button>` : ''}</div>
    ${pending.length ? `<div class="pulpit-groups">${grouped}</div>` : `<section class="pulpit-empty"><div class="icon-tile green">${ICON('check-circle')}</div><h2>Tudo em dia por aqui</h2><p>Não há visitantes pendentes para anunciar. Novos cadastros aparecerão automaticamente nesta tela.</p><button class="btn btn-gold" data-action="new-visitor">${ICON('plus')} Cadastrar visitante</button></section>`}
  `;
}

function renderCommunication() {
  return `
    <section class="page-head"><div><span class="eyebrow">CONEXÃO</span><h1>Comunicação</h1><p>Leve a palavra certa para as pessoas certas, no momento certo.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="channel-settings">${ICON('settings')} Canais</button><button class="btn btn-gold" data-action="new-announcement">${ICON('plus')} Novo aviso</button></div></section>
    <section class="stat-grid"><article class="stat-card"><div class="stat-top"><span class="stat-label">Avisos registrados</span><span class="stat-icon gold">${ICON('megaphone')}</span></div><div class="stat-number">${state.metrics.announcements}</div><div class="stat-bottom"><span class="stat-trend">${state.metrics.announcements ? `${ICON('arrow-up-right')} 14,2%` : '—'}</span><span>este mês</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Leitura (sem envio)</span><span class="stat-icon green">${ICON('check-circle')}</span></div><div class="stat-number">0%</div><div class="stat-bottom"><span>envio ainda não configurado</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Pessoas na base</span><span class="stat-icon copper">${ICON('send')}</span></div><div class="stat-number">${state.metrics.reach}</div><div class="stat-bottom"><span>membros e visitantes</span></div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Canais configurados</span><span class="stat-icon dark">${ICON('smartphone')}</span></div><div class="stat-number">0</div><div class="stat-bottom"><span>integração futura</span></div></article></section>
    <div class="section-grid"><section class="panel"><div class="panel-header"><div class="panel-heading"><h2>Últimos avisos</h2><p>Histórico de comunicações da igreja</p></div><button class="panel-link" data-action="new-announcement">Criar aviso ${ICON('plus')}</button></div><div class="announcement-list" style="padding: 0 22px 22px;">${state.announcements.map(renderAnnouncement).join('')}</div></section><section class="panel info-card"><div class="card-topline"><div><h3>Configuração por canal</h3><p>Os canais ficam registrados para uma futura integração de envio.</p></div><div class="icon-tile gold">${ICON('send')}</div></div><div class="split-stat"><div><small>Notificação push</small><strong>Não</strong></div><div><small>WhatsApp</small><strong>Não</strong></div><div><small>E-mail</small><strong>Não</strong></div></div><div class="mini-progress"><span style="width: 0%"></span></div><p class="field-note" style="margin-top: 12px;">A configuração fica salva, mas o envio real ainda não está habilitado.</p><button class="btn btn-secondary btn-full" style="margin-top: 19px;" data-action="channel-settings">${ICON('settings')} Configurar canais</button></section></div>
  `;
}

function renderAnnouncement(item) {
  const tone = item.tone === 'copper' ? 'copper' : '';
  return `<article class="announcement-card"><div class="announcement-icon ${tone}">${ICON(item.tone === 'copper' ? 'users' : 'megaphone')}</div><div class="announcement-body"><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p><div class="announcement-meta"><span class="channel-pill">${ICON('users')} ${esc(item.audience)}</span>${item.channels.map(channel => `<span class="channel-pill">${channel === 'WhatsApp' ? ICON('whatsapp') : channel === 'E-mail' ? ICON('mail') : ICON('smartphone')} ${esc(channel)}</span>`).join('')}${item.personalizeGreeting ? `<span class="channel-pill">${ICON('users')} Saudação personalizada</span>` : ''}</div></div><div class="announcement-side"><span class="announcement-status">${esc(item.status)}</span><span class="announcement-date">${esc(item.date)}</span><span class="announcement-date">${esc(item.reach)}</span></div></article>`;
}

function renderAgenda() {
  const church = getActiveChurch();
  const monthDate = `${state.calendarMonth || TODAY.slice(0, 7)}-01`;
  const monthCursor = parseDate(monthDate);
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = monthCursor.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push(`<div class="calendar-day muted">${daysInPrevMonth - i}</div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasEvent = state.events.some(event => event.date === date);
    const today = date === TODAY;
    cells.push(`<div class="calendar-day ${today ? 'today' : ''} ${hasEvent ? 'has-event' : ''}">${day}</div>`);
  }
  let nextDay = 1;
  while (cells.length < 42) cells.push(`<div class="calendar-day muted">${nextDay++}</div>`);
  return `
    <section class="page-head"><div><span class="eyebrow">PROGRAMAÇÃO</span><h1>Agenda</h1><p>Uma visão simples de tudo o que está acontecendo na ${esc(church.name)}.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="export-events">${ICON('download')} Exportar agenda</button><button class="btn btn-gold" data-action="new-event">${ICON('plus')} Novo evento</button></div></section>
    <div class="agenda-layout"><section class="panel agenda-card"><div class="month-header"><button class="icon-btn" aria-label="Mês anterior" data-action="calendar-prev">${ICON('chevron-right')}</button><h2>${esc(monthLabel(monthDate))}</h2><div class="month-header-actions"><button class="btn btn-secondary" data-action="today">Hoje</button><button class="icon-btn" aria-label="Próximo mês" data-action="calendar-next">${ICON('chevron-right')}</button></div></div><div class="weekdays"><span>DOM</span><span>SEG</span><span>TER</span><span>QUA</span><span>QUI</span><span>SEX</span><span>SÁB</span></div><div class="calendar-grid">${cells.join('')}</div><div class="agenda-events"><div class="agenda-events-head"><div><h3>Eventos desta semana</h3><p class="field-note">Clique em “Editar” para alterar nome, data, horário, público ou situação.</p></div><span class="status-pill status-integrated">${sortedEvents().length} ${sortedEvents().length === 1 ? 'evento' : 'eventos'}</span></div>${sortedEvents().map(renderAgendaEvent).join('') || `<div class="empty-state"><h3>Nenhum evento cadastrado</h3><p>Adicione o primeiro evento da igreja.</p></div>`}</div></section><div class="side-stack"><section class="panel info-card"><div class="card-topline"><div><h3>Próximo encontro</h3><p>O que vem a seguir na agenda.</p></div><div class="icon-tile copper">${ICON('calendar')}</div></div>${renderNextEvent(upcomingEvents()[0])}</section><section class="panel info-card"><div class="card-topline"><div><h3>Resumo da agenda</h3><p>Programação organizada por categoria.</p></div><div class="icon-tile gold">${ICON('clipboard-check')}</div></div><div class="split-stat"><div><small>Cultos</small><strong>${state.events.filter(event => event.type === 'Culto').length}</strong></div><div><small>Encontros</small><strong>${state.events.filter(event => event.type !== 'Culto').length}</strong></div><div><small>Este mês</small><strong>${state.events.length}</strong></div></div><button class="btn btn-secondary btn-full" style="margin-top: 22px;" data-action="new-event">${ICON('plus')} Adicionar evento</button></section></div></div>
  `;
}

function renderNextEvent(event) {
  if (!event) return `<div class="empty-state"><h3>Nenhum evento</h3><p>Adicione o primeiro compromisso da igreja.</p></div>`;
  return `<div style="display:flex;align-items:center;gap:13px;padding: 4px 0 8px;"><div class="event-date" style="width:48px;height:51px;"><strong style="font-size:19px;">${String(dateDay(event.date)).padStart(2, '0')}</strong><span>${esc(dateMonth(event.date))}</span></div><div class="event-info"><strong style="font-size:13px;">${esc(event.title)}</strong><span style="font-size:10px;margin-top:6px;">${ICON('clock')} ${esc(event.time)}</span><span style="font-size:10px;margin-top:5px;">${ICON('map-pin')} ${esc(event.location)}</span></div></div><div class="mini-progress"><span style="width: 72%"></span></div><p class="field-note" style="margin-top: 9px;">${esc(event.audience)} · programação publicada</p>`;
}

function renderLeaders() {
  const church = getActiveChurch();
  return `
    <section class="page-head"><div><span class="eyebrow">EQUIPE</span><h1>Lideranças</h1><p>As pessoas que ajudam a cuidar da ${esc(church.name)} todos os dias.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="export-leaders">${ICON('download')} Exportar equipe</button><button class="btn btn-gold" data-action="new-leader">${ICON('plus')} Adicionar líder</button></div></section>
    <div class="welcome-banner"><div class="welcome-copy"><div class="welcome-icon">${ICON('users')}</div><div><strong>Uma equipe alinhada cuida melhor.</strong><p>Gerencie permissões e mantenha cada ministério conectado.</p></div></div><button class="btn btn-quiet welcome-action" data-view="settings">Gerenciar permissões ${ICON('arrow-up-right')}</button></div>
    <div class="leader-grid">${state.leaders.map(leader => `<article class="leader-card"><div class="leader-head"><div class="avatar ${iconTone(leader.tone)}">${esc(leader.initials)}</div><div><strong>${esc(preferredDisplayName(leader))}</strong><span>${esc(genderedRole(leader, leader.role))}</span></div><button class="table-action" style="margin-left:auto;" data-action="leader-detail" data-id="${esc(leader.id)}" aria-label="Ver líder">${ICON('more')}</button></div><div class="leader-contact">${ICON('smartphone')} ${esc(leader.phone)}</div><div class="leader-footer"><span>Ministério / grupo</span><span class="role-pill">${esc(leader.group)}</span></div></article>`).join('')}</div>
  `;
}

function renderReceptionUsers() {
  const users = state.receptionUsers || [];
  if (!users.length) return `<div class="empty-state"><div class="icon-tile">${ICON('users')}</div><h3>Nenhum acesso de recepção</h3><p>Adicione o primeiro obreiro ou membro autorizado.</p></div>`;
  return users.map(user => `<div class="team-user-row"><div class="avatar ${iconTone(user.tone || 'dark')}">${esc(user.initials || initials(user.name))}</div><div class="team-user-copy"><strong>${esc(user.name)}</strong><span>${esc(user.role)} · ${esc(user.login || 'login pendente')}</span><small>Último acesso: ${esc(user.lastAccess || 'ainda não acessou')}</small><small class="team-access-note">${ICON('heart')} Aba Acolhimento liberada</small></div><span class="team-status ${user.status === 'Bloqueado' ? 'team-status-blocked' : ''}">${esc(user.status === 'Bloqueado' ? 'Bloqueado' : (user.passwordStatus || 'Ativa'))}</span><button class="table-action" data-action="reception-detail" data-id="${esc(user.id)}" aria-label="Ver acesso de ${esc(user.name)}">${ICON('more')}</button></div>`).join('');
}

function renderSettings() {
  pendingLogoImage = null;
  const church = getActiveChurch();
  const churchLogo = church.logoImage || '';
  const churchPhone = church.phone || '(21) 00000-0000';
  const churchPastors = church.pastors || 'Evandro e Simone';
  const churchDescription = church.description || 'Um lugar para pertencer, crescer e viver a fé em comunidade.';
  const appearance = { ...DEFAULT_APPEARANCE, ...(church.appearance || {}) };
  const publicSettings = { visible: true, headline: church.description || '', address: church.city || '', hours: 'Domingos às 19h', instagram: '', facebook: '', youtube: '', cta: 'Venha nos visitar', ...(church.publicSettings || {}) };
  const organizationManagement = isPlatformAdmin() ? `<section class="settings-card saas-card" data-settings-panel="saas"><div class="saas-content"><div class="settings-card-header" style="border:0;padding-bottom:0;margin-bottom:0;"><div><h2>Pronto para outras igrejas</h2><p>A administração da plataforma gerencia organizações, planos e responsáveis.</p></div><div class="icon-tile gold">${ICON('crown')}</div></div><div class="plan-line"><span class="plan-badge">Administrador da plataforma</span><span>${state.churches.length} organização${state.churches.length === 1 ? '' : 'ões'} cadastrada${state.churches.length === 1 ? '' : 's'}</span></div><div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:20px;"><div><strong style="font-size:12px;">Área de organizações</strong><p class="field-note" style="margin-top:5px;">Cadastre novas igrejas, planos e responsáveis em um único painel.</p></div><button class="btn btn-primary" data-action="new-church">${ICON('plus')} Adicionar igreja</button></div></div></section><section class="settings-card" data-settings-panel="saas"><div class="settings-card-header"><div><h2>Igrejas cadastradas</h2><p>Organizações disponíveis nesta conta administradora.</p></div><span class="status-pill status-integrated">${state.churches.length} ativa${state.churches.length === 1 ? '' : 's'}</span></div><div class="tenant-list">${state.churches.map(ch => `<div class="tenant-row"><div class="tenant-logo">${esc(ch.initials || initials(ch.name))}</div><div class="tenant-copy"><strong>${esc(ch.name)}</strong><span>${esc(ch.city)} · ${esc(ch.members || 0)} pessoas alcançadas</span></div><span class="tenant-status">${esc(ch.status || 'Ativa')}</span><button class="table-action" data-action="switch-church" data-id="${esc(ch.id)}" aria-label="Abrir ${esc(ch.name)}">${ICON('chevron-right')}</button></div>`).join('')}</div></section>` : `<section class="settings-card pastor-scope-card" data-settings-panel="organization"><div class="settings-card-header"><div><h2>Acesso da sua igreja</h2><p>Você está conectado como pastor e administra somente os dados desta organização.</p></div><div class="icon-tile copper">${ICON('shield')}</div></div><div class="pastor-scope-grid"><div><span class="scope-label">IGREJA ATIVA</span><strong>${esc(church.name)}</strong><p>${esc(church.city)} · identidade, visitantes e avisos desta igreja.</p></div><span class="access-scope-badge">PASTOR DA IGREJA</span></div><div class="scope-note"><span>${ICON('check-circle')}</span><p><strong>Você pode editar o nome e o logo</strong> desta igreja em “Identidade da igreja”. As outras igrejas e seus dados ficam protegidos e são administrados pelo administrador da plataforma.</p></div></section>`;
  const backupHistory = getBackupHistory();
  const latestBackup = backupHistory[0];
  const backupCard = `<section class="settings-card backup-settings-card" data-settings-panel="organization"><div class="settings-card-header"><div><h2>Histórico local de segurança</h2><p>Uma cópia local é criada a cada alteração salva neste navegador.</p></div><span class="backup-status"><span></span> ATIVO</span></div><div class="backup-summary"><div class="backup-summary-icon">${ICON('shield')}</div><div><strong>Versões recentes guardadas neste dispositivo</strong><p>Última cópia: ${esc(formatBackupDate(latestBackup?.createdAt))}</p></div><span class="backup-version-count">${backupHistory.length} ${backupHistory.length === 1 ? 'versão guardada' : 'versões guardadas'}</span></div><p class="field-note backup-note">Isso não substitui o backup do PostgreSQL no Railway. A rotina de backup do banco deve ser configurada separadamente antes da produção.</p></section>`;
  const profile = state.currentUser || {};
  const profileCard = `<section class="settings-card treatment-settings-card" data-settings-panel="organization"><div class="settings-card-header"><div><h2>Forma de tratamento do pastor</h2><p>Escolha como a plataforma deve se dirigir a você no painel e nas futuras mensagens personalizadas.</p></div><div class="icon-tile copper">${ICON('users')}</div></div><form data-form="profile"><div class="form-grid"><div class="form-field"><label for="profilePreferredName">Nome de preferência</label><input class="input" id="profilePreferredName" name="preferredName" value="${esc(profile.preferredName || '')}" placeholder="Como prefere ser chamado(a)"></div><div class="form-field"><label for="profileGender">Forma de tratamento</label><select class="select" id="profileGender" name="gender"><option value="unspecified" ${normalizedGender(profile) === 'unspecified' ? 'selected' : ''}>Não informar</option><option value="female" ${normalizedGender(profile) === 'female' ? 'selected' : ''}>Feminino — pastora, bem-vinda</option><option value="male" ${normalizedGender(profile) === 'male' ? 'selected' : ''}>Masculino — pastor, bem-vindo</option><option value="plural" ${normalizedGender(profile) === 'plural' ? 'selected' : ''}>Plural — pastores, bem-vindos</option></select></div></div><p class="field-note">A Emaús não tenta adivinhar o tratamento pelo nome. A escolha fica sob controle da própria pessoa.</p><div class="modal-actions"><button type="submit" class="btn btn-gold">${ICON('check')} Salvar tratamento</button></div></form></section>`;
  return `
    <section class="page-head"><div><span class="eyebrow">ÁREA ADMINISTRATIVA</span><h1>Configurações</h1><p>Personalize a experiência da ${esc(church.name)} e prepare sua igreja para crescer.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="open-public-page">${ICON('external')} Ver página pública</button><button class="btn btn-gold" data-action="save-settings">${ICON('check')} Salvar alterações</button></div></section>
    <div class="settings-layout"><aside class="settings-nav"><button class="active" data-settings-section="organization">${ICON('building')} Igreja</button><button data-settings-section="public">${ICON('external')} Página pública</button><button data-settings-section="notifications">${ICON('bell')} Notificações</button><button data-settings-section="team">${ICON('users')} Equipe e acesso</button>${isPlatformAdmin() ? `<button data-settings-section="saas">${ICON('crown')} Plataforma SaaS</button>` : ''}</aside><div class="settings-panels">
      <section class="settings-card" data-settings-panel="organization"><div class="settings-card-header"><div><h2>Identidade da igreja</h2><p>O pastor ou administrador desta igreja pode editar estas informações.</p></div><div style="display:flex;align-items:center;gap:9px;"><span class="access-scope-badge">${isPlatformAdmin() ? 'ADMIN DA PLATAFORMA' : 'PASTOR DA IGREJA'}</span><div class="icon-tile gold">${ICON('building')}</div></div></div><form data-form="organization"><div class="logo-editor"><div class="logo-preview" id="logoPreview"><span id="settingsLogoSymbol" ${churchLogo ? 'hidden' : ''}>${esc(churchLogoText(church))}</span><img id="settingsLogoImage" src="${esc(churchLogo)}" alt="Logo atual da igreja" ${churchLogo ? '' : 'hidden'}></div><div class="logo-editor-copy"><div class="form-field"><label for="churchLogoSymbol">Símbolo ou iniciais</label><input class="input" id="churchLogoSymbol" name="logoSymbol" maxlength="2" value="${esc(churchLogoText(church))}" placeholder="Ex.: B"></div><div class="file-upload-field"><label class="file-label" for="churchLogoFile">${ICON('download')} Enviar imagem do logo</label><input id="churchLogoFile" name="logoFile" type="file" accept="image/png,image/jpeg,image/webp" class="file-input"></div><button type="button" class="btn btn-quiet logo-remove" data-action="remove-logo">Usar somente o símbolo de texto</button><p class="field-note">O logo escolhido aparece ao lado de “Início” e da lupa.</p></div></div><div class="form-grid"><div class="form-field"><label for="churchName">Nome da igreja</label><input class="input" id="churchName" name="churchName" value="${esc(church.name)}"></div><div class="form-field"><label for="churchCity">Cidade e estado</label><input class="input" id="churchCity" name="churchCity" value="${esc(church.city)}"></div><div class="form-field"><label for="pastorName">Pastores responsáveis</label><input class="input" id="pastorName" name="pastorName" value="${esc(churchPastors)}"></div><div class="form-field"><label for="churchPhone">Telefone principal</label><input class="input" id="churchPhone" name="churchPhone" type="tel" value="${esc(churchPhone)}" placeholder="(21) 99999-9999"></div><div class="form-field full"><label for="churchDescription">Mensagem de boas-vindas</label><textarea class="textarea" id="churchDescription" name="churchDescription" rows="3">${esc(churchDescription)}</textarea><p class="field-note">A identidade visual da ${esc(church.name)} usa fundo preto/chumbo com dourado e cobre.</p></div></div></form></section>
      <section class="settings-card appearance-settings" data-settings-panel="organization"><div class="settings-card-header"><div><h2>Aparência da igreja</h2><p>O pastor pode personalizar o visual desta igreja sem afetar outras organizações.</p></div><div class="icon-tile gold">${ICON('sparkle')}</div></div><div class="form-grid"><div class="form-field"><label for="appearanceTheme">Tema</label><select class="select" id="appearanceTheme" data-appearance-control><option value="light" ${appearance.theme === 'light' ? 'selected' : ''}>Claro</option><option value="dark" ${appearance.theme === 'dark' ? 'selected' : ''}>Escuro</option><option value="auto" ${appearance.theme === 'auto' ? 'selected' : ''}>Automático</option></select><p class="field-note">Aplica-se ao painel do pastor e da equipe.</p></div><div class="form-field"><label for="appearanceFont">Fonte principal</label><select class="select" id="appearanceFont" data-appearance-control><option value="editorial" ${appearance.font === 'editorial' ? 'selected' : ''}>Editorial</option><option value="modern" ${appearance.font === 'modern' ? 'selected' : ''}>Moderna</option><option value="classic" ${appearance.font === 'classic' ? 'selected' : ''}>Clássica</option><option value="clean" ${appearance.font === 'clean' ? 'selected' : ''}>Limpa</option></select><p class="field-note">Escolha uma personalidade para a sua igreja.</p></div><div class="form-field"><label for="appearancePrimary">Cor principal</label><div class="color-control"><input type="color" id="appearancePrimary" value="${esc(appearance.primary)}" data-appearance-control><input class="input color-value" value="${esc(appearance.primary.toUpperCase())}" data-color-text="appearancePrimary" maxlength="7" aria-label="Código da cor principal"></div></div><div class="form-field"><label for="appearanceAccent">Cor de destaque</label><div class="color-control"><input type="color" id="appearanceAccent" value="${esc(appearance.accent)}" data-appearance-control><input class="input color-value" value="${esc(appearance.accent.toUpperCase())}" data-color-text="appearanceAccent" maxlength="7" aria-label="Código da cor de destaque"></div></div></div><div class="palette-block"><div><label>Paletas rápidas</label><p class="field-note">Comece por uma combinação e ajuste as cores se quiser.</p></div><div class="palette-list">${Object.entries(PALETTES).map(([key, palette]) => `<button type="button" class="palette-swatch" data-action="apply-palette" data-palette="${key}" title="${esc(palette.label)}"><span style="background:${palette.primary}"></span><i style="background:${palette.accent}"></i><small>${esc(palette.label)}</small></button>`).join('')}</div></div><div class="appearance-preview"><div class="preview-copy"><span class="eyebrow">PRÉVIA</span><strong>Assim a ${esc(church.name)} aparece para sua equipe</strong><p>As mudanças são aplicadas imediatamente e ficam salvas nesta igreja.</p></div><div class="preview-chip">${ICON('check')} Personalizado</div></div></section>
      ${profileCard}
      ${backupCard}
      <section class="settings-card public-settings-card" data-settings-panel="public"><div class="settings-card-header"><div><h2>Página pública da igreja</h2><p>Edite o conteúdo que qualquer pessoa pode ver, sem login.</p></div><div class="icon-tile gold">${ICON('external')}</div></div><form data-form="organization" data-public-settings-form><div class="scope-note" style="margin:0 0 18px;"><span>${ICON('shield')}</span><p><strong>Link público:</strong> ${esc(`${window.location.origin}${(window.location.pathname || '/').replace(/[^/]*$/, '')}publica.html?igreja=${encodeURIComponent(church.slug || slugify(church.name))}`)}<br>O pastor pode deixar a página invisível enquanto prepara as informações.</p></div><div class="toggle-row"><div class="toggle-copy"><strong>Publicar página da igreja</strong><span>Quando desligada, visitantes receberão uma mensagem de indisponibilidade.</span></div><input type="checkbox" name="publicVisible" ${publicSettings.visible !== false ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--gold);" aria-label="Publicar página pública"></div><div class="form-grid"><div class="form-field full"><label for="publicHeadline">Chamada principal</label><input class="input" id="publicHeadline" name="publicHeadline" value="${esc(publicSettings.headline)}" placeholder="Ex.: Um lugar para pertencer"></div><div class="form-field full"><label for="publicAddress">Endereço ou referência</label><input class="input" id="publicAddress" name="publicAddress" value="${esc(publicSettings.address)}" placeholder="Rua, número, bairro e cidade"></div><div class="form-field"><label for="publicHours">Horários</label><input class="input" id="publicHours" name="publicHours" value="${esc(publicSettings.hours)}" placeholder="Domingos às 19h"></div><div class="form-field"><label for="publicCta">Botão de chamada</label><input class="input" id="publicCta" name="publicCta" value="${esc(publicSettings.cta)}" placeholder="Venha nos visitar"></div><div class="form-field"><label for="publicInstagram">Instagram</label><input class="input" id="publicInstagram" name="publicInstagram" value="${esc(publicSettings.instagram)}" placeholder="https://instagram.com/..."></div><div class="form-field"><label for="publicFacebook">Facebook</label><input class="input" id="publicFacebook" name="publicFacebook" value="${esc(publicSettings.facebook)}" placeholder="https://facebook.com/..."></div><div class="form-field"><label for="publicYoutube">YouTube</label><input class="input" id="publicYoutube" name="publicYoutube" value="${esc(publicSettings.youtube)}" placeholder="https://youtube.com/..."></div></div><p class="field-note">Clique em “Salvar alterações” no alto da página depois de editar os campos.</p></form></section>
      <section class="settings-card" data-settings-panel="notifications"><div class="settings-card-header"><div><h2>Preferências de notificação</h2><p>Escolha como a equipe recebe as informações importantes.</p></div><div class="icon-tile copper">${ICON('bell')}</div></div><div class="toggle-row"><div class="toggle-copy"><strong>Novo visitante para o pastor</strong><span>Enviar um alerta quando a recepção finalizar um cadastro.</span></div><button class="toggle on" data-toggle="pastorAlert" aria-label="Alternar alerta ao pastor"></button></div><div class="toggle-row"><div class="toggle-copy"><strong>Resumo diário da igreja</strong><span>Receba um resumo com visitantes, avisos e eventos do dia.</span></div><button class="toggle on" data-toggle="dailySummary" aria-label="Alternar resumo diário"></button></div><div class="toggle-row"><div class="toggle-copy"><strong>Confirmação de leitura</strong><span>Registrar quando uma pessoa visualizar um aviso.</span></div><button class="toggle on" data-toggle="readReceipt" aria-label="Alternar confirmação de leitura"></button></div></section>
      <section class="settings-card team-settings-card" data-settings-panel="team"><div class="settings-card-header"><div><h2>Equipe e acesso</h2><p>Convide obreiros e membros para ajudar na portaria com segurança.</p></div><div class="icon-tile copper">${ICON('users')}</div></div><div class="reception-link-card"><div class="reception-link-copy"><span class="scope-label">LINK DA RECEPÇÃO</span><strong>${esc(receptionLink(church))}</strong><p>Depois de abrir o link, o obreiro entra com seu login e senha. Cada acesso é individual e protegido.</p></div><button class="btn btn-primary" data-action="copy-reception-link">${ICON('external')} Copiar link</button></div><div class="team-list-header"><div><h3>Acessos da recepção</h3><p>Todos os acessos cadastrados recebem a aba Acolhimento e podem cadastrar visitantes.</p></div><button class="btn btn-gold" data-action="new-reception">${ICON('plus')} Adicionar acesso</button></div><div class="team-list">${renderReceptionUsers()}</div></section>
      ${organizationManagement}
    </div></div>
  `;
}

function openModal(type, data = {}) {
  const backdrop = $('#modalBackdrop');
  const title = $('#modalTitle');
  const eyebrow = $('#modalEyebrow');
  const body = $('#modalBody');
  if (!backdrop || !title || !body) return;
  let content = '';
  let modalTitle = '';
  let modalEyebrow = 'BETHESDA';
  if (type === 'metric') {
    const metric = data.metric;
    if (metric === 'visits') {
      modalTitle = 'Visitantes este mês';
      modalEyebrow = 'DETALHES DO RELACIONAMENTO';
      content = `<div class="metric-modal-hero"><div class="metric-modal-number">${esc(state.metrics.visits)}</div><div><strong>pessoas cadastradas</strong><span>${state.metrics.visits ? `${ICON('arrow-up-right')} 18,4% em relação ao mês anterior` : '—'}</span></div></div><div class="metric-breakdown"><div><span>Novos</span><strong>${visitorCountByStatus('Novo')}</strong></div><div><span>Contatados</span><strong>${visitorCountByStatus('Contatado')}</strong></div><div><span>Grupos/famílias</span><strong>${state.visitors.filter(visitor => getFamilyMembers(visitor).length > 1).length}</strong></div></div><h3 class="metric-section-title">Cadastros recentes</h3><div class="metric-list">${state.visitors.slice(0, 4).map(visitor => `<div class="metric-list-row"><div class="avatar avatar-copper">${esc(initials(visitor.name))}</div><div class="metric-list-copy"><strong>${esc(visitor.familyName || visitor.name)}</strong><span>${esc(formatDateShort(visitor.date))} · ${esc(visitor.service)}</span>${getFamilyMembers(visitor).length > 1 ? `<small>${getFamilyMembers(visitor).map(esc).join(', ')}</small>` : ''}</div>${arrivalPill(visitor.arrivalType || 'Sozinho')}</div>`).join('')}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-view="visitors">Ver visitantes ${ICON('arrow-up-right')}</button></div>`;
    } else if (metric === 'returns') {
      modalTitle = 'Retornos confirmados';
      modalEyebrow = 'ACOMPANHAMENTO';
      const returnedVisitors = state.visitors.filter(visitor => ['Retornou', 'Integrado'].includes(visitor.status));
      content = `<div class="metric-modal-hero metric-hero-green"><div class="metric-modal-number">${esc(state.metrics.returns)}</div><div><strong>retornos confirmados</strong><span>${state.metrics.returns ? `${ICON('arrow-up-right')} 6,2% em relação ao mês anterior` : '—'}</span></div></div><div class="metric-breakdown"><div><span>Retornaram</span><strong>${visitorCountByStatus('Retornou')}</strong></div><div><span>Integrados</span><strong>${visitorCountByStatus('Integrado')}</strong></div><div><span>Taxa de retorno</span><strong>${state.metrics.visits ? '47,4%' : '0%'}</strong></div></div><h3 class="metric-section-title">Pessoas em acompanhamento</h3><div class="metric-list">${(returnedVisitors.length ? returnedVisitors : state.visitors).slice(0, 4).map(visitor => `<div class="metric-list-row"><div class="avatar avatar-olive">${esc(initials(visitor.name))}</div><div class="metric-list-copy"><strong>${esc(visitor.name)}</strong><span>${esc(visitor.responsible)} · ${esc(formatDateShort(visitor.date))}</span></div><span class="status-pill ${statusClass(visitor.status)}">${esc(visitor.status)}</span></div>`).join('')}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-view="visitors">Abrir acompanhamento ${ICON('arrow-up-right')}</button></div>`;
    } else if (metric === 'reach') {
      modalTitle = 'Alcance da comunidade';
      modalEyebrow = 'COMUNICAÇÃO';
      content = `<div class="metric-modal-hero metric-hero-copper"><div class="metric-modal-number">${esc(state.metrics.reach)}</div><div><strong>pessoas alcançadas</strong><span>${state.metrics.reach ? `${ICON('arrow-up-right')} 12,8% neste mês` : '—'}</span></div></div><h3 class="metric-section-title">Alcance por canal</h3><div class="channel-metric"><div><span>${ICON('smartphone')} Notificações push</span><strong>${state.metrics.reach ? '92%' : '0%'}</strong></div><div class="metric-progress"><i style="width:${state.metrics.reach ? 92 : 0}%"></i></div></div><div class="channel-metric"><div><span>${ICON('whatsapp')} WhatsApp</span><strong>${state.metrics.reach ? '78%' : '0%'}</strong></div><div class="metric-progress"><i style="width:${state.metrics.reach ? 78 : 0}%"></i></div></div><div class="channel-metric"><div><span>${ICON('mail')} E-mail</span><strong>${state.metrics.reach ? '54%' : '0%'}</strong></div><div class="metric-progress"><i style="width:${state.metrics.reach ? 54 : 0}%"></i></div></div></div><div class="metric-tip">${ICON('sparkle')} A combinação de canais ajuda a manter a comunidade informada.</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-view="communication">Ver comunicação ${ICON('arrow-up-right')}</button></div>`;
    } else {
      const nextEvent = upcomingEvents()[0];
      modalTitle = 'Próximo culto';
      modalEyebrow = 'AGENDA DA IGREJA';
      content = `<div class="metric-modal-hero metric-hero-dark"><div class="metric-modal-number">${nextEvent ? String(dateDay(nextEvent.date)).padStart(2, '0') : '—'}</div><div><strong>${nextEvent ? esc(nextEvent.title) : 'Nenhum evento'}</strong><span>${nextEvent ? `${esc(formatDateLong(nextEvent.date))} · ${esc(nextEvent.time)}` : 'Adicione um novo evento à agenda'}</span></div></div>${nextEvent ? `<div class="metric-event-detail"><div>${ICON('clock')}<span>${esc(nextEvent.time)}</span></div><div>${ICON('map-pin')}<span>${esc(nextEvent.location)}</span></div><div>${ICON('users')}<span>${esc(nextEvent.audience)}</span></div></div>` : ''}<div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-view="agenda">Abrir agenda ${ICON('arrow-up-right')}</button></div>`;
    }
  } else if (type === 'visitor') {
    modalTitle = 'Novo visitante';
    modalEyebrow = 'RECEPÇÃO';
    content = `<form data-form="visitor"><div class="form-grid"><div class="form-field full"><label for="visitorName">Nome completo do visitante principal *</label><input class="input" id="visitorName" name="name" required placeholder="Ex.: João da Silva"></div><div class="form-field"><label for="visitorPhone">Telefone / WhatsApp</label><input class="input" id="visitorPhone" name="phone" placeholder="(21) 99999-9999"></div><div class="form-field"><label for="visitorDate">Data da visita *</label><input class="input" id="visitorDate" name="date" type="date" value="${TODAY}" required></div><div class="form-field"><label for="visitorService">Culto ou evento</label><select class="select" id="visitorService" name="service"><option>Culto de Celebração</option><option>Culto da Família</option><option>Culto de Ensino</option><option>Santa Ceia</option><option>Outro evento</option></select></div><div class="form-field"><label for="visitorArrivalType">Como veio? *</label><select class="select" id="visitorArrivalType" name="arrivalType" required><option>Sozinho</option><option>Com amigos</option><option>Em casal</option><option>Família</option></select></div><div class="form-field"><label for="visitorNeighborhood">Bairro ou cidade</label><input class="input" id="visitorNeighborhood" name="neighborhood" placeholder="Ex.: Centro, Itaboraí"></div><div class="form-field"><label for="visitorFamilyName">Nome do grupo / família</label><input class="input" id="visitorFamilyName" name="familyName" placeholder="Ex.: Família Nogueira"></div><div class="form-field"><label for="visitorInvitedBy">Quem convidou?</label><input class="input" id="visitorInvitedBy" name="invitedBy" placeholder="Nome ou equipe"></div><div class="form-field full"><label for="visitorNotes">Observações</label><textarea class="textarea" id="visitorNotes" name="notes" placeholder="Algum detalhe importante para o cuidado?" rows="3"></textarea></div><div class="form-field full"><label class="family-toggle"><input type="checkbox" id="registerFamily" name="registerFamily" data-family-toggle><span><strong>Cadastrar pessoas que vieram juntas</strong><small>Assim todos os nomes ficam visíveis para os pastores anunciarem à igreja.</small></span></label></div><div class="form-field full family-fields is-hidden" id="familyFields"><div class="family-register-head"><div><label>Nomes para anunciar</label><p class="field-note">O visitante principal já será incluído automaticamente. Adicione um nome completo por linha.</p></div><button type="button" class="btn btn-secondary btn-small" data-action="add-family-member">${ICON('plus')} Adicionar pessoa</button></div><div id="familyMemberList">${familyMemberRow('', 1)}</div></div></div><label class="checkbox-line"><input type="checkbox" name="consent" required checked><span>O visitante autorizou o contato da igreja para acompanhamento e informações sobre a comunidade.</span></label><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Salvar visitante</button></div></form>`;
  } else if (type === 'announcement') {
    const announcementVisitors = Array.isArray(data.visitors) ? data.visitors : [];
    const hasVisitorAnnouncement = announcementVisitors.length > 0;
    const announcementDefaults = hasVisitorAnnouncement ? buildVisitorAnnouncement(announcementVisitors) : { title: '', body: '' };
    const announcementPreview = hasVisitorAnnouncement ? `<div class="announcement-preview-card"><div class="announcement-preview-head">${ICON('users')} Prévia por grupo</div>${renderVisitorAnnouncementGroups(announcementVisitors)}</div>` : '';
    modalTitle = hasVisitorAnnouncement ? 'Anunciar visitantes' : 'Novo aviso';
    modalEyebrow = hasVisitorAnnouncement ? 'ACOLHIMENTO' : 'COMUNICAÇÃO';
    content = `<form data-form="announcement"><div class="form-grid"><div class="form-field full"><label for="announcementTitle">Título do aviso *</label><input class="input" id="announcementTitle" name="title" value="${esc(announcementDefaults.title)}" required placeholder="Ex.: Culto de domingo"></div>${announcementPreview}<div class="form-field full"><label for="announcementBody">Mensagem *</label><textarea class="textarea" id="announcementBody" name="body" required placeholder="Escreva uma mensagem clara e acolhedora..." rows="4">${esc(announcementDefaults.body)}</textarea></div><div class="form-field"><label for="announcementAudience">Destinatários</label><select class="select" id="announcementAudience" name="audience"><option>Toda a igreja</option><option>Obreiros</option><option>Lideranças</option><option>Ministério de Mulheres</option><option>Jovens</option><option>Visitantes</option><option>Recepção</option></select></div><div class="form-field"><label for="announcementMode">Quando registrar</label><select class="select" id="announcementMode" name="mode"><option value="now">Registrar agora</option><option value="scheduled">Agendar registro</option></select></div><div class="form-field full"><label>Canais de envio</label><div class="radio-grid"><div class="radio-card"><input type="checkbox" id="channelPush" name="channels" value="Push" checked><label for="channelPush">${ICON('smartphone')} Push</label></div><div class="radio-card"><input type="checkbox" id="channelWhatsapp" name="channels" value="WhatsApp" checked><label for="channelWhatsapp">${ICON('whatsapp')} WhatsApp</label></div><div class="radio-card"><input type="checkbox" id="channelEmail" name="channels" value="E-mail"><label for="channelEmail">${ICON('mail')} E-mail</label></div></div></div></div><label class="checkbox-line" style="margin-top:16px;"><input type="checkbox" name="personalizeGreeting" checked><span><strong>Personalizar saudação</strong><small>Quando o canal estiver conectado, o nome e a forma de tratamento de cada destinatário serão usados sem tentar adivinhar pelo nome.</small></span></label><div class="checkbox-line" style="margin-top:12px;"><span style="color:var(--copper);">${ICON('shield')}</span><span>Nesta fase, o aviso é salvo no banco e respeita as permissões da igreja; nenhum canal externo é acionado.</span></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Salvar aviso</button></div></form>`;
  } else if (type === 'event-edit') {
    const eventRecord = (state.events || []).find(item => item.id === data.id);
    if (!eventRecord) return;
    const recurrenceRule = eventRecord.recurrenceRule || {};
    const recurrenceTypes = ['none', 'weekly-month', 'weekly-year', 'monthly-date', 'monthly-weekday', 'yearly-date', 'yearly-weekday'];
    const eventRecurrenceType = recurrenceTypes.includes(recurrenceRule.type) ? recurrenceRule.type : 'none';
    const weekdayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const eventWeekday = Number.isInteger(Number(recurrenceRule.weekday)) ? Number(recurrenceRule.weekday) : parseDate(eventRecord.date).getDay();
    const eventOrdinal = Math.min(5, Math.max(1, Number(recurrenceRule.ordinal || 1)));
    const eventRecurrenceOptions = [['none', 'Não repetir — evento único'], ['weekly-month', 'Semanal pelo dia da semana — até o fim deste mês'], ['weekly-year', 'Semanal pelo dia da semana — até 31 de dezembro'], ['monthly-date', 'Mensal pela data — todo dia do mês'], ['monthly-weekday', 'Mensal pelo dia da semana — toda 2ª terça, 1º domingo...'], ['yearly-date', 'Anual pela data — mesmo dia e mês'], ['yearly-weekday', 'Anual pelo dia da semana — mesma posição']].map(([value, label]) => `<option value="${value}" ${eventRecurrenceType === value ? 'selected' : ''}>${label}</option>`).join('');
    const recurrenceText = eventRecord.recurrenceId ? 'Este evento faz parte de uma série recorrente. Por padrão, a alteração vale somente para esta ocorrência.' : 'Evento único, sem série recorrente.';
    modalTitle = 'Editar evento';
    modalEyebrow = 'AGENDA · EDIÇÃO';
    content = `<form data-form="event-edit" data-id="${esc(eventRecord.id)}"><div class="event-edit-summary"><div class="event-edit-summary-icon">${ICON('calendar')}</div><div><strong>${esc(eventRecord.title)}</strong><span>${esc(formatDateLong(eventRecord.date))} · ${esc(eventRecord.time)}</span></div><span class="status-pill ${eventStatusClass(eventRecord.status)}">${eventStatusLabel(eventRecord.status)}</span></div><div class="form-grid"><div class="form-field full"><label for="editEventTitle">Nome do evento *</label><input class="input" id="editEventTitle" name="title" value="${esc(eventRecord.title)}" required></div><div class="form-field"><label for="editEventDate">Data *</label><input class="input" id="editEventDate" name="date" type="date" value="${esc(eventRecord.date)}" required></div><div class="form-field"><label for="editEventTime">Horário *</label><input class="input" id="editEventTime" name="time" type="time" value="${esc(eventRecord.time)}" required></div><div class="form-field"><label for="editEventType">Categoria</label><select class="select" id="editEventType" name="type"><option ${eventRecord.type === 'Culto' ? 'selected' : ''}>Culto</option><option ${eventRecord.type === 'Encontro' ? 'selected' : ''}>Encontro</option><option ${eventRecord.type === 'Festividade' ? 'selected' : ''}>Festividade</option><option ${eventRecord.type === 'Liderança' ? 'selected' : ''}>Liderança</option><option ${eventRecord.type === 'Outro' ? 'selected' : ''}>Outro</option></select></div><div class="form-field"><label for="editEventLocation">Local</label><input class="input" id="editEventLocation" name="location" value="${esc(eventRecord.location || '')}"></div><div class="form-field"><label for="editEventAudience">Público</label><select class="select" id="editEventAudience" name="audience"><option ${eventRecord.audience === 'Toda a igreja' ? 'selected' : ''}>Toda a igreja</option><option ${eventRecord.audience === 'Lideranças' ? 'selected' : ''}>Lideranças</option><option ${eventRecord.audience === 'Obreiros' ? 'selected' : ''}>Obreiros</option><option ${eventRecord.audience === 'Ministério de Mulheres' ? 'selected' : ''}>Ministério de Mulheres</option><option ${eventRecord.audience === 'Jovens' ? 'selected' : ''}>Jovens</option><option ${eventRecord.audience === 'Visitantes' ? 'selected' : ''}>Visitantes</option></select></div><div class="form-field"><label for="editEventStatus">Situação do evento</label><select class="select" id="editEventStatus" name="status"><option value="active" ${eventRecord.status === 'active' ? 'selected' : ''}>Ativo — publicado</option><option value="paused" ${eventRecord.status === 'paused' ? 'selected' : ''}>Pausado — manter para retomar depois</option><option value="blocked" ${eventRecord.status === 'blocked' ? 'selected' : ''}>Bloqueado — não deve acontecer</option></select></div></div><div class="form-grid"><div class="form-field full"><label for="editEventRecurrence">Como este evento deve se repetir?</label><select class="select" id="editEventRecurrence" name="recurrence">${eventRecurrenceOptions}</select><p class="field-note">Escolha evento único, repetição pela data, pelo dia da semana ou anual. As ocorrências são geradas até 31 de dezembro do ano atual.</p></div><div class="form-field"><label for="editEventWeekday">Dia da semana</label><select class="select" id="editEventWeekday" name="weekday">${weekdayNames.map((name, index) => `<option value="${index}" ${index === eventWeekday ? 'selected' : ''}>${name}</option>`).join('')}</select><p class="field-note">Usado nas opções pelo dia da semana.</p></div><div class="form-field"><label for="editEventOrdinal">Posição no mês</label><select class="select" id="editEventOrdinal" name="ordinal">${[1, 2, 3, 4, 5].map(value => `<option value="${value}" ${value === eventOrdinal ? 'selected' : ''}>${['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto'][value - 1]}</option>`).join('')}</select></div></div><div class="scope-note" style="margin-top:16px;"><span>${ICON('calendar')}</span><p><strong>${esc(recurrenceText)}</strong>${eventRecord.recurrenceId ? ` Marque a opção abaixo se quiser atualizar os dados gerais de todas as ocorrências desta série.` : ''}</p></div>${eventRecord.recurrenceId ? `<label class="checkbox-line event-series-option"><input type="checkbox" name="updateSeries"><span>Aplicar nome, horário, local, categoria, público e situação a todas as ocorrências desta série. Se você mudar o tipo de recorrência, a data informada será o início da nova série; mantendo o tipo, a data vale somente para esta ocorrência.</span></label>` : ''}<div class="event-quick-actions"><span>Alterar situação rapidamente:</span><button type="button" class="btn btn-secondary btn-small" data-action="set-event-status" data-id="${esc(eventRecord.id)}" data-status="paused">${ICON('clock')} Pausar</button><button type="button" class="btn btn-secondary btn-small" data-action="set-event-status" data-id="${esc(eventRecord.id)}" data-status="blocked">${ICON('shield')} Bloquear</button><button type="button" class="btn btn-gold btn-small" data-action="set-event-status" data-id="${esc(eventRecord.id)}" data-status="active">${ICON('check')} Reativar</button></div><div class="modal-actions"><button type="button" class="btn btn-danger" data-action="delete-event" data-id="${esc(eventRecord.id)}">${ICON('x')} Excluir evento</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Salvar alterações</button></div></form>`;
  } else if (type === 'event') {
    modalTitle = 'Novo evento';
    modalEyebrow = 'AGENDA';
    const weekdayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const defaultWeekday = parseDate(TODAY).getDay();
    content = `<form data-form="event"><div class="form-grid"><div class="form-field full"><label for="eventTitle">Nome do evento *</label><input class="input" id="eventTitle" name="title" required placeholder="Ex.: Culto de Celebração"></div><div class="form-field"><label for="eventDate">Data de início *</label><input class="input" id="eventDate" name="date" type="date" value="${TODAY}" required></div><div class="form-field"><label for="eventTime">Horário *</label><input class="input" id="eventTime" name="time" type="time" value="19:00" required></div><div class="form-field"><label for="eventType">Categoria</label><select class="select" id="eventType" name="type"><option>Culto</option><option>Encontro</option><option>Festividade</option><option>Liderança</option><option>Outro</option></select></div><div class="form-field"><label for="eventLocation">Local</label><input class="input" id="eventLocation" name="location" value="Templo principal"></div><div class="form-field full"><label for="eventAudience">Público</label><select class="select" id="eventAudience" name="audience"><option>Toda a igreja</option><option>Lideranças</option><option>Obreiros</option><option>Ministério de Mulheres</option><option>Jovens</option><option>Visitantes</option></select></div><div class="form-field full"><label for="eventRecurrence">Como este evento deve se repetir?</label><select class="select" id="eventRecurrence" name="recurrence"><option value="none">Não repetir — evento único</option><option value="weekly-month">Semanal pelo dia da semana — até o fim deste mês</option><option value="weekly-year">Semanal pelo dia da semana — até 31 de dezembro</option><option value="monthly-date">Mensal pela data — todo dia 15, 20, 25...</option><option value="monthly-weekday">Mensal pelo dia da semana — toda 2ª terça, 1º domingo...</option><option value="yearly-date">Anual pela data — uma vez por ano no mesmo dia e mês</option><option value="yearly-weekday">Anual pelo dia da semana — uma vez por ano na mesma posição</option></select><p class="field-note">Você pode deixar como evento único, repetir pela data do calendário ou repetir pelo dia da semana. As ocorrências são criadas até 31 de dezembro do ano atual.</p></div><div class="form-field"><label for="eventWeekday">Dia da semana</label><select class="select" id="eventWeekday" name="weekday">${weekdayNames.map((name, index) => `<option value="${index}" ${index === defaultWeekday ? 'selected' : ''}>${name}</option>`).join('')}</select><p class="field-note">Usado nas opções “pelo dia da semana”.</p></div><div class="form-field"><label for="eventOrdinal">Posição no mês</label><select class="select" id="eventOrdinal" name="ordinal"><option value="1">Primeiro</option><option value="2">Segundo</option><option value="3">Terceiro</option><option value="4">Quarto</option><option value="5">Quinto, quando existir</option></select><p class="field-note">Ex.: segundo domingo ou terceira terça.</p></div></div><div class="scope-note" style="margin-top:16px;"><span>${ICON('calendar')}</span><p><strong>Exemplo:</strong> para um culto todos os domingos, escolha “Semanal pelo dia da semana — até 31 de dezembro” e selecione “Domingo”. Para uma conferência anual, use “Anual pela data” ou “Anual pelo dia da semana”.</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('calendar')} Adicionar evento</button></div></form>`;
  } else if (type === 'church') {
    modalTitle = 'Adicionar igreja';
    modalEyebrow = 'PLATAFORMA SAAS';
    content = `<form data-form="church"><div class="form-grid"><div class="form-field full"><label for="newChurchName">Nome da igreja *</label><input class="input" id="newChurchName" name="name" required placeholder="Ex.: Igreja Esperança"></div><div class="form-field"><label for="newChurchCity">Cidade e estado</label><input class="input" id="newChurchCity" name="city" placeholder="Ex.: Niterói • RJ"></div><div class="form-field"><label for="newChurchAdmin">Responsável principal</label><input class="input" id="newChurchAdmin" name="admin" placeholder="Nome do pastor"></div><div class="form-field full"><p class="field-note">Cada igreja terá seus usuários, visitantes, avisos e configurações separados. Este é o princípio de uma plataforma SaaS multi-tenant.</p></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('building')} Criar organização</button></div></form>`;
  } else if (type === 'reception') {
    modalTitle = 'Adicionar acesso de recepção';
    modalEyebrow = 'EQUIPE DA IGREJA';
    content = `<form data-form="reception"><div class="form-grid"><div class="form-field full"><label for="receptionName">Nome do obreiro ou membro *</label><input class="input" id="receptionName" name="name" required placeholder="Ex.: Maria Oliveira"></div><div class="form-field"><label for="receptionLogin">Login de acesso *</label><input class="input" id="receptionLogin" name="login" type="email" autocomplete="username" required placeholder="nome@igreja.com.br"></div><div class="form-field"><label for="receptionRole">Função</label><select class="select" id="receptionRole" name="role"><option>Recepção</option><option>Obreiro</option><option>Membro autorizado</option></select></div><div class="form-field"><label for="receptionPhone">Telefone</label><input class="input" id="receptionPhone" name="phone" placeholder="(21) 99999-9999"></div><div class="form-field"><label for="receptionPassword">Senha de acesso *</label><input class="input" id="receptionPassword" name="password" type="password" autocomplete="new-password" minlength="6" required placeholder="Mínimo de 6 caracteres"></div><div class="form-field"><label for="receptionPasswordConfirm">Confirmar senha *</label><input class="input" id="receptionPasswordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="6" required placeholder="Repita a senha"></div><div class="form-field full"><div class="scope-note" style="margin:0;"><span>${ICON('shield')}</span><p><strong>Defina a senha neste cadastro.</strong> O obreiro usará o login e esta senha para entrar na recepção e acessar a aba <strong>Acolhimento</strong>. A senha não fica visível depois de salva.</p></div></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('users')} Salvar acesso</button></div></form>`;
  } else if (type === 'reception-detail') {
    const receptionUser = (state.receptionUsers || []).find(item => item.id === data.id);
    if (!receptionUser) return;
    modalTitle = receptionUser.name;
    modalEyebrow = 'ACESSO DA RECEPÇÃO';
    content = `<div class="person-cell" style="padding-bottom:18px;border-bottom:1px solid #f0ede7;"><div class="avatar avatar-copper" style="width:46px;height:46px;">${esc(receptionUser.initials || initials(receptionUser.name))}</div><div><strong style="font-size:14px;">${esc(receptionUser.name)}</strong><span style="font-size:10px;margin-top:5px;">${esc(receptionUser.role)} · ${esc(receptionUser.status || 'Ativo')}</span></div></div><div class="form-grid" style="margin-top:20px;"><div class="form-field"><label>Login</label><div style="font-size:11px;color:var(--ink);">${esc(receptionUser.login || 'Não informado')}</div></div><div class="form-field"><label>Status da senha</label><div><span class="status-pill ${receptionUser.passwordStatus === 'Ativa' ? 'status-integrated' : 'status-contacted'}">${esc(receptionUser.passwordStatus || 'Ativa')}</span></div></div><div class="form-field full"><label>Abas liberadas</label><div class="permission-list"><span class="access-permission">${ICON('heart')} Acolhimento</span><p class="field-note">Esta aba fica disponível para todos os acessos cadastrados na recepção.</p></div></div><div class="form-field full"><div class="scope-note" style="margin:0;"><span>${ICON('shield')}</span><p>Por segurança, a senha atual nunca fica visível para o pastor. Use “Definir nova senha” para trocar a senha do acesso.</p></div></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="edit-reception-access" data-id="${esc(receptionUser.id)}">${ICON('settings')} Editar acesso</button><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-secondary" data-action="reset-reception-password" data-id="${esc(receptionUser.id)}">${ICON('refresh')} Definir nova senha</button>${receptionUser.status === 'Bloqueado' ? `<button type="button" class="btn btn-gold" data-action="toggle-reception-access" data-id="${esc(receptionUser.id)}">${ICON('check')} Reativar acesso</button>` : `<button type="button" class="btn btn-secondary" data-action="toggle-reception-access" data-id="${esc(receptionUser.id)}">${ICON('shield')} Bloquear acesso</button>`}<button type="button" class="btn btn-danger" data-action="delete-reception-access" data-id="${esc(receptionUser.id)}">${ICON('x')} Excluir acesso</button></div>`;
  } else if (type === 'reception-edit') {
    const receptionUser = (state.receptionUsers || []).find(item => item.id === data.id);
    if (!receptionUser) return;
    modalTitle = 'Editar acesso';
    modalEyebrow = 'ACESSO DA RECEPÇÃO';
    content = `<form data-form="reception-edit" data-id="${esc(receptionUser.id)}"><div class="person-cell" style="padding-bottom:18px;border-bottom:1px solid #f0ede7;margin-bottom:18px;"><div class="avatar avatar-copper" style="width:46px;height:46px;">${esc(receptionUser.initials || initials(receptionUser.name))}</div><div><strong style="font-size:14px;">${esc(receptionUser.name)}</strong><span style="font-size:10px;margin-top:5px;">Atualize os dados do acesso sem alterar a senha.</span></div></div><div class="form-grid"><div class="form-field full"><label for="editReceptionName">Nome completo *</label><input class="input" id="editReceptionName" name="name" value="${esc(receptionUser.name)}" required></div><div class="form-field"><label for="editReceptionLogin">Login</label><input class="input" id="editReceptionLogin" name="login" value="${esc(receptionUser.login || '')}" required></div><div class="form-field"><label for="editReceptionRole">Função</label><select class="select" id="editReceptionRole" name="role"><option ${receptionUser.role === 'Recepção' ? 'selected' : ''}>Recepção</option><option ${receptionUser.role === 'Obreiro' ? 'selected' : ''}>Obreiro</option><option ${receptionUser.role === 'Membro autorizado' ? 'selected' : ''}>Membro autorizado</option></select></div><div class="form-field full"><label for="editReceptionPhone">Telefone</label><input class="input" id="editReceptionPhone" name="phone" value="${esc(receptionUser.phone || '')}" placeholder="(21) 99999-9999"></div></div><div class="scope-note" style="margin-top:16px;"><span>${ICON('shield')}</span><p>A senha permanece protegida. Para trocar a senha, use “Definir nova senha” no detalhe do acesso.</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Salvar edição</button></div></form>`;
  } else if (type === 'visitor-detail') {
    const visitor = state.visitors.find(item => item.id === data.id);
    if (!visitor) return;
    modalTitle = visitor.name;
    modalEyebrow = 'DETALHES DO VISITANTE';
    const familyMembers = getFamilyMembers(visitor);
    content = `<div class="person-cell" style="padding-bottom:18px;border-bottom:1px solid #f0ede7;"><div class="avatar avatar-copper" style="width:46px;height:46px;">${esc(initials(visitor.name))}</div><div><strong style="font-size:14px;">${esc(visitor.name)}</strong><span style="font-size:10px;margin-top:5px;">Visitou em ${esc(formatDateLong(visitor.date))}</span></div></div><div class="form-grid" style="margin-top:20px;"><div class="form-field"><label>Telefone</label><div style="font-size:11px;color:var(--ink);">${esc(visitor.phone || 'Não informado')}</div></div><div class="form-field"><label>Status</label><div><span class="status-pill ${statusClass(visitor.status)}">${esc(visitor.status)}</span></div></div><div class="form-field"><label>Como veio</label><div>${arrivalPill(visitor.arrivalType || 'Sozinho')}</div></div><div class="form-field"><label>Culto ou evento</label><div style="font-size:11px;color:var(--ink);">${esc(visitor.service)}</div></div><div class="form-field"><label>Responsável</label><div style="font-size:11px;color:var(--ink);">${esc(visitor.responsible)}</div></div><div class="form-field full"><label>${esc(visitor.familyName || 'Pessoas que vieram juntas')}</label><div class="family-detail-list">${familyMembers.map((member, index) => `<div class="family-detail-item"><span>${index + 1}</span>${esc(member)}</div>`).join('')}</div><p class="field-note" style="margin-top:7px;">Todos os nomes ficam disponíveis para o anúncio dos pastores à igreja.</p></div><div class="form-field full"><label>Observações</label><div style="padding:11px;border-radius:9px;background:var(--paper);color:var(--muted);font-size:10px;line-height:1.5;">${esc(visitor.notes || 'Sem observações registradas.')}</div></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-secondary" data-action="new-care-task" data-visitor-id="${esc(visitor.id)}">${ICON('heart')} Criar cuidado</button><button type="button" class="btn btn-primary" data-action="announce-visitor" data-id="${esc(visitor.id)}">${ICON('megaphone')} Preparar anúncio</button>${visitor.status === 'Novo' ? `<button type="button" class="btn btn-gold" data-action="mark-contacted" data-id="${esc(visitor.id)}">${ICON('check')} Marcar como contatado</button>` : `<button type="button" class="btn btn-primary" data-action="visitor-message" data-id="${esc(visitor.id)}">${ICON('send')} Registrar contato</button>`}</div>`;
  } else if (type === 'notifications') {
    const notifications = (state.activity || []).slice(0, 6);
    modalTitle = 'Atividade registrada';
    modalEyebrow = 'HISTÓRICO DA IGREJA';
    content = `<div style="display:flex;flex-direction:column;gap:10px;">${notifications.length ? notifications.map(item => `<div class="announcement-card" style="padding:13px;"><div class="announcement-icon ${item.tone === 'copper' ? 'copper' : ''}">${ICON(item.type === 'visitor' ? 'users' : item.type === 'announcement' ? 'megaphone' : 'check-circle')}</div><div class="announcement-body"><h3>${esc(item.name)}</h3><p>${esc(item.text)}</p><div class="announcement-meta"><span class="announcement-date">${esc(item.time || '')}</span></div></div></div>`).join('') : '<div class="empty-state"><h3>Nenhuma atividade registrada</h3><p>As próximas alterações persistentes aparecerão aqui.</p></div>'}</div><div class="scope-note" style="margin-top:16px;"><span>${ICON('shield')}</span><p>Este histórico é carregado do banco da igreja e respeita o isolamento por igreja.</p></div><div class="modal-actions"><button type="button" class="btn btn-gold" data-action="close-modal">Fechar</button></div>`;
  } else if (type === 'search') {
    modalTitle = `Buscar na ${getActiveChurch()?.name || 'igreja'}`;
    modalEyebrow = 'BUSCA RÁPIDA';
    content = `<div class="input-wrap" style="width:100%;">${ICON('search')}<input class="input" id="globalSearch" style="width:100%;padding-left:36px;" autofocus placeholder="Visitante, aviso, evento ou líder"></div><div id="globalSearchResults" style="margin-top:15px;"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button></div>`;
  } else if (type === 'channels') {
    const channelSettings = { push: false, whatsapp: false, email: false, ...(getActiveChurch()?.publicSettings?.communicationChannels || {}) };
    modalTitle = 'Canais de envio';
    modalEyebrow = 'COMUNICAÇÃO';
    content = `<div class="toggle-row"><div class="toggle-copy"><strong>Notificações push</strong><span>Preferência registrada para uma futura integração. Não envia nesta fase.</span></div><button class="toggle ${channelSettings.push ? 'on' : ''}" data-toggle="push" aria-label="Alternar notificações push"></button></div><div class="toggle-row"><div class="toggle-copy"><strong>WhatsApp oficial</strong><span>Preferência registrada para uma futura integração. Não envia nesta fase.</span></div><button class="toggle ${channelSettings.whatsapp ? 'on' : ''}" data-toggle="whatsapp" aria-label="Alternar WhatsApp"></button></div><div class="toggle-row"><div class="toggle-copy"><strong>E-mail</strong><span>Preferência registrada para uma futura integração. Não envia nesta fase.</span></div><button class="toggle ${channelSettings.email ? 'on' : ''}" data-toggle="email" aria-label="Alternar e-mail"></button></div><div class="scope-note" style="margin-top:16px;"><span>${ICON('shield')}</span><p>Ativar uma preferência aqui não cria cobrança nem dispara mensagem. O envio só será habilitado depois de uma configuração explícita.</p></div><div class="modal-actions"><button type="button" class="btn btn-gold" data-action="close-modal">Concluir</button></div>`;
  } else if (type === 'leader') {
    modalTitle = 'Adicionar liderança';
    modalEyebrow = 'EQUIPE';
    content = `<form data-form="leader"><div class="form-grid"><div class="form-field full"><label for="leaderName">Nome completo *</label><input class="input" id="leaderName" name="name" required placeholder="Ex.: Maria Oliveira"></div><div class="form-field"><label for="leaderPreferredName">Como prefere ser chamada?</label><input class="input" id="leaderPreferredName" name="preferredName" placeholder="Nome de preferência"></div><div class="form-field"><label for="leaderGender">Forma de tratamento</label><select class="select" id="leaderGender" name="gender"><option value="unspecified">Não informar</option><option value="female">Feminino</option><option value="male">Masculino</option></select></div><div class="form-field"><label for="leaderRole">Função</label><input class="input" id="leaderRole" name="role" placeholder="Ex.: Líder de jovens"></div><div class="form-field"><label for="leaderPhone">Telefone</label><input class="input" id="leaderPhone" name="phone" placeholder="(21) 99999-9999"></div><div class="form-field full"><label for="leaderGroup">Ministério / grupo</label><input class="input" id="leaderGroup" name="group" placeholder="Ex.: Jovens"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('users')} Adicionar líder</button></div></form>`;
  } else if (type === 'leader-detail') {
    const leader = (state.leaders || []).find(item => item.id === data.id);
    if (!leader) return;
    modalTitle = leader.name;
    modalEyebrow = 'EDITAR LIDERANÇA';
    content = `<form data-form="leader-edit" data-id="${esc(leader.id)}"><div class="person-cell" style="padding-bottom:18px;border-bottom:1px solid #f0ede7;margin-bottom:18px;"><div class="avatar ${iconTone(leader.tone)}" style="width:46px;height:46px;">${esc(leader.initials || initials(leader.name))}</div><div><strong style="font-size:14px;">${esc(leader.name)}</strong><span style="font-size:10px;margin-top:5px;">${esc(leader.group || 'Equipe')}</span></div></div><div class="form-grid"><div class="form-field full"><label for="editLeaderName">Nome completo *</label><input class="input" id="editLeaderName" name="name" value="${esc(leader.name)}" required></div><div class="form-field"><label for="editLeaderPreferredName">Como prefere ser chamada?</label><input class="input" id="editLeaderPreferredName" name="preferredName" value="${esc(leader.preferredName || '')}" placeholder="Nome de preferência"></div><div class="form-field"><label for="editLeaderGender">Forma de tratamento</label><select class="select" id="editLeaderGender" name="gender"><option value="unspecified" ${normalizedGender(leader) === 'unspecified' ? 'selected' : ''}>Não informar</option><option value="female" ${normalizedGender(leader) === 'female' ? 'selected' : ''}>Feminino</option><option value="male" ${normalizedGender(leader) === 'male' ? 'selected' : ''}>Masculino</option></select></div><div class="form-field"><label for="editLeaderRole">Cargo ou função</label><input class="input" id="editLeaderRole" name="role" value="${esc(leader.role)}" placeholder="Ex.: Líder de jovens"></div><div class="form-field"><label for="editLeaderPhone">Telefone</label><input class="input" id="editLeaderPhone" name="phone" value="${esc(leader.phone || '')}" placeholder="(21) 99999-9999"></div><div class="form-field full"><label for="editLeaderGroup">Ministério / grupo</label><input class="input" id="editLeaderGroup" name="group" value="${esc(leader.group || '')}" placeholder="Ex.: Jovens"></div></div><div class="modal-actions"><button type="button" class="btn btn-danger" data-action="delete-leader" data-id="${esc(leader.id)}">${ICON('x')} Excluir</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Salvar alterações</button></div></form>`;
  } else if (type === 'member') {
    modalTitle = 'Novo membro';
    modalEyebrow = 'COMUNIDADE';
    content = `<form data-form="member"><div class="form-grid"><div class="form-field full"><label for="memberName">Nome completo *</label><input class="input" id="memberName" name="name" required placeholder="Ex.: Ana Oliveira"></div><div class="form-field"><label for="memberPreferredName">Como prefere ser chamada?</label><input class="input" id="memberPreferredName" name="preferredName" placeholder="Nome de preferência"></div><div class="form-field"><label for="memberGender">Forma de tratamento</label><select class="select" id="memberGender" name="gender"><option value="unspecified">Não informar</option><option value="female">Feminino</option><option value="male">Masculino</option></select></div><div class="form-field"><label for="memberPhone">Telefone</label><input class="input" id="memberPhone" name="phone" placeholder="(21) 99999-9999"></div><div class="form-field"><label for="memberEmail">E-mail</label><input class="input" id="memberEmail" name="email" type="email" placeholder="nome@email.com"></div><div class="form-field"><label for="memberMinistry">Ministério</label><input class="input" id="memberMinistry" name="ministry" list="memberMinistryOptions" autocomplete="off" placeholder="Ex.: Louvor"><datalist id="memberMinistryOptions">${(state.ministries || []).map(ministry => `<option value="${esc(ministry.name || ministry)}"></option>`).join('')}</datalist><p class="field-note">Escolha um ministério já cadastrado ou digite um novo. Antes de salvar, pediremos confirmação para cadastrar o novo ministério.</p></div><div class="form-field"><label for="memberJoinedAt">Data de integração</label><input class="input" id="memberJoinedAt" name="joinedAt" type="date" value="${TODAY}"></div><div class="form-field full"><label class="check-row"><input type="checkbox" name="communicationConsent"><span><strong>Autoriza comunicações da igreja</strong><small>Use somente para avisos e contatos pastorais autorizados.</small></span></label><label class="check-row" style="margin-top:10px;"><input type="checkbox" name="locationConsent"><span><strong>Autoriza recurso futuro de presença por localização</strong><small>Esta autorização não ativa rastreamento automático enquanto a Emaús não tiver o recurso móvel correspondente.</small></span></label></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('users')} Salvar membro</button></div></form>`;
  } else if (type === 'member-detail') {
    const member = (state.members || []).find(item => item.id === data.id);
    if (!member) return;
    modalTitle = member.name;
    modalEyebrow = 'MEMBRO';
    content = `<div class="person-cell" style="padding-bottom:18px;border-bottom:1px solid #f0ede7;"><div class="avatar avatar-olive" style="width:46px;height:46px;">${esc(initials(member.name))}</div><div><strong style="font-size:14px;">${esc(preferredDisplayName(member))}</strong><span style="font-size:10px;margin-top:5px;">${esc(member.ministry || 'Membro')}</span></div></div><div class="form-grid" style="margin-top:20px;"><div class="form-field"><label>Telefone</label><div>${esc(member.phone || 'Não informado')}</div></div><div class="form-field"><label>E-mail</label><div>${esc(member.email || 'Não informado')}</div></div><div class="form-field"><label>Status</label><div><span class="status-pill ${member.status === 'inactive' ? 'status-contacted' : 'status-integrated'}">${member.status === 'inactive' ? 'Inativo' : 'Ativo'}</span></div></div><div class="form-field"><label>Integração</label><div>${esc(member.joinedAt || 'Não informado')}</div></div><div class="form-field"><label>Última presença</label><div>${esc(member.lastAttendedAt ? formatDateShort(String(member.lastAttendedAt).slice(0, 10)) : 'Ainda não registrada')}</div></div><div class="form-field"><label>Autorizações</label><div><span class="status-pill ${member.communicationConsent ? 'status-integrated' : 'status-contacted'}">${member.communicationConsent ? 'Comunicação autorizada' : 'Sem comunicação'}</span><span class="status-pill ${member.locationConsent ? 'status-integrated' : 'status-contacted'}" style="margin-left:5px;">${member.locationConsent ? 'Localização autorizada' : 'Localização não autorizada'}</span></div></div></div><div class="scope-note" style="margin-top:18px;"><span>${ICON('heart')}</span><p>Presença e autorização servem para cuidado pastoral. Não são ranking, pontuação ou forma de pressionar ninguém.</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="new-care-task" data-member-id="${esc(member.id)}">${ICON('heart')} Criar cuidado</button><button type="button" class="btn btn-gold" data-action="register-attendance" data-member-id="${esc(member.id)}">${ICON('check')} Registrar presença</button><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button></div>`;
  } else if (type === 'care-task') {
    modalTitle = 'Novo cuidado';
    modalEyebrow = 'ACOMPANHAMENTO PASTORAL';
    const selectedMember = (state.members || []).find(member => member.id === data.memberId);
    const selectedVisitor = (state.visitors || []).find(visitor => visitor.id === data.visitorId);
    const personPicker = data.memberId || data.visitorId ? '' : `<div class="form-field full"><label for="careTaskPerson">Vincular este cuidado a *</label><select class="select" id="careTaskPerson" name="personRef" required><option value="">Selecione uma pessoa</option><optgroup label="Membros">${(state.members || []).filter(member => member.status !== 'inactive').map(member => `<option value="member:${esc(member.id)}">${esc(preferredDisplayName(member))}</option>`).join('')}</optgroup><optgroup label="Visitantes">${(state.visitors || []).slice(0, 200).map(visitor => `<option value="visitor:${esc(visitor.id)}">${esc(visitor.name)}</option>`).join('')}</optgroup></select></div>`;
    content = `<form data-form="care-task"><input type="hidden" name="memberId" value="${esc(data.memberId || '')}"><input type="hidden" name="visitorId" value="${esc(data.visitorId || '')}"><div class="scope-note" style="margin:0 0 18px;"><span>${ICON('heart')}</span><p>Registre um próximo passo de cuidado, sem transformar a pessoa em uma meta. A tarefa fica visível somente para a equipe autorizada da igreja.</p></div>${personPicker}<div class="form-field full"><label>Pessoa</label><div class="selected-person-note">${esc(selectedMember?.name || selectedVisitor?.name || 'Pessoa selecionada')}</div></div><div class="form-field full"><label for="careTaskTitle">O que precisa ser feito? *</label><input class="input" id="careTaskTitle" name="title" required placeholder="Ex.: Fazer primeiro contato"></div><div class="form-grid"><div class="form-field"><label for="careTaskType">Tipo de cuidado</label><select class="select" id="careTaskType" name="taskType"><option value="follow_up">Primeiro contato</option><option value="prayer">Pedido de oração</option><option value="visit">Visita ou conversa</option><option value="integration">Integração na igreja</option><option value="other">Outro</option></select></div><div class="form-field"><label for="careTaskPriority">Prioridade</label><select class="select" id="careTaskPriority" name="priority"><option value="normal">Normal</option><option value="high">Alta</option><option value="low">Baixa</option></select></div><div class="form-field"><label for="careTaskDueDate">Prazo</label><input class="input" id="careTaskDueDate" name="dueDate" type="date" value="${TODAY}"></div><div class="form-field full"><label for="careTaskDescription">Observação interna</label><textarea class="textarea" id="careTaskDescription" name="description" rows="3" placeholder="Escreva somente o necessário para o cuidado."></textarea></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('heart')} Salvar cuidado</button></div></form>`;
  } else if (type === 'care-task-detail') {
    const task = (state.careTasks || []).find(item => item.id === data.id);
    if (!task) return;
    modalTitle = task.title;
    modalEyebrow = 'ACOMPANHAMENTO PASTORAL';
    content = `<div class="scope-note" style="margin:0 0 18px;"><span>${ICON('heart')}</span><p><strong>${esc(task.memberName || task.visitorName || 'Pessoa vinculada')}</strong><br>${esc(task.description || 'Sem observação interna.')}</p></div><div class="form-grid"><div class="form-field"><label>Tipo</label><div>${esc(task.taskType)}</div></div><div class="form-field"><label>Prioridade</label><div>${esc(task.priority)}</div></div><div class="form-field"><label>Prazo</label><div>${esc(task.dueDate ? formatDateShort(task.dueDate) : 'Sem prazo')}</div></div><div class="form-field"><label>Status</label><div><span class="status-pill ${task.status === 'done' ? 'status-integrated' : 'status-new'}">${esc(task.status)}</span></div></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button>${task.status !== 'done' ? `<button type="button" class="btn btn-gold" data-action="complete-care-task" data-id="${esc(task.id)}">${ICON('check')} Marcar como concluído</button>` : ''}</div>`;
  } else if (type === 'attendance') {
    const selectedMember = (state.members || []).find(member => member.id === data.memberId);
    modalTitle = 'Registrar presença';
    modalEyebrow = 'PRESENÇA INTERNA';
    content = `<form data-form="attendance"><input type="hidden" name="memberId" value="${esc(data.memberId || '')}"><div class="scope-note" style="margin:0 0 18px;"><span>${ICON('check-circle')}</span><p>Este registro fica vinculado à <strong>${esc(getActiveChurch()?.name || 'igreja')}</strong> e ao membro selecionado. Ele serve para cuidado pastoral e não cria ranking.</p></div><div class="form-field full"><label>Membro</label><div class="selected-person-note">${esc(selectedMember?.name || 'Membro selecionado')}</div></div><div class="form-field full"><label for="attendanceNotes">Observação opcional</label><textarea class="textarea" id="attendanceNotes" name="notes" rows="3" placeholder="Ex.: presença no culto de celebração"></textarea></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Confirmar presença</button></div></form>`;
  } else if (type === 'attendance-report') {
    modalTitle = 'Registros de presença';
    modalEyebrow = 'CUIDADO DA IGREJA';
    const attendance = (state.attendance || []).slice(0, 30);
    content = `<div class="scope-note" style="margin:0 0 18px;"><span>${ICON('shield')}</span><p>Os registros são internos, vinculados somente à ${esc(getActiveChurch()?.name || 'igreja')} e não exibem localização exata.</p></div><div class="attendance-list">${attendance.length ? attendance.map(item => `<div class="attendance-row"><div class="avatar avatar-olive">${esc(initials(item.memberName))}</div><div><strong>${esc(item.memberName)}</strong><small>${esc(formatDateShort(String(item.checkedInAt).slice(0, 10)))} · ${esc(item.source === 'manual' ? 'Recepção' : item.source)}</small></div><span class="status-pill ${item.geoVerified ? 'status-integrated' : 'status-contacted'}">${item.geoVerified ? 'Verificado' : 'Manual'}</span></div>`).join('') : `<div class="empty-state"><div class="icon-tile">${ICON('check-circle')}</div><h3>Nenhuma presença registrada</h3><p>Registros feitos pelos membros ou pela recepção aparecerão aqui.</p></div>`}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button></div>`;
  } else if (type === 'growth-strategy') {
    modalTitle = 'Estratégia de crescimento';
    modalEyebrow = 'CUIDADO, DISCIPULADO E SERVIÇO';
    content = renderGrowthStrategyModal();
  } else if (type === 'growth-goals') {
    modalTitle = 'Metas de crescimento';
    modalEyebrow = 'ACOMPANHAMENTO';
    content = `<form data-form="growth"><div class="scope-note" style="margin:0 0 18px;"><span>${ICON('sparkle')}</span><p>Defina objetivos possíveis para acompanhar visitantes, retornos e membros. As metas ficam salvas na igreja ativa.</p></div><div class="form-grid"><div class="form-field"><label for="goalVisitors">Visitantes no ciclo</label><input class="input" id="goalVisitors" name="visitors" type="number" min="0" value="${esc(state.growthGoals?.visitors || 0)}"></div><div class="form-field"><label for="goalReturns">Retornos no ciclo</label><input class="input" id="goalReturns" name="returns" type="number" min="0" value="${esc(state.growthGoals?.returns || 0)}"></div><div class="form-field full"><label for="goalMembers">Membros ativos</label><input class="input" id="goalMembers" name="members" type="number" min="0" value="${esc(state.growthGoals?.members || 0)}"></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-gold">${ICON('check')} Salvar metas</button></div></form>`;
  }
  title.textContent = modalTitle;
  eyebrow.textContent = modalEyebrow;
  body.innerHTML = content;
  backdrop.classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => { const autofocus = $('#modalBody input[autofocus], #modalBody input:not([type="checkbox"]):not([type="radio"])'); autofocus?.focus(); }, 50);
  if (type === 'search') bindGlobalSearch();
}

function closeModal() {
  $('#modalBackdrop')?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function updateLogoPreview() {
  const church = getActiveChurch();
  const symbol = ($('#churchLogoSymbol')?.value || churchLogoText(church)).trim().slice(0, 2).toUpperCase() || 'B';
  const text = $('#settingsLogoSymbol');
  const image = $('#settingsLogoImage');
  const source = pendingLogoImage !== null ? pendingLogoImage : (church?.logoImage || '');
  if (text) { text.textContent = symbol; text.hidden = Boolean(source); }
  if (image) { image.hidden = !source; if (source) { image.src = source; image.alt = `${church?.name || 'Igreja'} — logo`; } }
}

function handleLogoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return showToast('Escolha uma imagem PNG, JPG ou WEBP.', 'error');
  if (file.size > 2 * 1024 * 1024) return showToast('A imagem do logo deve ter no máximo 2 MB.', 'error');
  const reader = new FileReader();
  reader.onload = () => { pendingLogoImage = String(reader.result || ''); updateLogoPreview(); showToast('Logo carregado. Clique em “Salvar alterações” para aplicar.'); };
  reader.readAsDataURL(file);
}

function showToast(message, kind = 'success') {
  const stack = $('#toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${kind === 'error' ? 'is-error' : ''}`;
  toast.innerHTML = `<span class="toast-icon">${ICON(kind === 'error' ? 'x' : 'check')}</span><span>${esc(message)}</span>`;
  stack.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(6px)'; setTimeout(() => toast.remove(), 250); }, 3600);
}

function isoDateFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDaysToDate(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}
function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0, 23, 59, 59);
}
function nthWeekdayDate(year, month, weekday, ordinal) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const date = new Date(year, month, 1 + offset + ((ordinal - 1) * 7), 12);
  return date.getMonth() === month ? date : null;
}
function generateEventDates(startDateValue, recurrence, weekday, ordinal) {
  const start = parseDate(startDateValue);
  const type = recurrence || 'none';
  if (type === 'none') return [isoDateFromDate(start)];
  const dates = [];
  const year = start.getFullYear();
  const month = start.getMonth();
  const end = type === 'weekly-month' ? lastDayOfMonth(year, month) : new Date(year, 11, 31, 23, 59, 59);
  if (type === 'weekly-month' || type === 'weekly-year') {
    let cursor = start;
    const distance = (Number(weekday) - cursor.getDay() + 7) % 7;
    cursor = addDaysToDate(cursor, distance);
    while (cursor <= end) { dates.push(isoDateFromDate(cursor)); cursor = addDaysToDate(cursor, 7); }
  } else if (type === 'monthly-date') {
    for (let cursor = new Date(year, month, 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
      const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), start.getDate(), 12);
      if (candidate.getMonth() === cursor.getMonth() && candidate >= start && candidate <= end) dates.push(isoDateFromDate(candidate));
    }
  } else if (type === 'monthly-weekday') {
    for (let cursor = new Date(year, month, 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
      const candidate = nthWeekdayDate(cursor.getFullYear(), cursor.getMonth(), Number(weekday), Number(ordinal));
      if (candidate && candidate >= start && candidate <= end) dates.push(isoDateFromDate(candidate));
    }
  } else if (type === 'yearly-date') {
    const candidate = new Date(year, month, start.getDate(), 12);
    if (candidate >= start && candidate <= end) dates.push(isoDateFromDate(candidate));
  } else if (type === 'yearly-weekday') {
    const candidate = nthWeekdayDate(year, month, Number(weekday), Number(ordinal));
    if (candidate && candidate >= start && candidate <= end) dates.push(isoDateFromDate(candidate));
  }
  return [...new Set(dates.length ? dates : [isoDateFromDate(start)])];
}
function buildRecurrenceRule(startDate, recurrence, weekday, ordinal) {
  const until = recurrence === 'weekly-month' ? `${startDate.slice(0, 7)}-${String(new Date(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)), 0).getDate()).padStart(2, '0')}` : `${startDate.slice(0, 4)}-12-31`;
  return { type: recurrence || 'none', weekday: Number(weekday), ordinal: Number(ordinal), until };
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const formType = form.dataset.form;
  const data = new FormData(form);
  if (formType === 'visitor') {
    const name = String(data.get('name') || '').trim();
    if (!name) return showToast('Informe o nome do visitante.', 'error');
    const additionalFamilyMembers = data.getAll('familyMembers').map(member => String(member).trim()).filter(Boolean);
    const familyMembers = [...new Set([name, ...additionalFamilyMembers])];
    try {
      await apiRequest('/api/church/visitors', { method: 'POST', body: {
        name,
        familyName: String(data.get('familyName') || '').trim(),
        familyMembers,
        arrivalType: String(data.get('arrivalType') || 'Sozinho'),
        phone: String(data.get('phone') || '').trim(),
        neighborhood: String(data.get('neighborhood') || '').trim(),
        visitDate: String(data.get('date') || TODAY),
        service: String(data.get('service') || 'Culto de Celebração'),
        invitedBy: String(data.get('invitedBy') || '').trim(),
        notes: String(data.get('notes') || '').trim()
      }});
      await loadRemoteChurchState(state.currentUser);
      closeModal();
      render();
      showToast(`Visitante ${name} cadastrado no banco de produção.`, 'success');
    } catch (error) {
      showToast(`Não foi possível salvar o visitante: ${error.message}`, 'error');
    }
  } else if (formType === 'announcement') {
    const title = String(data.get('title') || '').trim();
    const body = String(data.get('body') || '').trim();
    const channels = data.getAll('channels');
    const mode = String(data.get('mode') || 'now');
    if (!title || !body) return showToast('Preencha o título e a mensagem do aviso.', 'error');
    if (!channels.length) return showToast('Escolha pelo menos um canal para registrar o aviso.', 'error');
    try {
      await apiRequest('/api/church/announcements', { method: 'POST', body: { title, body, audience: String(data.get('audience') || 'Toda a igreja'), channels, personalizeGreeting: data.get('personalizeGreeting') === 'on', mode: mode === 'scheduled' ? 'scheduled' : 'now' } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render();
      showToast(mode === 'scheduled' ? 'Aviso agendado e salvo no banco. Nenhum envio real foi feito.' : 'Aviso salvo no banco. O envio real ainda não está configurado.');
    } catch (error) {
      showToast(`Não foi possível salvar o aviso: ${error.message}`, 'error');
    }
  } else if (formType === 'event-edit') {
    const eventRecord = (state.events || []).find(item => item.id === form.dataset.id);
    const title = String(data.get('title') || '').trim();
    if (!eventRecord) return showToast('Evento não encontrado.', 'error');
    if (!title) return showToast('Informe o nome do evento.', 'error');
    const startDate = String(data.get('date') || eventRecord.date);
    const recurrence = String(data.get('recurrence') || 'none');
    const weekday = Number(data.get('weekday') || parseDate(startDate).getDay());
    const ordinal = Number(data.get('ordinal') || 1);
    const updateSeries = data.get('updateSeries') === 'on';
    const currentRecurrence = eventRecord.recurrenceRule?.type || 'none';
    const recurrenceChanged = recurrence !== currentRecurrence;
    if (eventRecord.recurrenceId && recurrenceChanged && !updateSeries) return showToast('Para alterar a repetição de uma série, marque “Aplicar à série inteira”.', 'error');
    const recurrenceId = recurrence === 'none' ? '' : (eventRecord.recurrenceId || `rec-${Date.now()}`);
    const recurrenceRule = buildRecurrenceRule(startDate, recurrence, weekday, ordinal);
    const base = { title, date: startDate, time: String(data.get('time') || eventRecord.time || '19:00'), location: String(data.get('location') || ''), type: String(data.get('type') || 'Outro'), audience: String(data.get('audience') || 'Toda a igreja'), status: String(data.get('status') || 'active'), recurrenceRule, recurrenceId };
    const replaceSeries = (!eventRecord.recurrenceId && recurrence !== 'none') || (Boolean(eventRecord.recurrenceId) && recurrenceChanged);
    try {
      if (replaceSeries) {
        const dates = generateEventDates(startDate, recurrence, weekday, ordinal);
        await apiRequest(`/api/church/events/${encodeURIComponent(eventRecord.id)}/series`, { method: 'PUT', body: { oldRecurrenceId: eventRecord.recurrenceId || '', events: dates.map(date => ({ ...base, date })) } });
      } else {
        await apiRequest(`/api/church/events/${encodeURIComponent(eventRecord.id)}`, { method: 'PATCH', body: { ...base, updateSeries } });
      }
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast(`Evento “${title}” atualizado na agenda.`);
    } catch (error) {
      showToast(`Não foi possível editar o evento: ${error.message}`, 'error');
    }
  } else if (formType === 'event') {
    const title = String(data.get('title') || '').trim();
    if (!title) return showToast('Informe o nome do evento.', 'error');
    const startDate = String(data.get('date') || TODAY);
    const recurrence = String(data.get('recurrence') || 'none');
    const weekday = Number(data.get('weekday') || parseDate(startDate).getDay());
    const ordinal = Number(data.get('ordinal') || 1);
    const dates = generateEventDates(startDate, recurrence, weekday, ordinal);
    const recurrenceId = `rec-${Date.now()}`;
    const base = { title, time: String(data.get('time') || '19:00'), location: String(data.get('location') || 'Templo principal'), type: String(data.get('type') || 'Outro'), audience: String(data.get('audience') || 'Toda a igreja'), status: 'active', recurrenceRule: buildRecurrenceRule(startDate, recurrence, weekday, ordinal), recurrenceId };
    const events = dates.map(date => ({ ...base, date }));
    try {
      await apiRequest('/api/church/events/bulk', { method: 'POST', body: { events } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render();
      showToast(`${events.length} ${events.length === 1 ? 'evento adicionado' : 'ocorrências adicionadas'} à agenda.`);
    } catch (error) {
      showToast(`Não foi possível salvar o evento: ${error.message}`, 'error');
    }
  } else if (formType === 'church') {
    const name = String(data.get('name') || '').trim();
    if (!name) return showToast('Informe o nome da igreja.', 'error');
    const church = { id: `church-${Date.now()}`, name, city: String(data.get('city') || 'Brasil'), phone: '', pastors: String(data.get('admin') || ''), description: 'Um lugar para pertencer, crescer e viver a fé em comunidade.', initials: initials(name), logoSymbol: initials(name).slice(0, 2), logoImage: '', appearance: { ...DEFAULT_APPEARANCE }, members: 0, status: 'Ativa', plan: 'Essencial' };
    state.churches.push(church);
    state.activeChurchId = church.id;
    saveState(); closeModal(); render(); showToast(`${name} foi adicionada como nova organização.`);
  } else if (formType === 'leader' || formType === 'leader-edit') {
    const name = String(data.get('name') || '').trim();
    if (!name) return showToast('Informe o nome da liderança.', 'error');
    const payload = { name, preferredName: String(data.get('preferredName') || '').trim(), gender: String(data.get('gender') || 'unspecified'), role: String(data.get('role') || 'Líder'), phone: String(data.get('phone') || ''), group: String(data.get('group') || '') };
    try {
      if (formType === 'leader') await apiRequest('/api/church/leaders', { method: 'POST', body: payload });
      else await apiRequest(`/api/church/leaders/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: payload });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast(formType === 'leader' ? `${name} foi adicionada à equipe.` : 'Dados da liderança atualizados.');
    } catch (error) {
      showToast(`Não foi possível salvar a liderança: ${error.message}`, 'error');
    }
  } else if (formType === 'member') {
    const name = String(data.get('name') || '').trim();
    const ministry = String(data.get('ministry') || '').trim().replace(/\s+/g, ' ');
    if (!name) return showToast('Informe o nome do membro.', 'error');
    const knownMinistry = (state.ministries || []).find(item => String(item.name || item).trim().toLowerCase() === ministry.toLowerCase());
    try {
      let ministryId = knownMinistry?.id || null;
      if (ministry && !knownMinistry) {
        const shouldCreate = window.confirm(`“${ministry}” ainda não está cadastrado nesta igreja. Deseja cadastrar este novo ministério para os próximos membros?`);
        if (!shouldCreate) return showToast('O membro não foi salvo. Escolha um ministério existente ou confirme o cadastro do novo ministério.', 'error');
        const ministryPayload = await apiRequest('/api/church/ministries', { method: 'POST', body: { name: ministry } });
        ministryId = ministryPayload.ministry?.id || null;
      }
      await apiRequest('/api/church/members', { method: 'POST', body: { name, preferredName: String(data.get('preferredName') || '').trim(), gender: String(data.get('gender') || 'unspecified'), email: String(data.get('email') || '').trim(), phone: String(data.get('phone') || '').trim(), ministry, ministryId, status: String(data.get('status') || 'active'), joinedAt: String(data.get('joinedAt') || '') || null, communicationConsent: data.get('communicationConsent') === 'on', locationConsent: data.get('locationConsent') === 'on', consentVersion: 'web-v1' } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast(`${name} foi cadastrado como membro.`);
    } catch (error) {
      showToast(`Não foi possível salvar o membro: ${error.message}`, 'error');
    }
  } else if (formType === 'care-task') {
    const title = String(data.get('title') || '').trim();
    if (!title) return showToast('Informe o próximo passo de cuidado.', 'error');
    let memberId = String(data.get('memberId') || '').trim() || null;
    let visitorId = String(data.get('visitorId') || '').trim() || null;
    const personRef = String(data.get('personRef') || '').trim();
    if (!memberId && !visitorId && personRef.includes(':')) {
      const [personType, personId] = personRef.split(':');
      if (personType === 'member') memberId = personId;
      if (personType === 'visitor') visitorId = personId;
    }
    if (!memberId && !visitorId) return showToast('Escolha a pessoa que receberá este cuidado.', 'error');
    try {
      await apiRequest('/api/church/care-tasks', { method: 'POST', body: { memberId, visitorId, title, description: String(data.get('description') || '').trim(), taskType: String(data.get('taskType') || 'follow_up'), priority: String(data.get('priority') || 'normal'), dueDate: String(data.get('dueDate') || '') || null } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast('Cuidado registrado para a equipe autorizada.');
    } catch (error) {
      showToast(`Não foi possível salvar o cuidado: ${error.message}`, 'error');
    }
  } else if (formType === 'attendance') {
    const memberId = String(data.get('memberId') || '').trim();
    if (!memberId) return showToast('Membro não selecionado.', 'error');
    try {
      const result = await apiRequest('/api/church/attendance', { method: 'POST', body: { memberId, source: 'manual', notes: String(data.get('notes') || '').trim() } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast(result.duplicate ? 'A presença já estava registrada recentemente.' : 'Presença registrada com vínculo à igreja.');
    } catch (error) {
      showToast(`Não foi possível registrar a presença: ${error.message}`, 'error');
    }
  } else if (formType === 'profile') {
    const preferredName = String(data.get('preferredName') || '').trim();
    const gender = ['female', 'male', 'plural', 'unspecified'].includes(String(data.get('gender') || '')) ? String(data.get('gender')) : 'unspecified';
    try {
      const payload = await apiRequest('/api/me/profile', { method: 'PATCH', body: { preferredName, gender } });
      state.currentUser = { ...(state.currentUser || {}), preferredName: payload.user?.preferredName || preferredName, gender, role: genderedRole({ gender }, 'Pastor da igreja') };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      closeModal(); render(); showToast('Forma de tratamento salva para o painel e futuras mensagens personalizadas.');
    } catch (error) {
      showToast(`Não foi possível salvar a forma de tratamento: ${error.message}`, 'error');
    }
  } else if (formType === 'growth') {
    state.growthGoals = { visitors: Math.max(0, Number(data.get('visitors') || 0)), returns: Math.max(0, Number(data.get('returns') || 0)), members: Math.max(0, Number(data.get('members') || 0)) };
    const church = getActiveChurch();
    church.publicSettings = { ...(church.publicSettings || {}), growthGoals: state.growthGoals };
    try {
      await apiRequest('/api/church/settings', { method: 'PUT', body: { name: church.name, city: church.city, phone: church.phone || '', pastors: church.pastors || '', description: church.description || '', logoUrl: church.logoImage || '', publicSettings: church.publicSettings } });
      saveState('Metas de crescimento atualizadas'); closeModal(); render(); showToast('Metas de crescimento salvas.');
    } catch (error) {
      showToast(`Não foi possível salvar as metas: ${error.message}`, 'error');
    }
  } else if (formType === 'reception-edit') {
    const receptionUser = (state.receptionUsers || []).find(item => item.id === form.dataset.id);
    const name = String(data.get('name') || '').trim();
    const login = String(data.get('login') || '').trim().toLowerCase();
    if (!receptionUser) return showToast('Acesso da recepção não encontrado.', 'error');
    if (!name || !login) return showToast('Informe o nome e o login do acesso.', 'error');
    try {
      await apiRequest(`/api/church/reception-users/${encodeURIComponent(receptionUser.id)}`, { method: 'PATCH', body: { name, login, role: String(data.get('role') || receptionUser.role || 'Recepção'), phone: String(data.get('phone') || '').trim() } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast(`Acesso de ${name} atualizado no banco da igreja.`);
    } catch (error) {
      showToast(`Não foi possível editar o acesso: ${error.message}`, 'error');
    }
  } else if (formType === 'reception') {
    const name = String(data.get('name') || '').trim();
    const login = String(data.get('login') || '').trim().toLowerCase();
    const password = String(data.get('password') || '');
    const passwordConfirm = String(data.get('passwordConfirm') || '');
    if (!name) return showToast('Informe o nome do obreiro ou membro.', 'error');
    if (!login) return showToast('Informe um e-mail para o login.', 'error');
    if (password.length < 6) return showToast('A senha deve ter pelo menos 6 caracteres.', 'error');
    if (password !== passwordConfirm) return showToast('A confirmação da senha não confere.', 'error');
    try {
      await apiRequest('/api/church/reception-users', { method: 'POST', body: { name, login, password, role: String(data.get('role') || 'Recepção'), phone: String(data.get('phone') || '').trim() } });
      await loadRemoteChurchState(state.currentUser);
      closeModal(); render(); showToast(`Acesso de ${name} salvo no banco da igreja.`);
    } catch (error) {
      showToast(`Não foi possível salvar o acesso: ${error.message}`, 'error');
    }
  } else if (formType === 'organization') {
    const church = getActiveChurch();
    church.name = String(data.get('churchName') ?? church.name).trim() || church.name;
    church.city = String(data.get('churchCity') ?? church.city).trim() || church.city;
    church.pastors = String(data.get('pastorName') ?? church.pastors ?? '').trim();
    church.phone = String(data.get('churchPhone') ?? church.phone ?? '').trim();
    church.description = String(data.get('churchDescription') ?? church.description ?? '').trim();
    church.logoSymbol = String(data.get('logoSymbol') || church.logoSymbol || initials(church.name)).trim().slice(0, 2).toUpperCase();
    church.initials = initials(church.name);
    if (pendingLogoImage !== null) church.logoImage = pendingLogoImage;
    pendingLogoImage = null;
    const publicForm = document.querySelector('[data-public-settings-form]');
    const publicData = publicForm ? new FormData(publicForm) : data;
    const publicValue = (key, fallback = '') => String(publicData.get(key) ?? fallback).trim();
    const publicSettings = { ...(church.publicSettings || {}), visible: publicForm ? publicForm.querySelector('[name="publicVisible"]')?.checked !== false : (church.publicSettings?.visible !== false), headline: publicValue('publicHeadline', church.description || ''), address: publicValue('publicAddress', church.city || ''), hours: publicValue('publicHours', 'Domingos às 19h'), instagram: publicValue('publicInstagram', ''), facebook: publicValue('publicFacebook', ''), youtube: publicValue('publicYoutube', ''), cta: publicValue('publicCta', 'Venha nos visitar'), logoSymbol: church.logoSymbol || initials(church.name), appearance: { ...DEFAULT_APPEARANCE, ...(church.appearance || {}) } };
    church.publicSettings = publicSettings;
    clearTimeout(appearanceSaveTimer);
    try {
      await apiRequest('/api/church/settings', { method: 'PUT', body: { name: church.name, city: church.city, phone: church.phone, pastors: church.pastors, description: church.description, logoUrl: church.logoImage || '', publicSettings } });
      saveState('Identidade, aparência e página pública atualizadas');
      render();
      showToast('Alterações salvas no banco da igreja.');
    } catch (error) {
      showToast(`Não foi possível salvar as alterações: ${error.message}`, 'error');
    }
  }
}

async function completeCareTask(id) {
  const task = (state.careTasks || []).find(item => item.id === id);
  if (!task) return;
  try {
    await apiRequest(`/api/church/care-tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'done' } });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast('Cuidado marcado como concluído.');
  } catch (error) {
    showToast(`Não foi possível atualizar o cuidado: ${error.message}`, 'error');
  }
}

async function markContacted(id) {
  const visitor = state.visitors.find(item => item.id === id);
  if (!visitor) return;
  try {
    await apiRequest(`/api/church/visitors/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'Contatado', responsible: 'Pr. Evandro' } });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(`${visitor.name} agora está em acompanhamento e foi salvo no banco.`);
  } catch (error) {
    showToast(`Não foi possível salvar o acompanhamento: ${error.message}`, 'error');
  }
}

function prepareVisitorAnnouncement(id) {
  const visitor = state.visitors.find(item => item.id === id);
  if (!visitor) return;
  closeModal();
  openModal('announcement', { visitors: [visitor] });
}

function announceNewVisitors() {
  const pending = pendingPulpitVisitors();
  const visitors = pending.length ? pending : state.visitors.slice(0, 6);
  openModal('announcement', { visitors });
}

async function markPulpitAnnounced() {
  const pending = pendingPulpitVisitors();
  if (!pending.length) return showToast('Não há visitantes pendentes para marcar.', 'error');
  try {
    await Promise.all(pending.map(visitor => apiRequest(`/api/church/visitors/${encodeURIComponent(visitor.id)}`, { method: 'PATCH', body: { announced: true } })));
    await loadRemoteChurchState(state.currentUser);
    render();
    showToast(`${pending.length === 1 ? 'Visitante marcado' : 'Visitantes marcados'} como apresentados e salvo${pending.length === 1 ? '' : 's'} no banco.`);
  } catch (error) {
    showToast(`Não foi possível salvar a apresentação: ${error.message}`, 'error');
  }
}

function togglePulpitFullscreen() {
  const target = $('.pulpit-hero')?.parentElement || document.documentElement;
  if (!document.fullscreenElement) {
    target.requestFullscreen?.().catch(() => showToast('A tela cheia não está disponível neste navegador.', 'error'));
  } else {
    document.exitFullscreen?.();
  }
}

async function resetReceptionPassword(id) {
  const receptionUser = (state.receptionUsers || []).find(item => item.id === id);
  if (!receptionUser) return;
  const password = window.prompt(`Defina uma nova senha para ${receptionUser.name} (mínimo de 6 caracteres):`);
  if (password === null) return;
  if (password.length < 6) return showToast('A senha deve ter pelo menos 6 caracteres.', 'error');
  const confirmation = window.prompt('Confirme a nova senha:');
  if (confirmation === null) return;
  if (password !== confirmation) return showToast('A confirmação da senha não confere.', 'error');
  try {
    await apiRequest(`/api/church/reception-users/${encodeURIComponent(receptionUser.id)}`, { method: 'PATCH', body: { name: receptionUser.name, login: receptionUser.login, role: receptionUser.role, phone: receptionUser.phone || '', password } });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(`Nova senha definida para ${receptionUser.name}.`);
  } catch (error) {
    showToast(`Não foi possível definir a senha: ${error.message}`, 'error');
  }
}

async function toggleReceptionAccess(id) {
  const receptionUser = (state.receptionUsers || []).find(item => item.id === id);
  if (!receptionUser) return;
  const willBlock = receptionUser.status !== 'Bloqueado';
  const message = willBlock ? `Bloquear o acesso de ${receptionUser.name}?` : `Reativar o acesso de ${receptionUser.name}?`;
  if (!window.confirm(message)) return;
  try {
    await apiRequest(`/api/church/reception-users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name: receptionUser.name, login: receptionUser.login, role: receptionUser.role, phone: receptionUser.phone || '', status: willBlock ? 'blocked' : 'active' } });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(willBlock ? `Acesso de ${receptionUser.name} bloqueado.` : `Acesso de ${receptionUser.name} reativado.`);
  } catch (error) {
    showToast(`Não foi possível alterar o acesso: ${error.message}`, 'error');
  }
}

async function deleteReceptionAccess(id) {
  const receptionUser = (state.receptionUsers || []).find(item => item.id === id);
  if (!receptionUser) return;
  if (!window.confirm(`Excluir o acesso de ${receptionUser.name}? Os visitantes cadastrados por ele não serão apagados.`)) return;
  try {
    await apiRequest(`/api/church/reception-users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(`Acesso de ${receptionUser.name} excluído.`);
  } catch (error) {
    showToast(`Não foi possível excluir o acesso: ${error.message}`, 'error');
  }
}

async function setEventStatus(id, status) {
  const eventRecord = (state.events || []).find(item => item.id === id);
  if (!eventRecord) return;
  const label = eventStatusLabel(status).toLowerCase();
  if (!window.confirm(`${eventStatusLabel(status)} o evento “${eventRecord.title}”?`)) return;
  try {
    await apiRequest(`/api/church/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(`Evento ${label} com sucesso.`);
  } catch (error) {
    showToast(`Não foi possível alterar a situação do evento: ${error.message}`, 'error');
  }
}

async function deleteEvent(id) {
  const eventRecord = (state.events || []).find(item => item.id === id);
  if (!eventRecord) return;
  if (!window.confirm(`Excluir o evento “${eventRecord.title}” de ${formatDateLong(eventRecord.date)}? Esta ação não pode ser desfeita.`)) return;
  try {
    await apiRequest(`/api/church/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(`Evento “${eventRecord.title}” excluído da agenda.`);
  } catch (error) {
    showToast(`Não foi possível excluir o evento: ${error.message}`, 'error');
  }
}

async function deleteLeader(id) {
  const leader = (state.leaders || []).find(item => item.id === id);
  if (!leader || !window.confirm(`Excluir a liderança de ${leader.name}?`)) return;
  try {
    await apiRequest(`/api/church/leaders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadRemoteChurchState(state.currentUser);
    closeModal(); render(); showToast(`${leader.name} foi excluído da equipe.`);
  } catch (error) {
    showToast(`Não foi possível excluir a liderança: ${error.message}`, 'error');
  }
}

function exportMembers() {
  const headers = ['Nome', 'E-mail', 'Telefone', 'Ministério', 'Status', 'Data de integração'];
  const rows = (state.members || []).map(member => [member.name, member.email, member.phone, member.ministry, member.status === 'inactive' ? 'Inativo' : 'Ativo', member.joinedAt]);
  if (!rows.length) return showToast('Ainda não há membros cadastrados para exportar.', 'error');
  const csv = [headers, ...rows].map(row => row.map(escapeCSV).join(';')).join('\\n');
  downloadBlob(`membros-${slugify(getActiveChurch()?.name || 'igreja')}-${TODAY}.csv`, `\\ufeff${csv}`, 'text/csv;charset=utf-8;');
  showToast('Lista de membros exportada.');
}

function shiftCalendar(offset) {
  const [year, month] = String(state.calendarMonth || TODAY.slice(0, 7)).split('-').map(Number);
  const cursor = new Date(year, month - 1 + offset, 1);
  state.calendarMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  saveState(); render();
}

function switchChurch(id) {
  const church = state.churches.find(item => item.id === id);
  if (!church) return;
  if (!isPlatformAdmin() && id !== state.activeChurchId) return showToast('Você só pode acessar os dados da sua própria igreja.', 'error');
  state.activeChurchId = id;
  saveState(); closeModal(); render(); showToast(`Área da ${church.name} selecionada.`);
}

function exportVisitors() {
  const headers = ['Nome principal', 'Família ou grupo', 'Como veio', 'Nomes para anunciar', 'Telefone', 'Data da visita', 'Culto ou evento', 'Bairro', 'Status', 'Responsável'];
  const rows = state.visitors.map(visitor => [visitor.name, visitor.familyName, visitor.arrivalType || 'Sozinho', getFamilyMembers(visitor).join(' | '), visitor.phone, visitor.date, visitor.service, visitor.neighborhood, visitor.status, visitor.responsible]);
  const csv = [headers, ...rows].map(row => row.map(escapeCSV).join(';')).join('\n');
  downloadBlob(`visitantes-${slugify(getActiveChurch()?.name || 'igreja')}-${TODAY}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8;');
  showToast('Planilha de visitantes exportada.');
}

async function copyReceptionLink() {
  const link = receptionLink(getActiveChurch());
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link da recepção copiado.');
  } catch {
    const helper = document.createElement('textarea');
    helper.value = link; document.body.appendChild(helper); helper.select(); document.execCommand('copy'); helper.remove();
    showToast('Link da recepção copiado.');
  }
}

function exportEvents() {
  const headers = ['Evento', 'Data', 'Horário', 'Local', 'Categoria', 'Público', 'Situação'];
  const rows = sortedEvents().map(event => [event.title, event.date, event.time, event.location, event.type, event.audience, eventStatusLabel(event.status)]);
  const csv = [headers, ...rows].map(row => row.map(escapeCSV).join(';')).join('\n');
  downloadBlob(`agenda-${slugify(getActiveChurch()?.name || 'igreja')}-${TODAY}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8;');
  showToast('Agenda exportada.');
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function bindGlobalSearch() {
  const input = $('#globalSearch');
  input?.addEventListener('input', () => {
    const term = input.value.trim().toLowerCase();
    const results = $('#globalSearchResults');
    if (!results) return;
    if (!term) { results.innerHTML = `<p class="field-note">Comece digitando para buscar visitantes, avisos, eventos ou líderes.</p>`; return; }
    const items = [
      ...state.visitors.map(item => ({ type: 'Visitante', title: item.name, meta: `${item.arrivalType || 'Sozinho'} · ${getFamilyMembers(item).join(', ')}`, action: 'visitor-detail', id: item.id })),
      ...state.announcements.map(item => ({ type: 'Aviso', title: item.title, meta: item.audience, action: 'go-communication' })),
      ...state.events.map(item => ({ type: 'Evento', title: item.title, meta: `${formatDateShort(item.date)} · ${item.time}`, action: 'go-agenda' })),
      ...state.leaders.map(item => ({ type: 'Liderança', title: item.name, meta: item.role, action: 'go-leaders' }))
    ].filter(item => `${item.title} ${item.meta}`.toLowerCase().includes(term)).slice(0, 6);
    results.innerHTML = items.length ? items.map(item => `<button class="tenant-row" style="width:100%;border:1px solid #f0ede7;background:#fff;text-align:left;" data-action="${item.action}" ${item.id ? `data-id="${esc(item.id)}"` : ''}><div class="tenant-logo">${esc(item.type.slice(0, 2).toUpperCase())}</div><div class="tenant-copy"><strong>${esc(item.title)}</strong><span>${esc(item.type)} · ${esc(item.meta)}</span></div>${ICON('chevron-right')}</button>`).join('') : `<div class="empty-state"><div class="icon-tile">${ICON('search')}</div><h3>Nada encontrado</h3><p>Tente outro termo.</p></div>`;
  });
}

function setView(view, options = {}) {
  if (!viewMeta[view]) return;
  if (view === 'acolhimento' && !canAccessAcolhimento()) {
    showToast('Seu acesso de recepção está bloqueado ou não possui a aba Acolhimento.', 'error');
    return;
  }
  if (!options.fromHistory && state.activeView !== view) viewHistory.push(state.activeView);
  closeModal();
  state.activeView = view;
  saveState();
  render();
  $('#sidebar')?.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
  const previousView = viewHistory.pop() || 'dashboard';
  setView(previousView, { fromHistory: true });
}

function handleAction(actionEl) {
  const action = actionEl.dataset.action;
  switch (action) {
    case 'new-visitor': openModal('visitor'); break;
    case 'open-metric': openModal('metric', { metric: actionEl.dataset.metric }); break;
    case 'new-announcement': openModal('announcement'); break;
    case 'new-event': openModal('event'); break;
    case 'edit-event': openModal('event-edit', { id: actionEl.dataset.id }); break;
    case 'set-event-status': setEventStatus(actionEl.dataset.id, actionEl.dataset.status); break;
    case 'delete-event': deleteEvent(actionEl.dataset.id); break;
    case 'new-church': if (!isPlatformAdmin()) showToast('Somente o administrador da plataforma pode cadastrar outra igreja.', 'error'); else openModal('church'); break;
    case 'new-leader': openModal('leader'); break;
    case 'new-member': openModal('member'); break;
    case 'growth-goals': openModal('growth-goals'); break;
    case 'growth-strategy': openModal('growth-strategy'); break;
    case 'member-detail': openModal('member-detail', { id: actionEl.dataset.id }); break;
    case 'new-care-task': openModal('care-task', { memberId: actionEl.dataset.memberId || '', visitorId: actionEl.dataset.visitorId || '' }); break;
    case 'care-task-detail': openModal('care-task-detail', { id: actionEl.dataset.id }); break;
    case 'complete-care-task': completeCareTask(actionEl.dataset.id); break;
    case 'register-attendance': openModal('attendance', { memberId: actionEl.dataset.memberId || '' }); break;
    case 'attendance-report': openModal('attendance-report'); break;
    case 'delete-leader': deleteLeader(actionEl.dataset.id); break;
    case 'visitor-detail': openModal('visitor-detail', { id: actionEl.dataset.id }); break;
    case 'announce-visitors': announceNewVisitors(); break;
    case 'announce-visitor': prepareVisitorAnnouncement(actionEl.dataset.id); break;
    case 'mark-pulpit-announced': markPulpitAnnounced(); break;
    case 'fullscreen-pulpit': togglePulpitFullscreen(); break;
    case 'add-family-member': {
      const list = $('#familyMemberList');
      if (!list) break;
      const nextIndex = list.querySelectorAll('.family-member-row').length + 1;
      list.insertAdjacentHTML('beforeend', familyMemberRow('', nextIndex));
      list.lastElementChild?.querySelector('input')?.focus();
      break;
    }
    case 'remove-family-member': {
      const row = actionEl.closest('.family-member-row');
      const list = $('#familyMemberList');
      if (!row || !list) break;
      if (list.querySelectorAll('.family-member-row').length === 1) {
        const input = row.querySelector('input');
        if (input) input.value = '';
      } else {
        row.remove();
        list.querySelectorAll('.family-member-number').forEach((number, index) => { number.textContent = index + 1; });
      }
      break;
    }
    case 'mark-contacted': markContacted(actionEl.dataset.id); break;
    case 'visitor-message': showToast('O registro de contato ficará disponível na próxima etapa.', 'success'); break;
    case 'close-modal': closeModal(); break;
    case 'go-back': goBack(); break;
    case 'export': exportVisitors(); break;
    case 'export-events': exportEvents(); break;
    case 'export-leaders': showToast('Lista de lideranças exportada.'); break;
    case 'export-members': exportMembers(); break;
    case 'notification': openModal('notifications'); break;
    case 'channel-settings': openModal('channels'); break;
    case 'filter-help': showToast('Use a busca e o seletor de status para filtrar os visitantes.'); break;
    case 'calendar-prev': shiftCalendar(-1); break;
    case 'calendar-next': shiftCalendar(1); break;
    case 'today': state.calendarMonth = TODAY.slice(0, 7); saveState(); render(); break;
    case 'open-public-page': { const publicPath = `${(window.location.pathname || '/').replace(/[^/]*$/, '')}publica.html?igreja=${encodeURIComponent(getActiveChurch()?.slug || slugify(getActiveChurch()?.name || 'igreja'))}`; window.open(publicPath, '_blank', 'noopener'); break; }
    case 'remove-logo': pendingLogoImage = ''; updateLogoPreview(); showToast('O símbolo de texto será usado como logo.'); break;
    case 'apply-palette': applyPalette(actionEl.dataset.palette); break;
    case 'new-reception': openModal('reception'); break;
    case 'copy-reception-link': copyReceptionLink(); break;
    case 'reception-detail': openModal('reception-detail', { id: actionEl.dataset.id }); break;
    case 'edit-reception-access': closeModal(); openModal('reception-edit', { id: actionEl.dataset.id }); break;
    case 'reset-reception-password': resetReceptionPassword(actionEl.dataset.id); break;
    case 'toggle-reception-access': toggleReceptionAccess(actionEl.dataset.id); break;
    case 'delete-reception-access': deleteReceptionAccess(actionEl.dataset.id); break;
    case 'save-settings': {
      applyAppearanceFromControls();
      $('[data-form="organization"]')?.requestSubmit();
      break;
    }
    case 'leader-detail': openModal('leader-detail', { id: actionEl.dataset.id }); break;
    case 'go-communication': closeModal(); setView('communication'); break;
    case 'go-agenda': closeModal(); setView('agenda'); break;
    case 'go-leaders': closeModal(); setView('leaders'); break;
    case 'switch-church': switchChurch(actionEl.dataset.id); break;
    case 'logout': logoutChurch(); break;
    default: break;
  }
}

function init() {
  applyAppearance();
  if (!getBackupHistory().length) saveState('Backup inicial');
  render();
  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) { event.preventDefault(); setView(nav.dataset.view); return; }
    const action = event.target.closest('[data-action]');
    if (action) { event.preventDefault(); handleAction(action); return; }
    const settingsSection = event.target.closest('[data-settings-section]');
    if (settingsSection) { applySettingsSection(settingsSection.dataset.settingsSection); showToast(`Seção “${settingsSection.textContent.trim()}” aberta.`); return; }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) { toggle.classList.toggle('on'); saveCommunicationChannels(); return; }
    if (event.target === $('#modalBackdrop')) closeModal();
  });
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('input', event => {
    if (event.target.id === 'visitorSearch') { const rows = $('#visitorRows'); if (rows) rows.innerHTML = renderVisitorRows(); }
    if (event.target.id === 'churchLogoSymbol') updateLogoPreview();
    if (event.target.matches('[data-appearance-control][type="color"]')) {
      const text = $(`[data-color-text="${event.target.id}"]`);
      if (text) text.value = event.target.value.toUpperCase();
      applyAppearanceFromControls();
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'visitorStatus' || event.target.id === 'visitorArrival') { const rows = $('#visitorRows'); if (rows) rows.innerHTML = renderVisitorRows(); }
    if (event.target.matches('[data-family-toggle]')) { $('#familyFields')?.classList.toggle('is-hidden', !event.target.checked); }
    if (event.target.id === 'visitorArrivalType' && event.target.value !== 'Sozinho') {
      const familyToggle = $('#registerFamily');
      if (familyToggle) { familyToggle.checked = true; $('#familyFields')?.classList.remove('is-hidden'); }
    }
    if (event.target.id === 'churchLogoFile') handleLogoFile(event.target.files?.[0]);
    if (event.target.matches('[data-appearance-control]')) {
      if (event.target.type === 'color') {
        const text = $(`[data-color-text="${event.target.id}"]`);
        if (text) text.value = event.target.value.toUpperCase();
      }
      applyAppearanceFromControls();
    }
    if (event.target.matches('[data-color-text]')) {
      const colorInput = document.getElementById(event.target.dataset.colorText);
      const valid = normalizeHex(event.target.value, '');
      if (!valid) {
        showToast('Digite uma cor no formato #RRGGBB.', 'error');
        if (colorInput) event.target.value = colorInput.value.toUpperCase();
      } else {
        if (colorInput) colorInput.value = valid;
        event.target.value = valid.toUpperCase();
        applyAppearanceFromControls();
      }
    }
  });
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#mobileMenu')?.addEventListener('click', () => $('#sidebar')?.classList.add('open'));
  $('#sidebarClose')?.addEventListener('click', () => $('#sidebar')?.classList.remove('open'));
  $('#churchSwitcher')?.addEventListener('click', () => openModal('churches'));
  $('#notificationBtn')?.addEventListener('click', () => openModal('notifications'));
  $('#searchTrigger')?.addEventListener('click', () => openModal('search'));
  $('#logoutBtn')?.addEventListener('click', logoutChurch);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openModal('search'); }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches('[data-action="open-metric"]')) { event.preventDefault(); document.activeElement.click(); }
    if (event.key === 'Escape') closeModal();
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
  bootstrapChurchAuth();
}

// Modal de troca de organização, mantido separado para não misturar com o cadastro de uma nova igreja.
const originalOpenModal = openModal;
openModal = function(type, data = {}) {
  if (type !== 'churches') return originalOpenModal(type, data);
  const backdrop = $('#modalBackdrop');
  if (!isPlatformAdmin()) {
    const activeChurch = getActiveChurch();
    $('#modalTitle').textContent = 'Igreja atual';
    $('#modalEyebrow').textContent = 'ACESSO DO PASTOR';
    $('#modalBody').innerHTML = `<div class="scope-note" style="margin:0;"><span>${ICON('shield')}</span><p><strong>${esc(activeChurch.name)}</strong><br>Você está conectado como pastor desta igreja. O administrador da plataforma gerencia as demais organizações.</p></div><div class="tenant-row" style="margin-top:14px;"><div class="tenant-logo">${esc(activeChurch.initials || initials(activeChurch.name))}</div><div class="tenant-copy"><strong>${esc(activeChurch.name)}</strong><span>${esc(activeChurch.city)} · igreja ativa</span></div><span class="tenant-status">${ICON('check')}</span></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-view="settings">Editar nome e logo</button></div>`;
    backdrop.classList.remove('hidden'); document.body.classList.add('modal-open');
    return;
  }
  $('#modalTitle').textContent = 'Trocar igreja';
  $('#modalEyebrow').textContent = 'ORGANIZAÇÕES';
  $('#modalBody').innerHTML = `<p class="field-note" style="margin-bottom:14px;">Cada organização possui seus próprios dados e permissões.</p><div class="tenant-list">${state.churches.map(church => `<button class="tenant-row" style="width:100%;border:1px solid ${church.id === state.activeChurchId ? '#e2c785' : '#f0ede7'};background:${church.id === state.activeChurchId ? 'var(--gold-soft)' : '#fff'};text-align:left;" data-action="switch-church" data-id="${esc(church.id)}"><div class="tenant-logo">${esc(church.initials || initials(church.name))}</div><div class="tenant-copy"><strong>${esc(church.name)}</strong><span>${esc(church.city)} · ${church.id === state.activeChurchId ? 'Igreja ativa' : 'Selecionar organização'}</span></div>${church.id === state.activeChurchId ? `<span class="tenant-status">${ICON('check')}</span>` : ICON('chevron-right')}</button>`).join('')}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button><button type="button" class="btn btn-gold" data-action="new-church">${ICON('plus')} Adicionar igreja</button></div>`;
  backdrop.classList.remove('hidden'); document.body.classList.add('modal-open');
};

init();
