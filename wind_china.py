import json
import csv
import time
import re
from pathlib import Path
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm


# ================= 配置 =================

INPUT_FILE = "/Users/patcher/Downloads/wind_2026-02.geojson"
OUTPUT_FILE = "/Users/patcher/Downloads/china_wind_2026-02.csv"

TIANDITU_TK = "5a27a1e072e0551442ecd5805f39924b"

DEEPSEEK_API_KEY = "sk-e299423bcd1a454d8113046abc36f559"
DEEPSEEK_MODEL = "deepseek-v4-flash"
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

BATCH_SIZE = 10
MAX_WORKERS = 8
REQUEST_TIMEOUT = 20
REQUEST_SLEEP = 0.1

RUN_STAGE_1_BUILD_RAW_CSV = True
RUN_STAGE_2_FETCH_REFERENCES = False
RUN_STAGE_3_DEEPSEEK_NAME = True
RUN_STAGE_4_GEOCODE = False


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
    "offshore": "海上风电",
    "offshore hard mount": "海上固定式",
    "offshore mount unknown": "海上但安装形式不明",
    "offshore floating": "海上漂浮式",
    "unknown": "未知",
}

FIELDNAMES = [
    "唯一ID",
    "电场名称",
    "name",
    "name_noneng",
    "装机容量(MW)",
    "经度",
    "纬度",
    "状态",
    "安装类型",
    "省",
    "市",
    "区",
    "运营方",
    "原始页面",
    "参考资料",
    "DeepSeek提示词",
    "DeepSeek返回结果",
    "天地图请求参数",
    "天地图返回结果",
]


def create_session():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    return session


def get_prop(props, *keys, default=""):
    for key in keys:
        val = props.get(key)
        if val not in (None, ""):
            return val
    return default


def get_unique_id(props):
    project_id = get_prop(props, "project-id")
    unit_id = get_prop(props, "unit-id")

    if project_id or unit_id:
        return f"{project_id}_{unit_id}"

    name = get_prop(props, "name-noneng", "name")
    lon = get_prop(props, "Longitude")
    lat = get_prop(props, "Latitude")
    return f"{name}_{lon}_{lat}"


def parse_status(props):
    raw = str(get_prop(props, "status")).strip().lower()
    return STATUS_MAP.get(raw, raw)


def parse_installation_type(props):
    raw = str(get_prop(props, "tech-type", default="unknown")).strip().lower()
    return INSTALLATION_TYPE_MAP.get(raw, "未知")


def clean_row(row):
    if None in row:
        row.pop(None, None)

    return {
        field: row.get(field, "")
        for field in FIELDNAMES
    }


def read_csv_rows():
    path = Path(OUTPUT_FILE)

    if not path.exists():
        return []

    rows = []

    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        for row in reader:
            rows.append(clean_row(row))

    return rows


def write_all_rows(rows):
    clean_rows = [clean_row(dict(row)) for row in rows]

    with Path(OUTPUT_FILE).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=FIELDNAMES,
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(clean_rows)


def append_row(row):
    row = clean_row(dict(row))

    with Path(OUTPUT_FILE).open("a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=FIELDNAMES,
            extrasaction="ignore",
        )
        writer.writerow(row)
        f.flush()


def chunk_list(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def clean_llm_json_text(text):
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


# ================= 阶段一：生成原始 CSV =================

def build_raw_row(item):
    props = item.get("properties", {})

    name = get_prop(props, "name")
    name_noneng = get_prop(props, "name-noneng")

    return {
        "唯一ID": get_unique_id(props),
        "电场名称": name_noneng or name,
        "name": name,
        "name_noneng": name_noneng,
        "装机容量(MW)": get_prop(props, "capacity"),
        "经度": get_prop(props, "Longitude"),
        "纬度": get_prop(props, "Latitude"),
        "状态": parse_status(props),
        "安装类型": parse_installation_type(props),
        "省": "",
        "市": "",
        "区": "",
        "运营方": get_prop(props, "owner-noneng", "owner"),
        "原始页面": get_prop(props, "url"),
        "参考资料": "",
        "DeepSeek提示词": "",
        "DeepSeek返回结果": "",
        "天地图请求参数": "",
        "天地图返回结果": "",
    }


def stage_1_build_raw_csv():
    print("\n========== 阶段一：生成原始 CSV ==========")

    input_path = Path(INPUT_FILE)
    output_path = Path(OUTPUT_FILE)

    done_ids = set()
    if output_path.exists():
        for row in read_csv_rows():
            if row.get("唯一ID"):
                done_ids.add(row["唯一ID"])

    with input_path.open("r", encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])

    pending = []

    for item in features:
        props = item.get("properties", {})

        if props.get("country-area1") != "China":
            continue

        unique_id = get_unique_id(props)

        if unique_id in done_ids:
            continue

        pending.append(item)

    print(f"总 features 数：{len(features)}")
    print(f"待新增中国项目：{len(pending)}")
    print(f"输出文件：{output_path}")

    if not output_path.exists() or output_path.stat().st_size == 0:
        write_all_rows([])

    for item in tqdm(pending, desc="生成原始数据", unit="条"):
        row = build_raw_row(item)
        append_row(row)

    print("阶段一完成")


