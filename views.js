/* ---------- Tabs ---------- */
(() => {
  const show = (id, link) => {
    document.querySelectorAll('.lm-panel').forEach((s) => { s.hidden = s.id !== id; });
    document.querySelectorAll('.lm-tab').forEach((t) => {
      const on = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.classList.toggle('is-on', on);
      t.tabIndex = on ? 0 : -1;
    });
    if (link) dash.setLink(id);
  };
  document.querySelectorAll('.lm-tab').forEach((t) => t.addEventListener('click', () => show(t.getAttribute('aria-controls'), true)));
  const startTab = ['explore', 'about-data'].find((id) => location.hash === '#' + id);
  if (startTab) show(startTab, false);
  window.addEventListener('beforeprint', () => { document.querySelectorAll('.lm-panel').forEach((s) => { s.hidden = false; }); });
  window.addEventListener('afterprint', () => {
    const on = document.querySelector('.lm-tab[aria-selected="true"]');
    show(on ? on.getAttribute('aria-controls') : 'market', false);
  });
})();

/* ---------- Survey ---------- */
(() => {
  const read = () => {
    const ans = AX.answers();
    const pay = [];
    document.querySelectorAll('#survey input[name="pay"]').forEach((i) => { if (i.checked) pay.push(i.value); });
    const pick = (name, fallback) => { const i = document.querySelector(`#survey input[name="${name}"]:checked`); return i ? i.value : fallback; };
    return {pay, aud: pick('aud', ans.aud), reach: pick('reach', ans.reach), medicare: pick('medicare', ans.medicare), area: pick('area', ans.area)};
  };
  document.querySelectorAll('#survey input').forEach((i) => {
    i.addEventListener('change', () => {
      const ans = read();
      dash.setParams({pay: ans.pay, aud: ans.aud, reach: ans.reach, medicare: ans.medicare, area: ans.area, mix: AX.surveyMix(ans), county: ''});
    });
  });
  dash.onData(() => {
    const ans = AX.answers();
    document.querySelectorAll('#survey input').forEach((i) => {
      i.checked = i.name === 'pay' ? ans.pay.includes(i.value) : ans[i.name] === i.value;
    });
    document.querySelectorAll('#q-medicare').forEach((q) => { const hide = !ans.pay.includes('medicare'); if (q.hidden !== hide) q.hidden = hide; });
  });
})();

/* ---------- Results appear after "Show my best markets" ---------- */
document.querySelectorAll('#lm-show').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#results').forEach((r) => { r.hidden = false; });
  document.querySelectorAll('#reveal-row').forEach((r) => { r.hidden = true; });
  const target = document.getElementById('score-step');
  if (target) target.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
}));
// Start loading the ranking and map data while the reader answers, so results show quickly.
dash.onData(() => { dash.data('market_summary'); dash.data('county_shapes'); });
window.addEventListener('beforeprint', () => { document.querySelectorAll('#results').forEach((r) => { r.hidden = false; }); });

/* ---------- Launch market: controls ---------- */
document.querySelectorAll('#lm-floor').forEach((s) => {
  s.value = String(dash.params().mfloor ?? 1000);
  s.addEventListener('change', () => dash.setParams({mfloor: Number(s.value)}));
});
document.querySelectorAll('#lm-large').forEach((box) => {
  box.addEventListener('change', () => { window.AX.mlarge = box.checked; dash.draw('market-body'); });
});
dash.draw('age-label', (el) => { el.textContent = AX.ageText(AX.aud()); });

