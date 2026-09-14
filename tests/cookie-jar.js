/* A cookie jar that behaves the way a browser does.
 *
 * Every suite here used to keep `set-cookie.split(';')[0]` — the first cookie
 * of the first header and nothing else — and replace the whole jar with it.
 * That held while a response only ever set one cookie. It stopped holding the
 * day /api/auth/me began re-stamping `flow_acct` on its own: the jar threw the
 * session away to keep the account marker, and the very next call in the same
 * suite came back "auth required".
 *
 * The product was fine. The alarm was broken, which is worse than no alarm,
 * because a red line nobody believes is a red line nobody reads.
 *
 * So: read every Set-Cookie header, merge by cookie name, and keep whatever
 * the response did not mention.
 */
module.exports = function keepCookies(jar, who, res) {
  const h = res && res.headers;
  const lines = !h ? []
    : typeof h.getSetCookie === 'function' ? h.getSetCookie()
    : Array.isArray(h['set-cookie']) ? h['set-cookie']
    : h['set-cookie'] ? [h['set-cookie']]
    : [];
  if (!lines.length) return jar[who] || '';

  const held = {};
  String(jar[who] || '').split('; ').filter(Boolean).forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) held[c.slice(0, i).trim()] = c.slice(i + 1);
  });
  lines.forEach((line) => {
    const pair = String(line).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) held[pair.slice(0, i).trim()] = pair.slice(i + 1);
  });
  jar[who] = Object.keys(held).map((k) => k + '=' + held[k]).join('; ');
  return jar[who];
};
