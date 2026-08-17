/**
 * Shared by every CLI that supports --live (worker, calibrate, loadtest): refuse to start
 * rather than let LiveJudgeProvider construct with no credential and fail confusingly on the
 * first request.
 */
export function requireApiKeyForLive(live: boolean, apiKey: string | undefined): void {
  if (live && !apiKey) {
    throw new Error("--live requires ANTHROPIC_API_KEY to be set");
  }
}
