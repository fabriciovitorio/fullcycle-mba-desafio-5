# Fase 03 — Análise do projeto e pré-verificação

**Data:** 2026-10-18
**Estado:** análise e research concluídos; escolhas técnicas pendentes; implementação não iniciada.
**Escopo:** somente backend, worker, infraestrutura e artefatos do processo.

## Objetivo e fontes de verdade

Entregar a Fase 03 de `docs/project-plan.md`, observando os requisitos e a lista única de avaliação de `prompt.md`. As decisões ficam em `docs/decisions/technical-decisions-phase-03-videos.md`; os artefatos posteriores devem estar exatamente nesta pasta, sem duplicar o prefixo `phase-03`.

Foram lidos o prompt integral, os AGENTS raiz/backend, o guia de compatibilidade, o índice de regras, as skills de research/planejamento, os guias de NestJS/TypeORM/testes, as decisões herdadas relevantes, os planos/contextos/progressos anteriores e os pontos de extensão do backend. A consolidação de leitura de fases e decisões foi executada pelos papéis de leitura acionados por `plan-context`.

Esta análise não substitui `context.md`, `validation.md` ou o plano executável. Nenhum destes artefatos será declarado completo por inferência, e nenhuma implementação de vídeos foi iniciada.

## Estado real do código

- `nestjs-project/src/app.module.ts`: configuração global, TypeORM e AuthModule. Não registra VideosModule.
- `src/auth/auth.module.ts`: JWT e throttling globais. Novos controllers ficam protegidos por padrão; métodos públicos exigem `@Public()` explícito.
- `src/auth/auth.types.ts`: JWT contém `sub` e `email`; não contém channelId. O canal precisa ser resolvido no servidor pelo usuário autenticado.
- `src/users/` e `src/channels/`: relação 1:1 usuário/canal; ChannelsModule exporta seus providers. A propriedade do vídeo deve ser associada a esse canal, sem aceitar como verdade um dono arbitrário vindo do cliente.
- `src/common/exceptions/domain.exception.ts` e os filtros: preservar o padrão de erro `{statusCode,error,message}` e a separação entre domínio e transporte.
- `src/config/`: factories `registerAs`, schema Joi, compartilhamento de configuração entre aplicação e CLI TypeORM.
- `src/database/migrations/`: duas migrations existentes; nunca editar essas migrations para adicionar vídeos.
- `src/swagger/swagger-document.ts`, `src/openapi-export.ts`, `nest-cli.json`: Swagger com plugin e exportação da spec. Endpoints novos devem integrar esse contrato.
- `compose.yaml`: API, PostgreSQL 17 e Mailpit. Não existem serviços de object storage, fila ou worker de vídeo.
- Não existe entidade/tabela de vídeos, protocolo de upload, thumbnail ou pipeline de processamento implementados.
- O frontend já existe, mas não será alterado por esta fase; a indicação antiga de não inicializado no AGENTS raiz está desatualizada.

Versões do lockfile consultado: NestJS core 11.1.16; TypeORM 0.3.28; TypeScript 5.9.3; Jest 30.3.0. O container existente usa Node 25.6.0 e npm 11.8.0. As libs de storage/fila ainda não foram instaladas.

## Convenções obrigatórias para a continuação

1. Controllers recebem HTTP e delegam; serviços concentram regras; repositórios encapsulam persistência. Exceções de domínio são convertidas pelos filtros.
2. Manter JWT global, validação `whitelist`/`forbidNonWhitelisted`, rate limiting e decorators OpenAPI, sem criar um padrão concorrente.
3. Cada entidade pertence ao módulo que a registra via `TypeOrmModule.forFeature`; relação com canal e unicidade de URL precisam existir no banco.
4. Schema novo por migration gerada pela CLI TypeORM, reversível e testada em banco novo; não alterar migrations já aplicadas.
5. Comunicação entre serviços por DNS do Compose (`db`, e os novos serviços). URLs destinadas a clientes fora do Docker precisam de endpoint externo separado; não confundir esse endpoint com a conexão interna entre serviços.
6. `npm`, `npx`, Node, build, testes e lint do backend rodam dentro de containers.
7. Testes unitários sem I/O em `*.spec.ts`; integração real em `*.integration-spec.ts`; HTTP via supertest em `test/*.e2e-spec.ts`. Banco compartilhado exige execução serial.
8. Documentação oficial via Context7 antes de implementar cada dependência; registrar versões exatas e limites da consulta em library-refs.
9. Implementar um SI por vez, respeitando dependências, testes e progress.md; preservar os checkpoints da skill e só usar execução contínua quando autorizada.
10. Não declarar pronto com testes vermelhos, tsc/lint quebrados ou documentação que descreva arquivos e comportamentos ainda inexistentes.

