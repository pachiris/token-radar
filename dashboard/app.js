// Token Radar (radar-2) dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board with filters, a per-protocol detail view with the model's arithmetic
// and the protocol's farm plan, and the comparables page that prices the board. No network:
// every byte it shows is in data.js. Farm plans are generated here from the same playbook and the
// same row fields the model uses for board.json, so the page and the board tell one story.
'use strict';

const R = window.RADAR;
const main = document.getElementById('board');
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function money(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v}`;
}
const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const mult = (v) => `×${v.toFixed(2)}`;
const chainList = (chains, n) => (chains.length === 0 ? '—' : chains.slice(0, n).join(', ') + (chains.length > n ? ` +${chains.length - n}` : ''));

/* ---------- the farm playbook, the same one lib/model.ts scores board.json with ---------- */
function capitalFor(tvl) { return tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50; }
function holdDaysFor(age) { return age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30; }
const BOOKS = [
  { m: ['lend', 'cdp', 'collateralized'], core: (p, c, ch) => `Supply $${c} of USDC to ${p.name} on ${ch} so the wallet holds a live lending position.`, second: (p) => `Borrow a small amount (under 30% of the supplied value) against the position on ${p.name} and repay it a week later, so both sides of the market record the wallet.`, weekly: 'one supply, borrow or repay action' },
  { m: ['dex', 'derivative', 'perpetual', 'options', 'futures'], core: (p, c, ch) => `Provide $${c} of liquidity to ${p.name}'s most-used pool or vault on ${ch} and keep the position open.`, second: (p) => `Route a few swaps through ${p.name} itself rather than an aggregator, so the wallet's volume is recorded by the protocol.`, weekly: 'one swap or liquidity adjustment' },
  { m: ['bridge'], core: (p, c, ch) => `Bridge $${c} of USDC through ${p.name} to ${ch} and use the bridged funds in one app on the far side.`, second: (p) => `Bridge a smaller amount back through ${p.name} after two weeks, so the wallet shows round-trip use rather than a single pass.`, weekly: 'one bridge transfer in either direction' },
  { m: ['staking', 'restak'], core: (p, c, ch) => `Stake $${c} of the chain's staking asset through ${p.name} on ${ch} and keep the liquid receipt token in the wallet.`, second: (p) => `Use the receipt token from ${p.name} in one integrated app it names, so the position counts as active rather than parked.`, weekly: 'one claim or restake of the rewards' },
  { m: ['curator', 'allocator', 'risk', 'yield', 'farm', 'vault'], core: (p, c, ch) => `Deposit $${c} into a ${p.name} vault on ${ch} and keep the vault shares in the wallet.`, second: (p, c, ch) => `Add a second, smaller deposit to a different ${p.name} vault on ${ch} after two weeks, so the wallet is not riding on one strategy.`, weekly: 'one deposit or share-balance check-in transaction' },
  { m: ['stable'], core: (p, c, ch) => `Mint or deposit $${c} of the stable asset through ${p.name} on ${ch} and hold the balance.`, second: (p) => `Stake part of the stable balance in ${p.name}'s own savings or staking module, if it offers one, and keep the receipt.`, weekly: 'one mint, stake or transfer of the stable asset' },
  { m: ['rwa', 'real world'], core: (p, c, ch) => `Mint $${c} of ${p.name}'s yield asset on ${ch} after its onboarding checks, and hold the position.`, second: (p) => `Complete every verification step ${p.name} offers (account, accreditation or region checks), since a completed profile is what a distribution can be keyed to.`, weekly: 'one yield claim or balance confirmation' },
  { m: ['insurance'], core: (p, c, ch) => `Buy $${c} of cover from ${p.name} on ${ch} for a position you actually hold, and keep the policy to expiry.`, second: (p, c, ch) => `Stake a smaller amount into a ${p.name} cover pool on ${ch} so the wallet appears on both sides of the market.`, weekly: 'one cover renewal check or pool action' },
  { m: ['prediction', 'betting', 'gaming', 'nft', 'launchpad', 'social'], core: (p, c, ch) => `Fund the wallet with $${c} on ${ch} and complete ${p.name}'s core action (a position, a mint or a launch) once, in full.`, second: (p) => `Finish ${p.name}'s profile and any season or quest steps it publishes, since consumer apps key rewards to completed profiles.`, weekly: 'one session that completes a full action, not just a login' },
];
const DEFAULT_BOOK = { core: (p, c, ch) => `Deposit $${c} of USDC into ${p.name} on ${ch} and keep the position open.`, second: (p) => `Repeat the core action on ${p.name} with a smaller amount after two weeks, so the wallet shows a pattern of use, not one visit.`, weekly: 'one deposit, swap or claim' };
function bookFor(category) {
  const c = (category || '').toLowerCase();
  for (const b of BOOKS) if (b.m.some((m) => c.includes(m))) return b;
  return DEFAULT_BOOK;
}
function farmSteps(r) {
  const p = { name: r.name, category: r.category };
  const chain = r.chains.length ? r.chains[0] : 'its main chain';
  const cap = capitalFor(r.tvl_usd);
  const hold = holdDaysFor(r.age_days);
  const book = bookFor(r.category);
  const steps = [
    { text: `Set up a fresh wallet for ${r.name} that holds only the funds you plan to farm, reach the app only from the protocol's own published link, and keep the seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: book.core(p, cap, chain), cost: `$${cap} of capital and about $${cap >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: book.second(p, cap, chain), cost: 'about $3 of gas', time: '10 minutes' },
  ];
  if (r.chains.length > 1) steps.push({ text: `Repeat one qualifying action on ${r.chains[1]}, where ${r.name} also records TVL, so the activity is not confined to a single chain.`, cost: 'about $3 of gas', time: '10 minutes' });
  steps.push(
    { text: `Keep a weekly cadence on ${r.name}: ${book.weekly}, every week, so the wallet reads as a returning user across several snapshots.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days before withdrawing anything, then check the protocol's own points or rewards page and claim only from the link it publishes, never from a message or a search ad.`, cost: `the $${cap} stays in the position, and never pay to claim`, time: `${hold} days, then 10 minutes` },
    { text: `Write the wallet, the dates and every transaction hash in a farm log for ${r.name}, so the position can be repeated, proved or unwound without guesswork.`, cost: 'nothing but the log', time: '5 minutes' },
  );
  return steps.slice(0, 7);
}

/* ---------- shared chrome ---------- */
function header(active) {
  return `<h1>Token Launch Radar</h1>
  <p class="sub">Every protocol in one sealed DefiLlama snapshot that <strong>records no token yet</strong>, ranked by what its
  launch would be worth if its record stayed as it is — priced from the protocols that already trade, never from a guess.
  Snapshot as of <strong>${esc(R.as_of)}</strong>. Model <strong>${esc(R.model_version)}</strong>.</p>
  <div class="chips">
    <span class="chip"><b>${R.universe_size}</b> protocols scanned</span>
    <span class="chip"><b>${R.watchlist_size}</b> on the house watchlist</span>
    <span class="chip"><b>${R.board_size}</b> ranked on the board</span>
    <span class="chip"><b>${R.early_size}</b> early finds below the ${money(R.floor_usd)} floor</span>
    <span class="chip">global median multiple <b>${mult(R.global_multiple)}</b></span>
  </div>
  <p class="sub" style="margin-top:10px">${active === 'board' ? '<strong>Board</strong>' : '<a href="#/">Board</a>'} ·
  ${active === 'comps' ? '<strong>How the prices are set</strong>' : '<a href="#/comps">How the prices are set</a>'} ·
  click any row for its detail view and farm plan</p>`;
}
const FOOTER = `<footer>An implied value is this board's own claim, worked out from the snapshot's figures by the stated formula;
it is not a prediction that a protocol will issue a token, or when, and it is not financial advice. The snapshot records
whether DefiLlama carries a token for a protocol: a protocol said here to record no token may still have one its record
does not carry. Farm plans carry real cost and smart-contract risk; capital figures are sizing examples, not recommendations.
Data: ${esc(R.source)}.</footer>`;

/* ---------- board view ---------- */
const state = { q: '', cat: '', chain: '', watch: false, sort: 'rank' };
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  return { path, params };
}
function filteredRows() {
  let rows = R.rows.filter((r) =>
    (state.cat === '' || (r.category || 'Uncategorised') === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (!state.watch || r.watchlist) &&
    (state.q === '' || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    ratio: (a, b) => b.implied_value_usd / b.tvl_usd - a.implied_value_usd / a.tvl_usd,
  }[state.sort];
  return rows.sort(by);
}
function renderBoard(params) {
  if (params.has('q')) state.q = params.get('q').toLowerCase();
  if (params.has('cat')) state.cat = params.get('cat');
  if (params.has('chain')) state.chain = params.get('chain');
  if (params.has('watch')) state.watch = params.get('watch') === '1';
  if (params.has('sort')) state.sort = params.get('sort');
  const cats = [...new Set(R.rows.map((r) => r.category || 'Uncategorised'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  const rows = filteredRows();
  main.innerHTML = `${header('board')}
  <div class="method">How a price is set: <code>implied = TVL × category multiple × momentum × maturity × breadth</code>.
  The category multiple is the <strong>median market-cap ÷ TVL of the live-token protocols in the same category</strong> in this
  snapshot, shrunk toward the global median when a category has few peers and clamped to ×0.05–×2.50. Momentum reads the
  7-day TVL change, maturity the protocol's age, breadth its chain count. <a href="#/comps">See every category's evidence</a>.</div>
  <form class="filters" id="filters">
    <label>Search<input type="search" id="f-q" value="${esc(state.q)}" placeholder="Name or slug"></label>
    <label>Category<select id="f-cat"><option value="">All categories</option>${cats.map((c) => `<option ${c === state.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label>Chain<select id="f-chain"><option value="">All chains</option>${chains.map((c) => `<option ${c === state.chain ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label>Sort<select id="f-sort">
      <option value="rank" ${state.sort === 'rank' ? 'selected' : ''}>Implied value (rank)</option>
      <option value="tvl" ${state.sort === 'tvl' ? 'selected' : ''}>TVL</option>
      <option value="change" ${state.sort === 'change' ? 'selected' : ''}>7-day TVL change</option>
      <option value="ratio" ${state.sort === 'ratio' ? 'selected' : ''}>Implied ÷ TVL</option></select></label>
    <label class="check"><input type="checkbox" id="f-watch" ${state.watch ? 'checked' : ''}> Watchlist only</label>
  </form>
  <p class="count">${rows.length} of ${R.board_size} protocols shown</p>
  <table><thead><tr><th class="num">#</th><th>Protocol</th><th class="cat">Category</th><th class="chains">Chains</th>
  <th class="num">TVL</th><th class="num">7d</th><th class="num">Implied value</th><th class="num">×TVL</th></tr></thead>
  <tbody>${rows.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="rank">${r.rank}</td>
    <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
    <td class="cat">${esc(r.category || '—')}</td>
    <td class="chains">${esc(chainList(r.chains, 3))}</td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</td>
    <td class="num"><strong>${money(r.implied_value_usd)}</strong></td>
    <td class="num">${mult(r.implied_value_usd / r.tvl_usd)}</td></tr>`).join('')}</tbody></table>
  ${FOOTER}`;
  main.setAttribute('aria-busy', 'false');
  const sync = () => {
    state.q = document.getElementById('f-q').value.toLowerCase();
    state.cat = document.getElementById('f-cat').value;
    state.chain = document.getElementById('f-chain').value;
    state.watch = document.getElementById('f-watch').checked;
    state.sort = document.getElementById('f-sort').value;
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'rank') p.set('sort', state.sort);
    history.replaceState(null, '', `#/${p.toString() ? `?${p}` : ''}`);
    renderBoard(new URLSearchParams());
    document.getElementById('f-q').focus();
  };
  document.getElementById('filters').addEventListener('change', sync);
  document.getElementById('f-q').addEventListener('input', sync);
  main.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/p/${tr.dataset.slug}`; }));
}

/* ---------- detail view ---------- */
function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) { renderBoard(new URLSearchParams()); return; }
  const cat = R.categories.find((c) => c.category === (r.category || 'Uncategorised'));
  const steps = farmSteps(r);
  main.innerHTML = `<p><a href="#/">← Back to the board</a></p>
  <div class="detail-head"><h1>${esc(r.name)}</h1>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : '<span class="badge" style="background:#26221a;color:var(--accent2);border-color:#4a3f22">EARLY FIND</span>'}
  <span class="slug">${esc(r.slug)}</span></div>
  <p class="sub">Rank <strong>#${r.rank}</strong> of ${R.board_size} · ${esc(r.category || 'Uncategorised')} · records no token in the snapshot
  (no market cap, no CoinGecko id, no ticker) · tracked by DefiLlama since ${esc(r.listed_at || 'an unreported date')}.</p>
  <div class="grid">
    <div class="stat"><div class="k">Implied value</div><div class="v">${money(r.implied_value_usd)}</div><div class="n">the board's claim, from the formula below</div></div>
    <div class="stat"><div class="k">TVL</div><div class="v">${money(r.tvl_usd)}</div><div class="n">${pct(r.change_7d)} over 7 days</div></div>
    <div class="stat"><div class="k">Chains</div><div class="v">${r.chains.length}</div><div class="n">${esc(chainList(r.chains, 6))}</div></div>
    <div class="stat"><div class="k">Age</div><div class="v">${r.age_days === null ? '—' : `${r.age_days}d`}</div><div class="n">listed ${esc(r.listed_at || 'unreported')}</div></div>
  </div>
  <h2>Why this value</h2>
  <div class="why">
    <div class="eq">${money(r.tvl_usd)} × ${mult(r.category_multiple)} × ${mult(r.momentum_multiplier)} × ${mult(r.maturity_multiplier)} × ${mult(r.breadth_multiplier)} = ${money(r.implied_value_usd)}</div>
    <table><tbody>
    <tr><td>TVL ${money(r.tvl_usd)}</td><td>The protocol's total value locked in the snapshot, the base every price starts from.</td></tr>
    <tr><td>category multiple ${mult(r.category_multiple)}</td><td>${cat ? `The ${esc(cat.category)} multiple: ${cat.peers} live-token peer${cat.peers === 1 ? '' : 's'} in this snapshot trade at a median market-cap ÷ TVL of ${mult(cat.median_multiple)}, shrunk toward the global median ${mult(R.global_multiple)} to the ${mult(cat.used_multiple)} used here.` : `No live-token peers in its category in this snapshot, so the global median multiple ${mult(R.global_multiple)} prices it.`}</td></tr>
    <tr><td>momentum ${mult(r.momentum_multiplier)}</td><td>Its TVL moved ${pct(r.change_7d)} in the seven days before the snapshot; the model credits 35% of that move, clamped between −50% and +100%.</td></tr>
    <tr><td>maturity ${mult(r.maturity_multiplier)}</td><td>${r.age_days === null ? 'The snapshot reports no listing date, so the model counts it as 365 days old.' : `Tracked for ${r.age_days} days; the factor runs from ×0.75 for a brand-new protocol to ×1.10 at three years.`}</td></tr>
    <tr><td>breadth ${mult(r.breadth_multiplier)}</td><td>Live on ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}; each chain past the first adds 3%, up to seven.</td></tr>
    </tbody></table>
  </div>
  <h2>How to farm it</h2>
  <p class="note">A plan for positioning before any launch, sized from the protocol's own TVL and paced by its age.
  It assumes no points programme exists unless the protocol's own page says so, and it never requires trusting a third-party link.</p>
  <ol class="steps">${steps.map((s) => `<li>${esc(s.text)}<span class="meta">Cost: ${esc(s.cost)} · Time: ${esc(s.time)}</span></li>`).join('')}</ol>
  <h2>The snapshot record</h2>
  <p class="kv">slug ${esc(r.slug)} · category ${esc(r.category || 'null')} · tvl_usd ${r.tvl_usd} · change_7d ${r.change_7d === null ? 'null' : r.change_7d} ·
  mcap_usd null · listed_at ${esc(r.listed_at || 'null')} · gecko_id null · symbol null · chains [${esc(r.chains.join(', '))}]</p>
  ${FOOTER}`;
  main.setAttribute('aria-busy', 'false');
  window.scrollTo(0, 0);
}

/* ---------- comparables view ---------- */
function renderComps() {
  main.innerHTML = `${header('comps')}
  <h2>How the prices are set</h2>
  <p class="note">Every implied value on the board is TVL multiplied by a category multiple read off this snapshot itself:
  for each category, the live-token protocols that already trade give a market-cap ÷ TVL ratio, and the board uses their
  median — shrunk toward the global median (${mult(R.global_multiple)}) by the peer count, <span class="kv">(n × category median + 3 × global median) ÷ (n + 3)</span>,
  then clamped to ×0.05–×2.50. Momentum (7-day TVL change), maturity (age) and breadth (chain count) adjust it per protocol.
  Nothing is priced by hand and no protocol is special-cased.</p>
  <h3>Category evidence</h3>
  <table><thead><tr><th>Category</th><th class="num">Live peers</th><th class="num">Median mcap ÷ TVL</th><th class="num">Multiple used</th><th class="num">Board rows priced</th></tr></thead>
  <tbody>${R.categories.map((c) => `<tr data-cat="${esc(c.category)}"><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${mult(c.median_multiple)}</td><td class="num"><strong>${mult(c.used_multiple)}</strong></td><td class="num">${c.board_rows}</td></tr>`).join('')}</tbody></table>
  <h3>The largest live tokens in the snapshot</h3>
  <p class="note">These already trade, so the board never ranks them; they are part of the evidence above.</p>
  <table><thead><tr><th>Protocol</th><th class="cat">Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap ÷ TVL</th><th class="num">7d</th></tr></thead>
  <tbody>${R.live.map((l) => `<tr><td><span class="pname">${esc(l.name)}</span></td><td class="cat">${esc(l.category || '—')}</td><td class="num">${money(l.tvl_usd)}</td><td class="num">${money(l.mcap_usd)}</td><td class="num">${l.mcap_usd && l.tvl_usd ? mult(l.mcap_usd / l.tvl_usd) : '—'}</td><td class="num ${l.change_7d === null ? '' : l.change_7d >= 0 ? 'up' : 'down'}">${pct(l.change_7d)}</td></tr>`).join('')}</tbody></table>
  ${FOOTER}`;
  main.setAttribute('aria-busy', 'false');
  main.querySelectorAll('tbody tr[data-cat]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/?cat=${encodeURIComponent(tr.dataset.cat)}`; }));
}

/* ---------- router ---------- */
function route() {
  const { path, params } = parseHash();
  if (path === '/comps') renderComps();
  else if (path.startsWith('/p/')) renderDetail(decodeURIComponent(path.slice(3)));
  else renderBoard(params);
}
window.addEventListener('hashchange', route);
route();
