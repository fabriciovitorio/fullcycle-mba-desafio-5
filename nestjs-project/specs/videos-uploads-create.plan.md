---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5.3
target_file: nestjs-project/test/videos-uploads-create.e2e-spec.ts
---

# Endpoint POST /videos/uploads Test Plan

## Application Overview

Inicia a sessão multipart do dono do canal e retorna o rascunho antes da transferência direta ao storage. Derivado de § API Contracts → POST /videos/uploads e dos três critérios de SI-03.5.3. A fronteira numérica de 10GB não substitui a transferência integral exigida em SI-03.9.2.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.5.3, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. POST /videos/uploads

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Preparar dois usuários confirmados, canais distintos e tokens reais; storage real sem sessões prévias do caso. Usar title/fileName/contentType válidos, fixture MP4 pequena com tamanho conhecido e worker de teste parado ou ocioso. Em cada cenário, comparar os registros e sessões do namespace antes/depois, sem depender de banco vazio de desenvolvimento.

#### 1.1. criar-rascunho-no-canal-autenticado

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/uploads com JWT do usuário A e JSON { title, fileName, contentType: 'video/mp4', sizeBytes } da fixture.
    - expect: Retorna 201 com video.id UUID, slug hexadecimal de 24 caracteres, status draft, errorCode null e timestamps ISO8601.
    - expect: upload contém partSizeBytes 67108864, partCount coerente com o tamanho declarado e expiresAt futuro dentro da sessão de 24h.
  2. Consultar PostgreSQL e ListMultipartUploads no namespace de teste.
    - expect: O vídeo pertence ao canal de A, uma sessão multipart está persistida e ainda não há outbox de processamento.
    - expect: A resposta não serializa upload_id, source_key, credenciais ou entidades; nenhum binário foi enviado à API.

#### 1.2. aceitar-limite-declarado-sem-transferir-binario

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/uploads autenticado com sizeBytes 10_000_000_000 e demais campos válidos.
    - expect: Retorna 201 com status draft e partCount 150; o objeto final ainda não existe.
    - expect: O cenário prova a fronteira declarada; não deve ser registrado como prova de transferência real de 10GB.

#### 1.3. rejeitar-tamanho-acima-do-teto

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/uploads com JWT válido e sizeBytes 10_000_000_001.
    - expect: Retorna 400 com { statusCode: 400, error: 'VALIDATION_ERROR', message: string[] }.
    - expect: Não cria vídeo, sessão nem intenção de processamento para a requisição rejeitada.

#### 1.4. rejeitar-canal-forjado-no-body

**Covers AC:** #2, #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/uploads com JWT de A, corpo válido acrescido de channelId do canal B.
    - expect: Retorna 400 VALIDATION_ERROR por forbidNonWhitelisted.
    - expect: Não cria vídeo em nenhum dos canais nem sessão multipart.

#### 1.5. rejeitar-ausencia-e-invalidade-de-jwt

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/uploads com corpo válido, primeiro sem Authorization e depois com JWT inválido.
    - expect: Cada requisição retorna 401 no formato real do guard herdado, sem inventar código de domínio.
    - expect: Não cria rascunho nem concede permissão S3.

#### 1.6. preservar-throttling-da-criacao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Em aplicação com estado de throttler isolado, executar dez POST /videos/uploads válidos a partir da mesma origem.
    - expect: As dez requisições retornam 201, com identidades distintas e rascunhos no canal do usuário.
  2. Executar o décimo primeiro POST válido na mesma janela, sem reiniciar o guard/armazenamento.
    - expect: Retorna 429 conforme o guard real e não cria uma décima primeira sessão.
    - expect: O limite é o default de 10/min de § Validation Rules; não usar guard falso nem sleep de um minuto.
