"""静态检查：页面不联网、不用库和模块、file:// 能打开、署名和许可证齐全；顺带跑 Node 单元测试。"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PLAY = ROOT / "play"
HTML = (PLAY / "index.html").read_text(encoding="utf-8")
SOURCES = sorted(PLAY.rglob("*.js")) + sorted(PLAY.rglob("*.css")) + [PLAY / "index.html"]


def test_root_files():
    for name in [".nojekyll", "index.html", "LICENSE", "LICENSE-docs", "README.md", "CITATION.cff", "credits.json", "THIRD_PARTY.md"]:
        assert (ROOT / name).exists(), name
    assert "play/index.html" in (ROOT / "index.html").read_text(encoding="utf-8")


def test_scripts_and_styles_exist_and_are_plain():
    refs = re.findall(r'<script src="([^"]+)"', HTML) + re.findall(r'<link rel="stylesheet" href="([^"]+)"', HTML)
    assert len(refs) >= 10
    for r in refs:
        assert not r.startswith(("http:", "https:", "//")), r
        assert (PLAY / r).exists(), r
    assert 'type="module"' not in HTML


def test_no_network_no_eval():
    for f in SOURCES:
        s = f.read_text(encoding="utf-8")
        assert not re.search(r"\bfetch\s*\(|XMLHttpRequest|serviceWorker|\bimport\s*\(|^\s*import\s|\beval\s*\(|new Function", s, re.M), f.name
        urls = set(re.findall(r"https?://[^\s'\"<>)]+", s))
        urls -= {"http://www.w3.org/2000/svg"}
        urls = {u for u in urls if not u.startswith("https://shuyaogao.github.io/")}
        assert not urls, (f.name, urls)


def test_paths_are_ascii():
    for f in PLAY.rglob("*"):
        assert f.relative_to(ROOT).as_posix().isascii(), f


def test_credits_match():
    c = json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))
    js = (PLAY / "js" / "credits.js").read_text(encoding="utf-8")
    for k in ["AUTHOR", "AUTHOR_EMAIL", "UNIVERSITY_EN", "UNIVERSITY_KO", "REPO_NAME"]:
        assert c[k] in js, k
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert readme.startswith("> [← 返回 AI 教学演示总导览](https://shuyaogao.github.io/)")
    assert c["UNIVERSITY_KO"] in readme and "CC BY 4.0" in readme and "MIT" in readme


def test_ui_is_chinese():
    tabs = re.findall(r'data-mode="\w+" role="tab"[^>]*>([^<]+)<', HTML)
    assert tabs == ["观看", "我来画", "练习"]


def test_page_size():
    total = sum(f.stat().st_size for f in PLAY.rglob("*") if f.is_file())
    assert total < 400_000, total


@pytest.mark.skipif(shutil.which("node") is None, reason="需要 Node.js")
def test_node_unit_tests():
    r = subprocess.run(["node", str(ROOT / "tests" / "js" / "unit_tests.js")], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


def test_browser_check_results():
    """results/browser_check.json 由 node tools/browser_check.js 生成；这里检查它是全部通过的。"""
    p = ROOT / "results" / "browser_check.json"
    assert p.exists()
    r = json.loads(p.read_text(encoding="utf-8"))
    assert r["ok"] and r["selftest"]["ok"]
    sizes = {s["size"] for s in r["sizes"]}
    assert {"手机 390×844", "手机 360×780", "平板 768×1024", "电脑 1366×768", "电脑 1920×1080"} <= sizes
    assert {s["scheme"] for s in r["sizes"]} == {"light", "dark"}
