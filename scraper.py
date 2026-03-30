import json
import requests
import pandas as pd
import time
import random
import sys
import re
from concurrent.futures import ThreadPoolExecutor, as_completed


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

        self.session = requests.Session()
        self.session.proxies.update(self.proxies)

    def get_random_headers(self):
        return {
            "User-Agent": random.choice(self.user_agents),
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://pmos.hn.sgcc.com.cn",
            "Referer": "https://pmos.hn.sgcc.com.cn/"
        }

    def safe_request(self, method, url, **kwargs):
        min_d = self.settings.get('min_delay', 0.5)
        max_d = self.settings.get('max_delay', 1.5)
        time.sleep(random.uniform(min_d, max_d))

        for attempt in range(self.max_retries + 1):
            try:
                headers = self.get_random_headers()
                if 'headers' in kwargs:
                    headers.update(kwargs.pop('headers'))

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
    try:
        keys = key_path.split('.')
        value = data
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
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


def get_company_ids(helper, list_api_config):
    url = list_api_config.get('url')
    if not url:
        print("  [错误] 列表 API 配置中缺少 URL")
        return []

    method = list_api_config.get('method', 'POST').upper()
    json_params = list_api_config.get('json_params', {})
    pagination = list_api_config.get('pagination')

    all_ids = []
    current_page = 1
    total_pages = 1

    while current_page <= total_pages:
        current_params = json_params.copy()
        if pagination:
            page_num_path = pagination.get('page_num_path')
            if page_num_path:
                set_nested_value(current_params, page_num_path, current_page)
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
                id_field = list_api_config.get('id_field')
                page_ids_count = 0
                for item in items:
                    val = get_nested_value(item, id_field)
                    if val:
                        all_ids.append(str(val))
                        page_ids_count += 1
                print(f"  本页获取到 {page_ids_count} 个 ID")
            else:
                print(f"  [提示] 第 {current_page} 页未能找到列表数据")
                break

            if not pagination:
                break

            current_page += 1

        except Exception as e:
            print(f"  [错误] 解析第 {current_page} 页 JSON 失败: {str(e)}")
            break

    return all_ids


