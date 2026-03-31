import argparse
import csv
import re
from pathlib import Path


SOURCE_COLUMNS = ['地区', '社会统一信用代码', '企业名称', '发电类型', '装机容量', '更新时间']
OUTPUT_COLUMNS = SOURCE_COLUMNS + [
    '主体名称',
    '站点名称',
    '括号补充信息',
    '原始地址片段',
    '标准化地址',
    '省',
    '市州',
    '区县',
    '乡镇街道',
    '村社区',
    '组社',
    '门牌号',
    '地址来源',
]

PROVINCE_MAP = {
    '云南': '云南省',
    '浙江': '浙江省',
}

CITY_SUFFIXES = ('自治州', '地区', '盟', '市')
COUNTY_SUFFIXES = ('自治县', '林区', '区', '县', '市', '旗')
TOWN_SUFFIXES = ('街道', '镇', '乡', '苏木')
VILLAGE_SUFFIXES = ('村委会', '社区', '行政村', '村', '居委会')
GROUP_SUFFIXES = ('村民小组', '居民小组', '联组', '组', '社', '队', '寨')
NOISE_PATTERNS = [
    r'\d+(?:\.\d+)?\s*(?:kv|kva|v)',
    r'屋顶分布式光伏项目',
    r'分布式光伏项目',
    r'分布式光伏',
    r'光伏发电项目',
    r'光伏项目',
    r'光伏电站',
    r'发电项目',
    r'屋顶',
    r'房顶',
]
YUNNAN_COUNTY_HINTS = {
    '弥渡': '弥渡县',
    '宾川': '宾川县',
    '富民': '富民县',
    '宣威': '宣威市',
    '丘北': '丘北县',
    '建水': '建水县',
    '师宗': '师宗县',
    '峨山': '峨山彝族自治县',
    '易门': '易门县',
    '陆良': '陆良县',
    '元谋': '元谋县',
    '大姚': '大姚县',
    '永仁': '永仁县',
    '禄劝': '禄劝彝族苗族自治县',
    '兰坪': '兰坪白族普米族自治县',
    '云县': '云县',
    '文山': '文山市',
    '石林': '石林彝族自治县',
    '华坪': '华坪县',
    '沾益': '沾益区',
    '鹤庆': '鹤庆县',
    '江川': '江川区',
}


def clean_text(value):
    if value is None:
        return ''
    text = str(value).strip()
    if not text:
        return ''
    return re.sub(r'\s+', '', text)


def extract_parenthetical_segments(text):
    if not text:
        return []
    return [segment.strip() for segment in re.findall(r'[（(]([^()（）]+)[）)]', text) if segment.strip()]


def split_company_name(name):
    normalized_name = clean_text(name)
    if not normalized_name:
        return '', ''

    base_name = re.sub(r'[（(][^()（）]+[）)]', '', normalized_name).strip()
    if '_' in base_name:
        parts = [part.strip() for part in base_name.split('_', 1)]
        return parts[0], parts[1]
    return base_name, ''


def choose_raw_address(name, site_name, paren_segments):
    for segment in paren_segments:
        if has_address_signal(segment):
            return segment, '括号'

    if has_address_signal(site_name):
        return site_name, '站点名'

    if site_name:
        return site_name, '站点名'

    if paren_segments:
        return '；'.join(paren_segments), '括号补充'

    return site_name or '', '站点名' if site_name else ''


def has_address_signal(text):
    if not text:
        return False
    signals = ('省', '市', '州', '县', '区', '镇', '乡', '街道', '村', '社区', '社', '组', '队', '寨', '号')
    return any(signal in text for signal in signals)


def remove_noise_tokens(text):
    cleaned = clean_text(text)
    if not cleaned:
        return ''

    for pattern in NOISE_PATTERNS:
        cleaned = re.sub(pattern, '', cleaned, flags=re.I)

    cleaned = re.sub(r'[、，,;；]+', ' ', cleaned)
    cleaned = re.sub(r'\s+', '', cleaned)
    return cleaned


def normalize_county_hint(region, text):
    if clean_text(region) != '云南':
        return text

    normalized = text
    for short_name, full_name in YUNNAN_COUNTY_HINTS.items():
        if short_name in normalized and full_name not in normalized:
            normalized = normalized.replace(short_name, full_name, 1)
            break
    return normalized


def extract_known_yunnan_county(text):
    cleaned = clean_text(text)
    for _, full_name in YUNNAN_COUNTY_HINTS.items():
        if full_name in cleaned:
            remaining = cleaned.replace(full_name, '', 1)
            return full_name, remaining
    return '', cleaned


def extract_segment_by_suffix(text, suffixes):
    cleaned = clean_text(text)
    if not cleaned:
        return '', cleaned

    best_match = ''
    for suffix in suffixes:
        pattern = rf'[\u4e00-\u9fa5A-Za-z0-9]+?{re.escape(suffix)}'
        match = re.search(pattern, cleaned)
        if match and len(match.group(0)) > len(best_match):
            best_match = match.group(0)

    if not best_match:
        return '', cleaned

    remaining = cleaned.replace(best_match, '', 1)
    return best_match, remaining


