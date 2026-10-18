# Codex runtime compatibility

This file adapts execution mechanisms while preserving the independent copies'
project information, decision contracts, checkpoints and stop/resume behavior.
Read it before a project skill or agent prompt. It takes precedence over copied
claims about tool availability and subagent context inheritance.

## Instructions, rules and skills

- Read root and affected subproject AGENTS.md explicitly, including when launched
  at the workspace root. Rule documents live in `.codex/rule-docs/`; their `paths`
  are routing data. Consult `index.md` and read every matching rule.
- Invoke skills with `$skill-name` followed by the same arguments as the original
  workflow. Skill names, decision IDs, SI IDs, artifact paths and schemas are unchanged.
- Read the relevant `.agents/skills/{name}/SKILL.md` to load its workflow. Resolve relative companion resources from the skill directory.
- `agents/openai.yaml` preserves implicit-invocation policy. An explicit-only
  stage may also be read when it is a necessary dependency of a user-authorized
  workflow; this does not authorize unrelated stages or bypass its checkpoints.
- Source `user-invocable: false` is recorded in skill metadata. Codex has no
  documented identical visibility switch; next-best-practices remains an
  automatically usable reference rather than a prescribed standalone command.
- Project documents use the Codex paths directly. Never modify old sources_mtime
  merely to conceal staleness; regenerate stale artifacts through their normal workflow.

## Shell, read, search and edit operations

Copied Read, Grep, Glob, Bash, Edit and Write names describe operations, not
installed Codex tools. Use the client's shell/read/edit capabilities.

- Bash: shell execution through `exec_command` or the available equivalent.
- Read(offset, limit): bounded reads, e.g. `sed -n 'START,ENDp' file`, preserving
  the original selected range. Interpret any tool offsets according to that tool.
- Grep: `rg`; use `rg -n` for numbered matches and `rg -l` for file sets. Keep the
  original patterns and scope. Patterns containing lookahead require `rg --pcre2`.
- Glob: `rg --files --hidden -g 'PATTERN' DIRECTORY`; avoid dependencies/build outputs.
- Edit/Write: apply_patch or the available file editor, preserving anchors and
  all content outside the authorized change.
- Persistent processes: use Docker's detached exec or the shell's session
  support, then verify readiness as specified. Do not wait indefinitely.
- All existing Docker requirements remain, including Playwright E2E's explicit
  host exception. The PostgreSQL MCP launcher and Python skill helpers run on
  the host; this does not permit application npm/node commands on the host.

## User questions

`Codex user question` means the available user-input mechanism, not a literal
API method. Use the client's question tool when supported; otherwise ask in a
normal response and stop dependent work until the answer arrives. Keep all
original choices, confirmation gates and required information. If there is an
option limit, ask the same choices through conversation rather than dropping
options. Required approvals must use the client's approval flow; an optional
question tool is not an approval mechanism. Never infer an answer from silence.

## SI task operations

`create_si_task`, `update_si_task`, `list_si_tasks` and `get_si_task` below are
adapter operations, not native Codex tool names. Their implementation is
`.codex/scripts/si_tasks.py`, using a separate `codex-tasks.json` next to the
plan's existing progress.md. Pass one SI per operation, in execution order.

```bash
python3 .codex/scripts/si_tasks.py --file docs/phases/phase-NN-slug/codex-tasks.json create --id SI-NN.X --subject 'SI-NN.X — SI name' --description 'What this SI delivers' --active-form 'Implementing the SI'
python3 .codex/scripts/si_tasks.py --file docs/phases/phase-NN-slug/codex-tasks.json update --id SI-NN.X --status in_progress
python3 .codex/scripts/si_tasks.py --file docs/phases/phase-NN-slug/codex-tasks.json update --id SI-NN.X --status completed
python3 .codex/scripts/si_tasks.py --file docs/phases/phase-NN-slug/codex-tasks.json list
python3 .codex/scripts/si_tasks.py --file docs/phases/phase-NN-slug/codex-tasks.json get --id SI-NN.X
```

For tasks use docs/tasks/task-slug instead. Creation is idempotent for the same
SI contract; updates affect one SI. The ordered list retains subject,
description, activeForm and pending/in_progress/completed states. Mirror the
list in the visible plan using update_plan if available, or show the ordered
list in conversation. The existing progress.md is authoritative on resume:
reconcile completed SIs against it before execution. Task bookkeeping never
marks implementation complete without the original acceptance/test gates.
Maintain all original per-SI STOPs unless the user authorized continuous mode.

## Delegation

`Codex delegation` means the client's subagent mechanism (such as spawn_agent).
`agent role:` in copied workflows identifies the role to execute, not a literal
spawn parameter. Named local roles are in `.codex/agents/{name}.toml`; use the
client's supported custom-role selector when available. Otherwise pass the
complete `.codex/agent-instructions/{name}.md` instructions and inputs to a
generic subagent. Never assume it inherits loaded skills or project instructions.

- `Explore` maps to a read-only explorer; `general-purpose` maps to a default
  agent with the permissions needed for the authorized tests.
- Include explicit root/subproject AGENTS.md and applicable rules in handoffs.
  Codex inheritance varies by client; copied assertions that a subagent inherits
  only cwd are not a claim about the Codex runtime.
- Delegate independent reads/test jobs as the invoked workflow requests. Use
  available slots; queue independent calls when a single batch exceeds the cap.
- With no delegation capability, execute the same input/output contracts
  sequentially, disclose that fallback, and keep bounded reads/noise-stripped
  reports. Sequential fallback does not relax gates or allow parallel SI execution.

## MCP and Figma capabilities

Discover actual connected tool names; names such as `Context7 query-docs` and
`Figma get_design_context` identify capabilities rather than a provider-specific
namespace. Resolve the server's advertised schemas before calling a tool.
Context7 resolve-library-id precedes query-docs; keep the original batching and
version checks. If required documentation access is missing, stop that dependent
step and report the missing integration rather than inventing library evidence.

Figma plugin skills are external dependencies, not part of the copied project:
`figma:figma-implement-design` means the installed Codex design-implementation
skill with that capability; `figma:figma-use` means its Figma scripting skill.
Read the installed equivalent when available; do not assume identical names.
The copied token audit requires use_figma and async Figma Variables/Styles APIs.
The desktop MCP's get_variable_defs (one mode) is not an equivalent substitute.
When scripting/plugin capability is absent, report exactly that missing
capability and preserve the original halt/manual-completion path.

PostgreSQL retains the original connection and launcher. Context7 and the
example Figma Desktop endpoint are prepared but disabled until access is set up.
See `.codex/README.md`; preparing files does not authenticate or verify services.
