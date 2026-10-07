export const DEFAULT_TIMEZONE = "Europe/Istanbul";

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  weekday: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    weekday: map.weekday,
  };
}

function tzOffsetMs(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function formatOffset(offsetMs: number) {
  const totalMinutes = Math.round(offsetMs / 60_000);
  const sign = totalMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(totalMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function istanbulOffsetForWallTime(ymd: string, hour: string, minute: string, second: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, Number(hour), Number(minute), Number(second));
  return formatOffset(tzOffsetMs(new Date(utcGuess), DEFAULT_TIMEZONE));
}

export function currentTemporalContext(now = new Date()) {
  const parts = zonedParts(now, DEFAULT_TIMEZONE);
  const offset = formatOffset(tzOffsetMs(now, DEFAULT_TIMEZONE));
  return {
    utcIso: now.toISOString(),
    timezone: DEFAULT_TIMEZONE,
    localIso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
    weekday: parts.weekday,
  };
}

export function zonedWallTime(date: Date, timeZone = DEFAULT_TIMEZONE) {
  return zonedParts(date, timeZone);
}

export function addCalendarDays(ymd: { year: number; month: number; day: number }, days: number) {
  const utc = Date.UTC(ymd.year, ymd.month - 1, ymd.day + days);
  return {
    year: new Date(utc).getUTCFullYear(),
    month: new Date(utc).getUTCMonth() + 1,
    day: new Date(utc).getUTCDate(),
  };
}

const ISO_DEADLINE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:(Z)|([+-]\d{2}:?\d{2}))?)?$/i;

export function normalizeDeadline(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(ISO_DEADLINE);
  if (!match) return null;

  const [, date, hour, minute, second, , zulu, offset] = match;
  if (hour === undefined || minute === undefined) return null;

  const ss = (second ?? "00").padStart(2, "0");
  let iso: string;

  if (zulu) {
    iso = `${date}T${hour}:${minute}:${ss}Z`;
  } else if (offset) {
    const normalizedOffset =
      offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
    iso = `${date}T${hour}:${minute}:${ss}${normalizedOffset}`;
  } else {
    iso = `${date}T${hour}:${minute}:${ss}${istanbulOffsetForWallTime(date, hour, minute, ss)}`;
  }

  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return iso;
}

export function parseDeadline(value: string | null | undefined): Date | null {
  const normalized = normalizeDeadline(value);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function withUnparsedDeadlineReason(
  riskReason: string,
  original: string | null | undefined,
  normalized: string | null,
) {
  const raw = original?.trim();
  if (!raw || normalized) return riskReason;
  const note = `Could not parse deadline "${raw}" into an ISO datetime.`;
  if (riskReason.includes(note)) return riskReason;
  return riskReason.trim() ? `${riskReason} ${note}` : note;
}