dash.draw('state-select', (sel) => {
  const c = dash.data('counties');
  if (c.status !== 'ok') { sel.replaceChildren(); return; }
  const states = Array.from(new Map(c.data.filter((r) => r.census_match).map((r) => [r.state, r.state_name])).entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  // Rebuild the list only when it changes, so a redraw never closes the dropdown while it's open.
  const key = states.map(([st]) => st).join(',');
  if (AX.stateKey !== key || sel.options.length !== states.length + 1) {
    sel.replaceChildren(new Option('All states', ''), ...states.map(([st, name]) => new Option(name, st)));
    AX.stateKey = key;
  }
  const want = dash.params().state || '';
  if (sel.value !== want) sel.value = want;
  sel.onchange = () => dash.setParams({state: sel.value});
});

dash.draw('score-bullets', (ul) => {
  const fc = dash.data('factors');
  if (fc.status !== 'ok') { ul.replaceChildren(); return; }
  const byId = new Map(fc.data.map((f) => [f.id, f]));
  const on = AX.mixItems().filter((it) => it.weight > 0 && byId.has(it.id));
  const share = AX.shares(on);
  if (!on.length) {
    const li = document.createElement('li');
    li.textContent = 'No factors yet. Answer the questions above, or add a factor below.';
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(...on.sort((a, b) => b.weight - a.weight).map((it) => {
    const f = byId.get(it.id);
    const li = document.createElement('li');
    const meta = document.createElement('span');
    meta.className = 'lm-score-meta';
    const alt = AX.fillAge(it.id, it.age);
    meta.textContent = `: ${share.get(it)}% of score \u00b7 ${AX.WEIGHT[it.weight]} \u00b7 ${it.low ? 'less is better' : 'more is better'}`
      + (alt ? ` \u00b7 ${AX.ageText(alt)} figure where Urban has no ${AX.ageText(it.age)} one` : '');
    li.append(AX.mark('b', AX.factorName(f, it), 'factors', 'label', 'id=' + f.id), meta);
    return li;
  }));
});

dash.draw('recipe', {
  mount: (el) => {
    const list = document.createElement('div');
    list.className = 'lm-items';
    const add = document.createElement('div');
    add.className = 'lm-add';
    el.replaceChildren(list, add);
    return {list, add, built: false};
  },
  update: (el, made) => {
    const fc = dash.data('factors');
    if (fc.status !== 'ok') { AX.empty(made.list, fc.status); return; }
    const byId = new Map(fc.data.map((f) => [f.id, f]));
    const items = AX.mixItems().filter((it) => byId.has(it.id));
    const save = (next) => dash.setParams({mix: AX.mixString(next)});
    const share = AX.shares(items);
    made.list.replaceChildren(...items.map((it, idx) => {
      const f = byId.get(it.id);
      const row = document.createElement('div');
      row.className = 'lm-item';
      const text = document.createElement('div');
      text.className = 'lm-item-text';
      const name = AX.mark('span', AX.factorName(f, it), 'factors', 'label', 'id=' + f.id);
      const meta = document.createElement('span');
      meta.className = 'lm-item-meta';
      meta.textContent = `${it.low ? 'Less is better' : 'More is better'} · ${f.source}, ${String(f.year).replace('-', '–')}${AX.UNIT[f.unit] ? ' ·' + AX.UNIT[f.unit] : ''}`;
      text.append(name, meta);
      const sel = document.createElement('select');
      sel.className = 'dash-select';
      sel.id = 'lm-w-' + AX.mixKey(it) + (it.low ? '-low' : '');
      sel.setAttribute('aria-label', 'Weight for ' + AX.factorName(f, it));
      AX.WEIGHT.forEach((label, w) => sel.append(new Option(label, String(w))));
      sel.value = String(it.weight);
      sel.onchange = () => save(items.map((x, j) => (j === idx ? {...x, weight: Number(sel.value)} : x)));
      const pct = document.createElement('span');
      pct.className = 'lm-item-share';
      pct.textContent = it.weight > 0 ? `${share.get(it)}% of score` : 'not counted';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'lm-btn';
      rm.textContent = 'Remove';
      rm.setAttribute('aria-label', 'Remove ' + AX.factorName(f, it));
      rm.onclick = () => save(items.filter((x, j) => j !== idx));
      row.append(text, sel, pct, rm);
      return row;
    }));
    if (!items.length) made.list.replaceChildren(AX.mark('p', 'No factors yet. Answer the questions above, or add one below.'));

    if (made.built) return;
    made.built = true;
    const field = (labelText, id, control, cls) => {
      const d = document.createElement('div');
      d.className = 'ax-field' + (cls ? ' ' + cls : '');
      const l = document.createElement('label');
      l.htmlFor = id;
      l.textContent = labelText;
      control.id = id;
      d.append(l, control);
      return d;
    };
    const title = document.createElement('p');
    title.className = 'lm-add-title';
    title.textContent = 'Add a factor';
    const fsel = document.createElement('select');
    fsel.className = 'dash-select';
    fsel.append(new Option('Choose a factor', ''));
    d3.groups(fc.data, (f) => f.group).forEach(([g, fs]) => {
      const og = document.createElement('optgroup');
      og.label = g;
      fs.forEach((f) => og.append(new Option(f.label.replace('{age}', '(by age)'), f.id)));
      fsel.append(og);
    });
    const asel = document.createElement('select');
    asel.className = 'dash-select';
    const dsel = document.createElement('select');
    dsel.className = 'dash-select';
    dsel.append(new Option('More is better', 'high'), new Option('Less is better', 'low'));
    const wsel = document.createElement('select');
    wsel.className = 'dash-select';
    AX.WEIGHT.slice(1).forEach((label, k) => wsel.append(new Option(label, String(k + 1))));
    wsel.value = '2';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lm-btn lm-btn-primary';
    btn.textContent = 'Add';
    const ageField = field('Age group', 'lm-add-age', asel);
    const setAges = () => {
      const f = byId.get(fsel.value);
      const list = f && f.ages ? String(f.ages).split(', ') : [];
      asel.replaceChildren(...list.map((a) => new Option(AX.ageLabel(a), a)));
      if (f && f.ages) {
        const a = AX.aud();
        const pref = f.source === 'Urban Institute' ? AX.urbanAge(f.id, a) : a;
        if (list.includes(pref)) asel.value = pref;
      }
      ageField.hidden = list.length < 2;
      btn.disabled = !f;
    };
    fsel.onchange = setAges;
    btn.onclick = () => {
      const f = byId.get(fsel.value);
      if (!f) return;
      const it = {id: f.id, age: f.ages && asel.value ? asel.value : 'All', low: dsel.value === 'low', weight: Number(wsel.value)};
      const cur = AX.mixItems().filter((x) => byId.has(x.id));
      const at = cur.findIndex((x) => x.id === it.id && x.age === it.age);
      if (at >= 0) cur[at] = it; else cur.push(it);
      save(cur);
      fsel.value = '';
      setAges();
    };
    made.add.replaceChildren(title, field('Factor', 'lm-add-factor', fsel, 'ax-field-factor'), ageField, field('Counts as', 'lm-add-dir', dsel), field('Weight', 'lm-add-weight', wsel), btn);
    setAges();
  },
});

/* ---------- County search above the map ---------- */
// Typed text and the open list live here; the list itself is the "county-results" drawing.
Object.assign(window.AX, {cq: '', cqOpen: false, cqActive: 0, cqMatches: []});
dash.draw('county-results', (box) => {
  const rk = dash.data('ranked_market');
  const q = (AX.cq || '').trim().toLowerCase();
  if (!AX.cqOpen || !q || rk.status !== 'ok' || !rk.data) { AX.cqMatches = []; box.replaceChildren(); return; }
  const name = (r) => `${r.county}, ${r.state}`;
  const starts = [], has = [];
  for (const r of rk.data) {
    const n = name(r).toLowerCase();
    if (n.startsWith(q)) starts.push(r); else if (n.includes(q)) has.push(r);
    if (starts.length >= 8) break;
  }
  const list = [...starts, ...has].slice(0, 8);
  AX.cqMatches = list;
  if (!list.length) {
    const none = document.createElement('p');
    none.className = 'lm-county-none';
    none.textContent = 'No ranked county matches. Check the spelling, pick all states, or lower the minimum number of residents.';
    box.replaceChildren(none);
    return;
  }
  if (AX.cqActive >= list.length) AX.cqActive = 0;
  box.replaceChildren(...list.map((r, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'lm-county-opt-' + k;
    b.className = 'lm-county-opt' + (k === AX.cqActive ? ' is-active' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', k === AX.cqActive ? 'true' : 'false');
    const n = document.createElement('span');
    n.textContent = name(r);
    const sc = document.createElement('span');
    sc.className = 'lm-county-score';
    sc.append('Fit ', AX.mark('span', String(r.score), 'ranked_market', 'score', 'geoid=' + r.geoid));
    b.append(n, sc);
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => AX.pickCounty(r);
    return b;
  }));
});
(() => {
  const inputs = () => document.querySelectorAll('#lm-county');
  const setOpen = (open) => {
    AX.cqOpen = open;
    inputs().forEach((i) => i.setAttribute('aria-expanded', open && AX.cq.trim() ? 'true' : 'false'));
    dash.draw('county-results');
  };
  AX.pickCounty = (r) => {
    inputs().forEach((i) => { i.value = `${r.county}, ${r.state}`; });
    AX.cq = '';
    setOpen(false);
    dash.setParams({county: r.geoid});
  };
  inputs().forEach((inp) => {
    inp.addEventListener('input', () => { AX.cq = inp.value; AX.cqActive = 0; setOpen(true); });
    inp.addEventListener('blur', () => setOpen(false));
    inp.addEventListener('keydown', (e) => {
      const n = AX.cqMatches.length;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); inp.blur(); }
      else if (e.key === 'ArrowDown' && n) { e.preventDefault(); AX.cqOpen = true; AX.cqActive = (AX.cqActive + 1) % n; setOpen(true); }
      else if (e.key === 'ArrowUp' && n) { e.preventDefault(); AX.cqActive = (AX.cqActive - 1 + n) % n; setOpen(true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (AX.cqOpen && n) AX.pickCounty(AX.cqMatches[AX.cqActive] || AX.cqMatches[0]); }
    });
  });
})();

/* ---------- Launch market: takeaway and tiles ---------- */
const msNum = (name, field, show) => dash.draw(name, (el) => {
  const s = dash.data('market_summary');
  if (s.status === 'loading') { el.textContent = '—'; return; }
  el.classList.remove('dash-skeleton');
  const r = s.status === 'ok' && s.data && s.data[0];
  el.textContent = r && r[field] != null ? show(r[field]) : '—';
});
msNum('mt-top', 'top_name', (v) => v);
msNum('mt-score', 'top_score', (v) => String(v));
msNum('mt-older', 'top_residents', (v) => AX.num(v));
msNum('mt-reach', 'top_within30', (v) => AX.num(v));
msNum('mk-n', 'counties_ranked', (v) => AX.num(v));
msNum('mk-pct', 'pct_ranked', (v) => String(v));
msNum('mk-total', 'total_counties', (v) => AX.num(v));
msNum('mk-top25', 'top25_residents', (v) => AX.num(v));

/* ---------- Launch market: map, profile, scatter, table ---------- */
const SCORE_BANDS = [[0, 'Under 20'], [1, '20 to 39'], [2, '40 to 59'], [3, '60 to 79'], [4, '80 or more']];
const scoreStep = (s) => (s < 20 ? 0 : s < 40 ? 1 : s < 60 ? 2 : s < 80 ? 3 : 4);
// Red (poor fit) through yellow to green (strong fit). The top greens are darker than the reds and yellow,
// so the ends still differ in lightness for readers who can't tell red from green.
const FIT_COLORS = ['#d64a32', '#f39b55', '#f5d657', '#57a85e', '#0b5a2a'];

dash.draw('market-map', (el) => {
  const m = dash.data('market'), rk = dash.data('ranked_market'), sh = dash.data('county_shapes');
  const st = AX.statusOf(m, rk, sh);
  if (st !== 'ok') { AX.empty(el, st); return; }
  const state = dash.params().state || '';
  const ranked = new Set(rk.data.map((r) => r.geoid));
  AX.shapeMap(el, {
    shapes: AX.shapesById(),
    rows: m.data.filter((r) => !state || r.state === state),
    fill: (r) => (ranked.has(r.geoid) ? FIT_COLORS[scoreStep(r.score)] : null),
    legend: [...SCORE_BANDS.map(([k, t]) => [FIT_COLORS[k], t]), ['empty', 'Not ranked']],
    aria: `Map of ${state ? 'the state\u2019s' : 'US'} counties colored by fit score.`,
    title: (r) => `${r.county}, ${r.state}`,
    lines: (r) => AX.marketLines(r, 'market'),
    pick: (r) => dash.setParams({county: r.geoid}),
    selected: AX.selectedGeoid(rk.data),
  });
});

dash.draw('profile', (el) => {
  const m = dash.data('market'), rk = dash.data('ranked_market'), fc = dash.data('factors');
  const st = AX.statusOf(m, rk, fc);
  if (st !== 'ok') { AX.empty(el, st); return; }
  const g = AX.selectedGeoid(rk.data);
  const r = g && m.data.find((d) => d.geoid === g);
  if (!r) { el.replaceChildren(AX.mark('p', 'No county meets these filters. Try another state or a lower minimum.')); return; }
  const where = 'geoid=' + r.geoid;
  const a = AX.ageText(AX.aud());
  const rankRow = rk.data.find((d) => d.geoid === r.geoid);
  const head = document.createElement('div');
  head.className = 'lm-prof-head';
  const nameBox = document.createElement('div');
  const name = document.createElement('h3');
  name.className = 'lm-prof-name';
  name.textContent = `${r.county}, ${r.state}`;
  const rank = document.createElement('p');
  rank.className = 'lm-prof-rank';
  rank.append('Rank ', AX.mark('span', AX.num(rankRow.rank), 'ranked_market', 'rank', where), ' of ', AX.num(rk.data.length), ' ranked counties');
  nameBox.append(name, rank);
  const score = document.createElement('div');
  score.className = 'lm-prof-score';
  const small = document.createElement('small');
  small.textContent = 'fit score';
  score.append(AX.mark('span', String(r.score), 'market', 'score', where), small);
  head.append(nameBox, score);

  const byId = new Map(fc.data.map((f) => [f.id, f]));
  const nwAge = byId.has('median_net_worth') ? AX.urbanAge('median_net_worth', AX.aud()) : 'All';
  const facts = document.createElement('dl');
  facts.className = 'lm-facts';
  [
    [`Residents ${a}`, AX.num(r.residents), 'residents'],
    [`Residents ${a} within 30 miles`, AX.num(r.within30), 'within30'],
    [`Residents ${a} per square mile`, AX.density(r.per_sqmi), 'per_sqmi'],
    [`Growth in residents ${a} since 2020`, AX.pctText(r.growth), 'growth'],
    ['Population', AX.num(r.population), 'population'],
    [`Median net worth, ${AX.ageLabel(nwAge).toLowerCase()}`, r.median_net_worth == null ? 'no data' : '$' + AX.num(r.median_net_worth) + (r.median_net_worth_filled ? ' (ages 75–84)' : ''), 'median_net_worth'],
  ].forEach(([label, text, field]) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.append(AX.mark('span', text, 'market', field, where));
    d.append(dt, dd);
    facts.append(d);
  });

  const items = AX.mixItems().filter((it) => it.weight > 0 && byId.has(it.id)).sort((x, y) => y.weight - x.weight);
  const share = AX.shares(items);
  const listTitle = document.createElement('p');
  listTitle.className = 'lm-fx-meta';
  listTitle.textContent = 'Points on each factor';
  // Say which factors this county has no data for, since its score leaves them out.
  const missing = items.filter((it) => r['p_' + AX.mixKey(it)] == null).map((it) => AX.factorName(byId.get(it.id), it));
  if (missing.length) listTitle.textContent += `. No data for ${missing.join(' or ')}, so the score uses the other factors.`;
  const list = document.createElement('div');
  list.className = 'lm-fx-list';
  items.forEach((it) => {
    const f = byId.get(it.id);
    const k = AX.mixKey(it);
    const p = r['p_' + k], v = r['v_' + k];
    const fx = document.createElement('div');
    fx.className = 'lm-fx';
    const top = document.createElement('div');
    top.className = 'lm-fx-top';
    const nm = document.createElement('span');
    nm.className = 'lm-fx-name';
    nm.textContent = AX.factorName(f, it);
    const pts = document.createElement('span');
    pts.className = 'lm-fx-pts';
    if (p == null) pts.textContent = 'no data';
    else pts.append(AX.mark('span', String(p), 'market', 'p_' + k, where), ' pts');
    top.append(nm, pts);
    const track = document.createElement('div');
    track.className = 'lm-fx-track';
    const bar = document.createElement('div');
    bar.className = 'lm-fx-bar';
    bar.style.width = (p == null ? 0 : Math.max(2, p)) + '%';
    bar.style.background = AX.c0();
    track.append(bar);
    const meta = document.createElement('div');
    meta.className = 'lm-fx-meta';
    meta.append(v == null ? 'No data' : AX.mark('span', AX.fmt(v, f), 'market', 'v_' + k, where), (AX.UNIT[f.unit] || '') + (r['f_' + k] ? ` (ages ${AX.ageText(AX.fillAge(it.id, it.age))}, as Urban has no ${AX.ageText(it.age)} figure here)` : '') + ` · ${it.low ? 'less is better' : 'more is better'} · ${share.get(it)}% of the score`);
    fx.append(top, track, meta);
    list.append(fx);
  });
  el.replaceChildren(head, facts, listTitle, list);
});

// Columns for the ranking: fixed ones plus one per factor in the mix.
const marketColumns = () => {
  const fc = dash.data('factors');
  const a = AX.aud();
  const byId = new Map(fc.status === 'ok' ? fc.data.map((f) => [f.id, f]) : []);
  const items = AX.mixItems().filter((it) => it.weight > 0 && byId.has(it.id)).sort((x, y) => y.weight - x.weight);
  const share = AX.shares(items);
  const nwAge = byId.has('median_net_worth') ? AX.urbanAge('median_net_worth', a) : 'All';
  const factorCols = items.map((it) => {
    const f = byId.get(it.id);
    return {field: 'v_' + AX.mixKey(it), pts: 'p_' + AX.mixKey(it), share: share.get(it), factor: f,
      fill: AX.fillAge(it.id, it.age) ? 'f_' + AX.mixKey(it) : null, fillAge: AX.fillAge(it.id, it.age),
      name: AX.factorName(f, it) + (it.low ? ' (less is better)' : ''),
      label: `${AX.factorName(f, it)}${it.low ? ' (less is better)' : ''} (${share.get(it)}%)`, fmt: (v) => (v == null ? '' : AX.fmt(v, f)), num: true};
  });
  const has = (id, age) => items.some((it) => it.id === id && it.age === age);
  const fixed = [
    has('population', 'All') ? null : {field: 'population', label: 'Population', fmt: (v) => (v == null ? '' : AX.num(v)), num: true},
    has('residents', a) ? null : {field: 'residents', label: `Residents ${AX.ageText(a)}`, fmt: (v) => (v == null ? '' : AX.num(v)), num: true},
    has('median_net_worth', nwAge) ? null : {field: 'median_net_worth', fill: AX.fillAge('median_net_worth', nwAge) ? 'median_net_worth_filled' : null, fillAge: AX.fillAge('median_net_worth', nwAge), label: `Median net worth, ${AX.ageLabel(nwAge).toLowerCase()}`, fmt: (v) => (v == null ? '' : '$' + AX.num(v)), num: true},
  ].filter(Boolean);
  return [
    {field: 'rank', label: 'Rank', fmt: (v) => AX.num(v), num: true},
    {field: 'county', label: 'County', fmt: (v) => v},
    {field: 'state', label: 'State', fmt: (v) => v},
    {field: 'score', label: 'Fit score', fmt: (v) => String(v), num: true},
    ...factorCols,
    ...fixed,
  ];
};

/* ---------- Download the ranking as a CSV ---------- */
// Every county in the current ranking (or the 100 largest, when that box is checked), with each factor's value and points.
const rankingCsv = () => {
  const r = dash.data('ranked_market');
  if (r.status !== 'ok' || !r.data) return null;
  let rows = r.data;
  if (AX.mlarge) {
    const big = new Set(rows.slice().sort((x, y) => (y.residents || 0) - (x.residents || 0)).slice(0, 100).map((d) => d.geoid));
    rows = rows.filter((d) => big.has(d.geoid));
  }
  const unitNote = (f) => (f.unit === 'usd' ? ' ($)' : f.unit === 'share' || f.unit === 'pct' ? ' (%)' : AX.UNIT[f.unit] ? ` (${AX.UNIT[f.unit].trim()})` : '');
  const head = [], get = [];
  marketColumns().forEach((c) => {
    if (c.factor) {
      head.push(`${c.name} [${c.share}% of score] value${unitNote(c.factor)}`); get.push((d) => d[c.field]);
      if (c.fill) { head.push(`${c.name}: ages ${AX.ageText(c.fillAge)} figure used`); get.push((d) => (d[c.fill] ? 'yes' : '')); }
      head.push(`${c.name} [${c.share}% of score] points (0-100)`); get.push((d) => d[c.pts]);
    } else if (c.field === 'state') {
      head.push('State', 'County FIPS code'); get.push((d) => d.state, (d) => d.geoid);
    } else if (c.field === 'median_net_worth') {
      head.push(c.label + ' ($)'); get.push((d) => d[c.field]);
      if (c.fill) { head.push(`${c.label}: ages ${AX.ageText(c.fillAge)} figure used`); get.push((d) => (d[c.fill] ? 'yes' : '')); }
    } else {
      head.push(c.label); get.push((d) => d[c.field]);
    }
  });
  const cell = (v) => { if (v == null) return ''; const t = String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return [head, ...rows.map((d) => get.map((g) => g(d)))].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n';
};
(() => {
  const showMsg = (show) => document.querySelectorAll('#lm-download-msg').forEach((m) => { m.hidden = !show; });
  const save = async () => {
    const csv = rankingCsv();
    if (!csv) return;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `agetech-launch-markets-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
    const data = '\ufeff' + csv;
    if (window.claude && typeof window.claude.use === 'function') {
      // Inside Claude, the page asks the viewer to save the file.
      let dl = null;
      try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (!dl) { showMsg(true); return; }
      try { await dl.save({filename: name, data}); showMsg(false); } catch (e) { showMsg(!e || e.code !== 'declined'); }
      return;
    }
    const url = URL.createObjectURL(new Blob([data], {type: 'text/csv;charset=utf-8'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  document.querySelectorAll('#lm-download').forEach((b) => b.addEventListener('click', save));
})();

dash.draw('fill-note', (el) => {
  const alt = marketColumns().find((c) => c.fill);
  el.textContent = alt ? `* Ages ${AX.ageText(alt.fillAge)} figure. Urban reports 85+ median net worth for only 357 counties, so the 75–84 figure stands in elsewhere.` : '';
});

dash.draw('market-head', (thead) => {
  const cols = marketColumns();
  const tr = document.createElement('tr');
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.dataset.field = c.field;
    th.textContent = c.label;
    if (c.num) th.className = 'ax-num';
    tr.append(th);
  });
  thead.replaceChildren(tr);
});

dash.draw('market-body', (tb) => {
  const r = dash.data('ranked_market');
  const cols = marketColumns();
  const msg = (text) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols.length;
    td.className = 'ax-msg';
    td.textContent = text;
    tr.append(td);
    tb.replaceChildren(tr);
  };
  if (r.status === 'error') { msg('The ranking couldn’t load its data. Reload the page to try again.'); return; }
  if (r.status !== 'ok' || !r.data) { tb.replaceChildren(); return; }
  // With the toggle on, keep the 100 ranked counties with the most residents in the chosen age group, in fit order.
  let pool = r.data;
  if (AX.mlarge) {
    const big = new Set(r.data.slice().sort((x, y) => (y.residents || 0) - (x.residents || 0)).slice(0, 100).map((d) => d.geoid));
    pool = r.data.filter((d) => big.has(d.geoid));
  }
  const rows = pool.slice(0, AX.mlarge ? 100 : 25);
  if (!rows.length) { msg('No county meets these filters.'); return; }
  const g = AX.selectedGeoid(r.data);
  tb.replaceChildren(...rows.map((d) => {
    const tr = document.createElement('tr');
    tr.dataset.key = d.geoid;
    tr.className = 'lm-row' + (d.geoid === g ? ' is-selected' : '');
    tr.tabIndex = 0;
    const pick = () => dash.setParams({county: d.geoid});
    tr.onclick = pick;
    tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    cols.forEach((c) => {
      const td = document.createElement('td');
      if (c.num) td.className = 'ax-num';
      td.append(c.fmt(d[c.field]));
      if (c.fill && d[c.fill]) {
        const mk = document.createElement('span');
        mk.className = 'lm-fill-mark';
        mk.textContent = '*';
        mk.title = `Ages ${AX.ageText(c.fillAge)} figure: Urban has no figure for this county's older group`;
        td.append(mk);
      }
      if (c.pts && d[c.pts] != null) {
        const track = document.createElement('div');
        track.className = 'lm-cell-track';
        const bar = document.createElement('div');
        bar.className = 'lm-cell-bar';
        bar.style.width = Math.max(2, d[c.pts]) + '%';
        bar.style.background = AX.c0();
        track.append(bar);
        td.append(track);
      }
      tr.append(td);
    });
    return tr;
  }));
});

