# Today and Week Compass UX review

This pass follows the app's existing screens and navigation. The production web app was reviewed visually in guest mode, then the changes were implemented and exercised in an isolated replica with synthetic account data.

## Changes and rationale

| Observed friction | Updated behavior |
| --- | --- |
| Today summarizes the day but gives a new user little direction about where to begin. | Visible **Plan today**, **Quick add**, and **Review week** actions use the existing forms and capture sheet. Empty Big Rocks and priorities sections link directly to entry. |
| Recovery navigates to habits. | Recovery opens **Sleep & Mood**. |
| Priority and habit rows toggle from their text without an obvious completion control. | Explicit, labelled checkbox buttons have real 44px targets, keyboard support, saved state, and focus restoration after repainting. User text and links remain separate from completion. |
| Small metric labels are cramped on a phone, and secondary market/status information sits before commitments. | Larger labels and two-column phone metrics improve legibility. Market prices and save status follow the daily sections. |
| The weekly calendar can show six days followed by an isolated Sunday. | All seven days remain in order on one row. Narrow containers scroll internally, with a visible hint and keyboard access. |
| Priority action buttons use overlapping invisible target extensions. | Actual button targets fit inside wrapping rows, keeping edit, schedule, move, and delete distinct. |
| Capture has no obvious desktop close button and can lose keyboard position. | A visible close control, modal semantics, keyboard cycling, and focus return support the same capture flow. |
| Paper and Bloom inherit dark surfaces behind dark text in parts of Today and Compass. | Theme-aware Big Rocks, navigation, calendar chips, and status colors keep these areas readable. |

Planning shortcuts retain draft fields and the original week of an unscheduled draft or edit. A blank planning form uses the local date. The new controls include Turkish translations, while user-entered text is excluded from translation.

## Visual verification

The original and revised runtimes were rendered with the same synthetic entries at phone and desktop sizes, and the captures were inspected for layout and contrast. The captures are retained only as internal review evidence; this repository change contains no screenshots.

The test clock starts at 22 October 2026, 22:30 UTC, in Europe/Istanbul; the displayed local date is therefore 23 October. That boundary also exercises local-date planning. Market quotes are unavailable in the isolated replica.

## Verification

The focused UX suite covers shortcut destinations, preservation of scheduled and unscheduled work, keyboard completion, reload persistence, capture focus, Turkish labels, and layouts at 320, 390, 768, 1280, and 1440 pixels in Signature and Paper. Additional light-theme checks measure contrast in the affected surfaces in Paper and Bloom. Existing navigation, priority wrapping, translation, and weekly-planning suites cover the surrounding workflows.

Local results: navigation 110 checks, UX 133 checks, priority wrapping 11 checks, translation 30 checks, and weekly planning 37 checks, all passing. JavaScript syntax and whitespace checks also pass. Navigation test fixtures now use runner configuration and generated passwords instead of personal or reusable literals.

```bash
node tests/run.js nav ux qwrap i18n week
```

Optional screenshots use only the isolated replica:

```bash
UX_CAPTURE_ONLY=1 UX_SHOTS_DIR=/tmp/flow-shots node tests/run.js ux
```

The changes use the existing host navigation and data-saving paths. They introduce no database migration or native-app packaging change. Native iOS and Android WebViews still require an on-device release check; these screenshots and tests use Chromium.
