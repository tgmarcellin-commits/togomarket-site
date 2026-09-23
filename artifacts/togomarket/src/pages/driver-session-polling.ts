export type DriverPollingTimerApi = Pick<typeof globalThis, "setInterval" | "clearInterval">;

function getDefaultTimerApi(): DriverPollingTimerApi | null {
  return typeof window !== "undefined" ? window : null;
}

export function startDriverSessionPolling(
  callback: () => void,
  timerApi?: DriverPollingTimerApi,
  delayMs = 30_000,
): () => void {
  const resolvedTimerApi = timerApi ?? getDefaultTimerApi();
  if (!resolvedTimerApi) {
    return () => {};
  }
  const intervalId = resolvedTimerApi.setInterval(() => {
    callback();
  }, delayMs);

  return () => {
    resolvedTimerApi.clearInterval(intervalId);
  };
}
