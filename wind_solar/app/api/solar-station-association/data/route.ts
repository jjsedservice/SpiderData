import { NextResponse } from "next/server";
import { getSessionCsvPage, type SessionFileType } from "@/lib/solar-station-association";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = String(searchParams.get("sessionId") ?? "").trim();
        const file = String(searchParams.get("file") ?? "").trim() as SessionFileType;
        const page = Number(searchParams.get("page") ?? 1);
        const pageSize = Number(searchParams.get("pageSize") ?? 10);

        if (!sessionId) {
            throw new Error("缺少会话 ID");
        }
        if (file !== "merge" && file !== "station") {
            throw new Error("不支持的文件类型");
        }

        const table = await getSessionCsvPage({
            sessionId,
            file,
            page,
            pageSize,
        });
        return NextResponse.json({ ok: true, table });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "读取结果失败" },
            { status: 400 },
        );
    }
}
