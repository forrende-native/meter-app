import sqlite3, json

c = sqlite3.connect(r"D:\OneDrive - Rende Development Co., Ltd\0.b\dorm\server\data\dormflow.sqlite")
c.row_factory = sqlite3.Row
cur = c.cursor()

cur.execute("SELECT * FROM buildings")
buildings = {}
for row in cur.fetchall():
    d = json.loads(row["data"])
    buildings[row["id"]] = d["name"]

def sort_key(code):
    try:
        return (0, int(code))
    except ValueError:
        return (1, code)

cur.execute("SELECT * FROM rooms")
rooms = []
for row in cur.fetchall():
    d = json.loads(row["data"])
    rooms.append({
        "buildingName": buildings.get(row["building_id"], "?"),
        "code": row["code"],
        "sortKey": sort_key(row["code"]),
    })
rooms.sort(key=lambda r: (r["buildingName"], r["sortKey"]))

# 1 ห้อง = 2 มิเตอร์แยก (น้ำ + ไฟ), อัตรา default: ไฟ 8 บาท/หน่วย, น้ำ 18 บาท/หน่วย
meters = []
for r in rooms:
    room_label = f'ห้อง {r["code"]}'
    meters.append({"name": room_label, "type": "water", "rate": 18, "building": r["buildingName"]})
    meters.append({"name": room_label, "type": "electric", "rate": 8, "building": r["buildingName"]})

with open("D:/HermesWorkspace/meter-app/meters_import.json", "w", encoding="utf-8") as f:
    json.dump(meters, f, ensure_ascii=False, indent=2)

print("rooms:", len(rooms))
print("meters (2 ต่อห้อง):", len(meters))
print("ตัวอย่าง 4 รายการแรก:")
for m in meters[:4]:
    print(" -", m)
