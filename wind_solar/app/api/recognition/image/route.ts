import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { findRecognitionImage } from "@/lib/recognition-images";

function contentTypeByExtension(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".png") {
        return "image/png";
    }
    if (extension === ".webp") {
        return "image/webp";
    }
    return "image/jpeg";
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get("type");
        const name = searchParams.get("name");

        if ((type !== "solar" && type !== "wind") || !name) {
            return NextResponse.json({ ok: false, message: "参数错误" }, { status: 400 });
        }

        const filePath = await findRecognitionImage(type, name);
        if (!filePath) {
            return NextResponse.json({ ok: false, message: "图片不存在" }, { status: 404 });
        }

        const content = await fs.readFile(filePath);
        return new NextResponse(content, {
            headers: {
                "Content-Type": contentTypeByExtension(filePath),
                "Cache-Control": "public, max-age=300",
            },
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "读取图片失败" },
            { status: 500 },
        );
    }
}
