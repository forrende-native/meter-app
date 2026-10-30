// ===== Google Sheet sync (outbox queue, works offline, retries when online) =====
// ตั้งค่า URL ของ Apps Script Web App ที่ deploy แล้ว (ลงท้ายด้วย /exec)
// ปล่อยว่างไว้ = ปิดการ sync (แอปยังใช้งานออฟไลน์ได้ปกติ)
const SHEET_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyCBp1Si7VkhekLIH2t1PAe4UpXelHzs3YTgyUdE555slItPnVg4igMiI-rckWd4H9_/exec';
// Shared-secret token ต้องตรงกับ SHARED_TOKEN ใน apps-script-project/Code.js ไม่งั้น endpoint ปฏิเสธ
// (กันคนอื่นที่เจอ URL endpoint นี้จาก view-source ยิงข้อมูลปลอมเข้า Sheet หรือดึงข้อมูลออกไปได้)
const SHEET_SYNC_TOKEN = 'Bh2Aql0PGVci1Mga9dxh9NfzSB0tBVkH';

const SYNC_QUEUE_KEY = 'meterapp_sync_queue_v1';

function loadSyncQueue() {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSyncQueue(queue) {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  updateSyncBadge();
}

function queueReadingForSync(reading, meter) {
  if (!SHEET_WEBAPP_URL) return Promise.resolve(false); // sync ปิดอยู่
  const queue = loadSyncQueue();
  queue.push({
    readingId: reading.id,
    building: meter ? (meter.building || '') : '',
    meterName: meter ? meter.name : '',
    type: meter ? meter.type : '',
    date: reading.date,
    prevValue: reading.prevValue,
    value: reading.value,
    consumed: Number(reading.consumed.toFixed(2)),
    rate: reading.rate,
    cost: Number(reading.cost.toFixed(2)),
    note: reading.note || '',
  });
  saveSyncQueue(queue);
  // รอผลจริงจากการยิงขึ้น Sheet ก่อน (ไม่ fire-and-forget) เพื่อบอกผู้ใช้ได้ทันทีว่าขึ้น Sheet แล้วจริงหรือยัง
  // ยังเข้าคิวไว้เหมือนเดิมเผื่อออฟไลน์/ยิงไม่สำเร็จ — trySyncNow จะลองใหม่อัตโนมัติทีหลัง
  return trySyncNow();
}

let syncInFlight = false;

async function trySyncNow() {
  if (!SHEET_WEBAPP_URL) return false;
  if (syncInFlight) return false;
  if (!navigator.onLine) return false;
  const queue = loadSyncQueue();
  if (queue.length === 0) return true; // ไม่มีอะไรค้าง ถือว่า "ขึ้น Sheet แล้ว" อยู่แล้ว

  syncInFlight = true;
  let success = false;
  try {
    const resp = await fetch(SHEET_WEBAPP_URL + '?token=' + encodeURIComponent(SHEET_SYNC_TOKEN), {
      method: 'POST',
      // ใช้ text/plain เพื่อเลี่ยง CORS preflight (Apps Script Web App ไม่รองรับ OPTIONS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(queue),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      if (data && data.ok) {
        saveSyncQueue([]); // ส่งสำเร็จ ล้างคิว
        success = true;
        refreshSheetLatestCache(); // อัปเดต cache เลขล่าสุดให้ตรงกับ Sheet หลัง sync สำเร็จ
      }
    }
  } catch (err) {
    // ไม่มีเน็ต/ส่งไม่สำเร็จ — เก็บไว้ในคิว รอรอบถัดไป
  } finally {
    syncInFlight = false;
    updateSyncBadge();
  }
  return success;
}

function updateSyncBadge() {
  const badge = document.getElementById('sheetSyncStatus');
  if (!badge) return;
  if (!SHEET_WEBAPP_URL) {
    badge.textContent = 'ยังไม่ได้ตั้งค่า Google Sheet sync';
    badge.style.display = 'block';
    return;
  }
  const pending = loadSyncQueue().length;
  if (pending === 0) {
    badge.textContent = 'ซิงก์ขึ้น Google Sheet ล่าสุดแล้ว ✓';
  } else {
    badge.textContent = `รอซิงก์ ${pending} รายการ${navigator.onLine ? ' (กำลังส่ง...)' : ' (ไม่มีเน็ต รอเชื่อมต่อ)'}`;
  }
  badge.style.display = 'block';
}

window.addEventListener('online', trySyncNow);
document.addEventListener('DOMContentLoaded', () => {
  updateSyncBadge();
  trySyncNow();
  // ลองซิงก์ซ้ำเป็นระยะ เผื่อ event 'online' ไม่ยิง (บาง browser/OS)
  setInterval(trySyncNow, 30000);
});

// ===== ดึงเลขล่าสุดต่อห้อง+ประเภท จาก Google Sheet มา cache ไว้ =====
// ตัดสินใจ (2026-10-23): ไม่ใช้ localStorage เป็นแหล่งอ้างอิง "เลขครั้งก่อน" อีกต่อไปเลย
// เพราะถ้าจดจากคนละเครื่อง/อุปกรณ์ แต่ละเครื่องมี localStorage แยกกัน ทำให้เครื่องที่ไม่เคยจด
// ห้องนั้นมาก่อนหาค่าก่อนหน้าไม่เจอ แล้วหลุดเป็น 0 (เกิดซ้ำหลายครั้ง เช่น ห้อง 409, ห้อง C2)
// ตอนนี้ Google Sheet เป็นแหล่งความจริงหนึ่งเดียวสำหรับ "เลขครั้งก่อน" ทุกเครื่องเห็นค่าตรงกันเสมอ
const SHEET_LATEST_CACHE_KEY = 'meterapp_sheet_latest_cache_v1';
const SHEET_LATEST_CACHE_META_KEY = 'meterapp_sheet_latest_cache_meta_v1';

function sheetLatestKey(building, meterName, type) {
  return (building || '') + '||' + (meterName || '') + '||' + type;
}

function loadSheetLatestCache() {
  try {
    const raw = localStorage.getItem(SHEET_LATEST_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSheetLatestCache(map) {
  localStorage.setItem(SHEET_LATEST_CACHE_KEY, JSON.stringify(map));
  localStorage.setItem(SHEET_LATEST_CACHE_META_KEY, JSON.stringify({ fetchedAt: new Date().toISOString() }));
}

// บอกว่าเคยดึงจาก Sheet สำเร็จอย่างน้อยหนึ่งครั้งไหม (ใช้ตัดสินว่าจะยอมให้บันทึกได้หรือต้องบล็อก)
function hasSheetCacheEverSucceeded() {
  try {
    const raw = localStorage.getItem(SHEET_LATEST_CACHE_META_KEY);
    return !!(raw && JSON.parse(raw).fetchedAt);
  } catch (e) {
    return false;
  }
}

function getSheetCacheFetchedAt() {
  try {
    const raw = localStorage.getItem(SHEET_LATEST_CACHE_META_KEY);
    return raw ? JSON.parse(raw).fetchedAt : null;
  } catch (e) {
    return null;
  }
}

// ดึง export ทั้งหมดจาก Sheet แล้วสรุปเหลือ "รายการล่าสุดต่อห้อง+ประเภท" เก็บเป็น cache
// เรียกตอนเปิดแอป/แท็บบันทึก/online/หลัง sync สำเร็จ — ยิ่งเรียกบ่อยยิ่งลดโอกาสคีย์ซ้ำ/เลขเพี้ยน
let sheetLatestFetchInFlight = false;
async function refreshSheetLatestCache() {
  if (!SHEET_WEBAPP_URL) return false;
  if (sheetLatestFetchInFlight) return false;
  if (!navigator.onLine) return false;
  sheetLatestFetchInFlight = true;
  let success = false;
  try {
    const resp = await fetch(SHEET_WEBAPP_URL + '?action=export&token=' + encodeURIComponent(SHEET_SYNC_TOKEN), { cache: 'no-store' });
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data || !data.ok || !Array.isArray(data.readings)) return false;

    const map = {};
    data.readings.forEach((r) => {
      const key = sheetLatestKey(r.building, r.meterName, r.type);
      const existing = map[key];
      // เทียบวันที่ล่าสุด ไม่ใช่ลำดับแถวในชีต (กันกรณีแถวไม่เรียงวันที่)
      if (!existing || (r.date || '') >= (existing.date || '')) {
        map[key] = { value: r.value, date: r.date || '' };
      }
    });
    saveSheetLatestCache(map);
    success = true;
    if (typeof updatePrevInfo === 'function') updatePrevInfo();
  } catch (err) {
    // ออฟไลน์/ดึงไม่สำเร็จ — ใช้ cache เดิมที่มีอยู่ต่อไป (ถ้ามี)
  } finally {
    sheetLatestFetchInFlight = false;
  }
  return success;
}

// คืนค่าล่าสุดของห้อง+ประเภทนี้จาก cache ของ Sheet (หรือ null ถ้าไม่เคยมี)
function getSheetLatestReading(building, meterName, type) {
  const map = loadSheetLatestCache();
  return map[sheetLatestKey(building, meterName, type)] || null;
}

document.addEventListener('DOMContentLoaded', () => {
  refreshSheetLatestCache();
});
window.addEventListener('online', refreshSheetLatestCache);
