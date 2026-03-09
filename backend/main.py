from __future__ import annotations

import base64
import json
import os
import random
import re
import sqlite3
from typing import Any

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:9b")
DB_PATH = os.getenv("DB_PATH", os.path.abspath(os.path.join(os.path.dirname(__file__), "keywords.sqlite3")))

ALLOWED_CATEGORIES = [
    "subject",
    "pose",
    "cloth",
    "style",
    "lighting",
    "camera",
    "composition",
    "background",
    "color",
    "mood",
    "quality",
    "other",
]

app = FastAPI(title="Image Keyword Generator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/static", StaticFiles(directory=frontend_dir), name="frontend")


def _db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _db_init() -> None:
    conn = _db_connect()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS keywords (
              keyword TEXT PRIMARY KEY,
              count INTEGER NOT NULL DEFAULT 0,
              category TEXT,
              subcategory TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )

        cols = {
            r["name"]
            for r in conn.execute("PRAGMA table_info(keywords)").fetchall()
        }
        if "category" not in cols:
            conn.execute("ALTER TABLE keywords ADD COLUMN category TEXT")
        if "subcategory" not in cols:
            conn.execute("ALTER TABLE keywords ADD COLUMN subcategory TEXT")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generation_keywords (
              generation_id INTEGER NOT NULL,
              keyword TEXT NOT NULL,
              PRIMARY KEY (generation_id, keyword),
              FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
              FOREIGN KEY (keyword) REFERENCES keywords(keyword) ON DELETE CASCADE
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def _dedupe_keywords() -> None:
    conn = _db_connect()
    try:
        rows = conn.execute("SELECT keyword, count, category, subcategory FROM keywords").fetchall()
        mapping: dict[str, str] = {}
        merges: list[tuple[str, str]] = []

        for r in rows:
            orig = r["keyword"]
            nk = _normalize_keyword(orig)
            if not nk:
                continue

            if nk in mapping:
                merges.append((orig, mapping[nk]))
                continue

            if nk != orig:
                mapping[nk] = nk
                merges.append((orig, nk))
            else:
                mapping[nk] = orig

        if not merges:
            return

        for orig, target in merges:
            if orig == target:
                continue

            src = conn.execute(
                "SELECT count, category, subcategory FROM keywords WHERE keyword = ?",
                (orig,),
            ).fetchone()
            if src is None:
                continue

            src_count = int(src["count"] or 0)
            src_cat = src["category"]
            src_sub = src["subcategory"]

            conn.execute(
                "INSERT OR IGNORE INTO keywords(keyword, count, category, subcategory, created_at, updated_at) VALUES(?, 0, NULL, NULL, datetime('now'), datetime('now'))",
                (target,),
            )

            tgt = conn.execute(
                "SELECT count, category, subcategory FROM keywords WHERE keyword = ?",
                (target,),
            ).fetchone()
            tgt_cat = tgt["category"] if tgt is not None else None
            tgt_sub = tgt["subcategory"] if tgt is not None else None

            if (tgt_cat is None or str(tgt_cat).strip() == "") and isinstance(src_cat, str) and src_cat.strip():
                conn.execute(
                    "UPDATE keywords SET category = ?, updated_at = datetime('now') WHERE keyword = ?",
                    (src_cat, target),
                )

            if (tgt_sub is None or str(tgt_sub).strip() == "") and isinstance(src_sub, str) and src_sub.strip():
                conn.execute(
                    "UPDATE keywords SET subcategory = ?, updated_at = datetime('now') WHERE keyword = ?",
                    (src_sub, target),
                )

            if src_count:
                conn.execute(
                    "UPDATE keywords SET count = count + ?, updated_at = datetime('now') WHERE keyword = ?",
                    (src_count, target),
                )

            conn.execute(
                "INSERT OR IGNORE INTO generation_keywords(generation_id, keyword) SELECT generation_id, ? FROM generation_keywords WHERE keyword = ?",
                (target, orig),
            )
            conn.execute("DELETE FROM generation_keywords WHERE keyword = ?", (orig,))
            conn.execute("DELETE FROM keywords WHERE keyword = ?", (orig,))

        conn.execute(
            "DELETE FROM generations WHERE id NOT IN (SELECT DISTINCT generation_id FROM generation_keywords)"
        )
        conn.commit()
    finally:
        conn.close()


def _normalize_keyword(s: str) -> str | None:
    s = (s or "").strip().lower()
    if not s:
        return None
    s = re.sub(r"\s+", " ", s)
    return s


def _normalize_category(s: str | None) -> str:
    c = (s or "").strip().lower()
    return c if c in ALLOWED_CATEGORIES else "other"


def _normalize_subcategory(s: str | None) -> str | None:
    if s is None:
        return None
    ns = _normalize_keyword(str(s))
    return ns


def _record_keywords(keywords: list[str]) -> int | None:
    if not keywords:
        return None

    normalized = []
    seen: set[str] = set()
    for k in keywords:
        nk = _normalize_keyword(k)
        if not nk or nk in seen:
            continue
        seen.add(nk)
        normalized.append(nk)

    if not normalized:
        return None

    conn = _db_connect()
    try:
        cur = conn.execute("INSERT INTO generations DEFAULT VALUES")
        generation_id = int(cur.lastrowid)

        for nk in normalized:
            conn.execute(
                """
                INSERT INTO keywords(keyword, count, created_at, updated_at)
                VALUES(?, 1, datetime('now'), datetime('now'))
                ON CONFLICT(keyword) DO UPDATE SET
                  count = count + 1,
                  updated_at = datetime('now')
                """,
                (nk,),
            )

            conn.execute(
                """
                INSERT OR IGNORE INTO generation_keywords(generation_id, keyword)
                VALUES(?, ?)
                """,
                (generation_id, nk),
            )
        conn.commit()
        return generation_id
    finally:
        conn.close()


@app.on_event("startup")
def startup() -> None:
    _db_init()
    _dedupe_keywords()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(frontend_dir, "index.html"))


