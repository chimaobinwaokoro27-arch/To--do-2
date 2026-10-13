const pad = (value) => String(value).padStart(2, '0');

/**
 * Formats a Date as "YYYY-MM-DDTHH:mm:ss" in local time.
 * All dates in this project are stored in this format so that
 * plain string comparison in SQLite works correctly.
 */
export function toLocalIsoString(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function nowLocalIsoString() {
  return toLocalIsoString(new Date());
}

/**
 * Parses a date string such as "2026-09-30T18:00:00" or "2026-09-30 18:00"
 * and returns a valid Date, or null when the input is not a usable date.
 */
export function parseDateInput(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const normalized = String(value).trim().replace(' ', 'T');
  const hasTime = /T\d{2}:\d{2}(:\d{2})?$/.test(normalized);
  const date = new Date(hasTime ? normalized : `${normalized}T23:59:59`);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** deadline - reminderMinutes, returned in the same local ISO format. */
export function calculateReminderAt(deadlineDate, reminderMinutes) {
  const reminderDate = new Date(deadlineDate.getTime() - reminderMinutes * 60 * 1000);
  return toLocalIsoString(reminderDate);
}

export function formatForEmail(localIsoString) {
  if (!localIsoString) return '-';
  const date = new Date(localIsoString);
  if (Number.isNaN(date.getTime())) return localIsoString;
  return date.toLocaleString();
}
