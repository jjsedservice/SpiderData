import { NextResponse } from "next/server";
import { getSessionMeta } from "@/lib/wind-station-association";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = String(searchParams.get("id") ?? "").trim();
        if (!id) {
            throw new Error("缺少会话 ID");
        }

        const session = await getSessionMeta(id);
        return NextResponse.json({ ok: true, session });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "读取会话失败" },
            { status: 400 },
        );
    }
}