/* ---------- Explore one metric: controls ---------- */
document.querySelectorAll('#ax-x').forEach((s) => {
  s.value = ['people_per_sqmi', 'pct_75plus', 'median_age'].includes(dash.params().xaxis) ? dash.params().xaxis : 'people_per_sqmi';
  s.addEventListener('change', () => dash.setParams({xaxis: s.value}));
});
document.querySelectorAll('#ax-order').forEach((s) => {
  s.value = dash.params().order || 'desc';
  s.addEventListener('change', () => dash.setParams({order: s.value}));
});
document.querySelectorAll('#ax-minpop').forEach((s) => {
  s.value = String(dash.params().minpop ?? 1000);
  s.addEventListener('change', () => dash.setParams({minpop: Number(s.value)}));
});
document.querySelectorAll('#ax-search').forEach((inp) => {
  inp.addEventListener('input', () => { window.AX.search = inp.value; dash.draw('ranking-body'); });
});

dash.draw('metric-select', (sel) => {
  const m = dash.data('metric_info');
  if (m.status !== 'ok') { sel.replaceChildren(); return; }
  const groups = d3.groups(m.data, (d) => d.category);
  sel.replaceChildren(...groups.map(([cat, rows]) => {
    const g = document.createElement('optgroup');
    g.label = cat;
    rows.forEach((r) => g.append(new Option(r.label, r.id)));
    return g;
  }));
  const i = AX.info();
  sel.value = i ? i.id : '';
  sel.onchange = () => {
    const next = m.data.find((r) => r.id === sel.value);
    const have = next ? String(next.ages).split(', ') : [];
    const a = dash.params().age;
    dash.setParams({metric: sel.value, age: have.includes(a) ? a : have.includes('75-84') ? '75-84' : 'All'});
  };
});

