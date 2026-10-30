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
    if (btn.dataset.tab === 'readings') {
      renderBuildingFilter();
      renderRoomList();
      updateTypeButtons();
      updatePrevInfo();
      // รีเฟรช cache จาก Sheet ทุกครั้งที่เข้าแท็บนี้ ลดโอกาสเจอเลขเก่า/ค้าง
      if (typeof refreshSheetLatestCache === 'function') refreshSheetLatestCache();
    }
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

// ===== หน้าบันทึก: state ของการเลือกตึก/ห้อง/ประเภท =====
let selectedBuildingFilter = 'ทั้งหมด';
let selectedMeterId = null; // มิเตอร์ (ห้อง+ประเภท) ที่เลือกอยู่ตอนนี้ — แทน meterSelect.value เดิม

function getRoomNamesForBuilding(building) {
  // รวมห้องที่มีทั้งน้ำ/ไฟ ให้เหลือ 1 แถวต่อห้อง (ไม่แยกตามประเภทเหมือนเดิม)
  const filtered = building === 'ทั้งหมด'
    ? db.meters
    : db.meters.filter(m => (m.building || 'ไม่ระบุตึก') === building);
  const seen = new Map(); // key: building||name -> {building, name}
  filtered.forEach(m => {
    const key = (m.building || '') + '||' + m.name;
    if (!seen.has(key)) seen.set(key, { building: m.building || '', name: m.name });
  });
  return Array.from(seen.values());
}

function findMeter(building, name, type) {
  return db.meters.find(m => (m.building || '') === building && m.name === name && m.type === type);
}

function renderBuildingFilter() {
  const wrap = document.getElementById('buildingFilter');
  if (!wrap) return;
  const buildings = ['ทั้งหมด', ...getBuildings()];
  wrap.innerHTML = '';
  buildings.forEach(b => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'building-btn' + (b === selectedBuildingFilter ? ' active' : '');
    btn.textContent = b;
    btn.addEventListener('click', () => {
      selectedBuildingFilter = b;
      renderBuildingFilter();
      renderRoomList();
    });
    wrap.appendChild(btn);
  });
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.indexOf(query);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' + escapeHtml(text.slice(idx + query.length));
}

// ห้องที่เลือกอยู่ตอนนี้ (ก่อนเลือกประเภท) — ใช้ตอนกดปุ่มน้ำ/ไฟ
let selectedRoomBuilding = null;
let selectedRoomName = null;

function renderRoomList() {
  const listEl = document.getElementById('roomList');
  if (!listEl) return;
  const searchInput = document.getElementById('roomSearch');
  const query = searchInput ? searchInput.value.trim() : '';
  let rooms = getRoomNamesForBuilding(selectedBuildingFilter);
  if (query) rooms = rooms.filter(r => r.name.includes(query));
  rooms.sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }));

  listEl.innerHTML = '';
  if (rooms.length === 0) {
    listEl.innerHTML = '<div class="no-room-match">ไม่พบห้องที่ตรงกับคำค้น</div>';
    return;
  }
  rooms.forEach(r => {
    const row = document.createElement('div');
    const isSelected = selectedRoomBuilding === r.building && selectedRoomName === r.name;
    row.className = 'room-row' + (isSelected ? ' selected' : '');
    row.innerHTML =
      '<span class="room-name">' + highlightMatch(r.name, query) + '</span>' +
      '<span class="room-meta">' + escapeHtml(r.building) + '</span>';
    row.addEventListener('click', () => {
      selectedRoomBuilding = r.building;
      selectedRoomName = r.name;
      selectedMeterId = null; // ต้องเลือกประเภทใหม่ทุกครั้งที่เปลี่ยนห้อง
      renderRoomList();
      updateTypeButtons();
      updatePrevInfo();
    });
    listEl.appendChild(row);
  });
}

function updateTypeButtons() {
  const waterBtn = document.getElementById('typeWaterBtn');
  const elecBtn = document.getElementById('typeElectricBtn');
  if (!waterBtn || !elecBtn) return;
  const roomChosen = !!(selectedRoomBuilding && selectedRoomName);
  const hasWater = roomChosen && !!findMeter(selectedRoomBuilding, selectedRoomName, 'water');
  const hasElectric = roomChosen && !!findMeter(selectedRoomBuilding, selectedRoomName, 'electric');
  waterBtn.disabled = !hasWater;
  elecBtn.disabled = !hasElectric;

  const currentMeter = selectedMeterId ? db.meters.find(m => m.id === selectedMeterId) : null;
  waterBtn.classList.toggle('active', !!currentMeter && currentMeter.type === 'water');
  elecBtn.classList.toggle('active', !!currentMeter && currentMeter.type === 'electric');
}

function selectType(type) {
  if (!selectedRoomBuilding || !selectedRoomName) return;
  const meter = findMeter(selectedRoomBuilding, selectedRoomName, type);
  if (!meter) return;
  selectedMeterId = meter.id;
  updateTypeButtons();
  updatePrevInfo();
}