Regras aplicáveis: `.codex/rule-docs/nestjs-{common-conventions,controllers,dtos,entities,modules,services,layer-separation,testing}.md`, `typescript-strict.md`, `typeorm-queries.md` e `typeorm-migrations.md`. Regras específicas de auth entram apenas se a implementação realmente tocar esse domínio.

## Fluxo alvo a especificar, ainda não implementado

1. Usuário autenticado solicita iniciar upload; o servidor resolve seu canal e pré-cadastra o vídeo como rascunho.
2. A API entrega apenas os dados de controle; o cliente envia as partes diretamente ao storage.
3. O contrato permite consultar/retomar partes e renovar permissões sem reenviar o arquivo inteiro.
4. A conclusão verifica o objeto/partes reais, tamanho, associação ao vídeo e propriedade; callbacks repetidos não podem duplicar efeitos.
5. A intenção persistente de processamento resulta em um job real, consumido exclusivamente pelo worker separado da API.
6. O worker extrai metadados e thumbnail, persiste resultados e transiciona o vídeo para pronto; falhas transitórias e definitivas têm tratamento distinto.
7. A URL única resolve o vídeo e sua autorização/estado. Streaming deve começar com leitura parcial; download deve entregar os bytes corretos com disposição apropriada.

Este é o fluxo recomendado pela pesquisa, sujeito à resolução formal das decisões. Ele não introduz UI, publicação, categorias ou gerenciamento da Fase 04.

## Pontos que o plano precisa fechar

- Definição de 10GB em bytes, limites de partes, expiração de sessão/URLs, cancelamento e limpeza de multipart incompleto.
- Limite real do objeto, não apenas do tamanho declarado no DTO. Limitar também o controle de partes/URLs para evitar respostas enormes na API.
- Janela entre S3 concluído e banco atualizado, e janela entre banco atualizado e job publicado.
- Idempotência de conclusão/job e transições condicionais; política de retries, backoff e falha final.
- Imutabilidade das chaves/objetos finais, para evitar alterar um vídeo após processar ou reaproveitar permissões de gravação.
- Política de leitura antes da Fase 04: anônima por URL para vídeos prontos ou somente o dono. Rascunhos e upload permanecem privados.
- Formatos/codecs aceitos. Suportar Range não garante que um browser reproduza qualquer codec; não prometer transcodificação/HLS não planejados.
- Worker com limites de concorrência, tempo e recursos; temporários em disco e limpeza em sucesso/falha. Não carregar 10GB em um Buffer.
- Persistência da fila/storage, healthchecks, inicialização do bucket e shutdown dos consumidores.
- Testes existentes com listas explícitas de entidades e limpeza de tabelas precisam ser adaptados quando surgir a FK de vídeos/canal; não quebrar a autenticação para adicionar o novo domínio.
- O teste antigo de migrations aplica/reverte exatamente duas migrations e derruba tabelas; sua ampliação precisa preservar o estado para as outras suítes.

## Verificação executada antes de implementar vídeos

Resultados e saídas completas: `evidence/baseline-results.json` e logs associados.

| Verificação | Resultado observado |
|-------------|---------------------|
| PostgreSQL/Compose | API de desenvolvimento, db e Mailpit iniciados; db pronto. Nenhum servidor HTTP da aplicação foi iniciado. |
| Dependências | Instaladas no container, preservando package.json e package-lock.json. |
| Migrations existentes | Duas migrations aplicadas com sucesso. |
| `npm test -- --runInBand` | Abortou antes de executar testes: duas configurações Jest concorrentes. |
| `npm test -- --config package.json --runInBand` | 23 suítes: 22 passaram, uma falhou; 142 testes passaram, dois falharam. |
| `npm run test:e2e -- --runInBand` | Três suítes e 52 testes passaram. |
| `npx tsc --noEmit` | Código 0. |
| `npm run lint -- --no-fix` | 150 erros e 40 warnings. Execução sem autofix para preservar a base durante a análise. |

