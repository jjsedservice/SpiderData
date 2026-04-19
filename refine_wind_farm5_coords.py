import csv
import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

import requests


TIANDITU_GEOCODER_URL = "http://api.tianditu.gov.cn/geocoder"
DEFAULT_TK = "b0955d5fb6e62c7e90a97d8b3fa4a3f5"
DEFAULT_INPUT = Path("/Users/lastjob/Downloads/风电场5_副本_含经纬度.csv")
DEFAULT_CACHE = Path("/Users/lastjob/Documents/Work/SpiderData/tianditu_windfarm5_refine_cache.json")
DEFAULT_TIMEOUT = 20
DEFAULT_SLEEP_SECONDS = 0.2

YUNNAN_BOUNDS = {
    "min_lon": 97.0,
    "max_lon": 106.5,
    "min_lat": 21.0,
    "max_lat": 29.5,
}

EXTRA_COLUMNS = [
    "查询地址",
    "定位级别",
    "地理编码状态",
    "地理编码消息",
]


def clean_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_region(text: str) -> str:
    text = clean_text(text)
    for suffix in [
        "哈尼族彝族自治州",
        "傣族景颇族自治州",
        "白族自治州",
        "彝族自治州",
        "傈僳族自治州",
        "壮族苗族自治州",
        "回族彝族自治县",
        "回族自治县",
        "彝族自治县",
        "傣族自治县",
        "哈尼族彝族自治县",
        "佤族自治县",
        "拉祜族自治县",
        "傣族佤族自治县",
        "傣族拉祜族佤族自治县",
        "自治州",
        "自治县",
        "地区",
        "市",
        "县",
        "区",
    ]:
        text = text.replace(suffix, "")
    return text


def extract_town_tokens(address: str) -> List[str]:
    address = clean_text(address)
    if not address:
        return []
    tokens = re.findall(r"([\u4e00-\u9fff]{2,12}(?:乡|镇|街道))", address)
    seen = []
    for token in tokens:
        if token not in seen:
            seen.append(token)
    return seen


def plant_name_variants(name: str) -> List[str]:
    name = clean_text(name)
    if not name:
        return []

    variants: List[str] = []

    def add(item: str) -> None:
        item = clean_text(item)
        if item and item not in variants:
            variants.append(item)

    add(name)
    no_paren = re.sub(r"（[^）]*）|\([^)]*\)", "", name).strip()
    add(no_paren)

    cut = no_paren
    match = re.search(r"(风电场|电场|风电)", cut)
    if match:
        cut = cut[:match.start()].strip()
    add(cut)

    return variants


def build_candidate_queries(row: Dict[str, str]) -> List[Tuple[str, str]]:
    province = clean_text(row.get("省")) or "云南省"
    city = clean_text(row.get("市"))
    county = clean_text(row.get("县"))
    plant_name = clean_text(row.get("电场名"))
    town_tokens = extract_town_tokens(row.get("详细地址", ""))

    candidates: List[Tuple[str, str]] = []

    def add(level: str, query: str) -> None:
        query = clean_text(query)
        if not query:
            return
        item = (level, query)
        if item not in candidates:
            candidates.append(item)

    for variant in plant_name_variants(plant_name):
        add("province_city_county_name", f"{province}{city}{county}{variant}")
        add("city_county_name", f"{city}{county}{variant}")
        add("province_county_name", f"{province}{county}{variant}")
        add("county_name", f"{county}{variant}")
        add("province_city_name", f"{province}{city}{variant}")
        add("province_name", f"{province}{variant}")
        add("name", variant)
        for town in town_tokens:
            add("province_city_county_town_name", f"{province}{city}{county}{town}{variant}")

    return candidates


def load_cache(cache_path: Path) -> Dict[str, Dict[str, str]]:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache_path: Path, cache: Dict[str, Dict[str, str]]) -> None:
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


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
            "url": url,
            "raw": payload,
        }

    result = payload.get("result") or {}
    # 天地图不同返回形态里，location 可能在顶层，也可能在 result 下。
    location = payload.get("location") or result.get("location") or {}
    address_component = payload.get("addressComponent") or result.get("addressComponent") or {}

    lon = location.get("lon")
    lat = location.get("lat")
    if lon in [None, ""] or lat in [None, ""]:
        return {
            "status": "failed",
            "message": "missing location",
            "url": url,
            "raw": payload,
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
        "url": url,
        "raw": payload,
    }


