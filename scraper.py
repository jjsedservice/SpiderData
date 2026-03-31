import copy
import json
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import pandas as pd
import requests


TARGET_FIELDS = ['地区', '社会统一信用代码', '企业名称', '发电类型', '装机容量', '更新时间']
TIMESTAMP_FORMAT = '%Y-%m-%d %H:%M:%S'


class ScraperHelper:
    def __init__(self, config):
        self.config = config
        self.settings = config.get('request_settings', {})
        self.user_agents = self.settings.get('user_agents', [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ])
        self.proxies = self.settings.get('proxies', {})
        self.max_retries = self.settings.get('max_retries', 3)
        self.retry_delay = self.settings.get('retry_delay', 5.0)
        self.timeout = self.settings.get('timeout', 30)
        self.detail_request_interval = float(self.settings.get('detail_request_interval', 1.0))

        self.session = requests.Session()
        self.session.proxies.update(self.proxies)

        self._detail_request_lock = threading.Lock()
        self._last_detail_request_at = 0.0

    def get_random_headers(self):
        return {
            "User-Agent": random.choice(self.user_agents),
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://pmos.hn.sgcc.com.cn",
            "Referer": "https://pmos.hn.sgcc.com.cn/"
        }

    def wait_for_detail_slot(self):
        if self.detail_request_interval <= 0:
            return

        with self._detail_request_lock:
            now = time.monotonic()
            wait_seconds = self.detail_request_interval - (now - self._last_detail_request_at)
            if wait_seconds > 0:
                time.sleep(wait_seconds)
            self._last_detail_request_at = time.monotonic()

    def safe_request(self, method, url, **kwargs):
        min_d = self.settings.get('min_delay', 0.5)
        max_d = self.settings.get('max_delay', 1.5)
        time.sleep(random.uniform(min_d, max_d))

        for attempt in range(self.max_retries + 1):
            try:
                headers = self.get_random_headers()
                custom_headers = kwargs.pop('headers', None)
                if custom_headers:
                    headers.update(custom_headers)

                response = self.session.request(
                    method=method,
                    url=url,
                    headers=headers,
                    timeout=self.timeout,
                    **kwargs
                )

                if response.status_code in [403, 429]:
                    print(f"  [警告] 遭遇封锁 (HTTP {response.status_code})，尝试第 {attempt + 1} 次重试...")
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay * (attempt + 1))
                        continue

                response.raise_for_status()
                return response

            except requests.exceptions.Timeout:
                print(f"  [错误] 请求超时 (尝试 {attempt + 1}/{self.max_retries + 1})")
            except requests.exceptions.ConnectionError:
                print(f"  [错误] 连接失败 (尝试 {attempt + 1}/{self.max_retries + 1})")
            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response is not None else "unknown"
                print(f"  [错误] HTTP 错误: {status} (尝试 {attempt + 1}/{self.max_retries + 1})")
            except Exception as e:
                print(f"  [错误] 发生未知请求异常: {str(e)}")

            if attempt < self.max_retries:
                time.sleep(self.retry_delay * (attempt + 1))
            else:
                print(f"  [最终失败] 已达到最大重试次数，放弃该请求: {url}")
                return None
        return None


def get_nested_value(data, key_path):
    if not key_path:
        return data

    value = data
    try:
        for raw_key in str(key_path).split('.'):
            if isinstance(value, list):
                if not raw_key.isdigit():
                    return None
                index = int(raw_key)
                if index < 0 or index >= len(value):
                    return None
                value = value[index]
            elif isinstance(value, dict):
                if raw_key not in value:
                    return None
                value = value[raw_key]
            else:
                return None
        return value
    except Exception:
        return None


