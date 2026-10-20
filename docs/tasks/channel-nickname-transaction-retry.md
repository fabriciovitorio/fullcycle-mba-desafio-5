# Corrigir retry concorrente de nickname em transação PostgreSQL

Status: backlog. Identificado durante SI-03.1.3; fora do escopo do gate de lint.

`ChannelsService.createChannel` tenta novamente após uma violação UNIQUE dentro da mesma transação, sem SAVEPOINT. No PostgreSQL, a primeira violação aborta a transação e impede as consultas seguintes. O teste unitário existente usa um manager simulado e não comprova recuperação transacional real.

Em tarefa própria, reproduzir a colisão com PostgreSQL real e corrigir a recuperação com SAVEPOINT ou outra fronteira transacional adequada. Preservar o contrato de erro, o limite de tentativas e a atomicidade de usuário/canal. Cobrir também propagação de erros de outras constraints. Referência: `.codex/rule-docs/typeorm-queries.md`.
