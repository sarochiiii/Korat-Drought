/**
 * 412345 Internet Mapping — Lab: Korat Drought WebMap
 * ---------------------------------------------------------------
 * Step 1 (Google Earth Engine)
 *   Compute drought indices for Nakhon Ratchasima (2015–2025):
 *     VCI  Vegetation Condition Index    (MODIS MOD13Q1 NDVI, 250 m)
 *     TCI  Temperature Condition Index   (MODIS MOD11A2 LST Day, 1 km)
 *     VHI  Vegetation Health Index = 0.5*VCI + 0.5*TCI   (Kogan, 1995)
 *     SPA  Standardized Precipitation Anomaly (CHIRPS Daily)
 *          SPA = (P_year - mean(P)) / sd(P), per pixel
 *   and export web-ready files:
 *     1) korat_drought_districts.geojson  (district means, every year)
 *     2) korat_drought_province.csv       (province means, every year)
 *     3) PNG overlays in EPSG:3857 (VHI per year, water, land cover,
 *        drought-affected cropland) — links appear in the Console
 *
 * Notes
 *   - VCI/TCI use the per-pixel min/max across START_YEAR..END_YEAR,
 *     so values are relative to this period only.
 *   - No QA-band masking is applied (kept simple for teaching).
 *   - Season must be within one calendar year (START_MONTH <= END_MONTH).
 *   - Results will NOT be identical to other apps that use different
 *     composites, periods, or masks.
 */

// ========================= CONFIG =========================
// District boundaries uploaded as a GEE Table asset
// (data/korat_districts_shp.zip in the template repo).
// The instructor uploads once and shares it as "Anyone can read".
var DISTRICT_ASSET = 'projects/ee-sarochineek/assets/Amhoe_NR';

// Field names in DISTRICT_ASSET (check "ฟิลด์ใน asset" in the Console
// after the first Run, then edit these 3 lines to match).
// If a field is not found: code -> system:index, names -> code.
var FIELD_CODE = 'amp_code';   // รหัสอำเภอ
var FIELD_TH   = 'amp_th';     // ชื่ออำเภอภาษาไทย
var FIELD_EN   = 'amp_en';     // ชื่ออำเภอภาษาอังกฤษ

var START_YEAR  = 2015;
var END_YEAR    = 2025;
var START_MONTH = 1;    // 1–12
var END_MONTH   = 12;   // 1–12  (e.g. 1–4 = dry season Jan–Apr)
var AFFECTED_YEAR = 2018;   // year for the "affected cropland" layer
var AFFECTED_VHI  = 40;     // VHI threshold (VHI < 40 = drought)

var SCALE = 1000;           // m, zonal statistics
var EXPORT_FOLDER = 'korat_drought_webmap';

// Fixed bounding box [W, S, E, N] — MUST equal CONFIG.bbox in docs/app.js
var BBOX = [101.15, 14.10, 103.05, 15.83];
var PNG_WIDTH = 1200;       // px
// ==========================================================

// Fallback: if DISTRICT_ASSET is still the placeholder, use FAO GAUL level 2
// (English names only; boundaries may differ from the 32-district asset).
var USE_GAUL = DISTRICT_ASSET.indexOf('YOUR_CLOUD_PROJECT') !== -1;
var districts = USE_GAUL
  ? ee.FeatureCollection('FAO/GAUL/2015/level2')
      .filter(ee.Filter.eq('ADM1_NAME', 'Nakhon Ratchasima'))
      .map(function (f) {
        return f.set({
          amp_code: ee.Number(f.get('ADM2_CODE')).format('%d'),
          amp_th: f.get('ADM2_NAME'),   // GAUL has no Thai names
          amp_en: f.get('ADM2_NAME')
        });
      })
  : ee.FeatureCollection(DISTRICT_ASSET).map(function (f) {
      // Map the asset's own field names onto the web map's data contract
      var code = ee.Algorithms.String(ee.Algorithms.If(
                   f.get(FIELD_CODE), f.get(FIELD_CODE), f.get('system:index')));
      var th = ee.Algorithms.If(f.get(FIELD_TH), f.get(FIELD_TH), code);
      var en = ee.Algorithms.If(f.get(FIELD_EN), f.get(FIELD_EN), th);
      return f.set({amp_code: code, amp_th: th, amp_en: en});
    });