def get_company_details(helper, detail_api_config, company_id):
    url = detail_api_config.get('url')
    if not url:
        print("  [错误] 详情 API 配置中缺少 URL")
        return None

    method = detail_api_config.get('method', 'POST').upper()
    params = detail_api_config.get('json_params', {}).copy()
    id_placeholder = detail_api_config.get('id_placeholder', '{id}')

    def replace_id(obj, placeholder, replacement):
        if isinstance(obj, dict):
            return {k: replace_id(v, placeholder, replacement) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [replace_id(v, placeholder, replacement) for v in obj]
        elif isinstance(obj, str):
            return obj.replace(placeholder, replacement)
        else:
            return obj

    try:
        params = replace_id(params, id_placeholder, company_id)
        response = helper.safe_request(method, url, json=params)
        if response:
            return response.json()
    except Exception as e:
        print(f"  [错误] 处理详情数据 (ID: {company_id}) 时出错: {str(e)}")
    return None


def normalize_power_type(text):
    if not text:
        return None

    text = str(text)

    rules = [
        (["光伏", "太阳能", "太阳能光伏"], "太阳能发电"),
        (["风电", "风力", "风力发电"], "风电"),
        (["水电", "水力", "水力发电"], "水电"),
        (["核电", "核能"], "核电"),
        (["火电", "煤电", "燃煤", "燃气发电", "热电"], "火电"),
    ]

    for keywords, result in rules:
        if any(k in text for k in keywords):
            return result
    return None


def normalize_capacity(value):
    if value is None:
        return None

    s = str(value).strip()
    if not s or s.lower() == "null":
        return None

    s_clean = s.replace(",", "").replace(" ", "")

    # 2×660MW
    m = re.search(r'(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mw|kw|兆瓦|千瓦)', s_clean, re.I)
    if m:
        a = float(m.group(1))
        b = float(m.group(2))
        unit = m.group(3).lower()
        val = a * b
        if unit in ['kw', '千瓦']:
            val = val / 1000
        return str(val)

    # 10万千瓦
    m = re.search(r'(\d+(?:\.\d+)?)\s*万千瓦', s_clean)
    if m:
        return str(float(m.group(1)) * 10)

    # 100MW / 100兆瓦
    m = re.search(r'(\d+(?:\.\d+)?)\s*(mw|兆瓦)', s_clean, re.I)
    if m:
        return str(float(m.group(1)))

    # 100000kW / 100000千瓦
    m = re.search(r'(\d+(?:\.\d+)?)\s*(kw|千瓦)', s_clean, re.I)
    if m:
        return str(float(m.group(1)) / 1000)

    # 纯数字，默认按 MW
    if re.fullmatch(r'\d+(?:\.\d+)?', s_clean):
        return s_clean

    return s


def extract_company_data_by_rules(company_details):
    """
    优先用规则提取，不走 LLM
    """
    if not company_details or not isinstance(company_details, dict):
        return None

    root = company_details.get("data", {}) if "data" in company_details else company_details
    fd = root.get("ipGhFdEnterprise") or {}
    license_info = root.get("ipGhBusinessLicenseForm") or {}

    credit_code = fd.get("creditCode")
    company_name = fd.get("membersName")
    rated_cap = fd.get("generatorRatedCap")
    scope = license_info.get("scope")
    enterprise_type = fd.get("enterpriseType")
    generator_type = fd.get("generatorType")

    power_type = None

    # 先看经营范围
    power_type = normalize_power_type(scope)

    # 再看 enterpriseType
    if not power_type:
        power_type = normalize_power_type(enterprise_type)

    # 如有 generatorType 编码映射，可在这里补
    generator_type_map = {
        # 示例，具体按你的接口编码补充
        # "010000": "火电",
        # "020000": "水电",
        # "030000": "风电",
        # "040000": "核电",
        "050000": "太阳能发电",
    }
    if not power_type and generator_type:
        power_type = generator_type_map.get(str(generator_type))

    result = {
        "社会统一信用代码": credit_code,
        "企业名称": company_name,
        "发电类型": power_type,
        "装机容量": normalize_capacity(rated_cap),
    }

    # 至少有一个核心字段才算成功
    if any(result.values()):
        return result
    return None


def analyze_data_with_ollama(config, company_details):
    """
    只有规则提取失败时才调用
    """
    if not company_details:
        return None

    try:
        url = f"{config['ollama']['host']}/api/chat"

        # 压缩输入，不要 indent=2
        compact_json = json.dumps(company_details, ensure_ascii=False, separators=(",", ":"))

        prompt = f"""请从输入JSON中提取以下字段，并只返回JSON对象：
{{
  "社会统一信用代码": "...",
  "企业名称": "...",
  "发电类型": "火电/太阳能发电/风电/水电/核电/null",
  "装机容量": "..."
}}

要求：
1. 只返回JSON
2. 无法判断填 null
3. 发电类型只能是：火电、太阳能发电、风电、水电、核电
4. 不要解释

输入：
{compact_json}
"""

        payload = {
            "model": config['ollama']['model'],
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {
                "temperature": 0.0,
                "num_predict": 128
            }
        }

        response = requests.post(url, json=payload, timeout=45)
        response.raise_for_status()
        result = response.json()
        content = result.get('message', {}).get('content', '')

        start_index = content.find('{')
        end_index = content.rfind('}') + 1
        if start_index != -1 and end_index != -1:
            return json.loads(content[start_index:end_index])
        else:
            print(f"  [错误] Ollama 响应中未包含有效 JSON: {content[:100]}...")
    except requests.exceptions.ConnectionError:
        print("  [错误] 无法连接到本地 Ollama 服务，请确保 Ollama 已启动")
    except Exception as e:
        print(f"  [错误] 与 Ollama 通信或解析失败: {str(e)}")
    return None


def extract_company_data(config, company_details):
    """
    总提取入口：规则优先，LLM兜底
    """
    result = extract_company_data_by_rules(company_details)

    # 四项都齐全就直接返回
    if result and result.get("社会统一信用代码") and result.get("企业名称"):
        return result

    print("    [提示] 规则提取不完整，尝试使用 Ollama 兜底...")
    llm_result = analyze_data_with_ollama(config, company_details)

    if llm_result:
        merged = result or {}
        merged.update({k: v for k, v in llm_result.items() if v not in [None, "", "null"]})
        return merged

    return result


def save_all_to_csv(config, all_rows):
    if not all_rows:
        return

    csv_file = config.get('csv_file', 'data.csv')

    try:
        new_df = pd.DataFrame(all_rows)

        # 统一列顺序
        columns = ['社会统一信用代码', '企业名称', '发电类型', '装机容量']
        for c in columns:
            if c not in new_df.columns:
                new_df[c] = None
        new_df = new_df[columns]

        try:
            old_df = pd.read_csv(csv_file, dtype=str)
        except FileNotFoundError:
            old_df = pd.DataFrame(columns=columns)

        combined = pd.concat([old_df, new_df], ignore_index=True)

        # 按统一社会信用代码去重，保留最后一条
        if '社会统一信用代码' in combined.columns:
            combined['社会统一信用代码'] = combined['社会统一信用代码'].astype(str)
            combined = combined.drop_duplicates(subset=['社会统一信用代码'], keep='last')

        combined.to_csv(csv_file, index=False, encoding='utf-8-sig')
        print(f"  已写入 CSV，共 {len(new_df)} 条，本地总计 {len(combined)} 条")
    except Exception as e:
        print(f"  [错误] 保存 CSV 失败: {str(e)}")


def process_one_company(helper, source, config, company_id, index=None, total=None):
    prefix = f"  [{index}/{total}] " if index is not None and total is not None else "  "
    print(f"{prefix}处理企业 ID: {company_id}")

    company_details = get_company_details(helper, source.get('detail_api', {}), company_id)
    if not company_details:
        print("    * 跳过该企业 (无法获取详情数据)")
        return None

    analyzed_data = extract_company_data(config, company_details)
    if analyzed_data:
        name = analyzed_data.get('企业名称', '未知')
        print(f"    * 提取成功: {name}")
        return analyzed_data

    print("    * 跳过该企业 (提取失败)")
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

    if not sources:
        print("  [提示] 配置文件中没有定义任何数据来源 (sources)")
        return

    max_workers = config.get("max_workers", 4)

    for source in sources:
        source_name = source.get('name', '未命名来源')
        print(f"\n>>> 正在处理来源: {source_name}")

        company_ids = get_company_ids(helper, source.get('list_api', {}))
        print(f"  - 获取到 {len(company_ids)} 个企业ID")

        all_rows = []

        # 并发抓详情
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(process_one_company, helper, source, config, company_id, i + 1, len(company_ids)): company_id
                for i, company_id in enumerate(company_ids)
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

    print("\n=== 所有任务处理完毕 ===")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  [提示] 用户手动中止了程序")
        sys.exit(0)
    except Exception as e:
        print(f"\n  [致命错误] 程序意外崩溃: {str(e)}")