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
| Webhook token | generated 2026-08-27, held in chat + charter, not committed |

## Phase 1 — data layer

### A. Google Cloud
- [x] A1 Create project `health-logbook`
- [x] A5 Copy project number (`327001813371`)
- [ ] A2 Enable the Google Health API
- [ ] A3 OAuth consent screen: External, app name `health-logbook`
- [ ] A4 Add personal Gmail as a test user
- [ ] A6 Leave publishing status as Testing until B7

### B. Sheet + Apps Script
- [ ] B1 Sheet **Health Logbook**, tab `Log`, 15-column header row
- [ ] B2 Apps Script: show appsscript.json, set time zone, link GCP project number
- [ ] B3 Replace `appsscript.json` (confirm time zone)
- [ ] B4 Replace `Code.gs`
- [ ] B5 Set `TOKEN` to the generated string
- [ ] B6 Run `testPullToday()`, authorize, verify the Sheet row
- [ ] B7 **Publish app to production** (most-skipped step; prevents 7-day token death)
- [ ] B8 Daily 5-6 AM trigger on `healthNightlyPull`
- [ ] B9 Deploy web app (Execute as: Me / Anyone with the link), capture `/exec` URL
- [ ] B10 Browser test `?action=read&days=5&token=...`

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
