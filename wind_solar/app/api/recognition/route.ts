import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { escapeSql, execRows, getDatabase } from "@/lib/db";
import { clearRecognitionImageCache, findRecognitionImage, getRecognitionImageMap } from "@/lib/recognition-images";

const TIANDITU_KEY = "b0955d5fb6e62c7e90a97d8b3fa4a3f5";
const PROVINCE_NAMES = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
    "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
    "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
    "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "香港",
    "澳门", "台湾",
];

function toCsvValue(value: unknown) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function resolveTable(type: string | null) {
    if (type === "solar") {
        return "solar_recognition";
    }
    if (type === "wind") {
        return "wind_recognition";
    }
    throw new Error("不支持的识别数据类型");
}

type RecognitionDbRow = {
    id: number;
    original_image: string;
    province_name: string;
    province_code?: string;
    city: string;
    longitude: string;
    latitude: string;
    area?: string | null;
    capacity?: string | null;
    image_exists: number;
};

function normalizeProvinceName(value: string | null | undefined) {
    return String(value ?? "")
        .trim()
        .replace(/特别行政区$/u, "")
        .replace(/壮族自治区$/u, "")
        .replace(/回族自治区$/u, "")
        .replace(/维吾尔自治区$/u, "")
        .replace(/自治区$/u, "")
        .replace(/省$/u, "")
        .replace(/市$/u, "");
}

function detectProvinceFromText(value: string | null | undefined) {
    const text = String(value ?? "").trim();
    if (!text) {
        return "";
    }

    for (const province of PROVINCE_NAMES) {
        if (text.includes(province)) {
            return province;
        }
    }

    return normalizeProvinceName(text);
}

async function lookupProvinceByTianditu(longitude: number, latitude: number) {
    const postStr = JSON.stringify({
        lon: longitude,
        lat: latitude,
        ver: 1,
    });
    const url = `https://api.tianditu.gov.cn/geocoder?postStr=${encodeURIComponent(postStr)}&type=geocode&tk=${TIANDITU_KEY}`;
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`天地图接口请求失败（${response.status}）`);
    }

    const text = await response.text();
    const payload = JSON.parse(text.replace(/^\uFEFF/u, ""));
    const componentProvince = detectProvinceFromText(
        payload?.result?.addressComponent?.province ??
        payload?.result?.addressComponent?.province_name,
    );

    if (componentProvince) {
        return componentProvince;
    }

    return detectProvinceFromText(
        payload?.result?.formatted_address ??
        payload?.result?.address,
    );
}

async function enrichRecognitionRows(
    type: "solar" | "wind",
    rows: RecognitionDbRow[],
) {
    return Promise.all(
        rows.map(async (row) => {
            const filePath = await findRecognitionImage(type, String(row.original_image));

            return {
                ...row,
                image_url: filePath
                    ? `/api/recognition/image?type=${type}&name=${encodeURIComponent(String(row.original_image))}`
                    : null,
            };
        }),
    );
}

export async function GET(request: Request) {
    try {
        const { db } = await getDatabase();
        const { searchParams } = new URL(request.url);
        const table = resolveTable(searchParams.get("type"));
        const type = searchParams.get("type") as "solar" | "wind";
        const page = Number(searchParams.get("page") ?? "1");
        const pageSize = Number(searchParams.get("pageSize") ?? "10");
        const province = (searchParams.get("province") ?? "").trim();
        const unlinkedOnly = searchParams.get("unlinkedOnly") === "true";
        const format = (searchParams.get("format") ?? "").trim();

        const clauses: string[] = [];
        const params: Record<string, unknown> = {};
        if (province) {
            clauses.push("(province_name LIKE @province OR province_code LIKE @province)");
            params.province = `%${province}%`;
        }

        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const resolvedWhere = where.replace(
            /@province/g,
            `'${escapeSql(String(params.province ?? ""))}'`,
        );
        const rows = execRows<RecognitionDbRow>(
            db,
            `SELECT * FROM ${table} ${resolvedWhere} ORDER BY id DESC`,
        );
        const enrichedRows = await enrichRecognitionRows(type, rows);
        const filteredRows = unlinkedOnly
            ? enrichedRows.filter((row) => !row.image_url)
            : enrichedRows;

        if (format === "csv") {
            const lines = [
                (
                    type === "solar"
                        ? ["原始图片", "省", "市", "经度", "纬度", "面积", "容量"]
                        : ["原始图片", "省", "市", "经度", "纬度"]
                ).map(toCsvValue).join(","),
                ...filteredRows.map((row) =>
                    (
                        type === "solar"
                            ? [
                                row.original_image,
                                row.province_name,
                                row.city,
                                row.longitude,
                                row.latitude,
                                row.area ?? "",
                                row.capacity ?? "",
                            ]
                            : [
                                row.original_image,
                                row.province_name,
                                row.city,
                                row.longitude,
                                row.latitude,
                            ]
                    )
                        .map(toCsvValue)
                        .join(","),
                ),
            ];
            const filePrefix = type === "solar" ? "光伏识别数据" : "风电识别数据";

            return new Response(`\uFEFF${lines.join("\n")}`, {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filePrefix}_导出.csv`)}`,
                },
            });
        }

        const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

        return NextResponse.json({ ok: true, rows: pagedRows, total: filteredRows.length });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "查询失败" },
            { status: 400 },
        );
    }
}

