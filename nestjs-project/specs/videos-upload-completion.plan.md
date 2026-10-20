---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5.6
target_file: nestjs-project/test/videos-upload-completion.e2e-spec.ts
---

# Endpoint POST /videos/:id/upload/completion Test Plan

## Application Overview

Confirma o objeto real e aceita processamento assíncrono com replay seguro. Origem: § API Contracts → POST /videos/:id/upload/completion e SI-03.5.6. As falhas detalhadas entre S3, banco e Redis continuam com seus testes de integração próprios; aqui se verifica o contrato HTTP e os efeitos persistidos.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.5.6, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. POST /videos/:id/upload/completion

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Criar sessões multipart reais com tamanhos conhecidos e JWTs de A/B. Para observar processing, parar o consumidor/reconciliador do namespace antes da operação e aguardar inatividade; não fazer corrida de polling contra um worker ativo. Para ready usar fixture consistente com objetos reais e intenção já concluída. Pré-condições de tamanho divergente devem existir de fato no storage; sem mockar o SDK.

#### 1.1. concluir-upload-valido-e-persistir-intencao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Enviar todas as partes corretas diretamente ao MinIO e POST /videos/:id/upload/completion autenticado, sem corpo.
    - expect: Retorna 202 com { video } em status processing, mesma id/slug e errorCode null.
  2. Consultar HeadObject e PostgreSQL.
    - expect: actual_size_bytes corresponde ao objeto real e ao declarado; existe exatamente uma outbox para o vídeo.
    - expect: O objeto original contém os bytes enviados; não depende de Redis disponível para persistir a intenção.

#### 1.2. repetir-conclusao-em-processing

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Após a primeira conclusão, repetir POST /videos/:id/upload/completion com o consumidor parado.
    - expect: Retorna 202 com a mesma identidade e status processing.
    - expect: Há uma única outbox e não se inicia outro multipart nem novo vídeo.

#### 1.3. repetir-conclusao-em-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/completion como dono para fixture ready já processada.
    - expect: Retorna 200 com a mesma id/slug e status ready.
    - expect: Não altera chaves publicadas, contagem de outbox ou orçamento de processamento.

#### 1.4. rejeitar-parte-ausente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Deixar uma parte obrigatória ausente e POST /videos/:id/upload/completion como dono.
    - expect: Retorna 409 com error UPLOAD_INCOMPLETE.
    - expect: Não entra em processing nem cria outbox; a sessão continua retomável.

#### 1.5. rejeitar-tamanho-real-divergente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Preparar no MinIO real uma sessão cujo conteúdo diverge do tamanho declarado, usando cliente S3 autenticado do fixture quando a assinatura de parte impedir o envio divergente; POST /videos/:id/upload/completion como dono.
    - expect: Retorna 409 UPLOAD_SIZE_MISMATCH; não cria intenção de processamento.
    - expect: Não publica nem libera leitura de objeto divergente; descarte/compensação segue o contrato recuperável.

#### 1.6. proteger-conclusao-e-validar-identificador

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. POST /videos/:id/upload/completion de sessão de A com JWT de B; repetir sem JWT, em requisições independentes.
    - expect: Outro canal recebe 404 VIDEO_NOT_FOUND e ausência de JWT recebe 401; nenhum dos dois muda o estado.
  2. POST /videos/identificador-invalido/upload/completion com JWT válido.
    - expect: Retorna 400 VALIDATION_ERROR.
