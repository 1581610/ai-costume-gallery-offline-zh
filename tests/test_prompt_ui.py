"""Check that the reverse-engineered English prompt is shown and copyable."""
from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
INDEX = json.loads((ROOT / "data/index.zh-CN.json").read_text(encoding="utf-8"))
FIRST, SECOND = INDEX[0], INDEX[1]
SCENE_WORDS = ("mannequin", "background", "studio", "seamless", "invisible")


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.grant_permissions(["clipboard-read", "clipboard-write"])
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto((ROOT / "index.html").as_uri())

        page.locator(".card").first.click()
        expect(page.locator("#viewerPrompt")).to_have_text(FIRST["prompt"])
        shown = page.locator("#viewerPrompt").inner_text()
        assert not any(word in shown.lower() for word in SCENE_WORDS), shown
        assert not shown.rstrip().endswith("."), shown
        page.click("#copyPrompt")
        expect(page.locator("#toast")).to_contain_text("已复制英文生图提示词")
        assert page.evaluate("navigator.clipboard.readText()") == FIRST["prompt"]

        page.click("#closeViewer")
        page.fill("#search", SECOND["id"])
        expect(page.locator(".card")).to_have_count(1)
        page.click("#copyPrompts")
        expect(page.locator("#toast")).to_contain_text("已复制 1 条提示词")
        assert page.evaluate("navigator.clipboard.readText()") == SECOND["prompt"]

        page.set_viewport_size({"width": 390, "height": 844})
        page.locator(".card").first.click()
        assert page.locator("#viewerPrompt").is_visible()
        page.screenshot(path=str(ROOT / "tests/artifacts/prompt-mobile.png"))
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        assert not errors, errors
        context.close()
        browser.close()
    print("PASS prompt shown, single and bulk copy work, mobile layout fits")


if __name__ == "__main__":
    main()