@app.get("/random")
def random_page() -> FileResponse:
    return FileResponse(os.path.join(frontend_dir, "random.html"))


@app.get("/api/ollama_health")
async def ollama_health() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            r.raise_for_status()
            data = r.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Ollama: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e.response.text}")

    models = data.get("models") if isinstance(data, dict) else None
    names: list[str] = []
    if isinstance(models, list):
        for m in models:
            name = m.get("name") if isinstance(m, dict) else None
            if isinstance(name, str):
                names.append(name)

    return {
        "ollama_base_url": OLLAMA_BASE_URL,
        "configured_model": OLLAMA_MODEL,
        "models": names,
        "configured_model_present": OLLAMA_MODEL in names,
    }


@app.post("/api/generate")
async def generate_keywords(image: UploadFile = File(...)) -> dict[str, Any]:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty upload")

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    instruction = (
        "Analyze the image and generate keywords for AI image generation.\n"
        "Return STRICT JSON only with this schema:\n"
        "{\"keywords\": [string], \"prompt\": string, \"negative_prompt\": string}\n"
        "Rules:\n"
        "- keywords: 15-35 short tags, lower-case, no duplicates\n"
        "- prompt: a single concise prompt suitable for Stable Diffusion / Flux\n"
        "- negative_prompt: common negatives (blurry, low quality, etc.)\n"
        "- No extra keys, no markdown, no commentary."
    )

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": instruction,
                "images": [image_b64],
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Ollama: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e.response.text}")

    message = (data.get("message") or {}).get("content")
    if not message or not isinstance(message, str):
        raise HTTPException(status_code=502, detail="Unexpected Ollama response")

    parsed: dict[str, Any] | None = None
    try:
        parsed = json.loads(message)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", message, flags=re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except json.JSONDecodeError:
                parsed = None

    keywords: list[str] | None = None
    prompt: str | None = None
    negative_prompt: str | None = None

    if isinstance(parsed, dict):
        k = parsed.get("keywords")
        p = parsed.get("prompt")
        n = parsed.get("negative_prompt")

        if isinstance(k, list) and all(isinstance(x, str) for x in k):
            keywords = k
        if isinstance(p, str):
            prompt = p
        if isinstance(n, str):
            negative_prompt = n

    if keywords:
        _record_keywords(keywords)
        await _auto_categorize_keywords(keywords)

    return {
        "model": OLLAMA_MODEL,
        "raw": message,
        "keywords": keywords,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
    }


