/* Submitting the sign-in card no longer always lands in the app.
 *
 * Creating an account now stops on the recovery-code screen first, and that
 * screen will not let anyone past until they say they have written the codes
 * down. That is deliberate — it is the one moment the codes exist — so the
 * tests walk through it the way a person does rather than reaching around it.
 *
 * Signing in is unchanged, so this handles both: it waits for whichever
 * happens, and only walks the extra screen when the extra screen is there. */
module.exports = async function submitAuth(page, sel) {
  const nav = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
  const codes = page.waitForSelector('#flow-codes', { timeout: 20000 }).catch(() => null);
  await page.click(sel || '#fa-go');
  await Promise.race([nav, codes]);
  if (await page.$('#flow-codes')) {
    await page.check('#fc-ack');
    const nav2 = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
    await page.click('#fc-done');
    await nav2;
  }
};
