export type DriverPollingTimerApi = {
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
};

export function startDriverSessionPolling(
  callback: () => void,
  timerApi: DriverPollingTimerApi = window,
  delayMs = 30_000,
): () => void {
  const intervalId = timerApi.setInterval(() => {
    callback();
  }, delayMs);

  return () => {
    timerApi.clearInterval(intervalId);
  };
}
