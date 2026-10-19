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
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'rMeter sync endpoint is live' }))
    .setMimeType(ContentService.MimeType.JSON);
}
