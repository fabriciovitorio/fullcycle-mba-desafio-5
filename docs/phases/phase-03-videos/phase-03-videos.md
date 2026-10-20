---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: '2026-10-18T16:01:18.994671444+00:00'
  docs/phases/phase-03-videos/validation.md: '2026-10-18T16:03:41.700887039+00:00'
  docs/phases/phase-03-videos/library-refs.md: '2026-10-18T16:19:38.600004542+00:00'
  docs/project-plan.md: '2026-10-04T23:48:23.734406929+00:00'
  docs/decisions/technical-decisions-phase-03-videos.md: '2026-10-18T15:21:27.234386417+00:00'
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: '2026-10-04T23:48:24.088685201+00:00'
  docs/phases/phase-01-configuracao-base/context.md: '2026-10-18T01:51:38.793392560+00:00'
  docs/phases/phase-02-auth/context.md: '2026-10-04T23:48:25.138369966+00:00'
  docs/phases/phase-02-auth-frontend/context.md: '2026-10-18T01:51:38.793548738+00:00'
  .agents/skills/testing-guide-nestjs-project/SKILL.md: '2026-10-05T00:24:50.699526553+00:00'
  docs/phases/phase-03-videos/analysis.md: '2026-10-18T15:07:35.419996134+00:00'
  docs/phases/phase-03-videos/evidence/baseline-results.json: '2026-10-18T15:07:35.413720710+00:00'
  prompt.md: '2026-10-18T01:52:49.294914608+00:00'
  AGENTS.md: '2026-10-18T01:51:38.773376566+00:00'
  nestjs-project/AGENTS.md: '2026-10-05T00:24:50.969737297+00:00'
---

# Fase 03 — Upload e Processamento de Vídeos

## Objective

Entregar no backend armazenamento S3/MinIO, upload multipart retomável de até 10GB com rascunho automático, processamento em fila por worker separado, metadados/thumbnail, URL única, reprodução progressiva e download, preservando os padrões das Fases 01–02 e a Definition of Done.

---

## Step Implementations

### SI-03.1.1 — Consolidar Jest e isolar o banco de testes (auto-split from SI-03.1 by $plan-build)

_Auto-split rationale: original: 13 arquivos de teste impactados; separação por infraestrutura e grupos funcionais mantém cada SI em até 5 arquivos._

**Description:** Remover os bloqueios de descoberta e migrations sem perder cobertura da base.

**Technical actions:**

1. Consolidar a configuração Jest em `nestjs-project/package.json`, preservando dotenv/config, ts-jest e seleção spec/integration-spec; retirar a configuração concorrente e manter E2E separado (per `phase-03-videos/TD-07`).
2. Adaptar `src/test/create-test-data-source.ts` e setup E2E para banco de teste dedicado no serviço db, imports explícitos de entidades/migrations, synchronize:false e cleanup em ordem de FK, sem alterar o banco de desenvolvimento.
3. Corrigir `src/database/migrations.integration-spec.ts` com schema exclusivo, DDL ordenada e restauração final; reclassificar auth/channels/users.module.spec.ts com I/O para integration-spec, preservando seus asserts.
4. Executar os testes afetados e a descoberta completa no container; guardar resultados reais em progress.md, sem atribuir verde ao lint global antes de SI-03.1.3.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Migrations | Integration: isolamento, aplicação e restauração real | `nestjs-project/src/database/migrations.integration-spec.ts` |
| AuthModule | Integration: DI e schema migrado | `nestjs-project/src/auth/auth.module.integration-spec.ts` |
| ChannelsModule | Integration: DI e schema migrado | `nestjs-project/src/channels/channels.module.integration-spec.ts` |
| UsersModule | Integration: DI e schema migrado | `nestjs-project/src/users/users.module.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `npm test -- --runInBand` descobre unitários e integração sem erro de configurações múltiplas.
- A execução de migrations em schema isolado deixa o schema operacional íntegro ao terminar, inclusive após falha.
- Testes de autenticação e canais usam banco dedicado e não apagam dados do banco de desenvolvimento.

---

### SI-03.1.2 — Corrigir tipagem dos testes de autenticação e serviços (auto-split from SI-03.1 by $plan-build)

_Auto-split rationale: original: 13 arquivos de teste impactados; separação por domínio de autenticação/usuários/e-mail._

**Description:** Eliminar erros de qualidade do primeiro grupo preservando o comportamento já coberto.

**Technical actions:**

1. Corrigir unsafe any e mocks assíncronos de `auth.service.spec.ts` e `auth.service.integration-spec.ts`, sem mudar regras de tokens ou desligar lint (per `phase-03-videos/TD-07`; Note de `phase-02-auth/TD-02`).
2. Corrigir tipos/mocks em `users.service.integration-spec.ts` e `mail.service.integration-spec.ts`, mantendo I/O real e as verificações existentes.
3. Rodar os quatro arquivos, tsc e lint dirigido no container; registrar contagens e falhas reais.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| AuthService | Unit: branches e mocks tipados | `nestjs-project/src/auth/auth.service.spec.ts` |
| AuthService | Integration: tokens e transações | `nestjs-project/src/auth/auth.service.integration-spec.ts` |
| UsersService | Integration: consultas existentes | `nestjs-project/src/users/users.service.integration-spec.ts` |
| MailService | Integration: SMTP real | `nestjs-project/src/mail/mail.service.integration-spec.ts` |

**Dependencies:** SI-03.1.1

**Acceptance criteria:**

- Cadastro, login, rotação e revogação de tokens mantêm os resultados observáveis anteriores.
- O envio de e-mail continua sendo capturado no Mailpit.
- O lint dirigido ao grupo encerra sem erros e os quatro arquivos mantêm os cenários existentes.

---

### SI-03.1.3 — Fechar o gate de qualidade da base (auto-split from SI-03.1 by $plan-build)

_Auto-split rationale: original: 13 arquivos de teste impactados; separação do grupo filtros/configuração/canais/HTTP._

**Description:** Concluir o pré-requisito obrigatório antes de começar storage, fila ou vídeos.

**Technical actions:**

1. Corrigir tipos e mocks em domain-exception.filter.spec.ts, validation-exception.filter.spec.ts e env.validation.integration-spec.ts, preservando o envelope e as validações (per `phase-03-videos/TD-07`; `phase-02-auth/TD-07`).
2. Corrigir o lint em channels.service.ts/channels.service.spec.ts e test/auth.e2e-spec.ts sem refatorar regras alheias ao gate.
3. Executar no container npm test serial, test:e2e serial, tsc --noEmit e npm run lint; sanar as causas remanescentes do baseline sem excluir testes nem enfraquecer regras.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| DomainExceptionFilter | Unit: envelope herdado | `nestjs-project/src/common/filters/domain-exception.filter.spec.ts` |
| ValidationExceptionFilter | Unit: erros de entrada | `nestjs-project/src/common/filters/validation-exception.filter.spec.ts` |
| Env validation | Integration: configuração real | `nestjs-project/src/config/env.validation.integration-spec.ts` |
| ChannelsService | Unit: branches existentes | `nestjs-project/src/channels/channels.service.spec.ts` |
| Auth HTTP | E2E: regressão da base | `nestjs-project/test/auth.e2e-spec.ts` |

**Dependencies:** SI-03.1.2

**Acceptance criteria:**

- A suíte completa unit/integration e a suíte E2E da base encerram com exit 0.
- `npx tsc --noEmit` e `npm run lint` encerram com exit 0.
- Os códigos e formatos dos erros de auth/canais permanecem os mesmos.

---

### SI-03.2.1 — Infra: fixar bibliotecas e configuração de vídeos (auto-split from SI-03.2 by $plan-build)

_Auto-split rationale: original: infraestrutura e comportamento de configuração excederiam 5 ações juntos; separação infraestrutura vs comportamento._

**Description:** Preparar dependências e factories tipadas com os alvos documentados.

**Technical actions:**

1. Instalar no container com versões exatas @nestjs/bullmq@11.0.5, bullmq@5.81.5, @aws-sdk/client-s3@3.1152.0 e @aws-sdk/s3-request-presigner@3.1152.0; revisar lockfile/peers conforme library-refs.md (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-04`, `phase-03-videos/TD-06`).
2. Criar factories storage/queue/videos e constantes do contrato em src/config/ e src/videos/, carregadas pela configuração global sem registrar consumidor na API (per `phase-01-configuracao-base/TD-01`, `phase-01-configuracao-base/TD-03`).
3. Ampliar Joi e .env.example para os endpoints, bucket, fila, TTLs e limites definidos em § Events/Messages; preservar DB_HOST=db e REDIS_HOST=redis.
4. Conferir os tipos das versões instaladas contra o cache, documentar divergência real antes de usar API nova e validar configuração, tsc e lint.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Storage config | Unit: defaults e endpoint de assinatura | `nestjs-project/src/config/storage.config.spec.ts` |
| Queue/videos config | Unit: TTLs e limites operacionais | `nestjs-project/src/config/videos.config.spec.ts` |
| Env validation | Integration: env inválido falha no bootstrap | `nestjs-project/src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-03.1.3

**Acceptance criteria:**

- Configuração ausente/inválida falha no startup com mensagem identificável, sem imprimir credenciais.
- O limite público permanece 10_000_000_000 bytes mesmo com configuração operacional alterada.
- O lockfile resolve os quatro alvos documentados com peers compatíveis com Nest 11.

---

### SI-03.2.2 — Infra: disponibilizar MinIO, Redis e ferramentas de mídia (auto-split from SI-03.2 by $plan-build)

_Auto-split rationale: original: infraestrutura e configuração juntas excederiam 5 ações; separação infraestrutura vs comportamento._

**Description:** Subir dependências reais e preparar a imagem do worker sem ligar o servidor HTTP.

**Technical actions:**

1. Acrescentar minio, minio-init e redis ao compose.yaml, com volumes, healthchecks, AOF/noeviction e bucket privado idempotente com CORS conforme § Events/Messages (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, `phase-03-videos/TD-07`).
2. Preparar Dockerfile.worker com FFmpeg/ffprobe, usuário não root e disco temporário; incluir os binários também na imagem dev como ferramentas da suíte, mantendo processamento de produção exclusivo do worker.
3. Preparar `compose.test.yaml`, perfil test e `.env.test.example` sem segredos; manter `.env.test` ignorado, fixar banco/bucket/fila dedicados e aplicar migrations no setup com proteção contra banco de desenvolvimento. Ativar video-worker-test em SI-03.7.3 quando sua entrada existir.
4. Fixar imagens disponíveis e registrar digests/versões reais, readiness, acesso não assinado negado e persistência após restart; usar apenas DNS Compose entre containers.

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.2.1

**Acceptance criteria:**

- PostgreSQL, Mailpit, MinIO e Redis aceitam conexões após o setup de infraestrutura.
- O bucket rejeita leitura anônima de objeto conhecido sem assinatura e o init pode ser repetido.
- Reiniciar os serviços preserva objetos e dados persistentes da fila.
- ffmpeg e ffprobe respondem na imagem preparada; nenhum servidor HTTP é ligado pelo setup de infraestrutura.

---

### SI-03.3.1 — Persistir vídeos, outbox e relações com canais (auto-split from SI-03.3 by $plan-build)

_Auto-split rationale: original: modelo, migration e consultas complexas excederiam 5 ações; separação por tipo de artefato._

**Description:** Criar o schema migrado que sustenta rascunhos, estados e intenção de processamento.

**Technical actions:**

1. Criar Video e VideoProcessingOutbox com campos, constraints, índices, bigint seguro e timestamps byte a byte conforme § Data Model (per `phase-03-videos/TD-02`, `phase-03-videos/TD-05`, `phase-03-videos/TD-06`).
2. Adicionar as duas relações inversas em Channel/Video e Video/outbox e registrar entidades em VideosPersistenceModule; adaptar listas explícitas e cleanup do helper sem copiar configuração de banco.
3. Gerar `<timestamp>-CreateVideos.ts` pela CLI do container, revisar o diff e provar up/down/reaplicação em schema isolado sem editar as migrations existentes.
4. Validar FK, unicidade de slug/source_key/video_id, defaults, CHECKs e select:false de upload_id no banco real.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Video | Integration: FK, UNIQUE, defaults e estados | `nestjs-project/src/videos/entities/video.entity.integration-spec.ts` |
| VideoProcessingOutbox | Integration: unicidade e vínculo | `nestjs-project/src/videos/entities/video-processing-outbox.entity.integration-spec.ts` |
| Migration | Integration: schema vazio e rollback | `nestjs-project/src/database/migrations.integration-spec.ts` |
| VideosPersistenceModule | Integration: DI e registro de entidades | `nestjs-project/src/videos/videos-persistence.module.integration-spec.ts` |

**Dependencies:** SI-03.2.2

**Acceptance criteria:**

- Um vídeo sem canal existente é rejeitado e dois vídeos não podem compartilhar slug/source_key.
- Um novo registro começa draft e um vídeo não aceita duas intenções de processamento.
- ready sem metadados e derivados, ou error sem código, é rejeitado pelas invariantes persistidas.
- Aplicar/reverter a nova migration preserva as tabelas e migrations anteriores.

---

### SI-03.3.2 — Implementar repositórios e transições condicionais (auto-split from SI-03.3 by $plan-build)

_Auto-split rationale: original: modelo, migration e consultas complexas excederiam 5 ações; separação por tipo de artefato._

**Description:** Encapsular consultas, autorização de propriedade e transações recuperáveis.

**Technical actions:**

1. Criar VideosRepository e VideoProcessingOutboxRepository para as consultas de dono/slug, claims de upload/despacho/processamento e finalização com token conforme § Data Model (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`).
2. Implementar transação draft→processing + única outbox, compare-and-set e orçamento persistente de tentativas; usar o mesmo manager e IsNull onde necessário.
3. Implementar geração de slug com UNIQUE e retry limitado usando savepoints, traduzindo esgotamento para VIDEO_ID_GENERATION_FAILED; não corrigir colisões de outros domínios nesta tarefa.
4. Verificar rollback, concorrência, isolamento entre canais, claim expirado e tentativa vencida contra PostgreSQL real.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideosRepository | Integration: propriedade, estados e colisão real | `nestjs-project/src/videos/videos.repository.integration-spec.ts` |
| OutboxRepository | Integration: atomicidade, claims e concorrência | `nestjs-project/src/videos/video-processing-outbox.repository.integration-spec.ts` |

