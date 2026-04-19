import csv
import json
import random
import re
import time
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote
from urllib.request import urlopen


TIANDITU_GEOCODER_URL = "http://api.tianditu.gov.cn/geocoder"
DEFAULT_TK = "b0955d5fb6e62c7e90a97d8b3fa4a3f5"
DEFAULT_TIMEOUT = 20
DEFAULT_SLEEP_MIN = 0.3
DEFAULT_SLEEP_MAX = 0.8

DEFAULT_INPUTS = [
    Path("/Users/lastjob/Documents/Work/SpiderData/线索/风电场核实_20260418.csv"),
    Path("/Users/lastjob/Documents/Work/SpiderData/线索/光伏电场核实_20260418.csv"),
]
DEFAULT_CACHE = Path("/Users/lastjob/Documents/Work/SpiderData/线索/tianditu_verified_clues_cache.json")

EXTRA_COLUMNS = [
    "搜索关键词",
    "经度",
    "纬度",
    "地理编码结果",
]


def clean_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_region(text: str) -> str:
    text = clean_text(text)
    suffixes = [
        "哈尼族彝族自治州",
        "傣族景颇族自治州",
        "白族自治州",
        "傈僳族自治州",
        "彝族自治州",
        "壮族苗族自治州",
        "回族彝族自治县",
        "哈尼族彝族自治县",
        "傣族拉祜族佤族自治县",
        "傣族佤族自治县",
        "拉祜族自治县",
        "佤族自治县",
        "傣族自治县",
        "回族自治县",
        "彝族自治县",
        "自治州",
        "自治县",
        "地区",
        "省",
        "州",
        "市",
        "县",
        "区",
    ]
    for suffix in suffixes:
        text = text.replace(suffix, "")
    return text


def dedupe(items: Iterable[Tuple[str, str]]) -> List[Tuple[str, str]]:
    seen = set()
    result: List[Tuple[str, str]] = []
    for item in items:
        if item not in seen and item[1]:
            seen.add(item)
            result.append(item)
    return result


def looks_like_full_address(address: str) -> bool:
    address = clean_text(address)
    return any(token in address for token in ["省", "州", "市", "县", "区", "乡", "镇", "街道", "村"])