# ================= 阶段二：获取参考资料 =================

def fetch_reference_links(page_url, session):
    if not page_url:
        return []

    try:
        resp = session.get(page_url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        links = []
        seen = set()

        for ref in soup.select("span.reference-text"):
            for a in ref.select("a[href]"):
                href = a.get("href", "").strip()

                if not href.startswith("http"):
                    continue

                href = urljoin(page_url, href)

                if href not in seen:
                    seen.add(href)
                    links.append(href)

        return links

    except Exception:
        return []


def fetch_references_one_row(row):
    session = create_session()

    page_url = row.get("原始页面", "")
    links = fetch_reference_links(page_url, session)

    time.sleep(REQUEST_SLEEP)

    return row["唯一ID"], ";".join(links)


def stage_2_fetch_references():
    print("\n========== 阶段二：获取参考资料链接 ==========")

    rows = read_csv_rows()

    pending = [
        row for row in rows
        if not row.get("参考资料", "").strip()
        and row.get("原始页面", "").strip()
    ]

    print(f"CSV 总行数：{len(rows)}")
    print(f"待获取参考资料：{len(pending)}")

    if not pending:
        print("阶段二无需处理")
        return

    id_to_index = {row["唯一ID"]: i for i, row in enumerate(rows)}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(fetch_references_one_row, row)
            for row in pending
        ]

        for future in tqdm(as_completed(futures), total=len(futures), desc="获取参考资料", unit="条"):
            try:
                uid, references = future.result()
                idx = id_to_index[uid]
                rows[idx]["参考资料"] = references
                write_all_rows(rows)
            except Exception as e:
                print(f"\n参考资料获取失败：{e}")

    print("阶段二完成")


# ================= 阶段三：DeepSeek 批量中文名 =================

def build_deepseek_prompt(batch_rows):
    items = []

    for row in batch_rows:
        items.append({
            "id": row["唯一ID"],
            "name": row.get("name", ""),
        })

    return f"""
你是新能源风电场名称翻译助手。

请根据下面 JSON 数组中的英文 name，为每条数据返回一个准确、自然、规范的中文风电场名称。

规则：
1. 只根据 name 字段生成中文名称，不要使用 name_noneng。
2. 必须保持 id 原样返回。
3. 每条返回字段为 id、cn_name。
4. 只返回 JSON 数组，不要解释，不要 Markdown。
5. cn_name 不要带“中文名：”、编号、说明、引号外的其他文字。
6. 如果 name 中有 wind farm，中文优先译为“风电场”。
7. 如果 name 中有 wind power project，中文优先译为“风电项目”。
8. 地名应尽量翻译为中国常用地名，例如 Hubei -> 湖北，Yingcheng -> 应城。
9. 如果英文名称中含有公司名或括号内业主名，中文名称中可以保留为括号形式。
10. 不要返回英文。

输入：
{json.dumps(items, ensure_ascii=False, indent=2)}

返回格式示例：
[
  {{
    "id": "xxx",
    "cn_name": "湖北应城油明店风电场"
  }}
]
""".strip()


def call_deepseek_batch(batch_rows, session):
    prompt = build_deepseek_prompt(batch_rows)

    if not DEEPSEEK_API_KEY or DEEPSEEK_API_KEY == "你的DeepSeek API Key":
        result = []

        for row in batch_rows:
            result.append({
                "id": row["唯一ID"],
                "cn_name": row.get("name") or "",
            })

        return result, prompt, "未调用 DeepSeek：未配置 DEEPSEEK_API_KEY"

    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "stream": False,
    }

    resp = session.post(
        DEEPSEEK_API_URL,
        headers=headers,
        json=payload,
        timeout=90,
    )

    raw_response = resp.text
    resp.raise_for_status()

    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    content = clean_llm_json_text(content)

    parsed = json.loads(content)

    return parsed, prompt, raw_response


def process_deepseek_batch(batch):
    session = create_session()
    parsed_result, prompt, raw_response = call_deepseek_batch(batch, session)
    return batch, parsed_result, prompt, raw_response


