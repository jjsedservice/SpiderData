import { NextResponse } from "next/server";

const templateMap = {
    "power-fields": {
        downloadName: "电场数据导入模板.csv",
        header: [
            "地区",
            "社会统一信用代码",
            "企业名称",
            "发电类型",
            "装机容量",
            "更新时间",
            "主体名称",
            "站点名称",
            "括号补充信息",
            "原始地址片段",
            "标准化地址",
            "省",
            "市州",
            "区县",
            "乡镇街道",
            "村社区",
            "组社",
            "门牌号",
            "地址来源",
            "查询地址",
            "经度",
            "纬度",
            "定位级别",
            "经纬度可信度",
            "地理编码状态",
            "地理编码消息",
        ],
        sample: [
            "云南",
            "91532328067105915E",
            "三峡新能源元谋发电有限公司_天子山",
            "太阳能发电",
            "2",
            "2026/3/31 13:36",
            "三峡新能源元谋发电有限公司",
            "天子山",
            "",
            "天子山",
            "云南省天子山",
            "云南省",
            "",
            "",
            "",
            "",
            "",
            "",
            "站点名",
            "云南省天子山",
            "99.214841",
            "26.077895",
            "standard",
            "0.95",
            "success",
            "ok",
        ],
    },
    "solar-recognition": {
        downloadName: "光伏识别数据导入模板.csv",
        header: ["Tile_Name", "Longitude", "Latitude", "Empty_Column", "Province", "City_County", "poi"],
        sample: ["102602_56756.jpg", "101.80618286132812", "23.431749035651656", "", "yunnan", "个旧市", "鸡街镇"],
    },
    "wind-recognition": {
        downloadName: "风电识别数据导入模板.csv",
        header: ["original_image", "turbine_lon", "turbine_lat", "province", "city", "poi"],
        sample: ["102973_55782.jpg", "102.82523", "25.861921", "yunnan", "昆明市", "剑角峰"],
    },
} as const;

function toCsvLine(values: string[]) {
    return values
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",");
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as keyof typeof templateMap | null;

    if (!type || !templateMap[type]) {
        return NextResponse.json({ ok: false, message: "不支持的模板类型" }, { status: 400 });
    }

    const template = templateMap[type];
    const content = `\uFEFF${toCsvLine([...template.header])}\n${toCsvLine([...template.sample])}\n`;

    return new NextResponse(content, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.downloadName)}`,
        },
    });
}