if (!USE_GAUL) {
  print('ฟิลด์ใน asset (ใช้ตั้งค่า FIELD_CODE / FIELD_TH / FIELD_EN):',
        ee.FeatureCollection(DISTRICT_ASSET).first().propertyNames());
  print('ตัวอย่างชื่ออำเภอหลัง mapping:', districts.limit(5).aggregate_array('amp_th'));
}
print(USE_GAUL ? '⚠ ใช้ขอบเขต FAO GAUL (ชั่วคราว) — ควรอัปโหลด asset ขอบเขต 32 อำเภอ'
               : 'ใช้ขอบเขตจาก asset: ' + DISTRICT_ASSET);
var province  = districts.geometry().dissolve(100);
var region    = ee.Geometry.Rectangle(BBOX, 'EPSG:4326', false);

// ---------- Permanent water mask (JRC GSW occurrence >= 75 %) ----------
var waterOcc  = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence');
var water     = waterOcc.gte(75).selfMask().clip(province);
var landMask  = waterOcc.gte(75).unmask(0).not();

// ---------- Helpers ----------
function seasonStart(y) { return ee.Date.fromYMD(y, START_MONTH, 1); }
function seasonEnd(y)   { return ee.Date.fromYMD(y, END_MONTH, 1).advance(1, 'month'); }

function ndviOf(y) {
  return ee.ImageCollection('MODIS/061/MOD13Q1')
    .filterDate(seasonStart(y), seasonEnd(y))
    .select('NDVI').mean().multiply(0.0001).rename('NDVI');
}
function lstOf(y) {
  return ee.ImageCollection('MODIS/061/MOD11A2')
    .filterDate(seasonStart(y), seasonEnd(y))
    .select('LST_Day_1km').mean().multiply(0.02).subtract(273.15).rename('LST');
}
function rainOf(y) {
  return ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
    .filterDate(seasonStart(y), seasonEnd(y))
    .select('precipitation').sum().rename('P');
}

// ---------- Build yearly collections (client-side loop) ----------
var yearsJS = [];
for (var y = START_YEAR; y <= END_YEAR; y++) { yearsJS.push(y); }

var ndviCol = ee.ImageCollection(yearsJS.map(ndviOf));
var lstCol  = ee.ImageCollection(yearsJS.map(lstOf));
var rainCol = ee.ImageCollection(yearsJS.map(rainOf));

var ndviMin = ndviCol.min(),  ndviMax = ndviCol.max();
var lstMin  = lstCol.min(),   lstMax  = lstCol.max();
var pMean   = rainCol.mean(), pSd     = rainCol.reduce(ee.Reducer.stdDev());

function indicesOf(y) {
  var vci = ndviOf(y).subtract(ndviMin).divide(ndviMax.subtract(ndviMin))
              .multiply(100).rename('VCI');
  var tci = lstMax.subtract(lstOf(y)).divide(lstMax.subtract(lstMin))
              .multiply(100).rename('TCI');
  var vhi = vci.multiply(0.5).add(tci.multiply(0.5)).rename('VHI');
  var spa = rainOf(y).subtract(pMean).divide(pSd).rename('SPA');
  return vci.addBands([tci, vhi, spa]).updateMask(landMask).clip(province);
}

var yearImages = {};
var stackBands = [];
var bandNames  = [];
yearsJS.forEach(function (y) {
  var img = indicesOf(y);
  yearImages[y] = img;
  var names = ['VCI_' + y, 'TCI_' + y, 'VHI_' + y, 'SPA_' + y];
  bandNames = bandNames.concat(names);
  stackBands.push(img.select(['VCI', 'TCI', 'VHI', 'SPA'], names));
});
var stack = ee.Image.cat(stackBands);

// ---------- 1) District statistics -> GeoJSON ----------
var districtStats = stack.reduceRegions({
  collection: districts.map(function (f) { return f.simplify(100); }),
  reducer: ee.Reducer.mean(),
  scale: SCALE,
  tileScale: 4
}).map(function (f) {
  var rounded = f.toDictionary(bandNames).map(function (k, v) {
    return ee.Number(v).multiply(1000).round().divide(1000);
  });
  return f.set(rounded);
}).select(['amp_code', 'amp_th', 'amp_en'].concat(bandNames));

Export.table.toDrive({
  collection: districtStats,
  description: 'korat_drought_districts',
  folder: EXPORT_FOLDER,
  fileNamePrefix: 'korat_drought_districts',
  fileFormat: 'GeoJSON'
});

