export function normalizeCronTime(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "10:30";

  const hours = Math.min(23, Math.max(0, Number.parseInt(match[1], 10)));
  const minutes = Math.min(59, Math.max(0, Number.parseInt(match[2], 10)));

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatCronTimeLabel(hhmm: string): string {
  const normalized = normalizeCronTime(hhmm);
  const [hourPart, minutePart] = normalized.split(":");
  const hours = Number.parseInt(hourPart, 10);
  const minutes = Number.parseInt(minutePart, 10);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function buildCronTimeSelectOptions(
  selectedTime: string,
  intervalMinutes = 15,
): Array<{ value: string; label: string }> {
  const step = Math.min(60, Math.max(1, intervalMinutes));
  const options: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += step) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: formatCronTimeLabel(value) });
    }
  }

  const normalizedSelected = normalizeCronTime(selectedTime);
  if (!seen.has(normalizedSelected)) {
    options.push({
      value: normalizedSelected,
      label: formatCronTimeLabel(normalizedSelected),
    });
    options.sort((a, b) => a.value.localeCompare(b.value));
  }

  return options;
}