def extract_first_segment(text, suffixes):
    if not text:
        return '', text
    best_match = ''
    for suffix in suffixes:
        pattern = rf'[^，,;；（）()_]*?{re.escape(suffix)}'
        match = re.search(pattern, text)
        if match and len(match.group(0)) > len(best_match):
            best_match = match.group(0)
    if not best_match:
        return '', text
    remaining = text.replace(best_match, '', 1)
    return best_match, remaining


def extract_house_number(text):
    if not text:
        return '', text
    match = re.search(r'(\d+(?:-\d+)?号)', text)
    if not match:
        return '', text
    number = match.group(1)
    remaining = text.replace(number, '', 1)
    return number, remaining


def normalize_address_parts(region, raw_address, subject_name, site_name):
    province = PROVINCE_MAP.get(clean_text(region), '')
    working_text = normalize_county_hint(region, remove_noise_tokens(raw_address))
    fallback_text = clean_text(subject_name)
    fallback_remainder = fallback_text

    city = ''
    county = ''
    town = ''
    village = ''
    group_name = ''
    house_number = ''

    if province and working_text.startswith(province):
        working_text = working_text[len(province):]
    if province and fallback_text.startswith(province):
        fallback_text = fallback_text[len(province):]
        fallback_remainder = fallback_text

    if clean_text(region) == '云南':
        county, remainder = extract_known_yunnan_county(working_text)
    else:
        remainder = working_text

    city, remainder = extract_segment_by_suffix(remainder, CITY_SUFFIXES)
    if not city:
        city, fallback_remainder = extract_segment_by_suffix(fallback_text, CITY_SUFFIXES)
    else:
        fallback_remainder = fallback_text

    if not county:
        county, remainder = extract_segment_by_suffix(remainder, COUNTY_SUFFIXES)
    if not county:
        county, fallback_remainder = extract_segment_by_suffix(fallback_remainder, COUNTY_SUFFIXES)

    town, remainder = extract_segment_by_suffix(remainder, TOWN_SUFFIXES)
    village, remainder = extract_segment_by_suffix(remainder, VILLAGE_SUFFIXES)
    group_name, remainder = extract_segment_by_suffix(remainder, GROUP_SUFFIXES)
    house_number, remainder = extract_house_number(remainder)

    if not city:
        city, fallback_remainder = extract_segment_by_suffix(fallback_text, CITY_SUFFIXES)
    if not county:
        county, fallback_remainder = extract_segment_by_suffix(fallback_remainder, COUNTY_SUFFIXES)
    if not town:
        town, fallback_remainder = extract_segment_by_suffix(fallback_remainder, TOWN_SUFFIXES)
    if not village:
        village, fallback_remainder = extract_segment_by_suffix(fallback_remainder, VILLAGE_SUFFIXES)

    if city and county and city == county:
        county = ''

    remainder = remove_noise_tokens(remainder.strip('，,;；、'))

    if not village and site_name and has_address_signal(site_name):
        village = remove_noise_tokens(site_name)

    standard_address_parts = [part for part in [province, city, county, town, village, group_name, house_number] if part]
    if not standard_address_parts and raw_address:
        standard_address_parts.append(normalize_county_hint(region, remove_noise_tokens(raw_address)))
    if remainder:
        standard_address_parts.append(remainder)

    return {
        '省': province,
        '市州': city,
        '区县': county,
        '乡镇街道': town,
        '村社区': village,
        '组社': group_name,
        '门牌号': house_number,
        '标准化地址': ''.join(standard_address_parts),
    }


def transform_row(row):
    company_name = clean_text(row.get('企业名称'))
    subject_name, site_name = split_company_name(company_name)
    paren_segments = extract_parenthetical_segments(company_name)
    raw_address, address_source = choose_raw_address(company_name, site_name, paren_segments)
    address_parts = normalize_address_parts(row.get('地区', ''), raw_address, subject_name, site_name)

    transformed = {column: row.get(column, '') for column in SOURCE_COLUMNS}
    transformed.update({
        '主体名称': subject_name,
        '站点名称': site_name,
        '括号补充信息': '；'.join(paren_segments),
        '原始地址片段': raw_address,
        '地址来源': address_source,
    })
    transformed.update(address_parts)
    return transformed


def standardize_csv(input_path, output_path):
    with input_path.open('r', encoding='utf-8-sig', newline='') as infile:
        reader = csv.DictReader(infile)
        with output_path.open('w', encoding='utf-8-sig', newline='') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=OUTPUT_COLUMNS)
            writer.writeheader()
            for row in reader:
                writer.writerow(transform_row(row))


def main():
    parser = argparse.ArgumentParser(description='对 data.csv 做地址抽取与标准化，输出结构化 CSV。')
    parser.add_argument(
        '--input',
        default='data.csv',
        help='输入 CSV 路径，默认 data.csv'
    )
    parser.add_argument(
        '--output',
        default='data_structured.csv',
        help='输出 CSV 路径，默认 data_structured.csv'
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(f'找不到输入文件: {input_path}')

    standardize_csv(input_path, output_path)
    print(f'已生成结构化地址文件: {output_path}')


if __name__ == '__main__':
    main()
