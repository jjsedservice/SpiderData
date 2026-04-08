import { NextResponse } from "next/server";
import { getImportJob } from "@/lib/import-jobs";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ ok: false, message: "缺少任务 ID" }, { status: 400 });
    }

    const job = getImportJob(id);
    if (!job) {
        return NextResponse.json({ ok: false, message: "任务不存在" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, job });
}
