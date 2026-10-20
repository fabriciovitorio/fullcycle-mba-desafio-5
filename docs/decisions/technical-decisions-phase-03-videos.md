---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-18
scope_description: "Upload direto de vídeos de até 10GB, processamento assíncrono, armazenamento S3/MinIO e entrega de mídia no backend."
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, persistência, storage, fila, worker e infraestrutura Docker; TD-01 a TD-07.
- `next-frontend/` — implementação expressamente fora do escopo de `prompt.md`; os contratos HTTP devem permitir um consumidor futuro sem exigir mudanças nesta fase.

## Origem e limites

Escopo: as nove capacidades literais da Fase 03 de `docs/project-plan.md`, detalhadas em `prompt.md`. O storage **já está fixado em S3 compatível/MinIO**, não é uma decisão a reabrir. Autenticação, configuração namespaced, Joi, erros de domínio, migrations e OpenAPI são herdados das decisões anteriores. Publicação, visibilidade, edição de vídeos, categorias e frontend pertencem às fases seguintes.

Este documento preserva a pesquisa e registra sua resolução por `plan-resolve`. Em 2026-10-18, o usuário confirmou as recomendações A, a leitura anônima dos vídeos prontos por URL e a herança de OpenAPI somente no backend. A implementação depende da validação clean e dos checkpoints do planejamento.

Consulta documental realizada via **Context7 MCP**, protocolo JSON-RPC, em 2026-10-18. O cliente iniciou o servidor Context7 4.4.2, descobriu `resolve-library-id`/`query-docs` e consultou os IDs registrados ao final. Não foi necessário alterar a configuração global do Codex.

---

## TD-01: Tecnologia da fila de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Não existe broker nem processamento de vídeos. A arquitetura declara a fila como TBD; o worker deve executar fora da API e permitir recuperação após falhas.

**Options:**

### Option A: BullMQ com Redis

- Filas de jobs em Redis, consumidas por um processo separado, com integração oficial NestJS.
- **Pros:** integração ao stack atual, retries/backoff e recuperação de jobs interrompidos.
- **Cons:** adiciona Redis; precisa de persistência, política sem eviction e processadores idempotentes.

### Option B: pg-boss com PostgreSQL

- Jobs persistidos no PostgreSQL, com consumidores Node.js.
- **Pros:** reaproveita o banco existente e reduz a quantidade de serviços distintos.
- **Cons:** compete com o domínio pelo banco e exige adaptação fora do módulo oficial de filas do NestJS.

### Option C: RabbitMQ

- Broker AMQP com produtores/consumidores e confirmações de mensagens.
- **Pros:** separação de infraestrutura e roteamento de mensagens extensível.
- **Cons:** retries de tarefas, backoff e acompanhamento de jobs exigem mais composição para este escopo.

**Recommendation:** Option A — BullMQ/Redis se encaixa no worker Node/NestJS. Usar Redis persistente e garantir idempotência no domínio; a entrega não deve ser descrita como processamento exatamente uma vez. Referências [R1], [R2], [R3].

**Decision:** A — BullMQ com Redis persistente, consumido pelo worker separado.

**Libraries:** @nestjs/bullmq, bullmq

**Revisions:**
- 2026-10-18 — Queue `video-processing`; job `process-video`; payload `{ schemaVersion: 1, videoId }`; jobId `video-<uuid>`. A integração usa @nestjs/bullmq 11.0.5 e BullMQ 5.81.5, ainda a instalar. Redis com AOF e noeviction. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## TD-02: Protocolo de upload grande, retomada e rascunho

**Scope:** Backend

**Capability:** Transversal — covers: Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** O corpo do vídeo não pode atravessar a API. `docs/project-plan.md` também exige retomada após falha de conexão; uma URL de PUT simples não resolve sozinha o upload máximo. O cliente futuro executará o contrato, mas seu frontend não será implementado nesta fase.

**Options:**

### Option A: Multipart S3 direto com URLs pré-assinadas por parte

- A API cria o rascunho e a sessão; o cliente envia partes ao storage, consulta partes existentes e solicita a conclusão.
- **Pros:** API movimenta apenas controle; retoma partes e usa a API comum a S3 e MinIO.
- **Cons:** mais etapas de contrato; é necessário verificar partes, tamanho real, propriedade e expiração.

### Option B: Serviço tus separado com adaptador S3

- Um serviço de upload oferece retomada pelo protocolo tus e grava no storage.
- **Pros:** protocolo padronizado de retomada e clientes existentes.
- **Cons:** adiciona serviço/adaptador e outra superfície operacional além do storage já exigido.

**Recommendation:** Option A — persistir o rascunho antes de emitir permissões de upload; autorizar por usuário/canal, renovar URLs e conferir o upload no storage ao concluir. O limite em bytes e a recuperação de conclusão repetida devem ser contratos explícitos, não apenas validação de um número enviado pelo cliente. Referências [R4], [R5].

