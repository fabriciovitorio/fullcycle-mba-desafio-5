---
libs:
  '@nestjs/bullmq':
    version: 11.0.5
    context7_id: /nestjs/bull
    fetched_at: '2026-10-18T16:00:38.972001118+00:00'
  bullmq:
    version: 5.81.5
    context7_id: /websites/api_bullmq_io
    fetched_at: '2026-10-18T16:00:38.895909897+00:00'
  '@aws-sdk/client-s3':
    version: 3.1152.0
    context7_id: /aws/aws-sdk-js-v3
    fetched_at: '2026-10-18T15:13:37.507645975+00:00'
  '@aws-sdk/s3-request-presigner':
    version: 3.1152.0
    context7_id: /aws/aws-sdk-js-v3
    fetched_at: '2026-10-18T15:13:37.507645975+00:00'
  typeorm:
    version: 0.3.28
    context7_id: /typeorm/typeorm
    fetched_at: '2026-10-18T16:00:38.832001111+00:00'
  '@nestjs/swagger':
    version: 11.4.2
    context7_id: /nestjs/swagger
    fetched_at: '2026-10-18T16:00:38.768084290+00:00'
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: '2026-10-18T15:21:27.234386417+00:00'
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: '2026-10-04T23:48:24.088685201+00:00'
---

# Phase 03 — Library references

Consulta efetiva via Context7 MCP em 2026-10-18: resolve-library-id antes de query-docs. Evidências brutas em `evidence/library-*.json`; pesquisa inicial em `evidence/context7-*.json`. Metadados npm e integridades são preservados em `evidence/library-versions.json`. `fetched_at` corresponde à gravação da resposta consultada, não a uma data inferida.

## Versions and compatibility

| Library | Version | State / compatibility |
|---|---|---|
| @nestjs/bullmq | 11.0.5 | Nova, ainda não instalada; peers Nest 10/11 e BullMQ 3/4/5/6 |
| bullmq | 5.81.5 | Nova, ainda não instalada; Node >=12.22 |
| @aws-sdk/client-s3 | 3.1152.0 | Nova, ainda não instalada; Node >=20 |
| @aws-sdk/s3-request-presigner | 3.1152.0 | Nova, ainda não instalada; Node >=20; mesma versão do client |
| typeorm | 0.3.28 | Existente no lockfile; não atualizar nesta fase |
| @nestjs/swagger | 11.4.2 | Existente no lockfile; não atualizar nesta fase |

Runtime verificado: Node 25.6.0, npm 11.8.0, Nest core 11.1.16. Versões novas são alvos exatos de instalação; só o lockfile e testes após instalação comprovam a resolução final. O peer npm `redis >=5` apresentado nos metadados de BullMQ não é o requisito de versão do servidor Redis.

**Discrepância documental detectada:** a resolução genérica `/taskforcesh/bullmq` anuncia v6.3.11. Não usar exemplos exclusivos de v6 (por exemplo, novas assinaturas de cancelamento). A consulta adicional `/websites/api_bullmq_io` retornou páginas explicitamente `v5.*`; os fontes da tag `v5.81.5` confirmam jobId/attempts/backoff, WorkerOptions e UnrecoverableError. URLs e hashes em `evidence/library-version-source-evidence.json`. O bloco Context7 que descreve Queue.add como HTTP é uma representação gerada inadequada: usar o método TypeScript, nunca uma suposta API REST do broker.

As demais consultas Context7 apontam branches mantidas, não snapshots garantidos da versão exata. Antes de usar cada API, conferir tipos da versão instalada e executar seus testes contratuais; não atualizar dependências herdadas para imitar exemplos atuais. TypeORM nas docs atuais apresenta mudanças de layout de repositório; a implementação deve preservar APIs 0.3.28 e os padrões já instalados.

## S3 multipart and presigning

