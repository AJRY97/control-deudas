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
MONTHLY_DETAILS_PATH = ROOT / "monthly_details.json"
STATIC_DIR = Path(os.environ.get("DEBT_APP_STATIC", ROOT.parent / "frontend" / "dist"))
PAYER_MODES = {"alan", "mairon", "ambos", "personalizado"}
PEOPLE = {"ALAN", "MAIRON"}


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS monthly_payments (
                month TEXT NOT NULL,
                person TEXT NOT NULL,
                paid INTEGER NOT NULL DEFAULT 0,
                amount INTEGER NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '',
                paid_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (month, person)
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
    detail_data = load_monthly_details()
    statements_by_month = {statement.get("month"): statement for statement in detail_data.get("statements", [])}
    detail_items_by_month = {
        month_key: [item for item in detail_data.get("items", []) if item.get("month") == month_key and item.get("is_current")]
        for month_key in statements_by_month
    }

    for offset in range(months):
        month = add_months(from_start, offset)
        projection_month = month_key(month)
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
        statement = statements_by_month.get(projection_month)
        if statement:
            people = {person.get("person"): person for person in statement.get("people", [])}
            alan = people.get("ALAN", {}).get("settlement_charges", alan)
            mairon = people.get("MAIRON", {}).get("settlement_charges", mairon)
            active_count = len(detail_items_by_month.get(projection_month, [])) or active_count
        projection.append(
            {
                "month": projection_month,
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


def load_monthly_details() -> dict:
    if not MONTHLY_DETAILS_PATH.exists():
        return {"statements": [], "items": []}
    return json.loads(MONTHLY_DETAILS_PATH.read_text(encoding="utf-8"))


def month_detail(month: str) -> dict:
    month_start(month)
    data = load_monthly_details()
    statement = next((item for item in data.get("statements", []) if item.get("month") == month), None)
    items = [item for item in data.get("items", []) if item.get("month") == month]
    current_total = sum(item.get("person_amount", 0) for item in items if item.get("is_current"))
    future_total = sum(item.get("person_amount", 0) for item in items if item.get("is_future"))
    return {
        "month": month,
        "statement": statement,
        "items": items,
        "totals": {
            "current": current_total,
            "future": future_total,
            "all": current_total + future_total,
        },
    }


def normalize_person(value: str) -> str:
    person = str(value).strip().upper()
    if person not in PEOPLE:
        raise ValueError("Persona invalida. Usa ALAN o MAIRON.")
    return person


def expected_payment_amount(month: str, person: str) -> int:
    statement = month_detail(month).get("statement")
    if statement:
        for item in statement.get("people", []):
            if item.get("person") == person:
                return int(item.get("pay_now") or item.get("settlement_charges") or 0)

    target = month_start(month)
    amount_key = "alan_monthly" if person == "ALAN" else "mairon_monthly"
    total = 0
    for row in fetch_debts():
        start = month_start(row["start_month"])
        end = add_months(start, row["installments_total"] - 1)
        if start <= target <= end:
            total += row[amount_key]
    return total


def payment_row(month: str, person: str, row: sqlite3.Row | None) -> dict:
    expected = expected_payment_amount(month, person)
    if not row:
        return {
            "month": month,
            "person": person,
            "paid": False,
            "amount": expected,
            "expected_amount": expected,
            "note": "",
            "paid_at": None,
            "updated_at": None,
        }

    return {
        "month": row["month"],
        "person": row["person"],
        "paid": bool(row["paid"]),
        "amount": (row["amount"] or expected) if row["paid"] else expected,
        "expected_amount": expected,
        "note": row["note"],
        "paid_at": row["paid_at"],
        "updated_at": row["updated_at"],
    }


def month_payments(month: str) -> dict:
    month_start(month)
    with connect() as conn:
        rows = {
            row["person"]: row
            for row in conn.execute("SELECT * FROM monthly_payments WHERE month = ?", (month,)).fetchall()
        }
    people = [payment_row(month, person, rows.get(person)) for person in ("ALAN", "MAIRON")]
    paid_total = sum(item["amount"] for item in people if item["paid"])
    expected_total = sum(item["expected_amount"] for item in people)
    return {
        "month": month,
        "people": people,
        "all_paid": all(item["paid"] for item in people),
        "paid_total": paid_total,
        "pending_total": expected_total - paid_total,
        "expected_total": expected_total,
    }


def update_month_payment(payload: dict) -> dict:
    month = str(payload.get("month", "")).strip()
    month_start(month)
    person = normalize_person(payload.get("person", ""))
    paid = bool(payload.get("paid"))
    amount = as_int(payload, "amount", expected_payment_amount(month, person))
    if amount <= 0:
        amount = expected_payment_amount(month, person)
    note = str(payload.get("note", "")).strip()
    stamp = now_iso()
    paid_at = stamp if paid else None

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO monthly_payments (
                month, person, paid, amount, note, paid_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(month, person) DO UPDATE SET
                paid = excluded.paid,
                amount = excluded.amount,
                note = excluded.note,
                paid_at = excluded.paid_at,
                updated_at = excluded.updated_at
            """,
            (month, person, int(paid), amount, note, paid_at, stamp),
        )
    return month_payments(month)


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
        if parsed.path == "/api/month-detail":
            query = parse_qs(parsed.query)
            month = query.get("month", [current_month_key()])[0]
            try:
                self.send_json(month_detail(month))
            except ValueError as exc:
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        if parsed.path == "/api/month-payments":
            query = parse_qs(parsed.query)
            month = query.get("month", [current_month_key()])[0]
            try:
                self.send_json(month_payments(month))
            except ValueError as exc:
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/month-payments":
            try:
                self.send_json(update_month_payment(self.read_json()))
            except ValueError as exc:
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        if path != "/api/debts":
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