**Decision:** A — Multipart S3 direto com retomada e rascunho persistido antes das permissões.

**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-18 — Defaults operacionais definidos no planejamento, não números ditados pelo enunciado: máximo 10GB decimal (10_000_000_000 bytes), parte de 64MiB, sessão de 24h e URL assinada de até 15min, limitada pela sessão. Conferir ListParts e HeadObject reais antes de processar; recuperar S3 concluído sem commit no banco. Controle JWT por dono do canal, sem aceitar channelId ou chave de objeto do cliente. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## TD-03: Organização e proteção dos objetos S3/MinIO

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** É preciso associar objetos ao vídeo/canal sem confiar em caminhos fornecidos pelo usuário e sem tornar rascunhos publicamente acessíveis. A fase precisa tratar uploads incompletos e arquivos grandes reais.

**Options:**

### Option A: Bucket privado, chaves geradas pelo servidor e acesso mediado

- Separar originais e thumbnails por prefixos; persistir chaves e somente entregar URLs/bytes após a autorização correspondente.
- **Pros:** rascunhos não são públicos e o domínio controla a associação entre mídia e canal.
- **Cons:** exige inicialização do bucket, limpeza de uploads incompletos e gerenciamento de permissões temporárias.

### Option B: Buckets públicos para leitura e chaves aleatórias

- Gravação autenticada com leitura pública dos objetos cujas chaves forem conhecidas.
- **Pros:** leitura direta simples.
- **Cons:** conhecer uma chave contorna a verificação do estado do vídeo; dificulta a evolução de visibilidade na Fase 04.

**Recommendation:** Option A — bucket privado, chaves sem nome de arquivo do usuário, uploads incompletos com descarte definido e objetos finais tratados como imutáveis. URLs assinadas de gravação não devem permitir alterar a mídia de um vídeo já processado. Distinguir endpoint interno do Compose e endpoint acessível ao consumidor externo ao assinar URLs. Referências [R4], [R6].

**Decision:** A — Bucket privado, chaves geradas no servidor e acesso mediado.

**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-18 — Chaves `videos/<uuid>/source` e `videos/<uuid>/thumbnail.jpg`. Nunca expor objetos em draft, processing ou error por rotas públicas. Credenciais e endpoints internos por nomes Compose; endpoint de assinatura externo separado para o consumidor. Abortar uploads vencidos e reconciliar objetos órfãos sem apagar vídeos prontos. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## TD-04: Worker, metadados, thumbnail e formato reproduzível

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** FFmpeg/ffprobe estão previstos na arquitetura. Executá-los no processo HTTP compromete isolamento. Nenhum pacote wrapper de FFmpeg está instalado. Sucesso do upload não significa que o conteúdo seja um vídeo válido ou reproduzível.

**Options:**

### Option A: Worker NestJS standalone com ffprobe/FFmpeg por subprocessos

- Um contexto NestJS sem HTTP, em container separado, consome a fila e usa os binários para metadados e imagem.
- **Pros:** isola recursos e falhas; permite limites de concorrência, prazo de execução e limpeza de temporários.
- **Cons:** requer imagem com os binários e capacidade de disco compatível com o máximo aceito.

### Option B: Worker Node.js dedicado sem bootstrap NestJS

- Um processo Node em container separado consome a fila diretamente e chama os mesmos binários.
- **Pros:** bootstrap menor e independência do servidor HTTP.
- **Cons:** exige compor configuração, persistência e lifecycle fora da injeção de dependência já usada no projeto.

**Recommendation:** Option A — worker separado e sem listener HTTP, com concorrência limitada; `ffprobe` para dados reais e FFmpeg para o frame, sem carregar o vídeo inteiro na memória. Definir formatos/codecs aceitos no planejamento: Range permite transferência parcial, mas não transforma um codec incompatível em mídia reproduzível. Não ampliar a fase para HLS/adaptive bitrate ou transcodificação genérica sem justificativa de escopo. Referências [R7], [R8].

**Decision:** A — Contexto NestJS standalone em container separado, com ffprobe/FFmpeg via subprocessos.

**Libraries:** @nestjs/bullmq, bullmq

**Revisions:**
- 2026-10-18 — Worker baixa para disco por stream com memória limitada; subprocessos sem shell, tempo/saída/concorrência limitados e limpeza finally. ffprobe valida duração finita e stream de vídeo; FFmpeg gera JPEG. Contrato inicial de reprodução progressiva: MP4 com H.264 e áudio AAC opcional, com preparação faststart por remux sem recodificar; conteúdo inválido ou codec fora desse contrato termina em error. O original permanece para download e um objeto `videos/<uuid>/playback.mp4` permite reprodução sem baixar o arquivo inteiro, inclusive quando moov fica no final. Esta é uma delimitação operacional do processamento mínimo e não adiciona HLS ou transcodificação genérica. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## TD-05: Entrega confiável, idempotência e ciclo de status

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** PostgreSQL, Redis e S3 não participam de uma mesma transação. Falhas entre confirmar o objeto, atualizar o vídeo e publicar o job podem deixar uploads sem processamento; jobs podem ser entregues novamente.

