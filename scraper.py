
import json
import requests
import pandas as pd
import time
import random
import sys

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

    def get_random_headers(self):
        return {
            "User-Agent": random.choice(self.user_agents),
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://pmos.hn.sgcc.com.cn",
            "Referer": "https://pmos.hn.sgcc.com.cn/"
        }

    def safe_request(self, method, url, **kwargs):
        """执行带有重试和延时机制的请求"""
        # 随机延时
        min_d = self.settings.get('min_delay', 2.0)
        max_d = self.settings.get('max_delay', 5.0)
        time.sleep(random.uniform(min_d, max_d))

        for attempt in range(self.max_retries + 1):
            try:
                headers = self.get_random_headers()
                if 'headers' in kwargs:
                    headers.update(kwargs.pop('headers'))

                response = requests.request(
                    method=method,
                    url=url,
                    headers=headers,
                    proxies=self.proxies,
                    timeout=30,
                    **kwargs
                )
                
                # 处理被封禁的情况
                if response.status_code in [403, 429]:
                    print(f"  [警告] 遭遇封锁 (HTTP {response.status_code})，尝试第 {attempt + 1} 次重试...")
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay * (attempt + 1))
                        continue
                
                # 如果是其他错误码，抛出异常进入 except 处理
                response.raise_for_status()
                return response
            except requests.exceptions.Timeout:
                print(f"  [错误] 请求超时 (尝试 {attempt + 1}/{self.max_retries + 1})")
            except requests.exceptions.ConnectionError:
                print(f"  [错误] 连接失败 (尝试 {attempt + 1}/{self.max_retries + 1})")
            except requests.exceptions.HTTPError as e:
                print(f"  [错误] HTTP 错误: {e.response.status_code} (尝试 {attempt + 1}/{self.max_retries + 1})")
            except Exception as e:
                print(f"  [错误] 发生未知请求异常: {str(e)}")
            
            # 通用的重试逻辑
            if attempt < self.max_retries:
                time.sleep(self.retry_delay * (attempt + 1))
            else:
                print(f"  [最终失败] 已达到最大重试次数，放弃该请求: {url}")
                return None
        return None

def get_nested_value(data, key_path):
    """支持通过点号分隔的路径获取嵌套字典中的值"""
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
    """支持通过点号分隔的路径设置嵌套字典中的值"""
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
    """获取所有页面的发电企业列表数据"""
    url = list_api_config.get('url')
    if not url:
        print("  [错误] 列表 API 配置中缺少 URL")
        return []
    
    method = list_api_config.get('method', 'POST').upper()
    json_params = list_api_config.get('json_params', {})
    
    # 获取分页配置
    pagination = list_api_config.get('pagination')
    all_ids = []
    current_page = 1
    total_pages = 1

    while current_page <= total_pages:
        # 如果有分页配置，更新请求参数
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
            
            # 第一页时获取总记录数并计算总页数
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
            
            # 如果没有分页配置，只执行一次
            if not pagination:
                break
                
            current_page += 1
            
        except Exception as e:
            print(f"  [错误] 解析第 {current_page} 页 JSON 失败: {str(e)}")
            break

    return all_ids

def get_company_details(helper, detail_api_config, company_id):
    """获取发电企业详细信息"""
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

def analyze_data_with_ollama(config, company_details):
    """通过Ollama分析数据"""
    if not company_details:
        return None

    try:
        url = f"{config['ollama']['host']}/api/chat"
        prompt = f"""从以下JSON数据中提取社会统一信用代码、企业名称、发电类型（根据信息提取为火电、太阳能发电、风电、水电、核电）、装机容量，并以JSON格式返回。

数据：
{json.dumps(company_details, indent=2, ensure_ascii=False)}

请只返回一个包含这四个字段的JSON对象。
"""
        
        payload = {
            "model": config['ollama']['model'],
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"temperature": 0.0}
        }

        response = requests.post(url, json=payload, timeout=60)
        response.raise_for_status()
        result = response.json()
        content = result.get('message', {}).get('content', '')
        
        start_index = content.find('{')
        end_index = content.rfind('}') + 1
        if start_index != -1 and end_index != -1:
            return json.loads(content[start_index:end_index])
        else:
            print(f"  [错误] Ollama 响应中未包含有效的 JSON: {content[:100]}...")
    except requests.exceptions.ConnectionError:
        print("  [错误] 无法连接到本地 Ollama 服务，请确保 Ollama 已启动")
    except Exception as e:
        print(f"  [错误] 与 Ollama 通信或解析失败: {str(e)}")
    return None

def update_csv(config, data_to_update):
    """更新或新增数据到CSV文件"""
    if not data_to_update:
        return

    csv_file = config.get('csv_file', 'data.csv')
    try:
        try:
            df = pd.read_csv(csv_file)
        except FileNotFoundError:
            df = pd.DataFrame(columns=['社会统一信用代码', '企业名称', '发电类型', '装机容量'])

        credit_code = data_to_update.get('社会统一信用代码')
        if credit_code and not df[df['社会统一信用代码'].astype(str) == str(credit_code)].empty:
            # 使用索引更新
            idx = df[df['社会统一信用代码'].astype(str) == str(credit_code)].index
            for key, value in data_to_update.items():
                if key in df.columns:
                    df.loc[idx, key] = value
        else:
            new_row = pd.DataFrame([data_to_update])
            df = pd.concat([df, new_row], ignore_index=True)

        df.to_csv(csv_file, index=False, encoding='utf-8-sig')
    except Exception as e:
        print(f"  [错误] 更新 CSV 文件失败: {str(e)}")

def main():
    print("=== 发电企业数据采集程序开始运行 ===")
    try:
        with open('config.json', 'r') as f:
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

    for source in sources:
        source_name = source.get('name', '未命名来源')
        print(f"\n>>> 正在处理来源: {source_name}")
        
        company_ids = get_company_ids(helper, source.get('list_api', {}))
        print(f"  - 获取到 {len(company_ids)} 个企业ID")

        for i, company_id in enumerate(company_ids):
            print(f"  [{i+1}/{len(company_ids)}] 处理企业 ID: {company_id}")
            company_details = get_company_details(helper, source.get('detail_api', {}), company_id)
            
            if company_details:
                analyzed_data = analyze_data_with_ollama(config, company_details)
                if analyzed_data:
                    name = analyzed_data.get('企业名称', '未知')
                    print(f"    * 提取成功: {name}")
                    update_csv(config, analyzed_data)
                else:
                    print(f"    * 跳过该企业 (Ollama 分析未成功)")
            else:
                print(f"    * 跳过该企业 (无法获取详情数据)")

    print("\n=== 所有任务处理完毕 ===")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  [提示] 用户手动中止了程序")
        sys.exit(0)
    except Exception as e:
        print(f"\n  [致命错误] 程序意外崩溃: {str(e)}")
