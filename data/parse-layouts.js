// parse-layouts.js — parse NEW-SPEC-LAYOUT.md into a form schema (layouts.json)
// so the editor form stays in sync with the design doc.
const fs = require('fs');
const path = require('path');

const DOC = '/Users/marla/Desktop/Capital BBQ/Active - do not delete/Code & Apps/spec-export/NEW-SPEC-LAYOUT.md';
const OUT = path.join(__dirname, 'layouts.json');

const NAME_TO_SLUG = {
  'BBQs & Outdoor Cooking': 'bbq_outdoor_cooking',
  'Outdoor Kitchen': 'outdoor_kitchen',
  'Fireplaces & Patio': 'fireplaces_patio',
  'Accessories & Parts': 'accessories_parts',
  'Rubs & Sauces': 'rubs_sauces',
};
// groups we don't expose in the editor (internal/ops)
const SKIP_GROUPS = new Set(['Packaging']);
// facet label → stable facet key (only these rows carry a `key` when saved)
const FACET_KEYS = {
  'Series': 'series',
  'Fuel Type': 'fuel_type',
  'Grill Style': 'grill_style',
  'Configuration': 'configuration',
  'Side Burner Included': 'side_burner_included',
  'Rotisserie Included': 'rotisserie_included',
  'Wi-Fi Enabled': 'wifi_enabled',
  'Smoker Box Included': 'smoker_box_included',
  'Total Cooking Area (sq in)': 'total_cooking_area_sqin',
  'Total BTU': 'total_btu',
  'Total Number of Burners': 'total_burners',
  'Component Type': 'component_type',
  'Installation Type': 'installation_type',
  'Refrigerator Included': 'refrigerator_included',
  'Sink Included': 'sink_included',
  'Product Type': 'product_type',
  'Heat Source': 'heat_source',
  'Heating Space (sq ft)': 'heating_space_sqft',
  'Size': 'size_class',
};

const lines = fs.readFileSync(DOC, 'utf8').split('\n');
const layouts = {};
let curLayout = null, curGroup = null, started = false;

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  const mLayout = line.match(/^# LAYOUT \d+ — (.+)$/);
  if (mLayout) {
    started = true;
    const name = mLayout[1].trim();
    const slug = NAME_TO_SLUG[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    curLayout = { slug, name, groups: [] };
    layouts[slug] = curLayout;
    curGroup = null;
    continue;
  }
  if (!started || !curLayout) continue;
  const mGroup = line.match(/^## (.+)$/);
  if (mGroup) {
    let gname = mGroup[1].split(/\s{2,}\(|\s+\(/)[0].trim();
    if (SKIP_GROUPS.has(gname)) { curGroup = null; continue; }
    curGroup = { name: gname, fields: [] };
    curLayout.groups.push(curGroup);
    continue;
  }
  const mField = line.match(/^-\s+(.+?)\s+—\s+(text|num|bool)\b/);
  if (mField && curGroup) {
    const label = mField[1].trim();
    const type = mField[2];
    const facet = /★/.test(line);
    const field = { label, type };
    if (facet && FACET_KEYS[label]) field.key = FACET_KEYS[label];
    curGroup.fields.push(field);
  }
}

// prune empty groups
for (const l of Object.values(layouts)) l.groups = l.groups.filter(g => g.fields.length);

fs.writeFileSync(OUT, JSON.stringify(layouts, null, 2));
// summary
for (const [slug, l] of Object.entries(layouts)) {
  const fc = l.groups.reduce((n, g) => n + g.fields.length, 0);
  console.log(`${slug.padEnd(22)} ${l.groups.length} groups, ${fc} fields`);
}
console.log('→ wrote', OUT);
