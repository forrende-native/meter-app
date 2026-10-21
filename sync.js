// ===== Google Sheet sync (outbox queue, works offline, retries when online) =====
// ตั้งค่า URL ของ Apps Script Web App ที่ deploy แล้ว (ลงท้ายด้วย /exec)
// ปล่อยว่างไว้ = ปิดการ sync (แอปยังใช้งานออฟไลน์ได้ปกติ)
const SHEET_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyCBp1Si7VkhekLIH2t1PAe4UpXelHzs3YTgyUdE555slItPnVg4igMiI-rckWd4H9_/exec';

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
  if (!SHEET_WEBAPP_URL) return; // sync ปิดอยู่
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
  trySyncNow();
}

let syncInFlight = false;

async function trySyncNow() {
  if (!SHEET_WEBAPP_URL) return;
  if (syncInFlight) return;
  if (!navigator.onLine) return;
  const queue = loadSyncQueue();
  if (queue.length === 0) return;

  syncInFlight = true;
  try {
    const resp = await fetch(SHEET_WEBAPP_URL, {
      method: 'POST',
      // ใช้ text/plain เพื่อเลี่ยง CORS preflight (Apps Script Web App ไม่รองรับ OPTIONS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(queue),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      if (data && data.ok) {
        saveSyncQueue([]); // ส่งสำเร็จ ล้างคิว
        if (typeof toast === 'function' && queue.length > 0) {
          toast(`ซิงก์ขึ้น Google Sheet แล้ว (${queue.length} รายการ)`);
        }
      }
    }
  } catch (err) {
    // ไม่มีเน็ต/ส่งไม่สำเร็จ — เก็บไว้ในคิว รอรอบถัดไป
  } finally {
    syncInFlight = false;
    updateSyncBadge();
  }
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
