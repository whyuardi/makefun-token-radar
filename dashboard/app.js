// Token Radar page: renders window.RADAR (written by main.ts) with no network.
// Board, detail view and filters all run from the same payload, so the
// screenshots, the table and the code behind them always agree.
(function () {
  var D = window.RADAR;
  if (!D || !D.rows) { document.getElementById('rows').innerHTML = '<tr><td colspan="9">No radar data loaded.</td></tr>'; return; }
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function age(v) {
    if (v === null || v === undefined) return '—';
    if (v >= 365) return (v / 365).toFixed(1) + 'y';
    return v + 'd';
  }

  // ---- header stats -------------------------------------------------------
  $('asof').textContent = 'snapshot ' + D.asOf;
  $('src').textContent = D.source;
  var evs = D.rows.map(function (r) { return r.evPerFarmerUsd; }).sort(function (a, b) { return a - b; });
  var medEv = evs[Math.floor(evs.length / 2)];
  var top = D.rows[0];
  $('stats').innerHTML = [
    [D.boardSize, 'pre-token protocols ranked'],
    [D.watchlistSize, 'on the $50M watchlist'],
    [money(top.implied_value_usd), 'top implied value · ' + esc(top.name)],
    [moneyFull(medEv), 'median value per farmer'],
    [D.liveSize, 'already-trading protocols set aside'],
  ].map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>'; }).join('');

  // ---- filter options -----------------------------------------------------
  var cats = {}, chains = {};
  D.rows.forEach(function (r) { if (r.category) cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { $('cat').appendChild(new Option(c, c)); });
  Object.keys(chains).sort().forEach(function (c) { $('chain').appendChild(new Option(c, c)); });

  var selected = null;
  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value, chain = $('chain').value, wo = $('watchonly').checked;
    var list = D.rows.filter(function (r) {
      if (wo && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0)) return false;
      return true;
    });
    var sort = $('sort').value;
    var preset = $('preset').value;
    if (preset === 'topev') sort = 'ev';
    var key = { implied: 'implied_value_usd', ev: 'evPerFarmerUsd', tvl: 'tvlUsd', growth: 'change7d', age: 'ageDays' }[sort];
    list.sort(function (a, b) { return (b[key] === null ? -1e18 : b[key]) - (a[key] === null ? -1e18 : a[key]); });
    if (preset === 'top10cat') {
      var seen = {};
      list = list.filter(function (r) {
        var c = r.category || 'Uncategorised';
        seen[c] = (seen[c] || 0) + 1;
        return seen[c] <= 10;
      });
    }
    return list;
  }

  function render() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + D.boardSize + ' pre-token protocols shown · ranked by implied launch value';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + ' · records no token</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).map(esc).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvlUsd) + '</td>' +
        '<td class="num">' + pct(r.change7d) + '</td>' +
        '<td class="num">' + age(r.ageDays) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + moneyFull(r.evPerFarmerUsd) + '</td></tr>';
    }).join('');
  }

  function bar(label, frac, text) {
    var w = Math.max(2, Math.min(100, Math.round(frac * 100)));
    return '<div class="bar"><span>' + label + '</span><i><em style="width:' + w + '%"></em></i><b>' + text + '</b></div>';
  }

  function showDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var box = $('detail');
    if (!r) { box.hidden = true; selected = null; render(); return; }
    selected = slug;
    var maxTvl = D.rows[0].tvlUsd, maxImp = D.rows[0].implied_value_usd;
    box.innerHTML =
      '<h2>#' + r.rank + ' · ' + esc(r.name) + (r.watchlist ? ' <span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · listed ' + esc(r.listedAt || 'date unknown') + ' · records no token</p>' +
      '<div class="kv">' +
      '<div><b>' + moneyFull(r.implied_value_usd) + '</b><span>implied launch value</span></div>' +
      '<div><b>' + moneyFull(r.evPerFarmerUsd) + '</b><span>value per farmer (est. ' + r.farmersEst.toLocaleString('en-US') + ' farmers)</span></div>' +
      '<div><b>' + money(r.tvlUsd) + '</b><span>TVL</span></div>' +
      '<div><b>' + (r.change7d === null ? '—' : (r.change7d > 0 ? '+' : '') + r.change7d.toFixed(1) + '%') + '</b><span>TVL change, 7 days</span></div>' +
      '<div><b>' + age(r.ageDays) + '</b><span>running with no token on record</span></div>' +
      '</div>' +
      '<h3>Why this rank — the model, step by step</h3><div class="bars">' +
      bar('TVL vs top row', r.tvlUsd / maxTvl, money(r.tvlUsd)) +
      bar('Category multiple', r.catRatio / 1.25, '×' + r.catRatio.toFixed(3)) +
      bar('7-day growth', (r.growthMult - 0.7) / 0.9, '×' + r.growthMult.toFixed(2)) +
      bar('Age without token', (r.ageMult - 0.75) / 0.25, '×' + r.ageMult.toFixed(2)) +
      bar('Chain breadth', (r.breadthMult - 1) / 0.16, '×' + r.breadthMult.toFixed(2)) +
      bar('Implied vs top row', r.implied_value_usd / maxImp, money(r.implied_value_usd)) +
      '</div>' +
      '<p class="why"><b>How to read it:</b> implied value = TVL × ' + r.catRatio.toFixed(3) + ' (the median market-cap-to-TVL ' +
      'ratio of traded ' + esc(r.category || 'protocols') + ') × ' + r.growthMult.toFixed(2) + ' (growth) × ' +
      r.ageMult.toFixed(2) + ' (age) × ' + r.breadthMult.toFixed(2) + ' (breadth). The per-farmer figure assumes ' +
      (D.tuning.communityShare * 100) + '% of that value reaches the community, split among an estimated ' +
      r.farmersEst.toLocaleString('en-US') + ' farmers.</p>' +
      '<p class="why"><b>In ' + esc(r.category || 'Uncategorised') + ':</b> ranked #' + r.catRank + ' of ' + r.catSize +
      ' · category median implied ' + moneyFull(r.catMedianUsd) + ' · this protocol is ' +
      (r.implied_value_usd / Math.max(1, r.catMedianUsd)).toFixed(1) +
      '× the median of its own kind.</p>' +
      '<h3>How to farm it — six steps</h3><ol>' +
      r.farm_steps.map(function (s, i) { return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    box.hidden = false;
    render();
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  // ---- live view ----------------------------------------------------------
  $('liverows').innerHTML = D.live.map(function (p) {
    return '<tr><td><span class="nm">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvlUsd) + '</td>' +
      '<td class="num">' + (p.mcapUsd === null ? '—' : money(p.mcapUsd)) + '</td>' +
      '<td class="num">' + (p.ratio === null ? '—' : '×' + p.ratio.toFixed(3)) + '</td></tr>';
  }).join('');

  // ---- methodology --------------------------------------------------------
  var t = D.tuning;
  $('method').innerHTML =
    '<p><b>Model ' + esc(D.modelVersion) + '.</b> The board ranks protocols that record no token by an ' +
    'implied launch value. The value is not a prediction that a token will launch, and not a price: ' +
    'it is what a token would be worth if the protocol\'s record stayed as it is.</p>' +
    '<p><code>implied = TVL × category multiple × growth × age × breadth</code></p>' +
    '<p><b>Category multiple.</b> For each category, the median market-cap-to-TVL ratio of the ' +
    'protocols in this snapshot whose tokens already trade (at least 3 examples; otherwise the global ' +
    'median ×' + D.globalRatio.toFixed(3) + '). Ratios are clamped to 0.05–1.25, and each traded protocol\'s own ratio is ' +
    'winsorised to 0.01–5× first, so a token priced on something other than its DeFi TVL cannot drag its category. No protocol name is ' +
    'ever special-cased — the same rule scores every row.</p>' +
    '<p><b>Growth</b> = 1 + ' + t.growthWeight + ' × clamp(7-day TVL change, ' + t.growthLow + '%, +' + t.growthHigh + '%) / 100. ' +
    '<b>Age</b> = ' + t.ageFloor + ' + 0.25 × min(days since listing, ' + t.ageCapDays + ') / ' + t.ageCapDays +
    ' (no listing date: ×' + t.unknownAge + '). <b>Breadth</b> = 1 + ' + t.breadthStep + ' per extra chain, capped at ' + t.breadthMax + '.</p>' +
    '<p><b>Value per farmer</b> = implied × ' + (t.communityShare * 100) + '% ÷ estimated farmers, where farmers ≈ ' +
    t.farmerBase + ' × √(TVL in $M) × (1 + ' + t.farmerChainStep + ' per extra chain, capped at ' + t.breadthMax + ') × an age factor from ×' +
    t.farmerAgeLow + ' (new) to ×' + t.farmerAgeHigh + ' (3+ years), capped at ' + t.farmerCap.toLocaleString('en-US') + '. A giant, ' +
    'multi-chain, long-running protocol\'s airdrop is split among many more wallets than a small one\'s. ' +
    'Each row also carries its category\'s median implied value and its rank inside that category, shown in the detail view, ' +
    'so a rank can be read against protocols of its own kind.</p>' +
    '<p><b>Coverage.</b> The board holds ' + D.boardSize + ' protocols that record no token, ' +
    'including every one of the ' + D.watchlistSize + ' watchlist slugs (TVL ≥ $50M, no token on record, not a wrapped, ' +
    'staked or bridged product). The early rows below the floor use the same rule: wrapped, staked and bridged products ' +
    'of tokens that already trade (WBTC is Bitcoin on Ethereum) and versioned pools (names ending in V2, 2.0 and the like) ' +
    'are left out, because they are a release of something else, not a launch of their own. ' +
    'The ' + D.liveSize + ' largest already-trading protocols are shown separately, with the market\'s own numbers.</p>' +
    '<h3>Category multiples learned from this snapshot</h3>' +
    '<table><thead><tr><th>Category</th><th class="num">Traded examples</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' +
    D.multiples.map(function (m) { return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.n + '</td><td class="num">×' + m.ratio.toFixed(3) + '</td></tr>'; }).join('') +
    '</tbody></table>';

  // ---- tabs + events ------------------------------------------------------
  function showView(v) {
    $('view-board').hidden = v !== 'board';
    $('view-live').hidden = v !== 'live';
    $('view-method').hidden = v !== 'method';
    var tabs = document.querySelectorAll('#tabs button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-view') === v);
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
  });
  ['q', 'cat', 'chain', 'sort', 'preset', 'watchonly'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });

  // Hash state, so each screenshot view has its own address:
  //   #slug=<slug> opens that protocol's detail
  //   #cat=<category> filters the board to one category
  //   #view=live | #view=method switches tab
  var h = new URLSearchParams(location.hash.slice(1));
  if (h.get('view')) showView(h.get('view'));
  if (h.get('cat')) { $('cat').value = h.get('cat'); }
  render();
  if (h.get('slug')) showDetail(h.get('slug'));
})();