dash.draw('age-select', (sel) => {
  const i = AX.info();
  if (!i) { sel.replaceChildren(); return; }
  sel.replaceChildren(...AX.ages(i).map((a) => new Option(AX.ageLabel(a), a)));
  sel.value = AX.age(i);
  sel.onchange = () => dash.setParams({age: sel.value});
});

dash.draw('metric-phrase', (el) => {
  const i = AX.info();
  el.textContent = i ? `${AX.lc(i.label)}${AX.unitText(i)} (${AX.ageLabel(AX.age(i)).toLowerCase()})` : '—';
});
dash.draw('t-metric', (el) => {
  const i = AX.info();
  el.textContent = i ? `${i.label}, ${AX.ageLabel(AX.age(i)).toLowerCase()}` : '—';
});
dash.draw('t-unit', (el) => { el.textContent = AX.unitText(AX.info()); });
dash.draw('k-unit', (el) => { el.textContent = AX.unitText(AX.info()); });

const metaField = (name, field, show) => dash.draw(name, (el) => {
  const i = AX.info();
  if (!i) { el.replaceChildren('—'); return; }
  el.replaceChildren(AX.mark('span', show(i[field]), 'metric_info', field, 'id=' + i.id));
});
metaField('m-cat', 'category', (v) => v);
metaField('m-year', 'year', (v) => String(v).replace('-', '–'));
// Counties with an all-ages value among the counties the page shows (Urban's file also has Connecticut's
// eight retired counties and Bedford city, VA, which current Census files no longer include).
dash.draw('m-n', (el) => {
  const i = AX.info(), met = dash.data('metrics'), cty = dash.data('counties');
  if (!i || met.status !== 'ok' || cty.status !== 'ok') { el.replaceChildren('—'); return; }
  const shown = new Set(cty.data.filter((c) => c.census_match).map((c) => c.geoid));
  const n = met.data.filter((r) => r.age === 'All' && r[i.id] != null && shown.has(r.geoid)).length;
  el.replaceChildren(AX.num(n));
});

