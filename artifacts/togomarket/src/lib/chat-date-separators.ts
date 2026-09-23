function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getLocalDayKey(dateInput: string): string {
  const date = new Date(dateInput);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function getChatDaySeparatorLabel(
  dateInput: string,
  lang: string,
  now: Date = new Date(),
): string {
  const targetDate = new Date(dateInput);
  const dayDiff = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(targetDate).getTime()) / 86_400_000,
  );

  if (dayDiff === 0) return lang === "fr" ? "Aujourd'hui" : "Today";
  if (dayDiff === 1) return lang === "fr" ? "Hier" : "Yesterday";

  return targetDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