def stage_3_deepseek_name():
    print("\n========== 阶段三：DeepSeek 批量获取中文名 ==========")

    rows = read_csv_rows()

    pending = [
        row for row in rows
        if not row.get("DeepSeek返回结果", "").strip()
    ]

    print(f"CSV 总行数：{len(rows)}")
    print(f"待 DeepSeek 处理：{len(pending)}")
    print(f"批大小：{BATCH_SIZE}")
    print(f"并发 worker 数：{MAX_WORKERS}")

    if not pending:
        print("阶段三无需处理")
        return

    id_to_index = {row["唯一ID"]: i for i, row in enumerate(rows)}
    batches = list(chunk_list(pending, BATCH_SIZE))

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(process_deepseek_batch, batch)
            for batch in batches
        ]

        for future in tqdm(
            as_completed(futures),
            total=len(futures),
            desc="DeepSeek 批处理",
            unit="批",
        ):
            try:
                batch, parsed_result, prompt, raw_response = future.result()

                name_map = {}

                for item in parsed_result:
                    item_id = str(item.get("id", "")).strip()
                    cn_name = str(item.get("cn_name", "")).strip()

                    if item_id:
                        name_map[item_id] = cn_name

                for row in batch:
                    uid = row["唯一ID"]
                    idx = id_to_index[uid]

                    cn_name = name_map.get(uid, "").strip()

                    if cn_name:
                        rows[idx]["电场名称"] = cn_name

                    rows[idx]["DeepSeek提示词"] = prompt
                    rows[idx]["DeepSeek返回结果"] = raw_response

                write_all_rows(rows)

            except Exception as e:
                print(f"\nDeepSeek 批处理失败：{type(e).__name__}: {e}")

    print("阶段三完成")


# ================= 阶段四：天地图逆地理编码 =================

def reverse_geocode_tianditu(lon, lat, tk, session, retries=3, sleep=0.3):
    if lon == "" or lat == "":
        return "", "", "", "", ""

    url = "https://api.tianditu.gov.cn/geocoder"

    post_str = {
        "lon": float(lon),
        "lat": float(lat),
        "ver": 1,
    }

    params = {
        "postStr": json.dumps(post_str, ensure_ascii=False),
        "type": "geocode",
        "tk": tk,
    }

    request_params = json.dumps(
        {
            "url": url,
            "params": params,
        },
        ensure_ascii=False,
    )

    last_error = ""

    for _ in range(retries):
        try:
            resp = session.get(url, params=params, timeout=10)
            raw_response = resp.text
            resp.raise_for_status()

            data = resp.json()
            result = data.get("result", {}) or {}
            comp = result.get("addressComponent", {}) or {}

            province = comp.get("province", "") or comp.get("prov", "")
            city = comp.get("city", "") or comp.get("cityname", "")
            district = comp.get("county", "") or comp.get("district", "")

            return province, city, district, request_params, raw_response

        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            time.sleep(sleep)

    return "", "", "", request_params, last_error


def geocode_one_row(row):
    session = create_session()

    province, city, district, request_params, raw_response = reverse_geocode_tianditu(
        lon=row.get("经度", ""),
        lat=row.get("纬度", ""),
        tk=TIANDITU_TK,
        session=session,
    )

    return row["唯一ID"], province, city, district, request_params, raw_response


def stage_4_geocode():
    print("\n========== 阶段四：天地图获取省市区 ==========")

    rows = read_csv_rows()

    pending = [
        row for row in rows
        if not row.get("省", "").strip()
        and row.get("经度", "").strip()
        and row.get("纬度", "").strip()
    ]

    print(f"CSV 总行数：{len(rows)}")
    print(f"待逆编码数量：{len(pending)}")

    if not pending:
        print("阶段四无需处理")
        return

    id_to_index = {row["唯一ID"]: i for i, row in enumerate(rows)}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(geocode_one_row, row)
            for row in pending
        ]

        for future in tqdm(as_completed(futures), total=len(futures), desc="天地图逆编码", unit="条"):
            try:
                uid, province, city, district, request_params, raw_response = future.result()

                idx = id_to_index[uid]

                rows[idx]["省"] = province
                rows[idx]["市"] = city
                rows[idx]["区"] = district
                rows[idx]["天地图请求参数"] = request_params
                rows[idx]["天地图返回结果"] = raw_response

                write_all_rows(rows)

            except Exception as e:
                print(f"\n逆编码失败：{e}")

    print("阶段四完成")


# ================= 主入口 =================

def main():
    if RUN_STAGE_1_BUILD_RAW_CSV:
        stage_1_build_raw_csv()

    if RUN_STAGE_2_FETCH_REFERENCES:
        stage_2_fetch_references()

    if RUN_STAGE_3_DEEPSEEK_NAME:
        stage_3_deepseek_name()

    if RUN_STAGE_4_GEOCODE:
        stage_4_geocode()

    print("\n全部阶段执行完成")


if __name__ == "__main__":
    main()