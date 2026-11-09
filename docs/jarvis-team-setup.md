# J.A.R.V.I.S. and the team — setting it up

The command centre in The Flow (in **Advanced** it *is* the app; in
**Simple** it is Today → Command centre, or say "Hey J.A.R.V.I.S.") runs a
team of AI employees: J.A.R.V.I.S. as
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

## 8. Skills: teaching recurring work once

Command centre → **Skills** (in the team strip). A skill is an instruction document you can read and edit — never something hidden in a model — of two kinds: a *workflow* (an ordered procedure with decision points) or a *guide* (how to handle a kind of information). Each one has a name, purpose, when to use it and when not, inputs, steps, the tools and sources it relies on, the expected output and what good looks like, exceptions and what to do with missing information, and what needs your yes. Facts stay in Memory; a skill points at knowledge entries and the prompt shows their *current* text.

- **Teach**: describe it (numbered lines become steps; "ask me before…" becomes an approval; "if … missing" an exception), or press **Turn into a skill** on a finished task — or say *"Turn the workflow we just completed into a reusable skill"* in the console. One-time details (addresses, amounts, dates, links) become inputs; the procedure stays. With a model available J.A.R.V.I.S. tidies the draft; without one the deterministic draft is what you get. You review before anyone follows it. Anything that looks like a secret is refused.
- **Use**: J.A.R.V.I.S. may name a skill per step when he plans; you may invoke one ("use the Weekly ad report skill"); otherwise a step is matched on the words of the request against the active skills its agent may use. The chosen skill and version are written on the step (a chip in the task view), in the activity log, and in the skill's run history. A skill that applies but cannot run here (a tool not connected, disabled, or a name nobody has) is said so — never silently skipped, never invented. `/skills` lists them in any channel.
- **Improve**: feedback is sorted first — *this output only* (nothing saved), *a change to the procedure* (a proposed edit shown as a diff, checked for contradictions within the skill and against team rules and for similar skills; Apply makes the next version; Compare and go back to any earlier one), or *a general preference* (saved to Memory as a preference entry every agent reads). Nothing changes until you apply it.
- **Test**: add representative example requests (an ordinary one, one with information missing). A test run uses the agent's real model and the real prompt, saves no task and sends nothing — proposals come back as drafts. Checks: selects this skill, tools and sources present, steps followed, matches the expectation, asks when information is missing, outside actions stay drafts, permissions unchanged. Each example remembers its last run and version.
- **Assign** to some agents or share with all: the procedure travels, no credentials do, and each agent keeps its own permission level. Creating or sharing a skill authorises nothing. Disable, archive, restore; remove only once archived. Skills are stored in the account, so switching a model changes nothing about them.

## 9. Automations: routine work done by scripts, not a model

Command centre → **Automations**. An automation is a pipeline of vetted operations saved in your account — not code a model wrote and the server ran. The operations: read your rocks, expenses or habits, the team's tasks, this month's AI usage, or a public web page; filter, sort, limit, select, count/sum/average (grouped), format a line per item, compare with the previous run; write the report, send a fixed-template message to your channels (no model), update rocks by rule, send templated emails to a list (after your yes, once per recipient); and *hand exceptions to an agent* — the only step that costs a model call. Values that change are typed inputs (`{{inputs.name}}`), checked before a run starts; a wrong one stops the run with the reason.

