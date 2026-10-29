"""Store and validate per-image English captions read from the original PNGs.

Each record describes only what is visible in the image. The composed prompt is
built from the recorded items, so nothing is inferred from the source keywords.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STORE = DATA / "captions.en.jsonl"
PROMPTS = DATA / "prompts.en.json"
LOCK = DATA / ".captions.lock"

SLOTS = {
    "headwear", "outerwear", "top", "dress", "bottom", "legwear",
    "footwear", "bag", "belt", "jewelry", "eyewear", "scarf",
    "gloves", "accessory", "other",
}

# Words that add judgement instead of observation.
FLUFF = re.compile(
    r"\b(elegant|beautiful|gorgeous|stunning|chic|stylish|fashionable|trendy|"
    r"cute|lovely|pretty|adorable|charming|romantic|luxurious|luxury|premium|"
    r"high-end|perfect|amazing|glamorous|sophisticated|delightful|ideal)\b",
    re.IGNORECASE,
)


def locked(fn):
    """Serialize read-modify-write cycles from parallel caption workers."""
    handle = None
    for _ in range(1200):
        try:
            handle = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            time.sleep(0.05)
    if handle is None:
        raise SystemExit("could not acquire captions lock")
    try:
        return fn()
    finally:
        os.close(handle)
        os.unlink(LOCK)


def index_ids() -> list[str]:
    data = json.loads((DATA / "index.zh-CN.json").read_text(encoding="utf-8"))
    return [d["id"] for d in data]


def read_store() -> dict[str, dict]:
    if not STORE.exists():
        return {}
    out: dict[str, dict] = {}
    for line_no, line in enumerate(STORE.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{STORE.name}:{line_no}: invalid JSON: {exc}") from None
        out[rec["id"]] = rec
    return out


def check(rec: dict, ids: set[str]) -> list[str]:
    errors: list[str] = []
    rid = rec.get("id")
    if rid not in ids:
        errors.append(f"unknown id {rid!r}")
    scene = rec.get("scene")
    if not isinstance(scene, str) or not scene.strip():
        errors.append(f"{rid}: missing scene")
    items = rec.get("items")
    if not isinstance(items, list) or not items:
        errors.append(f"{rid}: items must be a non-empty list")
        return errors
    for n, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"{rid}: item {n} is not an object")
            continue
        slot, text = item.get("slot"), item.get("en")
        if slot not in SLOTS:
            errors.append(f"{rid}: item {n} has unknown slot {slot!r}")
        if not isinstance(text, str) or len(text.strip()) < 3:
            errors.append(f"{rid}: item {n} needs text")
            continue
        if text != text.strip() or text.endswith("."):
            errors.append(f"{rid}: item {n} must not end with a period or padding")
        if not text.isascii():
            errors.append(f"{rid}: item {n} must be ASCII English")
        if FLUFF.search(text):
            errors.append(f"{rid}: item {n} uses judgement wording: {FLUFF.search(text).group(0)!r}")
        if len(text) > 160:
            errors.append(f"{rid}: item {n} is too long ({len(text)} chars)")
    return errors


def prompt_of(rec: dict) -> str:
    parts = [i["en"].strip().rstrip(",") for i in rec["items"]]
    body = "; ".join(parts)
    scene = rec["scene"].strip().rstrip(".")
    return f"{body}. {scene}"


def cmd_status(_: argparse.Namespace) -> None:
    ids = index_ids()
    done = read_store()
    missing = [i for i in ids if i not in done]
    print(f"captioned {len(done)}/{len(ids)}; remaining {len(missing)}")
    if missing:
        print("next:", " ".join(missing[:24]))
        print("next line:", missing[0])


def cmd_ids(args: argparse.Namespace) -> None:
    ids = index_ids()
    done = read_store()
    missing = [i for i in ids if i not in done]
    print("\n".join(missing[: args.limit]))


def cmd_add(args: argparse.Namespace) -> None:
    ids = set(index_ids())
    incoming = Path(args.file).read_text(encoding="utf-8")
    records, problems = [], []
    for n, line in enumerate(incoming.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as exc:
            problems.append(f"line {n}: invalid JSON: {exc}")
            continue
        problems.extend(check(rec, ids))
        records.append(rec)
    if problems:
        print("\n".join(problems))
        raise SystemExit(f"rejected {len(problems)} problem(s); nothing written")

    def write() -> int:
        store = read_store()
        for rec in records:
            rec["prompt"] = prompt_of(rec)
            store[rec["id"]] = rec
        ordered = [store[i] for i in index_ids() if i in store]
        tmp = STORE.with_suffix(".jsonl.tmp")
        tmp.write_text(
            "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in ordered),
            encoding="utf-8",
        )
        os.replace(tmp, STORE)
        return len(ordered)

    total = locked(write)
    print(f"stored {len(records)}; total {total}/{len(ids)}")


def cmd_build(_: argparse.Namespace) -> None:
    ids = index_ids()
    store = read_store()
    missing = [i for i in ids if i not in store]
    if missing:
        print(f"WARNING: {len(missing)} images not captioned yet, e.g. {', '.join(missing[:8])}")
    prompts = {i: store[i]["prompt"] for i in ids if i in store}
    PROMPTS.write_text(
        json.dumps(
            {"count": len(prompts), "missing": len(missing), "prompts": prompts},
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    lengths = [len(p) for p in prompts.values()]
    duplicates = len(prompts) - len(set(prompts.values()))
    print(f"wrote {PROMPTS.name}: {len(prompts)} prompts; "
          f"length min/avg/max {min(lengths)}/{sum(lengths)//len(lengths)}/{max(lengths)}; "
          f"duplicate prompts {duplicates}")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(func=cmd_status)
    p_ids = sub.add_parser("ids")
    p_ids.add_argument("--limit", type=int, default=24)
    p_ids.set_defaults(func=cmd_ids)
    p_add = sub.add_parser("add")
    p_add.add_argument("--file", required=True)
    p_add.set_defaults(func=cmd_add)
    sub.add_parser("build").set_defaults(func=cmd_build)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
