# Korat Drought WebMap — แผนที่ภัยแล้งจังหวัดนครราชสีมา

Template repository สำหรับปฏิบัติการรายวิชา **412345 Internet Mapping**
การพัฒนา Web Map ด้วย Google Earth Engine (GEE) + GitHub Codespaces + MapLibre GL JS + GitHub Pages

```
GEE (คำนวณ VCI/TCI/VHI/SPA) ──► Google Drive ──► GitHub repo (docs/data)
                                                     │
                       Codespaces (แก้โค้ด + preview) ┘──► GitHub Pages (เผยแพร่)
```

> ⚠ ไฟล์ `docs/data/demo_*.geojson` เป็น **ข้อมูลจำลอง (synthetic)** สำหรับทดสอบหน้าเว็บเท่านั้น
> ค่าเฉลี่ยจังหวัดใน `demo_province.csv` ปี 2015–2024 คัดลอกจาก GEE App ของผู้สอน
> ต้องแทนที่ด้วยไฟล์ที่ export จากสคริปต์ GEE ก่อนนำไปแปลผล

## โครงสร้าง

| Path | หน้าที่ |
|---|---|
| `gee/01_export_drought.js` | สคริปต์ GEE คำนวณดัชนีและ export GeoJSON / CSV / PNG |
| `data/korat_districts_shp.zip` | ขอบเขต 32 อำเภอ สำหรับอัปโหลดเป็น GEE Table asset |
| `docs/index.html`, `app.js`, `style.css` | Web map (root ของ GitHub Pages) |
| `docs/data/` | ไฟล์ข้อมูลที่ Web map อ่าน |
| `docs/data/png/` | PNG overlays จาก GEE (`vhi_YYYY.png`, `water.png`, `landcover.png`, `affected_2018.png`) |
| `processing/to_pmtiles.sh` | (Extension) แปลง GeoJSON เป็น PMTiles |
| `.devcontainer/` | การตั้งค่า GitHub Codespaces |

## ขั้นตอนโดยย่อ

1. กด **Use this template → Create a new repository** (ตั้งเป็น Public)
2. **Code → Codespaces → Create codespace on main**
3. Preview: `cd docs && python3 -m http.server 8000` แล้วเปิดแท็บ Ports → 8000
4. รัน `gee/01_export_drought.js` ใน GEE Code Editor → Tasks → Run ทั้ง 2 งาน และดาวน์โหลด PNG จาก Console
5. นำไฟล์จาก Drive ไปวางใน `docs/data/` และ `docs/data/png/`
6. แก้ `CONFIG` ใน `docs/app.js`:
   ```js
   demo: false,
   districtsUrl: 'data/korat_drought_districts.geojson',
   provinceUrl:  'data/korat_drought_province.csv',
   ```
7. `git add . && git commit -m "Add real drought data" && git push`
8. **Settings → Pages → Branch: main / folder: /docs → Save** แล้วรอ 1–2 นาที

## ข้อตกลงของข้อมูล (Data contract)

- District GeoJSON: ต้องมี `amp_code`, `amp_th` และฟิลด์ `{INDEX}_{YEAR}` เช่น `VHI_2018`, `SPA_2016`
- Province CSV: คอลัมน์ `year,SPA,VCI,TCI,VHI`
- PNG: EPSG:3857 ครอบคลุม `BBOX = [101.15, 14.10, 103.05, 15.83]` ซึ่งต้องตรงกันทั้งใน GEE และ `app.js`

## Extension: PMTiles

```bash
./processing/to_pmtiles.sh
```
จากนั้นเพิ่ม `<script src="https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js"></script>` และเปลี่ยน source เป็น
```js
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
map.addSource('districts', { type: 'vector',
  url: 'pmtiles://data/korat_drought_districts.pmtiles', promoteId: 'amp_code' });
// ทุก layer ต้องเพิ่ม 'source-layer': 'korat_drought_districts'
```
(vector source ไม่รองรับ `generateId` จึงใช้ `promoteId` แทนสำหรับ hover)

## แหล่งข้อมูลและสัญญาอนุญาต

- ขอบเขตอำเภอ: [OpenGISData-Thailand](https://github.com/chingchai/OpenGISData-Thailand) (CC BY 4.0) — ลดความละเอียดเส้นขอบ (simplify) เพื่อใช้บนเว็บ
- MODIS MOD13Q1 / MOD11A2 (NASA LP DAAC), CHIRPS Daily (UCSB-CHG), JRC Global Surface Water, ESA WorldCover 2020 — ผ่าน Google Earth Engine
- แผนที่ฐาน: © OpenStreetMap contributors © CARTO
- ไลบรารี: MapLibre GL JS 4.7.1 (BSD-3), Chart.js 4.4.1 (MIT)

## ข้อจำกัดเชิงวิธีการ

- VCI/TCI อิงค่าต่ำสุด–สูงสุดของช่วงปี 2015–2025 เท่านั้น ไม่ใช่ climatology ระยะยาว
- ไม่ได้กรอง QA band ของ MODIS และใช้ WorldCover 2020 แทนการใช้ที่ดินปี 2018
- ค่าที่ได้อาจไม่เท่ากับ GEE App อื่นที่ใช้ช่วงเวลา composite หรือ mask ต่างกัน
