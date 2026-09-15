# The Flow — App Store submission

Everything App Store Connect will ask for, answered. Copy the fields straight across.
Anything marked **you** is something only you can do: it needs your Apple ID, your
password, or your hands on a menu I am not allowed to open.

---

## 1 · What had to be built first

Three things would have failed review. They are done and live:

| Blocker | Guideline | State |
|---|---|---|
| No way to delete your account from inside the app | 5.1.1(v) | Built — Settings → Account |
| No privacy policy URL | App Store Connect requires one | `theflow.today/privacy` |
| No support URL | App Store Connect requires one | `theflow.today/support` |
| Icon was 512px with an alpha channel | Upload is rejected outright | Redrawn at 1024, no alpha |

One thing found on the way: `dropAllSessions` had never worked. No store exposed
`keys()`, so a password reset silently closed nobody else out. Fixed — the stores
enumerate now, and there is a test that signs in on a second device and proves the
reset ends it.

---

## 2 · App information

| Field | Value |
|---|---|
| **Name** (30 char max) | `The Flow — Life OS` |
| **Subtitle** (30 char max) | `Audit your routine. Change.` |
| **Bundle ID** | `com.abko.theflow` |
| **Primary category** | Productivity |
| **Secondary category** | Health & Fitness |
| **Age rating** | 4+ |
| **Primary language** | English (U.S.) |
| **Privacy Policy URL** | `https://theflow.today/privacy` |
| **Support URL** | `https://theflow.today/support` |
| **Marketing URL** | `https://theflow.today` |

> **Name availability** — "The Flow" alone is almost certainly taken. `The Flow — Life OS`
> is the safer reservation and still shows as "The Flow" on the Home Screen, because the
> Home Screen name comes from `CFBundleDisplayName`, not from this field.

---

## 3 · Promotional text (170 char max)

> Seventy percent of your life is what you do every day. The Flow is where you write that
> down, look at it every six months, and change it.

Promotional text can be edited without submitting a new build. Use it for what is new.

---

## 4 · Description

```
70% of your life is the things you do every day.

The Flow is a place to write those things down, keep an honest record of what you
actually did, and audit the whole lot every six months — keep what is working, get rid
of what isn't, and watch your life change.

It is one app for the parts of a life that usually live in six:

TODAY
What matters today, what is already done, and the one thing you keep not doing.

FOCUS
Your north star, the week's compass, and priorities sorted by whether they are urgent,
important, both or neither.

BODY
Training, meals, sleep and mood. Logged in seconds, and kept long enough to show you a
pattern rather than a day.

RECORD
A journal, a place to think out loud, where the hours went, and where the money went.

ASK
Ask questions about your own record — what you have been avoiding, whether last month
was better than the one before. It reads; it never changes anything.

A HOME SCREEN WIDGET
Today's handful of things, and how the week stands, without opening anything.

CONNECT AN ASSISTANT
Connect Claude or ChatGPT and let it read your Flow to answer questions about your own
week. Read-only, and you can disconnect it in two taps.

PRIVATE BY CONSTRUCTION
No advertising. No analytics. No tracking of any kind — none, not "anonymised". Your
entries are private to your account and are not shared with anyone, sold to anyone, or
used to train anything. You can export everything, and you can delete everything, from
inside the app, at any time.
```

---

## 5 · Keywords (100 characters, comma-separated, no spaces)

```
habit,routine,journal,planner,life,productivity,tracker,goals,review,diary,focus,weekly
```

That is 87 characters. Do not repeat the app name or the categories — Apple already
indexes those, and repeating them wastes the field.

---

## 6 · Privacy nutrition labels

Answer **Yes** to "Do you or your third-party partners collect data from this app?"

**Used to track you across apps and websites: NO.** Nothing in the app does this.

For every type below: purpose is **App Functionality**, it **is** linked to the user's
identity, and it is **not** used for tracking.

| Category | Type | Why |
|---|---|---|
| Contact Info | Email Address | The account, and password recovery |
| Contact Info | Name | What the app calls you |
| Identifiers | User ID | Separates your data from everyone else's |
| User Content | Other User Content | Journal, tasks, notes — the point of the app |
| Health & Fitness | Health | Sleep and meals you log |
| Health & Fitness | Fitness | Training you log |
| Financial Info | Other Financial Info | Expenses and budget you log |

**Not collected — say no to all of these:** Location, Contacts, Browsing History, Search
History, Purchases, Payment Info, Photos or Videos, Audio, Sensitive Info, Diagnostics,
Product Interaction, Advertising Data, Crash Data, Performance Data.

---

## 7 · App Review Information

**A demo account is required** — the app shows a sign-in screen before anything else, and
a reviewer who cannot get in rejects the build under 2.1.

> **you** — make one at theflow.today and put the address and password in the Sign-In
> Required fields. Use a throwaway password you do not use elsewhere; it will sit in
> App Store Connect in plain sight. Put a few entries in it so the reviewer sees an app
> with something in it rather than an empty template.

**Notes to the reviewer** — paste this in:

```
The Flow is a personal planner and journal. Sign in with the account above; the app
opens straight onto Today.

To see the widget: long-press the Home Screen, tap +, search "The Flow", and add the
Today widget. It shows the same items as the Today tab and refreshes about every
fifteen minutes.

There is no paid tier, no in-app purchase and no advertising. The account can be
deleted from inside the app: Settings (avatar, top right) → Account → "Delete my
account and everything in it". It asks for the password and then for the email
address, and the deletion is immediate and permanent.

The app is a native shell around a web app the developer also wrote and hosts. The
widget, the session handling and the offline state are native. Nothing outside
theflow.today loads inside the app — external links open in Safari.
```

---

## 8 · The one real review risk

**Guideline 4.2 — Minimum Functionality.** The app is a `WKWebView` pointed at
theflow.today. Apple rejects "a repackaged website" and this is, structurally, close to
one. What is on our side:

- a genuine Home Screen widget, written in SwiftUI, running in its own process and
  reading through an App Group — not a web view in a box;
- a persistent native session, so you are not asked to sign in every launch;
- an offline state that says so, rather than a white screen;
- the content is the user's own private data, not a public website anyone can read.

If it is rejected under 4.2, do not argue the wrapper — reply pointing at the widget and
offer to add one more native surface. The cheapest convincing one is a Lock Screen
widget or a Control Centre control, both of which reuse the `FlowStore` App Group code
that already exists.

---

## 9 · The order to do it in

1. **you** — sign in to App Store Connect and create the app record with §2.
2. **you** — create the demo account and fill in §7.
3. Paste §3–§6 into the listing. *(I can drive this in the browser once you are signed in.)*
4. Screenshots — 6.9" and 6.5", captured from the simulator.
5. **you** — Xcode → Product → Archive, then Distribute App → App Store Connect.
   I am granted click-only on Xcode and cannot open its menus; this one is yours.
6. Once the build finishes processing, attach it to the version and submit.

---

## 10 · Before you submit, check

- [ ] The icon in the build is the new one — dark, three waves, no white edge
- [ ] `theflow.today/privacy` and `/support` both load **signed out**
- [ ] Settings → Account shows "Delete my account and everything in it"
- [ ] The demo account signs in on a device that has never seen it
- [ ] The widget shows real items on a real iPhone
- [ ] The version and build numbers are higher than anything uploaded before
