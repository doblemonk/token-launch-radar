// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail drawer with the
// model's own inputs and the protocol's farm plan. No network: every byte it
// shows is in data.js, and every number comes from that data, never hardcoded.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var PAGE_SIZE = 25;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, page: 1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  // The model in one function (radar-3 CONTRACT, see lib/model.ts): the fitted
  // log-log size curve. The page recomputes a row from the snapshot figures
  // and checks the number board.json carries, so the page's code and the board's
  // data are visibly the same arithmetic.
  function impliedOf(row, model) {
    if (!(row.tvl_usd > 0)) return 1;
    var logImplied = model.intercept + model.slope * Math.log(row.tvl_usd);
    if (!isFinite(logImplied)) return 1;
    return Math.max(1, Math.round(Math.exp(logImplied)));
  }

  // Radar-3 fit data, read from data.js and never hardcoded. The model lane
  // publishes the fitted size curve and the blind-test numbers in RadarData;
  // this gathers them from the fields the model writes, so each panel renders
  // whatever the model provides and stays silent on what it does not.
  function firstNum() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return null;
  }
  function firstVal() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }
  function asTerms(v) {
    if (v === null || v === undefined) return null;
    var arr = Array.isArray(v) ? v : [v];
    arr = arr.map(function (t) { return String(t); }).filter(function (t) { return t.length > 0; });
    return arr.length ? arr : null;
  }
  function fitData() {
    var fit = DATA.fit || {};
    var oos = DATA.oos || fit.oos || {};
    var curve = fit.size_curve || DATA.size_curve || {};
    var m = DATA.model || {};
    var k = firstNum(fit.k, fit.scale, curve.k, curve.coefficient);
    var intercept = firstNum(m.intercept, fit.intercept, fit.size_intercept, curve.intercept, m.size_intercept);
    if (intercept === null && k !== null && k > 0) intercept = Math.log(k);
    return {
      slope: firstNum(m.slope, fit.slope, fit.size_slope, curve.slope, m.size_slope),
      intercept: intercept,
      logTvlMean: firstNum(m.log_tvl_mean, fit.log_tvl_mean, curve.log_tvl_mean),
      nComps: firstNum(m.comp_count, fit.n_comps, fit.n),
      r2: firstNum(fit.r2, fit.r_squared),
      flatErr: firstNum(oos.flat, oos.flat_error, fit.flat_oos, fit.flat_rmse_log, fit.flat_error),
      fittedErr: firstNum(oos.fitted, oos.fitted_error, fit.fitted_oos, fit.fitted_rmse_log, fit.fitted_error),
      flatLoo: firstNum(oos.flat_loo, fit.flat_loo),
      fittedLoo: firstNum(oos.fitted_loo, fit.fitted_loo),
      cutoffs: firstVal(oos.cutoffs, fit.cutoffs),
      errMetric: firstVal(oos.metric, oos.error_metric, fit.oos_metric),
      kept: asTerms(firstVal(oos.kept_terms, fit.kept_terms, m.kept_terms)),
      dropped: asTerms(firstVal(oos.dropped_terms, fit.dropped_terms, m.dropped_terms)),
      refits: firstNum(DATA.rank_range_refits, fit.n_refits, oos.n_refits, DATA.n_refits)
    };
  }
  function hasFit(f) { return f.slope !== null && f.intercept !== null; }
  function sizeValue(tvl, f) {
    if (!hasFit(f)) return tvl * DATA.model.base_multiple;
    return Math.exp(f.intercept + f.slope * (Math.log(tvl) - (f.logTvlMean === null ? 0 : f.logTvlMean)));
  }
  function fmtPerDollar(v) { return '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(3)); }
  // The curve in words, exact: the uncentered exp form when the model publishes
  // no centering constant, else the centered form.
  function curveFormula(f, v) {
    v = v || 'TVL';
    if (f.logTvlMean !== null) return 'exp(' + f.intercept + ' + ' + f.slope + ' x (ln(' + v + ') - ' + f.logTvlMean + '))';
    return 'exp(' + f.intercept + ' + ' + f.slope + ' x ln(' + v + '))';
  }
  // The model's flat multiple, when it publishes one. Never guessed from the
  // shown comps: their median is a top-by-mcap selection, not the baseline.
  function flatMultiple() {
    return firstNum((DATA.fit || {}).flat_multiple, (DATA.oos || {}).flat_multiple, (DATA.model || {}).flat_multiple, (DATA.model || {}).base_multiple);
  }
  function fmtErr(v) {
    if (v >= 100) return String(Math.round(v));
    if (v >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }
  // Whether a model term survived the blind test. No kept list means the model
  // published none, so every term the constants carry is shown.
  function termKept(f, name) {
    if (!f.kept) return true;
    for (var i = 0; i < f.kept.length; i++) {
      if (f.kept[i].toLowerCase().indexOf(name) >= 0) return true;
    }
    return false;
  }
  function maturityKept(f) { return termKept(f, 'maturity') || termKept(f, 'age'); }
  function termsLine(list) { return list ? list.join(', ') : null; }

  // Log-log chart of the live-token comps (dots) and the fitted curve (solid),
  // with the flat multiple (dashed) when the model publishes one. SVG text
  // built from numbers only.
  function fitChart(f) {
    var live = DATA.live.filter(function (r) { return r.tvl_usd > 0 && r.mcap_usd > 0; });
    if (!hasFit(f) || live.length < 3) return null;
    var W = 640, H = 210, PL = 58, PR = 14, PT = 12, PB = 30;
    var xs = live.map(function (r) { return Math.log10(r.tvl_usd); });
    var ys = live.map(function (r) { return Math.log10(r.mcap_usd); });
    var flatMed = flatMultiple();
    var flatOk = flatMed !== null && flatMed > 0;
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var flatY = function (t) { return Math.log10(flatMed * t); };
    var fitY = function (t) { return (f.intercept + f.slope * (Math.log(t) - (f.logTvlMean === null ? 0 : f.logTvlMean))) / Math.LN10; };
    [Math.pow(10, x0), Math.pow(10, x1)].forEach(function (t) {
      y0 = Math.min(y0, Math.floor(fitY(t)));
      y1 = Math.max(y1, Math.ceil(fitY(t)));
      if (flatOk) {
        y0 = Math.min(y0, Math.floor(flatY(t)));
        y1 = Math.max(y1, Math.ceil(flatY(t)));
      }
    });
    if (y1 - y0 < 1) y1 = y0 + 1;
    if (x1 - x0 < 1) x1 = x0 + 1;
    var X = function (lx) { return (PL + (lx - x0) / (x1 - x0) * (W - PL - PR)).toFixed(1); };
    var Y = function (ly) { return (PT + (y1 - ly) / (y1 - y0) * (H - PT - PB)).toFixed(1); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log chart of live-token market cap against TVL, with the fitted size curve' + (flatOk ? ' and the flat multiple' : '') + '">';
    var k;
    for (k = x0; k <= x1; k++) {
      s += '<line x1="' + X(k) + '" y1="' + Y(y0) + '" x2="' + X(k) + '" y2="' + Y(y1) + '" stroke="#e3eae4" stroke-width="1"/>';
      s += '<text x="' + X(k) + '" y="' + (H - 8) + '" font-size="10" fill="#5d6f64" text-anchor="middle">' + fmtUsd(Math.pow(10, k)) + '</text>';
    }
    for (k = y0; k <= y1; k++) {
      s += '<line x1="' + X(x0) + '" y1="' + Y(k) + '" x2="' + X(x1) + '" y2="' + Y(k) + '" stroke="#e3eae4" stroke-width="1"/>';
      s += '<text x="' + (PL - 6) + '" y="' + (+Y(k) + 3) + '" font-size="10" fill="#5d6f64" text-anchor="end">' + fmtUsd(Math.pow(10, k)) + '</text>';
    }
    var pts = [];
    for (var i = 0; i <= 24; i++) {
      var t = Math.pow(10, x0 + (x1 - x0) * i / 24);
      pts.push(X(Math.log10(t)) + ',' + Y(fitY(t)));
    }
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#0a6e4b" stroke-width="2"/>';
    if (flatOk) {
      s += '<line x1="' + X(x0) + '" y1="' + Y(flatY(Math.pow(10, x0))) + '" x2="' + X(x1) + '" y2="' + Y(flatY(Math.pow(10, x1))) + '" stroke="#8ba096" stroke-width="2" stroke-dasharray="5 4"/>';
    }
    live.forEach(function (r) {
      s += '<circle cx="' + X(Math.log10(r.tvl_usd)) + '" cy="' + Y(Math.log10(r.mcap_usd)) + '" r="3" fill="#2c3f34"/>';
    });
    s += '</svg>';
    return s;
  }

  function appendChild(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { appendChild(node, c); }); return; }
    if (typeof child === 'string' || typeof child === 'number') { node.appendChild(document.createTextNode(String(child))); return; }
    node.appendChild(child);
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
    for (var i = 2; i < arguments.length; i++) appendChild(node, arguments[i]);
    return node;
  }

  // Farm plan = the derivation main.ts writes to board.json (radar-3 CONTRACT,
  // see lib/model.ts). Keep these strings identical to the model's. farmPlan
  // computes once; farmSteps is its strings, the detail summary reads the same
  // computation, so the three can never drift apart.
  function usdWhole(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function money(n) { return '$' + n.toFixed(2); }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
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
  var GAS_PER_TX = { Ethereum: 5, Solana: 0.1, Sui: 0.1, Aptos: 0.1, BSC: 0.3, Polygon: 0.2, Arbitrum: 0.5, Optimism: 0.5, Base: 0.5, 'zkSync Era': 0.5, Linea: 0.5, Scroll: 0.5, Blast: 0.5, Mode: 0.5, Mantle: 0.5, Starknet: 0.5, Avalanche: 0.5 };
  function gasPerTx(chain) { return GAS_PER_TX[chain] !== undefined ? GAS_PER_TX[chain] : 1; }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmPlan(p, implied) {
    var chain = chainOf(p);
    var gas = gasPerTx(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weekly = Math.ceil(hold / 7);
    var fullGas = Math.round((weekly + 4) * gas * 100) / 100;
    var coverage = fullGas > 0 ? implied / fullGas : Infinity;
    var verdict = coverage >= 20000 ? 'FARM' : coverage >= 2000 ? 'THIN' : 'SKIP';
    var deposit = verdict === 'THIN' ? Math.max(25, Math.round(capital / 2)) : capital;
    var planGas = verdict === 'THIN' ? Math.round(6 * gas * 100) / 100 : fullGas;
    var ratio = fullGas > 0 ? Math.round(implied / fullGas).toLocaleString('en-US') : 'infinite';
    var action = actionFor(p, deposit, chain);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: '$0.00, no transaction', time: '5 minutes' }
    ];
    if (verdict === 'SKIP') {
      steps.push(
        { text: 'Do not deposit: the verdict below is SKIP, so no position is funded and no capital leaves the wallet.', cost: '$0.00, no deposit', time: '0 minutes' },
        { text: 'No weekly actions: the position was never funded, so there is nothing to qualify.', cost: '$0.00, no gas', time: '0 minutes' },
        { text: 'Nothing is locked: no capital left the wallet, so there is no hold to wait out.', cost: '$0.00 locked', time: '0 days' },
        { text: 'No claim to check: nothing was farmed, so there is no points page to watch.', cost: '$0.00, nothing to claim', time: '0 minutes' },
        { text: 'Log the skip: write the protocol, the date and the reason in a farm log, and check the plan again if its implied value rises.', cost: '$0.00, nothing but the log', time: '5 minutes' },
        { text: 'Net: ' + money(0) + ' spent, ' + usdWhole(0) + ' locked, 0 days held. Implied value ' + usdWhole(implied) + ' — the gas the plan would have cost, ' + money(fullGas) + ', is 1 in ' + ratio + ' of it. Verdict: SKIP — the value at stake does not cover the cost of farming it.', cost: money(0) + ' total', time: '0 minutes' }
      );
      return { steps: steps.map(stepText), verdict: verdict, deposit: 0, gas: gas, hold: 0, weekly: 0, fullGas: fullGas, planGas: 0, ratio: ratio };
    }
    steps.push({ text: action, cost: usdWhole(deposit) + ' of capital and about ' + money(2 * gas) + ' of gas (2 transactions)', time: '15 minutes to set up' });
    if (verdict === 'THIN') {
      steps.push({ text: 'Make two qualifying actions in the first 30 days, such as a deposit, a borrow, a swap or a vote, then stop: a thin position does not pay for weekly transactions.', cost: 'about ' + money(2 * gas) + ' of gas in total', time: '10 minutes each' });
    } else {
      steps.push({ text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, for ' + weekly + ' actions over ' + hold + ' days.', cost: 'about ' + money(weekly * gas) + ' of gas in total', time: '10 minutes a week' });
    }
    steps.push(
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the ' + usdWhole(deposit) + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'nothing to check, about ' + money(gas) + ' of gas to claim', time: '10 minutes' },
      { text: 'Withdraw the ' + usdWhole(deposit) + ' and write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'about ' + money(gas) + ' of gas to exit', time: '10 minutes' },
      { text: verdict === 'THIN'
        ? 'Net: ' + money(planGas) + ' of gas spent, ' + usdWhole(deposit) + ' of capital returned on exit, ' + hold + ' days locked. Implied value ' + usdWhole(implied) + " — the full plan's gas bill, " + money(fullGas) + ', is 1 in ' + ratio + ' of it, so the deposit was halved and the weekly actions cut to two. Verdict: THIN — farm it small.'
        : 'Net: ' + money(planGas) + ' of gas spent, ' + usdWhole(deposit) + ' of capital returned on exit, ' + hold + ' days locked. Implied value ' + usdWhole(implied) + ' — the gas bill is 1 in ' + ratio + ' of it. Verdict: FARM.', cost: money(planGas) + ' total', time: hold + ' days' }
    );
    return { steps: steps.map(stepText), verdict: verdict, deposit: deposit, gas: gas, hold: hold, weekly: weekly, fullGas: fullGas, planGas: planGas, ratio: ratio };
  }
  function farmSteps(p) { return farmPlan(p, p.implied_value_usd).steps; }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir')) state.dir = params.get('dir') === '1' ? 1 : -1;
    if (params.get('page')) state.page = Math.max(1, parseInt(params.get('page'), 10) || 1);
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir !== -1) params.set('dir', String(state.dir));
    if (state.page !== 1) params.set('page', String(state.page));
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function categoryList() {
    return Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  }
  function chainList() {
    var counts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); }).slice(0, 12)
      .map(function (c) { return { name: c, count: counts[c] }; });
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
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
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name' }, el('b', { text: 'Token' }), ' Radar')),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var top = DATA.rows.slice(0, 3);
    var topLine = top.map(function (r, i) {
      return el('span', null, '#' + (i + 1) + ' ', el('b', { text: r.name }), ' ', el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
    });
    var joined = [];
    topLine.forEach(function (piece, i) { if (i > 0) joined.push('  ·  '); joined.push(piece); });
    return el('section', { class: 'lede' },
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      el('p', { class: 'standfirst', text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' }),
      el('p', { class: 'top3' }, 'Top of the board: ', joined),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist protocols covered' })),
        el('div', { class: 'fact' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows scored' })),
        el('div', { class: 'fact' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'Early rows below the floor' })),
        el('div', { class: 'fact' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'Live-token protocols set aside' }))
      ),
      fitStrip()
    );
  }

  // One-line summary of the radar-3 model, above the board so the first
  // screenshot shows it. Renders nothing until the model publishes the fit.
  function fitStrip() {
    var f = fitData();
    var bits = [];
    if (hasFit(f)) {
      var dir = f.slope < 0.98 ? 'a flat multiple overstates the biggest protocols' : f.slope > 1.02 ? 'a flat multiple understates the biggest protocols' : 'close to a flat multiple';
      bits.push(el('span', null, 'Fitted size curve: implied = ', el('b', { class: 'num', text: curveFormula(f) }), ' — ' + dir + '.'));
    }
    var loo = f.flatLoo !== null && f.fittedLoo !== null;
    var pair = loo ? { flat: f.flatLoo, fitted: f.fittedLoo, label: 'leave-one-out' } : (f.flatErr !== null && f.fittedErr !== null ? { flat: f.flatErr, fitted: f.fittedErr, label: 'walk-forward' } : null);
    if (pair) {
      var win = pair.fitted < pair.flat ? 'the fitted curve wins' : pair.fitted > pair.flat ? 'the flat multiple wins' : 'a dead heat';
      bits.push(el('span', null, 'Blind test (' + pair.label + '): fitted ', el('b', { class: 'num', text: fmtErr(pair.fitted) }), ' vs flat ', el('b', { class: 'num', text: fmtErr(pair.flat) }), (f.errMetric ? ' (' + f.errMetric + ')' : '') + ' — ' + win + '.'));
    }
    if (!bits.length) return null;
    return el('div', { class: 'fit-strip' }, bits);
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.page = 1; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categoryList().map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; state.page = 1; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chainList().map(function (c) { return el('option', { value: c.name, text: c.name + ' (' + c.count + ')', selected: c.name === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; state.page = 1; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; state.page = 1; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; state.page = 1; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', id: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows match' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } state.page = 1; writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function pager(list) {
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = list.length === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
    var end = Math.min(list.length, state.page * PAGE_SIZE);
    var btns = [];
    var nums = [];
    for (var p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - state.page) <= 2) nums.push(p);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    nums.forEach(function (p) {
      if (p === '…') { btns.push(el('span', { class: 'of', text: '…' })); return; }
      btns.push(el('button', {
        type: 'button', 'aria-current': p === state.page ? 'page' : null, text: String(p),
        onclick: (function (page) { return function () { state.page = page; writeHash(); render(); }; })(p)
      }));
    });
    return el('div', { class: 'pager' },
      el('span', { class: 'of', text: 'Rows ' + start + '–' + end + ' of ' + list.length }),
      el('div', { class: 'pages' },
        el('button', { type: 'button', disabled: state.page <= 1 ? 'disabled' : null, text: '‹ Prev', onclick: function () { if (state.page > 1) { state.page--; writeHash(); render(); } } }),
        btns,
        el('button', { type: 'button', disabled: state.page >= pages ? 'disabled' : null, text: 'Next ›', onclick: function () { if (state.page < pages) { state.page++; writeHash(); render(); } } })
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.page = 1; writeHash(); render(); } })
      ));
    }
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var pageRows = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    var tbody = el('tbody');
    pageRows.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'class': r.rank === 1 ? 'top1' : r.rank === 2 ? 'top2' : r.rank === 3 ? 'top3' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      ),
      pager(list)
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'rank-badge', text: 'live' })),
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
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The formula as the model publishes it: fitted size term when the model fits
  // one, else the flat multiple; growth/maturity only when the blind test kept
  // them (no kept list means the model published none).
  function formulaText() {
    var m = DATA.model, f = fitData();
    if (hasFit(f)) {
      var s = 'implied = max(1, round( ' + curveFormula(f, 'tvl_usd') + ' ))';
      if (termKept(f, 'growth') && typeof m.growth_weight === 'number') s += ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')';
      if (maturityKept(f) && typeof m.maturity_floor === 'number') s += ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')';
      return s;
    }
    return 'implied = max(1, round( tvl_usd x ' + m.base_multiple + ' ))';
  }

  function fitSection(f) {
    if (!hasFit(f)) return null;
    var chart = fitChart(f);
    if (!chart) return null;
    var flatMed = flatMultiple();
    var stats = [];
    if (f.nComps !== null) stats.push(f.nComps + ' live-token comps');
    stats.push('implied = ' + curveFormula(f));
    if (f.r2 !== null) stats.push('R² ' + f.r2.toFixed(2));
    var slopeNote = f.slope < 0.98
      ? 'Value grows more slowly than TVL, so a flat multiple overstates the biggest protocols and understates the small ones.'
      : f.slope > 1.02
      ? 'Value grows faster than TVL, so a flat multiple understates the biggest protocols.'
      : 'Value grows about in step with TVL, so the fitted curve sits close to the flat multiple.';
    return [
      el('h3', { text: 'The fitted size curve' }),
      el('p', { text: 'The flat multiple assumed every dollar of TVL was worth the same. The comps say otherwise: the curve below is fitted to the live-token protocols in this snapshot, log market cap on log TVL. ' + slopeNote }),
      el('div', { class: 'fit-chart', html: chart }),
      el('div', { class: 'fit-legend' },
        el('span', null, el('i', { class: 'dot' }), 'live comps shown (' + DATA.live.length + ', top by market cap)'),
        el('span', null, el('i', null), 'fitted curve'),
        flatMed !== null ? el('span', null, el('i', { class: 'flat' }), 'flat multiple ' + fmtPerDollar(flatMed) + ' per TVL $') : null
      ),
      el('p', { class: 'fit-note', text: 'Fit: ' + stats.join(' · ') + '.' })
    ];
  }

  function oosSection(f) {
    var loo = f.flatLoo !== null && f.fittedLoo !== null;
    var wf = f.flatErr !== null && f.fittedErr !== null;
    var keptLine = termsLine(f.kept), droppedLine = termsLine(f.dropped);
    if (!loo && !wf && !keptLine && !droppedLine) return null;
    var out = [el('h3', { text: 'Out-of-sample test' })];
    if (loo || wf) {
      var metric = f.errMetric ? ' (' + f.errMetric + ', lower is better)' : ' (lower is better)';
      out.push(el('p', { text: 'Out-of-sample means comps the fit never saw, so a curve that merely memorised its comps scores badly here. Flat multiple against fitted curve' + metric + ':' }));
      var tests = [];
      if (loo) tests.push({ name: 'Leave-one-out', flat: f.flatLoo, fitted: f.fittedLoo });
      if (wf) tests.push({ name: 'Walk-forward', flat: f.flatErr, fitted: f.fittedErr });
      out.push(el('table', { class: 'oos' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', text: 'Flat multiple' }), el('th', { scope: 'col', text: 'Fitted curve' }))),
        el('tbody', null, tests.map(function (t) {
          return el('tr', null,
            el('td', { text: t.name }),
            el('td', { class: 'num', text: fmtErr(t.flat) }),
            el('td', { class: 'num' + (t.fitted < t.flat ? ' win' : ''), text: fmtErr(t.fitted) }));
        }))
      ));
      if (wf && f.cutoffs) out.push(el('p', { class: 'fit-note', text: 'Walk-forward cutoffs: ' + (Array.isArray(f.cutoffs) ? f.cutoffs.join(', ') : String(f.cutoffs)) + '.' }));
    }
    var terms = [];
    if (keptLine) terms.push('Kept: ' + keptLine);
    if (droppedLine) terms.push('Dropped: ' + droppedLine);
    if (terms.length) out.push(el('p', { class: 'fit-note', text: 'Blind test on the model terms — ' + terms.join(' · ') + '. A dropped term is left out of the formula above.' }));
    return out;
  }

  function modelPanel() {
    var m = DATA.model, f = fitData();
    var explain = 'TVL comes from the snapshot.';
    if (typeof m.growth_weight === 'number' && termKept(f, 'growth')) explain += ' Seven-day growth moves the value up or down from the size curve.';
    if (typeof m.maturity_floor === 'number' && maturityKept(f)) explain += ' Age is the time since the protocol was first listed, the best record of how long it has run with no token' + (typeof m.unknown_age_days === 'number' ? '; an unlisted age uses ' + m.unknown_age_days + ' days.' : '.');
    else explain += ' Age is recorded on every row and sets the farm plan\u2019s hold length; it is not a value term.';
    explain += ' The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.';
    var children = [
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: formulaText() }),
      el('p', { text: explain })
    ];
    var fit = fitSection(f);
    if (fit) children = children.concat(fit);
    var oos = oosSection(f);
    if (oos) children = children.concat(oos);
    return el('section', { class: 'panel model' }, children);
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · Model ' + DATA.model_version + ' · Board of ' + DATA.board_size + ' pre-token protocols.' }),
      el('p', { class: 'fine', text: 'Implied value is this entry\u2019s model, not a promise and not a price. \u201CRecords no token\u201D means the snapshot\u2019s record lists no token; it is not proof the protocol has none.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  // Growth and age are not value terms in radar-3 (the blind test dropped them),
  // so the size curve alone explains a row's rank.
  function driverNote(row) {
    if (row.tvl_usd > 0) return 'The fitted size curve alone sets the ranking: at ' + fmtUsd(row.tvl_usd) + ' of TVL it pays ' + fmtPerDollar(row.implied_value_usd / row.tvl_usd) + ' per TVL dollar.';
    return 'The fitted size curve alone sets the ranking.';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var plan = farmPlan(row, row.implied_value_usd);
    var steps = plan.steps;
    var recomputed = impliedOf(row, DATA.model);
    var match = recomputed === row.implied_value_usd;
    var f = fitData();
    // Rank range from the model's refits, beside the rank, in plain words.
    var rankNote = null;
    if (typeof row.rank_low === 'number' && typeof row.rank_high === 'number') {
      var refits = f.refits !== null ? ' across ' + f.refits + ' refits' : ' across refits';
      rankNote = row.rank_low === row.rank_high
        ? 'holds rank ' + row.rank_low + refits
        : 'usually rank ' + row.rank_low + '–' + row.rank_high + refits;
    }
    // The equation shows only the terms the row carries; the fitted size curve
    // gets one row of its own.
    var eqRows = [['TVL', fmtUsd(row.tvl_usd)]];
    if (hasFit(f)) eqRows.push(['Size curve', curveFormula(f) + ' = ' + fmtUsd(sizeValue(row.tvl_usd, f))]);
    if (typeof row.growth_multiplier === 'number') {
      eqRows.push(['Seven-day growth', fmtPct(row.change_7d)]);
      eqRows.push(['Growth multiplier', String(row.growth_multiplier)]);
    }
    if (typeof row.maturity_multiplier === 'number') {
      eqRows.push(['Age with no token', fmtAge(row.age_days)]);
      eqRows.push(['Maturity multiplier', String(row.maturity_multiplier)]);
    }
    var eqDivs = eqRows.map(function (r) {
      return el('div', null, el('span', { text: r[0] }), el('b', { class: 'num', text: r[1] }));
    });
    eqDivs.push(el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })));
    var rangeNote = null;
    if (typeof row.rank_low === 'number' && typeof row.rank_high === 'number') {
      rangeNote = 'The rank comes from one fit. Refit the curve and this protocol lands between rank ' + row.rank_low + ' and rank ' + row.rank_high + ' — ' + (row.rank_high - row.rank_low <= 2 ? 'a narrow range means this rank is solid.' : 'a wide range means its neighbours could swap places.');
    }
    // Netted cost, from the same computation as the steps: deposit returns on
    // exit, gas does not. The verdict is the plan's own.
    var netImplied = row.implied_value_usd - plan.planGas;
    var costChips = [
      el('span', { text: usdWhole(plan.deposit) + ' deposit' + (plan.verdict === 'THIN' ? ' (halved)' : plan.verdict === 'SKIP' ? ' (none)' : '') }),
      el('span', { text: money(plan.planGas) + ' gas total' }),
      el('span', { text: plan.verdict === 'SKIP' ? '0 days held' : 'hold ' + plan.hold + ' days' }),
      el('span', { text: 'gas 1 in ' + plan.ratio + ' of implied' }),
      el('span', { text: 'net implied ' + fmtUsd(netImplied) }),
      el('span', { class: 'verdict', text: 'verdict: ' + plan.verdict })
    ];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (rankNote ? ' · ' + rankNote : '') + ' · records no token' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' · listed ' + row.listed_at : '') + (typeof row.age_days === 'number' ? ' · ' + fmtAge(row.age_days) + ' with no token' : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' }, eqDivs),
      el('p', { class: 'check ' + (match ? 'ok' : 'bad'), text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (match ? ' — the same number the board carries.' : ' — which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'driver', text: driverNote(row) }),
      rangeNote ? el('p', { class: 'driver range-note', text: rangeNote }) : null
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'plan-sum' }, costChips),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        var chips = [];
        var costAt = tail.indexOf(' Time: ');
        if (costAt >= 0) {
          chips.push(el('span', { class: 'chip', text: tail.slice(0, costAt) }));
          chips.push(el('span', { class: 'chip', text: tail.slice(costAt + 1) }));
        } else if (tail) {
          chips.push(el('span', { class: 'chip', text: tail }));
        }
        return el('li', null, el('b', { text: action }), el('span', { class: 'chips' }, chips));
      })),
      el('p', { class: 'net-line', text: plan.verdict === 'SKIP'
        ? 'Nothing is funded: $0.00 spent, $0 locked, 0 days held. The gas the plan would have cost (' + money(plan.fullGas) + ') is 1 in ' + plan.ratio + ' of the modelled ' + fmtUsd(row.implied_value_usd) + ' — too dear for the value at stake, so this one is a skip, not a farm.'
        : 'Net: ' + money(plan.planGas) + ' of gas spent, ' + usdWhole(plan.deposit) + ' of capital returned on exit, ' + plan.hold + ' days locked. The gas is 1 in ' + plan.ratio + ' of the modelled ' + fmtUsd(row.implied_value_usd) + ' — the deposit comes back, the gas does not, and the net implied value is ' + fmtUsd(netImplied) + ', if the token ever exists.' })
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
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
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
  // A hash change without a reload (back/forward, or a fresh #p= link) re-reads
  // the state and re-renders; writeHash uses replaceState, so it never fires this.
  window.addEventListener('hashchange', function () {
    state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, page: 1, selected: null };
    readHash();
    render();
  });
})();
