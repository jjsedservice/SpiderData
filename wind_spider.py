import argparse
import json
import random
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import BrowserContext, Page, TimeoutError, sync_playwright


LIST_PAGE_URLS = [
    "https://wind.in-en.com/project/",
    "https://wind.in-en.com/windnews/",
]
WIND_HOST = "https://wind.in-en.com"
OUTPUT_ROOT = Path("/Users/lastjob/Downloads/场站资料整理/wind")
PAGE_TIMEOUT_MS = 30_000
MIN_DELAY = 1
MAX_DELAY = 3
TITLE_KEYWORD = "云南"
PROGRESS_FILE_NAME = "progress.json"
LOAD_MORE_API_KEYWORD = "vote.php?&action=list_pb"
MAX_IDLE_ROUNDS = 3
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def parse_args():
    parser = argparse.ArgumentParser(description="使用 Playwright 从项目列表页抓取云南风电文章")
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


def load_progress(output_root: Path) -> set[str]:
    progress_path = output_root / PROGRESS_FILE_NAME
    if not progress_path.exists():
        return set()

    try:
        payload = json.loads(progress_path.read_text(encoding="utf-8"))
        processed = payload.get("processed_urls", [])
        return {str(url) for url in processed if url}
    except Exception:
        return set()


def create_stats() -> dict[str, int]:
    return {
        "list_pages": 0,
        "scanned_articles": 0,
        "matched_articles": 0,
        "saved_articles": 0,
        "skipped_articles": 0,
        "failed_articles": 0,
        "pagination_count": 0,
    }


