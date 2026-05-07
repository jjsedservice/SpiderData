# -*- coding: utf-8 -*-

"""
读取光伏项目 Excel
调用 DeepSeek 将英文光伏项目名称转换为中文项目名
输出新的 Excel

安装依赖：
pip install pandas openpyxl requests

运行方式：
export DEEPSEEK_API_KEY="你的key"
python translate_pv_name.py
"""

import os
import time
from pathlib import Path

import pandas as pd
import requests


# =========================================================
# 配置
# =========================================================

INPUT_FILE = "云南_湖北_上海_江苏_安徽_浙江_光伏.xlsx"
OUTPUT_FILE = "云南_湖北_上海_江苏_安徽_浙江_光伏_中文名.xlsx"

# 英文项目名列
NAME_COL = "电场名称"

# 输出中文列
OUTPUT_COL = "中文项目名"

# DeepSeek
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"

# 每次请求间隔
SLEEP_SECONDS = 0.5

# 每多少条自动保存一次
SAVE_EVERY = 20


# =========================================================
# DeepSeek 调用
# =========================================================

def ask_deepseek(english_name: str) -> str:
    """
    调用 DeepSeek 将英文光伏项目名转中文
    """

    if not english_name:
        return ""

    prompt = f"""
你是中国新能源行业数据专家。

下面给你的是一个中国光伏项目的英文名称。

请把它转换成中国行业里更自然、更像真实项目名的中文名称。

要求：
1. 只返回中文名称
2. 不要解释
3. 不要加引号
4. PV / Solar / Solar Park / Solar Farm 统一翻译为：
   - 光伏电站
   - 光伏项目
5. 保留企业名和地名
6. 输出风格尽量像中国真实立项名称

示例：

Qinghai Golmud Solar Farm
→ 青海格尔木光伏电站

CGN Delingha PV Project
→ 中广核德令哈光伏项目

SPIC Yunnan Solar Park
→ 国家电投云南光伏电站

英文名称：
{english_name}
"""

    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "你只负责将中国光伏项目英文名转换成中文项目名。"
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.2
    }

    response = requests.post(
        DEEPSEEK_API_URL,
        headers=headers,
        json=payload,
        timeout=60
    )

    response.raise_for_status()

    data = response.json()

    result = data["choices"][0]["message"]["content"].strip()

    # 清理换行
    result = result.replace("\n", " ").strip()

    return result


# =========================================================
# 主程序
# =========================================================

def main():

    if not DEEPSEEK_API_KEY:
        raise RuntimeError("请先设置 DEEPSEEK_API_KEY 环境变量")

    if not Path(INPUT_FILE).exists():
        raise FileNotFoundError(f"文件不存在: {INPUT_FILE}")

    print("读取 Excel...")
    df = pd.read_excel(INPUT_FILE)

    if NAME_COL not in df.columns:
        raise ValueError(
            f"Excel 中不存在列: {NAME_COL}\n"
            f"当前列: {list(df.columns)}"
        )

    # 创建输出列
    if OUTPUT_COL not in df.columns:
        df[OUTPUT_COL] = ""

    # 缓存，避免重复请求
    cache = {}

    total = len(df)

    print(f"开始处理，共 {total} 条...\n")

    for idx, row in df.iterrows():

        english_name = str(row.get(NAME_COL, "")).strip()

        # 空值跳过
        if not english_name or english_name.lower() == "nan":
            continue

        # 已存在结果则跳过
        old_value = str(row.get(OUTPUT_COL, "")).strip()

        if old_value and old_value.lower() != "nan":
            continue

        try:

            # 缓存命中
            if english_name in cache:
                chinese_name = cache[english_name]

            else:
                chinese_name = ask_deepseek(english_name)
                cache[english_name] = chinese_name

                time.sleep(SLEEP_SECONDS)

            df.at[idx, OUTPUT_COL] = chinese_name

            print(
                f"[{idx + 1}/{total}] "
                f"{english_name} "
                f"-> "
                f"{chinese_name}"
            )

            # 定时保存
            if idx % SAVE_EVERY == 0:
                df.to_excel(OUTPUT_FILE, index=False)
                print(f"已自动保存: {OUTPUT_FILE}")

        except Exception as e:

            print(
                f"[失败] 第 {idx + 1} 条\n"
                f"名称: {english_name}\n"
                f"原因: {e}\n"
            )

    # 最终保存
    df.to_excel(OUTPUT_FILE, index=False)

    print("\n===================================")
    print("全部处理完成")
    print(f"输出文件: {OUTPUT_FILE}")
    print("===================================")


# =========================================================

if __name__ == "__main__":
    main()