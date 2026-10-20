---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: '2026-10-04T23:48:23.734406929+00:00'
  docs/decisions/technical-decisions-phase-03-videos.md: '2026-10-18T15:21:27.234386417+00:00'
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: '2026-10-04T23:48:24.088685201+00:00'
  docs/phases/phase-01-configuracao-base/context.md: '2026-10-18T01:51:38.793392560+00:00'
  docs/phases/phase-02-auth/context.md: '2026-10-04T23:48:25.138369966+00:00'
  docs/phases/phase-02-auth-frontend/context.md: '2026-10-18T01:51:38.793548738+00:00'
  .agents/skills/testing-guide-nestjs-project/SKILL.md: '2026-10-05T00:24:50.699526553+00:00'
  docs/phases/phase-03-videos/analysis.md: '2026-10-18T15:07:35.419996134+00:00'
  docs/phases/phase-03-videos/evidence/baseline-results.json: '2026-10-18T15:07:35.413720710+00:00'
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, docs/project-plan.md):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Frontend, publicação/visibilidade/edição da Fase 04, categorias, HLS e adaptive bitrate. Fonte: prompt.md e os limites das fases 03/04 no project-plan.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`; infraestrutura do backend.

**Deferred subprojects:** `next-frontend/` — explicitamente fora do desafio atual.

**Sequencing notes:** Depende de Fases 01 e 02. Pré-verificação documentada em analysis.md e evidence/baseline-results.json: a base possui conflito de configurações Jest, falha de migrations e erros de lint. A Definition of Done inclui corrigir esses pré-requisitos sem esconder falhas.

**Artifact naming:** caminhos exatos fixados em prompt.md: decisões technical-decisions-phase-03-videos.md e pasta docs/phases/phase-03-videos/. Não duplicar o prefixo phase-03 ao resolver o slug legado.

**Neighbors (boundary only):** Phase 02 — autenticação, usuários e canais; Phase 04 — publicação, edição, visibilidade e gerenciamento.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Tecnologia da fila de processamento | decided | A | @nestjs/bullmq, bullmq |
|     └─ Last revision: 2026-10-18 — Queue `video-processing`; job `process-video`; payload `{ schemaVersion: 1, vid… | | | | | | |
| phase-03-videos/TD-02 | phase | Backend | Protocolo de upload grande, retomada e rascunho | decided | A | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
|     └─ Last revision: 2026-10-18 — Defaults operacionais definidos no planejamento, não números ditados pelo enunc… | | | | | | |
| phase-03-videos/TD-03 | phase | Backend | Organização e proteção dos objetos S3/MinIO | decided | A | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
|     └─ Last revision: 2026-10-18 — Chaves `videos/<uuid>/source` e `videos/<uuid>/thumbnail.jpg`. Nunca expor obje… | | | | | | |
| phase-03-videos/TD-04 | phase | Backend | Worker, metadados, thumbnail e formato reproduzível | decided | A | @nestjs/bullmq, bullmq |
|     └─ Last revision: 2026-10-18 — Worker baixa para disco por stream com memória limitada; subprocessos sem shell… | | | | | | |
| phase-03-videos/TD-05 | phase | Backend | Entrega confiável, idempotência e ciclo de status | decided | A | bullmq |
|     └─ Last revision: 2026-10-18 — Confirmar estado e outbox na mesma transação. Enquanto processing, reconciliar … | | | | | | |
| phase-03-videos/TD-06 | phase | Backend | URL única, streaming e download | decided | A | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
|     └─ Last revision: 2026-10-18 — Rascunhos e controles de upload são exclusivos do dono. Slug aleatório de 24 ca… | | | | | | |
| phase-03-videos/TD-07 | phase | Backend | Estratégia de prova funcional e infraestrutura real | decided | A | — |
|     └─ Last revision: 2026-10-18 — O requisito de prompt.md prevalece sobre filesystem local do guia herdado. Usar… | | | | | | |
| openapi-docs-nestjs/TD-01 | correlated | Backend | OpenAPI tooling | decided | A | @nestjs/swagger |
| openapi-docs-nestjs/TD-02 | correlated | Cross-layer | Swagger UI e export da spec | decided | C | — |
| openapi-docs-nestjs/TD-03 | correlated | Backend | Exposição da UI Swagger | decided | B | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3]).
- openapi-docs-nestjs — `docs/decisions/technical-decisions-openapi-docs-nestjs.md` (correlacionado confirmado pelo usuário).

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|---|---|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-07 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-05, phase-03-videos/TD-07 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-07 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-05 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06, phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06, phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ/Redis se encaixa no worker Node/NestJS. Usar Redis persistente e garantir idempotência no domínio; a entrega não deve ser descrita como processamento exatamente uma vez. Referências [R1], [R2], [R3].
**Libraries:** @nestjs/bullmq, bullmq

**Revisions:**
- 2026-10-18 — Queue `video-processing`; job `process-video`; payload `{ schemaVersion: 1, videoId }`; jobId `video-<uuid>`. A integração usa @nestjs/bullmq 11.0.5 e BullMQ 5.81.5, ainda a instalar. Redis com AOF e noeviction. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