async def _auto_categorize_keywords(keywords: list[str]) -> None:
    normalized = []
    seen: set[str] = set()
    for k in keywords:
        nk = _normalize_keyword(k)
        if not nk or nk in seen:
            continue
        seen.add(nk)
        normalized.append(nk)

    if not normalized:
        return

    conn = _db_connect()
    try:
        placeholders = ",".join(["?"] * len(normalized))
        rows = conn.execute(
            f"SELECT keyword FROM keywords WHERE keyword IN ({placeholders}) AND (category IS NULL OR category = '')",
            tuple(normalized),
        ).fetchall()
        to_classify = [r["keyword"] for r in rows]
    finally:
        conn.close()

    if not to_classify:
        return

    instruction = (
        "You are categorizing prompt keywords for image generation. "
        "Pick ONE category for each keyword from this list:\n"
        f"{ALLOWED_CATEGORIES}\n"
        "Return STRICT JSON only, mapping keyword to category. Example:\n"
        "{\"cinematic lighting\": \"lighting\", \"35mm\": \"camera\"}\n"
        "No markdown, no commentary."
    )

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": instruction + "\n\nKeywords:\n" + "\n".join(to_classify),
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
            r.raise_for_status()
            data = r.json()
    except Exception:
        return

    message = (data.get("message") or {}).get("content")
    if not message or not isinstance(message, str):
        return

    parsed: dict[str, Any] | None = None
    try:
        parsed = json.loads(message)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", message, flags=re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except json.JSONDecodeError:
                parsed = None

    if not isinstance(parsed, dict):
        return

    updates: list[tuple[str, str]] = []
    for k, v in parsed.items():
        if not isinstance(k, str):
            continue
        nk = _normalize_keyword(k)
        if not nk:
            continue
        if nk not in to_classify:
            continue
        cat = _normalize_category(v if isinstance(v, str) else None)
        updates.append((cat, nk))

    if not updates:
        return

    conn = _db_connect()
    try:
        conn.executemany(
            "UPDATE keywords SET category = COALESCE(NULLIF(category, ''), ?), updated_at = datetime('now') WHERE keyword = ?",
            updates,
        )
        conn.commit()
    finally:
        conn.close()


