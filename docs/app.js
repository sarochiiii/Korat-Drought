/* =============================================================
 * Korat Drought WebMap — MapLibre GL JS 4.7.1 + Chart.js 4.4.1
 * 412345 Internet Mapping
 * -------------------------------------------------------------
 * ส่วนที่ 1  CONFIG              ← นักศึกษาแก้ส่วนนี้หลัง export จาก GEE
 * ส่วนที่ 2  Index definitions    (ช่วงชั้น สี คำอธิบาย)
 * ส่วนที่ 3  Map + basemap
 * ส่วนที่ 4  Data loading
 * ส่วนที่ 5  Layers (vector + PNG overlays)
 * ส่วนที่ 6  Interaction (slider, popup, hover)
 * ส่วนที่ 7  Legend + chart
 * ============================================================= */

/* ---------- ส่วนที่ 1 CONFIG ---------- */
const CONFIG = {
  demo: false,                                   // false เมื่อใช้ข้อมูลจริง
  districtsUrl: 'data/demo_districts.geojson',  // → 'data/korat_drought_districts.geojson'
  provinceUrl:  'data/demo_province.csv',       // → 'data/korat_drought_province.csv'
  pngDir: 'data/png/',
  bbox: [101.15, 14.10, 103.05, 15.83],         // ต้องตรงกับ BBOX ในสคริปต์ GEE
  nameField: 'amp_th',
  affectedYear: 2018,
  startIndex: 'VHI',
  startYear: 2018
};

/* ---------- ส่วนที่ 2 Index definitions ---------- */
const CONDITION_CLASSES = {          // ใช้กับ VCI / TCI / VHI (0–100)
  breaks: [10, 20, 30, 40],
  colors: ['#a50026', '#e34a33', '#fc8d59', '#fee08b', '#66bd63'],
  labels: ['< 10 แล้งรุนแรงมาก', '10–20 แล้งรุนแรง', '20–30 แล้งปานกลาง',
           '30–40 แล้งเล็กน้อย', '≥ 40 ไม่แล้ง']
};
const INDICES = {
  VHI: { ...CONDITION_CLASSES, name: 'Vegetation Health Index',
         desc: 'VHI = 0.5·VCI + 0.5·TCI ค่าต่ำ = พืชพรรณอยู่ในภาวะเครียดจากความแห้งแล้ง' },
  VCI: { ...CONDITION_CLASSES, name: 'Vegetation Condition Index',
         desc: 'เทียบ NDVI ของปีนั้นกับค่าต่ำสุด–สูงสุดในช่วงปีศึกษา ค่าต่ำ = พืชพรรณแย่กว่าปกติ' },
  TCI: { ...CONDITION_CLASSES, name: 'Temperature Condition Index',
         desc: 'เทียบ LST ของปีนั้นกับช่วงปีศึกษา ค่าต่ำ = ร้อนกว่าปกติ (0 ร้อนผิดปกติ, 100 เย็น)' },
  SPA: { name: 'Standardized Precipitation Anomaly',
         breaks: [-2, -1.5, -1, 1, 1.5],
         colors: ['#8c510a', '#d8b365', '#f6e8c3', '#f5f5f5', '#9ecae1', '#3182bd'],
         labels: ['≤ −2 แห้งมากผิดปกติ', '−2 ถึง −1.5 แห้งมาก', '−1.5 ถึง −1 แห้ง',
                  '−1 ถึง 1 ใกล้ปกติ', '1 ถึง 1.5 ชื้น', '≥ 1.5 ชื้นมาก'],
         desc: 'SPA = (ฝนสะสมปีนั้น − ค่าเฉลี่ย) / ส่วนเบี่ยงเบนมาตรฐาน ค่าลบ = ฝนน้อยกว่าปกติ' }
};

const state = { index: CONFIG.startIndex, year: CONFIG.startYear, years: [],
                selected: null, timer: null, data: null, province: [] };

/* ---------- ส่วนที่ 3 Map + basemap ---------- */
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      carto: {
        type: 'raster', tileSize: 256,
        tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
        attribution: '© OpenStreetMap contributors © CARTO'
      }
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'carto' }]
  },
  bounds: [[CONFIG.bbox[0], CONFIG.bbox[1]], [CONFIG.bbox[2], CONFIG.bbox[3]]],
  fitBoundsOptions: { padding: 30 }
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

/* ---------- ส่วนที่ 4 Data loading ---------- */
async function loadCSV(url) {
  const text = await (await fetch(url)).text();
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map(s => s.trim());
  return rows.map(r => {
    const v = r.split(',');
    const o = {};
    cols.forEach((c, i) => { o[c] = Number(v[i]); });
    return o;
  }).sort((a, b) => a.year - b.year);
}
async function exists(url) {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch (e) { return false; }
}
const pngCorners = () => {
  const [w, s, e, n] = CONFIG.bbox;
  return [[w, n], [e, n], [e, s], [w, s]];
};
const prop = () => `${state.index}_${state.year}`;

