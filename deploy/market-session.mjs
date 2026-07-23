const NEW_YORK_TIME_ZONE = 'America/New_York';
const COVERED_HOLIDAY_YEAR = 2026;

const HOLIDAYS = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
]);

const HALF_DAYS = new Set([
  '2026-11-27',
  '2026-12-24',
]);

const warnedHolidayYears = new Set();

function minutes(hour, minute = 0) {
  return hour * 60 + minute;
}

export function etParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday,
  };
}

function sessionFromTradingPeriod(date, currentTradingPeriod) {
  if (!currentTradingPeriod || typeof currentTradingPeriod !== 'object') return null;
  const timestamp = Math.floor(date.getTime() / 1000);
  for (const session of ['pre', 'regular', 'post']) {
    const period = currentTradingPeriod[session];
    const start = Number(period?.start);
    const end = Number(period?.end);
    if (Number.isFinite(start) && Number.isFinite(end) && timestamp >= start && timestamp < end) {
      return session;
    }
  }
  return null;
}

function warnOutdatedHolidayTable(year, logger) {
  if (year === COVERED_HOLIDAY_YEAR || warnedHolidayYears.has(year)) return;
  warnedHolidayYears.add(year);
  logger(`[market-session] ${year} 超出本地美股假期表覆盖范围；已降级为周末与 ET 时段表判断，请更新假期表`);
}

export function classifyMarketSession(date, {
  currentTradingPeriod = null,
  hasMinuteSeries = true,
  logger = console.warn,
} = {}) {
  const upstreamSession = sessionFromTradingPeriod(date, currentTradingPeriod);
  if (upstreamSession) return upstreamSession;
  if (!hasMinuteSeries) return 'closed';

  const {
    date: localDate,
    year,
    minutes: localMinutes,
    weekday,
  } = etParts(date);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  if (weekend) return 'closed';

  if (year === COVERED_HOLIDAY_YEAR && HOLIDAYS.has(localDate)) return 'closed';
  warnOutdatedHolidayTable(year, logger);

  const halfDay = year === COVERED_HOLIDAY_YEAR && HALF_DAYS.has(localDate);
  const regularEnd = halfDay ? minutes(13) : minutes(16);
  const postEnd = halfDay ? minutes(17) : minutes(20);
  if (localMinutes >= minutes(4) && localMinutes < minutes(9, 30)) return 'pre';
  if (localMinutes >= minutes(9, 30) && localMinutes < regularEnd) return 'regular';
  if (localMinutes >= regularEnd && localMinutes < postEnd) return 'post';
  return 'overnight';
}
