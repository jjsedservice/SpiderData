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

def match_stations_with_weighted_logic(known_xlsx, company_csv, best_max_dist=100, dist_weight=0.7):
    # 1. 加载数据
    print(f"正在加载数据...")
    p_df = pd.read_excel(known_xlsx) 
    
    try:
        c_df_raw = pd.read_csv(company_csv, encoding='utf-8-sig')
    except:
        c_df_raw = pd.read_csv(company_csv, encoding='gbk')

    # 预处理
    c_df = c_df_raw[c_df_raw['发电类型'].str.contains('风电', na=False)].copy()
    c_df = c_df.dropna(subset=['经度', '纬度'])
    c_df['装机容量'] = c_df['装机容量'].astype(float)

    cap_weight = 1.0 - dist_weight
    scan_range = np.arange(10, 205, 5)
    match_counts = []
    
    print(f"开始距离权重扫描 (当前权重比例 - 距离:{dist_weight} : 容量:{round(cap_weight,1)})...")

    # 2. 核心扫描循环
    for m_dist in scan_range:
        all_candidates = []
        for _, p_row in p_df.iterrows():
            p_lat, p_lon = p_row['纬度'], p_row['经度']
            p_name = p_row['调度名称']
            p_cap = p_row['装机'] 
            
            for _, c_row in c_df.iterrows():
                dist = calculate_haversine_distance(p_lon, p_lat, c_row['经度'], c_row['纬度'])
                
                # 距离作为硬门槛
                if dist <= m_dist:
                    act_cap = c_row['装机容量']
                    
                    # 评分逻辑：
                    # 距离得分：1- (d/max_d)，近者得分高
                    # 容量得分：1- (abs_diff/max_val)，接近者得分高
                    dist_score = 1 - (dist / m_dist)
                    cap_score = 1 - abs(p_cap - act_cap) / max(p_cap, act_cap) if max(p_cap, act_cap) > 0 else 0
                    cap_score = max(0, cap_score)
                    
                    total_score = (dist_score * dist_weight) + (cap_score * cap_weight)
                    
                    all_candidates.append({
                        "p_id": p_name, 
                        "c_id": f"{c_row['企业名称']}_{c_row['站点名称']}",
                        "score": total_score, 
                        "data": {
                            "已知场站": p_name,
                            "匹配台账企业": c_row['企业名称'],
                            "台账站点名称": c_row['站点名称'],
                            "距离_km": round(dist, 2),
                            "已知容量": p_cap,
                            "台账容量": act_cap,
                            "容量差异": round(abs(p_cap - act_cap), 2),
                            "综合得分": round(total_score, 4)
                        }
                    })
        
        # 3. 冲突解决：确保一对一全局最优
        if all_candidates:
            temp_df = pd.DataFrame(all_candidates).sort_values(by="score", ascending=False)
            used_p, used_c, current_matches = set(), set(), []
            for _, row in temp_df.iterrows():
                if row['p_id'] not in used_p and row['c_id'] not in used_c:
                    current_matches.append(row['data'])
                    used_p.add(row['p_id'])
                    used_c.add(row['c_id'])
            match_counts.append(len(current_matches))
            
            if m_dist == best_max_dist:
                pd.DataFrame(current_matches).to_csv("known_station_final_match.csv", index=False, encoding='utf-8-sig')
        else:
            match_counts.append(0)

    # 4. 绘图分析
    plt.figure(figsize=(10, 6))
    plt.plot(scan_range, match_counts, marker='o', color='#2E8B57', linewidth=2, label='匹配成功数')
    plt.axvline(x=best_max_dist, color='red', linestyle='--', label=f'建议截止距离: {best_max_dist}km')
    plt.title('基于距离硬约束与容量加权的匹配趋势分析')
    plt.xlabel('最大搜索半径 (km)')
    plt.ylabel('成功匹配站点数')
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend()
    plt.show()

    print(f"分析完成！在 {best_max_dist}km 处，权重 {dist_weight}:{round(cap_weight,1)} 下匹配成功 {len(pd.read_csv('known_station_final_match.csv')) if best_max_dist in scan_range else 0} 个站。")

if __name__ == "__main__":
    # 调用配置
    known_xlsx = "YN_fengdian.xlsx"
    company_csv = "data_geocoded_filtered.csv" 
    
    # 你可以调整 dist_weight。如果觉得位置更可信，调高它；如果觉得容量更准确，调低它。
    match_stations_with_weighted_logic(known_xlsx, company_csv, best_max_dist=100, dist_weight=0.7)