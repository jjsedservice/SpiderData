import { NextResponse } from "next/server";
import { escapeSql, execRows, getDatabase } from "@/lib/db";
import { findRecognitionImage } from "@/lib/recognition-images";

function resolveTable(type: string | null) {
    if (type === "solar") {
        return "solar_recognition";
    }
    if (type === "wind") {
        return "wind_recognition";
    }
    throw new Error("不支持的识别数据类型");
}

export async function GET(request: Request) {
    try {
        const { db } = await getDatabase();
        const { searchParams } = new URL(request.url);
        const table = resolveTable(searchParams.get("type"));
        const page = Number(searchParams.get("page") ?? "1");
        const pageSize = Number(searchParams.get("pageSize") ?? "10");
        const province = (searchParams.get("province") ?? "").trim();
        const unlinkedOnly = searchParams.get("unlinkedOnly") === "true";

        const clauses: string[] = [];
        const params: Record<string, unknown> = {};
        if (province) {
            clauses.push("(province_name LIKE @province OR province_code LIKE @province)");
            params.province = `%${province}%`;
        }
        if (unlinkedOnly) {
            clauses.push("image_exists = 0");
        }

        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const resolvedWhere = where.replace(
            /@province/g,
            `'${escapeSql(String(params.province ?? ""))}'`,
        );
        const total = execRows<{ count: number }>(
            db,
            `SELECT COUNT(*) as count FROM ${table} ${resolvedWhere}`,
        )[0];
        const rows = execRows<{
            id: number;
            original_image: string;
            province_name: string;
            city: string;
            longitude: string;
            latitude: string;
            image_exists: number;
        }>(
            db,
            `SELECT * FROM ${table} ${resolvedWhere} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const type = searchParams.get("type") as "solar" | "wind";
        const enrichedRows = await Promise.all(
            rows.map(async (row) => {
                const filePath = row.image_exists
                    ? await findRecognitionImage(type, String(row.original_image))
                    : null;

                return {
                    ...row,
                    image_url: filePath
                        ? `/api/recognition/image?type=${type}&name=${encodeURIComponent(String(row.original_image))}`
                        : null,
                };
            }),
        );

        return NextResponse.json({ ok: true, rows: enrichedRows, total: total?.count ?? 0 });
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
        if (body.unlinkedOnly) {
            clauses.push("image_exists = 0");
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const resolvedWhere = where.replace(
            /@province/g,
            `'${escapeSql(String(params.province ?? ""))}'`,
        );
        db.run(`DELETE FROM ${table} ${resolvedWhere}`);
        await persist();

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "删除失败" },
            { status: 400 },
        );
    }
}
