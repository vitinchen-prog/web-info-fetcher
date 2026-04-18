export function getCliArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const exactIndex = process.argv.indexOf(`--${name}`);

  if (exactIndex >= 0 && process.argv[exactIndex + 1]) {
    return process.argv[exactIndex + 1];
  }

  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

export function formatDateForFilename(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}${day}`;
}

export function formatDateLabel(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function getWeekRange(date) {
  const current = new Date(date);
  const day = current.getDay() || 7;
  const monday = new Date(current);
  monday.setDate(current.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    monday,
    sunday,
    label: `${formatDateLabel(monday)} - ${formatDateLabel(sunday)}`
  };
}

export function citation(index) {
  return `[${index}]`;
}
