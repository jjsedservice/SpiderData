#!/usr/bin/env python3
import csv
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote

GEOCODER_URL = "http://api.tianditu.gov.cn/geocoder"
DEFAULT_TK = "b0955d5fb6e62c7e90a97d8b3fa4a3f5"
DEFAULT_TIMEOUT = 20.0
DEFAULT_SLEEP_SECONDS = 0.15

INPUT_HEADERS = ["原始图片", "省", "市", "经度", "纬度"]
OUTPUT_HEADERS = ["原始图片", "省", "市", "经度", "纬度", "POI"]


def call_tianditu_reverse_geocoder(lng: str, lat: str, tk: str, timeout: float) -> str:
    post_str = json.dumps(
        {
            "lon": float(lng),
            "lat": float(lat),
            "ver": 1,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    encoded_post_str = quote(post_str, safe='{}":,')
    url = f"{GEOCODER_URL}?postStr={encoded_post_str}&type=geocode&tk={tk}"

    with urllib.request.urlopen(url, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if str(payload.get("status", "")) != "0":
        return ""

    result = payload.get("result") or {}
    pois = result.get("pois") or []
    if isinstance(pois, list) and pois:
        first = pois[0] or {}
        return str(first.get("name") or "").strip()

    address_component = result.get("addressComponent") or {}
    return (
        str(address_component.get("poi") or "").strip()
        or str(address_component.get("town") or "").strip()
        or str(address_component.get("county") or "").strip()
    )


def enrich_csv(input_path: Path, tk: str, timeout: float, sleep_seconds: float) -> Path:
    output_path = input_path.with_name(f"{input_path.stem}_带POI.csv")
    cache: dict[tuple[str, str], str] = {}

    with input_path.open("r", encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        if not reader.fieldnames:
            raise ValueError(f"{input_path.name} 没有表头")

        missing_headers = [header for header in INPUT_HEADERS if header not in reader.fieldnames]
        if missing_headers:
            raise ValueError(f"{input_path.name} 缺少字段: {', '.join(missing_headers)}")

        rows = list(reader)

    with output_path.open("w", encoding="utf-8-sig", newline="") as target_file:
        writer = csv.DictWriter(target_file, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()

        for index, row in enumerate(rows, start=1):
            lng = str(row.get("经度") or "").strip()
            lat = str(row.get("纬度") or "").strip()
            poi = ""

            if lng and lat:
                cache_key = (lng, lat)
                if cache_key not in cache:
                    try:
                        cache[cache_key] = call_tianditu_reverse_geocoder(lng, lat, tk, timeout)
                    except Exception:
                        cache[cache_key] = ""
                    time.sleep(sleep_seconds)
                poi = cache[cache_key]

            writer.writerow(
                {
                    "原始图片": str(row.get("原始图片") or "").strip(),
                    "省": str(row.get("省") or "").strip(),
                    "市": str(row.get("市") or "").strip(),
                    "经度": lng,
                    "纬度": lat,
                    "POI": poi,
                }
            )
            print(f"[{index}/{len(rows)}] {input_path.name} -> {row.get('原始图片', '')} | POI={poi}")

    return output_path


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python poi_enricher.py 风电识别数据_导出.csv [光伏识别数据_导出.csv ...]")
        return 1

    tk = os.getenv("TIANDITU_TK", DEFAULT_TK).strip()
    if not tk:
        print("缺少 TIANDITU_TK")
        return 1

    for raw_path in sys.argv[1:]:
        input_path = Path(raw_path).expanduser().resolve()
        if not input_path.exists():
            print(f"文件不存在: {input_path}")
            return 1

        output_path = enrich_csv(
            input_path=input_path,
            tk=tk,
            timeout=DEFAULT_TIMEOUT,
            sleep_seconds=DEFAULT_SLEEP_SECONDS,
        )
        print(f"已输出: {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