def save_progress(output_root: Path, processed_urls: set[str], stats: dict[str, int] | None = None) -> None:
    progress_path = output_root / PROGRESS_FILE_NAME
    payload = {
        "processed_urls": sorted(processed_urls),
        "processed_count": len(processed_urls),
        "updated_at": int(time.time()),
    }
    if stats is not None:
        payload["stats"] = stats
    progress_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def find_article_container(soup: BeautifulSoup):
    selectors = [
        "div.rightDetail.fr",
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
    try:
        text = page.locator("body").inner_text(timeout=5_000).strip()
    except Exception:
        text = ""
    soup = BeautifulSoup(html, "html.parser")
    container = find_article_container(soup)

    if container is None:
        blocked_markers = ("访问频率过高", "安全验证", "验证码", "访问受限", "异常访问")
        if any(marker in title or marker in text for marker in blocked_markers):
            print(f"[被限流] {url} 返回了安全验证页面")
            return None

    if "404" in title and len(text) < 200:
        print(f"[跳过] {url} 可能不存在")
        return None

    return html


def download_images(context: BrowserContext, container: BeautifulSoup, article_dir: Path) -> tuple[int, dict[str, str]]:
    image_count = 0
    seen_urls = set()
    replacements: dict[str, str] = {}
    images_dir = article_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    for index, img in enumerate(container.find_all("img"), start=1):
        src = img.get("src") or img.get("data-src") or img.get("data-original")
        if not src:
            continue

        image_url = urljoin(WIND_HOST, src)
        if image_url in seen_urls:
            continue
        seen_urls.add(image_url)

        parsed = urlparse(image_url)
        suffix = Path(parsed.path).suffix or ".jpg"
        filename = sanitize_name(Path(parsed.path).stem) or f"image_{index}"
        image_path = images_dir / f"{filename}{suffix}"

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
        local_ref = f"images/{image_path.name}"
        replacements[src] = local_ref
        replacements[image_url] = local_ref
        print(f"  [图片] 已保存 {local_ref}")

    return image_count, replacements


def rewrite_image_sources(soup: BeautifulSoup, replacements: dict[str, str]) -> str:
    if replacements:
        for img in soup.find_all("img"):
            for attr in ("src", "data-src", "data-original"):
                value = img.get(attr)
                if value and value in replacements:
                    img[attr] = replacements[value]
    return str(soup)


def save_article(context: BrowserContext, url: str, output_root: Path) -> bool:
    article_page = context.new_page()
    try:
        html = open_page(article_page, url)
        if not html:
            return False

        soup = BeautifulSoup(html, "html.parser")
        container = find_article_container(soup)
        article_dir = output_root / make_article_dir_name(url)
        article_dir.mkdir(parents=True, exist_ok=True)

        image_source = container if container is not None else soup.new_tag("div")
        if container is None:
            print(f"  [提示] {url} 未找到正文 div.rightDetail.fr，正文图片未下载")
        image_count, replacements = download_images(context, image_source, article_dir)

        html_path = article_dir / "page.html"
        html_path.write_text(rewrite_image_sources(soup, replacements), encoding="utf-8")
        print(f"[完成] {url} -> 页面 HTML 已保存，图片 {image_count} 张")
        return True
    finally:
        article_page.close()


def extract_candidate_links(page: Page, list_page_url: str) -> list[tuple[str, str]]:
    locator = page.locator("div.leftList ul li a")
    items: list[tuple[str, str]] = []
    count = locator.count()
    for index in range(count):
        link = locator.nth(index)
        href = (link.get_attribute("href") or "").strip()
        try:
            text = link.inner_text(timeout=2_000).strip()
        except Exception:
            continue
        if not href or not text:
            continue
        href = urljoin(list_page_url, href)
        if "wind.in-en.com/html/wind-" not in href:
            continue
        items.append((href, text))
    return items


def get_link_count(page: Page) -> int:
    return page.locator("div.leftList ul li a").count()


def wait_for_link_growth(page: Page, before_count: int, timeout_ms: int = 8_000) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        current = get_link_count(page)
        if current > before_count:
            return True
        page.wait_for_timeout(500)
    return False


def click_more_if_present(page: Page) -> bool:
    more_btn = page.locator("a.moreBtn").first
    if more_btn.count() == 0 or not more_btn.is_visible():
        return False

    before_count = get_link_count(page)
    try:
        with page.expect_response(lambda resp: LOAD_MORE_API_KEYWORD in resp.url, timeout=10_000):
            more_btn.click()
        grew = wait_for_link_growth(page, before_count)
        print(f"[翻页] 点击查看更多，文章数 {before_count} -> {get_link_count(page)}")
        return grew or get_link_count(page) > before_count
    except TimeoutError:
        return False
    except Exception:
        return False


def scroll_and_wait_for_more(page: Page) -> bool:
    before_count = get_link_count(page)
    try:
        with page.expect_response(lambda resp: LOAD_MORE_API_KEYWORD in resp.url, timeout=10_000):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        grew = wait_for_link_growth(page, before_count)
        print(f"[翻页] 滚动加载，文章数 {before_count} -> {get_link_count(page)}")
        return grew or get_link_count(page) > before_count
    except TimeoutError:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        grew = wait_for_link_growth(page, before_count, timeout_ms=5_000)
        if grew:
            print(f"[翻页] 滚动后延迟渲染，文章数 {before_count} -> {get_link_count(page)}")
        return grew or get_link_count(page) > before_count
    except Exception:
        return False


def process_list_page(
    page: Page,
    context: BrowserContext,
    output_root: Path,
    processed_urls: set[str],
    stats: dict[str, int],
    list_page_url: str,
) -> None:
    idle_rounds = 0
    while True:
        page.wait_for_selector("div.leftList ul li", timeout=10_000)
        current_links = extract_candidate_links(page, list_page_url)
        print(f"[列表] {list_page_url} 当前累计发现 {len(current_links)} 篇候选文章")

        new_processed = False
        for href, title in current_links:
            if href in processed_urls:
                continue

            stats["scanned_articles"] += 1
            print(f"[发现] {title}")
            if TITLE_KEYWORD in title:
                stats["matched_articles"] += 1
                print(f"[保存] {href}")
                if save_article(context, href, output_root):
                    stats["saved_articles"] += 1
                else:
                    stats["failed_articles"] += 1
            else:
                stats["skipped_articles"] += 1
                print(f"[跳过] {href} 标题不包含“{TITLE_KEYWORD}”")

            processed_urls.add(href)
            save_progress(output_root, processed_urls, stats)
            new_processed = True

        if click_more_if_present(page):
            stats["pagination_count"] += 1
            idle_rounds = 0
            continue

        if scroll_and_wait_for_more(page):
            stats["pagination_count"] += 1
            idle_rounds = 0
            continue

        refreshed_links = extract_candidate_links(page, list_page_url)
        remaining = [href for href, _ in refreshed_links if href not in processed_urls]
        if remaining and not new_processed:
            idle_rounds = 0
            continue

        idle_rounds += 1
        print(f"[检查] 未发现新文章或新分页，第 {idle_rounds}/{MAX_IDLE_ROUNDS} 次空转检查")
        if idle_rounds >= MAX_IDLE_ROUNDS:
            print("[结束] 连续多次未发现新文章，列表页没有更多可加载内容了")
            break

        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(2000)


def main() -> None:
    args = parse_args()
    output_root = Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    processed_urls = load_progress(output_root)
    stats = create_stats()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=args.headless)
        context = browser.new_context(user_agent=USER_AGENT, locale="zh-CN")

        for list_page_url in LIST_PAGE_URLS:
            list_page = context.new_page()
            stats["list_pages"] += 1
            print(f"[入口] 开始处理列表页 {list_page_url}")
            html = open_page(list_page, list_page_url)
            if not html:
                print(f"[失败] 无法打开列表页 {list_page_url}")
                list_page.close()
                continue

            process_list_page(list_page, context, output_root, processed_urls, stats, list_page_url)
            print(f"[入口] 处理完成 {list_page_url}")
            list_page.close()

        save_progress(output_root, processed_urls, stats)
        print(
            "[统计] "
            f"列表页 {stats['list_pages']} 个，"
            f"扫描文章 {stats['scanned_articles']} 篇，"
            f"标题命中 {stats['matched_articles']} 篇，"
            f"成功保存 {stats['saved_articles']} 篇，"
            f"跳过 {stats['skipped_articles']} 篇，"
            f"保存失败 {stats['failed_articles']} 篇，"
            f"分页加载 {stats['pagination_count']} 次"
        )

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
