# Infraestrutura da Fase 03

O setup mantém a API parada em `tail -f /dev/null`. MinIO e Redis são serviços reais. A imagem separada de mídia está preparada; a entrada e os consumidores do worker serão ativados em SI-03.7.3. Nenhum comando abaixo inicia o servidor HTTP.

## Configuração local

Em `nestjs-project/`, prepare `.env` com base em `.env.example`, preservando seus valores existentes, e `.env.test` com base em `.env.test.example`. Substitua os placeholders de credenciais por valores locais. Ambos são ignorados pelo Git e excluídos do contexto Docker. Nunca publique esses arquivos nem a saída completa de `docker compose config`.

Os hosts internos são `db`, `mailpit`, `minio` e `redis`. A origem CORS é explícita em `STORAGE_CORS_ORIGIN`. `STORAGE_PUBLIC_ENDPOINT` precisa resolver no cliente que consumirá a assinatura: `http://minio:9000` funciona dentro da rede Compose; um cliente externo precisa de um hostname publicado que ele consiga resolver. Alterar o hostname de uma URL já assinada invalida a assinatura.

## Desenvolvimento

```bash
docker compose build minio minio-init nestjs-api
docker compose up -d db mailpit minio minio-init redis nestjs-api
docker compose ps --all
docker compose exec -T db pg_isready -U streamtube
docker compose exec -T minio curl --fail --silent http://minio:9000/minio/health/ready
docker compose exec -T redis redis-cli -h redis ping
```

`minio-init` deve terminar com código 0; é um serviço one-shot, não um daemon. Pode ser repetido com `docker compose run --rm minio-init`: cria o bucket quando ausente e remove qualquer política anônima. As demais dependências têm readiness; Mailpit também fornece healthcheck na imagem fixada. O volume original do PostgreSQL existente é preservado; os novos serviços usam volumes nomeados. Não use `down -v` para reiniciar infraestrutura com dados.

## Testes isolados

O override fixa o nome do projeto em `streamtube-test`, remove portas publicadas e usa rede, volumes PostgreSQL/MinIO/Redis, banco `streamtube_test`, bucket `streamtube-test-videos` e prefixo BullMQ `streamtube-test` próprios. As variáveis de isolamento são fixadas pelo Compose, independentemente dos nomes no arquivo local. `--env-file` alimenta a interpolação do Compose; `env_file` injeta `.env.test` no container e `DOTENV_CONFIG_PATH` seleciona o mesmo arquivo para Jest/CLI.

```bash
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml --profile test up -d --build db mailpit minio minio-init redis nestjs-api
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml --profile test ps --all
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run migration:run
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api node scripts/verify-video-infra.cjs seed
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml --profile test restart minio redis
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml --profile test up -d --wait minio redis
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api node scripts/verify-video-infra.cjs verify
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api node scripts/verify-video-infra.cjs cleanup
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm test -- --runInBand
docker compose --env-file .env.test -f compose.yaml -f compose.test.yaml exec -T nestjs-api npm run test:e2e -- --runInBand
```

O probe só aceita os nomes de teste fixados, usa um objeto conhecido e um job real, confere conteúdo antes/depois do restart, acesso anônimo negado, assinatura válida, origem CORS permitida/rejeitada, GET/HEAD/PUT e headers expostos/assinados. Também confere PostgreSQL, Mailpit, Redis AOF/noeviction e binários de mídia. `cleanup` remove somente esses dois artefatos.

O globalSetup Jest cria/migra o banco dedicado com `synchronize:false`. Ele respeita `TEST_PROTECTED_DB_NAME` explícito para proteger o banco de desenvolvimento mesmo quando `DB_NAME` já é o banco de teste. A guarda `*_test` e a rejeição do banco protegido continuam obrigatórias. Execute migrations uma vez antes do futuro consumidor, nunca em dois processos concorrentes. `video-worker-test` ainda não está declarado/ativo; SI-03.7.3 deverá compartilhar exatamente o isolamento acima e aguardar migrations/readiness.

## Imagem do worker

```bash
docker compose -f compose.yaml -f compose.worker-tools.yaml --profile tools build worker-tools
docker compose -f compose.yaml -f compose.worker-tools.yaml --profile tools run --rm --no-deps worker-tools ffmpeg -version
docker compose -f compose.yaml -f compose.worker-tools.yaml --profile tools run --rm --no-deps worker-tools ffprobe -version
docker compose -f compose.yaml -f compose.worker-tools.yaml --profile tools run --rm --no-deps worker-tools sh -c 'id -u; test -w /tmp/streamtube-videos; df -h /tmp/streamtube-videos'
```

O runtime usa usuário `node`, dependências de produção, FFmpeg/ffprobe e volume temporário próprio; o probe limita memória a 2 GiB e CPU a 1. O comando da imagem aponta para a futura entrada standalone `dist/worker.js`, ainda ausente; só os comandos explícitos de ferramentas acima devem ser usados neste SI. A imagem dev também inclui os binários para testes, sem registrar processamento na API.

## Proveniência e persistência

As tentativas de baixar `minio/minio`, `minio/mc` e suas imagens Quay falharam. O [upstream oficial](https://github.com/minio/minio) descreve distribuição por código-fonte. `Dockerfile.minio` constrói o código oficial sem alterações, fixado nos commits `7aac2a2c5b7c882e68c1ce017d8256be2feea27f` (servidor) e `77f82e18b5401a65958f1619df6ebb994634bd88` (cliente), preservando código/licença nas imagens. Não usa mirrors de terceiros nem tags `latest`. Bases Go/Debian e Node/Redis estão fixadas por digest; Mailpit mantém o digest já instalado. As versões e IDs efetivamente construídos ficam em `evidence/si-03.2.2/`.

Nessa implementação do MinIO, CORS é configurado por `MINIO_API_CORS_ALLOW_ORIGIN` no serviço; os [headers/métodos definidos pelo servidor](https://github.com/minio/minio/blob/7aac2a2c5b7c882e68c1ce017d8256be2feea27f/cmd/api-router.go) incluem os necessários para multipart e Range. Não pressupomos suporte de escrita de CORS por bucket; o comportamento é conferido pelo probe real. Nenhuma policy pública é instalada.

Redis grava AOF em volume com `appendfsync everysec` e `maxmemory-policy noeviction`; reinício normal deve preservar jobs. Uma queda abrupta pode perder escritas ainda não sincronizadas, por isso a outbox/reconciliação dos SIs seguintes permanece necessária. MinIO armazena objetos em volume persistente. A prova de 10 GB e a medição de espaço/RSS do fluxo completo pertencem a SI-03.9.2; este SI não as antecipa.
