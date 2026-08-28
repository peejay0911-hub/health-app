// ================= CONFIG =================
const SHEET_NAME = 'Log';
const TOKEN = 'REPLACE-WITH-A-LONG-RANDOM-STRING';
const API = 'https://health.googleapis.com/v4/users/me/dataTypes/';

// health.googleapis.com rejects any access token that also carries non-health
// scopes (it named script.external_request and spreadsheets.currentonly as
// "disallowed_scopes" in a 403). ScriptApp.getOAuthToken() always carries every
// scope the script holds, so Health calls use a separate OAuth client that asks
// for the three health scopes and nothing else. Its id/secret live in Script
// Properties, never in this file.
const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly'
].join(' ');
const COLS = ['date','weight','steps','sleep','burn','kcal','protein','fat',
              'carbs','rhr','peak_hr','training','dose','mood','note'];
const ALERT_EMAIL = 'peejay0911@gmail.com';

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
      // Claude cannot reach this URL from its own environment, so close-out is
      // PJ tapping a link the coach composes. pull=1 folds the Fitbit pull into
      // that same request, making it one tap rather than two.
      if (p.pull === '1') upsertRow_(p.date, pullDay_(p.date));
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
//
// Publishing the OAuth app to production is blocked without a domain and a
// hosted privacy policy, so it stays in Testing, where Google expires refresh
// tokens every 7 days. That failure is silent and looks exactly like a quiet
// week, so anything wrong is written into the row's note column, where the
// coach reads it every morning.
function healthNightlyPull() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const date = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');

  if (!healthService_().hasAccess()) {
    flagProblem_(date, 'Health auth expired: open Apps Script, run ' +
                       'authorizeHealth(), then open the URL it logs.');
    return;
  }
  const pulled = pullDay_(date);
  upsertRow_(date, pulled);
  if (pulled._errors.length) {
    flagProblem_(date, 'Pull errors: ' + pulled._errors.join(' | '));
  }
}

// Appends rather than overwrites: the note column is also where the coach
// records how a day felt.
function flagProblem_(date, msg) {
  Logger.log('%s: %s', date, msg);
  const row = readRow_(date);
  const prior = row && row.note ? row.note + ' | ' : '';
  upsertRow_(date, { note: (prior + msg).slice(0, 500) });
  alertOnce_('sync problem on ' + date, msg);
}

// Google's own trigger notifications only fire on an exception. Expired auth
// fails politely instead, which would otherwise look like a quiet week, so mail
// it directly. Capped at one a day: the top-up trigger runs twelve times.
function alertOnce_(subject, body) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LAST_ALERT') === today_()) return;
  try {
    MailApp.sendEmail(ALERT_EMAIL, '[Health Logbook] ' + subject, body);
    props.setProperty('LAST_ALERT', today_());
  } catch (err) { Logger.log('alert email failed: %s', err); }
}

// Keeps today's row current so close-out can just read the sheet. Attach a
// time-driven trigger every 2 hours. Claude cannot write to the logbook, so
// nothing reaches the sheet unless a trigger puts it there.
function healthPullToday() {
  const date = today_();
  if (!healthService_().hasAccess()) {
    flagProblem_(date, 'Health auth expired: open Apps Script, run authorizeHealth().');
    return;
  }
  upsertRow_(date, pullDay_(date));
}

// One-off history fill. Apps Script stops any run at 6 minutes and a full day's
// heart-rate pull is slow, so this bails out early and skips days already done:
// re-run it until the log says nothing was filled.
function backfillHistory() {
  const DAYS = 14;
  if (!healthService_().hasAccess()) {
    Logger.log('Not authorized. Run authorizeHealth() first.');
    return;
  }
  const started = Date.now();
  let filled = 0, skipped = 0, ranOut = false;
  for (let i = 1; i <= DAYS; i++) {
    if (Date.now() - started > 4.5 * 60 * 1000) { ranOut = true; break; }
    const date = Utilities.formatDate(new Date(Date.now() - i * 24 * 3600 * 1000),
                                      tz_(), 'yyyy-MM-dd');
    const row = readRow_(date);
    if (row && row.steps !== '') { skipped++; continue; }
    const pulled = pullDay_(date);
    upsertRow_(date, pulled);
    filled++;
    Logger.log('%s  steps %s | burn %s | weight %s | sleep %s | rhr %s | peak %s%s',
               date, pulled.steps, pulled.burn, pulled.weight, pulled.sleep,
               pulled.rhr, pulled.peak_hr,
               pulled._errors.length ? '  ERRORS: ' + pulled._errors.join(' | ') : '');
  }
  // Backfilled dates append to the bottom, so put the sheet back in date order.
  const sh = sheet_();
  if (sh.getLastRow() > 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length)
      .sort({ column: 1, ascending: true });
  }
  Logger.log('Filled %s, skipped %s (already had data).%s', filled, skipped,
             ranOut ? ' Hit the time limit - run again to continue.' : ' Done.');
}