const sumNum = (name, field, show) => dash.draw(name, (el) => {
  const s = dash.data('summary');
  if (s.status === 'loading') { el.textContent = '—'; return; }
  el.classList.remove('dash-skeleton');
  const r = s.status === 'ok' && s.data && s.data[0];
  el.textContent = r ? show(r[field], AX.info()) : '—';
});
sumNum('k-n', 'counties_with_data', (v) => AX.num(v));
sumNum('k-total', 'total_counties', (v) => AX.num(v));
sumNum('k-pop', 'pop75_millions', (v) => d3.format('.1f')(v));
sumNum('k-median', 'median', (v, i) => AX.fmt(v, i));
sumNum('k-p25', 'p25', (v, i) => AX.fmt(v, i));
sumNum('k-p75', 'p75', (v, i) => AX.fmt(v, i));
sumNum('t-median', 'median', (v, i) => AX.fmt(v, i));

const bandVal = (name, id) => dash.draw(name, (el) => {
  const b = dash.data('bands');
  const r = b.status === 'ok' && b.data ? b.data.find((d) => d.band_id === id) : null;
  el.textContent = r ? AX.fmt(r.median_value, AX.info()) : '—';
});
bandVal('t-rural', 'lt10');
bandVal('t-urban', '1000plus');
dash.draw('t-dir', (el) => {
  const b = dash.data('bands');
  if (b.status !== 'ok' || !b.data) { el.textContent = '—'; return; }
  const R = b.data.find((d) => d.band_id === 'lt10'), U = b.data.find((d) => d.band_id === '1000plus');
  const a = R && R.median_value, c = U && U.median_value;
  if (a == null || c == null) { el.textContent = 'compared with'; return; }
  const rel = Math.abs(a - c) / Math.max(Math.abs(c), 1e-9);
  el.textContent = rel < 0.03 ? 'about the same as' : a > c ? 'higher than' : 'lower than';
});

