import json
import random
import re
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError, sync_playwright


INPUT_HTML = Path("/Users/lastjob/Downloads/光伏.html")
OUTPUT_DIR = Path("/Users/lastjob/Downloads/光伏附件")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
PAGE_TIMEOUT_MS = 30_000
MIN_DELAY_SECONDS = 1.5
MAX_DELAY_SECONDS = 4.5
PROGRESS_FILE = OUTPUT_DIR / "progress.json"
DONE_FILE_NAME = ".done.json"


def human_pause(min_seconds: float = MIN_DELAY_SECONDS, max_seconds: float = MAX_DELAY_SECONDS) -> None:
    time.sleep(random.uniform(min_seconds, max_seconds))


def sanitize_name(name: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]", "_", name).strip()
    return cleaned or "untitled"


def unique_path(target_dir: Path, base_name: str, suffix: str) -> Path:
    candidate = target_dir / f"{base_name}{suffix}"
    index = 1
    while candidate.exists():
        candidate = target_dir / f"{base_name}_{index}{suffix}"
        index += 1
    return candidate


def load_progress() -> set[str]:
    if not PROGRESS_FILE.exists():
        return set()
    try:
        payload = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        processed = payload.get("processed_urls", [])
        return {str(item) for item in processed if item}
    except Exception:
        return set()


def save_progress(processed_urls: set[str]) -> None:
    payload = {
        "processed_urls": sorted(processed_urls),
        "processed_count": len(processed_urls),
        "updated_at": int(time.time()),
    }
    PROGRESS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_local_list(page) -> list[tuple[str, str]]:
    page.goto(INPUT_HTML.resolve().as_uri(), wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
    page.wait_for_selector("ul.infoList.infoListDet li", timeout=10_000)

    locator = page.locator("ul.infoList.infoListDet li")
    results: list[tuple[str, str]] = []
    count = locator.count()

    for index in range(count):
        item = locator.nth(index)
        title_link = item.locator("h5 a").first
        if title_link.count() == 0:
            continue
        title = title_link.inner_text(timeout=2_000).strip()
        href = (title_link.get_attribute("href") or "").strip()
        if not title or not href:
            continue
        if "云南" not in title:
            continue
        results.append((title, href))

    return results


def download_article_images(context, page, title: str, url: str) -> int:
    article_dir = OUTPUT_DIR / sanitize_name(title)
    article_dir.mkdir(parents=True, exist_ok=True)
    done_file = article_dir / DONE_FILE_NAME
    if done_file.exists():
        print(f"[跳过] {title} 已完成")
        return -1

    human_pause()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
        page.wait_for_selector("div#content", timeout=10_000)
        page.wait_for_timeout(1200)
    except TimeoutError:
        print(f"[失败] {title} 页面加载超时: {url}")
        return 0
    except Exception as exc:
        print(f"[失败] {title} 页面打开异常: {exc}")
        return 0

    container = page.locator("div#content").first
    image_locator = container.locator("img")
    image_count = image_locator.count()
    if image_count == 0:
        print(f"[提示] {title} 正文没有图片")
        done_file.write_text(json.dumps({"title": title, "url": url, "downloaded": 0}, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0

    downloaded = 0
    seen_urls: set[str] = set()
    for index in range(image_count):
        image = image_locator.nth(index)
        src = (
            image.get_attribute("src")
            or image.get_attribute("data-src")
            or image.get_attribute("data-original")
            or ""
        ).strip()
        if not src or src.startswith("data:"):
            continue
        if src in seen_urls:
            continue
        seen_urls.add(src)

        parsed = urlparse(src)
        suffix = Path(parsed.path).suffix or ".jpg"
        filename = sanitize_name(Path(parsed.path).stem or f"image_{index + 1}")
        target_path = unique_path(article_dir, filename, suffix)

        human_pause(0.8, 2.0)
        try:
            response = context.request.get(src, timeout=PAGE_TIMEOUT_MS)
            if not response.ok:
                print(f"  [图片失败] HTTP {response.status}: {src}")
                continue
            target_path.write_bytes(response.body())
            downloaded += 1
            print(f"  [图片] 已保存 {target_path}")
        except Exception as exc:
            print(f"  [图片失败] {src} -> {exc}")

    done_file.write_text(
        json.dumps(
            {"title": title, "url": url, "downloaded": downloaded},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return downloaded


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    processed_urls = load_progress()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        context = browser.new_context(user_agent=USER_AGENT, locale="zh-CN")
        list_page = context.new_page()

        articles = parse_local_list(list_page)
        print(f"[列表] 标题包含“云南”的新闻共 {len(articles)} 条")

        detail_page = context.new_page()
        total_images = 0
        processed_count = 0
        for title, url in articles:
            if url in processed_urls:
                print(f"[跳过] 已在进度文件中处理过: {title}")
                continue
            print(f"[处理] {title}")
            image_count = download_article_images(context, detail_page, title, url)
            processed_urls.add(url)
            save_progress(processed_urls)
            processed_count += 1
            if image_count > 0:
                total_images += image_count

        print(f"[完成] 本次处理 {processed_count} 条新闻，累计下载图片 {total_images} 张")
        detail_page.close()
        list_page.close()
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
