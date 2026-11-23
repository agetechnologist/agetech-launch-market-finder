// Urban reports 85+ median net worth for only 357 counties. For the 85+ group, the 75–84 figure stands in
// where the 85+ one is missing. Net worth only: where both exist the 85+ figure is typically just 6% lower,
// while other measures differ far more by age (85+ median income runs about a quarter lower), so they aren't filled.
const AGE_FILL = {median_net_worth: {'85+': '75-84'}};

dash.loader('metrics', {
  description: 'The file stores each row as a list in column order to keep it small; this turns each list back into a row with named columns.',
  fn: ({answer}) => {
    const cols = answer.columns;
    return {data: answer.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))), columns: cols, meta: answer.meta};
  },
});

/* ---------- Explore one metric ---------- */
dash.calc('view', {
  title: 'Counties with the selected metric',
  description: 'Each county’s Census population and land area beside its value on the metric and age group picked on the page. Shares are shown as percentages.',
  inputs: ['counties', 'metrics', 'metric_info'],
  fn: (counties, metrics, metric_info) => {
    const p = dash.params();
    const info = metric_info.find((m) => m.id === p.metric) || metric_info[0];
    if (!info) return [];
    const age = String(info.ages).split(', ').includes(p.age) ? p.age : 'All';
    const byGeo = new Map();
    for (const r of metrics) if (r.age === age) byGeo.set(r.geoid, r[info.id]);
    const shown = (v) => (v == null ? null
      : info.unit === 'share' ? Math.round(v * 1000) / 10
      : info.unit === 'per1000days' ? Math.round(v * 100) / 100
      : Math.round(v));
    return counties.filter((c) => c.census_match).map((c) => ({
      geoid: c.geoid, county: c.county, state: c.state,
      population: c.population, pop_75plus: c.pop_75plus,
      pct_75plus: c.population ? Math.round((c.pop_75plus / c.population) * 1000) / 10 : null,
      median_age: c.median_age,
      land_sqmi: Math.round(c.land_sqmi),
      people_per_sqmi: c.people_per_sqmi < 10 ? c.people_per_sqmi : Math.round(c.people_per_sqmi),
      lat: c.lat, lon: c.lon,
      value: shown(byGeo.has(c.geoid) ? byGeo.get(c.geoid) : null),
    }));
  },
});

