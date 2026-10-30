// ===== QR: generate per-meter QR (แยกน้ำ/ไฟ) + scan QR to jump straight to reading form =====
// Encoding: QR text = "meterapp:meter:" + encodeURIComponent(JSON.stringify({b: building, n: name, t: type}))
const QR_PREFIX = 'meterapp:meter:';

function qrPayloadForMeter(building, name, type) {
  return QR_PREFIX + encodeURIComponent(JSON.stringify({ b: building || '', n: name, t: type }));
}

function parseQRPayload(text) {
  if (!text || text.indexOf(QR_PREFIX) !== 0) return null;
  try {
    const data = JSON.parse(decodeURIComponent(text.slice(QR_PREFIX.length)));
    if (typeof data.n !== 'string' || (data.t !== 'water' && data.t !== 'electric')) return null;
    return { building: data.b || '', name: data.n, type: data.t };
  } catch (e) {
    return null;
  }
}

// รวมมิเตอร์ทั้งหมด (ตึก+ห้อง+ประเภท) เป็น list แบน เพื่อ generate QR ทีละใบต่อมิเตอร์
function getAllMetersFlat() {
  return [...db.meters]
    .sort((a, b) =>
      (a.building || '').localeCompare(b.building || '', 'th') ||
      a.name.localeCompare(b.name, 'th', { numeric: true }) ||
      (a.type === b.type ? 0 : a.type === 'water' ? -1 : 1)
    );
}

function meterTypeLabel(type) {
  return type === 'water' ? 'น้ำ' : 'ไฟ';
}
function meterTypeIcon(type) {
  return type === 'water' ? '💧' : '⚡';
}