def in_yunnan(lon: str, lat: str) -> bool:
    try:
        lon_value = float(lon)
        lat_value = float(lat)
    except Exception:
        return False
    return (
        YUNNAN_BOUNDS["min_lon"] <= lon_value <= YUNNAN_BOUNDS["max_lon"]
        and YUNNAN_BOUNDS["min_lat"] <= lat_value <= YUNNAN_BOUNDS["max_lat"]
    )


def region_matches(row: Dict[str, str], cached: Dict[str, str]) -> bool:
    row_city = normalize_region(row.get("市", ""))
    row_county = normalize_region(row.get("县", ""))
    cached_city = normalize_region(cached.get("city", ""))
    cached_county = normalize_region(cached.get("county", ""))

    city_ok = not row_city or not cached_city or row_city in cached_city or cached_city in row_city
    county_ok = not row_county or not cached_county or row_county in cached_county or cached_county in row_county
    return city_ok and county_ok


def geocode_row(
    row: Dict[str, str],
    tk: str,
    cache: Dict[str, Dict[str, str]],
    timeout: int,
    sleep_seconds: float,
) -> Dict[str, str]:
    result = dict(row)
    result.setdefault("查询地址", "")
    result.setdefault("定位级别", "")
    result.setdefault("地理编码状态", "failed")
    result.setdefault("地理编码消息", "no candidate query")

    last_message = "no candidate query"
    for level, query in build_candidate_queries(row):
        cached = cache.get(query)
        if cached is None:
            try:
                cached = call_tianditu_geocoder(query, tk=tk, timeout=timeout)
            except Exception as exc:
                cached = {"status": "failed", "message": str(exc)}
            cache[query] = cached
            time.sleep(sleep_seconds)

        last_message = cached.get("message", "")
        debug_url = cached.get("url", "")
        raw_payload = cached.get("raw", {})
        print(f"  [尝试] level={level} query={query}")
        if debug_url:
            print(f"  [URL] {debug_url}")
        if cached.get("status") != "success":
            print(f"  [失败] message={cached.get('message', '')}")
            if raw_payload:
                print(f"  [原始返回] {json.dumps(raw_payload, ensure_ascii=False)}")
            continue

        print(
            "  [命中候选] "
            f"lon={cached.get('lon','')} lat={cached.get('lat','')} "
            f"province={cached.get('province','')} city={cached.get('city','')} county={cached.get('county','')}"
        )
        if not in_yunnan(cached.get("lon", ""), cached.get("lat", "")):
            last_message = "out of yunnan"
            print("  [丢弃] 坐标不在云南范围内")
            continue
        if not region_matches(row, cached):
            last_message = "region mismatch"
            print("  [丢弃] 返回行政区与原表市县不匹配")
            continue

        result["查询地址"] = query
        result["定位级别"] = cached.get("level", level)
        result["地理编码状态"] = "success"
        result["地理编码消息"] = cached.get("message", "")
        result["经度"] = cached.get("lon", "")
        result["纬度"] = cached.get("lat", "")
        return result

    result["地理编码状态"] = "failed"
    result["地理编码消息"] = last_message
    return result


def refine_csv(
    input_path: Path,
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
        print(f"[{index}/{total}] 正在纠正 {plant_name}")
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

    with input_path.open("w", encoding="utf-8-sig", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=output_fieldnames)
        writer.writeheader()
        writer.writerows(results)

    success_count = sum(1 for row in results if clean_text(row.get("地理编码状态")) == "success")
    print(f"完成：{success_count}/{total} 条更新成功")
    print(f"已直接更新文件：{input_path}")


def main() -> None:
    refine_csv(
        input_path=DEFAULT_INPUT,
        tk=DEFAULT_TK,
        cache_path=DEFAULT_CACHE,
        timeout=DEFAULT_TIMEOUT,
        sleep_seconds=DEFAULT_SLEEP_SECONDS,
    )


if __name__ == "__main__":
    main()
