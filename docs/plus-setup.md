# Flow Plus — switching the shop on

The code for subscriptions is live, but nothing is charged until the keys
below are set on Render. Until then every account is on the plan it always
was, the Plus sheet says "Subscriptions open soon", and nothing else changes.

## Who is on which plan (no keys needed)

- The owner account: Plus, for good.
- Every account created before `FLOW_PLUS_LAUNCH` (default `2026-11-01`):
  Plus, for good. Set the variable to the day you open the shop so the people
  who were here first are never billed.
- Every account created after that date: Free, until a shop says otherwise.

Free is the planner: Today, the week, habits, the journal, everything typed
in, export. Plus is the reading: Patterns every morning (Free gets one read a
week), Coming up's read, Ask (Free gets five questions a week), Direction,
statements, event briefs, the week planned with you.

Only the Simple interface shows any of this — the card in Settings, the
sheet, the lines under cards. Advanced is unchanged. A Free account using
Advanced sees the plain sentence "This is part of Flow Plus." where a read
would be, nothing more.

## 1. Stripe (the web)

1. Create two recurring prices in Stripe: **$9.99 / month** and **$79.99 /
   year**. Copy their ids (`price_…`).
2. Add a webhook endpoint `https://theflow.today/api/plus/webhook/stripe`
   with the events `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy its signing secret (`whsec_…`).
3. Turn on the Customer Portal (Settings → Billing → Customer portal) so
   "Manage billing" works; allow cancelling and switching plans there.
4. On Render, set:

   | Variable | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_live_…` |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
   | `STRIPE_PRICE_MONTHLY` | `price_…` |
   | `STRIPE_PRICE_YEARLY` | `price_…` |
   | `FLOW_PLUS_LAUNCH` | the day the shop opens, `YYYY-MM-DD` |

The yearly plan carries a 14-day trial (`FLOW_PLUS_TRIAL_DAYS` to change it);
the monthly plan has none. Promotion codes are allowed at checkout. A card
that fails keeps Plus for 3 days of grace before the account reads as Free.

Test it first with the `sk_test_…` key and Stripe's test cards; the code is
the same.

## 2. RevenueCat (App Store and Play)

1. Create the app in RevenueCat with the same two products (monthly, yearly,
   14-day introductory offer on yearly) in App Store Connect and the Play
   Console, and an entitlement called `plus`.
2. Add a webhook `https://theflow.today/api/plus/webhook/revenuecat` with an
   Authorization header value of your choosing.
3. On Render, set `REVENUECAT_WEBHOOK_AUTH` to that same value.
4. In the iOS and Android apps, sign RevenueCat in with the account id
   (`Purchases.logIn(uid)` — the `flow_acct` cookie carries it) so the
   purchase lands on the right account. The native paywall is still to be
   built; until then the sheet in the web app is what people see.

## 3. Open sign-up

Sign-up is open when `FLOW_INVITE_CODE` is unset. Leave `FLOW_MAX_ACCOUNTS`
as a ceiling while the first wave arrives, then raise it.

## 4. The evening check-in

A setting in Simple's Plus card. It uses the push module that already sends
Big Rock reminders; nothing to configure.

## What is deliberately not here yet

Sign in with Apple / Google (needs your developer credentials), the native
paywall in the iOS app, regional store pricing (set in App Store Connect and
the Play Console), and analytics. These are listed in the growth plan.
