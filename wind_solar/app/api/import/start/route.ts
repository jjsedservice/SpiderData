import { NextResponse } from "next/server";
import { startImport } from "@/lib/importers";

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const type = formData.get("type");

        if (!(file instanceof File)) {
            throw new Error("缺少导入文件");
        }
        if (
            type !== "power-fields" &&
            type !== "solar-recognition" &&
            type !== "wind-recognition"
        ) {
            throw new Error("不支持的导入类型");
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const job = await startImport(type, buffer);

        return NextResponse.json({ ok: true, jobId: job.id });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "导入失败" },
            { status: 400 },
        );
    }
}
