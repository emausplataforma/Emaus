# Emaús — Plataforma da Igreja

A Emaús é uma plataforma multi-igreja para acolhimento, visitantes, comunicação, agenda e administração central. A Bethesda continua cadastrada como a primeira igreja da plataforma.

## Produção atual

- Frontend: GitHub Pages;
- API: Railway;
- Banco: PostgreSQL no projeto Railway `honest-gentleness`;
- API pública: `https://emaus-production-2de0.up.railway.app`;
- Verificação: `GET /health`;
- Service worker: `emaus-shell-v46`;
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

## Desenvolvimento

A API usa Node.js, Express e PostgreSQL. `server.js`, `schema.sql` e `package.json` na raiz são usados pelo Railway. O banco cria as tabelas e mantém a Bethesda na primeira inicialização.

O frontend usa `api-config.js` apenas para o endereço público da API. Não inclua senhas nesse arquivo.

## Recursos desta atualização

- página pública editável pelo pastor em Configurações → Página pública;
- link da recepção com o slug da igreja, como `recepcao.html?igreja=bethesda`;
- navegação com Acolhimento e Membros;
- eventos únicos e recorrentes por dia da semana, com ocorrências até 31 de dezembro;
- público de evento com a opção Visitantes;
- menu de lideranças com edição, exclusão e troca de cargo;
- metas de crescimento persistentes para visitantes, retornos e membros;
- Bethesda mantida ativa sem números demonstrativos pré-carregados.

## Endpoints acrescentados

- `GET /api/public/church?slug=bethesda`;
- `GET/POST /api/church/members`;
- `GET/POST/PATCH/DELETE /api/church/events`, `POST /api/church/events/bulk` e `PUT /api/church/events/:eventId/series`; edição completa de nome, data, horário, local, categoria, público, recorrência e situação (ativo, pausado ou bloqueado);
- `GET/POST/PATCH/DELETE /api/church/leaders`;
- `GET/POST/PATCH/DELETE /api/church/reception-users`;
- `PUT /api/church/settings` agora salva também `publicSettings`.
