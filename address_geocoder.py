import csv
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

import requests


GEOCODER_URL = 'http://api.tianditu.gov.cn/geocoder'
DEFAULT_INPUT = '/Users/patcher/Documents/Work/SpiderData/data_structured.csv'
DEFAULT_OUTPUT = '/Users/patcher/Documents/Work/SpiderData/data_geocoded.csv'
DEFAULT_CACHE = '/Users/patcher/Documents/Work/SpiderData/tianditu_geocode_cache.json'
DEFAULT_CACHE_JS = '/Users/patcher/Documents/Work/SpiderData/tianditu_geocode_cache.js'
DEFAULT_TIMEOUT = 20
DEFAULT_SLEEP_SECONDS = 0.15
DEFAULT_TK = 'b0955d5fb6e62c7e90a97d8b3fa4a3f5'

OUTPUT_EXTRA_COLUMNS = [
    '查询地址',
    '经度',
    '纬度',
    '定位级别',
    '经纬度可信度',
    '地理编码状态',
    '地理编码消息',
]

LEVEL_CONFIDENCE = {
    'standard': '0.95',
    'house': '0.93',
    'group': '0.90',
    'village': '0.85',
    'town': '0.75',
    'county': '0.60',
    'raw': '0.55',
    'site': '0.50',
    'subject_site': '0.40',
    'region_site': '0.30',
}


def clean_text(value: Optional[str]) -> str:
    if value is None:
        return ''
    return str(value).strip()


def join_parts(parts: List[str]) -> str:
    return ''.join(part for part in parts if clean_text(part))


def build_candidate_queries(row: Dict[str, str]) -> List[Tuple[str, str]]:
    province = clean_text(row.get('省'))
    city = clean_text(row.get('市州'))
    county = clean_text(row.get('区县'))
    town = clean_text(row.get('乡镇街道'))
    village = clean_text(row.get('村社区'))
    group_name = clean_text(row.get('组社'))
    house_number = clean_text(row.get('门牌号'))
    standard_address = clean_text(row.get('标准化地址'))
    raw_address = clean_text(row.get('原始地址片段'))
    site_name = clean_text(row.get('站点名称'))
    subject_name = clean_text(row.get('主体名称'))
    region = clean_text(row.get('地区'))

    candidates: List[Tuple[str, str]] = []

    def add_candidate(level: str, text: str) -> None:
        normalized = clean_text(text)
        if not normalized:
            return
        item = (level, normalized)
        if item not in candidates:
            candidates.append(item)

    add_candidate('standard', standard_address)
    add_candidate('house', join_parts([province, city, county, town, village, group_name, house_number]))
    add_candidate('group', join_parts([province, city, county, town, village, group_name]))
    add_candidate('village', join_parts([province, city, county, town, village]))
    add_candidate('town', join_parts([province, city, county, town]))
    add_candidate('county', join_parts([province, city, county]))
    add_candidate('raw', join_parts([province, raw_address]))
    add_candidate('site', join_parts([province, city, county, town, site_name]))
    add_candidate('subject_site', join_parts([province, subject_name, site_name]))
    add_candidate('region_site', join_parts([region, site_name]))

    return candidates


def load_cache(cache_path: Path) -> Dict[str, Dict[str, str]]:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_cache(cache_path: Path, cache: Dict[str, Dict[str, str]]) -> None:
    cache_path.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    js_path = Path(DEFAULT_CACHE_JS)
    js_path.write_text(
        'window.GEOCODE_CACHE = ' + json.dumps(cache, ensure_ascii=False, indent=2) + ';\n',
        encoding='utf-8'
    )


def build_row_key(row: Dict[str, str]) -> str:
    return '||'.join([
        clean_text(row.get('地区')),
        clean_text(row.get('社会统一信用代码')),
        clean_text(row.get('企业名称')),
        clean_text(row.get('标准化地址')),
    ])


def call_tianditu_geocoder(query: str, tk: str, timeout: int) -> Dict[str, str]:
    ds = json.dumps({'keyWord': query}, ensure_ascii=False, separators=(',', ':'))
    encoded_ds = quote(ds, safe='{}":,')
    url = f'{GEOCODER_URL}?ds={encoded_ds}&tk={tk}'

    response = requests.get(url, timeout=timeout)
    if response.status_code >= 400:
        return {
            'status': 'failed',
            'message': f'HTTP {response.status_code}: {response.text[:500]}',
        }
    payload = response.json()

    status = str(payload.get('status', ''))
    message = str(payload.get('msg', ''))

    if status != '0':
        return {
            'status': 'failed',
            'message': message or status or 'unknown',
        }

    location = payload.get('location') or {}
    lon = location.get('lon')
    lat = location.get('lat')
    level = location.get('level', '')

    if lon in [None, ''] or lat in [None, '']:
        return {
            'status': 'failed',
            'message': 'missing location',
        }

    return {
        'status': 'success',
        'message': message or 'OK',
        'lon': str(lon),
        'lat': str(lat),
        'level': str(level),
    }


def enrich_cache_entry(
    cache_entry: Dict[str, str],
    row: Dict[str, str],
    query: str,
    candidate_level: str,
) -> Dict[str, str]:
    enriched = dict(cache_entry)
    enriched['query'] = query
    enriched['candidate_level'] = candidate_level
    enriched['original_address'] = clean_text(row.get('原始地址片段'))
    enriched['standard_address'] = clean_text(row.get('标准化地址'))
    enriched['company_name'] = clean_text(row.get('企业名称'))
    enriched['site_name'] = clean_text(row.get('站点名称'))
    enriched['region'] = clean_text(row.get('地区'))
    enriched['power_type'] = clean_text(row.get('发电类型'))
    return enriched


