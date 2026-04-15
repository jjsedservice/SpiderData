import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# 设置绘图支持中文
plt.rcParams['font.sans-serif'] = ['SimHei'] 
plt.rcParams['axes.unicode_minus'] = False

def calculate_haversine_distance(lon1, lat1, lon2, lat2):
    """计算大圆距离(km)"""
    lon1, lat1, lon2, lat2 = map(np.radians, [float(lon1), float(lat1), float(lon2), float(lat2)])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return 6371 * c

def match_satellite_vs_known(scan_csv, known_xlsx, target_dist="10.0km", test_max_dist=10):
    # 1. 提取卫星聚类中心 (82个点)
    print("提取卫星识别聚类中心数据...")
    full_df = pd.read_csv(scan_csv)
    id_col = f"{target_dist}_聚类序号"
    center_col = f"{target_dist}_聚类中心"
    
    p_df = full_df.groupby(id_col).agg({
        '纬度': 'mean', '经度': 'mean'
    }).reset_index()

    # 2. 读取已知场站坐标 (YN_fengdian.xlsx)
    print(f"读取已知场站数据: {known_xlsx}...")
    k_df = pd.read_excel(known_xlsx)

    # 3. 扫描匹配距离 (1km - 50km)
    # 既然是识别准确度测试，步长缩短到 1km 以观察精细变化
    scan_range = np.arange(1, 51, 1) 
    match_counts = []
    
    print("开始空间位置匹配扫描...")
    for m_dist in scan_range:
        all_candidates = []
        for _, p_row in p_df.iterrows():
            p_lat, p_lon = p_row['纬度'], p_row['经度']
            
            for _, k_row in k_df.iterrows():
                dist = calculate_haversine_distance(p_lon, p_lat, k_row['经度'], k_row['纬度'])
                
                if dist <= m_dist:
                    # 纯距离匹配：得分仅由距离决定
                    score = 1 - (dist / m_dist)
                    all_candidates.append({
                        "p_id": p_row[id_col],
                        "k_id": k_row['调度名称'],
                        "score": score,
                        "dist": dist,
                        "data": {
                            "聚类序号": p_row[id_col],
                            "识别中心坐标": f"{round(p_lon,4)},{round(p_lat,4)}",
                            "已知场站名称": k_row['调度名称'],
                            "已知坐标": f"{k_row['经度']},{k_row['纬度']}",
                            "偏差距离_km": round(dist, 3)
                        }
                    })
        
        # 4. 唯一性冲突解决 (保证每个识别点只匹配最近的已知点)
        if all_candidates:
            temp_df = pd.DataFrame(all_candidates).sort_values(by="score", ascending=False)
            used_p, used_k, current_matches = set(), set(), []
            for _, row in temp_df.iterrows():
                if row['p_id'] not in used_p and row['k_id'] not in used_k:
                    current_matches.append(row['data'])
                    used_p.add(row['p_id'])
                    used_k.add(row['k_id'])
            match_counts.append(len(current_matches))
            
            # 保存指定距离的结果
            if m_dist == test_max_dist:
                pd.DataFrame(current_matches).to_csv("sat_vs_known_direct_match.csv", index=False, encoding='utf-8-sig')
        else:
            match_counts.append(0)

    # 5. 绘制曲线
    plt.figure(figsize=(10, 6))
    plt.plot(scan_range, match_counts, marker='o', color='#E67E22', linewidth=2)
    plt.axvline(x=test_max_dist, color='red', linestyle='--', label=f'测试参考距离: {test_max_dist}km')
    plt.title(f'卫星识别中心与已知场站的匹配曲线 ({target_dist} 方案)')
    plt.xlabel('允许的最大空间偏差 (km)')
    plt.ylabel('成功匹配数量')
    plt.grid(True, linestyle=':', alpha=0.5)
    plt.legend()
    plt.show()

    best_idx = np.argmax(match_counts)
    print(f"扫描完毕！")
    print(f"当距离达到 {scan_range[best_idx]}km 时，匹配数量达到饱和 ({match_counts[best_idx]} 个)。")

if __name__ == "__main__":
    match_satellite_vs_known(
        scan_csv="风机多方案聚类结果一览.csv", 
        known_xlsx="YN_fengdian.xlsx", 
        target_dist="10.0km", 
        test_max_dist=24 # 卫星识别通常在 5km 内就应匹配上
    )