def name_variants(name: str) -> List[str]:
    name = clean_text(name)
    if not name:
        return []

    variants: List[str] = []

    def add(value: str) -> None:
        value = clean_text(value)
        if value and value not in variants:
            variants.append(value)

    add(name)
    no_paren = re.sub(r"（[^）]*）|\([^)]*\)", "", name).strip()
    add(no_paren)

    simplified = no_paren
    patterns = [
        r"(风电场|风电项目|风电)$",
        r"(光伏发电项目|光伏发电站|光伏发电厂|光伏电站|光伏项目|光伏)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, simplified)
        if match:
            add(simplified[: match.start()].strip())

    return variants


def build_candidate_queries(row: Dict[str, str]) -> List[Tuple[str, str]]:
    province = clean_text(row.get("省")) or "云南省"
    city = clean_text(row.get("市"))
    district = clean_text(row.get("区"))
    address = clean_text(row.get("详细地址"))
    verified_name = clean_text(row.get("核实后名称")) or clean_text(row.get("原名称"))

    candidates: List[Tuple[str, str]] = []

    def add(level: str, query: str) -> None:
        query = clean_text(query)
        if query:
            candidates.append((level, query))

    if address:
        if looks_like_full_address(address):
            add("detail_address", address)
        add("province_city_district_detail", f"{province}{city}{district}{address}")
        add("province_city_detail", f"{province}{city}{address}")
        add("province_detail", f"{province}{address}")
        add("detail_only", address)

    for variant in name_variants(verified_name):
        add("province_city_district_name", f"{province}{city}{district}{variant}")
        add("city_district_name", f"{city}{district}{variant}")
        add("province_district_name", f"{province}{district}{variant}")
        add("province_city_name", f"{province}{city}{variant}")
        add("province_name", f"{province}{variant}")
        add("name_only", variant)

    return dedupe(candidates)


def load_cache(path: Path) -> Dict[str, Dict[str, str]]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(path: Path, cache: Dict[str, Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_json(url: str, timeout: int) -> Dict[str, object]:
    with urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def call_tianditu_geocoder(query: str, tk: str, timeout: int) -> Dict[str, str]:
    ds = json.dumps({"keyWord": query}, ensure_ascii=False, separators=(",", ":"))
    encoded_ds = quote(ds, safe='{}":,')
    url = f"{TIANDITU_GEOCODER_URL}?ds={encoded_ds}&tk={tk}"
    payload = fetch_json(url, timeout=timeout)

    status = str(payload.get("status", ""))
    message = clean_text(payload.get("msg")) or status or "unknown"
    if status != "0":
        return {
            "status": "failed",
            "message": message,
            "url": url,
            "raw": json.dumps(payload, ensure_ascii=False),
        }

    result = payload.get("result") or {}
    location = payload.get("location") or result.get("location") or {}
    lon = clean_text(location.get("lon"))
    lat = clean_text(location.get("lat"))
    if not lon or not lat:
        return {
            "status": "failed",
            "message": "missing location",
            "url": url,
            "raw": json.dumps(payload, ensure_ascii=False),
        }

    answer = {
        "status": "success",
        "message": message or "ok",
        "lon": lon,
        "lat": lat,
        "level": clean_text(location.get("level")),
        "url": url,
        "raw": json.dumps(payload, ensure_ascii=False),
    }

    address_component = payload.get("addressComponent") or result.get("addressComponent") or {}
    if address_component:
        answer["province"] = clean_text(address_component.get("province"))
        answer["city"] = clean_text(address_component.get("city"))
        answer["district"] = clean_text(address_component.get("county") or address_component.get("district"))
    return answer


def reverse_geocode(lon: str, lat: str, tk: str, timeout: int) -> Dict[str, str]:
    post_str = json.dumps({"lon": lon, "lat": lat, "ver": 1}, ensure_ascii=False, separators=(",", ":"))
    encoded = quote(post_str, safe='{}":,')
    url = f"{TIANDITU_GEOCODER_URL}?postStr={encoded}&type=geocode&tk={tk}"
    payload = fetch_json(url, timeout=timeout)

    status = str(payload.get("status", ""))
    if status != "0":
        return {}

    result = payload.get("result") or {}
    address_component = result.get("addressComponent") or payload.get("addressComponent") or {}
    return {
        "province": clean_text(address_component.get("province")),
        "city": clean_text(address_component.get("city")),
        "district": clean_text(address_component.get("county") or address_component.get("district")),
        "reverse_raw": json.dumps(payload, ensure_ascii=False),
    }


def region_consistent(row: Dict[str, str], province: str, city: str, district: str) -> bool:
    row_province = normalize_region(row.get("省"))
    row_city = normalize_region(row.get("市"))
    row_district = normalize_region(row.get("区"))
    got_province = normalize_region(province)
    got_city = normalize_region(city)
    got_district = normalize_region(district)

    province_ok = not row_province or not got_province or row_province in got_province or got_province in row_province
    city_ok = not row_city or not got_city or row_city in got_city or got_city in row_city
    district_ok = not row_district or not got_district or row_district in got_district or got_district in row_district
    return province_ok and city_ok and district_ok


def geocode_row(
    row: Dict[str, str],
    tk: str,
    cache: Dict[str, Dict[str, str]],
    timeout: int,
    sleep_min: float,
    sleep_max: float,
) -> Dict[str, str]:
    result = dict(row)
    result.setdefault("搜索关键词", "")
    result.setdefault("经度", "")
    result.setdefault("纬度", "")
    result.setdefault("地理编码结果", "")

    confidence = clean_text(result.get("确信度"))
    if not confidence or confidence == "待核实":
        result["搜索状态"] = "跳过"
        result["地理编码结果"] = "skipped: 确信度为空或待核实"
        return result

    candidates = build_candidate_queries(result)
    if not candidates:
        result["搜索状态"] = "地理编码失败"
        result["地理编码结果"] = "failed: 无可用搜索关键词"
        return result

    last_message = "未命中"
    for level, query in candidates:
        cached = cache.get(query)
        if cached is None:
            try:
                cached = call_tianditu_geocoder(query=query, tk=tk, timeout=timeout)
            except Exception as exc:
                cached = {"status": "failed", "message": str(exc)}
            cache[query] = cached
            time.sleep(random.uniform(sleep_min, sleep_max))

        last_message = clean_text(cached.get("message")) or "未命中"
        if cached.get("status") != "success":
            continue

        province = clean_text(cached.get("province"))
        city = clean_text(cached.get("city"))
        district = clean_text(cached.get("district"))
        if not (province or city or district):
            reverse_key = f"__reverse__:{cached.get('lon','')},{cached.get('lat','')}"
            reverse_cached = cache.get(reverse_key)
            if reverse_cached is None:
                try:
                    reverse_cached = reverse_geocode(
                        lon=clean_text(cached.get("lon")),
                        lat=clean_text(cached.get("lat")),
                        tk=tk,
                        timeout=timeout,
                    )
                except Exception:
                    reverse_cached = {}
                cache[reverse_key] = reverse_cached
                time.sleep(random.uniform(sleep_min, sleep_max))
            province = clean_text(reverse_cached.get("province"))
            city = clean_text(reverse_cached.get("city"))
            district = clean_text(reverse_cached.get("district"))

        if not region_consistent(result, province, city, district):
            last_message = f"{level}: 行政区不匹配"
            continue

        result["搜索关键词"] = query
        result["经度"] = clean_text(cached.get("lon"))
        result["纬度"] = clean_text(cached.get("lat"))
        result["地理编码结果"] = f"success: {level}"
        result["搜索状态"] = "地理编码成功"
        return result

    result["搜索关键词"] = candidates[0][1]
    result["搜索状态"] = "地理编码失败"
    result["地理编码结果"] = f"failed: {last_message}"
    return result


def ensure_fieldnames(fieldnames: List[str]) -> List[str]:
    merged = list(fieldnames)
    for column in EXTRA_COLUMNS:
        if column not in merged:
            merged.append(column)
    return merged


def write_rows_in_place(path: Path, fieldnames: List[str], rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8-sig", newline="", delete=False, dir=str(path.parent)) as tmp:
        tmp_path = Path(tmp.name)
        writer = csv.DictWriter(tmp, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            safe_row = {name: clean_text(row.get(name)) for name in fieldnames}
            writer.writerow(safe_row)
    tmp_path.replace(path)


def process_file(
    path: Path,
    tk: str,
    cache: Dict[str, Dict[str, str]],
    timeout: int,
    sleep_min: float,
    sleep_max: float,
) -> None:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fieldnames = ensure_fieldnames(reader.fieldnames or [])

    updated_rows: List[Dict[str, str]] = []
    for index, row in enumerate(rows, start=1):
        name = clean_text(row.get("核实后名称")) or clean_text(row.get("原名称"))
        print(f"[{path.name}] {index}/{len(rows)} {name or '未命名记录'}")
        updated_rows.append(
            geocode_row(
                row=row,
                tk=tk,
                cache=cache,
                timeout=timeout,
                sleep_min=sleep_min,
                sleep_max=sleep_max,
            )
        )
        if index % 20 == 0:
            save_cache(DEFAULT_CACHE, cache)

    write_rows_in_place(path, fieldnames, updated_rows)
    save_cache(DEFAULT_CACHE, cache)


def main() -> None:
    cache = load_cache(DEFAULT_CACHE)
    for input_path in DEFAULT_INPUTS:
        process_file(
            path=input_path,
            tk=DEFAULT_TK,
            cache=cache,
            timeout=DEFAULT_TIMEOUT,
            sleep_min=DEFAULT_SLEEP_MIN,
            sleep_max=DEFAULT_SLEEP_MAX,
        )


if __name__ == "__main__":
    main()
