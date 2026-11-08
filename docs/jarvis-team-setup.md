# J.A.R.V.I.S. and the team — setting it up

The command centre in The Flow (Simple interface → Today → Command centre,
or say "Hey J.A.R.V.I.S.") runs a team of AI employees: J.A.R.V.I.S. as
chief of staff, with Bobby (advertising), Sarah (customer support), Tom
(development), a hiring assistant and a finance assistant to start with.
Everything below is already in the code; what each piece needs is one or
more environment variables on Render, typed by the owner. Nothing here ever
displays a key.

Every agent, channel and tool shows one of: **Working** · **Ready to link**
· **Awaiting configuration** (with the exact variable that is missing) ·
**Not built yet**. The count of connections on screen is the number that
actually work; nothing claims more.

## 1. Models (who thinks)

| Provider  | Variable            | What you get                                       |
|-----------|---------------------|----------------------------------------------------|
| Anthropic | `ANTHROPIC_API_KEY` | The model list from `/v1/models`; Claude models      |
| OpenAI    | `OPENAI_API_KEY`    | GPT models                                           |
| xAI       | `XAI_API_KEY`       | Grok models                                          |
| DeepSeek  | `DEEPSEEK_API_KEY`  | DeepSeek models                                      |

Each agent's model is a dial in its room. Switching changes who answers
next and nothing else: the agent's name, instructions, thread, memory and
permissions live in the store, not in a model. A provider with no key is
listed as awaiting configuration and nothing is sent to it.

## 2. Channels (where you reach them)

| Channel      | Variables                                                                                   | Then                                                                 |
|--------------|---------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| Telegram     | `TELEGRAM_BOT_TOKEN` (from @BotFather → /newbot)                                            | The Flow registers the webhook itself. Open the bot, send your link code. |
| WhatsApp     | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`         | In Meta: webhook URL `https://<host>/api/channels/whatsapp`, subscribe to `messages`. |
| Slack        | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                                   | Event subscriptions → `https://<host>/api/channels/slack`; `message.im`, `app_mention`. |
| Discord      | `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`                                 | Interactions endpoint `https://<host>/api/channels/discord`; the `/jarvis` command is registered at boot. |
| SMS          | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`                                  | Number's messaging webhook → `https://<host>/api/channels/twilio/sms`. |
| Phone calls  | the same Twilio variables                                                                   | Voice webhook → `https://<host>/api/channels/twilio/voice` (ConversationRelay). Save the number as a contact called Jarvis: "Hey Siri, call Jarvis". |
| iMessage     | `IMESSAGE_RELAY_SECRET`                                                                     | Run `scripts/imessage-relay.js` on a Mac that stays on (steps in the file header). |
| Teams        | —                                                                                           | Not built yet.                                                       |

Linking: Command centre → Channels → the channel → **Link** gives a
six-digit code (valid 10 minutes, once). Send it from your own account on
that channel; the first message links it. Only the sender you linked is
ever answered; a stranger learns only how to link.

In a channel: write to J.A.R.V.I.S. as in the app; `/team`, `/tasks`,
`/yes 1`, `/no 1`, `/answer <text>`, `/sarah …` or `@sarah …` for a
specialist, `/ideas` and `/start 1` for what the team could take off your
plate, `/briefing` for this morning's briefing now, "call me when it is
ready" to be rung (needs the phone channel).

## 3. Tools (what they can do)

| Tool              | Variable(s)              | Honest state                                                                 |
|-------------------|--------------------------|------------------------------------------------------------------------------|
| The Flow          | —                        | Working. J.A.R.V.I.S. answers from your week, rocks, habits, training, spend, notes. |
| Web reader        | —                        | Working. Agents fetch public pages they need (never private or local addresses). |
| Cloud browser     | `BROWSER_WS_ENDPOINT` (or Chromium + Playwright on the host) | Reader only until then. With a browser each agent has its own profile, clicks and types a step at a time, keeps a screenshot per step in the task, and hands over to you the moment a page asks for a sign-in, a code, a payment or a CAPTCHA. No password is ever typed by an agent. |
| Email (outbound)  | `RESEND_API_KEY` (+ `MAIL_FROM`) | Working on theflow.today. An approved email goes once, exactly as approved, from `Sarah for <you> <mail@theflow.today>`, replies to you, with a footer saying it is an assistant's message you approved. A read-only agent's proposals are recorded, never sent. |
| Gmail, Calendar, Drive, Notion, Meta Ads, Instagram, YouTube, QuickBooks, GitHub, Shopify, HubSpot, Stripe | — | Not built yet. Listed so the gap is visible. |