/* ---------- Explore one metric: charts and table ---------- */
const viewLines = (r, i) => {
  const w = 'geoid=' + r.geoid;
  return [
    [i.label + ':', AX.fmt(r.value, i), 'view', 'value', w, AX.unitText(i)],
    ['Residents 75+:', AX.num(r.pop_75plus), 'view', 'pop_75plus', w],
    ['Share 75+:', AX.pctText(r.pct_75plus), 'view', 'pct_75plus', w],
    ['Population:', AX.num(r.population), 'view', 'population', w],
    ['People per sq mi:', AX.density(r.people_per_sqmi), 'view', 'people_per_sqmi', w],
    ['Median age:', d3.format('.1f')(r.median_age), 'view', 'median_age', w],
  ];
};

dash.draw('map', (el) => {
  const v = dash.data('view'), sh = dash.data('county_shapes'), i = AX.info();
  const st = AX.statusOf(v, sh);
  if (st !== 'ok' || !i) { AX.empty(el, st); return; }
  const vals = v.data.filter((r) => r.value != null && r.lat != null).map((r) => r.value).sort(d3.ascending);
  const thr = vals.length ? Array.from(new Set([0.2, 0.4, 0.6, 0.8].map((q) => d3.quantile(vals, q)))) : [];
  const nb = thr.length + 1;
  const stepOf = (k) => (nb === 1 ? 4 : Math.round((k * 4) / (nb - 1)));
  const legend = [];
  for (let k = 0; k < nb; k++) {
    const lo = thr[k - 1], hi = thr[k];
    const text = nb === 1 ? 'All values'
      : k === 0 ? `Under ${AX.fmt(hi, i)}`
      : k === nb - 1 ? `${AX.fmt(lo, i)} or more`
      : `${AX.fmt(lo, i)} to ${AX.fmt(hi, i)}`;
    legend.push([AX.seq(stepOf(k)), text]);
  }
  legend.push(['empty', 'No data']);
  AX.shapeMap(el, {
    shapes: AX.shapesById(),
    rows: v.data,
    fill: (r) => (r.value == null ? null : AX.seq(stepOf(d3.bisectRight(thr, r.value)))),
    legend,
    aria: `Map of US counties colored by ${AX.lc(i.label)}.`,
    title: (r) => `${r.county}, ${r.state}`,
    lines: (r) => viewLines(r, i),
  });
});

