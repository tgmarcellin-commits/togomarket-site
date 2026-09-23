export type DriverPollingTimerApi = {
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
};

export function startDriverSessionPolling(
  callback: () => void,
  timerApi?: DriverPollingTimerApi,
  delayMs = 30_000,
): () => void {
  const resolvedTimerApi = timerApi ?? window;
  const intervalId = resolvedTimerApi.setInterval(() => {
    callback();
  }, delayMs);

  return () => {
    resolvedTimerApi.clearInterval(intervalId);
  };
}
