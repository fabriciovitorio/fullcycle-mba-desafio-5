---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5.7
target_file: nestjs-project/test/videos-upload-abort.e2e-spec.ts
---

# Endpoint DELETE /videos/:id/upload Test Plan

## Application Overview

Aborta a sessão draft do dono e persiste UPLOAD_ABORTED, com replay 204. Não representa exclusão de vídeo da Fase 04. Origem: § API Contracts → DELETE /videos/:id/upload e SI-03.5.7.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.5.7, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. DELETE /videos/:id/upload

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Criar sessão draft real de A com ao menos uma parte no MinIO e tokens de A/B. Preparar também fixtures processing/ready coerentes; não executar cleanup concorrente durante as observações do abort. Guardar o identificador multipart e uma URL de parte já emitida para verificar revogação no storage.

#### 1.1. abortar-draft-e-revogar-sessao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. DELETE /videos/:id/upload com JWT de A.
    - expect: Retorna 204 sem corpo; o registro do vídeo permanece existente.
  2. Consultar estado privado e sessão no storage.
    - expect: Status é error com errorCode UPLOAD_ABORTED, sem outbox de processamento.
    - expect: O UploadId abortado não aceita nova parte pela URL emitida anteriormente.

#### 1.2. repetir-abort-sem-efeitos-adicionais

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Repetir DELETE /videos/:id/upload após abort bem-sucedido.
    - expect: Retorna novamente 204 sem corpo.
    - expect: Preserva id/slug/error_code e não cria sessão nem intenção nova.

#### 1.3. recusar-abort-de-video-em-processamento-ou-pronto

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. DELETE /videos/:id/upload do dono, em casos independentes, para fixtures processing e ready.
    - expect: Cada caso retorna 409 INVALID_VIDEO_STATE.
    - expect: O estado e os objetos publicados permanecem intactos.

#### 1.4. ocultar-video-de-outro-canal

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. DELETE /videos/:id/upload de A usando JWT de B.
    - expect: Retorna 404 VIDEO_NOT_FOUND.
    - expect: O vídeo de A continua draft e a sessão multipart continua utilizável por A.

#### 1.5. exigir-jwt-e-validar-uuid

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. DELETE /videos/:id/upload sem JWT.
    - expect: Retorna 401 sem abortar a sessão.
  2. DELETE /videos/identificador-invalido/upload autenticado.
    - expect: Retorna 400 VALIDATION_ERROR sem alterar qualquer vídeo.
