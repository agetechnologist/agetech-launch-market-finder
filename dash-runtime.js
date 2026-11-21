/* Stand-in for the Claude dashboard engine, so the Launch Market Finder page runs as a plain website.
   It provides the parts of `dash` the page uses: data files, loaders, calcs, drawings, filters and links.
   Defaults and file paths come from window.DASH_CONFIG, written by build_site.py. */
(function () {
  const CONFIG = window.DASH_CONFIG || {datasets: {}, params: {}};
  const sources = {};      // id -> {status, data, columns, meta, message}
  const loaders = {};      // id -> {fn}
  const calcs = {};        // id -> {inputs, fn, cache, key, usesParams}
  const draws = new Map(); // name -> fn or {mount, update, unmount}
  const mounted = new WeakMap();
  const dataListeners = [];
  let params = JSON.parse(JSON.stringify(CONFIG.params || {}));
  let paramsVersion = 0;
  let tracking = null;
  let scheduled = false;

  const isRows = (v) => Array.isArray(v);

  function load(id) {
    if (sources[id]) return sources[id];
    const src = (sources[id] = {status: 'loading', data: [], columns: []});
    const url = CONFIG.datasets[id];
    if (!url) {
      src.status = 'error';
      src.message = 'No file for ' + id;
      return src;
    }
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.json(); })
      .then((json) => (loaders[id] ? loaders[id].fn({answer: json}) : json))
      .then((out) => {
        let data, meta, columns;
        if (isRows(out)) data = out;
        else if (out && isRows(out.data)) { data = out.data; meta = out.meta; columns = out.columns; }
        else if (out && isRows(out.rows)) { data = out.rows; meta = out.meta; columns = out.columns; }
        else data = out;
        src.data = data;
        src.meta = meta;
        src.columns = columns || (isRows(data) && data[0] ? Object.keys(data[0]) : []);
        src.status = 'ok';
        changed();
      })
      .catch((e) => {
        console.error('Could not load', id, e);
        src.status = 'error';
        src.message = String(e);
        changed();
      });
    return src;
  }

  function sameInputs(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
  }

  function runCalc(id) {
    const c = calcs[id];
    const ins = c.inputs.map((i) => data(i));
    if (ins.some((d) => d.status === 'error')) return {status: 'error', data: null};
    if (ins.some((d) => d.status !== 'ok')) return {status: 'loading', data: null};
    const inputData = ins.map((d) => d.data);
    const fresh = sameInputs(c.lastInputs, inputData) && (!c.usesParams || c.paramsVersion === paramsVersion);
    if (c.cache && fresh) return c.cache;
    const prev = tracking;
    tracking = c;
    c.usesParams = false;
    try {
      const value = c.fn(...inputData);
      c.cache = {status: 'ok', data: value, columns: isRows(value) && value[0] ? Object.keys(value[0]) : []};
    } catch (e) {
      console.error('Calc failed:', id, e);
      c.cache = {status: 'error', data: null, message: String(e)};
    } finally {
      tracking = prev;
    }
    c.lastInputs = inputData;
    c.paramsVersion = paramsVersion;
    return c.cache;
  }

  function data(id) {
    if (calcs[id]) return runCalc(id);
    return load(id);
  }

  function hiddenAncestor(el) {
    return Boolean(el.closest('[hidden]'));
  }

  function runDraw(name) {
    const d = draws.get(name);
    if (!d) return;
    document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => {
      if (hiddenAncestor(el)) return;
      try {
        if (typeof d === 'function') d(el);
        else {
          let made = mounted.get(el);
          if (made === undefined) { el.replaceChildren(); made = d.mount ? d.mount(el) : null; mounted.set(el, made); }
          if (d.update) d.update(el, made);
        }
      } catch (e) {
        console.error('Drawing failed:', name, e);
      }
    });
  }

  function runAll() {
    scheduled = false;
    dataListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    draws.forEach((_, name) => runDraw(name));
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // A timer, not requestAnimationFrame: animation frames pause in background tabs.
    setTimeout(runAll, 16);
  }

  function changed() { schedule(); }

  window.dash = {
    data,
    loader(id, o) { loaders[id] = o; },
    calc(id, o) { calcs[id] = {inputs: o.inputs || [], fn: o.fn, title: o.title}; },
    draw(name, fn) {
      if (fn === undefined) { runDraw(name); return; }
      draws.set(name, fn);
    },
    onData(fn) { dataListeners.push(fn); try { fn(); } catch (e) { console.error(e); } },
    params() { if (tracking) tracking.usesParams = true; return {...params}; },
    setParams(obj) {
      Object.entries(obj || {}).forEach(([k, v]) => { if (v === null || v === undefined) delete params[k]; else params[k] = v; });
      paramsVersion += 1;
      changed();
    },
    resetParams() { params = JSON.parse(JSON.stringify(CONFIG.params || {})); paramsVersion += 1; changed(); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ } },
    refresh() { /* files only; nothing to re-run */ },
    colors: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'],
  };

  // Redraw when a tab or section is shown, and when the page width changes.
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver((list) => { if (list.some((m) => m.attributeName === 'hidden')) schedule(); })
      .observe(document.body, {attributes: true, attributeFilter: ['hidden'], subtree: true});
    let lastWidth = document.documentElement.clientWidth;
    new ResizeObserver(() => {
      const w = document.documentElement.clientWidth;
      if (w !== lastWidth) { lastWidth = w; schedule(); }
    }).observe(document.documentElement);
    schedule();
  });
})();
