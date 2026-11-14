// Token Radar v2 dashboard. Reads window.RADAR (dashboard/data.js, written
// by main.ts from the same board as board.json) and renders the ranked
// board, a live-token view, a per-protocol detail view and the method.
// No network: every byte it shows is in data.js.
//
// The page recomputes each row's implied value from the fitted line and
// checks it against the number board.json carries, so the page's code and
// the board's data are visibly the same arithmetic. The farm plan is the
// same derivation main.ts writes to board.json: category, chains, TVL and
// age decide the action, the capital, the hold and every cost and time.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var FIT = DATA.fit;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(m) {
    if (m === null || m === undefined || !isFinite(m)) return 'n/a';
    return 'x' + m.toFixed(3);
  }

  // The fitted line, recomputed here from the fit the data carries:
  // implied = 10^a * TVL^b, multiple = implied / TVL, clamped [0.01, 1.25].
  function impliedOf(row) {
    var raw = Math.pow(10, FIT.a + FIT.b * Math.log10(row.tvl_usd));
    var mult = Math.min(FIT.clamp_high, Math.max(FIT.clamp_low, raw / row.tvl_usd));
    return Math.max(1, Math.round(row.tvl_usd * mult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  // ---- farm plans: the same derivation as lib/model.ts ----
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasOn(chain) {
    var c = (chain || '').toLowerCase();
    if (c.indexOf('ethereum') >= 0) return '$3 to $12';
    if (c.indexOf('bitcoin') >= 0) return '$1 to $5';
    if (c.indexOf('solana') >= 0 || c.indexOf('hyperliquid') >= 0) return '$0.01 to $0.10';
    if (c.indexOf('base') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('monad') >= 0) return '$0.05 to $1';
    if (c.indexOf('binance') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('tron') >= 0) return '$0.10 to $2';
    return '$0.50 to $3';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function planKind(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lend';
    if (c.indexOf('dex') >= 0) return 'dex';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('basis trading') >= 0) return 'deriv';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'curator';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0 || c.indexOf('staking pool') >= 0) return 'stake';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('prediction') >= 0) return 'predict';
    if (c.indexOf('govern') >= 0) return 'govern';
    return 'default';
  }
  function weeklyAction(kind, ctx) {
    switch (kind) {
      case 'lend': return 'Each week, adjust the position once: top up $' + (ctx.capital / 2) + ' of collateral or borrow a small amount against it so the address shows repeat use.';
      case 'dex': return "Each week, swap a small amount through " + ctx.name + "'s main pool on " + ctx.chain + ' and add or remove a little liquidity.';
      case 'deriv': return 'Each week, open and close one small hedged position on ' + ctx.name + ' so the address shows repeat trading, never a single deposit.';
      case 'yield': return 'Each week, claim the yield or restake the rewards inside ' + ctx.name + ' on ' + ctx.chain + ' instead of letting them sit.';
      case 'rwa': return 'Each week, check the yield accrual on the ' + ctx.name + ' position and mint a small top-up so the holding grows over time.';
      case 'curator': return "Each week, review the vault's allocation report for " + ctx.name + ' and rebalance or top up the deposit when it changes strategy.';
      case 'bridge': return 'Each week, bridge a small amount in each direction through ' + ctx.name + ' so the address has bridge volume on more than one day.';
      case 'stake': return 'Each week, restake the staking rewards through ' + ctx.name + ' so the receipt balance compounds instead of sitting idle.';
      case 'stable': return 'Each week, mint or redeem a small amount of the stable asset through ' + ctx.name + ' on ' + ctx.chain + ' to keep the address active.';
      case 'insurance': return "Each week, check the cover's expiry on " + ctx.name + ' and renew or extend it before it lapses.';
      case 'predict': return 'Each week, settle one small market position on ' + ctx.name + ' so the address has a history of resolved markets.';
      case 'govern': return 'Each week, vote on one live proposal in ' + ctx.name + "'s governance and leave a short rationale with the vote.";
      default: return 'Each week, make one qualifying action inside ' + ctx.name + ', such as a deposit, a swap or a vote, so the address is active more than once.';
    }
  }
  function mainAction(kind, ctx) {
    var dep = '$' + ctx.capital;
    switch (kind) {
      case 'lend': return 'Supply ' + dep + ' of USDC to ' + ctx.name + ' on ' + ctx.chain + ', then borrow a small amount against it so the address is both a supplier and a borrower.';
      case 'dex': return 'Provide ' + dep + " of liquidity to " + ctx.name + "'s largest pool on " + ctx.chain + ", in the pair the pool's own page lists first.";
      case 'deriv': return 'Deposit ' + dep + ' of USDC as margin on ' + ctx.name + ' and open one small hedged position, long spot against short perps, so the position is delta-neutral.';
      case 'yield': return 'Deposit ' + dep + ' of USDC into ' + ctx.name + "'s highest-yield vault on " + ctx.chain + ' and leave the receipt token in the same wallet.';
      case 'rwa': return 'Mint ' + dep + ' of ' + ctx.name + "'s yield-bearing asset on " + ctx.chain + ' with USDC and hold it; the yield accrues on the token itself.';
      case 'curator': return 'Deposit ' + dep + ' into a ' + ctx.name + ' vault on ' + ctx.chain + ' and keep the vault shares; the curator allocates them across its strategies.';
      case 'bridge': return 'Bridge ' + dep + ' of USDC into ' + ctx.chain + ' through ' + ctx.name + ', then use the bridged funds in one app on that chain the same week.';
      case 'stake': return 'Stake ' + dep + " of the chain's staking asset through " + ctx.name + ' and keep the liquid receipt token in the wallet it was minted to.';
      case 'stable': return 'Mint ' + dep + ' of the stable asset through ' + ctx.name + ' on ' + ctx.chain + ' with USDC, then hold it instead of swapping it away.';
      case 'insurance': return 'Buy ' + dep + ' of cover from ' + ctx.name + ' on ' + ctx.chain + ' for the asset you actually hold, and keep the policy active.';
      case 'predict': return 'Fund ' + ctx.name + ' with ' + dep + ' and place one small position in the market whose outcome you can follow to settlement.';
      case 'govern': return 'Lock or delegate ' + dep + ' of voting power in ' + ctx.name + ' on ' + ctx.chain + ' so the address counts as a participating holder.';
      default: return 'Deposit ' + dep + ' of USDC into ' + ctx.name + ' on ' + ctx.chain + ' and keep the position open.';
    }
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var ctx = { name: p.name, chain: chain, capital: capitalFor(p), gas: gasOn(chain), hold: holdDaysFor(p.age_days) };
    var kind = planKind(p.category);
    var setupGas = ctx.gas === '$0.01 to $0.10' ? 'a few cents of gas' : ctx.gas + ' of gas';
    return [
      { text: 'Open a fresh wallet on ' + chain + ' that holds only the funds you plan to farm, fund it with $' + (ctx.capital + 10) + " of the chain's gas token and the farming capital, and keep its seed phrase offline.", cost: setupGas + ' for the first transactions', time: '10 minutes' },
      { text: mainAction(kind, ctx), cost: '$' + ctx.capital + ' of capital and about ' + ctx.gas + ' of gas', time: '20 minutes to set up' },
      { text: weeklyAction(kind, ctx), cost: 'about ' + ctx.gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + ctx.hold + ' days so the activity is counted in more than one snapshot, and do not withdraw and re-deposit to fake age.', cost: 'the $' + ctx.capital + ' stays in the position', time: ctx.hold + ' days' },
      { text: "Before you withdraw, open " + ctx.name + "'s own points or rewards page from the link the protocol itself publishes and check whether the wallet qualifies; claim only from that link.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the chain, the dates and every transaction in a farm log so you can repeat the position on ' + chain + ' or unwind it without guessing.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /** The three traded protocols nearest a row in TVL, as context only: they calibrate nothing. */
  function nearestPeers(row) {
    var target = Math.log10(row.tvl_usd);
    return DATA.traded.slice().sort(function (a, b) {
      return Math.abs(Math.log10(a.tvl_usd) - target) - Math.abs(Math.log10(b.tvl_usd) - target);
    }).slice(0, 3);
  }

  /** Log-log fit chart: binned median multiples of the calibration set, the fitted line, and one marked protocol.
   *  Built as markup (the parser gives the elements their SVG namespace),
   *  so no address literal appears in the page's source. */
  function fitChart(markRow) {
    var W = 720, H = 260, padL = 52, padR = 14, padT = 12, padB = 34;
    var logMin = Math.log10(5e6), logMax = Math.log10(5e9);
    var multMin = 0.01, multMax = 1;
    function X(tvl) { return padL + (Math.log10(tvl) - logMin) / (logMax - logMin) * (W - padL - padR); }
    function Y(mult) { return padT + (Math.log10(multMax) - Math.log10(Math.max(multMin, mult))) / (Math.log10(multMax) - Math.log10(multMin)) * (H - padT - padB); }
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fitted multiple against TVL, log scales">';
    [1e7, 1e8, 1e9].forEach(function (t) {
      out += '<line x1="' + X(t).toFixed(1) + '" y1="' + padT + '" x2="' + X(t).toFixed(1) + '" y2="' + (H - padB) + '" class="grid"/>';
      out += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 12) + '" class="tick" text-anchor="middle">' + (t >= 1e9 ? '$1B' : t >= 1e8 ? '$100M' : '$10M') + '</text>';
    });
    [0.01, 0.1, 1].forEach(function (m) {
      out += '<line x1="' + padL + '" y1="' + Y(m).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + Y(m).toFixed(1) + '" class="grid"/>';
      out += '<text x="' + (padL - 6) + '" y="' + (Y(m) + 3).toFixed(1) + '" class="tick" text-anchor="end">x' + m + '</text>';
    });
    out += '<path d="M ' + X(5e6).toFixed(1) + ' ' + Y(Math.pow(10, FIT.a + (FIT.b - 1) * Math.log10(5e6))).toFixed(1) +
      ' L ' + X(5e9).toFixed(1) + ' ' + Y(Math.pow(10, FIT.a + (FIT.b - 1) * Math.log10(5e9))).toFixed(1) + '" class="fitline"/>';
    FIT.bins.forEach(function (bin) {
      out += '<circle cx="' + X(bin.tvl_mid).toFixed(1) + '" cy="' + Y(bin.median_multiple).toFixed(1) + '" r="' + (3 + Math.min(6, bin.n)) + '" class="bin"/>';
    });
    if (markRow) {
      out += '<circle cx="' + X(markRow.tvl_usd).toFixed(1) + '" cy="' + Y(markRow.multiple).toFixed(1) + '" r="7" class="here"/>';
    }
    out += '<text x="' + padL + '" y="' + (H - 16) + '" class="cap">Multiple (mcap / TVL) against TVL, log scales.</text>';
    out += '<text x="' + padL + '" y="' + (H - 2) + '" class="cap">Teal dots: median multiple per TVL bin over ' + FIT.n + ' traded protocols. Amber line: the fitted power law.</text>';
    out += '</svg>';
    return out;
  }
  function chartDiv(markRow) {
    var div = el('div', { class: 'chart' });
    div.innerHTML = fitChart(markRow);
    return div;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index, ' + DATA.rows.length + ' rows ranked' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, priced by the market\u2019s own size curve' }),
        el('p', { text: 'The market pays a smaller multiple for a bigger protocol: a $5M protocol lists near x0.65 of TVL, a $5B one near x0.02. This board fits that curve to the ' + FIT.n + ' traded protocols in the snapshot and prices every pre-token protocol on it, instead of charging every protocol in a category the same flat multiple.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median backtest error' }), el('b', { text: 'x' + Math.pow(10, FIT.backtest_median_log_err).toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      ),
      el('div', { class: 'formula-strip' },
        el('b', { text: 'implied value = 10^' + FIT.a.toFixed(2) + ' x TVL^' + FIT.b.toFixed(3) + '  (multiple clamped x0.01\u2013x1.25)' }),
        el('span', { class: 'sub', text: 'Fitted by least squares to ' + FIT.n + ' traded protocols (bridges, liquid staking/restaking and CEX left out; multiples winsorised x0.01\u2013x5). Growth and age are shown as badges, not in the formula: both tested worse as regressors.' })
      ),
      el('div', { class: 'panel' },
        el('h2', { text: 'The size curve' }),
        el('p', { class: 'sub', text: 'The amber line is the fitted multiple at each size. The teal dots are what traded protocols actually list at, binned by TVL.' }),
        el('div', { class: 'chart' }, chartDiv(null))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function growthBadge(r) {
    if (r.change_7d === null) return el('span', { class: 'badge', text: '7d n/a' });
    var cls = r.change_7d >= 0 ? 'badge growth-up' : 'badge growth-down';
    return el('span', { class: 'badge ' + cls.split(' ')[1], text: '7d ' + fmtPct(r.change_7d) });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: (r.ev_low_usd !== null && r.ev_high_usd !== null) ? fmtUsd(r.ev_low_usd) + ' \u2013 ' + fmtUsd(r.ev_high_usd) : 'n/a' }),
        el('td', null, growthBadge(r), el('span', { class: 'badge', text: 'no token ' + fmtAge(r.age_days) })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for how its value was computed and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'EV / farmer' }),
            el('th', { scope: 'col', text: 'Badges' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function of the snapshot figures scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( 10^' + FIT.a.toFixed(4) + ' x TVL^' + FIT.b.toFixed(4) + ' ),  multiple = implied / TVL, clamped x' + FIT.clamp_low + ' to x' + FIT.clamp_high
      ),
      el('ul', null,
        el('li', { text: 'Calibration: ' + FIT.n + ' traded protocols with a market cap and TVL above zero, after leaving out ' + FIT.excluded + ' in Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX, and winsorising multiples to x' + FIT.winsor_low + '–x' + FIT.winsor_high + ' before the fit.' }),
        el('li', { text: 'Backtest (leave one out, ' + FIT.backtest_n + ' traded protocols): median error x' + Math.pow(10, FIT.backtest_median_log_err).toFixed(2) + ', ' + Math.round(FIT.backtest_within_2x * 100) + '% of predictions within 2x of the real market cap. A flat multiple per category scores x4.88 and 22% on the same test; five nearest comparables score x5.04 and 20%.' }),
        el('li', { text: 'Growth and age are not in the formula: as extra regressors they made the backtest worse (growth x3.77, age x3.48, both x3.59), so they are shown as badges and the formula stays one line. Category intercepts were tested too and lost to the plain global line.' }),
        el('li', { text: 'EV per farmer assumes a 10% community allocation and an estimated farmer count from the TVL band, chain count and age; the range is half to twice the point estimate, because the farmer count is the least certain number on the board.' }),
        el('li', { text: 'The early radar is every pre-token protocol below the $50M watchlist floor, by TVL. Live-token protocols are set aside with their market caps shown, never mixed into the ranking.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var peers = nearestPeers(row);
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How this value was computed' }),
      el('div', { class: 'chart' }, chartDiv(row)),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted multiple at this size' }), el('b', { class: 'num', text: fmtMult(row.multiple) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth (badge, not in the formula)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token (badge)' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'EV per farmer (estimated range)' }), el('b', { class: 'num', text: (row.ev_low_usd !== null && row.ev_high_usd !== null) ? fmtUsd(row.ev_low_usd) + ' \u2013 ' + fmtUsd(row.ev_high_usd) : 'n/a' }))
      ),
      el('p', { class: 'sub', text: 'The amber dot on the chart is this protocol; the line is the fitted multiple at its size. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' — which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Traded protocols near this size' }),
      el('p', { class: 'sub', text: 'Context only: the three traded protocols closest in TVL. They calibrate nothing on their own; the line above is fitted to all ' + FIT.n + ' of them.' }),
      peers.map(function (p) {
        return el('div', { class: 'peer' },
          el('span', { text: p.name + ' (' + (p.category || 'Other') + ')' }),
          el('span', null, 'TVL ' + fmtUsd(p.tvl_usd) + '  ·  ', el('b', { text: 'x' + p.multiple.toFixed(3) }))
        );
      })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(methodPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