// ===== Render QR list in tab มิเตอร์/ห้อง (ใบละ 1 มิเตอร์ น้ำ/ไฟ แยกกัน) =====
function renderRoomQRList() {
  const wrap = document.getElementById('roomQRList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const meters = getAllMetersFlat();
  if (meters.length === 0) {
    wrap.innerHTML = '<p class="hint">ยังไม่มีมิเตอร์</p>';
    return;
  }
  meters.forEach(m => {
    const item = document.createElement('div');
    item.className = 'qr-room-item';
    const label = document.createElement('div');
    label.className = 'qr-room-label';
    label.innerHTML = `${escapeHtml(m.building)}<br><b>${escapeHtml(m.name)}</b><br>${meterTypeIcon(m.type)} ${meterTypeLabel(m.type)}`;
    const qrBox = document.createElement('div');
    qrBox.className = 'qr-room-code';
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn-secondary qr-dl-btn';
    dlBtn.textContent = '⬇';
    item.appendChild(qrBox);
    item.appendChild(label);
    item.appendChild(dlBtn);
    wrap.appendChild(item);

    new QRCode(qrBox, {
      text: qrPayloadForMeter(m.building, m.name, m.type),
      width: 120,
      height: 120,
      correctLevel: QRCode.CorrectLevel.M,
    });

    dlBtn.addEventListener('click', () => {
      const canvas = qrBox.querySelector('canvas');
      const img = qrBox.querySelector('img');
      const dataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : null);
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qr-${(m.building || '')}-${m.name}-${m.type}.png`.replace(/\s+/g, '_');
      a.click();
    });
  });
}

// ===== พิมพ์ QR ทั้งหมด (ใบละ 1 มิเตอร์ น้ำ/ไฟ แยกกัน เปิดหน้าต่างใหม่พร้อมเลย์เอาต์สำหรับพิมพ์) =====
document.getElementById('printAllQRBtn').addEventListener('click', () => {
  const meters = getAllMetersFlat();
  if (meters.length === 0) { toast('ยังไม่มีมิเตอร์ให้พิมพ์ QR'); return; }

  const win = window.open('', '_blank');
  win.document.write('<html><head><title>พิมพ์ QR มิเตอร์</title><meta charset="utf-8"></head><body></body></html>');
  win.document.close();
  const style = win.document.createElement('style');
  style.textContent = `
    body { font-family: sans-serif; margin: 0; padding: 10px; }
    .grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .cell { width: 160px; text-align: center; border: 1px dashed #999; padding: 10px; page-break-inside: avoid; }
    .cell .bld { font-size: 11px; color: #555; }
    .cell .rm { font-size: 15px; font-weight: bold; margin-top: 4px; }
    .cell .tp { font-size: 13px; margin-top: 2px; }
    .cell canvas, .cell img { margin-top: 6px; }
  `;
  win.document.head.appendChild(style);
  const grid = win.document.createElement('div');
  grid.className = 'grid';
  win.document.body.appendChild(grid);

  meters.forEach(m => {
    const cell = win.document.createElement('div');
    cell.className = 'cell';
    const bld = win.document.createElement('div');
    bld.className = 'bld';
    bld.textContent = m.building || '';
    const rm = win.document.createElement('div');
    rm.className = 'rm';
    rm.textContent = m.name;
    const tp = win.document.createElement('div');
    tp.className = 'tp';
    tp.textContent = meterTypeIcon(m.type) + ' ' + meterTypeLabel(m.type);
    const qrHolder = win.document.createElement('div');
    cell.appendChild(bld);
    cell.appendChild(rm);
    cell.appendChild(tp);
    cell.appendChild(qrHolder);
    grid.appendChild(cell);
    new QRCode(qrHolder, {
      text: qrPayloadForMeter(m.building, m.name, m.type),
      width: 120,
      height: 120,
      correctLevel: QRCode.CorrectLevel.M,
    });
  });

  setTimeout(() => { win.focus(); win.print(); }, 400);
});

// ===== Scan QR =====
let qrScanStream = null;
let qrScanRAF = null;

function openQRScanner() {
  const modal = document.getElementById('qrScanModal');
  const video = document.getElementById('qrScanVideo');
  const statusEl = document.getElementById('qrScanStatus');
  modal.classList.add('show');
  statusEl.textContent = 'กำลังเปิดกล้อง...';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = 'อุปกรณ์นี้ไม่รองรับการใช้กล้อง (ต้องเปิดผ่าน HTTPS)';
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      qrScanStream = stream;
      video.srcObject = stream;
      statusEl.textContent = 'เล็ง QR ที่หน้ามิเตอร์';
      scanLoop();
    })
    .catch(err => {
      statusEl.textContent = 'เปิดกล้องไม่ได้: ' + (err && err.message ? err.message : 'ไม่ทราบสาเหตุ');
    });
}

function closeQRScanner() {
  const modal = document.getElementById('qrScanModal');
  modal.classList.remove('show');
  if (qrScanRAF) cancelAnimationFrame(qrScanRAF);
  qrScanRAF = null;
  if (qrScanStream) {
    qrScanStream.getTracks().forEach(t => t.stop());
    qrScanStream = null;
  }
}

function scanLoop() {
  const video = document.getElementById('qrScanVideo');
  const canvas = document.getElementById('qrScanCanvas');
  const statusEl = document.getElementById('qrScanStatus');
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
    qrScanRAF = requestAnimationFrame(scanLoop);
    return;
  }
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if (code && code.data) {
    const parsed = parseQRPayload(code.data);
    if (parsed) {
      handleQRMatch(parsed, statusEl);
      return; // หยุด loop หลังเจอ match
    }
  }
  qrScanRAF = requestAnimationFrame(scanLoop);
}

function handleQRMatch(parsed, statusEl) {
  const meter = findMeter(parsed.building, parsed.name, parsed.type);
  if (!meter) {
    statusEl.textContent = `ไม่พบมิเตอร์ "${parsed.name}" (${meterTypeLabel(parsed.type)}) ในระบบ ลองสแกนใหม่`;
    qrScanRAF = requestAnimationFrame(scanLoop);
    return;
  }
  closeQRScanner();
  // เด้งไปแท็บบันทึก เลือกตึก+ห้อง+ประเภทให้อัตโนมัติ พร้อมกรอกเลขได้ทันที
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="readings"]').classList.add('active');
  document.getElementById('tab-readings').classList.add('active');

  selectedBuildingFilter = parsed.building ? parsed.building : 'ทั้งหมด';
  selectedRoomBuilding = parsed.building;
  selectedRoomName = parsed.name;
  selectedMeterId = meter.id;
  renderBuildingFilter();
  renderRoomList();
  updateTypeButtons();
  updatePrevInfo();
  if (typeof refreshSheetLatestCache === 'function') refreshSheetLatestCache();
  document.getElementById('currentReading').focus();
  toast(`✓ สแกนสำเร็จ: ${parsed.building ? parsed.building + ' ' : ''}${parsed.name} (${meterTypeLabel(parsed.type)}) — กรอกเลขได้เลย`);
}

document.getElementById('qrFab').addEventListener('click', openQRScanner);
document.getElementById('qrScanCancelBtn').addEventListener('click', closeQRScanner);

// รีเฟรช QR list เมื่อเข้าแท็บมิเตอร์/ห้อง (hook เพิ่มจาก app.js tab switch)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'meters') renderRoomQRList();
  });
});
renderRoomQRList();