const X_LABEL = {people_per_sqmi: 'People per square mile (log scale)', pct_75plus: 'Share of residents 75+', median_age: 'Median age'};
dash.draw('scatter', (el) => {
  const v = dash.data('view'), s = dash.data('summary'), i = AX.info();
  if (v.status !== 'ok' || !i) { AX.empty(el, v.status); return; }
  const xk = X_LABEL[dash.params().xaxis] ? dash.params().xaxis : 'people_per_sqmi';
  const isLog = xk === 'people_per_sqmi';
  const P0 = v.data.filter((r) => r.value != null && r[xk] != null && (!isLog || r[xk] > 0));
  if (!P0.length) { el.replaceChildren(AX.mark('p', 'No county has a value for this metric and age group.')); return; }
  const w = Math.max(280, el.clientWidth || 500);
  const h = Math.round(Math.min(420, Math.max(260, w * 0.7)));
  const y = d3.scaleLinear().domain(d3.extent(P0, (r) => r.value)).nice();
  const yTicks = y.ticks(5);
  const box = document.createElement('div');
  box.className = 'ax-plot';
  const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
    .attr('aria-label', `Scatter plot of ${AX.lc(i.label)} against ${X_LABEL[xk].toLowerCase()} for each county.`);
  box.append(svg.node());
  el.replaceChildren(box);
  const probe = svg.append('g');
  const widths = yTicks.map((t) => probe.append('text').text(AX.tick(t, i)).node().getComputedTextLength() || AX.tick(t, i).length * 7);
  probe.remove();
  const m = {top: 22, right: 12, bottom: 40, left: Math.ceil(d3.max(widths)) + 12};
  const iw = w - m.left - m.right, ih = h - m.top - m.bottom;
  y.range([m.top + ih, m.top]);
  const ext = d3.extent(P0, (r) => r[xk]);
  const x = isLog ? d3.scaleLog().domain([Math.max(0.05, ext[0]), ext[1]]).range([m.left, m.left + iw])
    : d3.scaleLinear().domain(ext).nice().range([m.left, m.left + iw]);
  const xTicks = isLog ? [0.1, 1, 10, 100, 1000, 10000, 100000].filter((t) => t >= x.domain()[0] && t <= x.domain()[1]) : x.ticks(Math.max(3, Math.floor(iw / 80)));
  const xFmt = (t) => (xk === 'pct_75plus' ? t + '%' : d3.format(',~g')(t));
  svg.append('g').attr('transform', `translate(${m.left},0)`)
    .call(d3.axisLeft(y).tickValues(yTicks).tickSize(-iw).tickFormat((t) => AX.tick(t, i)))
    .call((g) => g.select('.domain').remove());
  svg.append('g').attr('transform', `translate(0,${m.top + ih})`)
    .call(d3.axisBottom(x).tickValues(xTicks).tickSize(4).tickFormat(xFmt));
  svg.append('text').attr('x', m.left + iw).attr('y', h - 4).attr('text-anchor', 'end').text(X_LABEL[xk]);
  svg.append('text').attr('x', 0).attr('y', 12).text(i.label + AX.unitText(i));
  const rs = d3.scaleSqrt().domain([0, d3.max(P0, (r) => r.pop_75plus) || 1]).range([0, Math.max(8, Math.min(16, w / 40))]);
  const P = P0.map((r) => ({r, x: x(Math.max(x.domain()[0], r[xk])), y: y(r.value), rad: Math.max(1.6, rs(r.pop_75plus || 0))})).sort((a, b) => b.rad - a.rad);
  svg.append('g').selectAll('circle').data(P).join('circle')
    .attr('cx', (p) => p.x).attr('cy', (p) => p.y).attr('r', (p) => p.rad)
    .style('fill', AX.c0()).style('fill-opacity', 0.42)
    .style('stroke', 'var(--color-panel)').style('stroke-width', 0.5);
  const med = s.status === 'ok' && s.data && s.data[0] ? s.data[0].median : null;
  if (med != null) {
    svg.append('line').attr('x1', m.left).attr('x2', m.left + iw).attr('y1', y(med)).attr('y2', y(med))
      .style('stroke', 'var(--cds-chart-reference)').style('stroke-width', 1.5).style('stroke-dasharray', '4 4');
    svg.append('text').attr('x', m.left + iw).attr('y', y(med) - 5).attr('text-anchor', 'end').text('Median');
  }
  AX.interact({svg, P, box, w, title: (r) => `${r.county}, ${r.state}`, lines: (r) => viewLines(r, i)});
});