// ---------- 2) Province statistics -> CSV ----------
var provRows = yearsJS.map(function (y) {
  var d = yearImages[y].reduceRegion({
    reducer: ee.Reducer.mean(), geometry: province,
    scale: SCALE, maxPixels: 1e10, tileScale: 4
  });
  return ee.Feature(null, d).set('year', y);
});
Export.table.toDrive({
  collection: ee.FeatureCollection(provRows),
  description: 'korat_drought_province',
  folder: EXPORT_FOLDER,
  fileNamePrefix: 'korat_drought_province',
  fileFormat: 'CSV',
  selectors: ['year', 'SPA', 'VCI', 'TCI', 'VHI']
});

// ---------- 3) PNG overlays (EPSG:3857, transparent outside data) ----------
// VHI classes (same breaks as the web map legend): <10, 10–20, 20–30, 30–40, >=40
var VHI_PALETTE = ['a50026', 'e34a33', 'fc8d59', 'fee08b', '66bd63'];
function vhiClass(img) {
  var v = img.select('VHI');
  return v.gte(10).add(v.gte(20)).add(v.gte(30)).add(v.gte(40))
          .updateMask(v.mask()).rename('cls');
}

// ESA WorldCover 2020 (10 m) — nearest available year to 2018
var wc = ee.ImageCollection('ESA/WorldCover/v100').first().clip(province);
var WC_VALUES  = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
var WC_PALETTE = ['006400', 'ffbb22', 'ffff4c', 'f096ff', 'fa0000', 'b4b4b4',
                  'f0f0f0', '0064c8', '0096a0', '00cf75', 'fae6a0'];
var wcIdx = wc.remap(WC_VALUES, ee.List.sequence(0, 10));

var cropland   = wc.eq(40);
var affected   = cropland.and(yearImages[AFFECTED_YEAR].select('VHI').lt(AFFECTED_VHI))
                         .selfMask();

function pngLink(visImage, fileName) {
  visImage.getThumbURL({
    region: region, dimensions: PNG_WIDTH, crs: 'EPSG:3857', format: 'png'
  }, function (url) {
    print(ui.Label('⬇ ' + fileName, {color: '0b7285'}, url));
  });
}

print('BBOX ที่ใช้ทำ PNG (ต้องตรงกับ app.js):', BBOX);
print('คลิกลิงก์ด้านล่างเพื่อดาวน์โหลด แล้วเปลี่ยนชื่อไฟล์ให้ตรงกับชื่อที่แสดง');
yearsJS.forEach(function (y) {
  pngLink(vhiClass(yearImages[y]).visualize({min: 0, max: 4, palette: VHI_PALETTE}),
          'vhi_' + y + '.png');
});
pngLink(water.visualize({palette: ['1f78b4']}), 'water.png');
pngLink(wcIdx.visualize({min: 0, max: 10, palette: WC_PALETTE}), 'landcover.png');
pngLink(affected.visualize({palette: ['d7301f']}), 'affected_' + AFFECTED_YEAR + '.png');

// ---------- Quick checks ----------
print('จำนวนอำเภอ:', districts.size());
print('ค่าเฉลี่ยจังหวัดรายปี (ตรวจสอบก่อน export):', ee.FeatureCollection(provRows));
print('พื้นที่เกษตรที่ VHI < ' + AFFECTED_VHI + ' ปี ' + AFFECTED_YEAR + ' (ตร.กม.):',
      affected.multiply(ee.Image.pixelArea()).divide(1e6).reduceRegion({
        reducer: ee.Reducer.sum(), geometry: province,
        scale: 100, maxPixels: 1e10, tileScale: 4
      }));

// ---------- Preview ----------
Map.centerObject(province, 9);
Map.addLayer(wcIdx, {min: 0, max: 10, palette: WC_PALETTE}, 'L1 Land cover (WorldCover 2020)', false);
Map.addLayer(vhiClass(yearImages[AFFECTED_YEAR]), {min: 0, max: 4, palette: VHI_PALETTE},
             'L2 VHI class ' + AFFECTED_YEAR);
Map.addLayer(affected, {palette: ['d7301f']}, 'L3 Affected cropland ' + AFFECTED_YEAR, false);
Map.addLayer(water, {palette: ['1f78b4']}, 'L1 Permanent water');
Map.addLayer(ee.Image().byte().paint(districts, 0, 1), {palette: ['222222']}, 'L1 Districts');
