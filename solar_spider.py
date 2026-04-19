import argparse
import json
import random
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import BrowserContext, Page, TimeoutError, sync_playwright


BASE_URL = "https://solar.in-en.com"
START_ID = 2459529
URL_TEMPLATE = BASE_URL + "/html/solar-{id}.shtml"
OUTPUT_ROOT = Path("/Users/lastjob/Downloads/场站资料整理/solar")
SITE_PREFIX = "solar"
PAGE_TIMEOUT_MS = 30_000
MIN_DELAY = 1
MAX_DELAY = 3
MAX_CONSECUTIVE_MISSES = 10
TITLE_KEYWORD = "云南"
PROGRESS_FILE_NAME = "progress.json"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def parse_args():
    parser = argparse.ArgumentParser(description="使用 Playwright 抓取国际太阳能光伏网文章和正文图片")
    parser.add_argument("--start-id", type=int, default=START_ID, help="起始文章 ID")
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT), help="文章保存根目录")
    parser.add_argument("--headless", action="store_true", help="以无头模式运行")
    return parser.parse_args()


def polite_sleep() -> None:
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def sanitize_name(name: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]", "_", name).strip()
    return cleaned or "image"


def make_article_dir_name(url: str) -> str:
    parsed = urlparse(url)
    raw_name = f"{parsed.netloc}{parsed.path}"
    return sanitize_name(raw_name.replace("/", "_"))


def load_progress(output_root: Path, default_start_id: int) -> int:
    progress_path = output_root / PROGRESS_FILE_NAME
    if not progress_path.exists():
        return default_start_id

    try:
        payload = json.loads(progress_path.read_text(encoding="utf-8"))
        next_id = int(payload.get("next_id", default_start_id))
        return next_id if next_id > 0 else default_start_id
    except Exception:
        return default_start_id


def save_progress(output_root: Path, next_id: int) -> None:
    progress_path = output_root / PROGRESS_FILE_NAME
    payload = {"next_id": next_id, "updated_at": int(time.time())}
    progress_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def find_article_container(soup: BeautifulSoup):
    selectors = [
        ".news_con",
        ".content",
        ".article-content",
        ".info_con",
        "#content",
        ".news_show",
        ".entry-content",
        ".zoom",
    ]
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            return node

    candidates = soup.find_all(["div", "article"], recursive=True)
    scored = []
    for node in candidates:
        text = node.get_text("\n", strip=True)
        if len(text) < 120:
            continue
        score = len(text)
        if node.find("img"):
            score += 200
        scored.append((score, node))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def open_page(page: Page, url: str) -> str | None:
    polite_sleep()
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
        page.wait_for_selector("body", timeout=10_000)
        page.wait_for_timeout(1500)
    except TimeoutError:
        # 页面有时已显示内容，但 network / script 持续活动会让严格等待超时。
        # 超时后优先尝试直接读取当前 DOM。
        try:
            if page.locator("body").count() > 0:
                page.wait_for_timeout(1500)
                html = page.content()
                if html.strip():
                    return html
        except Exception:
            pass
        print(f"[请求失败] {url} -> 页面加载超时")
        return None
    except Exception as exc:
        print(f"[请求失败] {url} -> {exc}")
        return None

    if response is not None and response.status >= 400:
        print(f"[跳过] {url} -> HTTP {response.status}")
        return None

    html = page.content()
    title = page.title() or ""
    text = page.locator("body").inner_text(timeout=5_000).strip()
    soup = BeautifulSoup(html, "html.parser")
    container = find_article_container(soup)

    # 只有在既没有正文容器、又明显出现验证提示时，才判定为被限流
    if container is None:
        blocked_markers = ("访问频率过高", "安全验证", "验证码", "访问受限", "异常访问")
        if any(marker in title or marker in text for marker in blocked_markers):
            print(f"[被限流] {url} 返回了安全验证页面")
            return None

    if "404" in title and len(text) < 200:
        print(f"[跳过] {url} 可能不存在")
        return None

    return html