### phase-03-videos/TD-02

**Recommendation:** persistir o rascunho antes de emitir permissões de upload; autorizar por usuário/canal, renovar URLs e conferir o upload no storage ao concluir. O limite em bytes e a recuperação de conclusão repetida devem ser contratos explícitos, não apenas validação de um número enviado pelo cliente. Referências [R4], [R5].
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-18 — Defaults operacionais definidos no planejamento, não números ditados pelo enunciado: máximo 10GB decimal (10_000_000_000 bytes), parte de 64MiB, sessão de 24h e URL assinada de até 15min, limitada pela sessão. Conferir ListParts e HeadObject reais antes de processar; recuperar S3 concluído sem commit no banco. Controle JWT por dono do canal, sem aceitar channelId ou chave de objeto do cliente. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

### phase-03-videos/TD-03

**Recommendation:** bucket privado, chaves sem nome de arquivo do usuário, uploads incompletos com descarte definido e objetos finais tratados como imutáveis. URLs assinadas de gravação não devem permitir alterar a mídia de um vídeo já processado. Distinguir endpoint interno do Compose e endpoint acessível ao consumidor externo ao assinar URLs. Referências [R4], [R6].
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-18 — Chaves `videos/<uuid>/source` e `videos/<uuid>/thumbnail.jpg`. Nunca expor objetos em draft, processing ou error por rotas públicas. Credenciais e endpoints internos por nomes Compose; endpoint de assinatura externo separado para o consumidor. Abortar uploads vencidos e reconciliar objetos órfãos sem apagar vídeos prontos. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

### phase-03-videos/TD-04

**Recommendation:** worker separado e sem listener HTTP, com concorrência limitada; `ffprobe` para dados reais e FFmpeg para o frame, sem carregar o vídeo inteiro na memória. Definir formatos/codecs aceitos no planejamento: Range permite transferência parcial, mas não transforma um codec incompatível em mídia reproduzível. Não ampliar a fase para HLS/adaptive bitrate ou transcodificação genérica sem justificativa de escopo. Referências [R7], [R8].
**Libraries:** @nestjs/bullmq, bullmq

**Revisions:**
- 2026-10-18 — Worker baixa para disco por stream com memória limitada; subprocessos sem shell, tempo/saída/concorrência limitados e limpeza finally. ffprobe valida duração finita e stream de vídeo; FFmpeg gera JPEG. Contrato inicial de reprodução progressiva: MP4 com H.264 e áudio AAC opcional, com preparação faststart por remux sem recodificar; conteúdo inválido ou codec fora desse contrato termina em error. O original permanece para download e um objeto `videos/<uuid>/playback.mp4` permite reprodução sem baixar o arquivo inteiro, inclusive quando moov fica no final. Esta é uma delimitação operacional do processamento mínimo e não adiciona HLS ou transcodificação genérica. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

### phase-03-videos/TD-05

**Recommendation:** `draft → processing → ready|error`, mantendo `processing` durante tentativas transitórias e `error` em conteúdo inválido ou esgotamento de tentativas. Persistir falha verificável sem expor detalhes sensíveis; preservar identidade do vídeo ao repetir conclusão/jobs. O plano deve cobrir também a janela S3-concluído/DB-não-atualizado. Referências [R1], [R2]; a escolha da outbox é uma inferência arquitetural para fechar essa janela de consistência, não uma capacidade nova do enunciado.
**Libraries:** bullmq

**Revisions:**
- 2026-10-18 — Confirmar estado e outbox na mesma transação. Enquanto processing, reconciliar também jobs ausentes após perda do Redis e falhas antes/depois de persistir resultado. Identidade e chaves estáveis, tentativa condicional e lease no banco evitam efeitos concorrentes; o terminal ready exige metadados e ambos os derivados presentes. Defaults operacionais: três tentativas, backoff exponencial iniciado em 2s, concorrência 1; preservar limite de tentativas no banco mesmo se Redis perder dados. Abort/expiração de draft terminam em error com código próprio. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

### phase-03-videos/TD-06

**Recommendation:** identificador aleatório com restrição única e retry de colisão, separado da chave do storage. Entregar mídia somente no estado `ready`; preservar leitura parcial no destino e usar `Content-Disposition: attachment` para download. A matriz de autorização deve decidir se leitura pronta é anônima via URL ou restrita ao dono até a Fase 04; o campo não pode ficar implícito. Referências [R5], [R9].
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-18 — Rascunhos e controles de upload são exclusivos do dono. Slug aleatório de 24 caracteres hexadecimais com UNIQUE e retry de colisão usando savepoint quando já houver transação. Rotas públicas respondem 404 para qualquer estado diferente de ready. Resposta da API é 307; 200/206/416 e Range/Content-Range pertencem ao storage de destino, comprovados em teste real. Stream usa playback.mp4 com inline; download usa original com attachment; thumbnail usa JPEG. Sem fluxo de publicação/visibilidade da Fase 04. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

