export type DriverPollingTimerApi = {
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
};

export function startDriverSessionPolling(
  callback: () => void,
  timerApi?: DriverPollingTimerApi,
  delayMs = 30_000,
): () => void {
  const resolvedTimerApi = timerApi ?? (typeof window !== "undefined" ? window : null);
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