def set_nested_value(data, key_path, new_value):
    if not key_path:
        return
    keys = key_path.split('.')
    current = data
    for key in keys[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[keys[-1]] = new_value


def find_pagination_request_path(data, prefixes=None):
    if prefixes is None:
        prefixes = []

    if isinstance(data, dict):
        for key, value in data.items():
            current_path = prefixes + [key]
            lowered_key = key.lower()
            if lowered_key in ['pagenum', 'currentpage', 'page', 'pageindex'] and isinstance(value, (int, float)):
                return '.'.join(current_path)

            found_path = find_pagination_request_path(value, current_path)
            if found_path:
                return found_path

    if isinstance(data, list):
        return None

    return None


def iterate_list_pages(helper, list_api_config):
    url = list_api_config.get('url')
    if not url:
        print("  [错误] 列表 API 配置中缺少 URL")
        return

    method = list_api_config.get('method', 'POST').upper()
    json_params = list_api_config.get('json_params', {})
    pagination = list_api_config.get('pagination')

    request_page_path = None
    current_page = 1
    total_pages = 1

    while current_page <= total_pages:
        current_params = copy.deepcopy(json_params)
        if pagination:
            if request_page_path is None:
                request_page_path = find_pagination_request_path(current_params)

            if request_page_path:
                set_nested_value(current_params, request_page_path, current_page)
                print(f"  正在请求第 {current_page}/{total_pages} 页...")

        response = helper.safe_request(method, url, json=current_params)
        if not response:
            break

        try:
            data = response.json()

            if current_page == 1 and pagination:
                total_records = get_nested_value(data, pagination.get('total_path'))
                if total_records is not None:
                    page_size = pagination.get('page_size', 10)
                    total_pages = (int(total_records) + page_size - 1) // page_size
                    print(f"  总记录数: {total_records}, 总页数: {total_pages}")

            list_path = list_api_config.get('list_path', '')
            items = get_nested_value(data, list_path)

            if items and isinstance(items, list):
                print(f"  本页获取到 {len(items)} 条记录")
                yield current_page, total_pages, items
            else:
                print(f"  [提示] 第 {current_page} 页未能找到列表数据")
                break

            if not pagination:
                break

            current_page += 1

        except Exception as e:
            print(f"  [错误] 解析第 {current_page} 页 JSON 失败: {str(e)}")
            break


def get_company_ids_from_list_items(list_items, id_field):
    company_ids = []
    if not id_field:
        return company_ids

    for item in list_items:
        value = get_nested_value(item, id_field)
        if not is_empty_value(value):
            company_ids.append(str(value).strip())
    return company_ids


def get_company_details(helper, detail_api_config, company_id):
    url = detail_api_config.get('url')
    if not url:
        print("  [错误] 详情 API 配置中缺少 URL")
        return None

    method = detail_api_config.get('method', 'POST').upper()
    params = copy.deepcopy(detail_api_config.get('json_params', {}))
    id_placeholder = detail_api_config.get('id_placeholder', '{id}')

    def replace_id(obj, placeholder, replacement):
        if isinstance(obj, dict):
            return {k: replace_id(v, placeholder, replacement) for k, v in obj.items()}
        if isinstance(obj, list):
            return [replace_id(v, placeholder, replacement) for v in obj]
        if isinstance(obj, str):
            return obj.replace(placeholder, replacement)
        return obj

    try:
        params = replace_id(params, id_placeholder, company_id)
        helper.wait_for_detail_slot()
        response = helper.safe_request(method, url, json=params)
        if response:
            return response.json()
    except Exception as e:
        print(f"  [错误] 处理详情数据 (ID: {company_id}) 时出错: {str(e)}")
    return None


def format_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value

    if number.is_integer():
        return str(int(number))
    return format(number, '.15g')


def normalize_capacity(value):
    if value is None:
        return None

    s = str(value).strip()
    if not s or s.lower() == "null":
        return None

    s_clean = s.replace(",", "").replace(" ", "")

    match = re.search(r'(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mw|kw|兆瓦|千瓦)', s_clean, re.I)
    if match:
        amount = float(match.group(1)) * float(match.group(2))
        unit = match.group(3).lower()
        if unit in ['kw', '千瓦']:
            amount = amount / 1000
        return format_number(amount)

    match = re.search(r'(\d+(?:\.\d+)?)\s*万千瓦', s_clean)
    if match:
        return format_number(float(match.group(1)) * 10)

    match = re.search(r'(\d+(?:\.\d+)?)\s*(mw|兆瓦)', s_clean, re.I)
    if match:
        return format_number(float(match.group(1)))

    match = re.search(r'(\d+(?:\.\d+)?)\s*(kw|千瓦)', s_clean, re.I)
    if match:
        return format_number(float(match.group(1)) / 1000)

    if re.fullmatch(r'\d+(?:\.\d+)?', s_clean):
        return format_number(s_clean)

    return s


def normalize_power_type_by_text(text):
    if not text:
        return None

    value = str(text)
    rules = [
        (["光伏", "太阳能", "太阳能光伏"], "太阳能发电"),
        (["风电", "风力", "风力发电"], "风电"),
        (["水电", "水力", "水力发电", "抽水蓄能"], "水电"),
        (["核电", "核能"], "核电"),
        (["火电", "煤电", "燃煤", "燃气发电", "热电"], "火电"),
    ]

    for keywords, result in rules:
        if any(keyword in value for keyword in keywords):
            return result
    return None


def build_power_type_lookup(config):
    raw_mapping = config.get('power_type_mapping', {})
    lookup = {}

    if not isinstance(raw_mapping, dict):
        return lookup

    for key, value in raw_mapping.items():
        normalized_key = str(key).strip()

        if isinstance(value, str):
            lookup[normalized_key] = value.strip()
            continue

        if isinstance(value, list):
            for code in value:
                lookup[str(code).strip()] = normalized_key

    return lookup


def is_empty_value(value):
    if value is None:
        return True
    if isinstance(value, str) and value.strip().lower() in ['', 'null', 'none']:
        return True
    return False


def first_non_empty_value(values):
    for value in values:
        if not is_empty_value(value):
            return value
    return None


def join_non_empty_values(values, separator=''):
    parts = []
    for value in values:
        if is_empty_value(value):
            continue
        parts.append(str(value).strip())

    if not parts:
        return None
    return separator.join(parts)


def extract_value_from_mapping(data, mapping_entry):
    if isinstance(mapping_entry, str):
        return get_nested_value(data, mapping_entry)

    if isinstance(mapping_entry, list):
        return first_non_empty_value(get_nested_value(data, item) for item in mapping_entry)

    if isinstance(mapping_entry, dict):
        mode = mapping_entry.get('mode', 'first_non_empty')
        paths = mapping_entry.get('paths', [])

        if not isinstance(paths, list) or not paths:
            return None

        values = [get_nested_value(data, path) for path in paths]

        if mode == 'concat':
            separator = mapping_entry.get('separator', '')
            return join_non_empty_values(values, separator)

        return first_non_empty_value(values)

    return None


def resolve_power_type(raw_value, power_type_lookup):
    if is_empty_value(raw_value):
        return None

    if isinstance(raw_value, list):
        for item in raw_value:
            resolved = resolve_power_type(item, power_type_lookup)
            if resolved:
                return resolved
        return None

    if isinstance(raw_value, (int, float)):
        raw_value = format_number(raw_value)

    text = str(raw_value).strip()
    if not text:
        return None

    mapped = power_type_lookup.get(text)
    if mapped:
        return mapped

    normalized = normalize_power_type_by_text(text)
    if normalized:
        return normalized

    return text


def extract_company_data(source, company_details, power_type_lookup):
    if not isinstance(company_details, dict):
        return None

    extraction_mapping = source.get('extraction_mapping', {})
    if not extraction_mapping:
        print("    [错误] 当前数据源缺少 extraction_mapping 配置")
        return None

    result = {
        '地区': source.get('name')
    }

    credit_code = extract_value_from_mapping(company_details, extraction_mapping.get('社会统一信用代码'))
    company_name = extract_value_from_mapping(company_details, extraction_mapping.get('企业名称'))
    capacity_raw = extract_value_from_mapping(company_details, extraction_mapping.get('装机容量'))
    power_type_raw = extract_value_from_mapping(company_details, extraction_mapping.get('发电类型'))

    result['社会统一信用代码'] = None if is_empty_value(credit_code) else str(credit_code).strip()
    result['企业名称'] = None if is_empty_value(company_name) else str(company_name).strip()
    result['发电类型'] = resolve_power_type(power_type_raw, power_type_lookup)
    result['装机容量'] = normalize_capacity(capacity_raw)

    if any(result.get(field) for field in TARGET_FIELDS if field != '地区'):
        return result
    return None


def read_existing_csv(csv_file):
    try:
        existing_df = pd.read_csv(csv_file, dtype=str)
    except FileNotFoundError:
        existing_df = pd.DataFrame(columns=TARGET_FIELDS)

    for column in TARGET_FIELDS:
        if column not in existing_df.columns:
            existing_df[column] = None
    return existing_df[TARGET_FIELDS]


def stamp_row_update_time(row):
    stamped_row = dict(row)
    stamped_row['更新时间'] = datetime.now().strftime(TIMESTAMP_FORMAT)
    return stamped_row


def process_list_only_source(source, list_items, power_type_lookup):
    all_rows = []

    for index, item in enumerate(list_items, start=1):
        print(f"  [{index}/{len(list_items)}] 处理列表记录")
        extracted_data = extract_company_data(source, item, power_type_lookup)
        if extracted_data:
            extracted_data = stamp_row_update_time(extracted_data)
            name = extracted_data.get('企业名称', '未知')
            print(f"    * 提取成功: {name}")
            all_rows.append(extracted_data)
        else:
            print("    * 跳过该记录 (映射提取失败)")

    return all_rows


def save_all_to_csv(config, all_rows):
    if not all_rows:
        return

    csv_file = config.get('csv_file', 'data.csv')

    try:
        new_df = pd.DataFrame(all_rows)
        for column in TARGET_FIELDS:
            if column not in new_df.columns:
                new_df[column] = None
        new_df = new_df[TARGET_FIELDS]

        old_df = read_existing_csv(csv_file)
        combined = pd.concat([old_df, new_df], ignore_index=True)

        combined.to_csv(csv_file, index=False, encoding='utf-8-sig')
        print(f"  已写入 CSV，共 {len(new_df)} 条，本地总计 {len(combined)} 条")
    except Exception as e:
        print(f"  [错误] 保存 CSV 失败: {str(e)}")


def deduplicate_csv_after_run(config):
    csv_file = config.get('csv_file', 'data.csv')

    try:
        df = read_existing_csv(csv_file)
        if df.empty:
            return

        key_columns = ['地区', '社会统一信用代码', '企业名称', '发电类型', '装机容量']

        df['__sort_time'] = pd.to_datetime(df['更新时间'], format=TIMESTAMP_FORMAT, errors='coerce')
        df = df.sort_values(by='__sort_time', ascending=False, na_position='last')
        df = df.drop_duplicates(subset=key_columns, keep='first')
        df = df.drop(columns=['__sort_time'])
        df = df[TARGET_FIELDS]

        df.to_csv(csv_file, index=False, encoding='utf-8-sig')
        print(f"  已完成去重，当前保留 {len(df)} 条")
    except Exception as e:
        print(f"  [错误] CSV 去重失败: {str(e)}")


def process_one_company(helper, source, company_id, index, total, power_type_lookup):
    print(f"  [{index}/{total}] 处理企业 ID: {company_id}")

    company_details = get_company_details(helper, source.get('detail_api', {}), company_id)
    if not company_details:
        print("    * 跳过该企业 (无法获取详情数据)")
        return None

    extracted_data = extract_company_data(source, company_details, power_type_lookup)
    if extracted_data:
        extracted_data = stamp_row_update_time(extracted_data)
        name = extracted_data.get('企业名称', '未知')
        print(f"    * 提取成功: {name}")
        return extracted_data

    print("    * 跳过该企业 (映射提取失败)")
    return None


def main():
    print("=== 发电企业数据采集程序开始运行 ===")

    try:
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
    except FileNotFoundError:
        print("  [错误] 找不到配置文件 config.json")
        return
    except json.JSONDecodeError:
        print("  [错误] 配置文件 config.json 格式错误，请检查 JSON 语法")
        return
    except Exception as e:
        print(f"  [错误] 读取配置文件失败: {str(e)}")
        return

    helper = ScraperHelper(config)
    sources = config.get('sources', [])
    power_type_lookup = build_power_type_lookup(config)

    if not sources:
        print("  [提示] 配置文件中没有定义任何数据来源 (sources)")
        return

    max_workers = config.get("max_workers", 4)

    for source in sources:
        source_name = source.get('name', '未命名来源')
        fetch_mode = source.get('fetch_mode', 'list_then_detail')
        print(f"\n>>> 正在处理来源: {source_name}")

        if fetch_mode == 'list_only':
            total_items = 0
            for page_number, total_pages, page_items in iterate_list_pages(helper, source.get('list_api', {})):
                total_items += len(page_items)
                print(f"  - 正在处理第 {page_number}/{total_pages} 页列表记录")
                page_rows = process_list_only_source(source, page_items, power_type_lookup)
                save_all_to_csv(config, page_rows)

            print(f"  - 获取到 {total_items} 条列表记录")
            continue

        list_items = []
        for _, _, page_items in iterate_list_pages(helper, source.get('list_api', {})):
            list_items.extend(page_items)

        print(f"  - 获取到 {len(list_items)} 条列表记录")
        company_ids = get_company_ids_from_list_items(list_items, source.get('list_api', {}).get('id_field'))
        print(f"  - 提取到 {len(company_ids)} 个企业ID")

        all_rows = []

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(
                    process_one_company,
                    helper,
                    source,
                    company_id,
                    index + 1,
                    len(company_ids),
                    power_type_lookup
                ): company_id
                for index, company_id in enumerate(company_ids)
            }

            for future in as_completed(future_map):
                try:
                    row = future.result()
                    if row:
                        all_rows.append(row)
                except Exception as e:
                    company_id = future_map[future]
                    print(f"  [错误] 处理企业 {company_id} 时异常: {str(e)}")

        save_all_to_csv(config, all_rows)

    deduplicate_csv_after_run(config)
    print("\n=== 所有任务处理完毕 ===")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  [提示] 用户手动中止了程序")
        sys.exit(0)
    except Exception as e:
        print(f"\n  [致命错误] 程序意外崩溃: {str(e)}")
