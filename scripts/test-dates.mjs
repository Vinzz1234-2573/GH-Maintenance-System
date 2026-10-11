// Date-handling regression test — no framework, just node:assert.
// Every assertion must hold in every timezone.
//
//   node scripts/test-dates.mjs
//     -> re-runs itself under Asia/Kuala_Lumpur, UTC and America/Los_Angeles
//   TZ=Asia/Kuala_Lumpur node scripts/test-dates.mjs
//     -> runs once in that zone
//
// Note: Git Bash on Windows strips TZ before launching node.exe, so
// "TZ=... node ..." there silently runs in the system zone. Use the
// no-argument form (or PowerShell: $env:TZ='UTC'; node scripts/test-dates.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ZONES = ["Asia/Kuala_Lumpur", "UTC", "America/Los_Angeles"];

if (!process.env.TZ) {
  let failed = false;
  for (const zone of ZONES) {
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", fileURLToPath(import.meta.url)],
      { env: { ...process.env, TZ: zone }, stdio: "inherit" },
    );
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const { todayStr, toDateStr, addDays, isoWeekday, daysInMonth, periodRange } = await import("../lib/dates.js");
const { occurrenceDatesInRange } = await import("../lib/schedule.js");

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
// Guard against a TZ that was silently ignored, which would make the run meaningless.
assert.equal(tz, process.env.TZ, `TZ=${process.env.TZ} was not applied (runtime reports ${tz})`);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL [${tz}] ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

const daily = { frequency: "daily", start_date: "2026-01-01" };

test("daily: one-day range returns exactly that day", () => {
  assert.deepEqual(occurrenceDatesInRange(daily, "2026-10-07", "2026-10-07"), ["2026-10-07"]);
});

test("daily: three-day range returns exactly those three days", () => {
  assert.deepEqual(occurrenceDatesInRange(daily, "2026-10-07", "2026-10-09"), ["2026-10-07", "2026-10-08", "2026-10-09"]);
});

test("daily: range across month/year end and DST changes", () => {
  assert.deepEqual(occurrenceDatesInRange(daily, "2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(occurrenceDatesInRange(daily, "2026-03-07", "2026-03-09"), ["2026-03-07", "2026-03-08", "2026-03-09"]); // US DST start
  assert.deepEqual(occurrenceDatesInRange(daily, "2026-10-31", "2026-11-02"), ["2026-10-31", "2026-11-01", "2026-11-02"]); // US DST end
});

test("daily: start_date is respected", () => {
  assert.deepEqual(occurrenceDatesInRange({ frequency: "daily", start_date: "2026-10-08" }, "2026-10-07", "2026-10-09"), ["2026-10-08", "2026-10-09"]);
});

test("weekly: Monday (1) only", () => {
  // 2026-10-05 is a Monday.
  const weekly = { frequency: "weekly", weekly_days: [1], start_date: "2026-01-01" };
  assert.deepEqual(occurrenceDatesInRange(weekly, "2026-10-01", "2026-10-31"), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
});

test("weekly: Sunday is 7, multiple days", () => {
  const weekly = { frequency: "weekly", weekly_days: [3, 7], start_date: "2026-01-01" };
  assert.deepEqual(occurrenceDatesInRange(weekly, "2026-10-05", "2026-10-11"), ["2026-10-07", "2026-10-11"]);
});

test("isoWeekday", () => {
  assert.equal(isoWeekday("2026-10-05"), 1);
  assert.equal(isoWeekday("2026-10-11"), 7);
  assert.equal(isoWeekday("2024-02-29"), 4);
});

test("monthly: day 31 clamps to month length", () => {
  const monthly = { frequency: "monthly", monthly_day: 31, start_date: "2026-01-01" };
  assert.deepEqual(occurrenceDatesInRange(monthly, "2026-01-01", "2026-05-31"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  assert.deepEqual(occurrenceDatesInRange(monthly, "2028-02-01", "2028-02-29"), ["2028-02-29"]); // leap year
});

test("monthly: ordinary day", () => {
  const monthly = { frequency: "monthly", monthly_day: 15, start_date: "2026-01-01" };
  assert.deepEqual(occurrenceDatesInRange(monthly, "2026-10-01", "2026-11-30"), ["2026-10-15", "2026-11-15"]);
});

test("daysInMonth", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("once: matches only its date", () => {
  const once = { frequency: "once", start_date: "2026-10-08" };
  assert.deepEqual(occurrenceDatesInRange(once, "2026-10-01", "2026-10-31"), ["2026-10-08"]);
  assert.deepEqual(occurrenceDatesInRange(once, "2026-10-09", "2026-10-31"), []);
});

test("addDays", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-10-07", -30), "2026-09-07");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
});

test("toDateStr / todayStr use local calendar date (early-morning and late-evening)", () => {
  // Local 01:00 on 7 Oct — the old toISOString() code returned 6 Oct in UTC+8.
  assert.equal(toDateStr(new Date(2026, 9, 7, 1, 0)), "2026-10-07");
  assert.equal(todayStr(new Date(2026, 9, 7, 1, 0)), "2026-10-07");
  // Local 23:30 on 7 Oct — west of UTC the old code returned 8 Oct.
  assert.equal(todayStr(new Date(2026, 9, 7, 23, 30)), "2026-10-07");
});

test("periodRange('week') is Monday–Sunday containing today", () => {
  for (const day of [5, 7, 11]) {
    // 5 Oct 2026 = Mon, 7 = Wed, 11 = Sun; check both early and late in the day.
    for (const hour of [0, 1, 12, 23]) {
      const r = periodRange("week", new Date(2026, 9, day, hour, 30));
      assert.deepEqual(r, { from: "2026-10-05", to: "2026-10-11" }, `day ${day} hour ${hour}`);
      assert.equal(isoWeekday(r.from), 1);
      assert.equal(isoWeekday(r.to), 7);
    }
  }
});

test("periodRange today/tomorrow/month", () => {
  const now = new Date(2026, 1, 28, 0, 30); // 28 Feb 2026, 00:30 local
  assert.deepEqual(periodRange("today", now), { from: "2026-02-28", to: "2026-02-28" });
  assert.deepEqual(periodRange("tomorrow", now), { from: "2026-03-01", to: "2026-03-01" });
  assert.deepEqual(periodRange("month", now), { from: "2026-02-01", to: "2026-02-28" });
});

if (process.exitCode) {
  console.error(`[${tz}] some tests failed (${passed} passed)`);
} else {
  console.log(`[${tz}] all ${passed} date tests passed`);
}