// Run this once by hand to authorize and smoke-test.
function testPullToday() {
  const date = today_();
  const pulled = pullDay_(date);
  Logger.log(JSON.stringify(pulled, null, 2));
  upsertRow_(date, pulled);
}

// ============== HEALTH API ================
// Each metric names its data type path (kebab-case), its filter prefix
// (snake_case), and which time field the API allows filtering it on. Those
// differ per type and are not interchangeable: interval types expose
// .interval.civil_start_time, sample types .sample_time.civil_time, daily
// summaries .date, and sleep only its session end time. Grammar and operators
// come from the v4 discovery doc; note it supports >= and < but NOT <=.
const TYPES = {
  steps:      { path: 'steps',                    prefix: 'steps',                    kind: 'interval' },
  weight:     { path: 'weight',                   prefix: 'weight',                   kind: 'sample'   },
  heart_rate: { path: 'heart-rate',               prefix: 'heart_rate',               kind: 'sample'   },
  rhr:        { path: 'daily-resting-heart-rate', prefix: 'daily_resting_heart_rate', kind: 'daily'    },
  // Kept for debugBurn only; burn itself comes from the total-calories rollup
  // because basal returns no data points.
  active:     { path: 'active-energy-burned',     prefix: 'active_energy_burned',     kind: 'interval' },
  basal:      { path: 'basal-energy-burned',      prefix: 'basal_energy_burned',      kind: 'interval' },
  sleep:      { path: 'sleep',                    prefix: 'sleep',                    kind: 'sleep'    }
};

function pullDay_(date) {
  const r = { _errors: [] };
  const attempt = (label, fn) => {
    try { return fn(); }
    catch (err) { r._errors.push(label + ': ' + String(err).slice(0, 300)); return ''; }
  };

  r.steps = attempt('steps', () => {
    const vals = findNums_(apiGetDay_(TYPES.steps, date), ['count']);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : '';
  });

  // Fitbit publishes active-energy-burned but no basal-energy-burned data
  // points, so summing the two yields active burn alone (227 kcal against the
  // app's ~3,100 for the same day). The real total exists only pre-aggregated,
  // behind the rollup endpoint.
  r.burn = attempt('burn', () => {
    const vals = findNums_(rollupDay_('total-calories', date), ['kcalSum']);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : '';
  });

  r.rhr = attempt('rhr', () => {
    const vals = findNums_(apiGetDay_(TYPES.rhr, date), ['beatsPerMinute']);
    return vals.length ? vals[vals.length - 1] : '';
  });

  r.peak_hr = attempt('peak_hr', () => {
    const vals = findNums_(apiGetDay_(TYPES.heart_rate, date), ['beatsPerMinute']);
    return vals.length ? Math.max.apply(null, vals) : '';
  });

  r.weight = attempt('weight', () => {
    const g = findNums_(apiGetDay_(TYPES.weight, date), ['weightGrams']);
    return g.length ? Math.round(g[g.length - 1] / 453.59237 * 10) / 10 : '';
  });

  // Summed rather than maxed, so a nap counts toward the day's sleep.
  r.sleep = attempt('sleep', () => {
    const mins = findNums_(apiGetDay_(TYPES.sleep, date), ['minutesAsleep']);
    if (!mins.length) return '';
    const m = mins.reduce((a, b) => a + b, 0);
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  });

  return r;
}