export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const { db, persist } = await getDatabase();
        const table = resolveTable(body.type);

        if (body.mode === "cleanup-images") {
            const type = body.type as "solar" | "wind";
            const rows = execRows<RecognitionDbRow>(
                db,
                `SELECT original_image FROM ${table}`,
            );
            const validNames = new Set(rows.map((row) => String(row.original_image)));
            const { map } = await getRecognitionImageMap(type);
            let deletedCount = 0;

            for (const [fileName, filePath] of map.entries()) {
                if (validNames.has(fileName)) {
                    continue;
                }

                await fs.unlink(filePath).catch(() => undefined);
                deletedCount += 1;
            }

            await clearRecognitionImageCache(type);
            return NextResponse.json({
                ok: true,
                deletedCount,
                message: deletedCount > 0 ? `已删除 ${deletedCount} 张未关联图片` : "没有可删除的未关联图片",
            });
        }

        if (body.mode === "all") {
            db.run(`DELETE FROM ${table}`);
            await persist();
            return NextResponse.json({ ok: true });
        }

        if (body.mode === "single") {
            db.run(`DELETE FROM ${table} WHERE id = ${Number(body.id ?? 0)}`);
            await persist();
            return NextResponse.json({ ok: true });
        }

        if (body.mode === "exclude-out-of-province") {
            const recognitionType = body.type as "solar" | "wind";
            if (recognitionType !== "wind" && recognitionType !== "solar") {
                throw new Error("仅支持识别数据排除省外数据");
            }

            const selectedProvince = String(body.province ?? "").trim();
            if (!selectedProvince) {
                throw new Error("请先选择省份");
            }

            const normalizedProvince = normalizeProvinceName(selectedProvince);
            const provinceLike = `%${selectedProvince}%`;
            const rows = execRows<RecognitionDbRow>(
                db,
                `SELECT * FROM ${table} WHERE (province_name LIKE '${escapeSql(provinceLike)}' OR province_code LIKE '${escapeSql(provinceLike)}') ORDER BY id DESC`,
            );

            if (rows.length === 0) {
                return NextResponse.json({
                    ok: true,
                    deletedCount: 0,
                    checkedCount: 0,
                    skippedCount: 0,
                    message: `当前省份没有可检查的${recognitionType === "solar" ? "光伏" : "风电"}识别数据`,
                });
            }

            const idsToDelete: number[] = [];
            let checkedCount = 0;
            let skippedCount = 0;
            const provinceCache = new Map<string, string>();

            for (let index = 0; index < rows.length; index += 5) {
                const batch = rows.slice(index, index + 5);

                await Promise.all(
                    batch.map(async (row) => {
                        const longitude = Number(row.longitude);
                        const latitude = Number(row.latitude);

                        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                            skippedCount += 1;
                            return;
                        }

                        const cacheKey = `${longitude},${latitude}`;
                        let detectedProvince = provinceCache.get(cacheKey);

                        if (!detectedProvince) {
                            detectedProvince = await lookupProvinceByTianditu(longitude, latitude);
                            provinceCache.set(cacheKey, detectedProvince);
                        }

                        checkedCount += 1;

                        if (normalizeProvinceName(detectedProvince) !== normalizedProvince) {
                            idsToDelete.push(row.id);
                        }
                    }),
                );
            }

            if (idsToDelete.length > 0) {
                db.run(`DELETE FROM ${table} WHERE id IN (${idsToDelete.join(",")})`);
                await persist();
            }

            return NextResponse.json({
                ok: true,
                deletedCount: idsToDelete.length,
                checkedCount,
                skippedCount,
                message: idsToDelete.length > 0
                    ? `已删除 ${idsToDelete.length} 条省外${recognitionType === "solar" ? "光伏" : "风机"}数据`
                    : `未发现需要删除的省外${recognitionType === "solar" ? "光伏" : "风机"}数据`,
            });
        }

        const clauses: string[] = [];
        const params: Record<string, unknown> = {};
        if (body.province) {
            clauses.push("(province_name LIKE @province OR province_code LIKE @province)");
            params.province = `%${String(body.province)}%`;
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const resolvedWhere = where.replace(
            /@province/g,
            `'${escapeSql(String(params.province ?? ""))}'`,
        );
        if (body.unlinkedOnly) {
            const type = body.type as "solar" | "wind";
            const rows = execRows<RecognitionDbRow>(
                db,
                `SELECT * FROM ${table} ${resolvedWhere} ORDER BY id DESC`,
            );
            const enrichedRows = await enrichRecognitionRows(type, rows);
            const targetIds = enrichedRows
                .filter((row) => !row.image_url)
                .map((row) => row.id);

            if (targetIds.length > 0) {
                db.run(`DELETE FROM ${table} WHERE id IN (${targetIds.join(",")})`);
            }
        } else {
            db.run(`DELETE FROM ${table} ${resolvedWhere}`);
        }
        await persist();

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "删除失败" },
            { status: 400 },
        );
    }
}
