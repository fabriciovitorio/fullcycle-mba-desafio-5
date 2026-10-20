---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8.2
target_file: nestjs-project/test/videos-details.e2e-spec.ts
---

# Endpoint GET /videos/:slug Test Plan

## Application Overview

Expõe somente a projeção pública de um vídeo ready, com URLs estáveis da API. Origem: § API Contracts → GET /videos/:slug e SI-03.8.2; acesso anônimo confirmado em TD-06.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.8.2, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. GET /videos/:slug

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Preparar fixture ready com original, MP4 faststart e JPEG reais no MinIO e metadados consistentes no PostgreSQL, além de fixtures draft/processing/error. Manter objetos das fixtures não prontas privados. JWTs reais de dono/outro canal permitem comparar acesso sem alterar a política pública. Fixtures de estado no HTTP não substituem a prova de processamento completo de SI-03.9.1.

#### 1.1. consultar-video-pronto-sem-jwt

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:slug de fixture ready, sem Authorization.
    - expect: Retorna 200 com slug, title, durationSeconds, sizeBytes, metadata, streamUrl, downloadUrl e thumbnailUrl.
    - expect: metadata contém container/videoCodec/audioCodec/width/height/frameRate, com valores coerentes à fixture; sizeBytes representa o original real.
    - expect: Não serializa id privado, channel_id, upload_id, errorCode, source_key, playback_key, thumbnail_key ou segredos.

#### 1.2. permitir-leitura-por-outro-usuario

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Consultar o mesmo slug ready com JWT do dono e de outro canal.
    - expect: Ambos recebem 200 com a mesma projeção pública; não há requisito de ser dono.

#### 1.3. ocultar-slug-ausente-invalido-e-nao-pronto

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:slug sem JWT para slug inexistente, slug inválido e fixtures draft/processing/error, em casos independentes.
    - expect: Todos retornam 404 VIDEO_NOT_FOUND, sem metadados ou permissões de leitura.
    - expect: Usar também JWT do dono para as fixtures não prontas mantém 404 nesta rota pública.

#### 1.4. manter-urls-estaveis-da-api

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Repetir GET /videos/:slug ready, sem JWT.
    - expect: streamUrl/downloadUrl/thumbnailUrl permanecem as mesmas rotas da API com o slug do vídeo.
    - expect: As URLs públicas de metadados não são assinaturas S3 persistidas nem contêm query de autorização temporária.