- **Build** one in the editor (each step is a small form; nothing else can run), or open a finished task and press **Turn into an automation**, or say *"Turn the repeatable parts of this workflow into an automation"*. The result explains itself: what it does, inputs and services, what it affects, outputs, when it stops, what is left to judgment, and whether a model is ever called. With a model available J.A.R.V.I.S. tidies the draft from the catalogue; nothing outside the catalogue survives.
- **Test** = a dry run: it reads and computes for real, sends nothing, changes nothing, creates no task; each step shows what it would do. A passing test marks the version tested; a new version is untested until then (a schedule still runs it, flagged).
- **Run** manually, on a **schedule** in your own time zone (daily / weekdays / weekly / hourly, the same minute tick as the briefing; once per window, never twice), or on an **event** (a task done whose title matches, an approval executed, the briefing sent). `/automations` and `/run 1` in any channel. **Pause** stops schedules and events (manual runs still allowed); **Disable** stops everything; **Archive**; **Cancel** a parked run.
- **Runs** keep: trigger, time zone, version, inputs, per-step counts, notes and timings, items, failures, model calls, and a cost line — AI (estimated, or none), hosting (included in the server plan), external services (emails, page reads, notifications counted). A run is `ok`, `partial` (some items failed — said so, never "done"), `failed`, `invalid` (inputs), `awaiting_approval`, `stopped` (paused) or `cancelled`. Saved after every step: a restart resumes at the next step; a sent email is keyed, so a resumed batch never repeats one; a send whose outcome was never seen is reported *uncertain* and not re-attempted.
- **Batches**: an `email.batch` step parks the run and raises one approval showing recipients, content and count. Your yes releases exactly that; a no cancels the run. Creating or scheduling an automation authorises nothing by itself.
- **With the team**: J.A.R.V.I.S. may plan a step as a script (it runs with no model and the step says so); a skill can reference an automation (when, inputs, success, errors) and the agent runs it instead of redoing the routine part; a run that hands exceptions over creates a task with the automation named as its origin. Automations are stored in the account and know nothing about models: switching a model changes nothing.

## 10. Efficiency: finding waste with evidence, changing one thing, proving it helped