**Options:**

### Option A: Outbox transacional e processamento idempotente

- A mudança de estado e a intenção de processamento são persistidas na mesma transação PostgreSQL; um despachante publica o job na fila.
- **Pros:** a intenção sobrevive à queda do Redis; identificadores estáveis e transições condicionais permitem reentrega segura.
- **Cons:** adiciona tabela e rotina de despacho/reconciliação; exige testes de recuperação.

### Option B: Publicação direta com compensação síncrona

- A API atualiza o banco e tenta enfileirar imediatamente, revertendo estado quando percebe uma falha.
- **Pros:** caminho normal mais curto.
- **Cons:** compensação não cobre a queda do processo entre as operações; requer reconciliação adicional para não perder trabalho.

**Recommendation:** Option A — `draft → processing → ready|error`, mantendo `processing` durante tentativas transitórias e `error` em conteúdo inválido ou esgotamento de tentativas. Persistir falha verificável sem expor detalhes sensíveis; preservar identidade do vídeo ao repetir conclusão/jobs. O plano deve cobrir também a janela S3-concluído/DB-não-atualizado. Referências [R1], [R2]; a escolha da outbox é uma inferência arquitetural para fechar essa janela de consistência, não uma capacidade nova do enunciado.

**Decision:** A — Outbox transacional e processador idempotente; draft → processing → ready|error.

**Libraries:** bullmq

**Revisions:**
- 2026-10-18 — Confirmar estado e outbox na mesma transação. Enquanto processing, reconciliar também jobs ausentes após perda do Redis e falhas antes/depois de persistir resultado. Identidade e chaves estáveis, tentativa condicional e lease no banco evitam efeitos concorrentes; o terminal ready exige metadados e ambos os derivados presentes. Defaults operacionais: três tentativas, backoff exponencial iniciado em 2s, concorrência 1; preservar limite de tentativas no banco mesmo se Redis perder dados. Abort/expiração de draft terminam em error com código próprio. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## TD-06: URL única, streaming e download

**Scope:** Backend

**Capability:** Transversal — covers: URL única por vídeo, sem conflito com outros vídeos; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** URLs públicas não devem ser as chaves internas do storage. O acesso a vídeos ainda não prontos deve ser rejeitado. Publicação e visibilidade completas pertencem à Fase 04, portanto a política de acesso inicial precisa ser explícita sem fingir que já existe publicação.

**Options:**

### Option A: URL estável na API que redireciona para GET S3 temporário

- O identificador opaco é protegido por unicidade no banco; a API verifica estado/autorização e entrega redirecionamento assinado.
- **Pros:** bytes são servidos pelo storage; S3 oferece leitura por Range e disposição de download.
- **Cons:** testes/consumidores devem seguir o redirecionamento; exige endpoint externo correto e política de acesso explícita.

### Option B: URL estável com proxy de stream de leitura na API

- A API autoriza e encadeia a resposta S3 ao cliente sem acumular o arquivo completo.
- **Pros:** controle centralizado de 200/206/416 e endpoint único para o consumidor.
- **Cons:** a API também transporta a banda de reprodução/download e precisa tratar cancelamento/backpressure.

**Recommendation:** Option A — identificador aleatório com restrição única e retry de colisão, separado da chave do storage. Entregar mídia somente no estado `ready`; preservar leitura parcial no destino e usar `Content-Disposition: attachment` para download. A matriz de autorização deve decidir se leitura pronta é anônima via URL ou restrita ao dono até a Fase 04; o campo não pode ficar implícito. Referências [R5], [R9].

**Decision:** A — URL estável opaca na API, redirecionada para GET S3 assinado; qualquer pessoa com a URL lê vídeos ready.

**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-18 — Rascunhos e controles de upload são exclusivos do dono. Slug aleatório de 24 caracteres hexadecimais com UNIQUE e retry de colisão usando savepoint quando já houver transação. Rotas públicas respondem 404 para qualquer estado diferente de ready. Resposta da API é 307; 200/206/416 e Range/Content-Range pertencem ao storage de destino, comprovados em teste real. Stream usa playback.mp4 com inline; download usa original com attachment; thumbnail usa JPEG. Sem fluxo de publicação/visibilidade da Fase 04. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## TD-07: Estratégia de prova funcional e infraestrutura real

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** `prompt.md` exige serviços reais em Compose, testes verdes e prova do comportamento. O guia herdado ainda recomenda filesystem local para storage, o que contradiz expressamente este desafio. Há também testes antigos com conexão real ao banco sob sufixo unitário e uso de `synchronize` em helpers; isso precisa ser tratado como conflito identificado, não reproduzido silenciosamente.