dash.calc('summary', {
  title: 'Selected metric across counties',
  description: 'How many counties have a value, how many residents 75+ live in them, and the median and middle half of county values.',
  inputs: ['view', 'metric_info'],
  fn: (view, metric_info) => {
    const p = dash.params();
    const info = metric_info.find((m) => m.id === p.metric) || metric_info[0] || {};
    const digits = info.unit === 'share' ? 1 : info.unit === 'per1000days' ? 2 : 0;
    const round = (v) => (v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
    const withData = view.filter((r) => r.value != null);
    const vals = withData.map((r) => r.value).sort((a, b) => a - b);
    const q = (f) => {
      if (!vals.length) return null;
      const i = (vals.length - 1) * f, lo = Math.floor(i), hi = Math.ceil(i);
      return vals[lo] + (vals[hi] - vals[lo]) * (i - lo);
    };
    const pop75 = withData.reduce((s, r) => s + (r.pop_75plus || 0), 0);
    return [{
      counties_with_data: withData.length,
      total_counties: view.length,
      pop75_millions: Math.round(pop75 / 1e5) / 10,
      median: round(q(0.5)), p25: round(q(0.25)), p75: round(q(0.75)),
    }];
  },
});

dash.calc('bands', {
  title: 'Median by population density',
  description: 'Counties grouped by people per square mile of land, with the median value of the selected metric in each group.',
  inputs: ['view', 'metric_info'],
  fn: (view, metric_info) => {
    const p = dash.params();
    const info = metric_info.find((m) => m.id === p.metric) || metric_info[0] || {};
    const digits = info.unit === 'share' ? 1 : info.unit === 'per1000days' ? 2 : 0;
    const groups = [
      {band_id: 'lt10', band: 'Under 10', lo: 0, hi: 10},
      {band_id: '10-50', band: '10 to 50', lo: 10, hi: 50},
      {band_id: '50-250', band: '50 to 250', lo: 50, hi: 250},
      {band_id: '250-1000', band: '250 to 1,000', lo: 250, hi: 1000},
      {band_id: '1000plus', band: '1,000 or more', lo: 1000, hi: Number.MAX_VALUE},
    ];
    return groups.map((g) => {
      const inBand = view.filter((r) => r.people_per_sqmi != null && r.people_per_sqmi >= g.lo && r.people_per_sqmi < g.hi);
      const withData = inBand.filter((r) => r.value != null);
      const vals = withData.map((r) => r.value).sort((a, b) => a - b);
      let median = null;
      if (vals.length) {
        const i = (vals.length - 1) / 2;
        median = Math.round(((vals[Math.floor(i)] + vals[Math.ceil(i)]) / 2) * 10 ** digits) / 10 ** digits;
      }
      return {
        band_id: g.band_id, band: g.band,
        counties: inBand.length, counties_with_data: withData.length,
        pop_75plus: withData.reduce((s, r) => s + (r.pop_75plus || 0), 0),
        median_value: median,
      };
    });
  },
});

dash.calc('ranked', {
  title: 'County ranking',
  description: 'Counties with a value on the selected metric and at least the chosen number of residents 75+, ranked by that value.',
  inputs: ['view'],
  fn: (view) => {
    const p = dash.params();
    const min = Number(p.minpop) || 0;
    const desc = p.order !== 'asc';
    return view
      .filter((r) => r.value != null && (r.pop_75plus || 0) >= min)
      .sort((a, b) => (desc ? b.value - a.value : a.value - b.value))
      .map((r, i) => ({
        rank: i + 1, geoid: r.geoid, county: r.county, state: r.state, value: r.value,
        pop_75plus: r.pop_75plus, pct_75plus: r.pct_75plus, population: r.population,
        people_per_sqmi: r.people_per_sqmi, land_sqmi: r.land_sqmi,
      }));
  },
});

/* ---------- Find a launch market ---------- */
dash.calc('factors', {
  title: 'Fit score factors',
  description: 'Every factor the fit score can use: where it comes from, its unit and data year, and the age groups it is available for. "{age}" in a label is filled in with the age group used.',
  inputs: ['metric_info'],
  fn: (metric_info) => {
    const AGES = '65-74, 75-84, 85+';
    const C = (id, label, unit, year, ages) => ({id, group: 'Older adults and reach (Census)', label, unit, source: 'Census', year, ages: ages || ''});
    const B = (id, label) => ({id, group: 'Senior living and home care (Census business counts)', label, unit: label.includes('per 1,000') ? 'per1k' : 'count', source: 'Census', year: '2023', ages: ''});
    const M = (id, label, unit) => ({id, group: 'Medicare (CMS)', label, unit, source: 'CMS', year: 'Nov 2026', ages: ''});
    const N = (id, label, unit) => ({id, group: 'Nursing homes (CMS)', label, unit, source: 'CMS', year: 'Oct 2026', ages: ''});
    return [
      C('residents', 'Residents {age}', 'count', '2025', AGES),
      C('within30', 'Residents {age} within 30 miles', 'count', '2025', AGES),
      C('per_sqmi', 'Residents {age} per square mile', 'density', '2025', AGES),
      C('share', 'Share of residents who are {age}', 'pct', '2025', AGES),
      C('growth', 'Growth in residents {age} since 2020', 'pct', '2020–2025', AGES),
      C('population', 'Total population', 'count', '2025'),
      C('people_per_sqmi', 'People per square mile', 'density', '2025'),
      C('median_age', 'Median age', 'years', '2025'),
      B('senior_living', 'Senior living communities in the county'),
      B('sl_within30', 'Senior living communities within 30 miles'),
      B('sl_per_1k', 'Senior living communities per 1,000 residents 75+'),
      B('home_care', 'Home care businesses in the county'),
      B('hc_within30', 'Home care businesses within 30 miles'),
      M('ma_pct', 'Medicare beneficiaries in Medicare Advantage', 'pct'),
      M('medicare_eligibles', 'People eligible for Medicare', 'count'),
      N('nh_count', 'Nursing homes in the county', 'count'),
      N('nh_within30', 'Nursing homes within 30 miles', 'count'),
      N('nh_beds', 'Certified nursing home beds', 'count'),
      N('nh_low_staffing_pct', 'Homes with a 1–2 star staffing rating', 'pct'),
      N('nh_turnover_median', 'Nursing staff turnover, median home', 'pct'),
      N('nh_low_overall_pct', 'Homes rated 1–2 stars overall', 'pct'),
      ...metric_info.map((m) => ({id: m.id, group: String(m.category).replace('Health care', 'Healthcare') + ' (Urban Institute)', label: m.label, unit: m.unit, source: 'Urban Institute', year: m.year, ages: m.ages})),
    ];
  },
});

dash.calc('reach', {
  title: 'County reach, businesses and Medicare',
  description: 'For each county: residents 65–74, 75–84 and 85+ (plus 65+ and 75+), senior living and home care businesses, and nursing homes in every county whose 2020 population center is within 30 straight-line miles of this county’s (Connecticut planning regions use the Census internal point); residents per square mile, their share and their growth since 2020; the Medicare Advantage share; and the USDA rural-urban code.',
  inputs: ['counties', 'nursing_homes', 'businesses', 'medicare_advantage', 'rural_codes'],
  fn: (counties, nursing_homes, businesses, medicare_advantage, rural_codes) => {
    const nh = new Map(nursing_homes.map((r) => [r.geoid, r]));
    const ru = new Map(rural_codes.map((r) => [r.geoid, r]));
    const biz = new Map(businesses.map((r) => [r.geoid, r]));
    const ma = new Map(medicare_advantage.map((r) => [r.geoid, r]));
    const rows = counties.filter((c) => c.census_match);
    const R = 3958.8, rad = Math.PI / 180, MILES = 30, dLat = MILES / 69;
    // Distances run between counties' 2020 population centers (reach_lat / reach_lon), so a circle starts where people live.
    const byLat = rows.slice().sort((a, b) => a.reach_lat - b.reach_lat);
    const lats = byLat.map((c) => c.reach_lat);
    const start = (x) => { let lo = 0, hi = lats.length; while (lo < hi) { const m = (lo + hi) >> 1; if (lats[m] < x) lo = m + 1; else hi = m; } return lo; };
    const ages = ['65_74', '75_84', '85plus', '65plus', '75plus'];  // field suffixes: Urban's bands, then 65+ and 75+
    const per = (n, c) => { if (!(c.land_sqmi > 0) || n == null) return null; const v = n / c.land_sqmi; return v < 10 ? Math.round(v * 10) / 10 : Math.round(v); };
    return rows.map((c) => {
      const sums = {sl: 0, hc: 0, nh: 0};
      ages.forEach((a) => { sums['p' + a] = 0; });
      for (let k = start(c.reach_lat - dLat); k < byLat.length && byLat[k].reach_lat <= c.reach_lat + dLat; k++) {
        const o = byLat[k];
        const a = Math.sin(((o.reach_lat - c.reach_lat) * rad) / 2) ** 2 + Math.cos(c.reach_lat * rad) * Math.cos(o.reach_lat * rad) * Math.sin(((o.reach_lon - c.reach_lon) * rad) / 2) ** 2;
        if (2 * R * Math.asin(Math.min(1, Math.sqrt(a))) <= MILES) {
          ages.forEach((a) => { sums['p' + a] += o['pop_' + a] || 0; });
          const b = biz.get(o.geoid) || {};
          sums.sl += b.senior_living || 0; sums.hc += b.home_care || 0;
          sums.nh += (nh.get(o.geoid) || {}).nh_count || 0;
        }
      }
      const h = nh.get(c.geoid) || {}, b = biz.get(c.geoid) || {}, m = ma.get(c.geoid) || {}, u = ru.get(c.geoid) || {};
      const row = {
        geoid: c.geoid, county: c.county, state: c.state, state_name: c.state_name, lat: c.lat, lon: c.lon,
        population: c.population, median_age: c.median_age,
        rucc: u.rucc == null ? null : u.rucc, metro: u.metro == null ? null : u.metro, remote: u.remote == null ? null : u.remote,
        people_per_sqmi: c.people_per_sqmi < 10 ? c.people_per_sqmi : Math.round(c.people_per_sqmi),
        senior_living: b.senior_living || 0, sl_within30: sums.sl,
        sl_per_1k: c.pop_75plus ? Math.round(((b.senior_living || 0) / c.pop_75plus) * 1000 * 100) / 100 : null,
        home_care: b.home_care || 0, hc_within30: sums.hc,
        ma_pct: m.ma_pct == null ? null : m.ma_pct, medicare_eligibles: m.medicare_eligibles == null ? null : m.medicare_eligibles,
        nh_count: h.nh_count || 0, nh_within30: sums.nh, nh_beds: h.nh_beds || 0,
        nh_low_staffing_pct: h.nh_low_staffing_pct == null ? null : h.nh_low_staffing_pct,
        nh_turnover_median: h.nh_turnover_median == null ? null : h.nh_turnover_median,
        nh_low_overall_pct: h.nh_low_overall_pct == null ? null : h.nh_low_overall_pct,
      };
      ages.forEach((a) => {
        const n = c['pop_' + a], then = c['pop_' + a + '_2020'];
        row['residents_' + a] = n;
        row['within30_' + a] = sums['p' + a];
        row['per_sqmi_' + a] = per(n, c);
        row['share_' + a] = c.population && n != null ? Math.round((n / c.population) * 1000) / 10 : null;
        row['growth_' + a] = then && n != null ? Math.round((n / then - 1) * 1000) / 10 : null;
      });
      return row;
    });
  },
});

dash.calc('market', {
  title: 'Fit score by county',
  description: 'Each county’s percentile against all US counties on every factor in the mix your answers set, and the weighted average of those percentiles as a 0–100 fit score. A county needs data on every High (3×) factor, and on at least two-thirds of the weight overall, to get a score. For ages 85+, median net worth uses the 75–84 figure where Urban has no 85+ one (f_ columns mark those).',
  inputs: ['factors', 'reach', 'metrics'],
  fn: (factors, reach, metrics) => {
    const p = dash.params();
    // Urban's age bands; older links used 65 / 75 / 85.
    const OLD = {'65': '65-74', '75': '75-84', '85': '85+'};
    const aud = ['65-74', '75-84', '85+'].includes(String(p.aud)) ? String(p.aud) : OLD[String(p.aud)] || '75-84';
    const suf = (a) => a.replace('+', 'plus').replace(/[^0-9a-z]/gi, '_');
    // The mix is "factor[@age][~low]:weight" items separated by commas; ~low means less is better.
    const items = String(p.mix || '').split(',').map((s) => {
      const m = s.trim().match(/^([a-z0-9_]+)(?:@([0-9+-]+))?(~low)?:([0-3])$/);
      return m ? {id: m[1], age: m[2] || 'All', low: Boolean(m[3]), weight: Number(m[4])} : null;
    }).filter((it) => it && it.weight > 0);
    const byId = new Map(factors.map((f) => [f.id, f]));
    const used = items.filter((it) => byId.has(it.id));
    // Urban's figure for the same age band, or all ages when Urban has none for it.
    const urbanAge = (f) => (String(f.ages).split(', ').includes(aud) ? aud : 'All');
    const nwAge = byId.has('median_net_worth') ? urbanAge(byId.get('median_net_worth')) : 'All';
    const fillOf = (id, age) => (AGE_FILL[id] || {})[age];
    const ages = new Set([nwAge, ...used.map((it) => it.age)]);
    [...ages].forEach((a) => Object.keys(AGE_FILL).forEach((id) => { if (fillOf(id, a)) ages.add(fillOf(id, a)); }));
    const urban = new Map();
    for (const r of metrics) if (ages.has(r.age)) urban.set(r.geoid + '|' + r.age, r);
    const shown = (v, unit) => (v == null ? null : unit === 'share' ? Math.round(v * 1000) / 10 : unit === 'per1000days' ? Math.round(v * 100) / 100 : Math.round(v));
    const key = (it) => it.id + (it.age !== 'All' ? '_' + it.age.replace('+', 'plus').replace(/[^0-9a-z]/gi, '_') : '');
    const urbanVal = (id, age, geoid, unit) => { const r = urban.get(geoid + '|' + age); return r && r[id] != null ? shown(r[id], unit) : null; };
    // {v, filled}: filled is true when a stand-in age group's figure was used (see AGE_FILL).
    const valueOf = (it, c) => {
      const f = byId.get(it.id);
      if (f.source === 'Urban Institute') {
        const v = urbanVal(it.id, it.age, c.geoid, f.unit);
        const alt = fillOf(it.id, it.age);
        if (v == null && alt) { const w = urbanVal(it.id, alt, c.geoid, f.unit); if (w != null) return {v: w, filled: true}; }
        return {v, filled: false};
      }
      const field = f.ages ? it.id + '_' + suf(it.age) : it.id;
      return {v: c[field] == null ? null : c[field], filled: false};
    };
    const pctFns = used.map((it) => {
      const sorted = reach.map((c) => valueOf(it, c).v).filter((v) => v != null).sort((a, b) => a - b);
      const n = sorted.length;
      const bound = (v, strict) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (strict ? sorted[m] < v : sorted[m] <= v) lo = m + 1; else hi = m; } return lo; };
      return (v) => {
        if (v == null || n < 2) return null;
        const q = (((bound(v, true) + bound(v, false) - 1) / 2) / (n - 1)) * 100;
        return it.low ? 100 - q : q;
      };
    });
    const total = used.reduce((s, it) => s + it.weight, 0);
    return reach.map((c) => {
      let nwv = urbanVal('median_net_worth', nwAge, c.geoid, 'usd'), nwFilled = false;
      if (nwv == null && fillOf('median_net_worth', nwAge)) {
        nwv = urbanVal('median_net_worth', fillOf('median_net_worth', nwAge), c.geoid, 'usd');
        nwFilled = nwv != null;
      }
      const row = {
        geoid: c.geoid, county: c.county, state: c.state, state_name: c.state_name, lat: c.lat, lon: c.lon,
        population: c.population, rucc: c.rucc, metro: c.metro, remote: c.remote,
        residents: c['residents_' + suf(aud)], within30: c['within30_' + suf(aud)],
        per_sqmi: c['per_sqmi_' + suf(aud)], growth: c['growth_' + suf(aud)],
        median_net_worth: nwv, median_net_worth_filled: nwFilled,
      };
      let sum = 0, wsum = 0, missingHigh = false;
      used.forEach((it, j) => {
        const {v, filled} = valueOf(it, c);
        const q = pctFns[j](v);
        row['v_' + key(it)] = v;
        row['f_' + key(it)] = filled;
        row['p_' + key(it)] = q == null ? null : Math.round(q);
        if (q != null) { sum += q * it.weight; wsum += it.weight; } else if (it.weight === 3) missingHigh = true;
      });
      // A score needs every High (3x) factor and at least two-thirds of the weight overall.
      row.score = total > 0 && !missingHigh && wsum >= (2 / 3) * total ? Math.round(sum / wsum) : null;
      return row;
    });
  },
});

