// ===== Storage =====
const DB_KEY = 'meterapp_db_v1';

// อัตรา/ขั้นต่ำกลาง — ต้องตรงกับระบบ dorm (D:\...\dorm, db.config ใน app.js ของ dorm) เสมอ
// ถ้าแก้เรทที่ dorm ต้องมาแก้ตรงนี้ด้วยมือให้ตรงกัน (ไม่ได้ sync กันอัตโนมัติ)
const DEFAULT_CONFIG = { waterRate: 19, electricRate: 9, waterMinimum: 95, electricMinimum: 180 };

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    const parsed = raw ? JSON.parse(raw) : { meters: [], readings: [] };
    if (!parsed.config) parsed.config = { ...DEFAULT_CONFIG };
    if (!parsed.meters) parsed.meters = [];
    if (!parsed.readings) parsed.readings = [];
    return parsed;
  } catch (e) {
    return { meters: [], readings: [], config: { ...DEFAULT_CONFIG } };
  }
}
function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}
let db = loadDB();

// คำนวณค่าใช้จ่ายพร้อมขั้นต่ำ (เหมือนสูตรที่ dorm ใช้: Math.max(ขั้นต่ำ, หน่วย*เรท))
function calcCost(type, consumed, rate) {
  const raw = consumed * rate;
  const minimum = type === 'water' ? db.config.waterMinimum : db.config.electricMinimum;
  return Math.max(minimum, raw);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ===== Toast =====
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ===== Tabs =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'history') renderHistory();
    if (btn.dataset.tab === 'meters') renderMeterList();
    if (btn.dataset.tab === 'readings') { populateBuildingSelect(); populateMeterSelect(); updatePrevInfo(); }
    if (btn.dataset.tab === 'export') populateExportMonthSelect();
  });
});

// ===== Meters =====
function isDuplicateMeter(building, name, type) {
  const b = (building || '').trim();
  const n = (name || '').trim();
  return db.meters.some(m => (m.building || '').trim() === b && (m.name || '').trim() === n && m.type === type);
}

function addMeter(name, type, rate, building) {
  const m = { id: uid(), name, type, rate: parseFloat(rate) || 0, building: building || '', createdAt: new Date().toISOString() };
  db.meters.push(m);
  saveDB(db);
  return m;
}

function getBuildings() {
  const set = new Set(db.meters.map(m => m.building || 'ไม่ระบุตึก'));
  return Array.from(set).sort();
}

function populateBuildingSelect() {
  const sel = document.getElementById('buildingSelect');
  if (!sel) return;
  const prevVal = sel.value;
  const buildings = getBuildings();
  sel.innerHTML = '<option value="">ทั้งหมด</option>';
  buildings.forEach(b => sel.appendChild(new Option(b, b)));
  if (prevVal && buildings.includes(prevVal)) sel.value = prevVal;
}

function populateMeterSelect() {
  const sel = document.getElementById('meterSelect');
  const histSel = document.getElementById('historyFilter');
  const buildingSel = document.getElementById('buildingSelect');
  const selectedBuilding = buildingSel ? buildingSel.value : '';
  const prevVal = sel.value;
  sel.innerHTML = '';
  histSel.innerHTML = '<option value="">ทั้งหมด</option>';
  if (db.meters.length === 0) {
    sel.innerHTML = '<option value="">-- ยังไม่มีมิเตอร์ เพิ่มที่แท็บ "มิเตอร์/ห้อง" --</option>';
    return;
  }
  const filtered = selectedBuilding
    ? db.meters.filter(m => (m.building || 'ไม่ระบุตึก') === selectedBuilding)
    : db.meters;
  if (filtered.length === 0) {
    sel.innerHTML = '<option value="">-- ไม่มีมิเตอร์ในตึกนี้ --</option>';
  } else {
    filtered.forEach(m => {
      const label = `${m.name} (${m.type === 'water' ? 'น้ำ' : 'ไฟ'})`;
      sel.appendChild(new Option(label, m.id));
    });
  }
  db.meters.forEach(m => {
    const label = `${m.building ? m.building + ' ' : ''}${m.name} (${m.type === 'water' ? 'น้ำ' : 'ไฟ'})`;
    histSel.appendChild(new Option(label, m.id));
  });
  if (prevVal) sel.value = prevVal;
}

document.getElementById('buildingSelect').addEventListener('change', () => {
  populateMeterSelect();
  updatePrevInfo();
});