document.getElementById('typeWaterBtn').addEventListener('click', () => selectType('water'));
document.getElementById('typeElectricBtn').addEventListener('click', () => selectType('electric'));
document.getElementById('roomSearch').addEventListener('input', renderRoomList);

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

function populateHistoryFilter() {
  const histSel = document.getElementById('historyFilter');
  if (!histSel) return;
  const prevVal = histSel.value;
  histSel.innerHTML = '<option value="">ทั้งหมด</option>';
  db.meters.forEach(m => {
    const label = `${m.building ? m.building + ' ' : ''}${m.name} (${m.type === 'water' ? 'น้ำ' : 'ไฟ'})`;
    histSel.appendChild(new Option(label, m.id));
  });
  if (prevVal) histSel.value = prevVal;
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
  renderBuildingFilter();
  renderRoomList();
  populateHistoryFilter();
  toast('เพิ่มมิเตอร์แล้ว');
});

// ===== Readings =====
// ตัดสินใจ (2026-10-23): ไม่ใช้ db.readings (localStorage) หาค่า "เลขครั้งก่อน" อีกต่อไป
// เพราะจดจากคนละเครื่องแล้วค่าไม่ตรงกัน (เครื่องนี้ไม่มีประวัติเครื่องอื่นเคยจด) ใช้ Google Sheet
// cache เป็นแหล่งเดียวเสมอ — คืน null ถ้าไม่เคยมีประวัติห้องนี้เลย หรือดึง Sheet ไม่สำเร็จเลย
function getLastReading(meterId) {
  const meter = db.meters.find(m => m.id === meterId);
  if (!meter) return null;
  const sheetLast = (typeof getSheetLatestReading === 'function')
    ? getSheetLatestReading(meter.building, meter.name, meter.type)
    : null;
  if (!sheetLast) return null;
  return { value: sheetLast.value, date: sheetLast.date, source: 'sheet' };
}

function updatePrevInfo() {
  const meterId = selectedMeterId;
  const summaryBox = document.getElementById('selectionSummary');
  const headlineEl = document.getElementById('summaryHeadline');
  const prevBox = document.getElementById('prevInfo');
  const saveBtn = document.getElementById('saveReadingBtn');
  const currentInput = document.getElementById('currentReading');

  if (!meterId) {
    if (summaryBox) summaryBox.classList.remove('show');
    if (currentInput) currentInput.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    const warnBox = document.getElementById('sameDayWarning');
    if (warnBox) warnBox.style.display = 'none';
    return;
  }

  const meter = db.meters.find(m => m.id === meterId);
  const typeLabel = meter && meter.type === 'water' ? 'น้ำ' : 'ไฟ';
  const typeIcon = meter && meter.type === 'water' ? '💧' : '⚡';
  if (headlineEl && meter) {
    headlineEl.textContent = `${typeIcon} กำลังจด: ${meter.building || ''} ${meter.name} (${typeLabel})`;
  }

  const cacheEverFetched = typeof hasSheetCacheEverSucceeded === 'function' && hasSheetCacheEverSucceeded();
  const last = getLastReading(meterId);

  if (last) {
    prevBox.innerHTML = `ค่าครั้งก่อน: <b>${last.value}</b> (วันที่ ${last.date}) (จาก Google Sheet)`;
    if (currentInput) currentInput.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  } else if (!cacheEverFetched) {
    // ไม่เคยดึง Sheet สำเร็จเลย (ออฟไลน์/ยังไม่เคยเปิดเน็ต) — ไม่รู้ค่าก่อนหน้าจริงๆ ไม่ให้บันทึก
    // กันปัญหา prevValue หลุดเป็น 0 แบบเงียบๆ (เกิดซ้ำกับห้อง 409, C2 เพราะข้ามขั้นตอนนี้)
    prevBox.innerHTML = 'ไม่สามารถดึงเลขล่าสุดจาก Google Sheet ได้ (ต้องมีเน็ตอย่างน้อยครั้งแรก) — ยังบันทึกไม่ได้';
    if (currentInput) currentInput.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
  } else {
    // ดึง Sheet สำเร็จแล้ว แต่ไม่พบประวัติห้องนี้เลยจริงๆ = มิเตอร์ใหม่ รายการแรก
    prevBox.innerHTML = 'ยังไม่มีค่าก่อนหน้า (รายการแรกของมิเตอร์นี้)';
    if (currentInput) currentInput.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  }
  if (summaryBox) summaryBox.classList.add('show');
  updateCalcPreview();
  updateSameDayWarning(meterId);
}

