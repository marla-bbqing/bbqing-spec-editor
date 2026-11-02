(function () {
  var LAYOUTS = {};
  var current = null;      // loaded product
  var statusEl = document.getElementById('status');

  // Every API call carries an App Bridge session token (JWT), verified server-side.
  async function authFetch(url, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    try {
      if (window.shopify && shopify.idToken) headers['Authorization'] = 'Bearer ' + (await shopify.idToken());
    } catch (e) { /* not embedded / dev */ }
    opts.headers = headers;
    return fetch(url, opts);
  }

  authFetch('/api/layouts').then(r => r.json()).then(d => { LAYOUTS = d; }).catch(() => {});

  // ---------- search ----------
  var q = document.getElementById('q');
  var results = document.getElementById('results');
  var t;
  q.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(search, 250);
  });
  function search() {
    var term = q.value.trim();
    authFetch('/api/search?q=' + encodeURIComponent(term))
      .then(r => r.json())
      .then(function (d) {
        results.innerHTML = '';
        (d.items || []).forEach(function (it) {
          var row = document.createElement('div');
          row.className = 'result';
          row.innerHTML =
            (it.image ? '<img src="' + it.image + '" alt="">' : '<img alt="">') +
            '<div class="r-main"><div class="r-title"></div>' +
            '<div class="r-sub"></div></div>' +
            '<span class="chip">' + (it.spec_layout || 'no layout') + '</span>' +
            '<span class="chip">' + it.rowCount + ' specs</span>';
          row.querySelector('.r-title').textContent = it.title;
          var sub = [it.sku, it.productType].filter(Boolean).join('  ·  ');
          row.querySelector('.r-sub').textContent = sub;
          row.addEventListener('click', function () { loadProduct(it.id); });
          results.appendChild(row);
        });
      });
  }

  // ---------- load ----------
  function loadProduct(id) {
    setStatus('Loading…');
    authFetch('/api/product/' + encodeURIComponent(id))
      .then(r => r.json())
      .then(function (p) {
        current = p;
        setStatus('');
        openEditor(p);
      })
      .catch(function (e) { setStatus('Error: ' + e); });
  }

  // ---------- editor ----------
  var editor = document.getElementById('editor');
  var titleEl = document.getElementById('p-title');
  var linkEl = document.getElementById('p-link');
  var layoutSel = document.getElementById('layout');
  var form = document.getElementById('form');

  function openEditor(p) {
    titleEl.textContent = p.title;
    linkEl.href = 'https://bbqing.com/products/' + p.handle;
    // layout options
    layoutSel.innerHTML = '';
    Object.keys(LAYOUTS).forEach(function (slug) {
      var o = document.createElement('option');
      o.value = slug; o.textContent = LAYOUTS[slug].name;
      layoutSel.appendChild(o);
    });
    layoutSel.value = LAYOUTS[p.spec_layout] ? p.spec_layout : Object.keys(LAYOUTS)[0];
    renderForm(valuesFromSpecs(p.specifications));
    editor.hidden = false;
    document.getElementById('save-msg').textContent = '';
    editor.scrollIntoView({ behavior: 'smooth' });
  }

  layoutSel.addEventListener('change', function () {
    renderForm(readForm()); // preserve entered values when switching layout
  });

  // build a label -> {value, key} map from stored rows
  function valuesFromSpecs(specs) {
    var m = {};
    (specs || []).forEach(function (r) { m[r.label] = { value: r.value, key: r.key, group: r.group }; });
    return m;
  }

  function renderForm(values) {
    var layout = LAYOUTS[layoutSel.value];
    form.innerHTML = '';
    var usedLabels = {};
    layout.groups.forEach(function (g) {
      var section = document.createElement('div');
      section.className = 'group';
      section.innerHTML = '<h3>' + g.name + '</h3>';
      var grid = document.createElement('div');
      grid.className = 'grid';
      g.fields.forEach(function (f) {
        usedLabels[f.label] = true;
        grid.appendChild(fieldEl(g.name, f, values[f.label]));
      });
      section.appendChild(grid);
      form.appendChild(section);
    });
    // preserve any extra stored rows not in this layout
    var extras = Object.keys(values).filter(function (l) { return !usedLabels[l]; });
    if (extras.length) {
      var section = document.createElement('div');
      section.className = 'group';
      section.innerHTML = '<h3>Other (kept from existing data)</h3>';
      var grid = document.createElement('div'); grid.className = 'grid';
      extras.forEach(function (l) {
        var v = values[l];
        grid.appendChild(fieldEl(v.group || 'Other', { label: l, type: 'text', key: v.key }, v));
      });
      section.appendChild(grid); form.appendChild(section);
    }
  }

  function fieldEl(group, f, v) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.group = group;
    wrap.dataset.label = f.label;
    if (f.key) wrap.dataset.key = f.key;
    wrap.dataset.type = f.type;
    var val = v ? v.value : '';
    var lab = '<label>' + f.label + (f.key ? '<span class="facet">★ filter</span>' : '') + '</label>';
    var input;
    if (f.type === 'bool') {
      input = '<select><option value="">—</option><option value="Yes"' + (val === 'Yes' ? ' selected' : '') +
        '>Yes</option><option value="No"' + (val === 'No' ? ' selected' : '') + '>No</option></select>';
    } else {
      var t = f.type === 'num' ? 'text' : 'text';
      input = '<input type="' + t + '" value="' + escapeAttr(val) + '">';
    }
    wrap.innerHTML = lab + input;
    if (val) wrap.classList.add('filled');
    var el = wrap.querySelector('input,select');
    el.addEventListener('input', function () { wrap.classList.toggle('filled', !!el.value); });
    return wrap;
  }

  // read current form into a label -> {value,key,group} map
  function readForm() {
    var m = {};
    form.querySelectorAll('.field').forEach(function (w) {
      var el = w.querySelector('input,select');
      var val = (el.value || '').trim();
      if (val) m[w.dataset.label] = { value: val, key: w.dataset.key, group: w.dataset.group };
    });
    return m;
  }

  // ---------- save ----------
  document.getElementById('save').addEventListener('click', function () {
    var btn = this; btn.disabled = true;
    var msg = document.getElementById('save-msg'); msg.className = 'save-msg'; msg.textContent = 'Saving…';
    var rows = [];
    form.querySelectorAll('.field').forEach(function (w) {
      var el = w.querySelector('input,select');
      var val = (el.value || '').trim();
      if (!val) return;
      var row = { group: w.dataset.group, label: w.dataset.label, value: val };
      if (w.dataset.key) row.key = w.dataset.key;
      rows.push(row);
    });
    authFetch('/api/product/' + encodeURIComponent(current.id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_layout: layoutSel.value, specifications: rows }),
    })
      .then(r => r.json())
      .then(function (d) {
        btn.disabled = false;
        if (d.error) { msg.className = 'save-msg err'; msg.textContent = 'Error: ' + d.error; }
        else { msg.className = 'save-msg ok'; msg.textContent = 'Saved ' + d.saved + ' specs ✓'; }
      })
      .catch(function (e) { btn.disabled = false; msg.className = 'save-msg err'; msg.textContent = 'Error: ' + e; });
  });

  document.getElementById('cancel').addEventListener('click', function () { editor.hidden = true; });

  function setStatus(s) { statusEl.textContent = s; }
  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

  search(); // initial (empty) list
})();