function renderMeterList() {
  const wrap = document.getElementById('meterList');
  wrap.innerHTML = '';
  if (db.meters.length === 0) {
    wrap.innerHTML = '<p class="hint">ยังไม่มีมิเตอร์/ห้อง</p>';
    return;
  }
  db.meters.forEach(m => {
    const count = db.readings.filter(r => r.meterId === m.id).length;
    const div = document.createElement('div');
    div.className = 'list-item';
    const displayRate = m.type === 'water' ? db.config.waterRate : db.config.electricRate;
    div.innerHTML = `
      <div>
        <div>${m.building ? escapeHtml(m.building) + ' — ' : ''}${escapeHtml(m.name)} — ${m.type === 'water' ? 'น้ำ' : 'ไฟ'}</div>
        <div class="meta">อัตรา ${displayRate} บาท/หน่วย · ${count} รายการจด</div>
      </div>
    `;
    wrap.appendChild(div);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('addMeterBtn').addEventListener('click', () => {
  const name = document.getElementById('meterName').value.trim();
  const type = document.getElementById('meterType').value;
  const rate = document.getElementById('meterRate').value;
  const building = document.getElementById('meterBuilding').value.trim();
  if (!name) { toast('กรุณากรอกชื่อห้อง/จุดวัด'); return; }
  if (isDuplicateMeter(building, name, type)) {
    const typeLabel = type === 'water' ? 'น้ำ' : 'ไฟ';
    toast(`${name} (${typeLabel}) มีอยู่ในระบบแล้ว ไม่สามารถเพิ่มซ้ำได้`);
    return;
  }
  addMeter(name, type, rate, building);
  document.getElementById('meterName').value = '';
  document.getElementById('meterBuilding').value = '';
  renderMeterList();
  populateBuildingSelect();
  populateMeterSelect();
  toast('เพิ่มมิเตอร์แล้ว');
});

// ===== Readings =====
function getLastReading(meterId) {
  const list = db.readings.filter(r => r.meterId === meterId).sort((a, b) => a.date.localeCompare(b.date));
  const localLast = list.length ? list[list.length - 1] : null;

  // เทียบกับค่าล่าสุดที่ cache มาจาก Google Sheet (กันกรณีเครื่องนี้ไม่เคยมีประวัติห้องนี้ใน
  // localStorage เลย เช่น ห้องที่ import baseline เข้า Sheet ตรงๆ ไม่ผ่านแอป — ถ้าไม่เช็คตรงนี้
  // "เลขครั้งก่อน" จะหลุดเป็น 0 ทั้งที่จริงมีเลขก่อนหน้าอยู่ใน Sheet แล้ว)
  const meter = db.meters.find(m => m.id === meterId);
  const sheetLast = (meter && typeof getSheetLatestReading === 'function')
    ? getSheetLatestReading(meter.building, meter.name, meter.type)
    : null;

  if (!localLast && !sheetLast) return null;
  if (!localLast) return { value: sheetLast.value, date: sheetLast.date, source: 'sheet' };
  if (!sheetLast) return { value: localLast.value, date: localLast.date, source: 'local' };

  // มีทั้งคู่ — เอาอันที่วันที่ใหม่กว่า (ถ้าวันที่เท่ากันให้ถือว่า local แม่นกว่า เพราะเป็นข้อมูลสดจากเครื่องที่กำลังใช้งาน)
  if (sheetLast.date > localLast.date) {
    return { value: sheetLast.value, date: sheetLast.date, source: 'sheet' };
  }
  return { value: localLast.value, date: localLast.date, source: 'local' };
}

function updatePrevInfo() {
  const meterId = document.getElementById('meterSelect').value;
  const prevBox = document.getElementById('prevInfo');
  if (!meterId) { prevBox.style.display = 'none'; return; }
  const last = getLastReading(meterId);
  if (last) {
    const sourceLabel = last.source === 'sheet' ? ' (จาก Google Sheet)' : '';
    prevBox.style.display = 'block';
    prevBox.innerHTML = `ค่าครั้งก่อน: <b>${last.value}</b> (วันที่ ${last.date})${sourceLabel}`;
  } else {
    prevBox.style.display = 'block';
    prevBox.innerHTML = 'ยังไม่มีค่าก่อนหน้า (รายการแรก)';
  }
  updateCalcPreview();
}

function updateCalcPreview() {
  const meterId = document.getElementById('meterSelect').value;
  const curVal = parseFloat(document.getElementById('currentReading').value);
  const box = document.getElementById('calcPreview');
  if (!meterId || isNaN(curVal)) { box.style.display = 'none'; return; }
  const last = getLastReading(meterId);
  const prevVal = last ? last.value : 0;
  const consumed = curVal - prevVal;
  box.style.display = 'block';
  box.innerHTML = `หน่วยที่ใช้: <b>${consumed.toFixed(2)}</b> หน่วย`;
}

document.getElementById('meterSelect').addEventListener('change', updatePrevInfo);
document.getElementById('currentReading').addEventListener('input', updateCalcPreview);

// default date = today
document.getElementById('readingDate').value = new Date().toISOString().slice(0, 10);

document.getElementById('saveReadingBtn').addEventListener('click', () => {
  const meterId = document.getElementById('meterSelect').value;
  const date = document.getElementById('readingDate').value;
  const value = parseFloat(document.getElementById('currentReading').value);
  const note = document.getElementById('readingNote').value.trim();
  if (!meterId) { toast('กรุณาเลือกมิเตอร์/ห้องก่อน'); return; }
  if (!date) { toast('กรุณาเลือกวันที่'); return; }
  if (isNaN(value)) { toast('กรุณากรอกเลขมิเตอร์'); return; }

  const meter = db.meters.find(m => m.id === meterId);
  const last = getLastReading(meterId);
  const prevVal = last ? last.value : 0;
  const consumed = value - prevVal;
  const rate = meter ? (meter.type === 'water' ? db.config.waterRate : db.config.electricRate) : 0;
  const cost = meter ? calcCost(meter.type, consumed, rate) : 0;

  db.readings.push({
    id: uid(),
    meterId,
    date,
    value,
    prevValue: prevVal,
    consumed,
    rate,
    cost,
    note,
    createdAt: new Date().toISOString(),
  });
  saveDB(db);
  const savedReading = db.readings[db.readings.length - 1];
  if (typeof queueReadingForSync === 'function') {
    queueReadingForSync(savedReading, meter);
  }
  document.getElementById('currentReading').value = '';
  document.getElementById('readingNote').value = '';
  updatePrevInfo();
  toast('บันทึกแล้ว ✓');
});

// ===== History =====
document.getElementById('historyFilter').addEventListener('change', renderHistory);

function renderHistory() {
  const wrap = document.getElementById('historyList');
  const filterId = document.getElementById('historyFilter').value;
  let list = [...db.readings].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (filterId) list = list.filter(r => r.meterId === filterId);
  wrap.innerHTML = '';
  if (list.length === 0) {
    wrap.innerHTML = '<p class="hint">ยังไม่มีประวัติการจด</p>';
    return;
  }
  list.forEach(r => {
    const meter = db.meters.find(m => m.id === r.meterId);
    const div = document.createElement('div');
    div.className = 'list-item';
    const label = meter ? `${meter.building ? meter.building + ' — ' : ''}${meter.name} (${meter.type === 'water' ? 'น้ำ' : 'ไฟ'})` : '(ลบแล้ว)';
    div.innerHTML = `
      <div>
        <div>${escapeHtml(label)} — ${r.value}</div>
        <div class="meta">${r.date} · ใช้ ${r.consumed.toFixed(2)} หน่วย${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
      </div>
      <button class="del-btn" data-id="${r.id}">✕</button>
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('.del-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('ลบรายการนี้?')) return;
      db.readings = db.readings.filter(r => r.id !== b.dataset.id);
      saveDB(db);
      renderHistory();
      toast('ลบแล้ว');
    });
  });
}

// ===== Export =====
function populateExportMonthSelect() {
  const sel = document.getElementById('exportMonthSelect');
  if (!sel) return;
  const prevVal = sel.value;
  const months = Array.from(new Set(db.readings.map(r => r.date.slice(0, 7)))).sort().reverse();
  sel.innerHTML = '<option value="">-- ทุกเดือน --</option>';
  const thMonths = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  months.forEach(m => {
    const parts = m.split('-');
    const y = parts[0];
    const mo = parts[1];
    const label = thMonths[parseInt(mo, 10)] + ' ' + (parseInt(y, 10) + 543) + ' (' + m + ')';
    sel.appendChild(new Option(label, m));
  });
  if (prevVal && months.includes(prevVal)) sel.value = prevVal;
}

function buildExportRows() {
  const monthSel = document.getElementById('exportMonthSelect');
  const selectedMonth = monthSel ? monthSel.value : '';
  let readings = [...db.readings];
  if (selectedMonth) {
    readings = readings.filter(r => r.date.slice(0, 7) === selectedMonth);
  }
  const rows = readings.sort((a, b) => a.date.localeCompare(b.date)).map(r => {
    const meter = db.meters.find(m => m.id === r.meterId);
    return {
      'ตึก': meter ? (meter.building || '') : '',
      'ห้อง/มิเตอร์': meter ? meter.name : '(ลบแล้ว)',
      'ประเภท': meter ? (meter.type === 'water' ? 'น้ำ' : 'ไฟ') : '',
      'วันที่': r.date,
      'เลขครั้งก่อน': r.prevValue,
      'เลขครั้งนี้': r.value,
      'หน่วยที่ใช้': Number(r.consumed.toFixed(2)),
      'อัตรา(บาท/หน่วย)': r.rate,
      'ค่าใช้จ่าย(บาท)': Number(r.cost.toFixed(2)),
      'หมายเหตุ': r.note || '',
    };
  });
  return rows;
}

function exportFilenameSuffix() {
  const monthSel = document.getElementById('exportMonthSelect');
  const selectedMonth = monthSel ? monthSel.value : '';
  return selectedMonth || new Date().toISOString().slice(0, 10);
}

document.getElementById('exportExcelBtn').addEventListener('click', () => {
  const rows = buildExportRows();
  if (rows.length === 0) { toast('ไม่มีข้อมูลในเดือนที่เลือก'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:14},{wch:16},{wch:8},{wch:12},{wch:14},{wch:14},{wch:12},{wch:16},{wch:14},{wch:20}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ข้อมูลมิเตอร์');
  const fname = 'meter-readings-' + exportFilenameSuffix() + '.xlsx';
  XLSX.writeFile(wb, fname);
  toast('Export Excel แล้ว');
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const rows = buildExportRows();
  if (rows.length === 0) { toast('ไม่มีข้อมูลในเดือนที่เลือก'); return; }
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  rows.forEach(r => {
    csvLines.push(headers.map(h => {
      const v = String(r[h] != null ? r[h] : '');
      const needsQuote = v.indexOf('"') !== -1 || v.indexOf(',') !== -1 || v.indexOf('\n') !== -1;
      return needsQuote ? '"' + v.split('"').join('""') + '"' : v;
    }).join(','));
  });
  const csv = '\uFEFF' + csvLines.join('\r\n'); // BOM for Thai in Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'meter-readings-' + exportFilenameSuffix() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('Export CSV แล้ว');
});

// ===== Backup / Restore =====
document.getElementById('backupBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meter-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('สำรองข้อมูลแล้ว');
});

document.getElementById('restoreFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.meters || !data.readings) throw new Error('invalid');
      if (!confirm('การกู้คืนจะเขียนทับข้อมูลปัจจุบันทั้งหมด ดำเนินการต่อ?')) return;
      db = data;
      saveDB(db);
      populateBuildingSelect();
      populateMeterSelect();
      renderMeterList();
      renderHistory();
      toast('กู้คืนข้อมูลแล้ว');
    } catch (err) {
      toast('ไฟล์ไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('ล้างข้อมูลทั้งหมด? การกระทำนี้ย้อนกลับไม่ได้ (แนะนำสำรองข้อมูลก่อน)')) return;
  db = { meters: [], readings: [] };
  saveDB(db);
  populateBuildingSelect();
  populateMeterSelect();
  renderMeterList();
  renderHistory();
  toast('ล้างข้อมูลแล้ว');
});

// ===== Offline badge =====
function updateOnlineStatus() {
  const badge = document.getElementById('offlineBadge');
  if (navigator.onLine) {
    badge.textContent = 'ออฟไลน์พร้อมใช้';
    badge.classList.remove('offline-now');
  } else {
    badge.textContent = 'ออฟไลน์ (ไม่มีเน็ต)';
    badge.classList.add('offline-now');
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ===== Service Worker (for installable offline PWA) =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ===== Auto-import on first run (ถ้ายังไม่มีมิเตอร์เลย) =====
if (db.meters.length === 0 && window.SEED_METERS && window.SEED_METERS.length) {
  const toImport = window.SEED_METERS.filter(s => !isDuplicateMeter(s.building, s.name, s.type));
  toImport.forEach(s => addMeter(s.name, s.type, s.rate, s.building));
  if (toImport.length > 0) {
    setTimeout(() => toast(`นำเข้าอัตโนมัติ ${toImport.length} มิเตอร์จากฐานข้อมูลหอพัก`), 300);
  }
}

// ===== Init =====
populateBuildingSelect();
populateMeterSelect();
populateExportMonthSelect();
updatePrevInfo();
renderMeterList();
renderHistory();
