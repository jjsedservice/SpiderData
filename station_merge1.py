import pandas as pd
import numpy as np
from sklearn.cluster import DBSCAN
import matplotlib.pyplot as plt

# 设置绘图支持中文
plt.rcParams['font.sans-serif'] = [
    'PingFang SC', 'Heiti SC', 'STHeiti', 'Arial Unicode MS', 'SimHei', 'DejaVu Sans'
]
plt.rcParams['axes.unicode_minus'] = False

def auto_scan_wind_clusters(input_file, output_file):
    # 1. 加载数据
    try:
        df = pd.read_csv(input_file, encoding='utf-8')
    except UnicodeDecodeError:
        df = pd.read_csv(input_file, encoding='gbk')

    # 提取经纬度并转为弧度
    coords = df[['纬度', '经度']].values
    coords_rad = np.radians(coords)
    kms_per_radian = 6371.0088

    # 2. 设置扫描区间：1.0, 1.5, 2.0 ... 40.0
    distances = np.arange(1.0, 40.5, 0.5)
    cluster_counts = []
    
    print(f"正在全量扫描 1km 到 40km 的聚类方案（共 {len(distances)} 组）...")

    # 3. 循环计算所有方案
    for d in distances:
        eps = d / kms_per_radian
        db = DBSCAN(eps=eps, min_samples=1, algorithm='ball_tree', metric='haversine').fit(coords_rad)
        
        # 记录当前距离下的序号
        col_name_id = f"{d}km_聚类序号"
        df[col_name_id] = db.labels_
        
        # --- 新增修改点：统计并打印数量小于 10 的类 ---
        if d == 10.0:  # 仅针对你关注的10km方案进行打印
            counts = df[col_name_id].value_counts()
            small_clusters = counts[counts < 5]
            print(f"\n[检测] 在 {d}km 方案下，发现 {len(small_clusters)} 个设备数少于5的聚类：")
            for cid, count in small_clusters.items():
                print(f" - 聚类ID: {cid}, 设备数量: {count}")
            print("-" * 30)

        # 计算该方案下的中心点
        centroids = df.groupby(col_name_id)[['经度', '纬度']].mean().reset_index()
        centroids[f"{d}km_聚类中心"] = centroids['经度'].astype(str) + ',' + centroids['纬度'].astype(str)
        
        # 将中心坐标合并回原表
        df = df.merge(centroids[[col_name_id, f"{d}km_聚类中心"]], on=col_name_id, how='left')
        
        # 记录聚类总数用于画图
        cluster_counts.append(len(centroids))

    # 4. 绘制趋势图
    plt.figure(figsize=(12, 6))
    plt.plot(distances, cluster_counts, marker='.', linestyle='-', color='teal')
    plt.title('风机聚类规模随间距参数的变化趋势 (1km - 40km)')
    plt.xlabel('设置间距 (公里)')
    plt.ylabel('生成的聚类总数 (个)')
    plt.grid(True, which='both', linestyle='--', alpha=0.5)
    
    # 标注几个关键点便于观察
    for i in range(0, len(distances), 10): 
        plt.annotate(f"{cluster_counts[i]}", (distances[i], cluster_counts[i]), textcoords="offset points", xytext=(0,10), ha='center')
    
    print("正在显示趋势图，请查看图表后关闭窗口以完成 CSV 保存...")
    plt.show()

    # 5. 保存包含所有方案的 CSV
    df.to_csv(output_file, index=False, encoding='utf-8-sig')
    print(f"所有方案已整合完毕！")

if __name__ == "__main__":
    input_csv = "风电识别数据_导出.csv" 
    output_csv = "风机多方案聚类结果一览.csv"
    auto_scan_wind_clusters(input_csv, output_csv)
