import type { Storage } from "../storage/storage.js";

export interface SyncRunStats {
  customersProcessed: number;
  recipesFetched: number;
  recipesChanged: number;
  recipesDocumented: number;
  errors?: string;
  summary?: string;
}

export interface RunTracker {
  startRun(): number;
  finishRun(runId: number, stats: SyncRunStats): void;
  getLastSuccessfulRunFinishedAt(): string | null;
}

export function createRunTracker(storage: Storage): RunTracker {
  return {
    startRun() {
      return storage.createSyncRun();
    },

    finishRun(runId, stats) {
      storage.finishSyncRun(runId, stats);
    },

    getLastSuccessfulRunFinishedAt() {
      const run = storage.getLastSuccessfulRun();
      return run?.finished_at ?? null;
    },
  };
}
