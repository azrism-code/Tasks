import { DateTime } from 'luxon';

export function nextOccurrence(reminder, after) {
  if (!reminder || reminder.repeat === 'none') return null;
  const base = new Date(reminder.dateTime);
  if (Number.isNaN(base.getTime())) return null;
  const zone = reminder.timeZone || 'UTC';
  const anchor = DateTime.fromJSDate(base, {zone});
  if (!anchor.isValid) return null;
  const step = reminder.repeat === 'custom'
    ? {unit: reminder.customRepeat?.unit, interval: Number(reminder.customRepeat?.interval)}
    : {unit: {daily:'day',weekly:'week',monthly:'month'}[reminder.repeat], interval:1};
  if (!['day','week','month'].includes(step.unit) || !Number.isInteger(step.interval) || step.interval < 1 || step.interval > 365) return null;
  const target = +new Date(after);
  const key = {day:'days',week:'weeks',month:'months'}[step.unit];
  for (let n=1; n<5000; n++) {
    const candidate = anchor.plus({[key]:n*step.interval});
    if (candidate.toMillis() > target) return candidate.toUTC().toISO();
  }
  return null;
}