/* ---------- ส่วนที่ 5 Layers ---------- */
function fillColorExpr() {
  const d = INDICES[state.index];
  const step = ['step', ['get', prop()], d.colors[0]];
  d.breaks.forEach((b, i) => step.push(b, d.colors[i + 1]));
  return ['case', ['==', ['typeof', ['get', prop()]], 'number'], step, '#bdbdbd'];
}

const OVERLAYS = [  // PNG overlays from GEE (optional — skipped if file not found)
  { id: 'landcover', label: 'L1 การใช้ประโยชน์ที่ดิน (WorldCover 2020)', file: () => 'landcover.png', on: false, opacity: 0.85 },
  { id: 'vhi-raster', label: 'L2 VHI ระดับจุดภาพ (ตามปีที่เลือก)', file: () => `vhi_${state.year}.png`, on: false, opacity: 0.9 },
  { id: 'affected', label: `L3 เกษตรที่ได้รับผลกระทบ ${CONFIG.affectedYear}`, file: () => `affected_${CONFIG.affectedYear}.png`, on: false, opacity: 1 },
  { id: 'water', label: 'L1 แหล่งน้ำถาวร', file: () => 'water.png', on: true, opacity: 1 }
];

async function addOverlays() {
  for (const o of OVERLAYS) {
    o.available = await exists(CONFIG.pngDir + o.file());
    if (!o.available) continue;
    map.addSource(o.id, { type: 'image', url: CONFIG.pngDir + o.file(), coordinates: pngCorners() });
    map.addLayer({ id: o.id, type: 'raster', source: o.id,
                   paint: { 'raster-opacity': o.opacity, 'raster-resampling': 'nearest' },
                   layout: { visibility: o.on ? 'visible' : 'none' } }, 'district-line');
  }
}

function addVectorLayers() {
  map.addSource('districts', { type: 'geojson', data: state.data, generateId: true });
  map.addLayer({ id: 'district-fill', type: 'fill', source: 'districts',
    paint: { 'fill-color': fillColorExpr(), 'fill-opacity': 0.78 } });
  map.addLayer({ id: 'district-line', type: 'line', source: 'districts',
    paint: { 'line-color': '#222', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.2, 0.6] } });
}

function buildLayerList() {
  const items = [{ id: 'district-fill', label: 'L2 ดัชนีรายอำเภอ (choropleth)', on: true, available: true },
                 { id: 'district-line', label: 'L1 ขอบเขตอำเภอ', on: true, available: true },
                 ...OVERLAYS];
  document.getElementById('layerList').innerHTML = items.map(o => `
    <label class="layer-row">
      <input type="checkbox" data-id="${o.id}" ${o.on ? 'checked' : ''} ${o.available ? '' : 'disabled'}>
      ${o.label} ${o.available ? '' : '<span class="na">(ยังไม่มีไฟล์ PNG)</span>'}
    </label>`).join('');
  document.querySelectorAll('#layerList input').forEach(cb => cb.addEventListener('change', e => {
    map.setLayoutProperty(e.target.dataset.id, 'visibility', e.target.checked ? 'visible' : 'none');
  }));
}

/* ---------- ส่วนที่ 6 Interaction ---------- */
function classOf(index, v) {
  if (typeof v !== 'number') return 'ไม่มีข้อมูล';
  const d = INDICES[index];
  let i = 0; while (i < d.breaks.length && v >= d.breaks[i]) i++;
  return d.labels[i];
}
function fmt(v, dp = 2) { return typeof v === 'number' ? v.toFixed(dp) : '–'; }

function update() {
  document.getElementById('yearLabel').textContent = `${state.year} (พ.ศ. ${state.year + 543})`;
  document.getElementById('yearSlider').value = state.year;
  document.getElementById('indexDesc').textContent = INDICES[state.index].desc;
  document.querySelectorAll('#indexButtons button').forEach(b =>
    b.classList.toggle('active', b.dataset.idx === state.index));
  map.setPaintProperty('district-fill', 'fill-color', fillColorExpr());
  const vr = OVERLAYS.find(o => o.id === 'vhi-raster');
  if (vr.available) {
    exists(CONFIG.pngDir + vr.file()).then(ok => {
      if (ok) map.getSource('vhi-raster').updateImage({ url: CONFIG.pngDir + vr.file(), coordinates: pngCorners() });
    });
  }
  renderLegend();
  renderChart();
}

