import argparse
import html
import json
import random
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag


INPUT_FILE = Path("wind_data.json")
OUTPUT_FILE = Path("wind.xls")
GEOCODE_CACHE_FILE = Path("wind_geocode_cache.json")
PROGRESS_FILE = Path("wind.progress.json")
REQUEST_TIMEOUT = 30
REQUEST_DELAY_SECONDS = 1.2
REQUEST_RETRIES = 3
TIANDITU_GEOCODER_URL = "http://api.tianditu.gov.cn/geocoder"
DEFAULT_TIANDITU_TK = "b0955d5fb6e62c7e90a97d8b3fa4a3f5"
_THREAD_LOCAL = threading.local()

STATUS_MAP = {
    "operating": "已投运",
    "announced": "已宣布",
    "construction": "建设中",
    "pre-construction": "已立项",
    "mothballed": "暂时停摆",
    "shelved": "搁置",
    "cancelled": "已取消",
    "retired": "已退役",
}

INSTALLATION_TYPE_MAP = {
    "onshore": "陆上风电",
    "offshore hard mount": "海上固定式",
    "unknown": "未知",
    "offshore mount unknown": "海上但安装形式不明",
    "offshore floating": "海上漂浮式",
}

PROVINCE_MAP = {
    "Anhui": "安徽省",
    "Beijing": "北京市",
    "Chongqing": "重庆市",
    "Fujian": "福建省",
    "Gansu": "甘肃省",
    "Guangdong": "广东省",
    "Guangxi": "广西壮族自治区",
    "Guizhou": "贵州省",
    "Hainan": "海南省",
    "Hebei": "河北省",
    "Heilongjiang": "黑龙江省",
    "Henan": "河南省",
    "Hong Kong": "香港特别行政区",
    "Hubei": "湖北省",
    "Hunan": "湖南省",
    "Inner Mongolia": "内蒙古自治区",
    "Jiangsu": "江苏省",
    "Jiangxi": "江西省",
    "Jilin": "吉林省",
    "Liaoning": "辽宁省",
    "Macau": "澳门特别行政区",
    "Ningxia": "宁夏回族自治区",
    "Qinghai": "青海省",
    "Shaanxi": "陕西省",
    "Shandong": "山东省",
    "Shanghai": "上海市",
    "Shanxi": "山西省",
    "Sichuan": "四川省",
    "Taiwan": "台湾省",
    "Tianjin": "天津市",
    "Tibet": "西藏自治区",
    "Xinjiang": "新疆维吾尔自治区",
    "Yunnan": "云南省",
    "Zhejiang": "浙江省",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="抓取 GEM Wiki 风电项目详情并导出 wind.xls")
    parser.add_argument("--input", default=str(INPUT_FILE), help="输入 JSON 文件路径")
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="输出 xls 文件路径")
    parser.add_argument("--progress", default="", help="断点续爬进度 JSON，默认使用输出文件名.progress.json")
    parser.add_argument("--reset-progress", action="store_true", help="忽略并删除已有断点进度，从头重跑")
    parser.add_argument(
        "--cache",
        default=str(GEOCODE_CACHE_FILE),
        help="反向地理编码缓存文件路径",
    )
    parser.add_argument("--limit", type=int, default=0, help="仅处理前 N 条，0 表示全部")
    parser.add_argument("--workers", type=int, default=4, help="页面抓取并发线程数，太高容易触发 gem.wiki 403")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY_SECONDS, help="每次请求前的基础等待秒数")
    parser.add_argument("--retries", type=int, default=REQUEST_RETRIES, help="单个页面请求失败重试次数")
    parser.add_argument(
        "--geocoder",
        choices=["tianditu", "nominatim", "none"],
        default="tianditu",
        help="省市区中文反查方式，默认使用天地图",
    )
    parser.add_argument("--tianditu-tk", default=DEFAULT_TIANDITU_TK, help="天地图 API key")
    return parser.parse_args()


def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
    )
    return session


def get_thread_session() -> requests.Session:
    session = getattr(_THREAD_LOCAL, "session", None)
    if session is None:
        session = create_session()
        _THREAD_LOCAL.session = session
    return session


