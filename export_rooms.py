import sqlite3, json
c = sqlite3.connect(r"D:\OneDrive - Rende Development Co., Ltd\0.b\dorm\server\data\dormflow.sqlite")
c.row_factory = sqlite3.Row
cur = c.cursor()

cur.execute("SELECT * FROM buildings")
buildings = {}
for row in cur.fetchall():
    d = json.loads(row["data"])
    buildings[row["id"]] = d["name"]

cur.execute("SELECT * FROM rooms ORDER BY building_id, CAST(code AS INTEGER), code")
rooms = []
for row in cur.fetchall():
    d = json.loads(row["data"])
    rooms.append({
        "buildingId": row["building_id"],
        "buildingName": buildings.get(row["building_id"], "?"),
        "code": row["code"],
        "floor": d.get("floor"),
        "type": d.get("type"),
        "status": d.get("status"),
    })

print("Buildings:", buildings)
print("Total rooms:", len(rooms))

out = {"buildings": buildings, "rooms": rooms}
with open(r"D:/HermesWorkspace/meter-app/rooms_export.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("saved rooms_export.json")
