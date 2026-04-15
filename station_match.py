import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# 设置绘图支持中文
plt.rcParams['font.sans-serif'] = ['SimHei'] 
plt.rcParams['axes.unicode_minus'] = False

def calculate_haversine_distance(lon1, lat1, lon2, lat2):
    """计算两点间的大圆距离(km)"""
    lon1, lat1, lon2, lat2 = map(np.radians, [float(lon1), float(lat1), float(lon2), float(lat2)])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return 6371 * c

def match_stations_with_scan_result(scan_csv, company_csv, target_dist="10.0km", best_max_dist=20):
    # 1. 数据准备 (仅执行一次)
    print(f"正在准备基础数据...")
    full_df = pd.read_csv(scan_csv)
    id_col = f"{target_dist}_聚类序号"
    center_col = f"{target_dist}_聚类中心"
    
    p_summary = full_df.groupby(id_col).agg({
        '纬度': 'mean', '经度': 'mean', center_col: 'first'
    }).reset_index()
    counts = full_df[id_col].value_counts().reset_index()
    counts.columns = [id_col, '风机数量']
    p_df = p_summary.merge(counts, on=id_col)

    try:
        c_df_raw = pd.read_csv(company_csv, encoding='utf-8-sig')
    except:
        c_df_raw = pd.read_csv(company_csv, encoding='gbk')

    c_df = c_df_raw[c_df_raw['发电类型'].str.contains('风电', na=False)].copy()
    c_df = c_df.dropna(subset=['经度', '纬度'])
    c_df['装机容量'] = c_df['装机容量'].astype(float)

    # 2. 扫描匹配距离 (10km - 150km)
    scan_range = np.arange(10, 200, 5)
    match_counts = []
    
    print(f"开始扫描匹配距离阈值...")
    for m_dist in scan_range:
        all_candidates = []
        for _, p_row in p_df.iterrows():
            p_lat, p_lon = p_row['纬度'], p_row['经度']
            for _, c_row in c_df.iterrows():
                dist = calculate_haversine_distance(p_lon, p_lat, c_row['经度'], c_row['纬度'])
                if dist <= m_dist:
                    est_cap = p_row['风机数量'] * 3.0
                    act_cap = c_row['装机容量']
                    cap_score = 1 - abs(est_cap - act_cap) / max(est_cap, act_cap) if max(est_cap, act_cap) > 0 else 0
                    dist_score = 1 - (dist / m_dist)
                    total_score = (dist_score * 0.7) + (cap_score * 0.3)
                    all_candidates.append({
                        "p_id": p_row[id_col], "c_id": f"{c_row['企业名称']}_{c_row['站点名称']}",
                        "score": total_score, "data": {
                            "聚类序号": p_row[id_col], "风机数量": p_row['风机数量'],
                            "物理中心": p_row[center_col], "企业名称": c_row['企业名称'],
                            "主体名称": c_row['主体名称'], "站点名称": c_row['站点名称'],
                            "台账容量": act_cap, "预估容量": round(est_cap, 2),
                            "距离_km": round(dist, 2), "综合得分": round(total_score, 4)
                        }
                    })
        
        # 冲突解决
        if all_candidates:
            temp_df = pd.DataFrame(all_candidates).sort_values(by="score", ascending=False)
            used_p, used_c, current_matches = set(), set(), []
            for _, row in temp_df.iterrows():
                if row['p_id'] not in used_p and row['c_id'] not in used_c:
                    current_matches.append(row['data'])
                    used_p.add(row['p_id'])
                    used_c.add(row['c_id'])
            match_counts.append(len(current_matches))
            
            # 如果是用户指定的最佳距离，保存结果
            if m_dist == best_max_dist:
                pd.DataFrame(current_matches).to_csv("final_matching_results.csv", index=False, encoding='utf-8-sig')
        else:
            match_counts.append(0)

    # 3. 绘制分析图
    plt.figure(figsize=(10, 6))
    plt.plot(scan_range, match_counts, marker='s', color='darkorange', linewidth=2)
    plt.axvline(x=best_max_dist, color='red', linestyle='--', label=f'当前设定距离: {best_max_dist}km')
    plt.title(f'匹配成功数量随最大搜索距离的变化 ({target_dist} 聚类)')
    plt.xlabel('最大搜索距离阈值 (max_dist_km)')
    plt.ylabel('唯一匹配成功的电站数量')
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.show()

    print(f"扫描完毕。当前 {best_max_dist}km 匹配到 {match_counts[list(scan_range).index(best_max_dist)]} 个电站。")

if __name__ == "__main__":
    scan_file = "风机多方案聚类结果一览.csv"
    company_file = "data_geocoded_filtered.csv" 
    
    # 填入你根据图表认为最合适的 max_dist_km 重新运行可保存结果
    match_stations_with_scan_result(scan_file, company_file, target_dist="17.0km", best_max_dist=100)