---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5.4
target_file: nestjs-project/test/videos-upload-resume.e2e-spec.ts
---

# Endpoint GET /videos/:id/upload Test Plan

## Application Overview

Consulta a sessão draft do dono e lista partes realmente existentes, permitindo retomada sem nova identidade. Origem: § API Contracts → GET /videos/:id/upload e SI-03.5.4.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.5.4, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. GET /videos/:id/upload

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Criar sessão draft de A e enviar ao menos uma parte válida diretamente ao MinIO por stream; manter outra parte esperada ausente. Guardar ETag/tamanho observados no storage, id/slug e quantidade de sessões. Preparar usuário B com token real; pausar o reconciliador nos cenários que precisam manter sessão vencida.

#### 1.1. listar-partes-reais-e-preservar-sessao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:id/upload com JWT de A para a sessão parcialmente enviada.
    - expect: Retorna 200 com video draft e upload { partSizeBytes, partCount, expiresAt, parts }.
    - expect: Cada partNumber/sizeBytes/etag coincide com o ListParts real; a parte não enviada não aparece.
  2. Repetir GET /videos/:id/upload com o mesmo JWT.
    - expect: id, slug e prazo absoluto são preservados; não cria outra sessão nem outra intenção de processamento.

#### 1.2. ocultar-sessao-de-outro-canal

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:id/upload com JWT de B.
    - expect: Retorna 404 com error VIDEO_NOT_FOUND e envelope de domínio { statusCode, error, message }.
    - expect: Não devolve partes, upload_id, URL assinada ou qualquer dado da sessão de A.

#### 1.3. exigir-jwt-na-retomada

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:id/upload sem Authorization.
    - expect: Retorna 401 no formato herdado; não devolve partes ou permissões.

#### 1.4. informar-expiracao-sem-objeto-concluido

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Usar sessão draft com upload_expires_at passado, sem objeto final e sem cleanup concorrente; GET /videos/:id/upload com JWT do dono.
    - expect: Retorna 410 com error UPLOAD_EXPIRED.
    - expect: Não renova silenciosamente a sessão nem cria uma nova identidade.

#### 1.5. validar-uuid-e-estado-da-retomada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/identificador-invalido/upload autenticado.
    - expect: Retorna 400 VALIDATION_ERROR.
  2. GET /videos/:id/upload do dono com fixture em processing ou ready.
    - expect: Retorna 409 INVALID_VIDEO_STATE; a consulta desses estados deve usar /status.
