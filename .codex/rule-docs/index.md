# Code rule routing

These Markdown rules are reference instructions, not Codex command-permission `.rules` files.
Before planning, implementing, testing, or reviewing an affected file, read **all** matching
rules below. Match workspace-relative paths using the original glob patterns; `**` includes
zero or more directory levels. Multiple matching rules are cumulative. The `paths` frontmatter
is preserved as routing data; these files are activated by the AGENTS.md routing instructions.

| Rule document (workspace-relative) | Original file patterns | Purpose |
| --- | --- | --- |
| `.codex/rule-docs/auth-jwt.md` | `nestjs-project/src/auth/**` | JWT and refresh-token rotation rules |
| `.codex/rule-docs/nestjs-common-conventions.md` | `nestjs-project/src/**/*.ts` | NestJS common conventions |
| `.codex/rule-docs/nestjs-controllers.md` | `nestjs-project/**/*.controller.ts` | Controller conventions — REST compliance, no silent errors, prefer exception filters over try/catch |
| `.codex/rule-docs/nestjs-dtos.md` | `nestjs-project/**/*.dto.ts` | DTO conventions for input validation and data transfer |
| `.codex/rule-docs/nestjs-entities.md` | `nestjs-project/**/*.entity.ts` | TypeORM entity conventions for database models |
| `.codex/rule-docs/nestjs-layer-separation.md` | `nestjs-project/**/*.controller.ts`<br>`nestjs-project/**/*.guard.ts`<br>`nestjs-project/**/*.interceptor.ts`<br>`nestjs-project/**/*.pipe.ts`<br>`nestjs-project/**/*.filter.ts` | Layer separation — business logic belongs exclusively in services; controllers, guards, interceptors, pipes, and filters must delegate to services |
| `.codex/rule-docs/nestjs-modules.md` | `nestjs-project/src/**/*.module.ts` | NestJS module structure conventions |
| `.codex/rule-docs/nestjs-services.md` | `nestjs-project/**/*.service.ts` | Service layer error handling — errors must always propagate to upper layers |
| `.codex/rule-docs/nestjs-testing.md` | `nestjs-project/**/*.spec.ts`<br>`nestjs-project/**/*.integration-spec.ts`<br>`nestjs-project/**/*.e2e-spec.ts`<br>`nestjs-project/test/**` | Testing conventions for NestJS unit, integration, and e2e tests |
| `.codex/rule-docs/next-frontend-bff-api.md` | `next-frontend/app/api/**/route.ts`<br>`next-frontend/lib/api/**/*.ts` | BFF Route Handlers and the typed upstream client — OpenAPI-anchored wire-shape pipeline |
| `.codex/rule-docs/next-frontend-code-quality.md` | `next-frontend/**/*.ts`<br>`next-frontend/**/*.tsx` | TypeScript strict, imports, RSC/client boundary, file naming, cn(), Next.js primitives, env access |
| `.codex/rule-docs/next-frontend-msw-mocks.md` | `next-frontend/mocks/**`<br>`next-frontend/**/*.integration.test.ts`<br>`next-frontend/**/*.integration.test.tsx` | MSW handler typing convention + Route Handler integration test pattern (paths-anchored fixtures) |
| `.codex/rule-docs/next-frontend-testing.md` | `next-frontend/**/__tests__/**`<br>`next-frontend/tests/**`<br>`next-frontend/**/*.test.ts`<br>`next-frontend/**/*.test.tsx`<br>`next-frontend/**/*.integration.test.ts`<br>`next-frontend/**/*.integration.test.tsx`<br>`next-frontend/**/*.e2e-spec.ts` | Test type routing, file placement, forbidden patterns (no real-network Vitest tests) |
| `.codex/rule-docs/next-frontend-ui.md` | `next-frontend/components/**/*.tsx`<br>`next-frontend/app/**/*.tsx`<br>`next-frontend/app/**/*.css` | UI rules: design tokens (no hardcoding), shadcn primitive pattern, custom icon components |
| `.codex/rule-docs/typeorm-migrations.md` | `nestjs-project/**/migrations/**`<br>`nestjs-project/**/*data-source.ts` | Database migration safety rules |
| `.codex/rule-docs/typeorm-queries.md` | `nestjs-project/src/**/*.service.ts`<br>`nestjs-project/src/**/*.repository.ts` | TypeORM query pitfalls — silent footguns when reading/writing through repositories |
| `.codex/rule-docs/typescript-strict.md` | `nestjs-project/src/**/*.ts`<br>`nestjs-project/test/**/*.ts` | TypeScript strictness rules — keep tsc --noEmit clean at all times |