def load_input_records(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []

    if text.startswith("["):
        data = json.loads(text)
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        raise ValueError(f"{path} 不是数组格式")

    records: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        if isinstance(item, dict):
            records.append(item)
    return records


def load_cache(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save_cache(path: Path, cache: dict[str, dict[str, str]]) -> None:
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def default_progress_path(output_path: Path) -> Path:
    if output_path.suffix:
        return output_path.with_suffix(".progress.json")
    return output_path.parent / f"{output_path.name}.progress.json"


def load_progress(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"rows": {}, "failed": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"rows": {}, "failed": {}}
    if not isinstance(data, dict):
        return {"rows": {}, "failed": {}}
    rows = data.get("rows")
    failed = data.get("failed")
    return {
        "rows": rows if isinstance(rows, dict) else {},
        "failed": failed if isinstance(failed, dict) else {},
        "updated_at": data.get("updated_at"),
    }


def save_progress(path: Path, rows: dict[str, dict[str, Any]], failed: dict[str, str]) -> None:
    payload = {
        "rows": rows,
        "failed": failed,
        "success_count": len(rows),
        "failed_count": len(failed),
        "updated_at": int(time.time()),
    }
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def polite_sleep(delay: float = REQUEST_DELAY_SECONDS) -> None:
    time.sleep(random.uniform(delay, delay * 1.8))


def request_html(session: requests.Session, url: str, delay: float, retries: int) -> str:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        polite_sleep(delay)
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT)
            if response.status_code in {403, 429, 503} and attempt < retries:
                wait_seconds = min(90, 12 * (attempt + 1))
                print(f"[限流重试] {url} -> HTTP {response.status_code}，等待 {wait_seconds} 秒")
                time.sleep(wait_seconds)
                continue
            response.raise_for_status()
            response.encoding = response.encoding or "utf-8"
            return response.text
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                wait_seconds = min(60, 6 * (attempt + 1))
                time.sleep(wait_seconds)

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"请求失败: {url}")


