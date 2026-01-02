// src/utils/schedule.js

// Mon..Sun -> 1..7
export const isoDay = d => ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(d) + 1;

// Return next date >= fromDate that falls on iso weekday (1=Mon..7)
export function nextOnOrAfterWeekday(fromDate, isoWeekday) {
  const d = new Date(fromDate);
  const todayIso = ((d.getDay() + 6) % 7) + 1; // JS Sun=0..6 -> ISO 1..7
  const ahead = (isoWeekday - todayIso + 7) % 7;
  const n = new Date(d);
  n.setDate(d.getDate() + ahead);
  n.setHours(0,0,0,0);
  return n;
}

// Weekly (General bin)
export function nextWeekly(weekday, fromDate = new Date()) {
  return nextOnOrAfterWeekday(fromDate, isoDay(weekday));
}

// Fortnightly series starting at startDate (the first *actual* service day)
export function nextFortnightly(startDateStr, weekday, fromDate = new Date()) {
  if (!startDateStr) return null;
  const w = isoDay(weekday);
  const start = new Date(startDateStr);
  start.setHours(0,0,0,0);

  // Make sure "start" is aligned to the service weekday.
  const alignedStart = nextOnOrAfterWeekday(start, w);

  // Find the next occurrence ≥ today jumping by 14 days.
  let n = new Date(alignedStart);
  const today = new Date(fromDate); today.setHours(0,0,0,0);
  while (n < today) {
    n.setDate(n.getDate() + 14);
  }
  return n;
}

// Is a fortnightly service happening in the current ISO week of 'date'?
export function isFortnightlyThisWeek(startDateStr, weekday, date = new Date()) {
  const nextThisOrFuture = nextFortnightly(startDateStr, weekday, date);
  // If the next occurrence is within 7 days and on/after Monday of this week => it's this week
  const monday = nextOnOrAfterWeekday(new Date(date).setDate(date.getDate() - (((date.getDay()+6)%7))), 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return nextThisOrFuture && nextThisOrFuture >= monday && nextThisOrFuture <= sunday;
}