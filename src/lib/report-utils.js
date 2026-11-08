export function getCliArg(name, fallback = null, args = process.argv) {
  const prefix = `--${name}=`;
  const exactIndex = args.indexOf(`--${name}`);
  if (exactIndex >= 0 && args[exactIndex + 1] && !args[exactIndex + 1].startsWith('--')) return args[exactIndex + 1];
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

export function shanghaiDate(date) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function formatDateForFilename(date) { return shanghaiDate(date).slice(5).replace('-', ''); }
export function formatDateLabel(date) { return shanghaiDate(date).replaceAll('-', '/'); }
export function getWeekRange(date) {
  const current = new Date(`${shanghaiDate(date)}T00:00:00Z`);
  const day = current.getUTCDay() || 7;
  const monday = new Date(current); monday.setUTCDate(current.getUTCDate() - day + 1);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const start = monday.toISOString().slice(0,10), end = sunday.toISOString().slice(0,10);
  return {monday, sunday, start, end, label:`${start.replaceAll('-','/')} - ${end.replaceAll('-','/')}`};
}
export function citation(index) { return `[${index}]`; }
export function isWithinWeek(isoDate, week) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return false;
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==isoDate) return false;
  const start = week.start || new Date(week.monday).toISOString().slice(0,10);
  const end = week.end || new Date(week.sunday).toISOString().slice(0,10);
  return isoDate >= start && isoDate <= end;
}
