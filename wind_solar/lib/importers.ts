import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { escapeSql, getDatabase } from "@/lib/db";
import { createImportJob, updateImportJob } from "@/lib/import-jobs";
import { readSettings } from "@/lib/settings";

type ImportType = "power-fields" | "solar-recognition" | "wind-recognition";

const provinceMap: Record<string, string> = {
    yunnan: "云南省",
};

const importSchemas: Record<
    ImportType,
    {
        headers: string[];
        requiredFields: string[];
    }
> = {
    "power-fields": {
        headers: [
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
        requiredFields: ["企业名称"],
    },
    "solar-recognition": {
        headers: ["Tile_Name", "Longitude", "Latitude", "Empty_Column", "Province", "City_County"],
        requiredFields: ["Tile_Name", "Longitude", "Latitude", "Province", "City_County"],
    },
    "wind-recognition": {
        headers: ["original_image", "turbine_lon", "turbine_lat", "province", "city"],
        requiredFields: ["original_image", "turbine_lon", "turbine_lat", "province", "city"],
    },
};

function decodeCsv(buffer: Buffer) {
    const text = buffer.toString("utf-8").replace(/^\uFEFF/, "");
    return parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }) as Record<string, string>[];
}

async function collectImageNames(relativeDir: string) {
    const root = path.join(process.cwd(), "assets", relativeDir);
    const names = new Set<string>();

    async function walk(current: string): Promise<void> {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".")) {
                continue;
            }
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(target);
            } else {
                names.add(entry.name);
            }
        }
    }

    await walk(root);
    return names;
}

function toNumberValue(value: string | undefined) {
    const normalized = (value ?? "").trim();
    if (!normalized) {
        return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

async function importPowerFields(rows: Record<string, string>[], jobId: string) {
    const { db, persist } = await getDatabase();

    db.run("BEGIN TRANSACTION");

    for (const [index, row] of rows.entries()) {
        db.run(`
            INSERT INTO power_fields (
                enterprise_name, subject_name, site_name, power_type, capacity, longitude, latitude, supplement,
                raw_address, standardized_address, province, city, district, town, village,
                group_name, confidence, updated_at
            ) VALUES (
                '${escapeSql(row["企业名称"] ?? "")}',
                '${escapeSql(row["主体名称"] ?? "")}',
                '${escapeSql(row["站点名称"] ?? "")}',
                '${escapeSql(row["发电类型"] ?? "")}',
                '${escapeSql(row["装机容量"] ?? "")}',
                '${escapeSql(row["经度"] ?? "")}',
                '${escapeSql(row["纬度"] ?? "")}',
                '${escapeSql(row["括号补充信息"] ?? "")}',
                '${escapeSql(row["原始地址片段"] ?? "")}',
                '${escapeSql(row["标准化地址"] ?? "")}',
                '${escapeSql(row["省"] ?? "")}',
                '${escapeSql(row["市州"] ?? "")}',
                '${escapeSql(row["区县"] ?? "")}',
                '${escapeSql(row["乡镇街道"] ?? "")}',
                '${escapeSql(row["村社区"] ?? "")}',
                '${escapeSql(row["组社"] ?? "")}',
                ${toNumberValue(row["经纬度可信度"]) ?? 0},
                CURRENT_TIMESTAMP
            )
            ON CONFLICT(enterprise_name) DO UPDATE SET
                subject_name=excluded.subject_name,
                site_name=excluded.site_name,
                power_type=excluded.power_type,
                capacity=excluded.capacity,
                longitude=excluded.longitude,
                latitude=excluded.latitude,
                supplement=excluded.supplement,
                raw_address=excluded.raw_address,
                standardized_address=excluded.standardized_address,
                province=excluded.province,
                city=excluded.city,
                district=excluded.district,
                town=excluded.town,
                village=excluded.village,
                group_name=excluded.group_name,
                confidence=excluded.confidence,
                updated_at=CURRENT_TIMESTAMP
        `);
        updateImportJob(jobId, { processed: index + 1, status: "running" });
    }
    db.run("COMMIT");
    await persist();
}

async function importRecognition(
    rows: Record<string, string>[],
    jobId: string,
    type: "solar-recognition" | "wind-recognition",
) {
    const { db, persist } = await getDatabase();
    const settings = await readSettings();
    const tableName = type === "solar-recognition" ? "solar_recognition" : "wind_recognition";
    const imageDir =
        type === "solar-recognition" ? settings.solarImageDir : settings.windImageDir;
    const imageNames = await collectImageNames(imageDir);
    db.run("BEGIN TRANSACTION");

    for (const [index, row] of rows.entries()) {
        const originalImage =
            type === "solar-recognition" ? row["Tile_Name"] ?? "" : row["original_image"] ?? "";
        const provinceCode =
            type === "solar-recognition" ? row["Province"] ?? "" : row["province"] ?? "";
        db.run(`
            INSERT INTO ${tableName} (
                original_image, province_code, province_name, city, longitude, latitude, image_exists, updated_at
            ) VALUES (
                '${escapeSql(originalImage)}',
                '${escapeSql(provinceCode)}',
                '${escapeSql(provinceMap[provinceCode.toLowerCase()] ?? provinceCode)}',
                '${escapeSql(type === "solar-recognition" ? row["City_County"] ?? "" : row["city"] ?? "")}',
                '${escapeSql(type === "solar-recognition" ? row["Longitude"] ?? "" : row["turbine_lon"] ?? "")}',
                '${escapeSql(type === "solar-recognition" ? row["Latitude"] ?? "" : row["turbine_lat"] ?? "")}',
                ${imageNames.has(originalImage) ? 1 : 0},
                CURRENT_TIMESTAMP
            )
            ON CONFLICT(original_image) DO UPDATE SET
                province_code=excluded.province_code,
                province_name=excluded.province_name,
                city=excluded.city,
                longitude=excluded.longitude,
                latitude=excluded.latitude,
                image_exists=excluded.image_exists,
                updated_at=CURRENT_TIMESTAMP
        `);
        updateImportJob(jobId, { processed: index + 1, status: "running" });
    }
    db.run("COMMIT");
    await persist();
}

export async function startImport(type: ImportType, buffer: Buffer) {
    const rows = decodeCsv(buffer);
    const schema = importSchemas[type];
    const rowHeaders = rows[0] ? Object.keys(rows[0]) : [];
    const missingHeaders = schema.headers.filter((header) => !rowHeaders.includes(header));

    if (!rows.length) {
        throw new Error("导入文件没有可导入的数据行");
    }
    if (missingHeaders.length) {
        throw new Error(`导入文件格式不正确，缺少字段: ${missingHeaders.join("、")}`);
    }

    for (const [index, row] of rows.entries()) {
        const emptyField = schema.requiredFields.find(
            (field) => !String(row[field] ?? "").trim(),
        );
        if (emptyField) {
            throw new Error(`第 ${index + 1} 行缺少必填字段: ${emptyField}`);
        }
    }

    const job = createImportJob(type, rows.length);

    queueMicrotask(async () => {
        try {
            updateImportJob(job.id, { status: "running", processed: 0 });
            if (type === "power-fields") {
                await importPowerFields(rows, job.id);
            } else {
                await importRecognition(rows, job.id, type);
            }
            updateImportJob(job.id, { status: "completed", processed: rows.length });
        } catch (error) {
            updateImportJob(job.id, {
                status: "failed",
                error: error instanceof Error ? error.message : "导入失败",
            });
        }
    });

    return job;
}
