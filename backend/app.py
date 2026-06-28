from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sqlite3
from datetime import date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DEBT_APP_DB", ROOT / "data" / "debts.sqlite"))
SEED_PATH = ROOT / "seed_debts.json"
STATIC_DIR = Path(os.environ.get("DEBT_APP_STATIC", ROOT.parent / "frontend" / "dist"))
PAYER_MODES = {"alan", "mairon", "ambos", "personalizado"}


def month_start(value: str) -> date:
    try:
        year, month = value.split("-", 1)
        return date(int(year), int(month), 1)
    except Exception as exc:
        raise ValueError("Mes invalido. Usa formato YYYY-MM.") from exc


def month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def add_months(value: date, months: int) -> date:
    index = value.year * 12 + (value.month - 1) + months
    return date(index // 12, index % 12 + 1, 1)


def month_diff(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month)


def current_month_key() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS debts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                total_amount INTEGER NOT NULL DEFAULT 0,
                monthly_installment INTEGER NOT NULL DEFAULT 0,
                installments_total INTEGER NOT NULL DEFAULT 1,
                start_month TEXT NOT NULL,
                alan_monthly INTEGER NOT NULL DEFAULT 0,
                mairon_monthly INTEGER NOT NULL DEFAULT 0,
                payer_mode TEXT NOT NULL DEFAULT 'personalizado',
                source TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        count = conn.execute("SELECT COUNT(*) FROM debts").fetchone()[0]
        if count == 0 and SEED_PATH.exists():
            seed_rows = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            stamp = now_iso()
            conn.executemany(
                """
                INSERT INTO debts (
                    title, category, total_amount, monthly_installment, installments_total,
                    start_month, alan_monthly, mairon_monthly, payer_mode, source, notes,
                    created_at, updated_at
                )
                VALUES (
                    :title, :category, :total_amount, :monthly_installment, :installments_total,
                    :start_month, :alan_monthly, :mairon_monthly, :payer_mode, :source, :notes,
                    :created_at, :updated_at
                )
                """,
                [{**row, "created_at": stamp, "updated_at": stamp} for row in seed_rows],
            )


def as_int(data: dict, key: str, default: int = 0) -> int:
    value = data.get(key, default)
    if value in ("", None):
        return default
    try:
        return int(round(float(value)))
    except Exception as exc:
        raise ValueError(f"{key} debe ser numerico.") from exc


def normalize_payload(data: dict) -> dict:
    title = str(data.get("title", "")).strip()
    if not title:
        raise ValueError("El concepto es obligatorio.")

    installments_total = as_int(data, "installments_total", 1)
    if installments_total < 1:
        raise ValueError("La cantidad de cuotas debe ser mayor a cero.")

    start_month = str(data.get("start_month", "")).strip()
    month_start(start_month)

    total_amount = max(0, as_int(data, "total_amount", 0))
    monthly_installment = as_int(data, "monthly_installment", 0)
    if monthly_installment <= 0 and total_amount > 0:
        monthly_installment = round(total_amount / installments_total)

    alan_monthly = max(0, as_int(data, "alan_monthly", 0))
    mairon_monthly = max(0, as_int(data, "mairon_monthly", 0))
    payer_mode = str(data.get("payer_mode", "personalizado")).strip().lower()
    if payer_mode not in PAYER_MODES:
        payer_mode = "personalizado"

    return {
        "title": title,
        "category": str(data.get("category", "")).strip(),
        "total_amount": total_amount,
        "monthly_installment": max(0, monthly_installment),
        "installments_total": installments_total,
        "start_month": start_month,
        "alan_monthly": alan_monthly,
        "mairon_monthly": mairon_monthly,
        "payer_mode": payer_mode,
        "source": str(data.get("source", "")).strip(),
        "notes": str(data.get("notes", "")).strip(),
    }


def fetch_debts() -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM debts ORDER BY start_month DESC, title COLLATE NOCASE ASC, id ASC"
        ).fetchall()


