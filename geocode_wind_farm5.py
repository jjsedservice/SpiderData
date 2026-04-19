import csv
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

import requests


TIANDITU_GEOCODER_URL = "http://api.tianditu.gov.cn/geocoder"
DEFAULT_TK = "b0955d5fb6e62c7e90a97d8b3fa4a3f5"
DEFAULT_INPUT = Path("/Users/lastjob/Downloads/风电场5_副本.csv")
DEFAULT_OUTPUT = Path("/Users/lastjob/Downloads/风电场5_带经纬度.csv")
DEFAULT_CACHE = Path("/Users/lastjob/Documents/Work/SpiderData/tianditu_windfarm5_cache.json")
DEFAULT_TIMEOUT = 20
DEFAULT_SLEEP_SECONDS = 0.2

EXTRA_COLUMNS = [
    "查询地址",
    "经度",
    "纬度",
    "定位级别",
    "地理编码状态",
    "地理编码消息",
]


def clean_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    return str(value).strip()


def join_parts(parts: List[str]) -> str:
    return "".join(part for part in parts if clean_text(part))


def build_candidate_queries(row: Dict[str, str]) -> List[Tuple[str, str]]:
    province = clean_text(row.get("省"))
    city = clean_text(row.get("市"))
    county = clean_text(row.get("县"))
    plant_name = clean_text(row.get("电场名"))
    address = clean_text(row.get("详细地址"))

    candidates: List[Tuple[str, str]] = []

    def add_candidate(level: str, text: str) -> None:
        query = clean_text(text)
        if not query:
            return
        item = (level, query)
        if item not in candidates:
            candidates.append(item)

    # 优先用人工整理的详细地址，其次再用行政区 + 电场名。
    add_candidate("address", address)
    add_candidate("province_city_county_name", join_parts([province, city, county, plant_name]))
    add_candidate("province_city_name", join_parts([province, city, plant_name]))
    add_candidate("province_name", join_parts([province, plant_name]))
    add_candidate("name", plant_name)
    return candidates


def load_cache(cache_path: Path) -> Dict[str, Dict[str, str]]:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache_path: Path, cache: Dict[str, Dict[str, str]]) -> None:
    cache_path.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def call_tianditu_geocoder(query: str, tk: str, timeout: int) -> Dict[str, str]:
    ds = json.dumps({"keyWord": query}, ensure_ascii=False, separators=(",", ":"))
    encoded_ds = quote(ds, safe='{}":,')
    url = f"{TIANDITU_GEOCODER_URL}?ds={encoded_ds}&tk={tk}"

    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    payload = response.json()

    status = str(payload.get("status", ""))
    message = str(payload.get("msg", ""))
    if status != "0":
        return {
            "status": "failed",
            "message": message or status or "unknown",
        }

    result = payload.get("result") or {}
    location = result.get("location") or {}
    address_component = result.get("addressComponent") or {}

    lon = location.get("lon")
    lat = location.get("lat")
    if lon in [None, ""] or lat in [None, ""]:
        return {
            "status": "failed",
            "message": "missing location",
        }

    return {
        "status": "success",
        "message": message or "OK",
        "lon": str(lon),
        "lat": str(lat),
        "level": clean_text(location.get("level")),
        "province": clean_text(address_component.get("province")),
        "city": clean_text(address_component.get("city")),
        "county": clean_text(address_component.get("county")),
    }


def geocode_row(
    row: Dict[str, str],
    tk: str,
    cache: Dict[str, Dict[str, str]],
    timeout: int,
    sleep_seconds: float,
) -> Dict[str, str]:
    result = dict(row)
    result.update(
        {
            "查询地址": "",
            "经度": "",
            "纬度": "",
            "定位级别": "",
            "地理编码状态": "failed",
            "地理编码消息": "no candidate query",
        }
    )

    last_cached: Optional[Dict[str, str]] = None
    for level, query in build_candidate_queries(row):
        cached = cache.get(query)
        if cached is None:
            try:
                cached = call_tianditu_geocoder(query, tk=tk, timeout=timeout)
            except Exception as exc:
                cached = {
                    "status": "failed",
                    "message": str(exc),
                }
            cache[query] = cached
            time.sleep(sleep_seconds)

        last_cached = cached
        result["查询地址"] = query
        result["定位级别"] = cached.get("level", level)
        result["地理编码消息"] = cached.get("message", "")

        if cached.get("status") == "success":
            result["经度"] = cached.get("lon", "")
            result["纬度"] = cached.get("lat", "")
            result["地理编码状态"] = "success"
            return result

    if last_cached is not None:
        result["地理编码消息"] = last_cached.get("message", "")
    return result


def geocode_csv(
    input_path: Path,
    output_path: Path,
    tk: str,
    cache_path: Path,
    timeout: int,
    sleep_seconds: float,
) -> None:
    cache = load_cache(cache_path)

    with input_path.open("r", encoding="utf-8-sig", newline="") as infile:
        reader = csv.DictReader(infile)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])
        output_fieldnames = fieldnames + [column for column in EXTRA_COLUMNS if column not in fieldnames]

    results = []
    total = len(rows)
    for index, row in enumerate(rows, start=1):
        plant_name = clean_text(row.get("电场名"))
        print(f"[{index}/{total}] 正在获取 {plant_name}")
        results.append(
            geocode_row(
                row,
                tk=tk,
                cache=cache,
                timeout=timeout,
                sleep_seconds=sleep_seconds,
            )
        )
        if index % 20 == 0:
            save_cache(cache_path, cache)

    save_cache(cache_path, cache)

    with output_path.open("w", encoding="utf-8-sig", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=output_fieldnames)
        writer.writeheader()
        writer.writerows(results)

    success_count = sum(1 for row in results if clean_text(row.get("地理编码状态")) == "success")
    print(f"完成：{success_count}/{total} 条获取到经纬度")
    print(f"输出文件：{output_path}")


def main() -> None:
    geocode_csv(
        input_path=DEFAULT_INPUT,
        output_path=DEFAULT_OUTPUT,
        tk=DEFAULT_TK,
        cache_path=DEFAULT_CACHE,
        timeout=DEFAULT_TIMEOUT,
        sleep_seconds=DEFAULT_SLEEP_SECONDS,
    )


if __name__ == "__main__":
    main()