@app.get("/api/keywords")
def list_keywords(limit: int = 200, q: str | None = None, category: str | None = None) -> dict[str, Any]:
    if limit < 0:
        raise HTTPException(status_code=400, detail="limit must be >= 0")
    if limit > 2000:
        limit = 2000

    cat = None
    if category is not None:
        cat = _normalize_category(category)

    conn = _db_connect()
    try:
        if q and cat:
            qn = f"%{_normalize_keyword(q) or ''}%"
            rows = conn.execute(
                "SELECT keyword, count, category, subcategory FROM keywords WHERE category = ? AND keyword LIKE ? ORDER BY count DESC, keyword ASC LIMIT ?",
                (cat, qn, limit),
            ).fetchall()
        elif q:
            qn = f"%{_normalize_keyword(q) or ''}%"
            rows = conn.execute(
                "SELECT keyword, count, category, subcategory FROM keywords WHERE keyword LIKE ? ORDER BY count DESC, keyword ASC LIMIT ?",
                (qn, limit),
            ).fetchall()
        elif cat:
            rows = conn.execute(
                "SELECT keyword, count, category, subcategory FROM keywords WHERE category = ? ORDER BY count DESC, keyword ASC LIMIT ?",
                (cat, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT keyword, count, category, subcategory FROM keywords ORDER BY count DESC, keyword ASC LIMIT ?",
                (limit,),
            ).fetchall()

        return {
            "items": [
                {
                    "keyword": r["keyword"],
                    "count": r["count"],
                    "category": r["category"] or None,
                    "subcategory": r["subcategory"] or None,
                }
                for r in rows
            ],
        }
    finally:
        conn.close()


@app.get("/api/categories")
def categories() -> dict[str, Any]:
    return {"items": ALLOWED_CATEGORIES}


@app.post("/api/keyword_category")
def set_keyword_category(payload: dict[str, Any]) -> dict[str, Any]:
    kw = payload.get("keyword")
    cat = payload.get("category")
    sub = payload.get("subcategory")
    if not isinstance(kw, str):
        raise HTTPException(status_code=400, detail="keyword is required")
    nk = _normalize_keyword(kw)
    if not nk:
        raise HTTPException(status_code=400, detail="keyword is required")
    if not isinstance(cat, str):
        raise HTTPException(status_code=400, detail="category is required")
    nc = _normalize_category(cat)
    ns = _normalize_subcategory(sub)

    conn = _db_connect()
    try:
        conn.execute(
            "UPDATE keywords SET category = ?, subcategory = ?, updated_at = datetime('now') WHERE keyword = ?",
            (nc, ns, nk),
        )
        conn.commit()
    finally:
        conn.close()

    return {"keyword": nk, "category": nc, "subcategory": ns}


@app.post("/api/add_keyword")
def add_keyword(payload: dict[str, Any]) -> dict[str, Any]:
    kw = payload.get("keyword")
    cat = payload.get("category")
    sub = payload.get("subcategory")
    if not isinstance(kw, str):
        raise HTTPException(status_code=400, detail="keyword is required")
    nk = _normalize_keyword(kw)
    if not nk:
        raise HTTPException(status_code=400, detail="keyword is required")

    nc = _normalize_category(cat if isinstance(cat, str) else None)
    ns = _normalize_subcategory(sub)

    conn = _db_connect()
    try:
        conn.execute(
            """
            INSERT INTO keywords(keyword, count, category, subcategory, created_at, updated_at)
            VALUES(?, 1, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(keyword) DO UPDATE SET
              count = count + 1,
              category = COALESCE(NULLIF(keywords.category, ''), excluded.category),
              subcategory = COALESCE(NULLIF(keywords.subcategory, ''), excluded.subcategory),
              updated_at = datetime('now')
            """,
            (nk, nc, ns),
        )
        conn.commit()
    finally:
        conn.close()

    return {"keyword": nk, "category": nc, "subcategory": ns}


@app.post("/api/delete_keyword")
def delete_keyword(payload: dict[str, Any]) -> dict[str, Any]:
    kw = payload.get("keyword")
    if not isinstance(kw, str):
        raise HTTPException(status_code=400, detail="keyword is required")
    nk = _normalize_keyword(kw)
    if not nk:
        raise HTTPException(status_code=400, detail="keyword is required")

    conn = _db_connect()
    try:
        conn.execute("DELETE FROM generation_keywords WHERE keyword = ?", (nk,))
        cur = conn.execute("DELETE FROM keywords WHERE keyword = ?", (nk,))
        conn.execute(
            "DELETE FROM generations WHERE id NOT IN (SELECT DISTINCT generation_id FROM generation_keywords)"
        )
        conn.commit()
    finally:
        conn.close()

    return {"deleted": int(cur.rowcount), "keyword": nk}


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    conn = _db_connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS unique_keywords, COALESCE(SUM(count), 0) AS total_records FROM keywords"
        ).fetchone()
        grow = conn.execute("SELECT COUNT(*) AS generations FROM generations").fetchone()
        return {
            "unique_keywords": int(row["unique_keywords"]),
            "total_records": int(row["total_records"]),
            "generations": int(grow["generations"]),
        }
    finally:
        conn.close()


