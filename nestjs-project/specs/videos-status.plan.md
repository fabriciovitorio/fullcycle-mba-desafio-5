---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5.8
target_file: nestjs-project/test/videos-status.e2e-spec.ts
---

# Endpoint GET /videos/:id/status Test Plan

## Application Overview

Entrega ao dono o acompanhamento privado de qualquer estado, com código de falha seguro. Origem: VideoStatusDto, § API Contracts → GET /videos/:id/status e SI-03.5.8.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.5.8, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. GET /videos/:id/status

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Preparar A/B e fixtures válidas nos quatro estados persistidos; ready contém os derivados/metadados exigidos e error contém código/mensagem segura. Registrar id/slug e timestamps. Nenhum guard, repositório ou serviço de domínio é substituído por mock.

#### 1.1. consultar-todos-os-estados-como-dono

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:id/status com JWT de A, em casos independentes para draft, processing, ready e error.
    - expect: Cada caso retorna 200 com exatamente a projeção VideoStatusDto: id, slug, status, errorCode, createdAt e updatedAt.
    - expect: Identidade/estado correspondem ao registro real; timestamps são ISO8601.

#### 1.2. retornar-codigo-seguro-sem-detalhes-internos

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Consultar fixture sem falha e fixture error via GET /videos/:id/status autenticado.
    - expect: Sem falha errorCode é null; em error contém o código seguro persistido, como PROCESSING_FAILED.
    - expect: Nenhuma resposta contém stderr, stack, caminhos, credenciais, upload_id ou chaves de storage.

#### 1.3. exigir-jwt-para-estado-privado

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:id/status sem Authorization.
    - expect: Retorna 401 no formato herdado, sem informações do vídeo.

#### 1.4. ocultar-estado-de-outro-canal

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:id/status de A com JWT de B.
    - expect: Retorna 404 VIDEO_NOT_FOUND em qualquer estado, inclusive ready.
    - expect: A permissão pública para mídia pronta não concede acesso ao status privado.

#### 1.5. validar-identificador-do-status

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/identificador-invalido/status com JWT válido.
    - expect: Retorna 400 VALIDATION_ERROR no envelope global de validação.