Command centre → **Efficiency**. Every task now records its own metrics: model calls (plan, work and hand-over counted apart), tokens and estimated cost, retries, page reads, questions asked, hand-overs to you, proposals, whether a skill or an automation did the work, and duration. The view shows them for the last 30 days — in total, per agent (automations as their own row, with no model), and per workflow (a skill, an automation or the task's own words), with usage and failures side by side. Costs are marked as estimates from list prices; the providers' invoices are the truth.

- **Review now** (or a weekly schedule, same minute tick as the briefing, once per window) reads the tasks, the knowledge store and its history, skills, automations and their runs, which entries and pages replies actually used, and edited or declined approvals. Every finding carries the evidence, the affected tasks, the proposed change, the expected benefit and a confidence: **confirmed** (the cause is in the record) or **hypothesis** (plausible; measure it). Kinds: two current facts that disagree, or an instruction that disagrees with the team's fact (→ Memory's correction); shared entries that go into every prompt and no reply has used (→ supersede, token saving stated as an estimate); duplicate, unclear or missing skills; the same routine job done by a model three times (→ an automation, saving stated as "would have been", measured once it runs); the same page fetched again and again (→ a daily watch automation); hand-over calls on one-step delegations (→ a setting); retries and repeated failures; drafts you keep editing (→ one line in the agent's instructions) and facts corrected more than once (→ audit).
- A review **changes nothing**. **Recommended** and **applied** are kept apart: a finding does nothing until you press Apply; pointer findings send you to Memory, Skills or the task instead. Every applied change records before, after and how to undo it, and has **Revert** (setting restored, entry un-superseded, skill or automation re-activated, instructions restored — all with history). Dismiss hides a finding and can be undone; an applied finding is not raised again.
- **Before and after**: a baseline is two to eight representative examples (agent + request, with expected words, "ask" or "skill" flags — include one with information missing and one failure). Each example runs once, for real, as a step would (the agent's model, a skill if one matches): no task saved, nothing sent, no approval raised. Run it, change one thing, run it again: correct / complete / follows the workflow / interventions against calls / tokens / cost / time, with the verdict *keep* (quality held and it costs less), *no measured saving* (quality held, cost did not fall — a few milliseconds are noise) or *restore* (quality fell; a cheaper failed run is not an improvement). Each run records the settings it ran under.
- Settings so far: *skip the hand-over call when a delegated task has one step* (the specialist's result is the result). Nothing claims a saving that was not measured; the review lists its remaining uncertainties.

## 11. Guided setup: from nothing to the first piece of work

Command centre → **Setup** (on the strip; J.A.R.V.I.S.'s own view nudges until it is finished). Nine steps, each saved as it is done, so the setup can be left and continues where it was: **1 your main agent** (name and role; the specialists keep their rooms) → **2 the model that thinks** (every provider with who bills, how, and where limits are set; choosing a model sends one real test call and records the reply and the time — a provider with no key says what to add in Render) → **3 where you talk to him** (states: awaiting configuration → ready to link → linked → replied; a six-digit code pairs the channel, then **Send the test**: he sends, you reply from the phone, and that reply — not the button — finishes the step) → **4 where he delivers** (a linked channel, push, or the app only; `/deliver here` from any chat; results and briefings then go there by default, replies always go back where they were asked) → **5 tools and what each may do** (only what exists, with its real status and the capabilities an agent has with it; Gmail is listed as the essential that is *not connected*: it needs a Google OAuth client only the owner can create, then its id and secret in Render) → **6 a tour of the rooms** → **7 the first task** ("Read my latest inbox email and summarise it" waits for Gmail and says so; two read-only tasks on your own record are ready; a read-only task records any proposed action instead of raising it; the result must name its source; `/setup first spend` runs it from the paired chat and the result lands there) → **8 inbox organisation (optional)** (scope, rules that never delete, read-only first, a report of what moved and what still needs you — waits for Gmail; can be skipped and brought back) → **9 ready** (the checklist, essentials apart from soft items; Finish records the date; next steps; what to do if something breaks).

Recovery is automatic: every open of the setup re-checks the live facts. A removed or rotated provider key turns step 2 to *needs attention* with the reason; an unlinked channel turns steps 3 and 4; the checklist says the same. "Start over" clears only the setup's own record — agents, models, links and tasks stay. `/setup` in a chat shows the progress with ticks.

## 12. Business context: import, source map, answers that name their source, discovery mode

Command centre → **Memory** → *Import business context*. Paste a document, a policy, an FAQ, a note — or give a public page — and it becomes atomic knowledge entries (facts, rules, preferences), each carrying the passage it came from and the source it belongs to. With a model available the extraction is done by J.A.R.V.I.S.; without one, the sentences that carry a number, a name, a rule or a preference are kept and the filler dropped. Secrets (keys, passwords, tokens) are refused. Nothing is indexed or cached: every agent is shown the entries on its very next message, because the prompt is rebuilt from the store each time.

- **Source map**: every imported source with when, how many entries are current, how many replies drew on it, and who reads it (shared entries go to every agent). Open one to see its entries with their quotes. **Mark outdated** supersedes its entries (kept as dated history), **Restore** brings them back, **Re-import** refreshes from the kept text or the page (what is no longer in the document is superseded, what is new is added, what is unchanged is kept — one source, not two), **Remove** deletes it with its entries. The same text twice is refused with the name it already has.
- **Answers name their sources**: after every reply the entries it actually drew on (a number in common, or two content words) are recorded; the console shows *From: …* under the reply and a chat reply ends with *— From: Price list, Nov 2026*. An answer that drew on no imported entry names none.
- **Ask in a fresh chat**: a question, optional expected words, an agent — answered in a new conversation with no history and nothing saved to the agent's thread, so the only way the answer can be right is from what the team is shown. The verdict (as expected / not as expected) and the sources it drew on are kept.
- **Requests and feedback**: noted from the panel or with `/request …` and `/feedback …` in a chat, with where they came from; mark done, reopen.
- **Discovery mode**: *Ask me questions* (five) or *Interview me relentlessly* (ten, or until you say "done") — in the console, on J.A.R.V.I.S.'s view, or with `/discover <topic>` and `/interview <topic>` in a chat. One question at a time, each answer kept against its question; with a model the next question follows the answers, without one the question bank is used in order. It ends in a written spec — goal and output, trigger, inputs, steps (routine vs judgment), never-do / needs a yes, people, cadence, pitfalls, success, notes — built only from what was said. *Turn it into a skill* makes a version-1 skill from the spec, opened for review.
- **Turkish**: imports are read in Turkish as well — *her zaman / asla / gerekir / -malı* become rules, *tercih / isterim / samimi* preferences, and *merhaba / teşekkürler* filler is skipped. Discovery follows the language of the topic (or of the first answer): Turkish questions, a Turkish write-up (*İş akışı / Amaç ve çıktı / Tetikleyici …*), `/sor <konu>` and `/mülakat <konu>` in a chat, *bitti* to stop, *beceriye dönüştür* for the skill; a Turkish reply ends with *— Kaynak: …*. In the console, **Voice and manners → Names to recognise** keeps the Turkish names and words the microphone bends; what is heard is corrected against that list, the team's names and the names in what the team knows (so "Oguz" becomes Oğuz) before it is sent. The recogniser itself follows the app language (Settings → Türkçe).

## 12a. Advanced is the command centre

In the Advanced interface the command centre is the whole app. It opens by
itself after sign-in; there is no × — Esc, or × on a page, goes back to
J.A.R.V.I.S. The orb stays in the middle, a circle, at all times: a room or a
page takes a side column, never the centre.

- **Rail (left)**: J.A.R.V.I.S. (home — the day round the orb), *The team*
  (Setup · Memory · Skills · Automations · Efficiency, the rooms that used to
  sit on the strip), *Your life* (Today · Plan · Body · Record · Settings).
- **Strip (under the clock)**: the assistants, Add agent, Pause all — as before.
- **A page** (Today, Plan → North Star / Priorities / Week Compass / Work /
  Side Project, Body → Training / Body log / Habits, Record → Journal /
  Finances / Ask, Settings) opens down the left column, as wide as the
  right, with the group's pages as pills at the top. It is the app's own
  page, moved whole — same ids, same listeners — and moved back when it is
  left. Anything that navigates to a page (a panel's ›, "open my finances"
  to J.A.R.V.I.S., `Nav.go`) lands there.
- **A room** (Memory …) takes both side columns; the orb stays between them.
- **The console** is docked under the orb and never goes away; "Hey
  J.A.R.V.I.S." and Talk work as in Simple.
- **Phone**: orb first, the rail a scrolling row, a page below the orb.
- **Simple is untouched**: the command centre is still a room one steps into
  and out of, Memory and the other rooms still sit on the strip, and in a
  room the orb steps aside as before.
- Switching interface (Settings, or the sidebar's Advanced/Simple) opens or
  closes the command centre at once. Test suites that look at the pages
  themselves opt out with `window.__flowNoMerge` (the replica sets it unless
  `FLOW_MERGE=1`).

## 12b. Groups, topics, members, modes, diagnostics (Telegram)

Add the bot to a Telegram group and send your six-digit link code there
(command centre → Channels → Telegram → Link) — or `/attach`, once your own
Telegram is linked. The group is attached to your Flow, **mention-only**. In
a forum group every **topic** is a workspace of its own: its own
conversation with J.A.R.V.I.S., its own sticky specialist (`/sarah` in one
topic leaves the others alone), its own mode, and work started there
reports back into that topic (`task.origin`), nowhere else.

- **Members by numeric id**: only you give instructions until you authorise
  someone — `/allow <id> [name]`, `/deny <id>`, `/members`; anyone finds their
  id with `/whoami`. A stranger addressing him is told once an hour, with their
  id, that the owner can `/allow` them; their asides are ignored and counted.
- **Modes**: `/mode mention` (the default — he answers commands, @mentions,
  replies to him, or his name at the start) · `/mode all` (everything from
  authorised members). Per group and per topic. The app's **Groups & members**
  panel (J.A.R.V.I.S.'s view) flips modes, detaches a group, authorises or
  removes members by id, and shows the webhook, the bot's name, uptime and the
  inbox/outbox queues.
- **Diagnostics**: `/diag` (or `/status`) in any chat — server uptime and
  build, webhook state and bot name, this chat (group/topic, mode, who
  answers), who you are and whether you are authorised, counts (answered /
  not addressed / unauthorised), work from here and for the account, the
  inbox/outbox queues, the last delivery error, and what a restart keeps.
  `GET /api/channels/me/groups` returns the same for the app.
- **Restarts**: workspaces, members and modes live in the store; tasks resume
  as before; an inbound update is written down (`__team:inbox`) before it is
  acknowledged and replayed at the next start if the process died mid-reply;
  a reply that could not be delivered waits in `__team:outbox` and is retried
  every minute for a day; the webhook is re-registered at boot and its state
  recorded. Nothing is claimed delivered that was not.

## 12c. Voice notes in and out, voices per channel, live voice

- **In**: a Telegram voice note is transcribed (ElevenLabs Scribe or OpenAI
  Whisper — whichever key is in Render; `FLOW_STT=elevenlabs|openai` picks
  when both are) and handled exactly like the same words typed; the text
  reply quotes what was heard. Turkish is transcribed as Turkish when the
  app's language is Turkish.
- **Out**: the reply can come back as a voice note (Telegram `sendVoice`,
  OGG/Opus). `/voice` shows the voice for this chat and the choices:
  presets `british-male` (Daniel — the default), `british-female` (Lily),
  `american-male` (Brian), `american-female` (Sarah), `openai-male` (Onyx),
  `openai-female` (Nova); `/voice id <ElevenLabs voice id>` for a cloned or
  chosen voice; `/voice replies text|voice|both` (text is the default — a
  voice note still gets a voice note back); `/voice length 30|60|120`
  (short/medium/long: the model is told the limit — about 75/150/300 words —
  and the text is trimmed at a sentence if it overruns); `/voice test`;
  `/voice reset`. Settings live at three levels — account default, channel,
  group/topic (a topic inherits its group) — in `team:voice`. Only the owner
  changes them. A command's answer (lists such as /tasks, /diag) stays text.
- **Keys**: `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` in Render only. Nothing
  stores, logs or shows a key; a voice id is not a secret. Without a key the
  status says *awaiting* and names the variable.
- **The app**: the **Voice notes** panel on J.A.R.V.I.S.'s view (status in/out,
  preset or custom id, replies, length, *Send a test voice note*);
  `GET/POST /api/channels/me/voice`.
- **Live voice** in the console: the **Live** button beside Talk — he listens
  at once and again after every answer, regardless of the hands-free
  setting, until it is switched off or the console closes.

## 12d. Routing, the email review workflow, the ads-analysis example

**Which way a request goes** is ranked, with reasons (`POST /api/team/rank
{text}`; every delegated task keeps its `ranking`, shown as *Why this route*
in the task view): a taught skill, an automation (no model), a specialist by
role, the email review, the ads analysis, or J.A.R.V.I.S. planning it.

**The email review** (`flow-mail.js`; panel **Email review** on J.A.R.V.I.S.'s
view; chat `/review` · `/send` · `/revise <what to change>` · `/skip`):
actionable emails (a person asking something — not newsletters, receipts or
no-reply mail) are drafted by the specialist and reviewed **one at a time**:
sender, subject, the whole thread, the exact reply, and three choices — **Send
this exact reply** · **Revise** · **Don't send**. The yes is bound to the
draft's version and hash: a draft revised after the yes is not the draft that
was approved and is refused (409). States: `draft → awaiting → (revised →
awaiting)* → skipped | submitting → accepted → delivered | bounced | failed`.
**Accepted** is the provider taking the message; **delivered** and **bounced**
come only from Resend's own events (`POST /api/mail/events`, Svix-signed with
`RESEND_WEBHOOK_SECRET`). Before a send: stale dates (already past),
placeholders and links not in the thread are flagged and block it until
revised (or "send anyway"). The draft offers meeting times from what the Flow
knows of the week (rocks with times are busy). A tone correction given with a
revision ("more formal", "shorter", "never start with Dear", "daha resmi") is
kept as the skill **Email tone and style** — one line per correction, no
invented source URLs — and followed by every draft after. A screenshot sent in
an email's topic is kept as feedback on that draft. `/inbox here` in a Telegram
group makes it the inbox: **one topic per actionable email**, the review
inside, `/send` there sends that email. Intake: `POST /api/team/mail
{op:'intake', mail}`, fixtures (`op:'fixtures'`, demo emails), and inbound
provider mail when it is connected; the same email twice is one item.
**Persistence and recovery**: items live in `team:mail`; a send in flight at a
restart (`submitting`) is finished at boot with the same idempotency key —
once, never twice. **Auto-send policy** (`/autosend on <sender or domain> <n a
day> [<days>]`, `/autosend off`, or the panel): bounded by sender, daily
count and expiry; only clean drafts (no flags, nothing unconfirmed); every
auto-sent reply logged with its text; revoked at once. Schedules in this
module are examples only — nothing sends on a timer.

**The ads-analysis example** (`POST /api/team/scripts {op:'example',
which:'ads'}` → "Weekly ads analysis (demo)"): Meta Ads campaign spend joined
with RevenueCat subscriptions per product ($12 premium, $14 pro, $10 starter)
→ CAC, ROAS and a verdict (scale ≥ 1.5 · hold 1–1.5 · cut < 1). The sources
are **fixtures** (`demo.metaads`, `demo.revenuecat`): every line says DEMO
DATA, the connectors are listed as *Not built yet*, and no schedule is set.

### Coverage

| Requirement | Where | Test |
|---|---|---|
| Groups/topics as parallel workspaces | flow-groups.js `workspace()`, `team:workspaces`, `task.origin` | test-groups 37 |
| Members by numeric id, mention-only vs conversational | `/allow /deny /members /whoami`, `/mode`, Groups & members panel | test-groups |
| Diagnostics, restart keeps jobs | `/diag`, inbox/outbox, replay at boot | test-groups |
| Voice notes in/out, presets 30/60 s, British male, custom ElevenLabs ids per channel/topic, keys in env | flow-speech.js, `/voice`, Voice notes panel | test-voicenotes 29 |
| Live voice mode | console **Live** button (`Say.live`) | test-voicenotes |
| Ranking with reasons | `rank()`, `/api/team/rank`, task `ranking` | test-mail |
| Ads example with Meta Ads + RevenueCat fixtures | `demo.*`, `ads.join`, example `ads` | test-mail |
| One at a time: sender, subject, thread, exact reply, three choices | `view().current`, `reviewText`, panel | test-mail |
| Approval bound to the exact draft version | `approve(id, hash)` → 409 on mismatch | test-mail |
| Nine states; accepted ≠ delivered | `STATES`, `submit`, `providerEvent` | test-mail |
| Stale dates, placeholders, invented links blocked | `checkDraft` | test-mail |
| Calendar in drafts | `freeTimes` | test-mail (shape) |
| Tone corrections → skill, no invented URLs | `rememberTone` | test-mail |
| Screenshot feedback | photo in the email's topic → `attachFeedback` | code path; manual |
| One topic per actionable email, automatic intake | `/inbox here`, `mailNew`, `intake` | test-mail |
| Persistence / recovery | `recover()` at boot, same key | test-mail |
| Bounded, revocable auto-send | `setPolicy`, `policyAllows`, `/autosend` | test-mail |
| Schedules as examples only | example has no schedule | test-mail |

### Acceptance (what the owner can check)

1. Send a voice note to the bot → the reply quotes what was heard and comes back as a voice note in Daniel's voice; `/voice british-female` changes it; `/voice id …` uses your own.
2. Add the bot to a group, send the link code there → mention-only; a friend writing in the group gets nothing until `/allow <their id>`; `/mode all` answers everyone allowed; `/diag` reports it all.
3. Command centre → Email review → *Try it with three demo emails* → one email at a time; **Revise** with "more formal" → version 2 and the skill *Email tone and style*; **Send this exact reply** → *accepted*; the provider's event later → *delivered*.
4. `/autosend on <your partner's domain> 1 7` → the next clean email from them goes without a yes, the second waits; `/autosend off`.
5. Automations → *Weekly ads analysis (demo)* → Run → the three products with ROAS verdicts, marked DEMO DATA.

## 12e. J.A.R.V.I.S. on the Apple Watch

The watch app (FlowWatch) has a **J.A.R.V.I.S. & the team** screen (Today →
the blue button): what needs your yes (Approve / Decline, each bound to the
approval's server id), the email waiting (Send v*n* bound to the draft's hash
— a draft with flags cannot be sent from the wrist; Don't send), work in
flight (a question is answered by dictation), what just finished, the
morning briefing in a few lines, and **Ask the team** — dictation that goes to
J.A.R.V.I.S. exactly as a chat message would (he answers; he can start work).
Server: `GET/POST /api/watch/team` with the watch's bearer; ops `approve`,
`decline`, `mailsend {id, hash}`, `mailskip`, `answer {id, text}`, `say
{text}`. Swift: `TeamView` in `ios-app/native/Watch/FlowWatchApp.swift`,
`WatchAPI.team()/teamAct()` in `WatchStore.swift`. Build and install through
Xcode on the Mac (no App Review needed for a TestFlight build; the owner is
asked before any review submission). Actionable notifications on the watch
itself would need iOS notification categories — not done; the phone's pushes
are mirrored as they are.

## 12f. Plugins — MCP servers the team can use

The "thousand plugins" answer: any server that speaks the **Model Context
Protocol** (Streamable HTTP) is a plugin. Command centre → **Plugins** (on
J.A.R.V.I.S.'s view) → *Connect an MCP server*: a name, the `https://`
address, and — if the server needs a token — the **name** of the Render
variable that holds it (never the token itself; a pasted token is refused).
The Flow runs `initialize` → `tools/list`, shows the tools and marks each as
*reads* or *acts* by its name and words. Two modes per plugin: **every call
needs my yes** (default) or **reading tools run at once; actions need my
yes**. A plugin can be limited to some agents.

In a task an agent asks for a tool with `"tool": { "plugin": "<id>", "name":
"<tool>", "args": {} }`: a reading tool on a "read" plugin runs during the
step and the result goes back to the agent; anything else is written up as a
proposal of kind `tool` and runs — once — when the owner approves it (the
approval card, `/yes n`, or the watch). A tool the server never listed is
refused with the real list. Every call is logged with who asked.

The **catalogue** counts honestly: *connected* (working, with its tool count),
*awaiting* (a variable missing — named — or a server that refused us),
*directory* (well-known MCP servers to connect: Notion, Stripe, GitHub,
Linear, HubSpot, Shopify dev, Cloudflare docs, Context7 — "available", never
"working"), and *platforms* (Composio — awaiting `COMPOSIO_API_KEY`; once set,
the apps connected there appear here). Connections now shows Notion, GitHub,
Shopify, HubSpot and Stripe as **Available — connect** instead of *Not built*.
`GET/POST /api/team/plugins` (ops add · check · mode · agents · remove · call).
OAuth-only servers (Notion, Linear, HubSpot) need the sign-in step that MCP
authorisation defines; until it is built they are listed as such and connect
once a token variable can be given.

## 12g. Smooth on a phone: the dock, and what was making it lag

**The console on a phone is a dock.** In the command centre on anything up
to 900 px wide, the J.A.R.V.I.S. box no longer floats over the dashboard as
a half-screen sheet. It is one row at the very bottom — Document · Type ·
Live · Talk — and the room above leaves it exactly that much space, so
nothing is ever covered while scrolling. The words go to the orb: what is
being said shows under it live as it is heard, then what was said and what
he answered stay there (tap them to open the whole conversation). The dock
opens into the full sheet to type (**Type**, which then reads **Hide**), when
a plan is on screen to review (it settles back to the dock when the plan is
gone), when a new answer lands while typing (back to the dock, the answer is
under the orb), and when the microphone has an error to show. Desktop is
unchanged. (`html.hud-dock`, `Say.dockable/dockSync/kb`, `Hud.caption`.)

**What was lagging, measured on the live account** (7–8 k DOM nodes):

| Where | Cause | Fix |
|---|---|---|
| Command centre, always | the orb's frame callback ran at the screen's rate (79/s on a 120 Hz screen), each frame asking `speechSynthesis.speaking` (a trip to the platform) and drawing 720 points at 32 fps even when the orb was scrolled away or on another page | one frame chain; 20 fps idle, 60 at most when busy; `speaking` polled 5×/s; the orb naps when hidden, off-screen (IntersectionObserver) or on a page; 420 points on phones |
| Command centre, boot and every 30 s | `Hud.paint()` 34× at boot, each rewriting both columns' innerHTML — a mutation storm re-translated and re-laid-out by every observer | `Hud.set` writes the DOM only when the HTML changed; a burst of paints becomes one on the next frame (`Hud.paint` → `paintNow`) |
| Every tab switch in Simple | `Visuals.findHeadings` walked every heading/div/span in the document calling `closest()` first — 43 ms per switch on the live account, from the TimeChips rescan which also re-scanned the whole document for any added node | cheap tests first, `closest()` last; rescans scoped to the subtrees that changed; mutations inside the command centre, the console and the sheets never trigger one |
| Every tab switch | `Nav.paintSeg` rewrote the segment row and read `offsetLeft/scrollWidth` three times per tap — three forced layouts of the whole page | the row is rewritten only when it changes; measurements on the next frame |
| Journal | 500 rows × `toLocaleDateString` + `toLocaleTimeString` (a new formatter each call), redrawn every time the tab opened | three `Intl.DateTimeFormat`s made once; no redraw when nothing changed |
| iPhone scrolling | `backdrop-filter: blur(20px)` on the fixed bottom bar re-blurred the page under it on every scrolled frame | no blur on the bar (it is 94–96 % opaque anyway) |

Numbers (phone viewport, CPU ×4, replica): orb frames 629 → 382 ms over a
twelve-page tour, whole-document rescans 102 → 24 ms, boot paints 34 → 6
builds / 9 DOM writes. The hud suite checks the dock, the captions, the
single frame chain, the idle rate and the write guard.

## 13. Tests

`node tests/run.js team team2 team3 channels memory skills scripts efficiency setup context groups voicenotes mail plugins` runs the team with a stand-in
for every provider and channel (`FLOW_TEAM_FAKE=1`, never set on the real
server). The browser tests run where Chromium exists and say so when it
does not.