def geocode_row(
    row: Dict[str, str],
    tk: str,
    cache: Dict[str, Dict[str, str]],
    timeout: int,
    sleep_seconds: float,
) -> Tuple[Dict[str, str], List[str]]:
    result = dict(row)
    logs: List[str] = []
    result.update({
        '查询地址': '',
        '经度': '',
        '纬度': '',
        '定位级别': '',
        '经纬度可信度': '',
        '地理编码状态': 'failed',
        '地理编码消息': 'no candidate query',
    })

    for level, query in build_candidate_queries(row):
        cache_key = query
        cached = cache.get(cache_key)
        if cached is None:
            logs.append(f'  请求 [{level}] {query}')
            try:
                cached = call_tianditu_geocoder(query, tk=tk, timeout=timeout)
            except Exception as exc:
                cached = {
                    'status': 'failed',
                    'message': str(exc),
                }
            cached = enrich_cache_entry(cached, row, query, level)
            cache[cache_key] = cached
            time.sleep(sleep_seconds)
        else:
            cached = enrich_cache_entry(cached, row, query, level)
            cache[cache_key] = cached
            logs.append(f'  命中缓存 [{level}] {query}')

        if cached.get('status') == 'success':
            result['查询地址'] = query
            result['经度'] = cached.get('lon', '')
            result['纬度'] = cached.get('lat', '')
            result['定位级别'] = level
            result['经纬度可信度'] = LEVEL_CONFIDENCE.get(level, '0.20')
            result['地理编码状态'] = 'success'
            result['地理编码消息'] = cached.get('message', '')
            logs.append(f"  成功 [{level}] lon={result['经度']} lat={result['纬度']} confidence={result['经纬度可信度']}")
            return result, logs

        result['查询地址'] = query
        result['定位级别'] = level
        result['经纬度可信度'] = LEVEL_CONFIDENCE.get(level, '0.20')
        result['地理编码消息'] = cached.get('message', '')
        logs.append(f"  失败 [{level}] {cached.get('message', '')}")

    return result, logs


def geocode_csv(
    input_path: Path,
    output_path: Path,
    tk: str,
    cache_path: Path,
    timeout: int,
    sleep_seconds: float,
) -> None:
    cache = load_cache(cache_path)
    processed_keys = set()

    with input_path.open('r', encoding='utf-8-sig', newline='') as infile:
        reader = csv.DictReader(infile)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])
        output_columns = fieldnames + [column for column in OUTPUT_EXTRA_COLUMNS if column not in fieldnames]

    if output_path.exists():
        with output_path.open('r', encoding='utf-8-sig', newline='') as existing_file:
            existing_reader = csv.DictReader(existing_file)
            for existing_row in existing_reader:
                processed_keys.add(build_row_key(existing_row))

    write_header = not output_path.exists() or output_path.stat().st_size == 0

    with output_path.open('a', encoding='utf-8-sig', newline='') as outfile:
        writer = csv.DictWriter(outfile, fieldnames=output_columns)
        if write_header:
            writer = csv.DictWriter(outfile, fieldnames=output_columns)
            writer.writeheader()

        total_rows = len(rows)
        handled_count = 0

        for index, row in enumerate(rows, start=1):
            row_key = build_row_key(row)
            label = clean_text(row.get('企业名称')) or clean_text(row.get('标准化地址')) or f'row-{index}'

            if row_key in processed_keys:
                print(f'[{index}/{total_rows}] 已跳过: {label} (结果文件已存在)')
                continue

            print(f'[{index}/{total_rows}] 开始处理: {label}')
            enriched_row, logs = geocode_row(
                row=row,
                tk=tk,
                cache=cache,
                timeout=timeout,
                sleep_seconds=sleep_seconds,
            )
            for line in logs:
                print(line)

            writer.writerow(enriched_row)
            outfile.flush()
            processed_keys.add(row_key)
            handled_count += 1

            print(
                f"[{index}/{total_rows}] 已写入: status={enriched_row['地理编码状态']} "
                f"query={enriched_row['查询地址']} lon={enriched_row['经度']} lat={enriched_row['纬度']}"
            )

            if handled_count % 20 == 0:
                save_cache(cache_path, cache)
                print(f'已保存缓存，累计新写入 {handled_count} 行')

    save_cache(cache_path, cache)


def main() -> None:
    if not DEFAULT_TK:
        raise ValueError('缺少天地图 Key。')

    input_path = Path(DEFAULT_INPUT)
    output_path = Path(DEFAULT_OUTPUT)
    cache_path = Path(DEFAULT_CACHE)

    if not input_path.exists():
        raise FileNotFoundError(f'找不到输入文件: {input_path}')

    geocode_csv(
        input_path=input_path,
        output_path=output_path,
        tk=DEFAULT_TK,
        cache_path=cache_path,
        timeout=DEFAULT_TIMEOUT,
        sleep_seconds=DEFAULT_SLEEP_SECONDS,
    )
    print(f'已生成含经纬度文件: {output_path}')


if __name__ == '__main__':
    main()
