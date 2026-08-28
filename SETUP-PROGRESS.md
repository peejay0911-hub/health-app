# Health Coach System — setup progress

Resume point for the setup guide. If a session is cut off, say "continue setup"
and pick up at the first unchecked step.

**Secrets are NOT stored in this repo.** The webhook token and the `/exec` URL
live in the claude.ai project's custom instructions only. `apps-script/Code.gs`
keeps the placeholder token on purpose.

## Established facts

| Item | Value |
|---|---|
| Cloud project name | `health-logbook` |
| Cloud project number | `327001813371` |
| Cloud project ID | `health-logbook-506821` |
| Organization | No organization |
| Time zone | `America/New_York` (Eastern, confirmed) |
| Apps Script ID | `1bWG45tcsK4BL9M1oN5sVx2Y-ORJckAcXwNy1mq5-1ys6nsY_DOVPwKTJ` |
| Webhook token | generated 2026-08-27, held in chat + charter, not committed |

## Phase 1 — data layer

### A. Google Cloud
- [x] A1 Create project `health-logbook`
- [x] A5 Copy project number (`327001813371`)
- [x] A2 Enable the Google Health API
- [x] A3 OAuth consent screen: External, app name `health-logbook`
- [x] A4 Add personal Gmail as a test user
- [x] A6 Leave publishing status as Testing until B7

### B. Sheet + Apps Script
- [x] B1 Sheet **Health Logbook**, tab `Log`, 15-column header row
- [x] B2 Apps Script: set time zone + linked GCP project (manifest checkbox pending)
- [ ] B3 Replace `appsscript.json` (confirm time zone)
- [ ] B4 Replace `Code.gs`
- [ ] B5 Set `TOKEN` to the generated string
- [~] B6 `testPullToday()` — auth works, API calls still failing (see below)
- [ ] B7 **Publish app to production** — button greyed until an OAuth client exists;
      Apps Script registers one at B6 authorization, so recheck then (most-skipped step; prevents 7-day token death)
- [ ] B8 Daily 5-6 AM trigger on `healthNightlyPull`
- [ ] B9 Deploy web app (Execute as: Me / Anyone with the link), capture `/exec` URL
- [ ] B10 Browser test `?action=read&days=5&token=...`

## Open issue: `action=pull` (Health API reads)

Auth is solved. Data-layer reads are not. `log` and `read` are unaffected —
they are pure Sheets operations — so the coach is fully usable without this.

**Fixed so far**

1. `403 DISALLOWED_OAUTH_SCOPES` — the API refuses any token also carrying
   non-health scopes (it named `maestro_external_request`, `wise_currentonly`).
   Fixed by giving Health calls their own OAuth client via apps-script-oauth2,
   credentials in Script Properties (`CLIENT_ID`, `CLIENT_SECRET`).
   Side effects: both previously unverified `googlehealth` scope names are
   confirmed real, and creating the client cleared the Audience page's
   incomplete-configuration banner that was grey-ing out **Publish app**.
2. Client ID was truncated on first paste (`client_id=.apps.googleusercontent.com`
   → `invalid_client`). Full ID:
   `327001813371-r5ilo1dfss5iveva58o7odohl17ftpdm.apps.googleusercontent.com`

**Still failing** — `testPullToday()` now returns HTTP 400s, three kinds:

| Types | Error | Means |
|---|---|---|
| `calories-burned`, `resting-heart-rate` | `Invalid data type ID` | these IDs do not exist |
| `steps`, `heart-rate`, `weight` | `INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER` | type IDs are valid; the filter's field name is not |
| `sleep` | `INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR` | type and field valid; `>=`/`<=` not allowed there |

Note `apiGetDay_` tries six filter grammars and only reports the last one's
error, so each message reflects filter #6 only.

**Next step:** run `debugTypes()` (in the editor, not committed) — it calls
`GET /v4/users/me/dataTypes?pageSize=200` to enumerate real type IDs and pulls
two unfiltered `steps` data points to reveal the real response shape. That
gives the correct type IDs, the correct filter members, and the right key
names for `findNums_` in one round trip. If the list endpoint 404s, stop
chasing it and stay on manual entry.

## Parked for later: backfill ~2 weeks of history

Once `pull` is proven correct on a complete day, walk it backwards over the
last ~14 days so the 7-day rolling average and the first weekly review have
real numbers instead of starting from empty. Row 2 (2026-08-27) is already
sitting blank and is the first candidate.

Two ways to run it, both fine:
- webhook, one date at a time: `?action=pull&date=YYYY-MM-DD&token=...`
- a one-off loop in the editor calling `upsertRow_(d, pullDay_(d))` per date,
  which avoids 14 manual URL visits

Burn is now confirmed correct (total-calories rollup), so this is unblocked.

## Phase 2 — overnight verification + charter install
- [ ] Morning-after check that the nightly trigger fired
- [ ] Fill webhook URL + token into the charter
- [ ] Paste charter into the claude.ai project's custom instructions

## Phase 3 — scheduled tasks
- [ ] Morning Brief, daily ~6:30 AM
- [ ] Weekly Review, Sunday ~7:30 PM

## Phase 4 — phone ritual
- [ ] Claude app on home screen / project shortcut
- [ ] Midday nudge alarm (optional) + firm evening close-out alarm

## Phase 5 — onboarding interview, handoff to coaching
- [ ] Run the Part 5 interview in the claude.ai project
- [ ] Baseline Card