IDs: `/aws/aws-sdk-js-v3`. Fontes: [SDK presigner](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner), [multipart S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

APIs a usar: S3Client; CreateMultipartUploadCommand; UploadPartCommand com UploadId/PartNumber/ContentLength; ListPartsCommand com paginação; CompleteMultipartUploadCommand com partes/ETags reais; AbortMultipartUploadCommand; HeadObjectCommand; GetObjectCommand e PutObjectCommand para derivados. `getSignedUrl(client, command, { expiresIn })`; clientes internos e de assinatura compartilham região/bucket/credenciais, com endpoints separados e forcePathStyle no MinIO.

ListParts não pode ser substituído por uma lista do cliente. O total e o tamanho das partes são conferidos no storage; HeadObject verifica o objeto concluído. ContentLength deve ser incluído na assinatura e provado com MinIO; se o storage aceitar tamanho divergente, a conclusão deve rejeitar/abortar e nunca enfileirar. Nenhuma URL arbitrária de PutObject para sobrescrever original final.

SDK v3 adiciona checksums automaticamente em algumas operações. A consulta confirmou `requestChecksumCalculation`/`responseChecksumValidation` e `WHEN_REQUIRED` como alternativa de compatibilidade S3, sem fingir checksum do multipart inteiro. Definir explicitamente no adaptador e testar uploads reais; não deixar headers extras implícitos quebrarem a URL do consumidor.

GetObject suporta Range e ResponseContentDisposition. A API entrega 307 Location; o storage serve bytes 200/206/416. Não assinar um Range fixo quando o consumidor precisa de seek posterior. CORS do storage deve permitir GET/HEAD/PUT e expor ETag, Content-Length, Content-Range e Accept-Ranges para a origem configurada.

## Queue and standalone Nest worker

IDs: `/nestjs/bull`, `/nestjs/docs.nestjs.com`, `/websites/api_bullmq_io`. Fontes: [Nest queues](https://docs.nestjs.com/techniques/queues), [standalone](https://docs.nestjs.com/standalone-applications), [BullMQ v5 WorkerOptions](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html), [idempotência](https://docs.bullmq.io/patterns/idempotent-jobs).

BullModule.forRootAsync/registerQueue; @Processor + WorkerHost.process; @OnWorkerEvent; NestFactory.createApplicationContext e shutdown hooks. O worker importa seu próprio módulo, sem controllers nem listener HTTP. A API não registra @Processor.

Queue.add recebe job name, payload e options. jobId igual deduplica enquanto o job existe; remover completed/failed permite nova inclusão, portanto banco/outbox devem garantir idempotência. `attempts: 3`, `backoff: { type: 'exponential', delay: 2000 }`; falha de conteúdo usa UnrecoverableError após persistência terminal. Não confiar somente no evento failed para gravar o erro: reconciliação deve cobrir queda do processo/banco. Redis persistente com noeviction e reconexão adequada ao produtor/consumidor.

## FFmpeg, ffprobe, MinIO and Redis

Dependências de sistema/containers, não pacotes npm adicionais. Sem fluent-ffmpeg. Context7 consultou `/websites/ffmpeg_documentation` e `/minio/minio`; fontes [ffprobe](https://ffmpeg.org/ffprobe.html), [FFmpeg](https://ffmpeg.org/ffmpeg-all.html), [MinIO](https://github.com/minio/minio/tree/master/docs). A saída JSON/streams permite extrair duração, dimensões, codecs e taxa de quadros; selecionar apenas campos limitados para persistência. Remux MP4 com `-c copy -movflags +faststart` prepara reprodução progressiva; FFmpeg gera um frame JPEG.

Versões binárias, tags/digests de imagens e espaço necessário serão verificados na SI de infraestrutura e registrados na evidência. Não há imagens novas instaladas nem versão inventada neste cache. Conferir ffmpeg -version/ffprobe -version e comandos efetivamente disponíveis antes de implementar processamento; limites de tempo, threads, protocolo e saída em subprocessos sem shell.

## Transactions, migrations and OpenAPI inherited

Context7: `/typeorm/typeorm` e `/nestjs/swagger`. Fontes [TypeORM transactions](https://typeorm.io/docs/advanced-topics/transactions/), [Nest OpenAPI operations](https://docs.nestjs.com/openapi/operations).

QueryRunner connect/startTransaction/commitTransaction/rollbackTransaction/release; usar o mesmo manager na transação. PostgreSQL exige SAVEPOINT por tentativa quando há retry de colisão; seleção de despacho pode usar pessimistic_write + skip_locked. migration:generate compara entidades com schema real; revisar e testar up/down preservando migrations executadas. `synchronize: false` em todos os ambientes por regra local.

OpenAPI herdado inclui ApiOperation, ApiResponse por status, ApiProperty em DTOs de resposta, ApiParam/ApiBody e envelope de erro existente. O plugin não documenta respostas completas sozinho. Preservar UI condicionada por configuração e exportação de openapi.json; gerar a spec no container sem acoplar autenticação pública de vídeos à UI Swagger. Nada de codegen/frontend nesta fase.

## Library lookup index

Os blocos abaixo fornecem os cabeçalhos literais exigidos por plan-build B2.5/B4. Usam as consultas e versões já registradas neste cache; não representam nova consulta nem instalação.

### @nestjs/bullmq

Alvo 11.0.5; Context7 `/nestjs/bull`, evidência `evidence/library-nestjs-bull-api.json`. Usar BullModule.forRootAsync/registerQueue, Processor, WorkerHost e OnWorkerEvent conforme § Queue and standalone Nest worker. Nest core existente 11.1.16 satisfaz os peers declarados. Consumidor apenas no módulo standalone; a API não importa processadores.

### bullmq

Alvo 5.81.5; Context7 `/websites/api_bullmq_io`, evidência `evidence/library-bullmq-v5-api.json` e fontes da tag em `evidence/library-version-source-evidence.json`. Queue.add, jobId, attempts, backoff, UnrecoverableError e recuperação conforme § Queue and standalone Nest worker. Banco/outbox preservam orçamento e idempotência após perda de jobs; não usar assinaturas exclusivas de v6.

### @aws-sdk/client-s3

Alvo 3.1152.0; Context7 `/aws/aws-sdk-js-v3`, evidência `evidence/library-aws-multipart.json`. Comandos e configuração conforme § S3 multipart and presigning. ListParts paginado e HeadObject verificam bytes reais. Derivados grandes também exigem multipart; PutObject fica limitado a objetos pequenos, como JPEG, sem buffer integral do vídeo.

### @aws-sdk/s3-request-presigner

Alvo 3.1152.0, mesmo alvo do client; Context7 `/aws/aws-sdk-js-v3`, evidência `evidence/library-aws-multipart.json`. getSignedUrl com expiresIn explícito, assinatura do tamanho de cada parte e endpoint acessível pelo consumidor. GET temporário admite Range posterior; não persistir URL assinada no banco.

### typeorm

Instalado 0.3.28; Context7 `/typeorm/typeorm`, evidência `evidence/library-typeorm-transactions.json`. Transações curtas com mesmo manager, savepoints em colisões e claims condicionais conforme § Transactions, migrations and OpenAPI inherited. Gerar migration pela CLI e manter synchronize:false, inclusive nos testes; conferir API nos tipos instalados por divergência de branch documental.

### @nestjs/swagger

Instalado 11.4.2; Context7 `/nestjs/swagger`, evidência `evidence/library-swagger-contracts.json`. Decoradores explícitos de operação/resposta e ApiProperty em DTOs de resposta, com exportação existente. Preservar envelope herdado e distinguir 307 da API de 206 do storage; sem mudanças no frontend.
