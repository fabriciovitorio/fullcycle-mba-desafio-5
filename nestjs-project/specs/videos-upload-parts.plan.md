---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5.5
target_file: nestjs-project/test/videos-upload-parts.e2e-spec.ts
---

# Endpoint POST /videos/:id/upload/parts Test Plan

## Application Overview

Emite permissões temporárias de UploadPart diretamente ao storage, com propriedade, tamanho e prazo limitados. Origem: § API Contracts → POST /videos/:id/upload/parts e SI-03.5.5.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.5.5, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. POST /videos/:id/upload/parts

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Criar sessão draft de A com duas partes esperadas, de tamanhos conhecidos, e JWTs reais de A/B. Disponibilizar leitura de ListParts e acesso HTTP direto ao endpoint de assinatura pela rede Compose. Isolar o worker para testar claims/expiração sem limpeza concorrente; não armazenar o arquivo completo na memória.

#### 1.1. assinar-partes-e-enviar-direto-ao-storage

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/parts com JWT de A e { partNumbers: [1, 2] }.
    - expect: Retorna 200 com duas entradas { partNumber, url, expiresAt, headers: { 'Content-Length': string } }.
    - expect: Content-Length corresponde ao tamanho de cada parte, incluindo a última menor; a origem é a configurada para o consumidor.
    - expect: Cada assinatura expira em até 900s e nunca depois do prazo absoluto da sessão.
  2. Enviar uma das partes por PUT diretamente à URL retornada, com o comprimento correspondente; consultar ListParts real.
    - expect: O storage recebe a parte e retorna ETag verificável; a API não transporta esses bytes.

#### 1.2. rejeitar-lotes-e-numeros-invalidos

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/parts autenticado, em casos independentes, com duplicatas, mais de 50 entradas ou número fora de 1..partCount.
    - expect: Cada caso retorna 400 VALIDATION_ERROR.
    - expect: Nenhum caso recebe URL assinada e o estado/sessão permanecem íntegros.

#### 1.3. impedir-assinatura-para-outro-canal

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/parts com JWT de B e { partNumbers: [1] }.
    - expect: Retorna 404 VIDEO_NOT_FOUND e não retorna URL ou informações da sessão.

#### 1.4. exigir-autenticacao-para-assinar

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/parts sem JWT, com corpo válido.
    - expect: Retorna 401 no formato herdado; nenhuma permissão é emitida.

#### 1.5. rejeitar-claim-em-andamento

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Preparar sessão draft com claim completing ou aborting vigente e emitir POST /videos/:id/upload/parts como dono.
    - expect: Retorna 409 UPLOAD_OPERATION_IN_PROGRESS.
    - expect: Não emite URL de uma sessão que está sendo concluída/abortada.

#### 1.6. limitar-sessao-vencida-e-validar-parametro

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/parts com id não UUID e JWT válido.
    - expect: Retorna 400 VALIDATION_ERROR.
  2. POST /videos/:id/upload/parts do dono para sessão draft vencida.
    - expect: Retorna 410 UPLOAD_EXPIRED sem renovar autorização.