A base **não atende à Definition of Done** atualmente. Não é uma falha atribuída ao módulo de vídeos, que ainda não existe.

### Pendências preexistentes comprovadas

- `nestjs-project/jest.config.ts` concorre com `package.json#jest`; além disso, o arquivo isolado não inclui o mesmo padrão de integração/setupFiles da configuração documentada. Deve existir uma fonte executável coerente para `npm test`.
- `src/database/migrations.integration-spec.ts` faz `DROP TABLE` relacionados via `Promise.all`; houve deadlock e falha de recuperação por tabela já existente, apesar da execução serial entre suítes.
- Os 150 erros de lint estão distribuídos em testes e alguns helpers/serviços, com problemas de tipagem e funções async sem await. Devem ser corrigidos preservando a política de qualidade, sem desabilitar o lint para alegar suíte verde.
- Há guias herdados recomendando storage local e `synchronize` em testes. Para a fase atual prevalecem o requisito explícito de MinIO real e a regra de migrations; essas divergências precisam aparecer na validação, não ser ignoradas.
- Alguns arquivos com sufixo unitário compilam módulos com banco real; os novos testes precisam respeitar a classificação atual, e o plano deve delimitar ajustes necessários nos antigos.

## Ambiente e Git

O workspace não tinha Git raiz válido. O repositório informado pelo usuário estava vazio. Com autorização, foi criado o commit-base local `9e24b87` na branch `dev` e a branch `feature/phase-03-videos` a partir dela. Não houve commit na main nem push. Metadados internos vazios do gerador NestJS foram arquivados em `/tmp`, preservando arquivos do projeto.

A resolução DNS do container antigo impediu `npm ci`. A instalação foi recuperada em um container temporário com rede do host. Depois, somente o container da API foi recriado com a rede normal do Compose; a conexão com `db` e as migrations passaram. Esse ajuste não alterou o compose.yaml do projeto. `.env` local foi criado a partir do exemplo, com MAIL_FROM devidamente citado; segue ignorado pelo Git.

## Critérios de aceite e evidências necessárias

| Critério de prompt.md | Evidência exigida na entrega final |
|----------------------|-----------------------------------|
| Workflow completo | Decisões resolvidas → context → validation clean → library-refs → plano → execução/progresso, com fontes reais. |
| Plano no formato do projeto | SI-03.x, Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, Dependency Map e Deliverables. |
| Upload de até 10GB | Transferência direta multipart, rascunho persistido antes do envio, retomada e API responsiva; não confundir um teste numérico com transferência real. |
| Processamento automático | Job consumido pelo worker real; duração/metadados/thumbnail conferidos nos serviços e banco. |
| URL sem colisão | Restrição única e caminho de colisão testado; identificador separado da chave interna. |
| Streaming/download | Conteúdo e headers reais; Range/206 e 416 quando aplicável; download com bytes corretos. |
| Status persistido | Sucesso, conteúdo inválido, falha transitória, retries esgotados e reentrega com idempotência. |
| Infra real | MinIO, broker e worker sobem com Compose e são exercitados, sem substituir integração por mocks. |
| Migration e vínculo ao canal | Aplicação/reversão em banco novo, FK e regras de propriedade testadas. |
| Qualidade | `npm test`, e2e, tsc e lint verdes, incluindo toda a base e os novos testes. |
| Git Flow | Histórico de trabalho na feature originada da dev; nenhum commit direto na main. |
| AGENTS coerente | Descrever somente módulos, endpoints, serviços, variáveis e comandos realmente implementados e testados. |

### Reprovação automática a evitar

Não iniciar a implementação antes do pipeline, não fabricar validation clean, não transportar o upload grande pela API, não substituir storage/fila/worker por simulações, não deixar lint/tsc/testes vermelhos, não commitar na main e não documentar como existente o que ainda é só intenção.

## Próximo checkpoint

A pesquisa está pronta para revisão das escolhas. `plan-context` já executou suas leituras auxiliares, mas a seleção das decisões correlacionadas aguarda confirmação. Após resolver essas entradas: consolidar context.md, executar plan-validate, resolver escolhas/gaps e fixar bibliotecas em library-refs, repetir a validação até clean e então gerar o plano com a correção da base claramente delimitada como pré-requisito.
