"""Check the per-costume English prompts that the gallery exposes."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SCENE = "outfit displayed on invisible mannequin, no head or hands, light grey seamless studio background"
FLUFF = re.compile(
    r"\b(elegant|beautiful|gorgeous|stunning|chic|stylish|fashionable|trendy|"
    r"cute|lovely|pretty|adorable|charming|romantic|luxurious|luxury|premium|"
    r"high-end|perfect|amazing|glamorous|sophisticated|delightful|ideal)\b",
    re.IGNORECASE,
)


def main() -> None:
    index = json.loads((DATA / "index.zh-CN.json").read_text(encoding="utf-8"))
    prompts = json.loads((DATA / "prompts.en.json").read_text(encoding="utf-8"))
    table = prompts["prompts"]
    ids = [d["id"] for d in index]

    assert prompts["count"] == len(ids), f"{prompts['count']} prompts for {len(ids)} costumes"
    assert prompts["missing"] == 0, f"{prompts['missing']} costumes have no prompt"
    assert set(table) == set(ids), "prompt ids differ from the index"
    assert len(set(table.values())) == len(table), "duplicate prompts"

    for costume in index:
        prompt = costume.get("prompt")
        assert prompt == table[costume["id"]], f"{costume['id']}: page prompt differs from prompts.en.json"
        assert prompt.isascii(), f"{costume['id']}: prompt is not ASCII"
        assert prompt.endswith(SCENE), f"{costume['id']}: prompt does not end with the scene sentence"
        body = prompt[: -len(SCENE)].strip()
        assert body.endswith("."), f"{costume['id']}: prompt body is not closed before the scene sentence"
        body = body[:-1].rstrip()
        assert body and not body.endswith("."), f"{costume['id']}: prompt body is empty or ends with a period"
        assert len(prompt) <= 1600, f"{costume['id']}: prompt is {len(prompt)} chars"
        assert not FLUFF.search(body), f"{costume['id']}: prompt uses judgement wording"
        for part in body.split("; "):
            assert part.strip() == part and part, f"{costume['id']}: padded or empty item"
            assert "," in part or len(part) <= 90, f"{costume['id']}: item is vague: {part!r}"

    print(f"PASS {len(table)} English prompts are complete, unique and consistent with the page")


if __name__ == "__main__":
    main()
