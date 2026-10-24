// Operational defaults for dispatch, separate from processing leases/budget.
export const VIDEO_DISPATCH = {
  TICK_MS: 1000,
  BATCH_SIZE: 1,
  LEASE_MS: 30_000,
  RETRY_MS: 2000,
  RECHECK_MS: 30_000,
  READY_TIMEOUT_MS: 2000,
  COMMAND_TIMEOUT_MS: 2000,
} as const;

export interface VideoProcessingJob {
  schemaVersion: 1;
  videoId: string;
}