def fetch_debt(debt_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute("SELECT * FROM debts WHERE id = ?", (debt_id,)).fetchone()


def computed_debt(row: sqlite3.Row, as_of_month: str) -> dict:
    start = month_start(row["start_month"])
    end = add_months(start, row["installments_total"] - 1)
    as_of = month_start(as_of_month)

    diff = month_diff(start, as_of)
    paid_installments = min(max(diff + 1, 0), row["installments_total"])
    remaining_start = max(diff, 0)
    remaining_installments = max(row["installments_total"] - remaining_start, 0)

    if as_of < start:
        status = "upcoming"
    elif as_of > end:
        status = "finished"
    else:
        status = "active"

    base = dict(row)
    base.update(
        {
            "end_month": month_key(end),
            "status": status,
            "paid_installments_as_of": paid_installments,
            "remaining_installments_as_of": remaining_installments,
            "alan_total": row["alan_monthly"] * row["installments_total"],
            "mairon_total": row["mairon_monthly"] * row["installments_total"],
            "alan_remaining": row["alan_monthly"] * remaining_installments,
            "mairon_remaining": row["mairon_monthly"] * remaining_installments,
            "people_monthly_total": row["alan_monthly"] + row["mairon_monthly"],
        }
    )
    return base


def build_summary(from_month: str, months: int) -> dict:
    from_start = month_start(from_month)
    months = max(1, min(months, 60))
    rows = fetch_debts()
    debts = [computed_debt(row, from_month) for row in rows]
    projection = []

    for offset in range(months):
        month = add_months(from_start, offset)
        alan = 0
        mairon = 0
        active_count = 0
        for row in rows:
            start = month_start(row["start_month"])
            end = add_months(start, row["installments_total"] - 1)
            if start <= month <= end:
                alan += row["alan_monthly"]
                mairon += row["mairon_monthly"]
                active_count += 1
        projection.append(
            {
                "month": month_key(month),
                "alan": alan,
                "mairon": mairon,
                "total": alan + mairon,
                "active_debts": active_count,
            }
        )

    alan_end = None
    mairon_end = None
    for row in rows:
        end = add_months(month_start(row["start_month"]), row["installments_total"] - 1)
        if row["alan_monthly"] > 0 and end >= from_start:
            alan_end = end if alan_end is None or end > alan_end else alan_end
        if row["mairon_monthly"] > 0 and end >= from_start:
            mairon_end = end if mairon_end is None or end > mairon_end else mairon_end

    peak = max(projection, key=lambda item: item["total"]) if projection else None
    return {
        "from_month": from_month,
        "months": months,
        "debts": debts,
        "projection": projection,
        "stats": {
            "alan_projected": sum(item["alan"] for item in projection),
            "mairon_projected": sum(item["mairon"] for item in projection),
            "total_projected": sum(item["total"] for item in projection),
            "active_debts": sum(1 for debt in debts if debt["status"] != "finished"),
            "finished_debts": sum(1 for debt in debts if debt["status"] == "finished"),
            "alan_end_month": month_key(alan_end) if alan_end else None,
            "mairon_end_month": month_key(mairon_end) if mairon_end else None,
            "peak_month": peak,
        },
    }


def create_debt(payload: dict) -> dict:
    data = normalize_payload(payload)
    stamp = now_iso()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO debts (
                title, category, total_amount, monthly_installment, installments_total,
                start_month, alan_monthly, mairon_monthly, payer_mode, source, notes,
                created_at, updated_at
            )
            VALUES (
                :title, :category, :total_amount, :monthly_installment, :installments_total,
                :start_month, :alan_monthly, :mairon_monthly, :payer_mode, :source, :notes,
                :created_at, :updated_at
            )
            """,
            {**data, "created_at": stamp, "updated_at": stamp},
        )
        debt_id = cursor.lastrowid
    return computed_debt(fetch_debt(debt_id), current_month_key())


def update_debt(debt_id: int, payload: dict) -> dict:
    if not fetch_debt(debt_id):
        raise KeyError("Deuda no encontrada.")
    data = normalize_payload(payload)
    data["updated_at"] = now_iso()
    with connect() as conn:
        conn.execute(
            """
            UPDATE debts
            SET title = :title,
                category = :category,
                total_amount = :total_amount,
                monthly_installment = :monthly_installment,
                installments_total = :installments_total,
                start_month = :start_month,
                alan_monthly = :alan_monthly,
                mairon_monthly = :mairon_monthly,
                payer_mode = :payer_mode,
                source = :source,
                notes = :notes,
                updated_at = :updated_at
            WHERE id = :id
            """,
            {**data, "id": debt_id},
        )
    return computed_debt(fetch_debt(debt_id), current_month_key())


def delete_debt(debt_id: int) -> None:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM debts WHERE id = ?", (debt_id,))
        if cursor.rowcount == 0:
            raise KeyError("Deuda no encontrada.")


class DebtHandler(BaseHTTPRequestHandler):
    server_version = "DebtControl/1.0"

    def log_message(self, format: str, *args) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {self.address_string()} {format % args}")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"ok": True, "db": str(DB_PATH), "static": str(STATIC_DIR)})
            return
        if parsed.path == "/api/debts":
            query = parse_qs(parsed.query)
            as_of = query.get("as_of", [current_month_key()])[0]
            self.send_json([computed_debt(row, as_of) for row in fetch_debts()])
            return
        if parsed.path == "/api/summary":
            query = parse_qs(parsed.query)
            from_month = query.get("from_month", [current_month_key()])[0]
            months = int(query.get("months", ["24"])[0])
            try:
                self.send_json(build_summary(from_month, months))
            except ValueError as exc:
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/debts":
            self.send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
            return
        try:
            self.send_json(create_debt(self.read_json()), HTTPStatus.CREATED)
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))

    def do_PUT(self) -> None:
        debt_id = self.debt_id_from_path()
        if debt_id is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
            return
        try:
            self.send_json(update_debt(debt_id, self.read_json()))
        except KeyError as exc:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(exc))
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))

    def do_DELETE(self) -> None:
        debt_id = self.debt_id_from_path()
        if debt_id is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
            return
        try:
            delete_debt(debt_id)
            self.send_json({"ok": True})
        except KeyError as exc:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(exc))

    def debt_id_from_path(self) -> int | None:
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "debts"]:
            try:
                return int(parts[2])
            except ValueError:
                return None
        return None

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body)

    def send_json(self, payload, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status)

    def serve_static(self, request_path: str) -> None:
        if request_path in ("", "/"):
            target = STATIC_DIR / "index.html"
        else:
            relative = request_path.lstrip("/")
            target = (STATIC_DIR / relative).resolve()
            try:
                target.relative_to(STATIC_DIR.resolve())
            except ValueError:
                self.send_error_json(HTTPStatus.FORBIDDEN, "Ruta no permitida.")
                return
            if not target.exists() and "." not in Path(relative).name:
                target = STATIC_DIR / "index.html"

        if not target.exists() or not target.is_file():
            self.send_error_json(
                HTTPStatus.NOT_FOUND,
                "Frontend no compilado. Ejecuta pnpm build dentro de frontend.",
            )
            return

        content_type, _ = mimetypes.guess_type(str(target))
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Control local de deudas Alan/Mairon")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8008")))
    args = parser.parse_args()

    init_db()
    server = ThreadingHTTPServer((args.host, args.port), DebtHandler)
    print(f"Control de deudas en http://{args.host}:{args.port}")
    print(f"SQLite: {DB_PATH}")
    print(f"Frontend: {STATIC_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
