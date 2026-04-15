import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { clearRecognitionImageCache } from "@/lib/recognition-images";

const execFileAsync = promisify(execFile);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif"]);

async function walkFiles(root: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(current: string): Promise<void> {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "__MACOSX") {
                continue;
            }

            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(target);
                continue;
            }

            files.push(target);
        }
    }

    await walk(root);
    return files;
}

async function ensureWithinDirectory(root: string, target: string) {
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("压缩包中包含非法路径");
    }
}

export async function POST(request: Request) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wind-solar-images-"));
    const zipPath = path.join(tempRoot, "upload.zip");
    const extractDir = path.join(tempRoot, "unzipped");

    try {
        const formData = await request.formData();
        const archive = formData.get("file");
        const type = formData.get("type");

        if (!(archive instanceof File)) {
            throw new Error("缺少 ZIP 文件");
        }
        if (type !== "solar" && type !== "wind") {
            throw new Error("不支持的图片类型");
        }
        if (!archive.name.toLowerCase().endsWith(".zip")) {
            throw new Error("请上传 ZIP 压缩包");
        }

        const settings = await readSettings();
        const relativeDir = type === "solar" ? settings.solarImageDir : settings.windImageDir;
        const targetRoot = path.join(process.cwd(), "assets", relativeDir);

        await fs.mkdir(targetRoot, { recursive: true });
        await fs.mkdir(extractDir, { recursive: true });
        await fs.writeFile(zipPath, Buffer.from(await archive.arrayBuffer()));

        await execFileAsync("/usr/bin/unzip", ["-qq", zipPath, "-d", extractDir]);

        const extractedFiles = await walkFiles(extractDir);
        let copiedCount = 0;

        for (const sourcePath of extractedFiles) {
            const extension = path.extname(sourcePath).toLowerCase();
            if (!imageExtensions.has(extension)) {
                continue;
            }

            await ensureWithinDirectory(extractDir, sourcePath);
            const fileName = path.basename(sourcePath);
            const destinationPath = path.join(targetRoot, fileName);
            await fs.copyFile(sourcePath, destinationPath);
            copiedCount += 1;
        }

        await clearRecognitionImageCache(type);

        return NextResponse.json({
            ok: true,
            copiedCount,
            message: copiedCount > 0 ? `成功导入 ${copiedCount} 张图片` : "压缩包中没有可导入的图片",
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "图片导入失败" },
            { status: 400 },
        );
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
