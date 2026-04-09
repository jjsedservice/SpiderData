import { NextResponse } from "next/server";
import { execRows, getDatabase } from "@/lib/db";

type EnergyType = "wind" | "solar";

type RecognitionRow = {
    id: number;
};

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const energyType = body?.type as EnergyType;
        const farmId = Number(body?.farmId);
        const recognitionIds = Array.isArray(body?.recognitionIds)
            ? body.recognitionIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)
            : [];

        if (!["wind", "solar"].includes(energyType)) {
            return NextResponse.json({ ok: false, message: "无效的类型" }, { status: 400 });
        }
        if (!Number.isInteger(farmId) || farmId <= 0) {
            return NextResponse.json({ ok: false, message: "无效的场站" }, { status: 400 });
        }
        if (!recognitionIds.length) {
            return NextResponse.json({ ok: false, message: "请选择要关联的零星点" }, { status: 400 });
        }

        const { db, persist } = await getDatabase();
        const farmExists = execRows<{ id: number }>(
            db,
            `SELECT id FROM power_fields WHERE id = ${farmId} LIMIT 1`,
        );
        if (!farmExists.length) {
            return NextResponse.json({ ok: false, message: "场站不存在" }, { status: 404 });
        }

        const recognitionTable = energyType === "wind" ? "wind_recognition" : "solar_recognition";
        const existingRecognitions = execRows<RecognitionRow>(
            db,
            `SELECT id
             FROM ${recognitionTable}
             WHERE id IN (${recognitionIds.join(",")})`,
        );
        const existingIds = new Set(existingRecognitions.map((item) => Number(item.id)));

        for (const recognitionId of recognitionIds) {
            if (!existingIds.has(recognitionId)) {
                continue;
            }
            db.run(`
                INSERT INTO manual_associations (energy_type, farm_id, recognition_id)
                VALUES ('${energyType}', ${farmId}, ${recognitionId})
                ON CONFLICT(energy_type, farm_id, recognition_id) DO UPDATE SET
                    updated_at = CURRENT_TIMESTAMP
            `);
        }

        await persist();
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "保存附加关联失败" },
            { status: 400 },
        );
    }
}

export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const energyType = body?.type as EnergyType;
        const farmId = Number(body?.farmId);
        const recognitionIds = Array.isArray(body?.recognitionIds)
            ? body.recognitionIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)
            : [];
        const singleRecognitionId = Number(body?.recognitionId);
        const targetIds = recognitionIds.length
            ? recognitionIds
            : Number.isInteger(singleRecognitionId) && singleRecognitionId > 0
              ? [singleRecognitionId]
              : [];

        if (!["wind", "solar"].includes(energyType)) {
            return NextResponse.json({ ok: false, message: "无效的类型" }, { status: 400 });
        }
        if (!Number.isInteger(farmId) || farmId <= 0) {
            return NextResponse.json({ ok: false, message: "无效的场站" }, { status: 400 });
        }
        if (!targetIds.length) {
            return NextResponse.json({ ok: false, message: "无效的识别点" }, { status: 400 });
        }

        const { db, persist } = await getDatabase();
        db.run(`
            DELETE FROM manual_associations
            WHERE energy_type = '${energyType}'
              AND farm_id = ${farmId}
              AND recognition_id IN (${targetIds.join(",")})
        `);
        await persist();

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "删除附加关联失败" },
            { status: 400 },
        );
    }
}
