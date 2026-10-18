// ===== Google Drive backup integration =====
// Uses Google Identity Services (GIS) for OAuth token + Drive API v3 REST calls.
const GOOGLE_CLIENT_ID = '133405402637-d9bbjnl4bmhbn607a1c228vdf4o27dsv.apps.googleusercontent.com';
const DRIVE_FOLDER_ID = '1u-CjIWbTpTOGVkkywNglQXEkco1uRTr7';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_TOKEN_KEY = 'meterapp_drive_token_v1';

let driveTokenClient = null;
let driveAccessToken = null;
let driveTokenExpiry = 0;

function loadStoredDriveToken() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.expiry && data.expiry > Date.now()) {
      driveAccessToken = data.token;
      driveTokenExpiry = data.expiry;
    }
  } catch (e) { /* ignore */ }
}

function storeDriveToken(token, expiresInSec) {
  driveAccessToken = token;
  driveTokenExpiry = Date.now() + (expiresInSec * 1000) - 60000; // 1 min safety margin
  localStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({ token, expiry: driveTokenExpiry }));
}

function isDriveConnected() {
  return !!driveAccessToken && Date.now() < driveTokenExpiry;
}

function updateDriveUI() {
  const statusEl = document.getElementById('driveStatus');
  const connectBtn = document.getElementById('driveConnectBtn');
  const backupBtn = document.getElementById('driveBackupBtn');
  if (!statusEl) return;
  if (isDriveConnected()) {
    statusEl.textContent = 'เชื่อมต่อ Google Drive แล้ว ✓';
    connectBtn.textContent = '🔄 เชื่อมต่อใหม่';
    backupBtn.style.display = 'block';
  } else {
    statusEl.textContent = 'ยังไม่ได้เชื่อมต่อ Google Drive';
    connectBtn.textContent = '🔗 เชื่อมต่อ Google Drive';
    backupBtn.style.display = 'none';
  }
}

function initDriveTokenClient(callback) {
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    toast('โหลด Google library ไม่สำเร็จ ลองใหม่อีกครั้ง');
    return null;
  }
  return window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp.error) {
        toast('เชื่อมต่อ Google Drive ไม่สำเร็จ: ' + resp.error);
        return;
      }
      storeDriveToken(resp.access_token, resp.expires_in || 3600);
      updateDriveUI();
      if (callback) callback();
    },
  });
}

function connectDrive(thenUpload) {
  if (!driveTokenClient) {
    driveTokenClient = initDriveTokenClient(thenUpload ? uploadBackupToDrive : null);
    if (!driveTokenClient) return;
  } else {
    driveTokenClient.callback = (resp) => {
      if (resp.error) {
        toast('เชื่อมต่อ Google Drive ไม่สำเร็จ: ' + resp.error);
        return;
      }
      storeDriveToken(resp.access_token, resp.expires_in || 3600);
      updateDriveUI();
      if (thenUpload) uploadBackupToDrive();
    };
  }
  driveTokenClient.requestAccessToken({ prompt: isDriveConnected() ? '' : 'consent' });
}

async function uploadBackupToDrive() {
  if (!isDriveConnected()) {
    connectDrive(true);
    return;
  }
  const filename = `meter-backup-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
  const content = JSON.stringify(db, null, 2);
  const metadata = {
    name: filename,
    parents: [DRIVE_FOLDER_ID],
    mimeType: 'application/json',
  };

  const boundary = '-------meterapp' + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    content +
    closeDelim;

  try {
    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${driveAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    if (resp.status === 401) {
      // token expired/revoked, force re-auth
      driveAccessToken = null;
      localStorage.removeItem(DRIVE_TOKEN_KEY);
      updateDriveUI();
      toast('หมดอายุการเชื่อมต่อ กรุณาเชื่อมต่อใหม่');
      return;
    }
    if (!resp.ok) {
      const errText = await resp.text();
      toast('อัปโหลดไม่สำเร็จ: ' + resp.status);
      console.error('Drive upload error', errText);
      return;
    }
    toast(`สำรองขึ้น Google Drive แล้ว ✓ (${filename})`);
  } catch (err) {
    toast('อัปโหลดไม่สำเร็จ: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStoredDriveToken();
  updateDriveUI();

  const connectBtn = document.getElementById('driveConnectBtn');
  const backupBtn = document.getElementById('driveBackupBtn');
  if (connectBtn) connectBtn.addEventListener('click', () => connectDrive(false));
  if (backupBtn) backupBtn.addEventListener('click', () => uploadBackupToDrive());
});
