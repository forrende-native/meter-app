import sqlite3, json
c = sqlite3.connect(r"D:\OneDrive - Rende Development Co., Ltd\0.b\dorm\server\data\dormflow.sqlite")
c.row_factory = sqlite3.Row
cur = c.cursor()

for t in ("buildings", "rooms", "meters"):
    print("====", t, "====")
    cur.execute(f"PRAGMA table_info({t})")
    cols = [r[1] for r in cur.fetchall()]
    print(cols)
    cur.execute(f"SELECT * FROM {t} LIMIT 5")
    for row in cur.fetchall():
        print(dict(row))
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    print("count:", cur.fetchone()[0])
    print()
