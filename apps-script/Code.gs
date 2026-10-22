/**
 * rMeter / จดมิเตอร์ — Apps Script Web App endpoint
 * รับ POST จากแอป meter-app แล้วเขียนแถวใหม่ลง Google Sheet
 *
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheet ใหม่ (หรือใช้ชีตเดิม) -> ตั้งชื่อแท็บแรกว่า "Readings"
 * 2. เมนู Extensions > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด แล้ววางไฟล์นี้แทน
 * 4. กด Deploy > New deployment > เลือกประเภท "Web app"
 *    - Execute as: Me
 *    - Who has access: Anyone (จำเป็น เพราะแอปยิง request แบบไม่ login)
 * 5. คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ในแอป meter-app (sync.js -> SHEET_WEBAPP_URL)
 *
 * ทุกครั้งที่แก้โค้ดนี้ ต้อง Deploy > Manage deployments > แก้ไข (ไอคอนดินสอ) > Version: New version > Deploy
 * (แค่กด Save ในตัวแก้โค้ดไม่ทำให้ URL ที่ deploy แล้วอัปเดต)
 */

var SHEET_NAME = 'Readings';
var SPREADSHEET_ID = ''; // ใส่ ID ของ Sheet ถ้ารันนอกบริบท bound script (ไม่บังคับถ้า script ผูกกับ Sheet อยู่แล้ว)

function getSheet_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActive();
  if (!ss) {
    throw new Error('ไม่พบ Spreadsheet — ตรวจสอบว่า script ผูกกับ Sheet หรือใส่ SPREADSHEET_ID แล้ว');
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'บันทึกเมื่อ', 'ตึก', 'ห้อง/มิเตอร์', 'ประเภท', 'วันที่จด',
      'เลขครั้งก่อน', 'เลขครั้งนี้', 'หน่วยที่ใช้', 'อัตรา', 'ค่าใช้จ่าย', 'หมายเหตุ', 'reading_id',
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  var result = { ok: false };
  try {
    var body = JSON.parse(e.postData.contents);
    var sheet = getSheet_();

    // รองรับทั้งส่งทีละรายการ (reading เดี่ยว) และส่งเป็น array (batch sync)
    var readings = Array.isArray(body) ? body : [body];

    // กันข้อมูลซ้ำ: เช็ค reading_id ที่เคยบันทึกแล้วในคอลัมน์สุดท้าย
    var existingIds = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var idCol = sheet.getRange(2, 12, lastRow - 1, 1).getValues();
      idCol.forEach(function (row) { if (row[0]) existingIds[row[0]] = true; });
    }

    var added = 0;
    readings.forEach(function (r) {
      if (r.readingId && existingIds[r.readingId]) return; // skip duplicate
      sheet.appendRow([
        new Date(),
        r.building || '',
        r.meterName || '',
        r.type === 'water' ? 'น้ำ' : 'ไฟ',
        r.date || '',
        r.prevValue != null ? r.prevValue : '',
        r.value != null ? r.value : '',
        r.consumed != null ? r.consumed : '',
        r.rate != null ? r.rate : '',
        r.cost != null ? r.cost : '',
        r.note || '',
        r.readingId || '',
      ]);
      added++;
    });

    result.ok = true;
    result.added = added;
    result.total = readings.length;
  } catch (err) {
    result.ok = false;
    result.error = String(err);
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ใช้ทดสอบว่า Web App ทำงานอยู่ (เปิด URL ตรงๆ ใน browser จะเจอ endpoint นี้)
// รองรับ ?action=export เพื่อดึงข้อมูลทั้งหมดกลับเป็น JSON (ใช้โดยระบบภายนอก เช่น dorm)
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'export') {
    return exportReadingsAsJson_();
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'rMeter sync endpoint is live' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function exportReadingsAsJson_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var result = { ok: true, readings: [] };
  if (lastRow > 1) {
    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (row) {
      if (!row[1] && !row[2]) return; // แถวว่าง ข้าม
      result.readings.push({
        recordedAt: row[0] ? new Date(row[0]).toISOString() : '',
        building: row[1] || '',
        meterName: row[2] || '',
        type: row[3] === 'น้ำ' ? 'water' : 'electric',
        date: normalizeDate_(row[4]),
        prevValue: row[5],
        value: row[6],
        consumed: row[7],
        rate: row[8],
        cost: row[9],
        note: row[10] || '',
        readingId: row[11] || '',
      });
    });
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeDate_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    // ใช้ timezone ของสคริปต์ (ตั้งไว้ Asia/Bangkok) กัน off-by-one จาก UTC conversion
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

// Utility: ลบแถวทดสอบทั้งหมด (เรียกตอน setup เท่านั้น ไม่ได้ใช้จริงตอนรัน)
function clearTestRows() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
}

// ขั้นต่ำค่าใช้จ่าย (บาท) — ต้องตรงกับ DEFAULT_CONFIG ในแอป meter-app (app.js)
// และ db.config ของระบบ dorm เสมอ ถ้าแก้เรทที่ใดที่หนึ่งต้องมาคำนวณขั้นต่ำใหม่แล้วแก้ที่นี่ด้วยมือ
var WATER_MINIMUM_BAHT = 95;
var ELECTRIC_MINIMUM_BAHT = 180;

// เมื่อมีคนแก้ "เลขครั้งก่อน" หรือ "เลขครั้งนี้" ในชีตด้วยมือ
// คำนวณ "หน่วยที่ใช้" และ "ค่าใช้จ่าย" ของแถวนั้นใหม่อัตโนมัติ (สูตรเดียวกับที่ dorm ใช้คิดบิลจริง)
// หมายเหตุ: ไม่ auto-recalc คอลัมน์ "อัตรา" — ถ้าต้องการเปลี่ยนอัตรา ให้แก้คอลัมน์อัตราเองแล้วแก้เลขครั้งก่อน/นี้ซ้ำอีกครั้ง (หรือพิมพ์ค่าเดิมซ้ำ) เพื่อให้ trigger คำนวณใหม่
function onEdit(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAME) return;
    var row = e.range.getRow();
    if (row === 1) return; // หัวตาราง ไม่ต้องคำนวณ

    var col = e.range.getColumn();
    // คอลัมน์ 6 = เลขครั้งก่อน, 7 = เลขครั้งนี้ — recalc เฉพาะตอนแก้ 2 คอลัมน์นี้
    if (col !== 6 && col !== 7) return;

    var rowRange = sheet.getRange(row, 1, 1, sheet.getLastColumn());
    var values = rowRange.getValues()[0];
    var typeLabel = values[3];  // ประเภท: น้ำ/ไฟ
    var prevValue = Number(values[5]);
    var value = Number(values[6]);
    var rate = Number(values[8]);

    if (isNaN(prevValue) || isNaN(value) || isNaN(rate)) return; // ข้อมูลไม่ครบ ข้าม

    var consumed = value - prevValue;
    var minimum = typeLabel === 'น้ำ' ? WATER_MINIMUM_BAHT : ELECTRIC_MINIMUM_BAHT;
    var cost = Math.max(minimum, consumed * rate);

    sheet.getRange(row, 8).setValue(consumed); // หน่วยที่ใช้
    sheet.getRange(row, 10).setValue(cost);    // ค่าใช้จ่าย
  } catch (err) {
    // ไม่ throw ต่อ เพื่อไม่ให้ onEdit พังการแก้ไขของผู้ใช้ปกติ
    Logger.log('onEdit error: ' + err);
  }
}
