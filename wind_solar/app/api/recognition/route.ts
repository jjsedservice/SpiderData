import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { escapeSql, execRows, getDatabase } from "@/lib/db";
import { clearRecognitionImageCache, findRecognitionImage, getRecognitionImageMap } from "@/lib/recognition-images";

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