**Dependencies:** SI-03.3.1

**Acceptance criteria:**

- Falhar a transação não deixa processing sem outbox nem outbox de rascunho não concluído.
- Dois claims concorrentes têm um único vencedor; token vencido não finaliza o vídeo.
- Colisão de slug produz outra identidade sem deixar a transação PostgreSQL abortada.
- Consulta privada por outro canal não retorna o vídeo.

---

### SI-03.4.1 — Implementar controle multipart no adaptador S3 (auto-split from SI-03.4 by $plan-build)

_Auto-split rationale: original: controles multipart, assinatura e I/O de arquivos excederiam 5 ações; separação por fronteira funcional._

**Description:** Oferecer operações reais de sessão sem fazer o binário atravessar a API.

**Technical actions:**

1. Criar StorageModule, token/interface e adaptador S3Client para create/list/complete/abort/head, mantendo SDK fora do domínio (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`).
2. Implementar ListParts paginado, ContentLength/ETag autoritativos e mapeamento tipado de NoSuchUpload, ausência e indisponibilidade.
3. Configurar endpoint interno, forcePathStyle e checksum explicitamente conforme cache; operações com timeout e erros propagados, sem log de credenciais.
4. Exercitar sessão real no bucket de teste, inclusive mais de uma página, conclusão repetida recuperável e abort.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| S3 multipart adapter | Unit: tradução de falhas e paginação | `nestjs-project/src/storage/s3-storage.service.spec.ts` |
| S3 multipart adapter | Integration: MinIO real e bytes | `nestjs-project/src/storage/s3-storage.service.integration-spec.ts` |

**Dependencies:** SI-03.3.2

**Acceptance criteria:**

- As partes listadas e os bytes do objeto concluído correspondem ao que foi enviado ao MinIO.
- Abortar remove a sessão e impede novos UploadPart com seu identificador.
- Indisponibilidade do storage é distinguida de objeto/sessão ausente e chega ao chamador.

---

### SI-03.4.2 — Assinar acesso e transferir arquivos com memória limitada (auto-split from SI-03.4 by $plan-build)

_Auto-split rationale: original: controles multipart, assinatura e I/O de arquivos excederiam 5 ações; separação por fronteira funcional._

**Description:** Completar a fronteira S3 para partes do cliente e derivados grandes do worker.

**Technical actions:**

1. Implementar getSignedUrl de UploadPart com tamanho esperado e TTL limitado à sessão, usando cliente de assinatura externo separado (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-06`).
2. Implementar GET assinado de original/playback/thumbnail com ResponseContentDisposition e sem fixar Range, conforme § API Contracts.
3. Implementar download por pipeline para disco e envio de arquivo por multipart limitado; JPEG pequeno pode usar PutObject, mas playback maior que 5GiB não.
4. Implementar cancelamento/abort/cleanup dos streams e validar DI do StorageModule com configuração real e bucket dedicado.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Storage signing | Integration: PUT assinado, tamanho, TTL e disposição | `nestjs-project/src/storage/storage-signing.integration-spec.ts` |
| Storage file transfer | Integration: streams, multipart derivado e cancelamento | `nestjs-project/src/storage/storage-file-transfer.integration-spec.ts` |
| StorageModule | Integration: DI real e endpoints distintos | `nestjs-project/src/storage/storage.module.integration-spec.ts` |

**Dependencies:** SI-03.4.1

**Acceptance criteria:**

- Uma parte enviada diretamente pela URL válida pode ser listada; parte divergente não autoriza conclusão.
- URLs geradas usam a origem do consumidor e expiram no máximo no prazo da sessão.
- GET assinado preserva Range no destino e distingue inline de attachment.
- Cancelamento de transferência não deixa stream aberto nem multipart derivado ativo sem recuperação.

---

### SI-03.5.1 — Criar rascunhos e preparar a retomada (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por serviço e caso de uso HTTP._

**Description:** Implementar o domínio de inicialização, consulta da sessão e permissão de partes.

**Technical actions:**

