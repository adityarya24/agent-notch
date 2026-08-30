import sqlite3
import sys
from pathlib import Path

if len(sys.argv) < 3:
    sys.exit(2)

db = Path(sys.argv[1])
key = sys.argv[2]
if not db.is_file():
    sys.exit(2)

uri = db.resolve().as_posix()
con = sqlite3.connect(f"file:{uri}?mode=ro", uri=True)
try:
    row = con.execute("SELECT value FROM ItemTable WHERE key=?", (key,)).fetchone()
finally:
    con.close()

if not row or row[0] is None:
    sys.exit(2)

value = row[0]
if isinstance(value, bytes):
    sys.stdout.buffer.write(value)
else:
    sys.stdout.write(str(value))
