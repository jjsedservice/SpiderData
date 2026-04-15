import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# 设置绘图支持中文
plt.rcParams['font.sans-serif'] = ['SimHei'] 
plt.rcParams['axes.unicode_minus'] = False

def calculate_haversine_distance(lon1, lat1, lon2, lat2):
    """
    支持向量化运算的距离计算
    lon1/lat1: 可以是单个数值
    lon2/lat2: 可以是 pandas.Series (整列经纬度)
    """
    # 将输入转换为弧度 (直接使用 np.radians，它支持 Series)
    lon1, lat1, lon2, lat2 = map(np.radians, [lon1, lat1, lon2, lat2])
    
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    
    # 地球半径 km
    return 6371.0088 * c

def match_cluster_by_any_turbine_member(scan_csv, known_xlsx, target_dist_str="10.0km", test_max_dist=24):
    # 1. 加载数据
    print(f"读取聚类方案数据: {scan_csv} ...")
    df_turbines = pd.read_csv(scan_csv)
    
    id_col = f"{target_dist_str}_聚类序号"
    if id_col not in df_turbines.columns:
        print(f"错误：在CSV中未找到列名 '{id_col}'")
        return

    print(f"读取已知场站数据: {known_xlsx} ...")
    df_known = pd.read_excel(known_xlsx)
    
    # 2. 准备扫描区间
    scan_range = np.arange(1, 51, 1)
    match_counts = []

    print(f"开始执行向量化“一员触发”匹配逻辑 (阈值扫描 1km - 50km)...")

    # 为了保证计算不报错，确保经纬度列是 float 类型
    df_turbines['经度'] = df_turbines['经度'].astype(float)
    df_turbines['纬度'] = df_turbines['纬度'].astype(float)

    for m_dist in scan_range:
        all_candidates = []
        
        # 遍历每一个已知场站
        for _, k_row in df_known.iterrows():
            k_lat = float(k_row['纬度'])
            k_lon = float(k_row['经度'])
            k_name = k_row['调度名称']
            
            # --- 关键修复点：向量化计算一个点到一整列点的距离 ---
            dists = calculate_haversine_distance(
                k_lon, k_lat, 
                df_turbines['经度'], df_turbines['纬度']
            )
            
            # 筛选出在当前搜索半径 m_dist 内的风机索引
            mask = dists <= m_dist
            
            if mask.any():
                # 提取命中的风机及其所属聚类
                matched_indices = df_turbines.index[mask]
                matched_cluster_ids = df_turbines.loc[matched_indices, id_col]
                matched_dists = dists[mask]
                
                # 构建临时 DataFrame 进行分组取最小值
                temp_match = pd.DataFrame({
                    'cluster_id': matched_cluster_ids,
                    'dist': matched_dists
                })
                
                # 只要该聚类里有风机在范围内，取最近的那台作为代表
                cluster_min = temp_match.groupby('cluster_id')['dist'].min().reset_index()
                
                for _, c_row in cluster_min.iterrows():
                    all_candidates.append({
                        "cluster_id": c_row['cluster_id'],
                        "known_name": k_name,
                        "min_dist": c_row['dist'],
                        "score": 1 - (c_row['dist'] / m_dist)
                    })

        # 3. 冲突解决：一对一全局最优
        if all_candidates:
            temp_df = pd.DataFrame(all_candidates).sort_values(by="score", ascending=False)
            used_clusters = set()
            used_knowns = set()
            final_matches = []
            
            for _, row in temp_df.iterrows():
                if row['cluster_id'] not in used_clusters and row['known_name'] not in used_knowns:
                    final_matches.append(row)
                    used_clusters.add(row['cluster_id'])
                    used_knowns.add(row['known_name'])
            
            match_counts.append(len(final_matches))
            
            if m_dist == test_max_dist:
                pd.DataFrame(final_matches).to_csv("cluster_trigger_match_results.csv", index=False, encoding='utf-8-sig')
        else:
            match_counts.append(0)

    # 4. 绘图
    plt.figure(figsize=(10, 6))
    plt.plot(scan_range, match_counts, marker='D', color='#27AE60', linewidth=2)
    plt.axvline(x=test_max_dist, color='red', linestyle='--')
    plt.title(f'云南地区：聚类成员触发匹配 (方案: {target_dist_str})')
    plt.xlabel('搜索半径 (公里)')
    plt.ylabel('成功匹配的已知场站数')
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.show()

    print(f"分析完成！10.0km聚类配合{test_max_dist}km触发半径，匹配数: {match_counts[list(scan_range).index(test_max_dist)]}")

if __name__ == "__main__":
    match_cluster_by_any_turbine_member(
        scan_csv="风机多方案聚类结果一览.csv", 
        known_xlsx="YN_fengdian.xlsx", 
        target_dist_str="10.0km", 
        test_max_dist=24
    )