### phase-03-videos/TD-07

**Recommendation:** mocks somente nas unidades; recursos reais nos níveis de integração/e2e, com migrations e execução serial do banco. Separar validação do limite de uma transferência efetiva de 10GB: testar apenas o número declarado não prova a capacidade. Registrar o que foi realmente executado e sua evidência. O requisito específico de `prompt.md` prevalece sobre a recomendação herdada de filesystem local.
**Libraries:** —

**Revisions:**
- 2026-10-18 — O requisito de prompt.md prevalece sobre filesystem local do guia herdado. Usar migrations, sem synchronize, e testes seriais; worker de teste separado da fila de desenvolvimento. SI-03.1 corrige antes da feature o conflito Jest, o teste de migrations e o lint da base (evidence/baseline-results.json); nenhum gate pode ser enfraquecido. Evidência integral de transferência 10GB é distinta de teste de fronteira do DTO. Herdar Swagger/export OpenAPI do backend, sem frontend. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

---

### openapi-docs-nestjs/TD-01

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.

**Libraries:** @nestjs/swagger

**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.


**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.


**Libraries:** —

## Inherited Conventions

- Use `@nestjs/config` with one namespaced `registerAs()` factory per domain in `src/config/`.
- Validate env with Joi in `src/config/env.validation.ts`; `ConfigModule.forRoot` uses `allowUnknown: true` and `abortEarly: false`.
- Inject config via `ConfigType<typeof xConfig>` and `@Inject(xConfig.KEY)`; keep factories callable outside DI.
- `data-source.ts` imports `dotenv/config` first, then calls the shared `databaseConfig` factory.
- Keep DB connection settings solely in `databaseConfig`; never duplicate them in `AppModule` or `data-source.ts`.
- Use `TypeOrmModule.forRootAsync`: `ConfigModule`, `databaseConfig.KEY`, `useFactory`, `autoLoadEntities: true`, `synchronize: false`.

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None within the nine Phase 03 capabilities; every capability is backend scope. Historical frontend deferrals above do not expand this phase._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---|---|
| Entity and repository | Integration: FK, uniqueness, defaults and actual queries using migrated PostgreSQL |
| Branching service | Unit with boundary doubles + integration with real dependencies |
| Configured module | DI compilation; external I/O uses integration suffix |
| Controller and DTO wiring | HTTP e2e via supertest: validation, JWT/ownership, status and documented shapes |
| Storage and queue/worker | Real MinIO, Redis and FFmpeg in integration/e2e; isolated resources |
| Streaming/download | Actual bytes, Range, Content-Range, disposition and readiness/access checks |
| Large upload | Numeric boundaries plus separately recorded real large-transfer evidence; API responsiveness and resume |
| Quality baseline | Resolve competing Jest configs and migration deadlock; fix lint without disabling checks |

**Mandatory user override:** prompt.md requires S3-compatible MinIO in development/integration, overriding the inherited testing guide recommendation of a local filesystem adapter. Migrations are the schema authority under typeorm-migrations.md; legacy synchronize-based helpers require a bounded adaptation. Resolution ICC-1: these explicit overrides govern this phase; inherited guidance is preserved as history, not applied to storage tests or schema creation.

**Execution constraints:** all backend commands in containers; serial DB tests; full relevant/full suites, tsc and lint must pass before declaring delivery. Preflight evidence reports 142/144 unit/integration tests passing, 52/52 e2e tests passing, tsc exit 0 and lint 150 errors/40 warnings. Planning clean is distinct from execution green.

## Resolution Constraints

- **User-confirmed 2026-10-18:** todas as recomendações A; qualquer pessoa com a URL acessa vídeos ready; rascunhos e controles de upload continuam exclusivos do dono. Somente OpenAPI do backend é herdado (Swagger + exportação da spec); frontend fora do escopo.
- **DG-1 — planned prerequisite:** SI-03.1 deve consolidar Jest preservando a seleção de integração, isolar/serializar o teste de migrations, corrigir o lint real e reclassificar testes com I/O. Usar banco de teste dedicado migrado, sem synchronize, com teardown ordenado. A feature só começa após esse gate verde. São correções delimitadas para viabilizar a Definition of Done exigida pelo prompt, sem refatorar outros domínios.
- **ICC-1:** requisitos explícitos de prompt.md e migration rules prevalecem sobre filesystem/synchronize do guia herdado. Testes reais usam MinIO, Redis e worker isolados por recursos; mocks ficam nas unidades.
- **Operational provenance:** defaults e delimitação MP4/H.264/AAC, remux faststart, limites de recursos e contratos detalhados derivam de TD-02/04/05/06 e serão especificados no plano; não são requisitos textuais impostos pelo usuário. Remux mínimo torna verificável o início da reprodução antes do download completo.
- **Process:** validation clean significa ausência de pendências de planejamento. A base medida continua com falhas até execução comprovada de SI-03.1. Não iniciar implementação antes do plano completo e dos checkpoints das skills.