def normalize_header(text: str) -> str:
    value = clean_text(text).lower()
    value = value.replace("wgs 84", "wgs84")
    value = re.sub(r"[\s/()\-:]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    text = value.replace("\xa0", " ").replace("–", "").replace("—", "")
    text = re.sub(r"\[[0-9]+\]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,;\n\t")


def extract_chinese_name(value: str) -> str:
    text = clean_text(value)
    if not text:
        return ""

    for segment in re.findall(r"[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[）)]", text):
        cleaned = clean_text(segment)
        if cleaned:
            return cleaned

    chinese_parts = re.findall(r"[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9·（）()、&＆\-\s]*", text)
    if chinese_parts:
        return clean_text(" ".join(part.strip() for part in chinese_parts if part.strip()))

    return text


def get_heading_table(soup: BeautifulSoup, heading_id: str) -> Tag | None:
    heading = soup.find(id=heading_id)
    if heading is None:
        return None

    current = heading.parent if isinstance(heading.parent, Tag) else heading
    while current is not None:
        current = current.find_next_sibling()
        if current is None:
            return None
        if isinstance(current, Tag) and current.name == "table" and "wikitable" in (current.get("class") or []):
            return current

    return None


def parse_table(table: Tag | None) -> list[dict[str, str]]:
    if table is None:
        return []

    rows = table.find_all("tr")
    if not rows:
        return []

    headers = [normalize_header(cell.get_text(" ", strip=True)) for cell in rows[0].find_all(["th", "td"])]
    parsed_rows: list[dict[str, str]] = []
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if not cells:
            continue
        values = [clean_text(cell.get_text(" ", strip=True)) for cell in cells]
        row_dict: dict[str, str] = {}
        for index, header in enumerate(headers):
            if not header:
                header = f"col_{index}"
            row_dict[header] = values[index] if index < len(values) else ""
        parsed_rows.append(row_dict)
    return parsed_rows


def parse_float(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None


def normalize_keyword(value: str | None) -> str:
    return clean_text(value).lower()


def choose_best_row(rows: list[dict[str, str]], record: dict[str, Any], row_kind: str) -> dict[str, str]:
    if not rows:
        return {}
    if len(rows) == 1:
        return rows[0]

    target_phase = clean_text(str(record.get("phase", "")))
    target_status = normalize_keyword(str(record.get("status", "")))
    target_type = normalize_keyword(str(record.get("installation_type", "")))
    target_capacity = parse_float(str(record.get("capacity_mw", "")))

    best_row = rows[0]
    best_score = -1
    for row in rows:
        score = 0
        phase_value = row.get("phase_name") or row.get("phase") or row.get("name")
        if target_phase and clean_text(phase_value) == target_phase:
            score += 100
        if row_kind == "project":
            status_value = normalize_keyword(row.get("status"))
            type_value = normalize_keyword(row.get("type"))
            capacity_value = parse_float(row.get("nameplate_capacity"))
            if target_status and target_status == status_value:
                score += 10
            if target_type and target_type == type_value:
                score += 10
            if target_capacity is not None and capacity_value is not None:
                if abs(target_capacity - capacity_value) < 0.001:
                    score += 10
                else:
                    score -= min(int(abs(target_capacity - capacity_value)), 10)
        elif row_kind == "location" and target_phase and clean_text(phase_value) == target_phase:
            score += 10

        if score > best_score:
            best_score = score
            best_row = row
    return best_row


def parse_coordinates(text: str) -> tuple[str, str]:
    matches = re.findall(r"-?\d+(?:\.\d+)?", text)
    if len(matches) >= 2:
        lat = matches[0]
        lon = matches[1]
        return lon, lat
    return "", ""


def extract_project_name(soup: BeautifulSoup, record: dict[str, Any], selected_phase: str) -> str:
    title = soup.select_one("#firstHeading .mw-page-title-main")
    name = clean_text(title.get_text(" ", strip=True) if title else str(record.get("project", "")))
    if selected_phase and f"{selected_phase}期" not in name and len(name) > 0:
        return f"{name}（{selected_phase}期）"
    return name


def extract_references(soup: BeautifulSoup) -> list[str]:
    references_heading = soup.find(id="References")
    if references_heading is None:
        return []

    container = references_heading.parent if isinstance(references_heading.parent, Tag) else references_heading
    references_wrap = None
    while container is not None:
        container = container.find_next_sibling()
        if container is None:
            break
        if isinstance(container, Tag) and container.select_one("ol.references"):
            references_wrap = container
            break
        if isinstance(container, Tag) and container.name in {"h2", "h3"}:
            break

    if references_wrap is None:
        return []

    urls: list[str] = []
    seen: set[str] = set()
    for li in references_wrap.select("ol.references > li"):
        for link in li.select("a[href]"):
            href = clean_text(link.get("href"))
            if href.startswith("http") and href not in seen:
                seen.add(href)
                urls.append(href)

        text_urls = re.findall(r"https?://[^\s<>\"]+", li.get_text(" ", strip=True))
        for url in text_urls:
            normalized = clean_text(url.rstrip(".,;"))
            if normalized and normalized not in seen:
                seen.add(normalized)
                urls.append(normalized)

    return urls


def reverse_geocode(
    session: requests.Session,
    lon: str,
    lat: str,
    cache: dict[str, dict[str, str]],
    cache_lock: threading.Lock,
    geocode_lock: threading.Lock,
    geocoder: str,
    tianditu_tk: str,
) -> dict[str, str]:
    if not lon or not lat or geocoder == "none":
        return {}

    cache_key = f"{geocoder}:{lat},{lon}"
    with cache_lock:
        if cache_key in cache:
            return cache[cache_key]

    if geocoder == "tianditu":
        polite_sleep()
        post_str = json.dumps({"lon": float(lon), "lat": float(lat), "ver": 1}, ensure_ascii=False, separators=(",", ":"))
        completed = subprocess.run(
            [
                "curl",
                "-G",
                "--silent",
                "--show-error",
                "--max-time",
                str(REQUEST_TIMEOUT),
                TIANDITU_GEOCODER_URL,
                "--data-urlencode",
                f"postStr={post_str}",
                "--data-urlencode",
                "type=geocode",
                "--data-urlencode",
                f"tk={tianditu_tk}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(completed.stdout)
        if str(payload.get("status", "")) != "0":
            return {}
        payload_result = payload.get("result") or {}
        address = payload_result.get("addressComponent") or payload.get("addressComponent") or {}
        result = {
            "province": clean_text(address.get("province")),
            "city": clean_text(address.get("city")),
            "district": clean_text(address.get("county") or address.get("district")),
        }
    else:
        # Nominatim 有较严格的访问频率限制：页面可以多线程抓，Nominatim 反查串行且缓存。
        with geocode_lock:
            with cache_lock:
                if cache_key in cache:
                    return cache[cache_key]

            polite_sleep()
            response = session.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "format": "jsonv2",
                    "lat": lat,
                    "lon": lon,
                    "zoom": 18,
                    "addressdetails": 1,
                    "accept-language": "zh-CN",
                },
                headers={"User-Agent": "SpiderData wind scraper/1.0"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
        address = payload.get("address", {}) if isinstance(payload, dict) else {}
        result = {
            "province": clean_text(
                address.get("state")
                or address.get("province")
                or address.get("region")
                or ""
            ),
            "city": clean_text(
                address.get("city")
                or address.get("prefecture")
                or address.get("municipality")
                or address.get("town")
                or address.get("county")
                or ""
            ),
            "district": clean_text(
                address.get("city_district")
                or address.get("district")
                or address.get("county")
                or address.get("suburb")
                or address.get("borough")
                or ""
            ),
        }

    with cache_lock:
        cache[cache_key] = result
    return result


def infer_province_cn(location_text: str, input_province: str) -> str:
    for source in [location_text, input_province]:
        for en_name, zh_name in PROVINCE_MAP.items():
            if en_name.lower() in source.lower():
                return zh_name
    return ""


def build_reference_html(urls: list[str]) -> str:
    if not urls:
        return ""
    links = [f'<a href="{html.escape(url)}">{html.escape(url)}</a>' for url in urls]
    return "<br/>".join(links)


def build_html_table(rows: list[dict[str, Any]]) -> str:
    columns = [
        "电场名称",
        "装机容量（MW）",
        "经度（wgs84）",
        "纬度（wgs84）",
        "状态",
        "安装类型",
        "省",
        "市",
        "区",
        "运营方",
        "参考依据",
    ]

    header_html = "".join(f"<th>{html.escape(column)}</th>" for column in columns)
    body_parts: list[str] = []
    for row in rows:
        cells = []
        for column in columns:
            value = row.get(column, "")
            if column == "参考依据":
                cells.append(f"<td>{value}</td>")
            else:
                cells.append(f"<td>{html.escape(str(value))}</td>")
        body_parts.append("<tr>" + "".join(cells) + "</tr>")

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Type" content="application/vnd.ms-excel; charset=utf-8" />
  <style>
    table {{ border-collapse: collapse; font-family: Arial, sans-serif; }}
    th, td {{ border: 1px solid #999; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #ddebf7; }}
    td {{ white-space: pre-wrap; }}
    a {{ color: #0563c1; text-decoration: underline; }}
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>{header_html}</tr>
    </thead>
    <tbody>
      {''.join(body_parts)}
    </tbody>
  </table>
</body>
</html>
"""


def extract_project_record(
    session: requests.Session,
    record: dict[str, Any],
    geocode_cache: dict[str, dict[str, str]],
    cache_lock: threading.Lock,
    geocode_lock: threading.Lock,
    geocoder: str,
    tianditu_tk: str,
    delay: float,
    retries: int,
) -> dict[str, Any]:
    url = clean_text(str(record.get("project_url", "")))
    if not url:
        raise ValueError("缺少 project_url")

    html_text = request_html(session, url, delay, retries)
    soup = BeautifulSoup(html_text, "html.parser")

    project_rows = parse_table(get_heading_table(soup, "Project_Details"))
    location_rows = parse_table(get_heading_table(soup, "Location"))

    project_row = choose_best_row(project_rows, record, "project")
    location_row = choose_best_row(location_rows, record, "location")

    selected_phase = clean_text(project_row.get("phase_name") or location_row.get("phase_name") or str(record.get("phase", "")))
    capacity = clean_text(project_row.get("nameplate_capacity") or str(record.get("capacity_mw", ""))).replace(" MW", "")
    status_en = clean_text(project_row.get("status") or str(record.get("status", "")))
    install_type_en = clean_text(project_row.get("type") or str(record.get("installation_type", "")))
    operator = extract_chinese_name(
        project_row.get("operator")
        or project_row.get("owner")
        or str(record.get("operator", ""))
        or str(record.get("owner", ""))
    )
    location_text = clean_text(location_row.get("location") or "")
    lon, lat = parse_coordinates(location_row.get("coordinates_wgs84") or location_row.get("coordinates") or "")

    location_cn = {}
    try:
        location_cn = reverse_geocode(
            session,
            lon,
            lat,
            geocode_cache,
            cache_lock,
            geocode_lock,
            geocoder,
            tianditu_tk,
        )
    except Exception:
        location_cn = {}

    province_cn = location_cn.get("province") or infer_province_cn(location_text, str(record.get("state_province", "")))
    city_cn = location_cn.get("city", "")
    district_cn = location_cn.get("district", "")
    references = extract_references(soup)

    return {
        "电场名称": extract_project_name(soup, record, selected_phase),
        "装机容量（MW）": capacity,
        "经度（wgs84）": lon,
        "纬度（wgs84）": lat,
        "状态": STATUS_MAP.get(status_en.lower(), status_en),
        "安装类型": INSTALLATION_TYPE_MAP.get(install_type_en.lower(), install_type_en),
        "省": province_cn,
        "市": city_cn,
        "区": district_cn,
        "运营方": operator,
        "参考依据": build_reference_html(references),
    }


def build_failed_row(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "电场名称": clean_text(str(record.get("project", ""))),
        "装机容量（MW）": clean_text(str(record.get("capacity_mw", ""))),
        "经度（wgs84）": "",
        "纬度（wgs84）": "",
        "状态": STATUS_MAP.get(normalize_keyword(str(record.get("status", ""))), clean_text(str(record.get("status", "")))),
        "安装类型": INSTALLATION_TYPE_MAP.get(
            normalize_keyword(str(record.get("installation_type", ""))),
            clean_text(str(record.get("installation_type", ""))),
        ),
        "省": infer_province_cn("", str(record.get("state_province", ""))),
        "市": "",
        "区": "",
        "运营方": extract_chinese_name(str(record.get("operator", "")) or str(record.get("owner", ""))),
        "参考依据": "",
    }


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    progress_path = Path(args.progress) if args.progress else default_progress_path(output_path)
    cache_path = Path(args.cache)

    if args.reset_progress and progress_path.exists():
        progress_path.unlink()

    records = load_input_records(input_path)
    if args.limit > 0:
        records = records[: args.limit]

    geocode_cache = load_cache(cache_path)
    progress = load_progress(progress_path)
    progress_rows: dict[str, dict[str, Any]] = {
        key: value
        for key, value in progress.get("rows", {}).items()
        if isinstance(value, dict)
    }
    failed_rows: dict[str, str] = {
        key: str(value)
        for key, value in progress.get("failed", {}).items()
    }
    cache_lock = threading.Lock()
    geocode_lock = threading.Lock()
    progress_lock = threading.Lock()
    output_rows: list[dict[str, Any] | None] = [None] * len(records)
    pending_records: list[tuple[int, dict[str, Any]]] = []
    loaded_success_count = 0

    for index, record in enumerate(records):
        key = str(index)
        if key in progress_rows:
            output_rows[index] = progress_rows[key]
            loaded_success_count += 1
        else:
            pending_records.append((index, record))

    total = len(records)
    completed = loaded_success_count
    workers = max(1, args.workers)

    if loaded_success_count:
        print(f"[断点续爬] 已加载成功记录 {loaded_success_count} 条，剩余 {len(pending_records)} 条")
    else:
        print(f"[断点续爬] 未发现历史成功记录，从头开始")

    def worker(record_index: int, record: dict[str, Any]) -> tuple[int, dict[str, Any], str, Exception | None]:
        url = clean_text(str(record.get("project_url", "")))
        session = get_thread_session()
        try:
            output_row = extract_project_record(
                session,
                record,
                geocode_cache,
                cache_lock,
                geocode_lock,
                args.geocoder,
                args.tianditu_tk,
                args.delay,
                args.retries,
            )
            return record_index, output_row, url, None
        except Exception as exc:
            return record_index, build_failed_row(record), url, exc

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(worker, index, record): index
            for index, record in pending_records
        }
        for future in as_completed(futures):
            record_index, output_row, url, exc = future.result()
            output_rows[record_index] = output_row
            completed += 1
            if exc is None:
                with progress_lock:
                    progress_rows[str(record_index)] = output_row
                    failed_rows.pop(str(record_index), None)
                    save_progress(progress_path, progress_rows, failed_rows)
                print(f"[{completed}/{total}] 完成: {url}")
            else:
                with progress_lock:
                    failed_rows[str(record_index)] = str(exc)
                    save_progress(progress_path, progress_rows, failed_rows)
                print(f"[{completed}/{total}] 失败: {url} -> {exc}")

            if completed % 20 == 0:
                with cache_lock:
                    save_cache(cache_path, geocode_cache)
                partial_rows = [
                    row if row is not None else build_failed_row(records[index])
                    for index, row in enumerate(output_rows)
                ]
                output_path.write_text(build_html_table(partial_rows), encoding="utf-8")

    with cache_lock:
        save_cache(cache_path, geocode_cache)

    final_rows = [row if row is not None else build_failed_row(records[index]) for index, row in enumerate(output_rows)]
    output_path.write_text(build_html_table(final_rows), encoding="utf-8")
    print(f"已导出: {output_path.resolve()}")

# python wind_gem_spider.py --workers 4 --output wind.xls --cache wind_geocode_cache.json
if __name__ == "__main__":
    main()
