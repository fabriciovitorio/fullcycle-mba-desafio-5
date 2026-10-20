# Revisar ciclo de manutenção da distribuição MinIO

Observação identificada em SI-03.2.2, sem alterar a decisão aprovada de MinIO.

As imagens `minio/minio` e `minio/mc` recusaram pull no Docker Hub; Quay recusou a referência oficial do servidor com HTTP 401. O [repositório oficial](https://github.com/minio/minio) está arquivado e descreve distribuição somente por código-fonte. O SI preservou a tecnologia aprovada construindo código oficial fixado em commits, com bases por digest, código/licenças e evidências locais.

Em tarefa separada, avaliar atualização/manutenção e correções de segurança dessa distribuição antes de uso em produção, incluindo a estratégia para reconstruir e verificar imagens. Qualquer substituição do storage exige nova decisão técnica; não trocar fornecedor silenciosamente. Não houve avaliação de vulnerabilidades das imagens neste SI.

Evidências: `docs/phases/phase-03-videos/evidence/si-03.2.2/verification.json`; implementação e procedimento: `docs/phases/phase-03-videos/infrastructure.md`.
