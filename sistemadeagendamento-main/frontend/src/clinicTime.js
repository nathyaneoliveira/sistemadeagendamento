const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const formatterCache = new Map();

function formatterFor(timeZone, options = {}) {
  const key = `${timeZone}:${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      ...options,
    }));
  }
  return formatterCache.get(key);
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
    formatterFor(timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
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

function parseLocalDateTime(value) {
  const match = typeof value === 'string' ? LOCAL_DATE_TIME_PATTERN.exec(value) : null;
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
  const date = new Date(utcFromParts(parts));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    return null;
  }
  return parts;
}

function matchingInstants(parts, timeZone) {
  const localEpoch = utcFromParts(parts);
  const noon = utcFromParts({ ...parts, hour: 12, minute: 0, second: 0, millisecond: 0 });
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = Math.floor((noon + hours * 60 * 60 * 1000) / 1000) * 1000;
    const local = localPartsAt(instant, timeZone);
    offsets.add(utcFromParts(local) - instant);
  }

  const matches = new Set();
  for (const offset of offsets) {
    const candidate = localEpoch - offset;
    const actual = localPartsAt(candidate, timeZone);
    if (Object.keys(parts).every((key) => actual[key] === parts[key])) {
      matches.add(candidate);
    }
  }
  return [...matches];
}

export function clinicDateTimeToIso(value, timeZone) {
  try {
    const parts = parseLocalDateTime(value);
    if (!parts || typeof timeZone !== 'string' || !timeZone.trim()) return null;
    const matches = matchingInstants(parts, timeZone);
    return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function clinicDateAt(value, timeZone) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  try {
    const { year, month, day } = localPartsAt(timestamp, timeZone);
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function clinicDateTimeInputValue(value, timeZone) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  try {
    const parts = localPartsAt(timestamp, timeZone);
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  } catch (error) {
    if (error instanceof RangeError) return '';
    throw error;
  }
}

export function clinicToday(timeZone) {
  return clinicDateAt(Date.now(), timeZone) || '';
}

export function isValidIanaTimeZone(timeZone) {
  try {
    if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
    formatterFor(timeZone);
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