// เตือนถ้าห้อง+ประเภทนี้มีรายการ "วันเดียวกัน" ใน Sheet อยู่แล้ว (กันคีย์ซ้ำแบบที่เจอกับห้อง C2:
// คีย์ถูกรอบแรกแล้ว มาคีย์ซ้ำรอบสองในวันเดียวกันด้วยคนละเครื่อง ทำให้มีสองแถวของวันเดียวกัน)
function updateSameDayWarning(meterId) {
  const warnBox = document.getElementById('sameDayWarning');
  if (!warnBox) return;
  const meter = db.meters.find(m => m.id === meterId);
  const date = document.getElementById('readingDate').value;
  if (!meter || !date || typeof getSheetLatestReading !== 'function') {
    warnBox.style.display = 'none';
    return;
  }
  const last = getSheetLatestReading(meter.building, meter.name, meter.type);
  if (last && last.date === date) {
    warnBox.style.display = 'block';
    warnBox.innerHTML = `⚠ เลขล่าสุด ${last.value}`;
  } else {
    warnBox.style.display = 'none';
  }
}

function updateCalcPreview() {
  const meterId = selectedMeterId;
  const curVal = parseFloat(document.getElementById('currentReading').value);
  const box = document.getElementById('calcPreview');
  if (!meterId || isNaN(curVal)) { box.style.display = 'none'; return; }
  const last = getLastReading(meterId);
  const prevVal = last ? last.value : 0;
  const consumed = curVal - prevVal;
  box.style.display = 'block';
  box.innerHTML = `หน่วยที่ใช้: <b>${consumed.toFixed(2)}</b> หน่วย`;
}

document.getElementById('currentReading').addEventListener('input', updateCalcPreview);
document.getElementById('readingDate').addEventListener('change', () => {
  updateSameDayWarning(selectedMeterId);
});

// default date = today
document.getElementById('readingDate').value = new Date().toISOString().slice(0, 10);

document.getElementById('saveReadingBtn').addEventListener('click', async () => {
  const meterId = selectedMeterId;
  const date = document.getElementById('readingDate').value;
  const value = parseFloat(document.getElementById('currentReading').value);
  const note = document.getElementById('readingNote').value.trim();
  if (!meterId) { toast('กรุณาเลือกห้องและประเภทก่อน'); return; }
  if (!date) { toast('กรุณาเลือกวันที่'); return; }
  if (isNaN(value)) { toast('กรุณากรอกเลขมิเตอร์'); return; }

  const meter = db.meters.find(m => m.id === meterId);
  const cacheEverFetched = typeof hasSheetCacheEverSucceeded === 'function' && hasSheetCacheEverSucceeded();
  const last = getLastReading(meterId);

  // บล็อกการบันทึกถ้าไม่เคยดึง Sheet สำเร็จเลย (ไม่รู้เลขก่อนหน้าจริง) — กัน prevValue หลุดเป็น 0
  if (!last && !cacheEverFetched) {
    toast('ไม่สามารถดึงเลขล่าสุดจาก Google Sheet ได้ กรุณาต่อเน็ตแล้วลองใหม่ก่อนบันทึก');
    return;
  }

  // เตือนก่อนบันทึกถ้าห้อง+ประเภทนี้มีรายการวันเดียวกันใน Sheet อยู่แล้ว (กันคีย์ซ้ำข้ามเครื่อง)
  if (last && last.date === date) {
    const ok = confirm(`ห้องนี้มีรายการวันที่ ${date} อยู่แล้วในระบบ (เลขล่าสุด ${last.value})\nต้องการบันทึกซ้ำจริงหรือไม่?`);
    if (!ok) return;
  }

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

  const saveBtn = document.getElementById('saveReadingBtn');
  saveBtn.disabled = true;
  const prevLabel = saveBtn.textContent;
  saveBtn.textContent = 'กำลังส่งขึ้น Google Sheet...';

  let syncedOk = false;
  if (typeof queueReadingForSync === 'function') {
    syncedOk = await queueReadingForSync(savedReading, meter);
  }

  saveBtn.textContent = prevLabel;
  saveBtn.disabled = false;

  document.getElementById('currentReading').value = '';
  document.getElementById('readingNote').value = '';
  // รีเฟรช cache จาก Sheet ทันทีหลังบันทึก กันคนคีย์ต่อก่อน sync จริงจะเจอเลขเก่า
  if (typeof refreshSheetLatestCache === 'function') await refreshSheetLatestCache();
  updatePrevInfo();

  if (syncedOk) {
    toast('บันทึกขึ้น Google Sheet แล้ว ✓');
  } else {
    toast('บันทึกในเครื่องแล้ว แต่ยังไม่มีเน็ต/ส่งขึ้น Sheet ไม่สำเร็จ — จะลองส่งอัตโนมัติอีกครั้งเมื่อมีเน็ต');
  }
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
      renderBuildingFilter();
      renderRoomList();
      populateHistoryFilter();
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
  renderBuildingFilter();
  renderRoomList();
  populateHistoryFilter();
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
renderBuildingFilter();
renderRoomList();
updateTypeButtons();
populateHistoryFilter();
populateExportMonthSelect();
updatePrevInfo();
renderMeterList();
renderHistory();
