import csv
import random
import re
import time
from pathlib import Path

from playwright.sync_api import TimeoutError, sync_playwright


TARGET_URL = "https://www.kmpex.com/sys/disclosure/#/console/ElectricCompany/CompanyInfo"
LIST_API_KEYWORD = "/sys/disclosure/infomationsubmit-service/plantinfo/public/getPlantInfoPageList/page/access"
OUTPUT_CSV = Path("/Users/lastjob/Downloads/云南.csv")
PAGE_TIMEOUT_MS = 30_000
MIN_DELAY_SECONDS = 1.5
MAX_DELAY_SECONDS = 4.0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def human_pause(min_seconds: float = MIN_DELAY_SECONDS, max_seconds: float = MAX_DELAY_SECONDS) -> None:
    time.sleep(random.uniform(min_seconds, max_seconds))


def clean_text(value: str) -> str:
    return str(value or "").strip()


def capacity_to_mw(text: str) -> str:
    value = clean_text(text)
    if not value:
        return ""

    match = re.search(r"(\d+(?:\.\d+)?)", value)
    if not match:
        return value

    number = float(match.group(1))
    if "万千瓦" in value:
        number *= 10

    return f"{number:g}"


def wait_for_rows(page) -> None:
    page.wait_for_selector("tr.ant-table-row.ant-table-row-level-0", timeout=PAGE_TIMEOUT_MS)
    page.wait_for_timeout(1200)


def extract_rows(page) -> list[list[str]]:
    rows = []
    row_locator = page.locator("tr.ant-table-row.ant-table-row-level-0")
    row_count = row_locator.count()

    for row_index in range(row_count):
        row = row_locator.nth(row_index)
        cells = row.locator("td")
        cell_count = cells.count()
        values = [clean_text(cells.nth(i).inner_text(timeout=2_000)) for i in range(cell_count)]

        if len(values) < 6:
            continue

        rows.append(
            [
                values[1],
                values[2],
                values[3],
                values[4],
                capacity_to_mw(values[5]),
            ]
        )

    return rows


def write_csv(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["交易名称", "企业名称", "所属集团", "电源类型", "装机容量MW"])
        writer.writerows(rows)


def click_next_page(page) -> bool:
    next_anchor = page.locator("[title='下一页'] a").first
    if next_anchor.count() == 0:
        return False

    parent = page.locator("[title='下一页']").first
    parent_class = clean_text(parent.get_attribute("class"))
    anchor_class = clean_text(next_anchor.get_attribute("class"))
    if "disabled" in parent_class.lower() or "disabled" in anchor_class.lower():
        return False

    try:
        with page.expect_response(
            lambda response: LIST_API_KEYWORD in response.url and response.request.method.upper() == "POST",
            timeout=PAGE_TIMEOUT_MS,
        ):
            human_pause()
            next_anchor.click()
        wait_for_rows(page)
        return True
    except TimeoutError:
        return False


def main() -> None:
    all_rows: list[list[str]] = []
    seen_keys: set[tuple[str, str, str, str, str]] = set()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=False,
            args=["--start-maximized"],
        )
        context = browser.new_context(
            user_agent=USER_AGENT,
            locale="zh-CN",
            no_viewport=True,
        )
        page = context.new_page()

        human_pause()
        page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
        wait_for_rows(page)

        page_number = 1
        while True:
            print(f"[抓取] 第 {page_number} 页")
            current_rows = extract_rows(page)
            print(f"[抓取] 当前页 {len(current_rows)} 条")

            for row in current_rows:
                key = tuple(row)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                all_rows.append(row)

            if not click_next_page(page):
                break

            page_number += 1

        write_csv(OUTPUT_CSV, all_rows)
        print(f"[完成] 共保存 {len(all_rows)} 条到 {OUTPUT_CSV}")

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
