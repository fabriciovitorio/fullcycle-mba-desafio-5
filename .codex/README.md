# StreamTube: configuração do Codex

O projeto usa três AGENTS.md, 23 skills com todos os recursos, 17 regras de
código e seis agentes de leitura. O arquivo de sessões foi preservado como histórico.

## Uso

Abra o workspace no Codex e inicie uma nova sessão para descobrir as novas
instruções, skills e agentes. Em um cliente local, confie no projeto para que
a camada `.codex/config.toml` e seus hooks possam ser carregados. Em ambientes
remotos/gerenciados, a configuração MCP e os hooks podem precisar ser aplicados
pelo administrador/cliente; arquivos locais não substituem as políticas dele.

Exemplos (com os mesmos argumentos do fluxo existente):

```text
$research phase 03
$plan-context 03
$plan-validate 03
$plan-resolve 03
$plan-build 03
$plan-test-specs 03
$implement 03
$implement 03 continuous
```

Os estágios preservam checkpoints, decisões, gates e retomada. Os planos,
decisões e progressos existentes em docs/ continuam sendo os artefatos do
projeto. As referências operacionais apontam para a estrutura do Codex;
esta limpeza não regenera planos nem altera decisões técnicas.

## Estrutura

- AGENTS.md e os AGENTS.md dos dois subprojetos: instruções adaptadas.
- .agents/skills/: skills e seus recursos.
- .codex/rule-docs/index.md: os mesmos 17 filtros de aplicação por arquivo.
- .codex/agents/*.toml: agentes locais, com instruções completas e sandbox de leitura.
- .codex/agent-instructions/: prompts completos para outros clientes com delegação.
- .codex/compatibility.md: equivalências de operações e limitações do cliente.
- .codex/scripts/si_tasks.py: acompanhamento persistente dos SIs no Codex.
- .codex/diagrams/: cópias dos diagramas de workflow, com invocações Codex.
- .codex/migration-manifest.json: inventário e hashes dos arquivos do Codex.

## Integrações

PostgreSQL está configurado como no .mcp.json original. O launcher MCP usa
Node/npx no host e precisa do PostgreSQL publicado em localhost:5432. Isso
não altera a regra de executar comandos da aplicação dentro dos containers.

Context7 está preparado, desabilitado. Configure acesso conforme o serviço,
exporte CONTEXT7_API_KEY se necessário, acrescente bearer_token_env_var conforme
o comentário em config.toml e altere enabled para true. A exigência de Context7
dos fluxos foi preservada: um estágio dependente fica bloqueado sem a integração.

Figma Desktop está preparado com a URL do exemplo existente, desabilitado.
Ative o MCP no Figma Desktop e enabled no config.toml quando disponível. Para
implementação visual, instale/conecte a skill equivalente no Codex; para o
audit de tokens é necessária também a capacidade use_figma. O endpoint desktop
sozinho não garante essa capacidade. As skills externas de Figma precisam
estar disponíveis no cliente Codex.

Em cliente local, `codex mcp list` permite conferir configuração. Verifique
a conectividade em uma nova sessão antes de considerar essas integrações
operacionais. Nenhum servidor, autenticação ou instalação externa foi iniciado
como parte desta preparação.

## Preservação e limites

O conteúdo técnico foi mantido, incluindo informações antigas do original;
esta migração não corrige arquitetura ou fatos desatualizados. As diferenças
se limitam a caminhos, invocações, metadados, nomes de operações e adaptações
de runtime documentadas. Informações de metadados sem equivalente direto
foram preservadas como metadata source-* ou como operações no guia.

Codex não possui uma chave documentada equivalente a user-invocable: false;
a intenção da skill next-best-practices foi mantida como guia automático, com
a política original registrada em metadata. Regras Markdown por paths são
aplicadas pela instrução de roteamento; não são command-permission rules.

Referências oficiais consultadas:

- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Skills](https://learn.chatgpt.com/docs/build-skills)
- [Subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Configuração](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Regras de comandos](https://learn.chatgpt.com/docs/agent-configuration/rules)
- [Context7 MCP](https://github.com/upstash/context7#installation)
