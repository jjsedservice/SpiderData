import { NextResponse } from "next/server";
import { getSessionCsvPage, runStationMatch } from "@/lib/wind-station-association";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const sessionId = String(body.sessionId ?? "").trim();
        const targetDist = String(body.targetDist ?? "").trim();
        const bestMaxDist = Number(body.bestMaxDist ?? 20);

        if (!sessionId) {
            throw new Error("缺少会话 ID");
        }
        if (!targetDist) {
            throw new Error("请选择聚类方案距离");
        }

        const result = await runStationMatch({
            sessionId,
            targetDist,
            bestMaxDist,
        });
        const table = await getSessionCsvPage({
            sessionId,
            file: "station",
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
            { ok: false, message: error instanceof Error ? error.message : "场站匹配失败" },
            { status: 400 },
        );
    }
}
