---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8.3
target_file: nestjs-project/test/videos-stream.e2e-spec.ts
---

# Endpoint GET /videos/:slug/stream Test Plan

## Application Overview

Autoriza mídia ready por redirecionamento 307 para o MP4 progressivo privado. Origem: § API Contracts → GET /videos/:slug/stream e SI-03.8.3. 200/206/416 pertencem ao GET no storage, e não à resposta da API.

Fonte: [plano da Fase 03](../../docs/phases/phase-03-videos/phase-03-videos.md), SI-03.8.3, § API Contracts / Authorization Matrix / Error Catalog. Este arquivo especifica execução futura; não declara testes executados ou aprovados.

## Test Scenarios

### 1. GET /videos/:slug/stream

**Setup:** Executar somente em containers, com Jest + Supertest e --runInBand. Inicializar a aplicação real por Test.createTestingModule({ imports: [AppModule] }), reproduzindo ValidationPipe global (whitelist, forbidNonWhitelisted, transform), DomainExceptionFilter, ValidationExceptionFilter, guard JWT e throttler reais; Test.createTestingModule não executa main.ts. Usar PostgreSQL migrado com synchronize:false, MinIO/Redis reais e DB/bucket/prefixo de fila dedicados, preparados em SI-03.1.1/SI-03.2.2. Os contratos HTTP privados não exigem worker implementado: suas fixtures de estado são inseridas no banco real com objetos reais consistentes, sem fingir processamento; o fluxo completo é provado em SI-03.9.1. Se o worker já estiver ativo após SI-03.7.3, isolá-lo do prefixo deste arquivo ou pausá-lo e aguardar inatividade antes do cleanup. Antes de cada cenário, isolar o estado do throttler e limpar recursos na ordem das FKs sem tocar desenvolvimento. Fixtures de usuários/canais e JWTs reais seguem o auth existente. Encerrar aplicação, conexões e streams no teardown; não mascarar handles com forceExit. As interfaces/helpers a implementar são responsabilidades dos SIs do plano, não arquivos já existentes.

Preparar ready com original e playback faststart diferentes e conhecidos no MinIO, tamanho/bytes/hash do playback registrados pelo fixture; preparar vídeos não prontos. Fazer Supertest sem seguir redirect automaticamente e realizar a segunda requisição ao Location por HTTP real a partir da rede Compose. Não fixar Range na assinatura e não usar mock de S3.

#### 1.1. redirecionar-stream-anonimo-para-playback

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:slug/stream ready, sem JWT e sem seguir redirect.
    - expect: A API retorna 307, Location temporário e Cache-Control: no-store.
    - expect: Location autoriza o playback publicado, com expiração até 15min; não autoriza o original.
  2. Seguir Location sem Range.
    - expect: O storage responde 200, Content-Type video/mp4 e Content-Disposition inline.
    - expect: Bytes/tamanho correspondem ao playback da fixture e sua estrutura MP4 tem moov antes de mdat.

#### 1.2. ler-range-simples-e-suffix-no-storage

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. Obter Location da API e usá-lo em GET real com Range: bytes=0-1023.
    - expect: O storage retorna 206, Content-Range: bytes 0-1023/<tamanho real> e exatamente 1024 bytes iguais ao trecho conhecido.
    - expect: Accept-Ranges indica bytes; a transferência parcial é menor que o objeto.
  2. Usar o mesmo Location com Range: bytes=-512.
    - expect: O storage retorna 206, os 512 últimos bytes e Content-Range correspondente ao tamanho conhecido.
    - expect: A assinatura permite outro Range sem nova URL da API.

#### 1.3. rejeitar-range-fora-do-objeto-no-destino

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET ao Location válido com Range iniciando depois do último byte do playback.
    - expect: O storage retorna 416 e não entrega um corpo de vídeo como sucesso.
    - expect: A API continuou respondendo 307 e não foi confundida com o servidor dos bytes.

#### 1.4. nao-assinar-stream-de-video-nao-pronto

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T16:44:53.125780+00:00

**Steps:**
  1. GET /videos/:slug/stream para draft, processing, error e slug inexistente, em casos independentes sem JWT.
    - expect: A API retorna 404 VIDEO_NOT_FOUND e não emite Location.
    - expect: Objetos intermediários eventualmente existentes continuam inacessíveis por esta rota.