function bindControls() {
  document.getElementById('indexButtons').innerHTML = Object.keys(INDICES)
    .map(k => `<button data-idx="${k}" title="${INDICES[k].name}">${k}</button>`).join('');
  document.querySelectorAll('#indexButtons button').forEach(b =>
    b.addEventListener('click', () => { state.index = b.dataset.idx; update(); }));

  const slider = document.getElementById('yearSlider');
  slider.min = state.years[0]; slider.max = state.years[state.years.length - 1];
  slider.addEventListener('input', e => { state.year = Number(e.target.value); update(); });

  const btn = document.getElementById('playBtn');
  btn.addEventListener('click', () => {
    if (state.timer) { clearInterval(state.timer); state.timer = null; btn.textContent = '▶'; return; }
    btn.textContent = '❚❚';
    state.timer = setInterval(() => {
      const i = state.years.indexOf(state.year);
      state.year = state.years[(i + 1) % state.years.length];
      update();
    }, 1200);
  });

  const tip = document.getElementById('tooltip');
  let hoverId = null;
  map.on('mousemove', 'district-fill', e => {
    const f = e.features[0];
    if (hoverId !== null) map.setFeatureState({ source: 'districts', id: hoverId }, { hover: false });
    hoverId = f.id;
    map.setFeatureState({ source: 'districts', id: hoverId }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
    tip.hidden = false;
    tip.style.left = (e.originalEvent.clientX + 12) + 'px';
    tip.style.top = (e.originalEvent.clientY + 12) + 'px';
    tip.textContent = `อ.${f.properties[CONFIG.nameField]} · ${state.index} ${fmt(f.properties[prop()])}`;
  });
  map.on('mouseleave', 'district-fill', () => {
    if (hoverId !== null) map.setFeatureState({ source: 'districts', id: hoverId }, { hover: false });
    hoverId = null; tip.hidden = true; map.getCanvas().style.cursor = '';
  });
  map.on('click', 'district-fill', e => {
    const p = e.features[0].properties;
    state.selected = p;
    tip.hidden = true;
    const y = state.year;
    const rows = ['VHI', 'VCI', 'TCI', 'SPA'].map(k =>
      `<tr><td>${k}</td><td><b>${fmt(p[`${k}_${y}`], k === 'SPA' ? 3 : 2)}</b></td></tr>`).join('');
    new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(e.lngLat).setHTML(`
      <div class="pop"><h3>อำเภอ${p[CONFIG.nameField]}</h3>
      <p>ปี ${y} · ${state.index}: <span class="cls">${classOf(state.index, p[prop()])}</span></p>
      <table>${rows}</table></div>`).addTo(map);
    renderChart();
  });
}

/* ---------- ส่วนที่ 7 Legend + chart ---------- */
function renderLegend() {
  const d = INDICES[state.index];
  document.getElementById('legend').innerHTML =
    `<p class="hint" style="margin:0 0 6px">${state.index} — ${d.name}</p>` +
    d.labels.map((l, i) => `<div class="legend-row"><span class="swatch" style="background:${d.colors[i]}"></span>${l}</div>`).join('') +
    `<div class="legend-row"><span class="swatch" style="background:#bdbdbd"></span>ไม่มีข้อมูล</div>`;
}

let chart;
function renderChart() {
  const k = state.index;
  document.getElementById('chartTitle').textContent = k;
  const labels = state.years;
  const prov = labels.map(y => (state.province.find(r => r.year === y) || {})[k] ?? null);
  const datasets = [{
    label: 'ค่าเฉลี่ยทั้งจังหวัด', data: prov, borderColor: '#111315', backgroundColor: '#111315',
    tension: 0.25, pointRadius: labels.map(y => (y === state.year ? 5 : 2))
  }];
  if (state.selected) {
    datasets.push({
      label: `อ.${state.selected[CONFIG.nameField]}`,
      data: labels.map(y => state.selected[`${k}_${y}`] ?? null),
      borderColor: '#00a9c6', backgroundColor: '#00a9c6', tension: 0.25,
      pointRadius: labels.map(y => (y === state.year ? 5 : 2))
    });
  }
  const yScale = k === 'SPA' ? { min: -2.5, max: 2.5 } : { min: 0, max: 100 };
  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: 'line', data: { labels, datasets },
    options: { animation: false, plugins: { legend: { labels: { boxWidth: 10, font: { family: 'Sarabun' } } } },
               scales: { y: yScale, x: { ticks: { font: { family: 'Sarabun' } } } } }
  });
}

/* ---------- Start ---------- */
map.on('load', async () => {
  const [geo, province] = await Promise.all([
    fetch(CONFIG.districtsUrl).then(r => r.json()),
    loadCSV(CONFIG.provinceUrl)
  ]);
  state.data = geo;
  state.province = province;
  const keys = Object.keys(geo.features[0].properties);
  state.years = [...new Set(keys.map(k => (k.match(/^VHI_(\d{4})$/) || [])[1]).filter(Boolean).map(Number))]
                .sort((a, b) => a - b);
  if (!state.years.includes(state.year)) state.year = state.years[0];
  document.getElementById('yearRangeTh').textContent =
    `${state.years[0] + 543}–${state.years[state.years.length - 1] + 543}`;
  document.getElementById('demoBanner').hidden = !CONFIG.demo;

  addVectorLayers();
  await addOverlays();
  buildLayerList();
  bindControls();
  update();
});
