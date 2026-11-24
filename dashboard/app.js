// Token Radar's dashboard, model radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a top-10 highlight, filters, a per-protocol detail view
// with the model's own inputs and the protocol's farm plan, and the model stated in full.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar figure, shortened past a thousand: $12.34B, $5.6M, $123K, or the full figure. */
  function usd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }

  /** A per-cent figure with its sign, two decimals. */
  function pct(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /** An age in days as years past a year, days otherwise, unknown when unlisted. */
  function ageText(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function recompute(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainCount = row.chains && row.chains.length ? row.chains.length : 0;
    var extra = Math.min(Math.max(chainCount - 1, 0), model.diversity_max_extra);
    var diversity = 1 + extra * model.diversity_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * diversity));
  }

  /** Build an element: tag, attributes (class, text, html, on* listeners, the rest as attributes), then children. */
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the gas, the hold and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChain(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function farmCapital(p) {
    var tiers = [[5e9, 250], [1e9, 150], [1e8, 100]];
    for (var i = 0; i < tiers.length; i++) if (p.tvl_usd >= tiers[i][0]) return tiers[i][1];
    return 50;
  }
  function chainGas(chain) {
    var gas = { Ethereum: 12, Bitcoin: 8 };
    return gas[chain] || 1;
  }
  function holdDays(age) {
    if (age == null || age >= 365) return 30;
    return age < 180 ? 60 : 45;
  }
  // One rule of the farm playbook: the category words it answers to, and the three moves it gives.
  var PLAYBOOK = [
    { keys: ['lend', 'cdp', 'collateral'], make: function (name, capital, chain) { return {
      primary: 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and leave it earning.',
      secondary: 'Borrow a small amount against the supply, then repay it, so the position shows both sides of the market.',
      weekly: 'Top up the supply or repay part of the borrow once a week.'
    }; } },
    { keys: ['dex', 'yield', 'leveraged farm', 'liquidity manager'], make: function (name, capital, chain) { return {
      primary: 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position in range.',
      secondary: 'Swap a small amount through the pool so the wallet shows trading as well as liquidity.',
      weekly: 'Collect the fees or rebalance the range once a week.'
    }; } },
    { keys: ['bridge'], make: function (name, capital, chain) { return {
      primary: 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.',
      secondary: 'Bridge a small amount back the other way so the wallet shows a round trip.',
      weekly: 'Move a small amount across the bridge once a week.'
    }; } },
    { keys: ['staking', 'restak'], make: function (name, capital, chain) { return {
      primary: "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.',
      secondary: 'Restake the staking rewards instead of claiming them, so the stake compounds.',
      weekly: 'Check the staking rewards and restake them once a week.'
    }; } },
    { keys: ['perpetual', 'derivative'], make: function (name, capital, chain) { return {
      primary: 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.',
      secondary: 'Close the hedge, then reopen it, so the position shows more than one trade.',
      weekly: 'Adjust the hedge or place one small trade once a week.'
    }; } },
    { keys: ['prediction'], make: function (name, capital, chain) { return {
      primary: 'Fund $' + capital + ' and place one market position on ' + name + '.',
      secondary: 'Settle the first position and place a second one on a different market.',
      weekly: 'Place one new market position a week.'
    }; } },
    { keys: ['curator', 'allocator', 'risk'], make: function (name, capital, chain) { return {
      primary: 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.',
      secondary: 'Deposit a second, smaller amount into a different vault the curator runs.',
      weekly: "Check the vault's yield and rebalance between vaults once a week."
    }; } },
    { keys: ['stable'], make: function (name, capital, chain) { return {
      primary: 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.',
      secondary: "Use the stable asset in one of the protocol's own pools or vaults.",
      weekly: "Move the stable asset through one of the protocol's own features once a week."
    }; } },
    { keys: ['rwa'], make: function (name, capital, chain) { return {
      primary: "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.',
      secondary: 'Check the yield the holding has accrued and record the rate it pays.',
      weekly: 'Top up the holding a little once a week while the yield accrues.'
    }; } },
    { keys: ['insurance'], make: function (name, capital, chain) { return {
      primary: 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.',
      secondary: 'Read the policy terms and check what the cover pays out on.',
      weekly: 'Check the policy and the covered positions once a week.'
    }; } },
    { keys: ['basis'], make: function (name, capital, chain) { return {
      primary: "Deposit $" + capital + " into " + name + "'s basis strategy on " + chain + ' and keep the position.',
      secondary: 'Check the funding rate the strategy earns and record it.',
      weekly: 'Top up or rebalance the basis position once a week.'
    }; } },
    { keys: ['aggregator'], make: function (name, capital, chain) { return {
      primary: 'Deposit $' + capital + ' into ' + name + "'s top vault on " + chain + ' and keep the shares.',
      secondary: 'Move the shares into a second vault the aggregator runs.',
      weekly: 'Harvest the yield or move between vaults once a week.'
    }; } },
    { keys: ['chain'], make: function (name, capital, chain) { return {
      primary: 'Bridge $' + capital + " of USDC onto " + name + "'s chain and use it in one of the chain's own apps.",
      secondary: 'Use the bridged funds in a second app on the same chain.',
      weekly: 'Make one on-chain action a week on the chain.'
    }; } }
  ];
  // A category's play, worded so a farmer can follow it: the first rule whose words match.
  function categoryPlay(p, capital, chain) {
    var cat = (p.category || '').toLowerCase();
    for (var i = 0; i < PLAYBOOK.length; i++) {
      var rule = PLAYBOOK[i];
      if (rule.keys.some(function (k) { return cat.indexOf(k) >= 0; })) return rule.make(p.name, capital, chain);
    }
    return {
      primary: 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.',
      secondary: 'Use a second feature of the protocol with a small amount.',
      weekly: 'Make one qualifying action a week, such as a deposit, a swap or a vote.'
    };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = firstChain(p);
    var second = secondChain(p);
    var capital = farmCapital(p);
    var gas = chainGas(chain);
    var hold = holdDays(p.age_days);
    var play = categoryPlay(p, capital, chain);
    var third = second !== null
      ? { text: 'Repeat the deposit on ' + second + ' as well, with half the capital, so the activity spans two chains.', cost: 'a second deposit of $' + Math.round(capital / 2) + ' and about $' + gas + ' of gas', time: '10 minutes' }
      : { text: play.secondary, cost: 'about $' + gas + ' of gas', time: '10 minutes' };
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: play.primary, cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      third,
      { text: play.weekly, cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: "Open " + p.name + "'s own points or rewards page and note what it counts; if it runs a community channel, join it and read the announcements.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, claim only from the link the protocol itself publishes; never pay to claim, and never follow a link from a direct message.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and plan the unwind: withdraw in the same order you deposited.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  /** The state out of the location hash, so a filtered view or an open protocol is a link. */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var apply = {
      q: function (v) { state.q = v; },
      p: function (v) { state.selected = v; },
      category: function (v) { state.category = v; },
      chain: function (v) { state.chain = v; },
      minTvl: function (v) { state.minTvl = parseInt(v, 10) || 0; },
      scope: function (v) { state.scope = v; },
      tab: function (v) { state.tab = v; }
    };
    Object.keys(apply).forEach(function (key) {
      var v = params.get(key);
      if (v) apply[key](v);
    });
  }

  /** One hash field, set unless it holds its default. */
  function setParam(params, key, value, skip) {
    if (value !== skip && value !== null && value !== undefined) params.set(key, value);
  }

  /** The state back into the location hash, leaving out every default. */
  function writeHash() {
    var params = new URLSearchParams();
    setParam(params, 'q', state.q, '');
    setParam(params, 'category', state.category, 'all');
    setParam(params, 'chain', state.chain, 'all');
    setParam(params, 'minTvl', state.minTvl > 0 ? String(state.minTvl) : '', '');
    setParam(params, 'scope', state.scope, 'all');
    setParam(params, 'tab', state.tab, 'pre-token');
    setParam(params, 'p', state.selected, null);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** The rows the current filters leave standing. */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /** The sort key of a row under the current sort: nulls go last in either direction. */
  function sortKey(r) {
    if (state.sort === 'name') return r.name.toLowerCase();
    if (state.sort === 'tvl') return r.tvl_usd;
    if (state.sort === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (state.sort === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (state.sort === 'chains') return (r.chains || []).length;
    return r.implied_value_usd;
  }

  /** The filtered rows in the current sort order, ties broken by slug. */
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortKey(a);
      var bv = sortKey(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /** The fifteen most common chains on the board, alphabetically, for the chain filter. */
  function topChains() {
    var counts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 15).sort();
  }

  /** The page's masthead: the name, the snapshot date, the source and the model version. */
  function header() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  /** The headline and the four facts that say what the board covers. */
  function lede() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them. Implied value is a model, not a promise: it says what a launch would be worth if the protocol kept running as it is.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
      )
    );
  }

  /** The ten strongest launches, as cards that open the detail view. */
  function top10() {
    var top = DATA.rows.slice(0, 10);
    return h('section', { class: 'top10' },
      h('h2', { text: 'Top 10 by implied value' }),
      h('p', { class: 'sub', text: 'The strongest launches on the board. Select one for its model and farm plan.' }),
      h('div', { class: 'cards' }, top.map(function (r) {
        return h('button', { type: 'button', class: 'card', onclick: function () { openDetail(r.slug); } },
          h('span', { class: 'rank', text: '#' + r.rank }),
          h('b', { text: r.name }),
          h('span', { class: 'implied', text: usd(r.implied_value_usd) }),
          h('span', { class: 'meta', text: usd(r.tvl_usd) + ' TVL · ' + pct(r.change_7d) + ' 7d' })
        );
      }))
    );
  }

  /** One filter field: its label and its control. */
  function field(id, label, control) {
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), control);
  }

  /** A select whose options come from a list, with the current value marked. */
  function optionList(id, label, options, current, allLabel) {
    var select = h('select', { id: id, 'aria-label': label },
      h('option', { value: 'all', text: allLabel }),
      options.map(function (c) { return h('option', { value: c, text: c, selected: c === current ? 'selected' : null }); })
    );
    return select;
  }

  /** The search, the filters and the scope tabs, and the count of rows shown. */
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = topChains();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = optionList('category', 'Filter by category', categories, state.category, 'All categories');
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = optionList('chain', 'Filter by chain', chains, state.chain, 'All chains');
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = h('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      h('option', { value: '0', text: 'Any TVL' }),
      h('option', { value: '100000000', text: '$100M and up' }),
      h('option', { value: '500000000', text: '$500M and up' }),
      h('option', { value: '1000000000', text: '$1B and up' })
    );
    tvlSelect.value = String(state.minTvl);
    tvlSelect.addEventListener('change', function () { state.minTvl = parseInt(tvlSelect.value, 10) || 0; writeHash(); render(); });
    function scopeButton(value, label) {
      return h('button', { type: 'button', 'aria-pressed': state.scope === value ? 'true' : 'false', text: label, onclick: function () { state.scope = value; writeHash(); render(); } });
    }
    function tabButton(value, label) {
      return h('button', { type: 'button', 'aria-pressed': state.tab === value ? 'true' : 'false', text: label, onclick: function () { state.tab = value; render(); } });
    }
    return h('div', { class: 'controls' },
      field('q', 'Search', search),
      field('category', 'Category', catSelect),
      field('chain', 'Chain', chainSelect),
      field('minTvl', 'Minimum TVL', tvlSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Scope' }), h('div', { class: 'tabs' }, scopeButton('all', 'All rows'), scopeButton('watchlist', 'Watchlist only'), scopeButton('early', 'Early only'))),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, tabButton('pre-token', 'Pre-token'), tabButton('live', 'Live token'))),
      h('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  /** A sortable column header: a click sorts by it, a second click reverses it. */
  function sortHeader(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  /** The name cell: the protocol's name and its category, chains and watchlist mark. */
  function nameCell(r) {
    var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
    return h('div', { class: 'name' },
      h('b', { text: r.name }),
      h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chains + (r.on_watchlist ? ' · watchlist' : '') })
    );
  }

  /** One board row: rank, protocol, TVL, growth, age, chains, implied value with its bar, status. */
  function boardRow(r, max) {
    var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return h('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, nameCell(r)),
      h('td', { class: 'num', text: usd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: ageText(r.age_days) }),
      h('td', { class: 'num', text: String((r.chains || []).length) }),
      h('td', null, h('div', { class: 'implied' },
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        h('span', { class: 'num', text: usd(r.implied_value_usd) })
      )),
      h('td', null, h('span', { class: 'status', text: 'no token' }))
    );
  }

  /** The ranked board, or the empty state when no protocol matches the filters. */
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) { tbody.appendChild(boardRow(r, max)); });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  /** The live-token set: protocols that already trade, with their market caps. */
  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: usd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: usd(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  /** The model, stated in full: the formula and what each of its four factors means. */
  function modelPanel() {
    var m = DATA.model;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.diversity_per_chain + ' x min(chains - 1, ' + m.diversity_max_extra + ')) )'
      ),
      h('div', { class: 'factors' },
        h('div', { class: 'factor' }, h('b', { text: 'TVL, the anchor' }), h('span', { text: 'A token launch scales with the value already locked in the protocol: one quarter of TVL.' })),
        h('div', { class: 'factor' }, h('b', { text: 'Growth, the momentum' }), h('span', { text: 'Seven-day TVL growth, capped at +300%: one week is noisy, and a single outlier must not decide the board.' })),
        h('div', { class: 'factor' }, h('b', { text: 'Age, the patience' }), h('span', { text: 'How long the protocol has run with no token, up to three years: time banked as launch optionality.' })),
        h('div', { class: 'factor' }, h('b', { text: 'Chains, the reach' }), h('span', { text: 'Each extra chain is another user base the token would reach, 4% a chain up to five extra chains.' }))
      ),
      h('p', { class: 'sub', text: 'Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every rankable pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown. This is an estimate, not a price, and it says nothing about whether or when a token is issued.' })
    );
  }

  /** The page's footnotes: the snapshot's provenance and the model's one-function claim. */
  function footer() {
    return h('footer', { class: 'foot' },
      h('span', { text: 'Snapshot ' + DATA.as_of + ', DefiLlama protocol index. The board ranks what the snapshot records: a protocol records no token, never that it has none.' }),
      h('span', { text: 'Model ' + DATA.model_version + ': one function, the same for every row. Farm plans are derived from the protocol\u2019s category, chains, TVL and age.' })
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  /** One farm step as a list item: the action bold, the cost and time beside it. */
  function stepItem(s) {
    var at = s.indexOf(' Cost: ');
    var action = at >= 0 ? s.slice(0, at) : s;
    var tail = at >= 0 ? s.slice(at + 1) : '';
    return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
  }

  /** Open the detail view for one protocol: its model inputs and its farm plan. */
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = recompute(row, DATA.model);
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: usd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageText(row.age_days) })),
        h('div', null, h('span', { text: 'Chains' }), h('b', { class: 'num', text: String((row.chains || []).length) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
        h('div', null, h('span', { text: 'Chain multiplier' }), h('b', { class: 'num', text: String(row.diversity_multiplier) })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: usd(row.implied_value_usd) }))
      ),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(stepItem))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /** Rebuild the page from the current state. */
  function render() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(top10());
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
})();