dash.calc('ranked_market', {
  title: 'Best-fitting counties',
  description: 'Counties with a fit score that meet the state, minimum-residents and metro/rural filters (USDA codes 1–3 metro, 4–9 nonmetro), ranked from best fit down, with each factor’s value and points; ties go to the county with more older adults within 30 miles.',
  inputs: ['market'],
  fn: (market) => {
    const p = dash.params();
    const min = Number(p.mfloor) || 0;
    const st = p.state || '';
    const area = p.area || 'any';
    const inArea = (r) => (area === 'metro' ? r.metro === true : area === 'rural' ? r.metro === false : true);
    return market
      .filter((r) => r.score != null && (r.residents || 0) >= min && (!st || r.state === st) && inArea(r))
      .sort((a, b) => b.score - a.score || b.within30 - a.within30)
      .map((r, i) => {
        const row = {rank: i + 1};
        Object.keys(r).forEach((k) => { if (!['lat', 'lon', 'state_name'].includes(k)) row[k] = r[k]; });
        return row;
      });
  },
});

dash.calc('market_summary', {
  title: 'Ranking summary',
  description: 'The best-fitting county, how many counties are ranked and what share of all US counties that is, and residents in the chosen age group across the top 25.',
  inputs: ['ranked_market', 'market'],
  fn: (ranked_market, market) => {
    const top = ranked_market[0];
    return [{
      counties_ranked: ranked_market.length,
      total_counties: market.length,
      pct_ranked: market.length ? Math.round((ranked_market.length / market.length) * 100) : null,
      top25_residents: ranked_market.slice(0, 25).reduce((s, r) => s + (r.residents || 0), 0),
      top_geoid: top ? top.geoid : null,
      top_name: top ? `${top.county}, ${top.state}` : null,
      top_score: top ? top.score : null,
      top_residents: top ? top.residents : null,
      top_within30: top ? top.within30 : null,
    }];
  },
});