dash.draw('bands', (el) => {
  const b = dash.data('bands'), i = AX.info();
  if (b.status !== 'ok' || !b.data || !i) { AX.empty(el, b.status); return; }
  const max = d3.max(b.data, (r) => r.median_value) || 1;
  el.replaceChildren(...b.data.map((r) => {
    const where = 'band_id=' + r.band_id;
    const row = document.createElement('div');
    row.className = 'ax-band';
    const name = document.createElement('div');
    name.className = 'ax-band-name';
    name.append(AX.mark('span', r.band, 'bands', 'band', where));
    const sub = document.createElement('span');
    sub.className = 'ax-band-sub';
    sub.append(AX.mark('span', AX.num(r.counties_with_data), 'bands', 'counties_with_data', where), ' counties · ',
      AX.mark('span', AX.num(r.pop_75plus), 'bands', 'pop_75plus', where), ' aged 75+');
    name.append(sub);
    const track = document.createElement('div');
    track.className = 'ax-band-track';
    const bar = document.createElement('div');
    bar.className = 'ax-band-bar';
    bar.style.width = r.median_value == null ? '0%' : Math.max(0, (r.median_value / max) * 100) + '%';
    bar.style.background = AX.c0();
    track.append(bar);
    const val = AX.mark('div', AX.fmt(r.median_value, i), 'bands', 'median_value', where);
    val.className = 'ax-band-val';
    row.append(name, track, val);
    return row;
  }));
});

dash.draw('ranking-body', (tb) => {
  const r = dash.data('ranked'), i = AX.info();
  const msg = (text) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 9;
    td.className = 'ax-msg';
    td.textContent = text;
    tr.append(td);
    tb.replaceChildren(tr);
  };
  if (r.status === 'error') { msg('The ranking couldn’t load the county data. Reload the page to try again.'); return; }
  if (r.status !== 'ok' || !r.data || !i) { tb.replaceChildren(); return; }
  const q = (AX.search || '').trim().toLowerCase();
  const rows = q
    ? r.data.filter((d) => `${d.county}, ${d.state}`.toLowerCase().includes(q) || String(d.state).toLowerCase() === q).slice(0, 100)
    : r.data.slice(0, 25);
  if (!rows.length) { msg(q ? `No county in this ranking matches “${AX.search.trim()}”.` : 'No county has a value for this metric and age group.'); return; }
  const cell = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; return td; };
  tb.replaceChildren(...rows.map((d) => {
    const tr = document.createElement('tr');
    tr.dataset.key = d.geoid;
    tr.append(
      cell(AX.num(d.rank), 'ax-num'),
      cell(d.county),
      cell(d.state),
      cell(AX.fmt(d.value, i), 'ax-num'),
      cell(AX.num(d.pop_75plus), 'ax-num'),
      cell(AX.pctText(d.pct_75plus), 'ax-num'),
      cell(AX.num(d.population), 'ax-num'),
      cell(AX.density(d.people_per_sqmi), 'ax-num'),
      cell(AX.num(d.land_sqmi), 'ax-num'),
    );
    return tr;
  }));
});