1. Implementar VideoUploadsService com consulta de canal por JWT.sub através de ChannelsService, criação de draft e identidade antes de permissões S3 (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`).
2. Persistir upload_id/prazo após CreateMultipartUpload e compensar falha de inicialização; manter operações incompletas reconhecíveis pelo reconciliador.
3. Implementar retomada via ListParts e assinatura em lotes de 1–50 partes com tamanho/prazo do contrato; validar propriedade, estado e expiração antes de usar storage.
4. Definir exceções de domínio conforme § Error Catalog e resultado tipado sem entidades/keys; separar mapeamento do domínio do DTO HTTP.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideoUploadsService | Unit: rascunho antecipado, limites e propriedade | `nestjs-project/src/videos/video-uploads.service.spec.ts` |
| VideoUploadsService | Integration: DB e MinIO, inicialização/retomada reais | `nestjs-project/src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.4.2

**Acceptance criteria:**

- Existe rascunho persistido antes de qualquer permissão de upload ser emitida.
- Retomar uma sessão devolve partes já recebidas e conserva id/slug.
- Outro canal não obtém sessão nem permissões de partes.
- Sessão vencida ou em estado incompatível não recebe novas assinaturas.

---

### SI-03.5.2 — Concluir ou abortar uploads sem perder processamento (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por serviço e caso de uso HTTP._

**Description:** Fechar a fronteira S3/banco e expor consulta privada de estado.

**Technical actions:**

1. Implementar completion no serviço com claim exclusivo, ListParts autoritativo e validação de quantidade/ordem/tamanhos; CompleteMultipartUpload e HeadObject fora de transação longa (per `phase-03-videos/TD-02`, `phase-03-videos/TD-05`).
2. Finalizar por transação com token vigente, actual_size_bytes, processing e única outbox; recuperar objeto S3 já concluído quando o commit anterior falhou.
3. Implementar abort idempotente de draft, excluindo corrida com completion e persistindo UPLOAD_ABORTED; conferir objeto concluído antes de tratar sessão como perdida.
4. Implementar consulta de status do dono e mapeamento seguro de errorCode, preservando estado em replays e rejeitando operações incompatíveis conforme § API Contracts.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Completion/abort | Unit: replay, tamanho divergente e falhas | `nestjs-project/src/videos/video-upload-completion.service.spec.ts` |
| Completion/abort | Integration: transação/outbox, concorrência e recuperação | `nestjs-project/src/videos/video-upload-completion.service.integration-spec.ts` |

**Dependencies:** SI-03.5.1

**Acceptance criteria:**

- Concluir objeto válido deixa processing e uma única intenção persistida.
- Repetir completion em processing/ready preserva identidade e não duplica outbox.
- Objeto concluído antes de falha do banco é recuperado sem reenviar partes.
- Upload incompleto ou com tamanho divergente nunca entra na fila.
- Abort repetido conserva UPLOAD_ABORTED; abort e completion concorrentes não confirmam resultados incompatíveis.

---

### SI-03.5.3 — Iniciar upload por HTTP (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Criar a fronteira de entrada para rascunho e sessão direta.

**Route:** POST /videos/uploads
**Test Specs:** see `nestjs-project/specs/videos-uploads-create.plan.md`
**Authorization:** JWT obrigatório; somente o dono do canal; outro canal recebe 404.

**Technical actions:**

1. Adicionar o handler a VideosUploadsController com JWT global, CurrentUser e ApiBearerAuth; seguir § Authorization Matrix e `phase-03-videos/TD-02`, `phase-03-videos/TD-06`. Validar `{ title, fileName, contentType, sizeBytes }` com as restrições exatas de § API Contracts e delegar ao serviço, sem multipart/form-data.
2. Responder 201 com `{ video: VideoStatusDto, upload: { partSizeBytes, partCount, expiresAt } }` e documentar 400/401/404/429/503 com o envelope herdado. Reutilizar ApiErrorEnvelope e a exportação existente (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite por rota conforme § Validation Rules e preparar o fixture HTTP real para a spec externa; não criar unitário de controller.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideosModule | Integration: DI real e configuração global | `nestjs-project/src/videos/videos.module.integration-spec.ts` |

**Dependencies:** SI-03.5.1

**Acceptance criteria:**

- POST /videos/uploads válido retorna 201 com vídeo draft, partSizeBytes 67108864 e prazo da sessão.
- sizeBytes acima de 10_000_000_000 ou campo channelId retorna 400 VALIDATION_ERROR.
- Sem JWT retorna 401; o canal usado pertence ao sub autenticado.

---

### SI-03.5.4 — Retomar upload por HTTP (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Disponibilizar as partes reais da sessão ao seu dono.

**Route:** GET /videos/:id/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-resume.plan.md`
**Authorization:** JWT obrigatório; somente o dono do canal; outro canal recebe 404.

**Technical actions:**

1. Adicionar o handler a VideosUploadsController com JWT global, CurrentUser e ApiBearerAuth; seguir § Authorization Matrix e `phase-03-videos/TD-02`, `phase-03-videos/TD-06`. Validar id UUID e delegar consulta privada da sessão, sem aceitar upload_id do chamador.
2. Responder 200 com video e upload.parts de `{ partNumber, sizeBytes, etag }`; documentar 400/401/404/409/410/429/503. Reutilizar ApiErrorEnvelope e a exportação existente (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite por rota conforme § Validation Rules e preparar o fixture HTTP real para a spec externa; não criar unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.5.1 + SI-03.5.3

**Acceptance criteria:**

- GET /videos/:id/upload do dono retorna 200 com as partes realmente presentes no storage.
- Outro canal recebe 404 VIDEO_NOT_FOUND e sem JWT recebe 401.
- Sessão vencida sem objeto concluído recuperável retorna 410 UPLOAD_EXPIRED.

---

### SI-03.5.5 — Emitir permissões de partes por HTTP (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Permitir upload direto com validação de sessão e limites.

**Route:** POST /videos/:id/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-upload-parts.plan.md`
**Authorization:** JWT obrigatório; somente o dono do canal; outro canal recebe 404.

**Technical actions:**

1. Adicionar o handler a VideosUploadsController com JWT global, CurrentUser e ApiBearerAuth; seguir § Authorization Matrix e `phase-03-videos/TD-02`, `phase-03-videos/TD-06`. Validar id UUID e `{ partNumbers }` único, com 1–50 elementos dentro de partCount; delegar assinatura ao serviço.
2. Responder 200 com `{ parts: [{ partNumber, url, expiresAt, headers: { 'Content-Length': string } }] }`; documentar 400/401/404/409/410/429/503. Reutilizar ApiErrorEnvelope e a exportação existente (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite por rota conforme § Validation Rules e preparar o fixture HTTP real para a spec externa; não criar unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.5.1 + SI-03.5.3

**Acceptance criteria:**

- POST /videos/:id/upload/parts válido retorna 200 com URLs para as partes solicitadas.
- Duplicatas, lote maior que 50 ou número fora de partCount retorna 400 VALIDATION_ERROR.
- Outro canal não recebe URLs e sessão bloqueada não permite nova assinatura.

---

### SI-03.5.6 — Confirmar conclusão por HTTP (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Expor conclusão idempotente e aceitação assíncrona.

**Route:** POST /videos/:id/upload/completion
**Test Specs:** see `nestjs-project/specs/videos-upload-completion.plan.md`
**Authorization:** JWT obrigatório; somente o dono do canal; outro canal recebe 404.

**Technical actions:**

1. Adicionar o handler a VideosUploadsController com JWT global, CurrentUser e ApiBearerAuth; seguir § Authorization Matrix e `phase-03-videos/TD-02`, `phase-03-videos/TD-06`. Validar id UUID e corpo ausente; delegar a conclusão sem receber tamanhos/ETags do cliente como autoridade.
2. Mapear o resultado tipado para 202 processing ou 200 ready; documentar os dois sucessos e 400/401/404/409/410/429/503. Reutilizar ApiErrorEnvelope e a exportação existente (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite por rota conforme § Validation Rules e preparar o fixture HTTP real para a spec externa; não criar unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.5.2 + SI-03.5.3

**Acceptance criteria:**

- POST /videos/:id/upload/completion retorna 202 com status processing para upload válido.
- Replay após ready retorna 200 com a mesma identidade.
- Parte ausente retorna 409 UPLOAD_INCOMPLETE e tamanho divergente retorna 409 UPLOAD_SIZE_MISMATCH.

---

### SI-03.5.7 — Abortar sessão por HTTP (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Permitir cancelar upload sem implementar exclusão de vídeo da Fase 04.

**Route:** DELETE /videos/:id/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-abort.plan.md`
**Authorization:** JWT obrigatório; somente o dono do canal; outro canal recebe 404.

**Technical actions:**

1. Adicionar o handler a VideosUploadsController com JWT global, CurrentUser e ApiBearerAuth; seguir § Authorization Matrix e `phase-03-videos/TD-02`, `phase-03-videos/TD-06`. Validar id UUID e delegar abort ao serviço, preservando status terminal e propriedade.
2. Responder 204 sem schema/corpo; documentar 400/401/404/409/429/503 e o mesmo 204 para abort repetido. Reutilizar ApiErrorEnvelope e a exportação existente (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite por rota conforme § Validation Rules e preparar o fixture HTTP real para a spec externa; não criar unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.5.2 + SI-03.5.3

**Acceptance criteria:**

- DELETE /videos/:id/upload draft do dono retorna 204 e status privado passa a error com UPLOAD_ABORTED.
- Repetir o mesmo abort retorna 204 sem corpo.
- Vídeo em processing/ready retorna 409 INVALID_VIDEO_STATE; outro canal retorna 404.

---

### SI-03.5.8 — Consultar estado privado por HTTP (auto-split from SI-03.5 by $plan-build)

_Auto-split rationale: original: serviços e seis rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Dar ao dono acompanhamento de processamento e erro seguro.

**Route:** GET /videos/:id/status
**Test Specs:** see `nestjs-project/specs/videos-status.plan.md`
**Authorization:** JWT obrigatório; somente o dono do canal; outro canal recebe 404.

**Technical actions:**

1. Adicionar o handler a VideosUploadsController com JWT global, CurrentUser e ApiBearerAuth; seguir § Authorization Matrix e `phase-03-videos/TD-02`, `phase-03-videos/TD-06`. Validar id UUID, consultar o serviço pelo dono e mapear VideoStatusDto sem chaves internas, upload_id ou stderr.
2. Responder 200 com id/slug/status/errorCode/createdAt/updatedAt e documentar 400/401/404/429. Reutilizar ApiErrorEnvelope e a exportação existente (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite por rota conforme § Validation Rules e preparar o fixture HTTP real para a spec externa; não criar unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.5.2 + SI-03.5.3

**Acceptance criteria:**

- GET /videos/:id/status do dono retorna 200 em draft, processing, ready ou error.
- errorCode é null sem falha e contém código seguro no estado error.
- Sem JWT retorna 401 e outro canal recebe 404 VIDEO_NOT_FOUND.

---

### SI-03.6.1 — Despachar a outbox para BullMQ (auto-split from SI-03.6 by $plan-build)

_Auto-split rationale: original: despacho, reconciliação e consumidor excederiam 5 ações; separação por produtor e recuperação._

**Description:** Ligar a intenção transacional à fila real de forma reexecutável.

**Technical actions:**

1. Criar módulo de fila e VideoOutboxDispatcher com timer lifecycle sem sobreposição e claims curtos com skip_locked, token e prazo (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`).
2. Publicar process-video em video-processing com payload `{ schemaVersion: 1, videoId }`, jobId video-<uuid>, três tentativas e backoff exponencial de 2s, usando BullMQ v5 conforme cache.
3. Registrar despacho somente após Queue.add e liberar/reagendar claims em falha; manter outbox aberta enquanto o vídeo não for terminal.
4. Provar Redis indisponível e crash após add/antes de commit, sem registrar consumidor na API.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| OutboxDispatcher | Unit: claims, falhas e não sobreposição | `nestjs-project/src/videos/queue/video-outbox-dispatcher.service.spec.ts` |
| OutboxDispatcher | Integration: Redis real e deduplicação | `nestjs-project/src/videos/queue/video-outbox-dispatcher.service.integration-spec.ts` |
| VideoQueueModule | Integration: DI/configuração BullMQ real | `nestjs-project/src/videos/queue/video-queue.module.integration-spec.ts` |

**Dependencies:** SI-03.5.2

**Acceptance criteria:**

- processing com outbox pendente produz job contendo somente schemaVersion e videoId.
- Redis fora não perde a intenção; ao retornar, o despacho acontece sem novo upload.
- Repetir despacho após add sem commit mantém um único jobId lógico.

---

### SI-03.6.2 — Reconciliar jobs ausentes e falhas terminais (auto-split from SI-03.6 by $plan-build)

_Auto-split rationale: original: despacho, reconciliação e consumidor excederiam 5 ações; separação por produtor e recuperação._

**Description:** Fechar as janelas de perda do Redis e de persistência do resultado.

**Technical actions:**

1. Implementar VideoProcessingReconciler para vídeos processing com outbox não concluída, comparando estado do job e estado persistido (per `phase-03-videos/TD-05`, `phase-03-videos/TD-07`).
2. Recriar job ausente respeitando processing_attempts no banco; recuperar claims/leases vencidos sem disputar tentativa ativa.
3. Tratar failed esgotado e completed sem estado terminal confirmado, persistindo resultado verificável ou nova tentativa elegível; não encerrar a intenção só por dispatched_at.
4. Manter retry/logs seguros para falhas de banco e provar perda de job e limite persistente em infraestrutura real.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| ProcessingReconciler | Unit: job ausente/failed/completed e orçamento | `nestjs-project/src/videos/queue/video-processing-reconciler.service.spec.ts` |
| ProcessingReconciler | Integration: perda de job, leases e persistência | `nestjs-project/src/videos/queue/video-processing-reconciler.service.integration-spec.ts` |

**Dependencies:** SI-03.6.1

**Acceptance criteria:**

- Apagar o job de um vídeo processing permite sua reconstrução a partir da outbox.
- Perda de jobs não reinicia o orçamento de processamento gravado no banco.
- Job terminal com banco ainda processing não deixa o vídeo abandonado indefinidamente.

---

### SI-03.7.1 — Extrair metadados e preparar mídia progressiva (auto-split from SI-03.7 by $plan-build)

_Auto-split rationale: original: mídia, processamento, bootstrap e cleanup excederiam 5 ações; separação por responsabilidade._

**Description:** Isolar ffprobe/FFmpeg em serviço de arquivos com limites explícitos.

**Technical actions:**

1. Criar VideoMediaService com spawn sem shell, caminhos próprios, -nostdin, protocolos permitidos, timeout, saída limitada e cancelamento conforme § Events/Messages (per `phase-03-videos/TD-04`).
2. Validar MP4/H.264 e AAC opcional a partir de probe real, duração finita e campos permitidos; diferenciar INVALID_VIDEO_CONTENT, UNSUPPORTED_VIDEO_FORMAT e PROCESSING_TIMEOUT.
3. Gerar playback.mp4 por remux -c copy -movflags +faststart e thumbnail.jpg de frame válido, sem recodificação/HLS.
4. Verificar espaço para original+remux e limpeza/cancelamento; usar fixtures pequenas reais nos binários instalados no container.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideoMediaService | Unit: normalização, limites e tipos desconhecidos | `nestjs-project/src/videos/processing/video-media.service.spec.ts` |
| VideoMediaService | Integration: FFmpeg/ffprobe, moov e JPEG reais | `nestjs-project/src/videos/processing/video-media.service.integration-spec.ts` |

**Dependencies:** SI-03.6.2

**Acceptance criteria:**

- MP4 válido resulta em duração/dimensões/codecs reais, JPEG decodificável e MP4 com moov antes de mdat.
- Mídia inválida ou codec fora do contrato produz código terminal definido, sem liberar ready.
- Timeout/cancelamento encerra subprocessos e não deixa temporários ativos.

---

### SI-03.7.2 — Processar vídeos com lease e finalização protegida (auto-split from SI-03.7 by $plan-build)

_Auto-split rationale: original: mídia, processamento, bootstrap e cleanup excederiam 5 ações; separação por responsabilidade._

**Description:** Coordenar storage, mídia e banco sem carregar arquivo integral na memória.

**Technical actions:**

1. Implementar VideoProcessingService com claim/processing_token, heartbeat e orçamento persistente; cancelar I/O e subprocessos se perder a lease (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`).
2. Baixar source_key por stream para diretório da tentativa, invocar VideoMediaService e enviar derivados por I/O limitado a `videos/<uuid>/attempts/<processing_token>/`.
3. Finalizar ready + metadados/keys + completed_at na mesma transação somente com token vigente; tentativa velha nunca publica ponteiros nem erro sobre a vencedora.
4. Mapear falhas transitórias para retry e terminais para error seguro; preservar original e limpar temporários/multipart derivado em finally.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideoProcessingService | Unit: fencing, tentativas e falhas | `nestjs-project/src/videos/processing/video-processing.service.spec.ts` |
| VideoProcessingService | Integration: DB/MinIO/mídia reais e token vencido | `nestjs-project/src/videos/processing/video-processing.service.integration-spec.ts` |

**Dependencies:** SI-03.7.1

**Acceptance criteria:**

- Uma tentativa bem-sucedida publica ambos os derivados e metadados antes de ready.
- Uma tentativa com token vencido não altera resultado publicado por outra.
- Erro transitório mantém processing com orçamento preservado; erro terminal persiste código seguro.
- O hash do original permanece igual após o processamento.

---

### SI-03.7.3 — Ativar o consumidor em container separado (auto-split from SI-03.7 by $plan-build)

_Auto-split rationale: original: mídia, processamento, bootstrap e cleanup excederiam 5 ações; separação por responsabilidade._

**Description:** Executar a fila por contexto Nest standalone com shutdown verificável.

**Technical actions:**

1. Criar VideoProcessingConsumer com Processor/WorkerHost, validação de nome/schemaVersion/videoId e delegação ao serviço; mapear falha terminal para UnrecoverableError após persistência (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`, `phase-03-videos/TD-05`).
2. Criar VideosWorkerModule e entrada standalone sem AppModule HTTP/AuthModule; inicializar consumidor, dispatcher/reconciliador e shutdown hooks.
3. Acrescentar video-worker ao Compose padrão com imagem, limites e schema migrado; preparar worker de teste isolado com o mesmo código e DB/bucket/fila próprios.
4. Provar execução em processo separado, SIGTERM/restart e fechamento de recursos; o processo HTTP nunca registra Processor.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideoProcessingConsumer | Unit: payload inválido e classificação de falha | `nestjs-project/src/videos/processing/video-processing.consumer.spec.ts` |
| VideosWorkerModule | Integration: bootstrap standalone, Redis e shutdown | `nestjs-project/src/videos/videos-worker.module.integration-spec.ts` |

**Dependencies:** SI-03.7.2

**Acceptance criteria:**

- Completar um upload aciona processamento pelo container video-worker sem iniciar servidor HTTP nesse container.
- O worker de desenvolvimento não consome jobs do namespace de teste.
- Encerrar e reiniciar o worker permite recuperar trabalho interrompido sem duplicar a identidade do vídeo.

---

### SI-03.7.4 — Recuperar sessões e limpar artefatos abandonados (auto-split from SI-03.7 by $plan-build)

_Auto-split rationale: original: mídia, processamento, bootstrap e cleanup excederiam 5 ações; separação por responsabilidade._

**Description:** Evitar acúmulo de partes/derivados sem apagar objetos publicados.

**Technical actions:**

1. Implementar VideoUploadReconciler para initializing/completing/aborting interrompidos, sessão vencida e janela CreateMultipartUpload sem upload_id persistido (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-05`).
2. Conferir HeadObject antes de abortar sessão aparentemente perdida, recuperando completion com objeto válido já presente.
3. Limpar multipart, temporários e derivados não referenciados após carência, consultando DB/leases e preservando objetos apontados por ready.
4. Registrar falhas recuperáveis e reagendar cleanup sem catch silencioso; ligar ciclo e shutdown no módulo worker.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| UploadReconciler | Unit: expiração, órfãos e proteção de ready | `nestjs-project/src/videos/processing/video-upload-reconciler.service.spec.ts` |
| UploadReconciler | Integration: sessões reais e objetos protegidos | `nestjs-project/src/videos/processing/video-upload-reconciler.service.integration-spec.ts` |

**Dependencies:** SI-03.7.3

**Acceptance criteria:**

- Sessão vencida sem objeto concluído termina em error com UPLOAD_EXPIRED e partes descartadas.
- Objeto concluído antes de queda do processo é aproveitado e entra em processing.
- Cleanup remove apenas artefatos elegíveis e nunca um objeto referenciado por ready.
- Falha de cleanup fica observável e a próxima execução pode repetir a operação.

---

### SI-03.8.1 — Resolver acesso público apenas para vídeos prontos (auto-split from SI-03.8 by $plan-build)

_Auto-split rationale: original: projeção pública e quatro rotas excederiam 5 ações; separação por serviço e caso de uso HTTP._

**Description:** Construir a projeção pública e as permissões temporárias de leitura.

**Technical actions:**

1. Implementar VideoDeliveryService com consulta por slug que só retorna ready e projeta metadados/URLs estáveis conforme § API Contracts (per `phase-03-videos/TD-06`).
2. Gerar GET assinado para playback_key/source_key/thumbnail_key com inline/attachment e nome seguro; a API retorna decisão de redirect sem transportar binário.
3. Mapear ausente/não pronto para VIDEO_NOT_FOUND e indisponibilidade para STORAGE_UNAVAILABLE, sem expor chaves ou diagnóstico privado.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| VideoDeliveryService | Unit: estados, projeção e nome seguro | `nestjs-project/src/videos/video-delivery.service.spec.ts` |
| VideoDeliveryService | Integration: banco e assinaturas MinIO reais | `nestjs-project/src/videos/video-delivery.service.integration-spec.ts` |

**Dependencies:** SI-03.7.4

**Acceptance criteria:**

- Somente ready fornece metadados ou permissão temporária de leitura.
- A projeção pública não contém upload_id, chaves de storage nem código privado de erro.
- O download usa o original e a reprodução usa o derivado da tentativa publicada.

---

### SI-03.8.2 — Expor metadados por URL única (auto-split from SI-03.8 by $plan-build)

_Auto-split rationale: original: projeção pública e quatro rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Disponibilizar a rota pública preservando bucket privado e verificação de estado.

**Route:** GET /videos/:slug
**Test Specs:** see `nestjs-project/specs/videos-details.plan.md`
**Authorization:** Anônimo ou autenticado; somente ready; outros estados retornam 404.

**Technical actions:**

1. Adicionar handler fino em VideosPublicController com @Public(), sem ApiBearerAuth, delegando ao serviço conforme § Authorization Matrix (per `phase-03-videos/TD-06`).
2. Responder 200 com `{ slug, title, durationSeconds, sizeBytes, metadata, streamUrl, downloadUrl, thumbnailUrl }`, copiado de § API Contracts; sizeBytes é o tamanho real do original. Documentar sucessos/erros previstos com ApiOperation/ApiResponse e envelope comum (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite público definido em § Validation Rules e preparar os cenários HTTP para a spec externa, sem unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.8.1

**Acceptance criteria:**

- GET /videos/:slug ready retorna 200 sem JWT e com URLs estáveis da API.
- Slug ausente, inválido ou não pronto retorna 404 VIDEO_NOT_FOUND.
- Resposta não inclui campos da sessão de upload.

---

### SI-03.8.3 — Redirecionar reprodução progressiva (auto-split from SI-03.8 by $plan-build)

_Auto-split rationale: original: projeção pública e quatro rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Disponibilizar a rota pública preservando bucket privado e verificação de estado.

**Route:** GET /videos/:slug/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anônimo ou autenticado; somente ready; outros estados retornam 404.

**Technical actions:**

1. Adicionar handler fino em VideosPublicController com @Public(), sem ApiBearerAuth, delegando ao serviço conforme § Authorization Matrix (per `phase-03-videos/TD-06`).
2. Responder 307 com Location assinado do playback e Cache-Control:no-store, documentando Range no destino sem declarar 206 como resposta da API. Documentar sucessos/erros previstos com ApiOperation/ApiResponse e envelope comum (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite público definido em § Validation Rules e preparar os cenários HTTP para a spec externa, sem unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.8.1 + SI-03.8.2

**Acceptance criteria:**

- GET /videos/:slug/stream ready retorna 307 sem JWT para playback.mp4 com disposição inline.
- Seguir Location com Range obtém bytes parciais e Content-Range correto no storage.
- Vídeo não pronto retorna 404 sem emitir permissão de leitura.

---

### SI-03.8.4 — Redirecionar download do original (auto-split from SI-03.8 by $plan-build)

_Auto-split rationale: original: projeção pública e quatro rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Disponibilizar a rota pública preservando bucket privado e verificação de estado.

**Route:** GET /videos/:slug/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anônimo ou autenticado; somente ready; outros estados retornam 404.

**Technical actions:**

1. Adicionar handler fino em VideosPublicController com @Public(), sem ApiBearerAuth, delegando ao serviço conforme § Authorization Matrix (per `phase-03-videos/TD-06`).
2. Responder 307 com Location assinado para original e Cache-Control:no-store, com Content-Disposition attachment e nome seguro no destino. Documentar sucessos/erros previstos com ApiOperation/ApiResponse e envelope comum (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite público definido em § Validation Rules e preparar os cenários HTTP para a spec externa, sem unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.8.1 + SI-03.8.2

**Acceptance criteria:**

- GET /videos/:slug/download ready retorna 307 sem JWT.
- O destino entrega o original com attachment e nome sem CR/LF.
- O conteúdo baixado tem o mesmo tamanho e hash do upload.

---

### SI-03.8.5 — Disponibilizar thumbnail de vídeo pronto (auto-split from SI-03.8 by $plan-build)

_Auto-split rationale: original: projeção pública e quatro rotas excederiam 5 ações; separação por caso de uso HTTP._

**Description:** Disponibilizar a rota pública preservando bucket privado e verificação de estado.

**Route:** GET /videos/:slug/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-thumbnail.plan.md`
**Authorization:** Anônimo ou autenticado; somente ready; outros estados retornam 404.

**Technical actions:**

1. Adicionar handler fino em VideosPublicController com @Public(), sem ApiBearerAuth, delegando ao serviço conforme § Authorization Matrix (per `phase-03-videos/TD-06`).
2. Responder 307 com Location do thumbnail publicado e Cache-Control:no-store; destino image/jpeg e inline. Documentar sucessos/erros previstos com ApiOperation/ApiResponse e envelope comum (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
3. Aplicar limite público definido em § Validation Rules e preparar os cenários HTTP para a spec externa, sem unitário de controller.

**Tests:** _(empty — Cenários HTTP na spec externa via $plan-test-specs; controllers não recebem unitários.)_

**Dependencies:** SI-03.8.1 + SI-03.8.2

**Acceptance criteria:**

- GET /videos/:slug/thumbnail ready retorna 307 sem JWT para JPEG decodificável.
- Thumbnail intermediário de vídeo processing não pode ser acessado pela rota pública.
- Resposta pública não expõe chave interna nem informação da sessão.

---

### SI-03.9.1 — Comprovar recuperação do fluxo com serviços reais (auto-split from SI-03.9 by $plan-build)

_Auto-split rationale: original: prova funcional de falhas e transferência de 10GB têm recursos distintos; separação por fronteira funcional._

**Description:** Exercitar a coordenação completa e falhas entre processos além dos contratos HTTP individuais.

**Technical actions:**

1. Preparar fixtures/helper de upload multipart limitado e lifecycle de worker de teste em compose.test.yaml; manter DB/bucket/fila próprios e reproduzir pipes/filtros reais da API (per `phase-03-videos/TD-07`).
2. Executar fluxo draft→processing→ready e erro de mídia, verificando metadados, MP4 progressivo, JPEG e original com hashes reais.
3. Interromper worker e simular indisponibilidade/perda de job no namespace de teste, validando recuperação, tentativas e fencing sem mockar o broker/storage.
4. Conferir leitura Range/206/416 no destino, negativa sem assinatura e proteção de draft; não duplicar os cenários de DTO/HTTP pertencentes às specs dos dez endpoints.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Fluxo entre serviços | E2E: upload→worker→mídia pronta e falha real | `nestjs-project/test/videos-processing.e2e-spec.ts` |
| Recuperação operacional | Integration: restart/perda de job e orçamento | `nestjs-project/src/videos/processing/video-processing-recovery.integration-spec.ts` |

**Dependencies:** SI-03.5.4 + SI-03.5.5 + SI-03.5.6 + SI-03.5.7 + SI-03.5.8 + SI-03.7.4 + SI-03.8.2 + SI-03.8.3 + SI-03.8.4 + SI-03.8.5

**Acceptance criteria:**

- Um upload real passa pelos estados persistidos e produz metadados, reprodução e thumbnail disponíveis.
- Parar/reiniciar o worker ou perder um job não deixa vídeo processing sem recuperação ou falha terminal verificável.
- GET parcial retorna 206 com Content-Range e range fora do objeto retorna 416 no storage.
- Objetos privados sem assinatura e vídeos ainda não prontos permanecem inacessíveis.

---

### SI-03.9.2 — Comprovar upload integral de 10GB e responsividade (auto-split from SI-03.9 by $plan-build)

_Auto-split rationale: original: prova funcional de falhas e transferência de 10GB têm recursos distintos; separação por fronteira funcional._

**Description:** Produzir evidência integral, reproduzível e mensurada do requisito de maior volume.

**Technical actions:**

1. Criar roteiro executável `nestjs-project/scripts/prove-large-video-upload.ts` e script npm `video:prove-large`, ambos executados em container, para gerar mídia MP4 válida de exatamente 10_000_000_000 bytes sem buffer integral (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, `phase-03-videos/TD-07`).
2. Validar espaço/configuração antes de transferir; abortar com saída não zero se não houver recursos, sem classificar execução abreviada como sucesso.
3. Transferir partes diretamente ao MinIO com interrupção/retomada, completar e aguardar worker, medindo sondas de controle, bytes, RSS, p50/p95, tempos e identidades.
4. Conferir playback parcial, thumbnail e hash/tamanho do download original; gravar relatório e comandos reais em evidence/large-upload-results.json e progress.md.

**Tests:** _(empty — Prova integral em container; relatório e bytes reais constituem o gate deste SI.)_

**Dependencies:** SI-03.9.1

**Acceptance criteria:**

- A execução registra transferência real de exatamente 10_000_000_000 bytes e retomada sem reiniciar as partes já confirmadas.
- Durante a transferência não há sondas perdidas/5xx e p95 atende max(1s, 2x baseline), conforme o critério operacional da especificação.
- A memória da API não cresce proporcionalmente ao arquivo e permanece dentro do limite configurado.
- O vídeo termina ready com metadados/thumbnail e permite reprodução parcial e download íntegro.
- Falta de espaço, execução parcial ou ausência de medição encerra com falha e impede declarar a fase pronta.

---

### SI-03.10 — Documentar a entrega e fechar a Definition of Done

**Description:** Atualizar a documentação de IA e conferir a fase inteira com evidências reais.

**Technical actions:**

1. Atualizar AGENTS.md raiz/backend com módulo, endpoints, fila BullMQ/Redis, storage e worker efetivamente implementados; remover descrições obsoletas somente onde necessário para refletir o código (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, `phase-03-videos/TD-04`, `phase-03-videos/TD-06`, `phase-03-videos/TD-07`).
2. Documentar setup, recursos de teste, multipart/retomada, worker, falhas e prova de 10GB em docs/, com comandos confirmados e nenhum arquivo/comportamento inexistente; manter frontend fora do diff.
3. Executar gates finais de Deliverables no container, build e export OpenAPI; conferir spec contra os dez contratos, guardas e redirecionamentos (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`, `openapi-docs-nestjs/TD-03`).
4. Concluir progress.md e matriz de critérios de prompt.md com links para código/evidências; verificar feature/phase-03-videos derivada de dev e nenhuma alteração/commit direto na main antes de preparar entrega.

**Tests:**

| Artifact | Layer | Test file |
|---|---|---|
| Export OpenAPI | Integration: operações, schemas, auth e erros reais | `nestjs-project/src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.9.2

**Acceptance criteria:**

- Os arquivos/endpoints/serviços descritos em AGENTS.md existem e correspondem ao comportamento entregue.
- Suíte completa unit/integration, E2E, tsc, lint, build e export OpenAPI encerram com exit 0.
- Os nove requisitos funcionais e todos os critérios de prompt.md têm evidência verificável, incluindo 10GB reais.
- O diff da fase não modifica next-frontend e o histórico respeita feature a partir de dev.

---

## Technical Specifications

### Data Model

**Origem:** phase-03-videos/TD-02/03/04/05/06 e relação canal-vídeo de prompt.md; convenções TypeORM herdadas. Este documento especifica comportamento futuro, ainda não implementado. Os SI-03.x citados abaixo identificam as unidades executáveis definidas em Step Implementations; blocos maiores foram divididos por responsabilidade.

#### Video — `videos` (SI-03.3.1)

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK gerada pelo banco |
| channel_id | uuid | NOT NULL, FK channels.id, ON DELETE RESTRICT; índice |
| slug | varchar(24) | NOT NULL, UNIQUE nomeada, hexadecimal minúsculo; identidade pública permanente |
| title | varchar(200) | NOT NULL, trim, 1–200 caracteres |
| original_file_name | varchar(255) | NOT NULL; nome-base sanitizado, nunca caminho de storage |
| declared_content_type | varchar(100) | NOT NULL; indício do cliente, não prova de mídia válida |
| status | varchar(16) | NOT NULL, default draft; CHECK draft/processing/ready/error |
| declared_size_bytes | bigint | NOT NULL; CHECK 1..10_000_000_000 |
| actual_size_bytes | bigint nullable | Definido por HeadObject, deve igualar declared_size_bytes |
| source_key | varchar(512) | NOT NULL, UNIQUE; gerada no servidor, sem nome enviado pelo cliente |
| playback_key | varchar(512) nullable | Referência ao MP4 faststart da tentativa vencedora |
| thumbnail_key | varchar(512) nullable | Referência ao JPEG da mesma tentativa vencedora |
| upload_id | text nullable | Identificador multipart, select:false; não exposto em DTO público |
| upload_expires_at | timestamptz | NOT NULL, prazo absoluto da sessão |
| upload_operation | varchar(16) nullable | initializing/completing/aborting; exclusão de operações concorrentes |
| operation_token | uuid nullable | Compare-and-set para concluir uma operação de upload |
| operation_expires_at | timestamptz nullable | Recuperação de operação interrompida; não significa expiração da sessão |
| duration_seconds | double precision nullable | Finito e >0 para ready |
| metadata | jsonb nullable | Objeto limitado descrito abaixo; nunca saída ffprobe completa |
| processing_attempts | integer | NOT NULL, default 0; orçamento persistente de tentativas |
| processing_token | uuid nullable | Fencing token da tentativa ativa |
| processing_lease_until | timestamptz nullable | Renovada durante processamento; índice junto de status |
| error_code | varchar(64) nullable | Código estável do catálogo; obrigatório em error |
| error_message | varchar(255) nullable | Mensagem segura, sem stderr, credenciais, host ou caminho |
| created_at / updated_at | timestamptz | CreateDateColumn / UpdateDateColumn |

**Relations:** Channel.videos `OneToMany`; Video.channel `ManyToOne` com JoinColumn explícito em channel_id. Um canal possui vários vídeos, cada vídeo pertence a um canal. Sem eager loading ou cascade de entidades de outro domínio. Todas as conexões de teste que carregam Channel devem incluir Video e suas relações; centralizar as classes explícitas, sem glob em Jest.

**Indexes / invariants:** UNIQUE de slug e source_key; índices (channel_id, created_at), (status, upload_expires_at) e (status, processing_lease_until). Estado ready exige actual_size_bytes, duration_seconds, metadata, playback_key e thumbnail_key, com tamanhos/duração válidos; estado error exige error_code. Nenhum estado posterior volta a draft nesta fase. Os CHECKs compatíveis com TypeORM devem ser gerados pela CLI; SQL adicional somente se a CLI não o expressar, com justificativa.

**Representation:** TypeORM bigint usa string na entidade ou transformer explícito validado; DTO converte para number somente após provar inteiro seguro e limite de 10GB. Não fazer cast cego. `metadata` contém apenas `{ container, videoCodec, audioCodec, width, height, frameRate }`, audioCodec nullable; dimensões inteiras positivas e frameRate finito positivo quando disponível. Limitar saída do ffprobe antes de parsear, validar unknown com type guards.

**Object keys:** original em `videos/<uuid>/source`. Os nomes-base de TD-03/04 (`thumbnail.jpg`, `playback.mp4`) recebem segmento interno `attempts/<processing_token>/` para os derivados. Assim, uma tentativa vencida nunca sobrescreve o objeto publicado por outra; o banco aponta para os dois objetos da tentativa vencedora. É um refinamento operacional dos prefixos privados da opção A para cumprir idempotência/fencing de TD-05. Nenhum caminho é informado pelo cliente. Objetos referenciados por ready são imutáveis; derivados órfãos de tentativas vencidas são limpos após carência e conferência no banco.

#### VideoProcessingOutbox — `video_processing_outbox` (SI-03.3.1 / SI-03.6.1)

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK gerada |
| video_id | uuid | UNIQUE, NOT NULL, FK videos.id ON DELETE CASCADE |
| event_type | varchar(64) | NOT NULL, valor video.upload.completed |
| schema_version | integer | NOT NULL, 1 |
| dispatched_at | timestamptz nullable | Último despacho bem-sucedido; não encerra a reconciliação |
| dispatch_attempts | integer | NOT NULL default 0; diagnóstico, não orçamento de processamento |
| next_attempt_at | timestamptz | NOT NULL default now(); índice |
| locked_until / lock_token | timestamptz / uuid nullable | Claim de despacho recuperável |
| last_error | varchar(255) nullable | Diagnóstico sanitizado de despacho |
| completed_at | timestamptz nullable | Preenchido somente ao persistir ready/error |
| created_at / updated_at | timestamptz | Colunas padrão |

**Relations:** relação Video.processingOutbox `OneToOne` inversa e VideoProcessingOutbox.video com FK explícita. Não usar outbox como histórico ilimitado ou duplicar metadados do vídeo no payload. Inserção da outbox e draft→processing ocorrem na mesma transação com o mesmo EntityManager.

**Migrations:** gerar a nova migration contra banco coerente com as duas existentes; revisar diff para conter somente videos/outbox e relações/índices novos. Não editar migrations aplicadas. Provar aplicação em banco vazio, rollback/reaplicação da nova migration e preservação das tabelas anteriores. Helpers usam synchronize:false e imports explícitos de entidades/migrations. Teste destrutivo de migrations usa schema próprio; limpeza normal segue outbox → videos → tokens → channels → users.

#### Transições e concorrência

| From | Trigger | To | Garantia |
|---|---|---|---|
| inexistente | criação autenticada | draft | Persistir rascunho antes de emitir permissões S3 |
| draft | conclusão e tamanho real validados | processing | Compare-and-set + outbox na mesma transação |
| draft | abort, expiração ou falha irrecuperável na inicialização | error | Código explícito; cleanup recuperável |
| processing | metadados, thumbnail e playback persistidos | ready | Finalizar somente se processing_token ainda for o dono da lease |
| processing | erro transitório com orçamento | processing | Retry com backoff; não publicar mídia |
| processing | conteúdo inválido, codec não aceito ou orçamento esgotado | error | Persistir falha antes de encerrar intenção de outbox |
| ready / error | job ou conclusão repetidos | mesmo estado | Não duplicar vídeo/evento/derivados publicados |

Operações com S3 e FFmpeg ficam fora de transações longas. Transações curtas fazem claims/compare-and-set; operações completam somente com token vigente. Um claim expirado exige reconciliação com HeadObject/ListParts antes de abortar ou reiniciar. Abort e completion não podem ser executados simultaneamente pelo domínio. Se CompleteMultipartUpload tiver sido bem-sucedido e o commit falhar, HeadObject do source_key conhecido permite repetir a transição/outbox sem reenviar o arquivo. Se a sessão venceu, conferir primeiro se já existe objeto concluído; não descartar trabalho concluído por causa do relógio.


### API Contracts

**Origem:** TD-02/06/07, JWT/ValidationPipe/filtros herdados e OpenAPI confirmado. Somente JSON de controle atravessa a API; nenhuma rota recebe binário ou multipart/form-data. DTOs não expõem entidades, credenciais, bucket, chaves internas ou detalhes ffprobe. Contratos novos serão adicionados ao Swagger e à exportação existente; frontend não é alterado.

`VideoStatusDto`: `{ id: uuid, slug: string, status: 'draft'|'processing'|'ready'|'error', errorCode: string|null, createdAt: ISO8601, updatedAt: ISO8601 }`. errorCode é diagnóstico de processamento para o dono e não substitui o campo `error` do envelope HTTP herdado.

#### POST /videos/uploads (SI-03.5.3)

**Request headers:** Authorization: Bearer access token; Content-Type: application/json.

**Request body:** `{ title, fileName, contentType, sizeBytes }`. title 1–200; fileName 1–255, sem NUL/separadores/CR/LF; contentType `video/mp4`; sizeBytes inteiro 1..10_000_000_000. O MIME informado não autoriza conteúdo sem validação posterior.

**Response 201:** `{ video: VideoStatusDto, upload: { partSizeBytes: 67108864, partCount: integer, expiresAt: ISO8601 } }`; vídeo draft e sessão multipart persistidos. A URL pública futura deriva do slug, mas leitura só estará disponível em ready.

**Error responses:** 400 VALIDATION_ERROR; 401 conforme guard herdado; 404 CHANNEL_NOT_FOUND; 503 STORAGE_UNAVAILABLE ou VIDEO_ID_GENERATION_FAILED; 429 conforme throttler. Falha após criar rascunho exige compensação/reconciliação documentada; nunca retornar 201 sem sessão persistida.

---

#### GET /videos/:id/upload (SI-03.5.4)

**Request headers:** Authorization: Bearer access token.

**Request body:** nenhum. id UUID validado.

**Response 200:** `{ video: VideoStatusDto, upload: { partSizeBytes, partCount, expiresAt, parts: [{ partNumber, sizeBytes, etag }] } }`; ListParts autoritativo e paginado internamente. Repetir não cria nova sessão nem muda identidade.

**Error responses:** 400 VALIDATION_ERROR; 401; 404 VIDEO_NOT_FOUND (inclui outro dono); 409 INVALID_VIDEO_STATE; 410 UPLOAD_EXPIRED; 503 STORAGE_UNAVAILABLE; 429. Endpoint de retomada para draft; processing/ready são consultados em status.

---

#### POST /videos/:id/upload/parts (SI-03.5.5)

**Request headers:** Authorization: Bearer access token; Content-Type: application/json.

**Request body:** `{ partNumbers: integer[] }`, 1–50 números únicos, cada um entre 1 e partCount. id UUID. Nenhuma chave, upload_id ou ETag recebido como autoridade.

**Response 200:** `{ parts: [{ partNumber, url, expiresAt, headers: { 'Content-Length': string } }] }`. Assinar UploadPart com tamanho esperado da parte: 64MiB, salvo a última. Prazo até 900s e nunca maior que a sessão. Gerar nova assinatura permite retomar a mesma parte.

**Error responses:** 400 VALIDATION_ERROR; 401; 404 VIDEO_NOT_FOUND; 409 INVALID_VIDEO_STATE/UPLOAD_OPERATION_IN_PROGRESS; 410 UPLOAD_EXPIRED; 503 STORAGE_UNAVAILABLE; 429.

O cliente envia PUT diretamente à URL assinada, com os headers retornados, respeitando concorrência limitada. O contrato do storage exige Content-Length correto. Teste real deve enviar parte com tamanho divergente: rejeição pelo storage ou, no mínimo, bloqueio da conclusão pela API; nunca processar arquivo acima do limite. URLs de partes deixam de funcionar após concluir/abortar o UploadId.

---

#### POST /videos/:id/upload/completion (SI-03.5.6)

**Request headers:** Authorization: Bearer access token.

**Request body:** nenhum; não confiar em ETags/tamanhos declarados pelo cliente.

**Response 202:** `{ video: VideoStatusDto }` em processing; requisição repetida em processing retorna a mesma identidade sem nova outbox/job lógico.

**Response 200:** `{ video: VideoStatusDto }` se já ready, sem repetir processamento.

**Error responses:** 400 VALIDATION_ERROR (id); 401; 404 VIDEO_NOT_FOUND; 409 UPLOAD_INCOMPLETE/UPLOAD_SIZE_MISMATCH/UPLOAD_OPERATION_IN_PROGRESS/INVALID_VIDEO_STATE; 410 UPLOAD_EXPIRED; 503 STORAGE_UNAVAILABLE; 429.

Conferir números, ETags e tamanhos reais com ListParts, ordenação e soma; todas as partes esperadas e nenhuma extra. Concluir S3, conferir ContentLength por HeadObject, transacionar status/outbox. A janela objeto concluído/DB indisponível fica recuperável pelo source_key. Redis indisponível não impede persistir essa intenção. Um erro terminal de validação de tamanho aborta sessão/limpa objeto de forma recuperável e nunca cria outbox de processamento.

---

#### DELETE /videos/:id/upload (SI-03.5.7)

**Request headers:** Authorization: Bearer access token.

**Request body:** nenhum; id UUID.

**Response 204:** sessão draft abortada e vídeo error com UPLOAD_ABORTED; repetir o mesmo abort retorna 204. Não é exclusão de vídeo da Fase 04.

**Error responses:** 400 VALIDATION_ERROR; 401; 404 VIDEO_NOT_FOUND; 409 INVALID_VIDEO_STATE/UPLOAD_OPERATION_IN_PROGRESS; 503 STORAGE_UNAVAILABLE; 429. Se houver objeto já concluído, reconciliar como completion em vez de confirmar abort incorreto.

---

#### GET /videos/:id/status (SI-03.5.8)

**Request headers:** Authorization: Bearer access token.

**Request body:** nenhum; id UUID.

**Response 200:** `VideoStatusDto`, inclusive draft/processing/error, somente para o dono.

**Error responses:** 400 VALIDATION_ERROR; 401; 404 VIDEO_NOT_FOUND; 429. Não depende de Redis nem expõe stderr/URLs assinadas.

---

#### GET /videos/:slug (SI-03.8.2)

**Request headers:** nenhum obrigatório; @Public().

**Request body:** nenhum. slug hexadecimal de 24 caracteres; valor desconhecido/inválido não revela vídeo privado.

**Response 200:** `{ slug, title, durationSeconds, sizeBytes, metadata: { container, videoCodec, audioCodec, width, height, frameRate }, streamUrl, downloadUrl, thumbnailUrl }`. URLs são rotas estáveis da API, não URLs S3 persistidas. sizeBytes é o tamanho real do original. Vídeo deve estar ready.

**Error responses:** 404 VIDEO_NOT_FOUND para ausente ou não pronto; 429. Não devolve informações de sessão, dono privado ou códigos internos de falha.

---

#### GET /videos/:slug/stream (SI-03.8.3)

**Request headers:** nenhum obrigatório; Range opcional, encaminhado pelo consumidor ao seguir o redirecionamento. @Public().

**Request body:** nenhum.

**Response 307:** Location com GET S3 assinado para playback_key, Content-Type de destino video/mp4 e Content-Disposition inline. Cache-Control: no-store na API para não armazenar a assinatura. API não transporta o corpo do vídeo.

**Error responses:** 404 VIDEO_NOT_FOUND; 503 STORAGE_UNAVAILABLE; 429. A API não anuncia 206 como se servisse bytes. No destino, provar GET sem Range 200 e Range simples/suffix 206 com Content-Range correto; range fora do objeto 416. Não fixar Range na assinatura, permitindo seek. A transferência deve iniciar antes de consumir o arquivo completo, com moov antes de mdat no MP4 faststart.

---

#### GET /videos/:slug/download (SI-03.8.4)

**Request headers:** nenhum obrigatório; @Public().

**Request body:** nenhum.

**Response 307:** Location de GET S3 para source_key; destino com Content-Disposition attachment e filename seguro, sem CR/LF; preservar nome-base sanitizado e usar filename* quando necessário. Cache-Control: no-store. Original permanece byte a byte como foi enviado.

**Error responses:** 404 VIDEO_NOT_FOUND; 503 STORAGE_UNAVAILABLE; 429. Provar tamanho, hash do original e disposição no destino real; não apenas existência de Location.

---

#### GET /videos/:slug/thumbnail (SI-03.8.5)

**Request headers:** nenhum obrigatório; @Public().

**Request body:** nenhum.

**Response 307:** Location de GET S3 para thumbnail_key, destino image/jpeg e inline; Cache-Control: no-store.

**Error responses:** 404 VIDEO_NOT_FOUND; 503 STORAGE_UNAVAILABLE; 429. Thumbnail de vídeo não pronto permanece inacessível, mesmo que o worker já tenha criado objeto intermediário.

#### Validation Rules

ValidationPipe global com whitelist/forbidNonWhitelisted/transform; DTO por operação, sem aceitar channelId ou campos de storage. Owner determinado por JWT.sub → canal através do módulo Channels; controller não consulta repositórios nem contém fluxo de negócio. UUID em controles privados; slug em rotas públicas. DTOs de entrada seguem plugin/class-validator; DTOs de resposta têm ApiProperty explícito. Operações documentam todos os status previstos com envelope comum, segurança JWT e headers de redirecionamento.

Limites de controle definidos por rota sem enfraquecer o throttling de auth: criação 10/min, retomada/assinatura/conclusão/status 120/min e leitura pública 120/min por IP, usando o guard existente. DELETE usa 10/min. A carga binária vai ao storage. Esses valores são defaults operacionais de TD-02/07, ajustáveis; não garantias de capacidade. Testes de autorização/contrato devem controlar estado do throttler, e um teste separado prova 429 com o guard real. JSON máximo de controle 64KiB na API; não aumentar limite para acomodar vídeo.


### Authorization Matrix

**Origem:** escolha explícita do usuário para TD-06; guard JWT global herdado. Owner significa JWT válido cujo sub possui o canal do vídeo, resolvido pelo servidor. Não há nova role nem publicação nesta fase.

| Endpoint | Anonymous | Authenticated, other channel | Owner |
|---|---|---|---|
| POST /videos/uploads | 401 | 201 criando no próprio canal | 201 no próprio canal |
| GET /videos/:id/upload | 401 | 404 | 200 somente draft |
| POST /videos/:id/upload/parts | 401 | 404 | 200 somente draft |
| POST /videos/:id/upload/completion | 401 | 404 | 202 processing / 200 se já ready |
| DELETE /videos/:id/upload | 401 | 404 | 204 draft ou abort repetido |
| GET /videos/:id/status | 401 | 404 | 200 em qualquer estado |
| GET /videos/:slug | 200 somente ready | 200 somente ready | 200 somente ready |
| GET /videos/:slug/stream | 307 somente ready | 307 somente ready | 307 somente ready |
| GET /videos/:slug/download | 307 somente ready | 307 somente ready | 307 somente ready |
| GET /videos/:slug/thumbnail | 307 somente ready | 307 somente ready | 307 somente ready |

Rotas públicas usam @Public(); em qualquer estado não pronto retornam 404 inclusive para o dono, que usa status privado. Bucket permanece privado; acesso direto não assinado deve falhar. Assinaturas são permissões temporárias compartilháveis; expiram em até 15min. O fluxo de revogação/visibilidade da Fase 04 não é simulado.


### Error Catalog

**Origem:** envelope herdado de phase-02-auth/TD-07, refinamento de falhas de TD-02/04/05/06. Reutilizar DomainException + DomainExceptionFilter; controllers não fazem try/catch de negócio. O erro HTTP usa `{ statusCode, error, message }`; `message` é string em domínio e string[] no VALIDATION_ERROR existente. Não criar errorCode no envelope.

| errorCode (valor de error) | HTTP | Trigger |
|---|---|---|
| VALIDATION_ERROR | 400 | DTO, parâmetro UUID ou campos de controle inválidos |
| CHANNEL_NOT_FOUND | 404 | Usuário não possui canal para iniciar upload |
| VIDEO_NOT_FOUND | 404 | Ausência, dono diferente no controle privado ou vídeo não ready em rota pública |
| INVALID_VIDEO_STATE | 409 | Operação incompatível com estado terminal/processing |
| UPLOAD_OPERATION_IN_PROGRESS | 409 | Claim válido de completion/abort/initializing concorrente; cliente pode tentar depois |
| UPLOAD_INCOMPLETE | 409 | Parte ausente ou sequência divergente; sessão pode continuar |
| UPLOAD_SIZE_MISMATCH | 409 | Tamanho real de parte/objeto diverge do contrato; não enfileirar |
| UPLOAD_EXPIRED | 410 | Sessão draft vencida sem objeto já concluído recuperável |
| STORAGE_UNAVAILABLE | 503 | Serviço S3 indisponível ou operação não confirmada; erro sanitizado |
| VIDEO_ID_GENERATION_FAILED | 503 | Orçamento de tentativas de slug esgotado; nunca ignorar UNIQUE |

401/429 preservam os envelopes reais dos guards herdados (sem inventar novo código de domínio). Spec deve reproduzir o que o código entrega. Outros erros inesperados seguem tratamento 500 existente; logs internos não vão para a resposta.

**Falhas persistidas em Video, sem resposta HTTP do worker:** UPLOAD_ABORTED, UPLOAD_EXPIRED, UPLOAD_INITIALIZATION_FAILED, UPLOAD_SIZE_MISMATCH, INVALID_VIDEO_CONTENT, UNSUPPORTED_VIDEO_FORMAT, PROCESSING_TIMEOUT, PROCESSING_FAILED. Mensagem segura e status error; o dono vê errorCode por status. Redis indisponível é falha de despacho recuperável, não PROCESSING_FAILED imediato. Não persistir stack/stdout/stderr na API pública. Retentativa manual e edição/reupload de vídeo terminal ficam fora da fase.


### Events/Messages

#### video.upload.completed (SI-03.6.1 / SI-03.6.2)

**Payload:**

```json
{ "schemaVersion": 1, "videoId": "uuid" }
```

**Producer:** VideoUploadsService persiste a intenção no repositório/outbox; VideoOutboxDispatcher do worker faz Queue.add, por TD-05.

**Consumer:** VideoProcessingConsumer (WorkerHost) delega VideoProcessingService; somente em VideosWorkerModule, por TD-01/04.

**Trigger:** após concluir multipart e confirmar tamanho real; gravação transacional de draft→processing + única outbox por video_id.

**Delivery semantics:** at-least-once; jobId `video-<uuid>`, fila `video-processing`, nome `process-video`. Prefixo Redis configurável distingue desenvolvimento/teste; payload sem bytes, caminhos de disco, credenciais, URL arbitrária ou dados redundantes. Worker valida nome/schemaVersion/videoId porque contexto standalone não executa pipes HTTP. Job inválido é rejeitado e registrado como erro operacional; não executar comandos com payload desconhecido.

**Dispatch/recovery:** timer lifecycle nativo com execução não sobreposta, encerrado no shutdown; sem adicionar scheduler apenas para isso. Claim curto com lock/skip_locked, token e próximo prazo no banco. Adicionar job, registrar dispatched_at; se o commit após add falhar, repetir com mesmo jobId. Enquanto vídeo estiver processing, a outbox continua elegível para reconciliação: job ausente após perda de Redis é recriado; job failed esgotado exige gravar error no banco; job completed com banco processing deve ser reconciliado, não ignorado. completed_at só termina intenção quando estado terminal está persistido. Claims vencidos são recuperáveis. Falhas de leitura/escrita de banco propagam para logs/retry; não marcar entrega concluída num catch silencioso.

**Processing budget:** máximo três tentativas com backoff exponencial inicial de 2s; processing_attempts no banco limita também recriações após perda do Redis. Incrementar apenas ao adquirir uma tentativa real; duplicate/busy não consome orçamento. Erro transitório mantém processing; conteúdo inválido termina com UnrecoverableError após persistir error. Evento failed auxilia diagnóstico, mas não é o único mecanismo de persistência terminal. Lease heartbeat de 10s e validade de 60s são defaults operacionais; abortar subprocessos/streams se a renovação falhar. Finalização exige token ainda vigente; uma tentativa vencida não pode publicar ponteiros de derivados nem erro sobre outra tentativa.

#### Worker de mídia e consistência (SI-03.7.1 / SI-03.7.2 / SI-03.7.3 / SI-03.7.4)

Bootstrap por NestFactory.createApplicationContext em entrada própria; não importar AppModule HTTP, AuthModule nem controllers no worker. Config/database/storage compartilhados por módulos, sem duplicar providers. VideosPersistenceModule contém entidades/repositórios; VideosModule expõe controllers/serviços de controle; VideosWorkerModule contém consumidor, dispatcher e reconciliador. StorageModule implementa interface/tokens para operações S3; domínio não conhece SDK. ChannelsModule fornece consulta de canal por userId; Videos não cria entidades de usuário/canal.

Pipeline: obter claim no banco → ler original por stream para diretório temporário exclusivo da tentativa → ffprobe com saída JSON limitada → validar MP4/H.264 e AAC opcional → extrair metadados permitidos → remux por cópia com faststart → gerar JPEG em frame válido (início ou posição limitada pela duração) → enviar derivados ao bucket privado → transacionar ready + ponteiros/metadados + completed_at da outbox com token vigente. O download continua apontando ao original; streaming aponta ao derivado MP4. O processamento mínimo não inclui mudança de resolução, HLS, adaptive bitrate ou transcodificação genérica.

Use child_process.spawn sem shell; argumentos fixos, `-nostdin`, protocolos file/pipe apenas e caminhos próprios; nenhum nome enviado pelo cliente vira argumento operacional. Defaults: concorrência 1, uma thread FFmpeg, ffprobe timeout 60s e processamento completo timeout 60min, saída JSON até 1MiB e stderr limitado para logs. Timeouts configuráveis pelo ambiente, validados com Joi. Esses limites exigem medição no teste integral, podendo ser ajustados com evidência; não há promessa de processar qualquer duração de vídeo em prazo fixo.

Original e playback podem exceder 5GiB: o envio dos derivados pelo worker também usa multipart com partes/streams limitados, não PutObject único nem Buffer de 10GB. Concorrência de I/O limitada, cancelamento e abort de multipart derivado em finally. Temp disk deve comportar original + remux; verificar espaço antes da tentativa. Diretórios exclusivos e remoção finally também no erro; na inicialização limpar temporários abandonados de tentativas sem lease válida.

Tentativas gravam prefixos próprios; somente a transação vencedora publica playback_key/thumbnail_key. Reconciliador remove derivados não referenciados após carência de 24h, sem tocar ready. Cleanup de uploads incompletos usa prazo e associação no banco, incluindo crash após CreateMultipartUpload antes de persistir upload_id. Listar multipart paginadamente e abortar órfãos somente após carência; falhas de cleanup são observáveis e reexecutáveis. Não depender exclusivamente de lifecycle S3 não verificado no MinIO local.

#### Infraestrutura e configuração (SI-03.2.1 / SI-03.2.2 / SI-03.4.1 / SI-03.4.2)

Compose acrescenta `minio`, `minio-init`, `redis` e `video-worker`, preservando API/db/Mailpit. Bucket privado inicializado idempotentemente, CORS para origem configurada e sem policy pública. Redis com volume, AOF e maxmemory-policy noeviction. MinIO com volume persistente; init termina com sucesso ou falha explícita. Dependências usam healthchecks: pg_isready, readiness MinIO, redis-cli ping e sucesso de init; worker só inicia sobre schema migrado por comando de setup documentado ou serviço migration one-shot, sem duas instâncias aplicando migrations ao mesmo tempo.

Imagem do worker inclui FFmpeg/ffprobe, usa usuário não root, filesystem temporário próprio e limite de memória/CPU coerente com concorrência 1; preservar execução apenas em containers. Fixar tags/digests disponíveis, registrar versões binárias reais e provar readiness na SI de infraestrutura; não inventar versões agora. Inicialização padrão da aplicação continua conforme AGENTS.md: subir infraestrutura não liga o servidor HTTP sem pedido explícito; worker é componente assíncrono necessário à stack da fase.

Factories namespaced `storage`, `queue`, `videos` em src/config/, com ConfigType/injeção tipada e Joi. Variáveis previstas: STORAGE_ENDPOINT (http://minio:9000 interno), STORAGE_PUBLIC_ENDPOINT (origem acessível pelo cliente), STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_FORCE_PATH_STYLE; REDIS_HOST=redis, REDIS_PORT, REDIS_PASSWORD opcional, VIDEO_QUEUE_PREFIX; VIDEO_UPLOAD_TTL_SECONDS, VIDEO_SIGNED_URL_TTL_SECONDS, VIDEO_PROCESSING_TIMEOUT_MS e VIDEO_WORKER_CONCURRENCY. Máximo 10GB e part size centralizados em constantes; não há config que eleve silenciosamente o teto do contrato.

STORAGE_PUBLIC_ENDPOINT só serve à assinatura externa e precisa de hostname acessível pelo consumidor; não usá-lo para conexão entre serviços. Nos testes dentro da rede Compose pode ser http://minio:9000; no roteiro externo usar hostname publicado resolvível pelo cliente. Host `db`, nunca loopback nas conexões de containers. CORS expõe ETag/Content-Range/Accept-Ranges/Content-Length; permitir GET/HEAD/PUT e os headers assinados necessários. URLs/segredos não são logados nem commitados; .env.example documenta placeholders e valores com espaços entre aspas.

#### Prova funcional e qualidade (SI-03.1.3 / SI-03.9.1 / SI-03.9.2 / SI-03.10)

Antes da feature, SI-03.1 elimina a ambiguidade Jest preservando dotenv/config e regex unit+integration; corrige deadlock e restauração no teste de migrations, usa DB de teste dedicado e nomes de sufixo corretos, remove synchronize e resolve os 150 erros de lint medidos sem desligar regras nem excluir testes. Os testes de auth/canais continuam exercitando os contratos existentes. Nenhuma refatoração alheia a esse gate entra na fase.

Integração/e2e usam PostgreSQL/MinIO/Redis/FFmpeg reais com DB, bucket/prefixo e fila de teste próprios. Um worker de teste com essas mesmas variáveis roda separado do worker normal; migrations destrutivas usam schema exclusivo sem ser consumido pelo reconciliador. Testes serializados e teardown interrompem consumidores antes de limpar recursos. Unidade usa doubles nos limites para provar branches/fencing; não mockar storage/fila no teste que afirma integração real.

Cobertura obrigatória: draft antecipado; sessão criada com permissão do dono; invasão por outro canal; partes inválidas/incompletas/divergentes; retomada com ListParts; expiração/abort; completion repetida/concurrente; crash S3 concluído/DB sem commit; outbox com Redis fora e recuperação; perda de job; retry transitório e orçamento final; conteúdo inválido; worker morto/lease vencida; tentativa velha incapaz de publicar; FK/UNIQUE e colisão de slug forçada com savepoint; originais intactos; MP4 faststart com metadados reais; JPEG real; URL pública somente ready; Range/206/416, inline/attachment, acesso sem assinatura negado; Swagger alinhado a todas as rotas/estados previstos.

Prova de 10GB é execução separada com vídeo MP4 válido de exatamente 10_000_000_000 bytes (geração limitada em disco/stream, sem buffer integral), upload direto em partes, interrupção/retomada, completion, processamento e leitura parcial/download. Medir bytes reais, duração, RSS da API/worker e latência de sondas de controle durante a transferência. Planejar espaço livre para storage + original temporário + remux + fixture; não iniciar se insuficiente. O roteiro deve registrar hashes, contagem de partes, p50/p95, falhas de sonda e versões. Critério operacional inicial: nenhuma sonda perdida/5xx e p95 <= max(1s, 2x baseline); RSS da API não cresce proporcionalmente ao arquivo e não excede o limite de memória configurado. Não escrever passed com teste apenas numérico ou com upload abreviado; limitação de recurso pendente impede declarar a fase completa.

Gates finais no diretório nestjs-project, sempre via Docker: npm test -- --runInBand; npm run test:e2e -- --runInBand; npx tsc --noEmit; npm run lint, além de build e export OpenAPI. Comandos exatos finais serão listados em Deliverables na Phase B. Registrar resultados reais por SI em progress.md quando a implementação iniciar; não criar resultados antecipados. Atualizar root/backend AGENTS.md com arquivos/rotas/worker/storage efetivamente entregues e conferir todos os critérios de prompt.md antes de qualquer push. GitFlow: feature/phase-03-videos derivada de dev; nenhum commit na main.

---

## Dependency Map

A árvore usa a primeira dependência de cada SI. As dependências adicionais listadas abaixo são igualmente obrigatórias; a ordem de Step Implementations é topológica.

```text
SI-03.1.1 (root)
└── SI-03.1.2
    └── SI-03.1.3
        └── SI-03.2.1
            └── SI-03.2.2
                └── SI-03.3.1
                    └── SI-03.3.2
                        └── SI-03.4.1
                            └── SI-03.4.2
                                └── SI-03.5.1
                                    ├── SI-03.5.2
                                    │   ├── SI-03.5.6
                                    │   ├── SI-03.5.7
                                    │   ├── SI-03.5.8
                                    │   └── SI-03.6.1
                                    │       └── SI-03.6.2
                                    │           └── SI-03.7.1
                                    │               └── SI-03.7.2
                                    │                   └── SI-03.7.3
                                    │                       └── SI-03.7.4
                                    │                           └── SI-03.8.1
                                    │                               ├── SI-03.8.2
                                    │                               ├── SI-03.8.3
                                    │                               ├── SI-03.8.4
                                    │                               └── SI-03.8.5
                                    ├── SI-03.5.3
                                    ├── SI-03.5.4
                                    │   └── SI-03.9.1
                                    │       └── SI-03.9.2
                                    │           └── SI-03.10
                                    └── SI-03.5.5
```

- SI-03.5.4 também depende de SI-03.5.3.
- SI-03.5.5 também depende de SI-03.5.3.
- SI-03.5.6 também depende de SI-03.5.3.
- SI-03.5.7 também depende de SI-03.5.3.
- SI-03.5.8 também depende de SI-03.5.3.
- SI-03.8.3 também depende de SI-03.8.2.
- SI-03.8.4 também depende de SI-03.8.2.
- SI-03.8.5 também depende de SI-03.8.2.
- SI-03.9.1 também depende de SI-03.5.5 + SI-03.5.6 + SI-03.5.7 + SI-03.5.8 + SI-03.7.4 + SI-03.8.2 + SI-03.8.3 + SI-03.8.4 + SI-03.8.5.

---

## Deliverables

- [ ] SI-03.1.1 — Consolidar Jest e isolar o banco de testes
- [ ] SI-03.1.2 — Corrigir tipagem dos testes de autenticação e serviços
- [ ] SI-03.1.3 — Fechar o gate de qualidade da base
- [ ] SI-03.2.1 — Infra: fixar bibliotecas e configuração de vídeos
- [ ] SI-03.2.2 — Infra: disponibilizar MinIO, Redis e ferramentas de mídia
- [ ] SI-03.3.1 — Persistir vídeos, outbox e relações com canais
- [ ] SI-03.3.2 — Implementar repositórios e transições condicionais
- [ ] SI-03.4.1 — Implementar controle multipart no adaptador S3
- [ ] SI-03.4.2 — Assinar acesso e transferir arquivos com memória limitada
- [ ] SI-03.5.1 — Criar rascunhos e preparar a retomada
- [ ] SI-03.5.2 — Concluir ou abortar uploads sem perder processamento
- [ ] SI-03.5.3 — Iniciar upload por HTTP
- [ ] SI-03.5.4 — Retomar upload por HTTP
- [ ] SI-03.5.5 — Emitir permissões de partes por HTTP
- [ ] SI-03.5.6 — Confirmar conclusão por HTTP
- [ ] SI-03.5.7 — Abortar sessão por HTTP
- [ ] SI-03.5.8 — Consultar estado privado por HTTP
- [ ] SI-03.6.1 — Despachar a outbox para BullMQ
- [ ] SI-03.6.2 — Reconciliar jobs ausentes e falhas terminais
- [ ] SI-03.7.1 — Extrair metadados e preparar mídia progressiva
- [ ] SI-03.7.2 — Processar vídeos com lease e finalização protegida
- [ ] SI-03.7.3 — Ativar o consumidor em container separado
- [ ] SI-03.7.4 — Recuperar sessões e limpar artefatos abandonados
- [ ] SI-03.8.1 — Resolver acesso público apenas para vídeos prontos
- [ ] SI-03.8.2 — Expor metadados por URL única
- [ ] SI-03.8.3 — Redirecionar reprodução progressiva
- [ ] SI-03.8.4 — Redirecionar download do original
- [ ] SI-03.8.5 — Disponibilizar thumbnail de vídeo pronto
- [ ] SI-03.9.1 — Comprovar recuperação do fluxo com serviços reais
- [ ] SI-03.9.2 — Comprovar upload integral de 10GB e responsividade
- [ ] SI-03.10 — Documentar a entrega e fechar a Definition of Done

**Full test suites:**

Os comandos abaixo são o contrato de execução a disponibilizar em SI-03.1.1/SI-03.2.2/SI-03.7.3. `.env.test` é local e ignorado, preparado a partir de exemplo sem segredos; o override deve fixar banco, bucket e prefixo de fila de teste. Nenhum desses resultados foi declarado como executado neste plano.

- [ ] Recursos de teste preparados e readiness confirmada: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml --profile test up -d db mailpit minio minio-init redis nestjs-api`; init one-shot deve terminar com exit 0, serviços persistentes devem estar prontos.
- [ ] Schema de teste migrado antes do consumidor: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run migration:run`; depois iniciar `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml --profile test up -d video-worker-test`. Setup deve esperar o worker estar pronto antes de rodar os cenários.
- [ ] Banco dedicado protegido contra nomes de desenvolvimento, com `synchronize:false`; worker de teste recebe as mesmas variáveis de isolamento da API de teste.
- [ ] Backend tests pass: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm test -- --runInBand`.
- [ ] E2E tests pass: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run test:e2e -- --runInBand`; dez contratos HTTP cobertos pelas specs externas e fluxo real coberto em SI-03.9.1.
- [ ] TypeScript compila sem erros: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npx tsc --noEmit`.
- [ ] Lint passa sem desligar regras: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run lint`.
- [ ] Project builds successfully: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run build`.
- [ ] OpenAPI exportado e coerente: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run openapi:export`; dez operações, segurança, respostas, schemas, envelope e 307 correspondem aos contratos.
- [ ] Prova de volume obrigatória: `cd nestjs-project && docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run video:prove-large`, disponibilizado em SI-03.9.2; relatório comprova 10_000_000_000 bytes efetivamente enviados, interrupção/retomada, RSS e responsividade, processamento e download íntegro.
- [ ] Prova de recuperação real inclui interrupções orquestradas no host por comandos Docker, sem montar socket Docker na API; worker separado, Redis e MinIO reais, nenhum processamento de mídia no processo HTTP.
- [ ] Stack padrão final inclui MinIO, Redis e video-worker, com persistência/readiness; iniciar infraestrutura continua sem ligar o servidor HTTP automaticamente.
- [ ] `progress.md`, criado por `$implement` no primeiro SI, registra estado e evidência reais por SI; nenhum item é concluído apenas por existir documentação.
- [ ] AGENTS.md raiz/backend descrevem os arquivos e comportamentos entregues; `next-frontend/` permanece fora do diff.
- [ ] Todos os critérios de `prompt.md` conferidos com rastreabilidade a código/evidências; GitFlow em feature a partir de dev, sem commit direto na main.
