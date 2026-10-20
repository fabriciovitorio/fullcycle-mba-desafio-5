---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8.4
target_file: nestjs-project/test/videos-download.e2e-spec.ts
---

# Endpoint GET /videos/:slug/download Test Plan

## Application Overview

Permite download público do original de um vídeo ready por assinatura temporária, preservando nome seguro e integridade. Origem: § API Contracts → GET /videos/:slug/download e SI-03.8.4.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.8.4, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. GET /videos/:slug/download

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Preparar ready com original pequeno conhecido, hash calculado independentemente no fixture e playback diferente. Usar nome-base válido com caracteres Unicode em um caso, sem caminhos. Preparar estados privados. Seguir Location por HTTP real e calcular hash incremental dos bytes recebidos, sem usar resultado do próprio serviço como valor esperado.

#### 1.1. redirecionar-download-sem-jwt

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:slug/download ready, sem JWT e sem seguir redirect automaticamente.
    - expect: Retorna 307 com Location temporário do original e Cache-Control: no-store.
    - expect: O acesso não depende de ser dono; não redireciona para playback.mp4.

#### 1.2. entregar-attachment-com-nome-seguro

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Seguir Location de download por HTTP real.
    - expect: O storage responde com Content-Disposition attachment e nome-base seguro correspondente à fixture.
    - expect: Não há CR/LF ou caminho no filename; o caso Unicode é representado por filename* quando necessário.

#### 1.3. preservar-tamanho-e-hash-do-original

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Baixar o corpo completo da fixture pequena por stream, somando bytes e calculando hash incremental.
    - expect: O tamanho recebido coincide com o original enviado e com HeadObject.
    - expect: O hash coincide com o hash independente do arquivo antes do upload, mesmo quando o playback é diferente.
    - expect: Este cenário usa fixture pequena; a prova integral de 10GB continua obrigatória em SI-03.9.2.

#### 1.4. negar-download-antes-de-ready

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:slug/download para draft, processing, error e slug inexistente, em casos independentes.
    - expect: Retorna 404 VIDEO_NOT_FOUND, sem Location de download.
    - expect: Conhecer o slug do original não concede leitura de vídeo não pronto.
