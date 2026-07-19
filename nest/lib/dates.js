export function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function previousDateISO(dateISO) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function diffDays(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

export function relTime(fromISO, toISO) {
  // "同日" = DD 相同(每月的今天);月差整年则说"年"
  if (fromISO.slice(8) === toISO.slice(8)) {
    const months = (Number(toISO.slice(0, 4)) - Number(fromISO.slice(0, 4))) * 12
      + (Number(toISO.slice(5, 7)) - Number(fromISO.slice(5, 7)));
    if (months % 12 === 0) return `${months / 12} 年前的今天`;
    return `${months} 个月前的今天`;
  }
  return `${diffDays(fromISO, toISO)} 天前`;
}
