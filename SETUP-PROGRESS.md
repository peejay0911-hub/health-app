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

## Final architecture

Different from the kit's, because Claude cannot reach the Apps Script web app
from its own environment (URL fetches 404; the host is off its network
allowlist). Verified from two independent sandboxes.

| Path | How |
|---|---|
| Fitbit data into the sheet | Apps Script triggers: `healthPullToday` every 2 hours, `healthNightlyPull` at 5-6am for yesterday |
| Sheet to the coach | Google Sheet connected to the Claude project via Google Drive; verified live |
| Intake, mood, training | Stay in the conversation as DAILY LOG blocks, which the briefs search |

The coach never writes to the sheet and never needs to. The web app deployment
survives for manual use (backfill), not for the coach.

## Phase 1 - data layer: DONE

- [x] Cloud project, Health API enabled, OAuth consent (External, PJ as test user)
- [x] Sheet + Apps Script, time zone Eastern, GCP project linked
- [x] Health calls use their own OAuth client (the API rejects tokens carrying
      non-health scopes); credentials in Script Properties
- [x] All six metrics verified correct against the Google Health app
- [x] Both triggers, web app deployed, token guard confirmed
- [!] B7 publish to production: not possible without a domain, hosted privacy
      policy and Search Console verification. Left in Testing, so health auth
      expires about every 7 days. `healthNightlyPull` writes the reason into the
      row's note column and the charter tells the coach to surface it. Fix is
      `authorizeHealth()` in the editor, about a minute. PJ owns pjhowland.com,
      so publishing is revisitable if the weekly re-auth becomes annoying.

## Phase 2 - charter: DONE (rewritten for the architecture above)
## Phase 3 - scheduled tasks: DONE (both read the sheet, not the webhook)
## Phase 4 - phone ritual: alarms + home screen
## Phase 5 - onboarding interview: runs in the Coach project

## Parked

- **Backfill ~14 days.** Loop `upsertRow_(d, pullDay_(d))` over past dates in the
  editor. Row 2 (2026-08-27) is blank and first in line.
- **Publishing to production**, per B7 above.
