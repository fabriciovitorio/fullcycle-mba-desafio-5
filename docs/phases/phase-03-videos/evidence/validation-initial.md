---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 10
sources_mtime:
  docs/phases/phase-03-videos/context.md: '2026-10-18T15:20:32.071935952+00:00'
  docs/decisions/technical-decisions-phase-03-videos.md: '2026-10-18T15:08:38.388180133+00:00'
issues:
- id: OQ-1
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-01
- id: OQ-2
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-02
- id: OQ-3
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-03
- id: OQ-4
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-04
- id: OQ-5
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-05
- id: OQ-6
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-06
- id: OQ-7
  status: open
  summary: Confirmar escolha de phase-03-videos/TD-07
- id: AMB-1
  status: open
  summary: Política de acesso a mídia pronta antes da Fase 04
- id: ICC-1
  status: open
  summary: Guia herdado propõe filesystem local em testes de storage
- id: DG-1
  status: open
  summary: Base Jest/migrations/lint não está verde no pré-check
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

- **AMB-1:** Escolher leitura pronta anônima por URL ou restrita ao dono; rascunhos privados em ambos os casos.

### Missing Decisions

_None: all nine capabilities have coverage._

### Dependency Gaps

- **DG-1:** Antes de somar a feature, explicitar no plano a correção de Jest, migrations e lint, com gate de testes verdes. Não declarar que a base está verde.

### Inherited Constraint Conflicts

- **ICC-1:** Resolver a recomendação herdada de filesystem/synchronize diante do requisito explícito de MinIO real e migrations.

### Unresolved Open Questions

- **OQ-1:** phase-03-videos/TD-01 está pending; definir opção e cache de libs quando aplicável.
- **OQ-2:** phase-03-videos/TD-02 está pending; definir opção e cache de libs quando aplicável.
- **OQ-3:** phase-03-videos/TD-03 está pending; definir opção e cache de libs quando aplicável.
- **OQ-4:** phase-03-videos/TD-04 está pending; definir opção e cache de libs quando aplicável.
- **OQ-5:** phase-03-videos/TD-05 está pending; definir opção e cache de libs quando aplicável.
- **OQ-6:** phase-03-videos/TD-06 está pending; definir opção e cache de libs quando aplicável.
- **OQ-7:** phase-03-videos/TD-07 está pending; definir opção e cache de libs quando aplicável.

### UI Coverage Gaps

_Not applicable: backend-only._

## Resolved Issues

_None in the initial validation pass._
