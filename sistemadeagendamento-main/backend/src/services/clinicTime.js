const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const formatterCache = new Map();
const offsetsCache = new Map();

function formatterFor(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timeZone);
}

function utcFromParts({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

function localPartsAt(timestamp, timeZone) {
  const date = new Date(timestamp);
  const parts = Object.fromEntries(
    formatterFor(timeZone).formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: date.getUTCMilliseconds(),
  };
}

function parseDate(date) {
  if (typeof date !== 'string') return null;
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;

  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const timestamp = utcFromParts(parts);
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

function parseLocalDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
    millisecond: Number((match[7] || '').padEnd(3, '0') || 0),
  };
  const timestamp = utcFromParts(parts);
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    return null;
  }
  return parts;
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function offsetsForDate(date, timeZone) {
  const key = `${timeZone}:${date}`;
  if (offsetsCache.has(key)) return offsetsCache.get(key);

  const dateParts = parseDate(date);
  if (!dateParts || !isValidTimeZone(timeZone)) return [];
  const noon = utcFromParts({ ...dateParts, hour: 12 });
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = noon + hours * 60 * 60 * 1000;
    const wholeSecond = Math.floor(instant / 1000) * 1000;
    const localAsUtc = utcFromParts(localPartsAt(wholeSecond, timeZone));
    offsets.add(localAsUtc - wholeSecond);
  }

  const result = [...offsets];
  if (offsetsCache.size >= 256) offsetsCache.delete(offsetsCache.keys().next().value);
  offsetsCache.set(key, result);
  return result;
}

function possibleInstants(parts, timeZone) {
  if (!isValidTimeZone(timeZone)) return [];
  const localEpoch = utcFromParts(parts);
  const date = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const matches = new Set();

  for (const offset of offsetsForDate(date, timeZone)) {
    const candidate = localEpoch - offset;
    const actual = localPartsAt(candidate, timeZone);
    if (
      actual.year === parts.year &&
      actual.month === parts.month &&
      actual.day === parts.day &&
      actual.hour === parts.hour &&
      actual.minute === parts.minute &&
      actual.second === parts.second &&
      actual.millisecond === parts.millisecond
    ) {
      matches.add(candidate);
    }
  }
  return [...matches].sort((a, b) => a - b);
}

export function clinicLocalDateTimeToTimestamp(value, timeZone) {
  const parts = parseLocalDateTime(value);
  if (!parts) return null;
  const matches = possibleInstants(parts, timeZone);
  return matches.length === 1 ? matches[0] : null;
}

export function isUniqueClinicInstant(value, timeZone) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || !isValidTimeZone(timeZone)) return false;
  const parts = localPartsAt(timestamp, timeZone);
  const matches = possibleInstants(parts, timeZone);
  return matches.length === 1 && matches[0] === timestamp;
}

function boundaryForDate(dateParts, timeZone) {
  const midnight = { ...dateParts, hour: 0, minute: 0, second: 0, millisecond: 0 };
  const exact = possibleInstants(midnight, timeZone);
  if (exact.length) return exact[0];

  const midnightEpoch = utcFromParts(midnight);
  for (let minute = 1; minute <= 24 * 60; minute += 1) {
    const shifted = new Date(midnightEpoch + minute * 60_000);
    const local = {
      ...dateParts,
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: 0,
      millisecond: 0,
    };
    const candidates = possibleInstants(local, timeZone);
    if (candidates.length) return candidates[0];
  }
  return null;
}

function nextDateParts(parts) {
  const next = new Date(utcFromParts(parts) + 24 * 60 * 60 * 1000);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function clinicDay(date, timeZone) {
  const parts = parseDate(date);
  if (!parts || !isValidTimeZone(timeZone)) return null;

  const start = boundaryForDate(parts, timeZone);
  const end = boundaryForDate(nextDateParts(parts), timeZone);
  if (start === null || end === null || end <= start) return null;

  const weekdayValue = new Date(utcFromParts({ ...parts, hour: 12 })).getUTCDay();
  return {
    date,
    start,
    end,
    weekday: weekdayValue === 0 ? 7 : weekdayValue,
  };
}

export function clinicDateAt(value, timeZone) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || !isValidTimeZone(timeZone)) return null;
  const parts = localPartsAt(timestamp, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function clinicTimeOfDay(timestamp, timeZone) {
  const parts = localPartsAt(timestamp, timeZone);
  return ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 + parts.millisecond;
}
