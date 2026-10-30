"""Check the per-costume English prompts that the gallery exposes."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
# The prompt is pasted straight into an image generator, so it must not carry
# backdrop, studio or mannequin wording.
SCENE_WORDS = re.compile(
    r"\b(mannequin|background|backdrop|studio|seamless|invisible|no head|no hands|"
    r"scene|displayed on|shot on|photo of|photograph)\b",
    re.IGNORECASE,
)
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
        assert SCENE_WORDS.search(prompt) is None, (
            f"{costume['id']}: prompt mentions a scene, studio or mannequin: "
            f"{SCENE_WORDS.search(prompt).group(0)!r}"
        )
        assert not prompt.endswith("."), f"{costume['id']}: prompt ends with a period"
        assert len(prompt) <= 1600, f"{costume['id']}: prompt is {len(prompt)} chars"
        assert not FLUFF.search(prompt), f"{costume['id']}: prompt uses judgement wording"
        for part in prompt.split("; "):
            assert part.strip() == part and part, f"{costume['id']}: padded or empty item"
            assert "," in part or len(part) <= 90, f"{costume['id']}: item is vague: {part!r}"

    for line in (DATA / "captions.en.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        expected = "; ".join(item["en"].strip().rstrip(",") for item in record["items"])
        assert table[record["id"]] == expected, f"{record['id']}: prompt is not just its item list"

    print(f"PASS {len(table)} English prompts are complete, unique, garment-only and consistent with the page")


if __name__ == "__main__":
    main()
