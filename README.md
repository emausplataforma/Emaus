# Emaús — Plataforma da Igreja

A Emaús é uma plataforma multi-igreja para acolhimento, visitantes, comunicação, agenda e administração central. A Bethesda continua cadastrada como a primeira igreja da plataforma.

## Produção atual

- Frontend: `https://emausplataforma.github.io/Emaus/`;
- API: Railway;
- Banco: PostgreSQL no projeto Railway `honest-gentleness`;
- API pública: `https://emaus-production-2de0.up.railway.app`;
- Verificação: `GET /health`;
- Service worker: `emaus-shell-v56`;
- Página pública: `publica.html?igreja=bethesda` (sem login);

As senhas e chaves ficam somente nas variáveis privadas do Railway. Nunca coloque credenciais em arquivos do GitHub.

## Acessos de produção

- Administrador da plataforma: e-mail configurado em `ADMIN_EMAIL` e senha configurada em `ADMIN_PASSWORD`, em `/admin.html`;
- Pastor da Bethesda: e-mail configurado em `PASTOR_EMAIL` e senha configurada em `PASTOR_PASSWORD`, na página principal;
- Recepção: e-mail configurado em `RECEPTION_EMAIL` e senha configurada em `RECEPTION_PASSWORD`, em `/recepcao.html`.

As senhas não são documentadas neste arquivo.

## Oferta comercial mantida

- 30 dias grátis;
- Essencial: R$ 49,90/mês, até 100 pessoas ativas e 5 acessos;
- Cuidado: R$ 99,90/mês, até 300 pessoas ativas e 12 acessos;
- Rede: R$ 179,90/mês, até 800 pessoas ativas e 25 acessos;
- primeiras 40 igrejas com preço congelado por 12 meses;
- nenhuma cobrança adicional;
- nenhum sistema de créditos.

## Persistência e limites atuais

Os dados de negócio são gravados no PostgreSQL do serviço Emaús e carregados novamente depois do login: membros, visitantes, configurações públicas, aparência, agenda, lideranças, ministérios, acessos da recepção, presença, consentimentos, tarefas de cuidado, avisos registrados e atividade. O navegador guarda somente preferências visuais e a sessão temporária; não guarda cópia de visitantes, membros, avisos ou credenciais.

Os avisos podem ser registrados ou agendados, mas nenhum Push, WhatsApp ou e-mail é enviado nesta fase. O backup automático do PostgreSQL deve ser configurado no Railway. O procedimento guiado de backup e restauração está em `docs/BACKUP-RESTAURACAO-POSTGRES.md`; nenhum backup de dados de negócio é mantido no navegador.

## Desenvolvimento

A API usa Node.js, Express e PostgreSQL. `server.js`, `schema.sql` e `package.json` na raiz são usados pelo Railway. O banco cria as tabelas e mantém a Bethesda na primeira inicialização.

O frontend usa `api-config.js` apenas para o endereço público da API. Não inclua senhas nesse arquivo.

## Recursos desta atualização

- página pública editável pelo pastor em Configurações → Página pública;
- formulário público de primeiro contato em `visita.html?igreja=bethesda`, com consentimento obrigatório e limite de tentativas;
- link da recepção com o slug da igreja, como `recepcao.html?igreja=bethesda`;
- navegação com Acolhimento e Membros;
- eventos únicos e recorrentes por dia da semana, com ocorrências até 31 de dezembro;
- público de evento com a opção Visitantes;
- menu de lideranças com edição, exclusão e troca de cargo;
- metas de crescimento persistentes para visitantes, retornos e membros;
- estratégia de cuidado e crescimento em marcos de 50 até 500 membros, com quatro práticas por etapa e diretrizes alinhadas ao evangelho;
- forma de tratamento escolhida pela pessoa para membros, lideranças e pastor, incluindo saudação plural para mais de um pastor, sem inferência indevida pelo nome;
- tarefas de cuidado pastoral vinculadas a membros ou visitantes, com prioridade, prazo e conclusão;
- registros internos de presença vinculados a uma única igreja, sem armazenar localização exata;
- consentimentos separados para comunicação e recurso futuro de localização;
- bloqueio de duplicidade de membros por e-mail ou telefone dentro da igreja;
- política de privacidade inicial em `privacidade.html` e checklist de produção em `docs/PRODUCAO-CHECKLIST.md`;
- saudação personalizada preparada para avisos, convites e acompanhamentos futuros;
- Bethesda mantida ativa sem registros fictícios no fallback do frontend; novos líderes e eventos entram somente por cadastro autorizado;
- onboarding inicial da igreja com etapas de página pública, recepção, primeiro membro, agenda e metas;
- indicador visível de sincronização com o banco e mensagens que distinguem banco, cache visual e falha;
- preparação de 2FA sem ativação automática, com campos de segurança e rota de status;
- backup e restauração do PostgreSQL documentados para ativação guiada.

## Endpoints acrescentados

- `GET /api/public/church?slug=bethesda`;
- `POST /api/public/church/:slug/visitors` — primeiro contato público, sem login, com consentimento e proteção contra excesso de cadastros;
- `GET/POST/PATCH/DELETE /api/church/members`;
- `GET/POST /api/church/ministries` — catálogo de ministérios por igreja, com confirmação ao cadastrar um nome novo;
- `PATCH /api/me/profile` — salva a forma de tratamento do usuário pastor;
- `GET/POST/PATCH/DELETE /api/church/events`, `POST /api/church/events/bulk` e `PUT /api/church/events/:eventId/series`; edição completa de nome, data, horário, local, categoria, público, recorrência e situação (ativo, pausado ou bloqueado);
- `GET/POST/PATCH/DELETE /api/church/leaders`;
- `GET/POST/PATCH/DELETE /api/church/reception-users`;
- `PUT /api/church/settings` agora salva também `publicSettings`;
- `GET/POST /api/church/attendance` e `GET /api/church/attendance/summary` para presenças internas vinculadas à igreja;
- `POST /api/church/members/:memberId/consents` para autorizações de comunicação, privacidade e recurso futuro de localização;
- `GET/POST/PATCH /api/church/care-tasks` para tarefas de cuidado pastoral vinculadas a membro ou visitante;
- `GET/POST /api/church/announcements` para registrar avisos e agendamentos sem disparo real;
- `GET /api/church/activity` para histórico persistente da igreja;
- `GET /api/me/security` para informar a preparação e o estado atual de 2FA;
- `PATCH /api/church/visitors/:visitorId` para acompanhamento e apresentação persistentes;
- login com limite de tentativas, cabeçalhos básicos de segurança e auditoria de falhas;
- duplicidade de membros bloqueada por e-mail ou telefone dentro da mesma igreja;
- acompanhamento de visitantes (contatado, responsável e apresentado) persistido no PostgreSQL;
- avisos e agendamentos registrados no PostgreSQL, sem envio real enquanto os canais externos não forem configurados;
- feed de atividade da igreja persistido e carregado por todos os acessos autorizados.
