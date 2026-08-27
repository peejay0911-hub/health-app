# Setup Checklist

Do these in order. Steps 1-2 are the data layer (~30 minutes, all on your personal Google account). Steps 3-7 are the coach (~15 minutes).

1. **Build the Health Logbook.** Follow `5-health-logbook.md` end to end: Google Cloud project + Google Health API, the Health Logbook Sheet, the Apps Script, one test pull, publish the OAuth app to production, nightly trigger, web app deployment. You come out of it with a webhook URL and a token.

2. **Sanity-check the data.** Look at the Sheet after `testPullToday()` and again the morning after the trigger's first night run. Steps, sleep, resting HR, and burn should be filling in. If weight is blank, your scale isn't reaching Google's cloud; that's fine, the coach will ask for the scale number at close-out (and the troubleshooting section covers everything else).

3. **Upgrade the personal Claude account to Pro.** $20/month (or $17/month billed annually). Pro gets you the full model picker, unlimited projects, Skills, Connectors, and Scheduled Tasks.

4. **Create the Project.** Name it whatever you'll actually tap on your phone ("Coach" is fine). Open `1-coach-charter.md`, paste your webhook URL and token into the Logbook webhook block at the bottom, then paste everything below the divider into the project's custom instructions.

5. **Turn on memory and past-chat search** if the account asks. The hard numbers come from the webhook, but the briefs also search recent chats for food details and context.

6. **Run onboarding.** Open the first chat in the project and paste the message from `3-first-chat-onboarding.md`. Do the interview honestly. The floors (protein, fat, minimum calories) get locked in here. Good first test: ask the coach to fetch `action=read` and tell you what it sees.

7. **Create the two scheduled tasks** from `2-scheduled-tasks.md`: the Morning Brief (daily, ~6:30 AM) and the Weekly Review (Sunday, ~7:30 PM). Attach them to the project if the setup allows it.

8. **Set up your phone for the ritual.** Android:
   - Put the Claude app on your home screen row, or drag the project shortcut out if your launcher supports it.
   - Two alarms in Google Clock: an optional midday nudge ("check in with Coach") and a firm evening alarm at your close-out time ("close out the day").
   - Evening flow is now just words: open the project, say "close out the day," give mood and anything the coach asks for. The Fitbit numbers arrive on their own.

9. **First week: just run the rituals.** Check-ins by photo or dictation, close-out every night, let the briefs arrive. Don't tune anything until the first weekly review; the trend math needs a week of rows before it means anything.

## Later, if you want

- **PushPress.** Skipped on purpose since you'd rather dictate workouts, which the check-in ritual is built around.
- **ghealth CLI.** There's an open-source command-line tool for the Google Health API (github.com/Google-Health-API/google-health-cli) if you ever want to poke at your data directly or wire it into Claude Code on your personal side. Same Cloud project works for it.
- **Charts.** Once the Sheet has a month of rows, ask Claude on your personal account for a weight-trend and RHR chart tab. It's a ten-minute add.
