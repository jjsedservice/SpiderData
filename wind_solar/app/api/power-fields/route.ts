import { NextResponse } from "next/server";
import { escapeSql, execRows, getDatabase } from "@/lib/db";

function confidenceClause(level: string | null) {
    if (level === "high") {
        return "confidence >= 0.9";
    }
    if (level === "medium") {
        return "confidence >= 0.8 AND confidence < 0.9";
    }
    if (level === "low") {
        return "confidence < 0.8";
    }
    return "";
}

function toCsvValue(value: unknown) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

export async function GET(request: Request) {
    const { db } = await getDatabase();
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "10");
    const keyword = (searchParams.get("keyword") ?? "").trim();
    const powerType = (searchParams.get("powerType") ?? "").trim();
    const confidenceLevel = searchParams.get("confidenceLevel");
    const format = (searchParams.get("format") ?? "").trim();

    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (keyword) {
        const terms = keyword.split(/\s+/).filter(Boolean);
        terms.forEach((term, index) => {
            clauses.push(`(enterprise_name LIKE @keyword${index} OR province LIKE @keyword${index})`);
            params[`keyword${index}`] = `%${term}%`;
        });
    }
    if (powerType) {
        clauses.push("power_type LIKE @powerType");
        params.powerType = `%${powerType}%`;
    }
    const confidence = confidenceClause(confidenceLevel);
    if (confidence) {
        clauses.push(confidence);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    let resolvedWhere = where.replaceAll(
        "@powerType",
        `'${escapeSql(String(params.powerType ?? ""))}'`,
    );
    Object.entries(params).forEach(([key, value]) => {
        if (key.startsWith("keyword")) {
            resolvedWhere = resolvedWhere.replaceAll(`@${key}`, `'${escapeSql(String(value))}'`);
        }
    });
    const total = execRows<{ count: number }>(db, `SELECT COUNT(*) as count FROM power_fields ${resolvedWhere}`)[0];
    const allRows = execRows(
        db,
        `SELECT * FROM power_fields ${resolvedWhere} ORDER BY id DESC`,
    );

    if (format === "csv") {
        const lines = [
            [
                "企业名称",
                "主体名称",
                "站点名称",
                "发电类型",
                "装机容量",
                "经度",
                "纬度",
                "补充信息",
                "原始地址片段",
                "标准化地址",
                "省",
                "市",
                "区",
                "乡镇街道",
                "村社区",
                "组社",
                "可信度",
            ].map(toCsvValue).join(","),
            ...allRows.map((row) =>
                [
                    row.enterprise_name,
                    row.subject_name,
                    row.site_name,
                    row.power_type,
                    row.capacity,
                    row.longitude,
                    row.latitude,
                    row.supplement,
                    row.raw_address,
                    row.standardized_address,
                    row.province,
                    row.city,
                    row.district,
                    row.town,
                    row.village,
                    row.group_name,
                    row.confidence,
                ].map(toCsvValue).join(","),
            ),
        ];

        return new Response(`\uFEFF${lines.join("\n")}`, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("电场数据_导出.csv")}`,
            },
        });
    }

    const rows = allRows.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({ ok: true, rows, total: total?.count ?? 0 });
}

export async function POST(request: Request) {
    const body = await request.json();
    const { db, persist } = await getDatabase();
    db.run(`
        INSERT INTO power_fields (
            enterprise_name, subject_name, site_name, power_type, capacity, longitude, latitude, supplement,
            raw_address, standardized_address, province, city, district, town, village,
            group_name, confidence, updated_at
        ) VALUES (
            '${escapeSql(body.enterprise_name ?? "")}',
            '${escapeSql(body.subject_name ?? "")}',
            '${escapeSql(body.site_name ?? "")}',
            '${escapeSql(body.power_type ?? "")}',
            '${escapeSql(body.capacity ?? "")}',
            '${escapeSql(body.longitude ?? "")}',
            '${escapeSql(body.latitude ?? "")}',
            '${escapeSql(body.supplement ?? "")}',
            '${escapeSql(body.raw_address ?? "")}',
            '${escapeSql(body.standardized_address ?? "")}',
            '${escapeSql(body.province ?? "")}',
            '${escapeSql(body.city ?? "")}',
            '${escapeSql(body.district ?? "")}',
            '${escapeSql(body.town ?? "")}',
            '${escapeSql(body.village ?? "")}',
            '${escapeSql(body.group_name ?? "")}',
            ${Number(body.confidence ?? 0)},
            CURRENT_TIMESTAMP
        )
    `);
    await persist();

    return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
    const body = await request.json();
    const { db, persist } = await getDatabase();
    db.run(`
        UPDATE power_fields SET
            enterprise_name='${escapeSql(body.enterprise_name ?? "")}',
            subject_name='${escapeSql(body.subject_name ?? "")}',
            site_name='${escapeSql(body.site_name ?? "")}',
            power_type='${escapeSql(body.power_type ?? "")}',
            capacity='${escapeSql(body.capacity ?? "")}',
            longitude='${escapeSql(body.longitude ?? "")}',
            latitude='${escapeSql(body.latitude ?? "")}',
            supplement='${escapeSql(body.supplement ?? "")}',
            raw_address='${escapeSql(body.raw_address ?? "")}',
            standardized_address='${escapeSql(body.standardized_address ?? "")}',
            province='${escapeSql(body.province ?? "")}',
            city='${escapeSql(body.city ?? "")}',
            district='${escapeSql(body.district ?? "")}',
            town='${escapeSql(body.town ?? "")}',
            village='${escapeSql(body.village ?? "")}',
            group_name='${escapeSql(body.group_name ?? "")}',
            confidence=${Number(body.confidence ?? 0)},
            updated_at=CURRENT_TIMESTAMP
        WHERE id=${Number(body.id ?? 0)}
    `);
    await persist();

    return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
    const body = await request.json();
    const { db, persist } = await getDatabase();
    const mode = body.mode as "all" | "filtered" | "single";

    if (mode === "all") {
        db.run("DELETE FROM power_fields");
        await persist();
        return NextResponse.json({ ok: true });
    }

    if (mode === "single") {
        db.run(`DELETE FROM power_fields WHERE id = ${Number(body.id ?? 0)}`);
        await persist();
        return NextResponse.json({ ok: true });
    }

    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (body.keyword) {
        const terms = String(body.keyword).trim().split(/\s+/).filter(Boolean);
        terms.forEach((term, index) => {
            clauses.push(`(enterprise_name LIKE @keyword${index} OR province LIKE @keyword${index})`);
            params[`keyword${index}`] = `%${term}%`;
        });
    }
    if (body.powerType) {
        clauses.push("power_type LIKE @powerType");
        params.powerType = `%${String(body.powerType)}%`;
    }
    const confidence = confidenceClause(body.confidenceLevel ?? null);
    if (confidence) {
        clauses.push(confidence);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    let resolvedWhere = where.replaceAll(
        "@powerType",
        `'${escapeSql(String(params.powerType ?? ""))}'`,
    );
    Object.entries(params).forEach(([key, value]) => {
        if (key.startsWith("keyword")) {
            resolvedWhere = resolvedWhere.replaceAll(`@${key}`, `'${escapeSql(String(value))}'`);
        }
    });
    db.run(`DELETE FROM power_fields ${resolvedWhere}`);
    await persist();
    return NextResponse.json({ ok: true });
}