@app.get("/api/random_prompt")
def random_prompt(n: int = 20, coherent: bool = True) -> dict[str, Any]:
    if n <= 0:
        raise HTTPException(status_code=400, detail="n must be > 0")
    if n > 80:
        n = 80

    conn = _db_connect()
    try:
        kws: list[str] = []

        if coherent:
            gen = conn.execute(
                """
                SELECT g.id AS id
                FROM generations g
                JOIN generation_keywords gk ON gk.generation_id = g.id
                GROUP BY g.id
                HAVING COUNT(*) >= ?
                ORDER BY RANDOM()
                LIMIT 1
                """,
                (n,),
            ).fetchone()

            if gen is None:
                gen = conn.execute(
                    "SELECT id FROM generations ORDER BY RANDOM() LIMIT 1"
                ).fetchone()

            if gen is not None:
                rows = conn.execute(
                    """
                    SELECT keyword
                    FROM generation_keywords
                    WHERE generation_id = ?
                    ORDER BY RANDOM()
                    LIMIT ?
                    """,
                    (int(gen["id"]), n),
                ).fetchall()
                kws = [r["keyword"] for r in rows]

        if not kws:
            rows = conn.execute(
                "SELECT keyword FROM keywords ORDER BY RANDOM() LIMIT ?",
                (n,),
            ).fetchall()
            kws = [r["keyword"] for r in rows]
    finally:
        conn.close()

    return {
        "keywords": kws,
        "prompt": ", ".join(kws),
    }


@app.post("/api/build_prompt")
def build_prompt(payload: dict[str, Any]) -> dict[str, Any]:
    n_raw = payload.get("n", 20)
    coherent = bool(payload.get("coherent", True))
    required_raw = payload.get("required", [])

    try:
        n = int(n_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="n must be an integer")

    if n <= 0:
        raise HTTPException(status_code=400, detail="n must be > 0")
    if n > 80:
        n = 80

    if required_raw is None:
        required_raw = []
    if not isinstance(required_raw, list) or any(not isinstance(x, str) for x in required_raw):
        raise HTTPException(status_code=400, detail="required must be a list of strings")

    required: list[str] = []
    seen: set[str] = set()
    for x in required_raw:
        nx = _normalize_keyword(x)
        if not nx or nx in seen:
            continue
        seen.add(nx)
        required.append(nx)

    if len(required) > n:
        required = required[:n]

    remaining = max(0, n - len(required))

    conn = _db_connect()
    try:
        extra: list[str] = []

        if coherent and remaining > 0:
            if required:
                placeholders = ",".join(["?"] * len(required))
                gen = conn.execute(
                    f"""
                    SELECT gk.generation_id AS id
                    FROM generation_keywords gk
                    WHERE gk.keyword IN ({placeholders})
                    GROUP BY gk.generation_id
                    HAVING COUNT(DISTINCT gk.keyword) = ?
                    ORDER BY RANDOM()
                    LIMIT 1
                    """,
                    (*required, len(required)),
                ).fetchone()
            else:
                gen = conn.execute(
                    "SELECT id FROM generations ORDER BY RANDOM() LIMIT 1"
                ).fetchone()

            if gen is not None:
                if required:
                    placeholders = ",".join(["?"] * len(required))
                    rows = conn.execute(
                        f"""
                        SELECT keyword
                        FROM generation_keywords
                        WHERE generation_id = ?
                          AND keyword NOT IN ({placeholders})
                        ORDER BY RANDOM()
                        LIMIT ?
                        """,
                        (int(gen["id"]), *required, remaining),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT keyword
                        FROM generation_keywords
                        WHERE generation_id = ?
                        ORDER BY RANDOM()
                        LIMIT ?
                        """,
                        (int(gen["id"]), remaining),
                    ).fetchall()

                extra = [r["keyword"] for r in rows]

        if remaining > 0 and len(extra) < remaining:
            need = remaining - len(extra)
            if required:
                placeholders = ",".join(["?"] * len(required))
                rows = conn.execute(
                    f"""
                    SELECT keyword
                    FROM keywords
                    WHERE keyword NOT IN ({placeholders})
                    ORDER BY RANDOM()
                    LIMIT ?
                    """,
                    (*required, need),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT keyword FROM keywords ORDER BY RANDOM() LIMIT ?",
                    (need,),
                ).fetchall()
            extra.extend([r["keyword"] for r in rows])
    finally:
        conn.close()

    final_keywords = required + [k for k in extra if k not in seen]
    final_keywords = final_keywords[:n]

    shuffled = list(final_keywords)
    random.shuffle(shuffled)

    return {
        "required": required,
        "keywords": shuffled,
        "prompt": ", ".join(shuffled),
    }