// Civil-time literals keep this in PJ's own day boundaries, so no UTC
// conversion is needed. Sleep is filtered by when the session ended, which is
// what attributes last night's sleep to today.
function dayFilter_(spec, date) {
  const next = nextDate_(date);
  const range = (field) =>
    `${spec.prefix}.${field} >= "${date}" AND ${spec.prefix}.${field} < "${next}"`;
  switch (spec.kind) {
    case 'interval': return range('interval.civil_start_time');
    case 'sample':   return range('sample_time.civil_time');
    case 'daily':    return range('date');
    case 'sleep':    return range('interval.civil_end_time');
  }
  throw new Error('unknown kind: ' + spec.kind);
}

function apiGetDay_(spec, date) {
  const filter = encodeURIComponent(dayFilter_(spec, date));
  const out = { dataPoints: [] };
  let token = '', pages = 0;
  do {
    const page = apiGet_(spec.path + '/dataPoints?pageSize=1000&filter=' + filter +
                         (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    out.dataPoints = out.dataPoints.concat(page.dataPoints || []);
    token = page.nextPageToken || '';
  } while (token && ++pages < 25);
  return out;
}

function healthToken_() {
  const svc = healthService_();
  if (!svc.hasAccess()) {
    throw new Error('Health API not authorized. Run authorizeHealth() and open ' +
                    'the URL it logs. Last error: ' + svc.getLastError());
  }
  return svc.getAccessToken();
}

// Daily aggregates, for values the API does not publish as data points.
// Civil range, end-exclusive: start 2026-08-27 / end 2026-08-28 is that one day.
function rollupDay_(path, date) {
  const civil = (s) => {
    const p = s.split('-');
    return { date: { year: +p[0], month: +p[1], day: +p[2] } };
  };
  const res = UrlFetchApp.fetch(API + path + '/dataPoints:dailyRollUp', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      range: { start: civil(date), end: civil(nextDate_(date)) },
      windowSizeDays: 1
    }),
    headers: { Authorization: 'Bearer ' + healthToken_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('HTTP ' + res.getResponseCode() + ' on ' + path +
                    ':dailyRollUp: ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText()).rollupDataPoints || [];
}

function apiGet_(path) {
  const res = UrlFetchApp.fetch(API + path, {
    headers: { Authorization: 'Bearer ' + healthToken_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('HTTP ' + res.getResponseCode() + ' on ' + path.split('?')[0] +
                    ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

// ============== HEALTH AUTH ===============
// Uses the apps-script-oauth2 library, added under Libraries as `OAuth2`.
function healthService_() {
  const props = PropertiesService.getScriptProperties();
  return OAuth2.createService('googlehealth')
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(props.getProperty('CLIENT_ID'))
    .setClientSecret(props.getProperty('CLIENT_SECRET'))
    .setCallbackFunction('authCallback')
    .setPropertyStore(props)
    .setScope(HEALTH_SCOPES)
    .setParam('access_type', 'offline')
    .setParam('prompt', 'consent');
}

// Run once by hand, then open the URL it logs.
function authorizeHealth() {
  const svc = healthService_();
  if (svc.hasAccess()) { Logger.log('Already authorized.'); return; }
  Logger.log('Open this URL to authorize:\n\n%s', svc.getAuthorizationUrl());
}

function authCallback(request) {
  return HtmlService.createHtmlOutput(
    healthService_().handleCallback(request)
      ? 'Authorized. Close this tab and re-run testPullToday().'
      : 'Denied. Close this tab.');
}

// Paste this into the OAuth client's Authorized redirect URIs.
function showRedirectUri() { Logger.log(healthService_().getRedirectUri()); }

// Clears the stored token; run before re-authorizing from scratch.
function resetHealthAuth() { healthService_().reset(); }

// Dumps raw API responses so schema mismatches are easy to spot.
function debugDay() {
  Object.keys(TYPES).forEach(k => {
    try {
      const raw = apiGet_(TYPES[k].path + '/dataPoints?pageSize=3');
      Logger.log('==== %s (%s) ====\n%s', k, TYPES[k].path,
                 JSON.stringify(raw).slice(0, 2000));
    } catch (err) { Logger.log('==== %s ==== ERROR %s', k, err); }
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
// Adding 36h rather than 24h so a DST change cannot land back on the same
// civil date.
function nextDate_(date) {
  const d = Utilities.parseDate(date, tz_(), 'yyyy-MM-dd');
  return Utilities.formatDate(new Date(d.getTime() + 36 * 3600 * 1000),
                              tz_(), 'yyyy-MM-dd');
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
