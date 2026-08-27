# Health Logbook: Fitbit Data via the Google Health API

This is the data layer, and it's core to the system (not optional). It gives the coach direct access to your Fitbit numbers with no screenshots and no manual entry.

## How it works

Your Fitbit syncs to Google's cloud. An Apps Script on your **personal** Google account pulls weight, steps, sleep, calories burned, resting heart rate, and workout peak heart rate from the Google Health API into a Google Sheet, once nightly on a trigger, and on demand when the coach asks. The same script exposes a webhook the coach calls from claude.ai to pull today's numbers, write its own fields (intake, macros, mood, training, dose), and read history.

One important 2026 fact baked into this design: the legacy Fitbit Web API shuts down in September 2026, so this builds directly on its replacement, the Google Health API. Registration happens in Google Cloud Console, and personal use is supported: an unverified app is capped at 100 users (you are 1), and Google's own docs say to publish the app to production to avoid the 7-day refresh-token expiry that testing-mode apps get. Published, unverified, single-user is the correct end state.

## Part A: Google Cloud setup (~10 minutes, personal Google account)

1. Go to console.cloud.google.com signed in as your **personal** account. Create a new project, name it `health-logbook`.
2. APIs & Services > Library > search "Google Health API" > Enable.
3. APIs & Services > OAuth consent screen: User type **External**. App name `health-logbook`, your email for both contact fields. Save.
4. On the consent screen's Audience/Test users section, add your own personal Gmail as a test user.
5. Note the **project number** from the Cloud console dashboard (you'll link Apps Script to it in Part B).
6. Leave publishing status as Testing for now. You'll hit Publish app after the first successful authorization in Part B. Publishing is what makes refresh tokens long-lived; under 100 users there's no review, and the "unverified app" warning during consent is expected (Advanced > Continue).

## Part B: Sheet + Apps Script (~15 minutes)

1. In your personal Google Drive, create a Sheet named **Health Logbook** with a tab named `Log` and this exact header row:

   `date | weight | steps | sleep | burn | kcal | protein | fat | carbs | rhr | peak_hr | training | dose | mood | note`

2. Extensions > Apps Script. In Project Settings: check "Show appsscript.json in editor", set your time zone, and under Google Cloud Platform (GCP) Project, paste the project number from Part A.

3. Replace `appsscript.json` with:

```json
{
  "timeZone": "America/Denver",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly"
  ]
}
```

   Set `timeZone` to yours. If authorization later complains about an unknown scope name, check the current scope list at developers.google.com/health and adjust; the `activity_and_fitness` one is confirmed verbatim from Google's docs, the other two follow Google's published scope-bundle names.

4. Replace `Code.gs` with:

```javascript
// ================= CONFIG =================
const SHEET_NAME = 'Log';
const TOKEN = 'REPLACE-WITH-A-LONG-RANDOM-STRING';
const API = 'https://health.googleapis.com/v4/users/me/dataTypes/';
const COLS = ['date','weight','steps','sleep','burn','kcal','protein','fat',
              'carbs','rhr','peak_hr','training','dose','mood','note'];

// ================ WEB APP =================
function doGet(e) {
  const p = e.parameter || {};
  if (p.token !== TOKEN) return out_({ error: 'bad token' });
  try {
    if (p.action === 'pull') {
      const date = p.date || today_();
      const pulled = pullDay_(date);
      upsertRow_(date, pulled);
      return out_({ ok: true, date: date, row: readRow_(date), errors: pulled._errors });
    }
    if (p.action === 'log') {
      if (!p.date) return out_({ error: 'date required' });
      const fields = {};
      COLS.forEach(c => { if (p[c] !== undefined) fields[c] = p[c]; });
      upsertRow_(p.date, fields);
      return out_({ ok: true, row: readRow_(p.date) });
    }
    if (p.action === 'read') {
      const days = Math.min(Number(p.days) || 30, 120);
      return out_({ rows: readLast_(days) });
    }
    return out_({ error: 'unknown action (use pull, log, or read)' });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ NIGHTLY TRIGGER =============
// Attach a daily 5-6am time-driven trigger to this. Pulls yesterday's
// final numbers after the night's sleep has synced.
function healthNightlyPull() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const date = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  upsertRow_(date, pullDay_(date));
}

// Run this once by hand to authorize and smoke-test.
function testPullToday() {
  const date = today_();
  const pulled = pullDay_(date);
  Logger.log(JSON.stringify(pulled, null, 2));
  upsertRow_(date, pulled);
}

// ============== HEALTH API ================
function pullDay_(date) {
  const r = { _errors: [] };
  const attempt = (label, fn) => {
    try { return fn(); }
    catch (err) { r._errors.push(label + ': ' + String(err).slice(0, 200)); return ''; }
  };

  r.steps = attempt('steps', () => {
    const d = apiGetDay_('steps', 'steps', date);
    const vals = findNums_(d, ['steps', 'count']);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : '';
  });

  r.burn = attempt('burn', () => {
    const d = apiGetDay_('calories-burned', 'calories_burned', date);
    const vals = findNums_(d, ['caloriesKcal', 'calories', 'energyKcal']);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : '';
  });

  r.rhr = attempt('rhr', () => {
    const d = apiGetDay_('resting-heart-rate', 'resting_heart_rate', date);
    const vals = findNums_(d, ['beatsPerMinute', 'bpm']);
    return vals.length ? vals[vals.length - 1] : '';
  });

  r.peak_hr = attempt('peak_hr', () => {
    const vals = findNums_(apiGetDay_('heart-rate', 'heart_rate', date),
                           ['beatsPerMinute', 'bpm']);
    return vals.length ? Math.max.apply(null, vals) : '';
  });

  r.weight = attempt('weight', () => {
    const d = apiGetDay_('weight', 'weight', date);
    const kg = findNums_(d, ['weightKg']);
    if (kg.length) return Math.round(kg[kg.length - 1] * 2.20462 * 10) / 10;
    const lb = findNums_(d, ['weightLb', 'weightPounds']);
    return lb.length ? lb[lb.length - 1] : '';
  });

  r.sleep = attempt('sleep', () => {
    const d = apiGetDay_('sleep', 'sleep', date);
    const mins = findNums_(d, ['minutesAsleep', 'totalMinutesAsleep']);
    if (!mins.length) return '';
    const m = Math.max.apply(null, mins);
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  });

  return r;
}

// Fetch one data type for one civil date. Tries the documented filter
// grammars in order; different data kinds use different time fields.
function apiGetDay_(type, filterPrefix, date) {
  const day0 = date + 'T00:00:00';
  const day1 = date + 'T23:59:59';
  const filters = [
    `${filterPrefix}.interval.civil_start_time >= "${day0}" AND ${filterPrefix}.interval.civil_start_time <= "${day1}"`,
    `${filterPrefix}.date == "${date}"`,
    `${filterPrefix}.sample_time.civil_time >= "${day0}" AND ${filterPrefix}.sample_time.civil_time <= "${day1}"`,
    `${filterPrefix}.interval.start_time >= "${utc_(day0)}" AND ${filterPrefix}.interval.start_time <= "${utc_(day1)}"`,
    `${filterPrefix}.sample_time.physical_time >= "${utc_(day0)}" AND ${filterPrefix}.sample_time.physical_time <= "${utc_(day1)}"`,
    `${filterPrefix}.interval.end_time >= "${utc_(day0)}" AND ${filterPrefix}.interval.end_time <= "${utc_(day1)}"`
  ];
  let lastErr = null;
  for (let i = 0; i < filters.length; i++) {
    try {
      const first = apiGet_(type + '/dataPoints?pageSize=10000&filter=' +
                            encodeURIComponent(filters[i]));
      if (!first.dataPoints || !first.dataPoints.length) continue;
      let all = first, pages = 1;
      while (all.nextPageToken && pages < 5) {
        const next = apiGet_(type + '/dataPoints?pageSize=10000&pageToken=' +
                             all.nextPageToken + '&filter=' + encodeURIComponent(filters[i]));
        first.dataPoints = first.dataPoints.concat(next.dataPoints || []);
        all = next; pages++;
      }
      return first;
    } catch (err) { lastErr = err; }
  }
  if (lastErr) throw lastErr;
  return { dataPoints: [] };
}

function apiGet_(path) {
  const res = UrlFetchApp.fetch(API + path, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('HTTP ' + res.getResponseCode() + ' on ' + path.split('?')[0] +
                    ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

// Dumps raw API responses for one day so schema mismatches are easy to fix.
function debugDay() {
  const date = today_();
  ['steps', 'calories-burned', 'resting-heart-rate', 'heart-rate', 'weight', 'sleep']
    .forEach(t => {
      try {
        const raw = apiGet_(t + '/dataPoints?pageSize=3');
        Logger.log('==== %s ====\n%s', t, JSON.stringify(raw).slice(0, 3000));
      } catch (err) { Logger.log('==== %s ==== ERROR %s', t, err); }
    });
}

// ================ HELPERS =================
function findNums_(obj, keys) {
  const found = [];
  (function walk(o) {
    if (o && typeof o === 'object') {
      for (const k in o) {
        if (keys.indexOf(k) !== -1 && typeof o[k] === 'number') found.push(o[k]);
        else if (keys.indexOf(k) !== -1 && !isNaN(Number(o[k]))) found.push(Number(o[k]));
        else walk(o[k]);
      }
    }
  })(obj);
  return found;
}

function sheet_() { return SpreadsheetApp.getActive().getSheetByName(SHEET_NAME); }
function tz_() { return Session.getScriptTimeZone(); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function utc_(civil) {
  const d = Utilities.parseDate(civil, tz_(), "yyyy-MM-dd'T'HH:mm:ss");
  return Utilities.formatDate(d, 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function upsertRow_(date, fields) {
  const sh = sheet_();
  const n = Math.max(sh.getLastRow() - 1, 1);
  const dates = sh.getRange(2, 1, n, 1).getDisplayValues().map(r => r[0]);
  let row = dates.indexOf(date) + 2;
  if (row === 1) { row = sh.getLastRow() + 1; sh.getRange(row, 1).setValue(date); }
  COLS.forEach((c, i) => {
    if (c !== 'date' && fields[c] !== undefined && fields[c] !== '') {
      sh.getRange(row, i + 1).setValue(fields[c]);
    }
  });
}

function readRow_(date) {
  const sh = sheet_();
  const n = Math.max(sh.getLastRow() - 1, 1);
  const dates = sh.getRange(2, 1, n, 1).getDisplayValues().map(r => r[0]);
  const idx = dates.indexOf(date);
  if (idx === -1) return null;
  const vals = sh.getRange(idx + 2, 1, 1, COLS.length).getDisplayValues()[0];
  const o = {};
  COLS.forEach((c, i) => o[c] = vals[i]);
  return o;
}

function readLast_(days) {
  const sh = sheet_();
  const last = sh.getLastRow();
  const n = Math.min(days, last - 1);
  if (n < 1) return [];
  return sh.getRange(last - n + 1, 1, n, COLS.length).getDisplayValues()
    .map(vals => { const o = {}; COLS.forEach((c, i) => o[c] = vals[i]); return o; });
}
```

5. Set `TOKEN` to a long random string.
6. Run `testPullToday()` from the editor. Google will walk you through consent, including the "unverified app" warning (Advanced > Continue). Check the execution log and the Sheet: you should see today's row with whatever has synced so far.
7. Back in Cloud console, OAuth consent screen > **Publish app**. This is the step that keeps tokens alive indefinitely.
8. In Apps Script, Triggers (clock icon) > Add trigger: `healthNightlyPull`, time-driven, daily, 5-6 AM.
9. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone with the link. Copy the `/exec` URL.
10. Paste the URL and token into the "Logbook webhook" block at the bottom of the Coach Charter, then paste the completed charter into the project instructions.

## The webhook API (what the coach uses)

- `?action=pull&date=2026-08-27&token=...` pulls that day's Fitbit data into the Sheet and returns the row (date defaults to today). Any per-metric failures come back in `errors` instead of failing the call.
- `?action=log&date=2026-08-27&kcal=2100&protein=165&fat=90&carbs=110&mood=7&dose=0.8&training=...&note=...&token=...` writes the coach's fields into that day's row and returns the full row for verification. URL-encode text values.
- `?action=read&days=30&token=...` returns the last N rows as JSON.

## Troubleshooting

- **A column comes back blank every day.** The Google Health API is new and per-type response shapes vary; the script's parsers match multiple candidate field names but can miss. Run `debugDay()` in the Apps Script editor and hand the log output to Claude on your personal account with "fix the parser for X"; it's a one-function fix. The `apiGetDay_` filter list is the other adjustment point.
- **Weight specifically stays blank.** Then your scale's weigh-ins aren't reaching Google's cloud store (they may live only on-device in Health Connect). No drama: say the scale number at close-out and the coach logs it via `action=log`. Everything else still flows automatically.
- **Writes that error but actually landed.** Known Apps Script web-app quirk (same as the Dr. Axe calendar webhook): verify, don't trust. The coach's charter already tells it to confirm from the returned row, and `pull`/`log` both return the row precisely so nothing needs a second call.
- **Security.** Anyone with the URL and token could read or write rows. The long random token in a private project instruction keeps honest people honest; it's a logbook, not a bank.
