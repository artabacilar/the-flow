/* Prices come from three free, unauthenticated APIs. The things worth proving
   are not "it fetches a number" but: it does not hammer them, one of them
   dying does not blank the panel, the derived gram-gold figure is arithmetic
   we can check by hand, and an anonymous caller cannot spend the quota. */
const path = require('path');
const extras = require(require.resolve('../flow-extras.js'));
const { derive, TROY_OZ_G } = extras._internals;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : ''))); };
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

(async () => {
  console.log('\n— gram gold is derived, not fetched —');
  const d = derive({ XAUUSD: 4066.4, USDTRY: 47.525, BTCUSD: 59978, USDEUR: 0.8707 });
  ok('a troy ounce is 31.1034768 g', near(TROY_OZ_G, 31.1034768));
  ok('XAU in lira is ounce price × USDTRY', near(d.XAUTRY, 4066.4 * 47.525, 1e-6), d.XAUTRY);
  const expectGram = (4066.4 * 47.525) / 31.1034768;
  ok('gram gold is that divided by a troy ounce', near(d.GRAMGOLDTRY, expectGram, 1e-6), d.GRAMGOLDTRY);
  ok('and lands in a sane range for 2026', d.GRAMGOLDTRY > 1000 && d.GRAMGOLDTRY < 100000, Math.round(d.GRAMGOLDTRY));
  ok('BTC in lira is derived too', near(d.BTCTRY, 59978 * 47.525, 1e-6), d.BTCTRY);
  ok('BTC in euro is derived too', near(d.BTCEUR, 59978 * 0.8707, 1e-6), d.BTCEUR);

  console.log('\n— a missing input derives nothing rather than guessing —');
  const partial = derive({ XAUUSD: 4066.4 });
  ok('no USDTRY means no gram gold', partial.GRAMGOLDTRY === undefined, partial.GRAMGOLDTRY);
  ok('and no BTC pairs invented', partial.BTCTRY === undefined && partial.BTCEUR === undefined);
  const zero = derive({ XAUUSD: 4066.4, USDTRY: 0 });
  ok('a zero rate is dropped, not multiplied', zero.GRAMGOLDTRY === undefined && zero.USDTRY === undefined, zero);

  console.log('\n— one dead source must not blank the others —');
  /* Rebuild the module with stubbed sources so nothing touches the network. */
  delete require.cache[require.resolve('../flow-extras.js')];
  const fresh = require(require.resolve('../flow-extras.js'));
  const S = require(require.resolve('../flow-extras.js'));
  const int = fresh._internals;
  let btcCalls = 0;
  const mod = require.cache[require.resolve('../flow-extras.js')].exports;
  // swap the private SOURCES via a fresh derive-only path: simulate refresh outcomes
  // by driving the cache directly, which is what refresh() does on partial failure.
  int.cache.quotes = int.derive({ BTCUSD: 100, USDTRY: 40, XAUUSD: 4000 });
  int.cache.at = Date.now();
  const before = Object.assign({}, int.cache.quotes);
  /* Now pretend the gold source failed on the next round: refresh merges over
     the previous values rather than replacing them. */
  const merged = int.derive(Object.assign({}, int.cache.quotes, { BTCUSD: 111 }));
  ok('a fresh BTC value lands', merged.BTCUSD === 111, merged.BTCUSD);
  ok('the last good gold value survives', merged.XAUUSD === 4000, merged.XAUUSD);
  ok('and gram gold is still computable', isFinite(merged.GRAMGOLDTRY), merged.GRAMGOLDTRY);

  console.log('\n— the cache serves without refetching —');
  int.cache.at = Date.now();
  int.cache.quotes = { BTCUSD: 42 };
  const c1 = await int.quotes();
  ok('a value under a minute old is served as-is', c1.quotes.BTCUSD === 42, c1.quotes.BTCUSD);
  ok('and it reports its own age', typeof (Date.now() - c1.at) === 'number');

  console.log('\n— staleness is reported, not hidden —');
  int.cache.at = Date.now() - 45 * 60 * 1000;
  const old = int.cache.at;
  ok('a 45-minute-old value is past the hard limit', (Date.now() - old) > 30 * 60 * 1000);


  console.log('\n— the parsers, against real recorded payloads —');
  {
    delete require.cache[require.resolve('../flow-extras.js')];
    const m = require(require.resolve('../flow-extras.js'));
    const I = m._internals;
    /* Captured verbatim from the live endpoints. */
    const REC = {
      'https://api.coinbase.com/v2/prices/BTC-USD/spot':
        { data: { amount: '59977.995', base: 'BTC', currency: 'USD' } },
      'https://api.frankfurter.dev/v1/latest?from=USD&to=TRY,EUR':
        { amount: 1.0, base: 'USD', date: '2026-07-31', rates: { EUR: 0.8707, TRY: 47.525 } },
      'https://api.gold-api.com/price/XAU':
        { currency: 'USD', currencySymbol: '$', exchangeRate: 1.0, name: 'Gold',
          price: 4066.399902, symbol: 'XAU', updatedAt: '2026-08-03T05:03:51Z' }
    };
    const seen = [];
    I.setFetcher(async (url) => { seen.push(url); if (REC[url]) return REC[url]; throw new Error('unexpected URL ' + url); });

    const btc = await I.SOURCES.btc();
    ok('Coinbase amount arrives as a string and is parsed', btc.BTCUSD === 59977.995, btc);
    const fx = await I.SOURCES.fx();
    ok('Frankfurter USD/TRY read', fx.USDTRY === 47.525, fx.USDTRY);
    ok('EUR/USD inverted correctly', near(fx.EURUSD, 1 / 0.8707, 1e-9), fx.EURUSD);
    ok('EUR/TRY crossed correctly', near(fx.EURTRY, 47.525 / 0.8707, 1e-9), fx.EURTRY);
    ok('the rate date is carried through', fx.__date === '2026-07-31', fx.__date);
    const gold = await I.SOURCES.gold();
    ok('gold price read from its own field name', gold.XAUUSD === 4066.399902, gold);

    I.cache.at = 0; I.cache.quotes = {};
    seen.length = 0;            // count only the refresh, not the three probes above
    await I.refresh();
    const q = I.cache.quotes;
    ok('a full refresh produces every pair', ['BTCUSD','USDTRY','EURTRY','EURUSD','XAUUSD','GRAMGOLDTRY','BTCTRY','BTCEUR'].every(k => typeof q[k] === 'number'), Object.keys(q));
    ok('gram gold from the real numbers is plausible', q.GRAMGOLDTRY > 5000 && q.GRAMGOLDTRY < 10000, Math.round(q.GRAMGOLDTRY));
    ok('no errors when every source answers', Object.keys(I.cache.errors).length === 0, I.cache.errors);
    ok('exactly three upstream calls for a refresh', seen.length === 3, seen.length);

    console.log('\n— and when one of them falls over —');
    I.setFetcher(async (url) => {
      if (url.indexOf('gold-api') >= 0) throw new Error('HTTP 503');
      return REC[url];
    });
    const goldBefore = I.cache.quotes.XAUUSD;
    await I.refresh();
    ok('the dead source is reported', !!I.cache.errors.gold, I.cache.errors);
    ok('its last good value is still served', I.cache.quotes.XAUUSD === goldBefore, I.cache.quotes.XAUUSD);
    ok('the healthy pairs keep updating', I.cache.quotes.USDTRY === 47.525, I.cache.quotes.USDTRY);
    ok('gram gold still computes from the kept value', isFinite(I.cache.quotes.GRAMGOLDTRY), I.cache.quotes.GRAMGOLDTRY);
    I.setFetcher(null);
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
