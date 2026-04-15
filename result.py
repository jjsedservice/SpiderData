import pandas as pd
import numpy as np
from math import radians, cos, sin, asin, sqrt
import os

# 1. 定义计算函数：哈弗辛公式（计算经纬度间的球面距离）
def haversine(lon1, lat1, lon2, lat2):
    """
    计算两点之间的球面距离（单位：公里）
    """
    # 将十进制度数转化为弧度
    lon1, lat1, lon2, lat2 = map(radians, [float(lon1), float(lat1), float(lon2), float(lat2)])
    
    # haversine 公式
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    r = 6371 # 地球平均半径，单位为公里
    return c * r

def process_data():
    # 检查文件是否存在
    required_files = ['场站.csv', '风电识别数据_导出.csv', '光伏识别数据_导出.csv']
    for f in required_files:
        if not os.path.exists(f):
            print(f"错误：未找到文件 {f}，请确保该脚本与 CSV 文件在同一目录下。")
            return

    print("正在读取数据...")
    stations = pd.read_csv('场站.csv')
    wind_data = pd.read_csv('风电识别数据_导出.csv')
    solar_data = pd.read_csv('光伏识别数据_导出.csv')

    def assign_stations(device_df, device_label, station_type_keyword, threshold):
        results = []
        # 筛选对应类型的场站（例如：只在“风电”场站里找风机归属）
        target_stations = stations[stations['发电类型'].str.contains(station_type_keyword, na=False)]
        
        print(f"正在处理 {device_label} 数据关联 (阈值: {threshold}km)...")
        
        for _, dev in device_df.iterrows():
            min_dist = float('inf')
            best_station = "零星"
            reason = f"在{threshold}km范围内未匹配到对应场站"
            
            # 遍历场站寻找最近点
            for _, st in target_stations.iterrows():
                try:
                    dist = haversine(dev['经度'], dev['纬度'], st['经度'], st['纬度'])
                    if dist < min_dist:
                        min_dist = dist
                        # 只有在阈值范围内的才记录场站名
                        if dist <= threshold:
                            best_station = st['站点名称']
                            reason = f"距离最近(约 {dist:.2f} km)"
                except Exception:
                    continue
            
            results.append({
                '原始图片': dev.get('原始图片', 'N/A'),
                '设备类型': device_label,
                '经度': dev['经度'],
                '纬度': dev['纬度'],
                '匹配场站': best_station,
                '最近距离_km': round(min_dist, 2) if min_dist != float('inf') else "N/A",
                '关联依据': reason
            })
        return results

    # 2. 执行关联逻辑
    # 风机匹配“风电”类型场站，阈值15km
    wind_results = assign_stations(wind_data, '风机', '风电', 15)
    
    # 光伏匹配“太阳能”类型场站，阈值5km
    solar_results = assign_stations(solar_data, '光伏', '太阳能', 5)

    # 3. 合并结果并导出
    final_results = pd.DataFrame(wind_results + solar_results)
    
    output_filename = '场站设备归属关联结果.csv'
    # 使用 utf-8-sig 编码以确保 Excel 打开时不乱码
    final_results.to_csv(output_filename, index=False, encoding='utf-8-sig')
    
    print("-" * 30)
    print(f"关联完成！")
    print(f"总处理设备数: {len(final_results)}")
    print(f"成功关联场站数: {len(final_results[final_results['匹配场站'] != '零星'])}")
    print(f"零星点位数: {len(final_results[final_results['匹配场站'] == '零星'])}")
    print(f"结果已保存至: {os.getcwd()}\\{output_filename}")

if __name__ == "__main__":
    process_data()