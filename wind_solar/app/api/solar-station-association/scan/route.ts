import { NextResponse } from "next/server";
import { getSessionCsvPage, runClusterScan } from "@/lib/solar-station-association";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const province = String(body.province ?? "").trim();
        const maxDistanceKm = Number(body.maxDistanceKm ?? 40);
        const stepKm = Number(body.stepKm ?? 0.5);

        if (!province) {
            throw new Error("请选择省份");
        }
        if (!Number.isFinite(maxDistanceKm) || maxDistanceKm < 1) {
            throw new Error("扫描距离上限不合法");
        }
        if (!Number.isFinite(stepKm) || stepKm <= 0) {
            throw new Error("扫描步长不合法");
        }

        const result = await runClusterScan({
            province,
            maxDistanceKm,
            stepKm,
        });
        const table = await getSessionCsvPage({
            sessionId: result.session.id,
            file: "merge",
            page: 1,
            pageSize: 10,
        });

        return NextResponse.json({
            ok: true,
            session: result.session,
            table,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "聚类扫描失败" },
            { status: 400 },
        );
    }
}