def get_page_title(page: Page, soup: BeautifulSoup) -> str:
    try:
        h1 = page.locator("h1").first
        if h1.count() > 0:
            text = h1.inner_text(timeout=3_000).strip()
            if text:
                return text
    except Exception:
        pass

    h1_tag = soup.find("h1")
    if h1_tag:
        text = h1_tag.get_text(" ", strip=True)
        if text:
            return text

    title_tag = soup.find("title")
    if title_tag:
        return title_tag.get_text(" ", strip=True)

    return ""


def download_images(context: BrowserContext, container: BeautifulSoup, article_dir: Path) -> tuple[int, dict[str, str]]:
    image_count = 0
    seen_urls = set()
    replacements: dict[str, str] = {}

    for index, img in enumerate(container.find_all("img"), start=1):
        src = img.get("src") or img.get("data-src") or img.get("data-original")
        if not src:
            continue

        image_url = urljoin(BASE_URL, src)
        if image_url in seen_urls:
            continue
        seen_urls.add(image_url)

        parsed = urlparse(image_url)
        suffix = Path(parsed.path).suffix or ".jpg"
        filename = sanitize_name(Path(parsed.path).stem) or f"image_{index}"
        image_path = article_dir / f"{filename}{suffix}"

        polite_sleep()
        try:
            response = context.request.get(image_url, timeout=PAGE_TIMEOUT_MS)
            if not response.ok:
                print(f"  [图片失败] {image_url} -> HTTP {response.status}")
                continue
            image_path.write_bytes(response.body())
        except Exception as exc:
            print(f"  [图片失败] {image_url} -> {exc}")
            continue

        image_count += 1
        replacements[src] = image_path.name
        replacements[image_url] = image_path.name
        print(f"  [图片] 已保存 {image_path.name}")

    return image_count, replacements


def rewrite_image_sources(soup: BeautifulSoup, replacements: dict[str, str]) -> str:
    if replacements:
        for img in soup.find_all("img"):
            for attr in ("src", "data-src", "data-original"):
                value = img.get(attr)
                if value and value in replacements:
                    img[attr] = replacements[value]
    return str(soup)


def save_article(page: Page, context: BrowserContext, article_id: int, output_root: Path) -> str:
    url = URL_TEMPLATE.format(id=article_id)
    html = open_page(page, url)
    if not html:
        return "miss"

    soup = BeautifulSoup(html, "html.parser")
    title = get_page_title(page, soup)
    if TITLE_KEYWORD not in title:
        print(f"[跳过] {url} 标题不包含“{TITLE_KEYWORD}”")
        return "skip"

    container = find_article_container(soup)

    article_dir = output_root / make_article_dir_name(url)
    article_dir.mkdir(parents=True, exist_ok=True)

    image_source = container if container is not None else soup
    if container is None:
        print(f"  [提示] 未定位到正文容器，改为从整页提取图片")
    image_count, replacements = download_images(context, image_source, article_dir)

    html_path = article_dir / "page.html"
    html_path.write_text(rewrite_image_sources(soup, replacements), encoding="utf-8")

    print(f"[完成] {url} -> 标题“{title}”，页面 HTML 已保存，图片 {image_count} 张")
    return "saved"


def main() -> None:
    args = parse_args()
    output_root = Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=args.headless)
        context = browser.new_context(user_agent=USER_AGENT, locale="zh-CN")
        page = context.new_page()

        misses = 0
        article_id = load_progress(output_root, args.start_id)

        while article_id > 0:
            print(f"[开始] 抓取 solar-{article_id}")
            status = save_article(page, context, article_id, output_root)
            next_id = article_id - 1
            save_progress(output_root, next_id)

            if status in {"saved", "skip"}:
                misses = 0
            else:
                misses += 1
                print(f"[未命中] 连续失败 {misses}/{MAX_CONSECUTIVE_MISSES}")

            if misses >= MAX_CONSECUTIVE_MISSES:
                print("[停止] 已连续 10 个 ID 无法访问，结束抓取")
                break

            article_id = next_id

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
