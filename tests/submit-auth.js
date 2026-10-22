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
  /* The race can settle while the page is still mid-navigation; asking the
     old document for an element then throws. Settle, then ask once more. */
  let onCodes = false;
  try { onCodes = !!(await page.$('#flow-codes')); }
  catch (e) { await page.waitForTimeout(600); try { onCodes = !!(await page.$('#flow-codes')); } catch (e2) { onCodes = false; } }
  if (onCodes) {
    await page.check('#fc-ack');
    const nav2 = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
    await page.click('#fc-done');
    await nav2;
  }
};