**Options:**

### Option A: Serviços reais com namespaces e banco de teste dedicados

- Reaproveitar os serviços do Compose, isolando banco, bucket/prefixos e fila do teste; o worker usa as mesmas configurações de isolamento.
- **Pros:** exercita os contratos exigidos sem duplicar toda a stack.
- **Cons:** exige isolamento e limpeza rigorosos, execução serial e espaço/tempo para a prova integral de 10GB.

### Option B: Stack Compose de teste isolada por projeto

- Subir serviços reais em um projeto Compose exclusivo e descartável, separados do desenvolvimento.
- **Pros:** isolamento de processos e dados mais forte, reduzindo interferência do worker de desenvolvimento.
- **Cons:** duplica recursos e demanda configuração de ciclo de vida/portas mais elaborada.

**Recommendation:** Option A — mocks somente nas unidades; recursos reais nos níveis de integração/e2e, com migrations e execução serial do banco. Separar validação do limite de uma transferência efetiva de 10GB: testar apenas o número declarado não prova a capacidade. Registrar o que foi realmente executado e sua evidência. O requisito específico de `prompt.md` prevalece sobre a recomendação herdada de filesystem local.

**Decision:** A — PostgreSQL, MinIO, Redis e worker reais em testes, com banco/bucket/fila dedicados.

**Libraries:** —

**Revisions:**
- 2026-10-18 — O requisito de prompt.md prevalece sobre filesystem local do guia herdado. Usar migrations, sem synchronize, e testes seriais; worker de teste separado da fila de desenvolvimento. SI-03.1 corrige antes da feature o conflito Jest, o teste de migrations e o lint da base (evidence/baseline-results.json); nenhum gate pode ser enfraquecido. Evidência integral de transferência 10GB é distinta de teste de fronteira do DTO. Herdar Swagger/export OpenAPI do backend, sem frontend. Rationale: materializar a escolha A confirmada pelo usuário e fechar o contrato operacional necessário às capacidades da Fase 03.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Fila de processamento | A — BullMQ + Redis | A |
| TD-02 | Backend | Upload e retomada | A — multipart S3 direto | A |
| TD-03 | Backend | Organização/proteção do storage | A — bucket privado | A |
| TD-04 | Backend | Worker e processamento | A — FFmpeg/ffprobe separado | A |
| TD-05 | Backend | Consistência e status | A — outbox e idempotência | A |
| TD-06 | Backend | Identidade e entrega de mídia | A — URL estável + GET assinado | A |
| TD-07 | Backend | Prova funcional | A — infraestrutura real | A |

## Referências e consultas

| Ref | Fonte primária | Uso |
|-----|----------------|-----|
| R1 | https://docs.bullmq.io/guide/going-to-production | Persistência Redis, noeviction e comportamento de conexão. |
| R2 | https://docs.bullmq.io/patterns/idempotent-jobs | Reprocessamento sem duplicar efeitos. |
| R3 | https://github.com/timgit/pg-boss e https://www.rabbitmq.com/docs/confirms | Alternativas de fila e confirmação de entrega. |
| R4 | https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html | Iniciar, enviar partes, concluir/abortar e retomar multipart. |
| R5 | https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html | Range e disposição de conteúdo. |
| R6 | https://github.com/minio/minio/tree/master/docs | API S3 compatível e administração do storage. |
| R7 | https://docs.nestjs.com/techniques/queues e https://docs.nestjs.com/standalone-applications | Integração BullMQ e processo NestJS sem servidor HTTP. |
| R8 | https://ffmpeg.org/ffprobe.html e https://ffmpeg.org/ffmpeg-all.html | Dados JSON e extração de imagens. |
| R9 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner | Assinatura das operações S3 com SDK v3. |

IDs consultados via Context7 MCP: `/taskforcesh/bullmq`, `/aws/aws-sdk-js-v3`, `/nestjs/docs.nestjs.com`, `/websites/ffmpeg_documentation` e `/minio/minio`. A busca por pg-boss retornou `/websites/deepwiki_timgit_pg-boss`; por ser uma fonte secundária, ela não fundamenta a comparação, que usa o repositório primário R3.

Versões herdadas verificadas no lockfile: NestJS core **11.1.16**, TypeORM **0.3.28**, TypeScript **5.9.3** e Jest **30.3.0**. Novas dependências ainda não foram instaladas; as versões exatas selecionadas, compatibilidade e limites da evidência documental estão em `library-refs.md`. A documentação de branch principal não comprova por si só a API de uma versão instalada.
