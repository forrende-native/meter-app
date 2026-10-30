// ===== QR: generate per-room QR + scan QR to jump to reading form =====
// Encoding: QR text = "meterapp:room:" + encodeURIComponent(JSON.stringify({b: building, n: name}))
const QR_PREFIX = 'meterapp:room:';

function qrPayloadForRoom(building, name) {
  return QR_PREFIX + encodeURIComponent(JSON.stringify({ b: building || '', n: name }));
}

function parseQRPayload(text) {
  if (!text || text.indexOf(QR_PREFIX) !== 0) return null;
  try {
    const data = JSON.parse(decodeURIComponent(text.slice(QR_PREFIX.length)));
    if (typeof data.n !== 'string') return null;
    return { building: data.b || '', name: data.n };
  } catch (e) {
    return null;
  }
}

// ===== Render QR list in tab มิเตอร์/ห้อง =====
function renderRoomQRList() {
  const wrap = document.getElementById('roomQRList');
  if (!wrap || typeof getRoomNamesForBuilding !== 'function') return;
  wrap.innerHTML = '';
  const rooms = getRoomNamesForBuilding('ทั้งหมด').sort((a, b) =>
    a.name.localeCompare(b.name, 'th', { numeric: true })
  );
  if (rooms.length === 0) {
    wrap.innerHTML = '<p class="hint">ยังไม่มีห้อง</p>';
    return;
  }
  rooms.forEach(r => {
    const item = document.createElement('div');
    item.className = 'qr-room-item';
    const label = document.createElement('div');
    label.className = 'qr-room-label';
    label.innerHTML = `${escapeHtml(r.building)}<br><b>${escapeHtml(r.name)}</b>`;
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
      text: qrPayloadForRoom(r.building, r.name),
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
      a.download = `qr-${(r.building || '')}-${r.name}.png`.replace(/\s+/g, '_');
      a.click();
    });
  });
}

// ===== พิมพ์ QR ทั้งหมด (เปิดหน้าต่างใหม่ พร้อมเลย์เอาต์สำหรับพิมพ์) =====
document.getElementById('printAllQRBtn').addEventListener('click', () => {
  const rooms = getRoomNamesForBuilding('ทั้งหมด').sort((a, b) =>
    a.name.localeCompare(b.name, 'th', { numeric: true })
  );
  if (rooms.length === 0) { toast('ยังไม่มีห้องให้พิมพ์ QR'); return; }

  const win = window.open('', '_blank');
  win.document.write('<html><head><title>พิมพ์ QR ห้อง</title><meta charset="utf-8"></head><body></body></html>');
  win.document.close();
  const style = win.document.createElement('style');
  style.textContent = `
    body { font-family: sans-serif; margin: 0; padding: 10px; }
    .grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .cell { width: 160px; text-align: center; border: 1px dashed #999; padding: 10px; page-break-inside: avoid; }
    .cell .bld { font-size: 11px; color: #555; }
    .cell .rm { font-size: 15px; font-weight: bold; margin-top: 4px; }
    .cell canvas, .cell img { margin-top: 6px; }
  `;
  win.document.head.appendChild(style);
  const grid = win.document.createElement('div');
  grid.className = 'grid';
  win.document.body.appendChild(grid);

  rooms.forEach(r => {
    const cell = win.document.createElement('div');
    cell.className = 'cell';
    const bld = win.document.createElement('div');
    bld.className = 'bld';
    bld.textContent = r.building || '';
    const rm = win.document.createElement('div');
    rm.className = 'rm';
    rm.textContent = r.name;
    const qrHolder = win.document.createElement('div');
    cell.appendChild(bld);
    cell.appendChild(rm);
    cell.appendChild(qrHolder);
    grid.appendChild(cell);
    new QRCode(qrHolder, {
      text: qrPayloadForRoom(r.building, r.name),
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
      statusEl.textContent = 'เล็ง QR ที่หน้าห้อง';
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
  const match = getRoomNamesForBuilding('ทั้งหมด').find(
    r => (r.building || '') === parsed.building && r.name === parsed.name
  );
  if (!match) {
    statusEl.textContent = `ไม่พบห้อง "${parsed.name}" ในระบบ ลองสแกนใหม่`;
    qrScanRAF = requestAnimationFrame(scanLoop);
    return;
  }
  closeQRScanner();
  // เด้งไปแท็บบันทึก เลือกตึก+ห้องให้อัตโนมัติ
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="readings"]').classList.add('active');
  document.getElementById('tab-readings').classList.add('active');

  selectedBuildingFilter = match.building ? match.building : 'ทั้งหมด';
  selectedRoomBuilding = match.building;
  selectedRoomName = match.name;
  selectedMeterId = null;
  renderBuildingFilter();
  renderRoomList();
  updateTypeButtons();
  updatePrevInfo();
  if (typeof refreshSheetLatestCache === 'function') refreshSheetLatestCache();
  toast(`✓ สแกนสำเร็จ: ${match.building ? match.building + ' ' : ''}${match.name} — เลือกประเภทน้ำ/ไฟต่อได้เลย`);
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