## 4. Work, approvals, permissions

- Tasks run in the background on the server, one step at a time, saved
  after every step; a restart resumes them; a step marked done never runs
  twice. States: queued · working · needs an answer · needs your yes · done
  · did not finish · cancelled.
- Anything that would reach the outside world becomes an approval showing
  the exact action (to, subject, body — editable). Approving sends it when a
  tool exists (email today), once; otherwise it is marked to go once the
  connection exists. Nothing is ever claimed sent.
- Permissions per agent: read · draft · execute after my yes · automatic
  within policy. Today every outside action needs a yes regardless.
- **Pause all** stops every agent and the runner (423 everywhere).

## 5. The morning briefing and suggestions

- At 08:00 in your own timezone (Settings → timezone; the hour and the switch
  are in the command centre → Morning briefing): today's rocks, what the
  team has waiting for you, and three things they could take off your
  plate. It goes to every linked channel and as a push; **Send it now** at
  any time.
- **J.A.R.V.I.S. suggests**: once a day he reads your record and proposes
  work anchored in it (a trip in your notes → a travel command centre; a
  stalled rock → the preparation; an expense → a review). Start puts the
  team on it; Not this is remembered.

## 6. Cost

Usage is counted per agent per day and per month, with a cost estimated
from list prices per million tokens (said so on screen; the providers'
invoices are the truth). A monthly limit in dollars stops every agent when
reached, with the message saying how to carry on.

## 7. Memory: sources, corrections, verification

Command centre → **Memory** (in the team strip).

- **Sources.** Everything that can shape an answer, listed with its kind (fact · rule · preference · procedure), scope, status (current · superseded), dates and version count: team knowledge, J.A.R.V.I.S.'s memory of you, each agent's instructions, your preferences, and the platform rules (code — shown as *Protected*, never edited here). Your Flow record and the conversation are read into prompts but not listed as entries.
- **Where did that come from?** Every reply records what it was built from. Ask it in the console ("Where did that come from?") or in the panel: confirmed sources are passages that were in the prompt *and* match the answer; the rest of the prompt is listed as present-but-unmatched; the model's own training is named as not inspectable. Nothing is claimed that was not in the prompt.
- **Correct something.** State what is true now. Every conflicting copy appears in a table (Source · Conflicting content · Why · Proposed correction), with protected rules and read-only places (your record) labelled. Apply marks old entries superseded (dated, pointing at the new one), rewrites the ticked instruction and memory passages in place with history, adds the new current entry, logs before/after, and then **verifies from the prompts themselves**: the corrected fact is in every agent's current block, the old one only under SUPERSEDED with its dates, instructions and memory clean, history kept, model-independent, permissions untouched. Prove it with a fresh question through the real retrieval path (not saved to the thread).
- **Audit an instruction.** The same table for an instruction that keeps coming back, across every source; permission levels and platform rules are shown but stay as they are — a correction never widens what an agent may do.
- **Changes.** Every correction and edit with before/after and **Restore**.

Prompts are rebuilt from the store on every request, so there is no cache to refresh and no model that holds a copy: the next question, from any agent on any model, uses the current entries; superseded ones are shown only as dated history.

## 8. Tests

`node tests/run.js team team2 team3 channels memory` runs the team with a stand-in
for every provider and channel (`FLOW_TEAM_FAKE=1`, never set on the real
server). The browser tests run where Chromium exists and say so when it
does not.
