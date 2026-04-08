import { NextResponse } from "next/server";
import { getSettingsStatus, saveSettings } from "@/lib/settings";

const ADMIN_PASSWORD = "123@abc";

export async function GET() {
    const status = await getSettingsStatus();
    return NextResponse.json(status);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        if (String(body.adminPassword ?? "") !== ADMIN_PASSWORD) {
            throw new Error("管理密码错误");
        }
        await saveSettings({
            windImageDir: String(body.windImageDir ?? ""),
            solarImageDir: String(body.solarImageDir ?? ""),
            dataFileName: String(body.dataFileName ?? ""),
        });
        const status = await getSettingsStatus();

        return NextResponse.json({ ok: true, status });
    } catch (error) {
        const message = error instanceof Error ? error.message : "保存失败";
        return NextResponse.json({ ok: false, message }, { status: 400 });
    }
}