/* ---------- Shared helpers ---------- */
window.AX = (() => {
  const AGE_LABEL = {'All': 'All ages', '50-64': 'Ages 50–64', '65+': 'Ages 65+', '65-74': 'Ages 65–74', '75-84': 'Ages 75–84', '75+': 'Ages 75+', '85+': 'Ages 85+'};
  const UNIT = {usd: '', share: '', pct: '', count: '', density: '', years: '', per1k: '', per100k: ' per 100,000 people', per100k_benef: ' per 100,000 beneficiaries', per1000days: ' per 1,000 residence days'};
  const WEIGHT = ['Off', 'Low (1\u00d7)', 'Medium (2\u00d7)', 'High (3\u00d7)'];
  // Each factor's share of the score: its weight over the total, rounded so the shares add to 100.
  const shares = (items) => {
    const on = items.filter((it) => it.weight > 0);
    const total = on.reduce((t, it) => t + it.weight, 0);
    const out = new Map();
    if (!total) return out;
    const raw = on.map((it) => (it.weight / total) * 100);
    const pct = raw.map(Math.floor);
    let left = 100 - pct.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - pct[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { pct[i] += 1; left -= 1; } });
    on.forEach((it, i) => out.set(it, pct[i]));
    return out;
  };
  const PAYERS = {
    consumer: 'older adults or their families', senior_living: 'senior living communities', home_care: 'home care agencies',
    medicare: 'Medicare',
  };
  const num = d3.format(',');
  const info = () => {
    const m = dash.data('metric_info');
    if (m.status !== 'ok' || !m.data.length) return null;
    const id = dash.params().metric;
    return m.data.find((r) => r.id === id) || m.data[0];
  };
  const ages = (i) => (i ? String(i.ages).split(', ') : ['All']);
  const age = (i) => { const a = dash.params().age; return ages(i).includes(a) ? a : 'All'; };
  const ageLabel = (a) => AGE_LABEL[a] || a;
  const unitText = (i) => (i ? UNIT[i.unit] || '' : '');
  const lc = (s) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const fmt = (v, i) => {
    if (v == null || !Number.isFinite(v)) return 'no data';
    const u = i && i.unit;
    if (u === 'usd') return '$' + num(Math.round(v));
    if (u === 'share' || u === 'pct') return d3.format('.1f')(v) + '%';
    if (u === 'per1000days' || u === 'per1k') return d3.format('.2f')(v);
    if (u === 'density') return v < 10 ? d3.format('.1f')(v) : num(Math.round(v));
    if (u === 'years') return d3.format('.1f')(v);
    return num(Math.round(v));
  };
  const tick = (v, i) => {
    const u = i && i.unit;
    if (u === 'usd') return '$' + d3.format('~s')(v);
    if (u === 'share') return d3.format('~g')(v) + '%';
    return d3.format(',~g')(v);
  };
  const density = (v) => (v == null ? '' : v < 10 ? d3.format('.1f')(v) : num(v));
  const pctText = (v) => (v == null ? '' : v.toFixed(1) + '%');
  const c0 = () => (dash.colors && dash.colors[0]) || 'var(--color-fg)';
  const STEPS = [32, 48, 64, 82, 100];
  const seq = (k) => `color-mix(in oklab, ${c0()} ${STEPS[k]}%, var(--color-panel))`;
  const mark = (tag, text, source, field, where) => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (source) { e.dataset.source = source; e.dataset.field = field; if (where) e.dataset.where = where; }
    return e;
  };
  const empty = (el, status) => {
    if (status === 'error') {
      const p = document.createElement('p');
      p.className = 'ax-error';
      p.textContent = 'This part couldn’t load its data. Reload the page to try again.';
      el.replaceChildren(p);
    } else {
      el.replaceChildren('—');
    }
  };
  const statusOf = (...ds) => (ds.some((d) => d.status === 'error') ? 'error' : ds.every((d) => d.status === 'ok') ? 'ok' : 'loading');

  // The open tooltip's hide function. Scrolling, leaving the window or switching away closes it,
  // since a pointer that stops moving over the map sends no leave event.
  let openTipHide = null;
  const closeTip = () => { if (openTipHide) { const h = openTipHide; openTipHide = null; h(); } };
  window.addEventListener('scroll', closeTip, {passive: true, capture: true});
  window.addEventListener('blur', closeTip);
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) closeTip(); });

  // Tooltip: lines are [label, text, source, field, where, suffix].
  const showTip = (tip, box, title, lines, x, y) => {
    const head = document.createElement('strong');
    head.textContent = title;
    tip.replaceChildren(head, ...lines.map(([label, text, source, field, where, suffix]) => {
      const d = document.createElement('div');
      d.className = 'ax-tip-row';
      const b = document.createElement('b');
      b.append(mark('span', text, source, field, where));
      d.append(label + ' ', b);
      if (suffix) d.append(suffix);
      return d;
    }));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, bw = box.clientWidth, bh = box.clientHeight;
    let left = x + 14;
    if (left + tw > bw) left = Math.max(0, x - tw - 14);
    const top = Math.min(Math.max(0, y - th / 2), Math.max(0, bh - th));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };

  // Hover tooltip and optional click on the nearest dot.
  const interact = ({svg, P, box, w, title, lines, pick}) => {
    if (!P.length) return;
    const tip = document.createElement('div');
    tip.className = 'ax-tip';
    tip.hidden = true;
    box.append(tip);
    const ring = svg.append('circle').style('fill', 'none').style('stroke', 'var(--color-fg)').style('stroke-width', 1.5).style('display', 'none').style('pointer-events', 'none');
    const delaunay = d3.Delaunay.from(P, (p) => p.x, (p) => p.y);
    const node = svg.node();
    const near = (e) => {
      const [mx, my] = d3.pointer(e, node);
      const p = P[delaunay.find(mx, my)];
      return p && Math.hypot(p.x - mx, p.y - my) <= Math.max(14, p.rad + 6) ? p : null;
    };
    const hide = () => { tip.hidden = true; ring.style('display', 'none'); };
    const show = (e) => {
      const p = near(e);
      if (!p) { hide(); return; }
      ring.attr('cx', p.x).attr('cy', p.y).attr('r', p.rad + 2).style('display', null);
      const s = node.clientWidth / w || 1;
      showTip(tip, box, title(p.r), lines(p.r), p.x * s, p.y * s);
      openTipHide = hide;
    };
    svg.on('pointermove', show).on('pointerdown', show).on('pointerleave', hide);
    box.addEventListener('pointerleave', hide);
    if (pick) svg.style('cursor', 'pointer').on('click', (e) => { const p = near(e); if (p) pick(p.r); });
  };

  // County outlines from the shapes dataset, kept by county ID.
  let shapeCache = {src: null, map: null};
  const shapesById = () => {
    const d = dash.data('county_shapes');
    if (d.status !== 'ok' || !d.data) return null;
    // Nested values can arrive as JSON text, so outlines are read back into lists here.
    const coords = (c) => { if (typeof c !== 'string') return c; try { return JSON.parse(c); } catch (e) { return null; } };
    if (shapeCache.src !== d.data) shapeCache = {src: d.data, map: new Map(d.data.map((r) => [String(r.geoid), coords(r.coords)]).filter(([, c]) => Array.isArray(c) && c.length))};
    return shapeCache.map;
  };
  // County shape map: o = {shapes, rows, fill(r) -> color or null, legend: [[color, text]], aria, title, lines, pick, selected}.
  const shapeMap = (el, o) => {
    const w = Math.max(280, el.clientWidth || 600);
    const feats = o.rows.map((r) => {
      const c = o.shapes.get(r.geoid);
      return c ? {type: 'Feature', r, fill: o.fill(r), geometry: {type: 'MultiPolygon', coordinates: c}} : null;
    }).filter(Boolean);
    if (!feats.length) { el.replaceChildren(mark('p', 'No counties to show for these filters.')); return; }
    const fc = {type: 'FeatureCollection', features: feats};
    // The map's height follows the shape of what is drawn (the country, or one state).
    const b = d3.geoPath(d3.geoAlbersUsa().fitWidth(w - 12, fc)).bounds(fc);
    const h = Math.max(220, Math.min(Math.round(w * 0.75), Math.ceil(b[1][1] - b[0][1]) + 12));
    const path = d3.geoPath(d3.geoAlbersUsa().fitExtent([[6, 6], [w - 6, h - 6]], fc));
    const legend = document.createElement('div');
    legend.className = 'ax-legend';
    o.legend.forEach(([fill, text]) => {
      const sp = document.createElement('span');
      const d = document.createElement('i');
      d.className = 'ax-sw' + (fill === 'empty' ? ' ax-sw-empty' : '');
      if (fill !== 'empty') d.style.background = fill;
      sp.append(d, text);
      legend.append(sp);
    });
    const box = document.createElement('div');
    box.className = 'ax-plot';
    const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', o.aria);
    box.append(svg.node());
    el.replaceChildren(legend, box);
    const g = svg.append('g');
    const thin = feats.length > 400 ? 0.3 : 0.8;
    g.selectAll('path').data(feats).join('path')
      .attr('d', path)
      .style('fill', (f) => f.fill || 'var(--color-panel)')
      .style('stroke', (f) => (f.fill ? 'var(--color-panel)' : 'var(--color-border-line)'))
      .style('stroke-width', (f) => (f.fill ? thin : thin + 0.3));
    const sel = o.selected && feats.find((f) => f.r.geoid === o.selected);
    if (sel) svg.append('path').attr('d', path(sel)).style('fill', 'none').style('stroke', 'var(--color-fg)').style('stroke-width', 2).style('pointer-events', 'none');
    const hover = svg.append('path').style('fill', 'none').style('stroke', 'var(--color-fg)').style('stroke-width', 1.2).style('pointer-events', 'none').style('display', 'none');
    const tip = document.createElement('div');
    tip.className = 'ax-tip';
    tip.hidden = true;
    box.append(tip);
    const at = (e) => (e.target && e.target.parentNode === g.node() ? d3.select(e.target).datum() : null);
    const hide = () => { tip.hidden = true; hover.style('display', 'none'); };
    const show = (e) => {
      const f = at(e);
      if (!f) { hide(); return; }
      hover.attr('d', path(f)).style('display', null);
      const [x, y] = d3.pointer(e, box);
      showTip(tip, box, o.title(f.r), o.lines(f.r), x, y);
      openTipHide = hide;
    };
    g.on('pointermove', show).on('pointerdown', show).on('pointerleave', hide);
    box.addEventListener('pointerleave', hide);
    if (o.pick) g.style('cursor', 'pointer').on('click', (e) => { const f = at(e); if (f) o.pick(f.r); });
  };

  // The fit-score mix and the survey that sets it.
  const parseMix = (s) => String(s || '').split(',').map((x) => {
    const m = x.trim().match(/^([a-z0-9_]+)(?:@([0-9+-]+))?(~low)?:([0-3])$/);
    return m ? {id: m[1], age: m[2] || 'All', low: Boolean(m[3]), weight: Number(m[4])} : null;
  }).filter(Boolean);
  const mixString = (items) => items.map((it) => `${it.id}${it.age !== 'All' ? '@' + it.age : ''}${it.low ? '~low' : ''}:${it.weight}`).join(',');
  const mixItems = () => parseMix(dash.params().mix);
  const mixKey = (it) => it.id + (it.age !== 'All' ? '_' + it.age.replace('+', 'plus').replace(/[^0-9a-z]/gi, '_') : '');
  // The age band the survey picked: Urban's 65-74, 75-84 or 85+ (older links used 65 / 75 / 85).
  const aud = () => {
    const a = String(dash.params().aud);
    return ['65-74', '75-84', '85+'].includes(a) ? a : {'65': '65-74', '75': '75-84', '85': '85+'}[a] || '75-84';
  };
  const ageText = (a) => String(a).replace('-', '\u2013');
  const answers = () => {
    const p = dash.params();
    return {
      pay: (Array.isArray(p.pay) ? p.pay.filter((x) => PAYERS[x]) : []).slice(0, 1),
      aud: aud(),
      reach: ['home', 'site', 'remote'].includes(p.reach) ? p.reach : 'home',
      medicare: ['ma', 'traditional', 'both'].includes(p.medicare) ? p.medicare : 'both',
      area: ['any', 'metro', 'rural'].includes(p.area) ? p.area : 'any',
    };
  };
  // Urban's figure for the same age band, as in the fit score calc, or all ages when Urban has none for it.
  const urbanAge = (id, a) => {
    const fc = dash.data('factors');
    const f = fc.status === 'ok' ? fc.data.find((x) => x.id === id) : null;
    if (!f) return a;
    return String(f.ages).split(', ').includes(a) ? a : 'All';
  };
  const surveyMix = (ans) => {
    const items = [];
    const add = (id, age, weight, low) => {
      const it = items.find((x) => x.id === id && x.age === age && x.low === Boolean(low));
      if (it) it.weight = Math.min(3, it.weight + weight); else items.push({id, age, low: Boolean(low), weight});
    };
    const a = ans.aud, cen = a;
    const pay = new Set(ans.pay);
    if (pay.has('consumer')) { add('median_net_worth', urbanAge('median_net_worth', a), 2); add('median_income', urbanAge('median_income', a), 1); }
    if (pay.has('senior_living')) { add('sl_within30', 'All', 3); add('senior_living', 'All', 1); }
    if (pay.has('home_care')) { add('hc_within30', 'All', 3); add('home_care', 'All', 1); }
    if (pay.has('medicare')) {
      add('avoidable_hospitalizations', urbanAge('avoidable_hospitalizations', a), 3);
      add('annual_wellness_visit', urbanAge('annual_wellness_visit', a), 2, true);
      if (ans.medicare === 'ma') add('ma_pct', 'All', 3);
      if (ans.medicare === 'traditional') add('ma_pct', 'All', 2, true);
    }
    add('residents', cen, 2);
    if (ans.reach === 'home') { add('within30', cen, 3); add('per_sqmi', cen, 3); }
    if (ans.reach === 'site') add('within30', cen, 3);
    return mixString(items);
  };
  const changed = () => mixString(mixItems()) !== mixString(parseMix(surveyMix(answers())));
  const factorName = (f, it) => (f.label.includes('{age}') ? f.label.replace('{age}', ageText(it.age))
    : f.label + (it.age !== 'All' ? ', ' + ageLabel(it.age).toLowerCase() : ''));
  const selectedGeoid = (ranked) => {
    const g = dash.params().county;
    if (g && ranked.some((r) => r.geoid === g)) return g;
    return ranked[0] ? ranked[0].geoid : null;
  };
  const marketLines = (r, src) => {
    const w = 'geoid=' + r.geoid, a = ageText(aud());
    return [
      ['Fit score:', r.score == null ? 'no score' : String(r.score), src, 'score', w],
      [`Residents ${a}:`, num(r.residents), src, 'residents', w],
      [`Residents ${a} within 30 miles:`, num(r.within30), src, 'within30', w],
      [`Residents ${a} per sq mi:`, density(r.per_sqmi), src, 'per_sqmi', w],
    ];
  };
  return {
    WEIGHT, shares, PAYERS, UNIT, info, ages, age, ageLabel, unitText, lc, fmt, tick, density, pctText, num, c0, seq, mark, empty, statusOf,
    showTip, interact, shapesById, shapeMap, parseMix, mixString, mixItems, mixKey, aud, ageText, answers, urbanAge, surveyMix, changed, factorName,
    selectedGeoid, marketLines, search: '', mlarge: false,
    fillAge: (id, age) => (AGE_FILL[id] || {})[age],
  };
})();
