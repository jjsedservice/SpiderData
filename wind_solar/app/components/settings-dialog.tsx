"use client";

import SettingsIcon from "@mui/icons-material/Settings";
import SaveIcon from "@mui/icons-material/Save";
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { SettingsFormValues, SettingsStatus } from "@/lib/settings";

type SettingsDialogProps = {
    initialStatus: SettingsStatus;
};

const ADMIN_PASSWORD = "123@abc";
const dialogFieldProps = {
    fullWidth: true,
    variant: "outlined" as const,
    sx: {
        "& .MuiInputBase-root": {
            minHeight: 56,
            alignItems: "center",
        },
    },
};

export default function SettingsDialog({ initialStatus }: SettingsDialogProps) {
    const [open, setOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(!initialStatus.isValid);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");
    const [authError, setAuthError] = useState<string | null>(null);
    const [status, setStatus] = useState(initialStatus);
    const [formValues, setFormValues] = useState<SettingsFormValues>(
        initialStatus.formValues,
    );
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        setStatus(initialStatus);
        setFormValues(initialStatus.formValues);
        if (!initialStatus.isValid && !isAuthenticated) {
            setAuthOpen(true);
        }
    }, [initialStatus, isAuthenticated]);

    function handleOpenSettings() {
        setMessage(null);
        setError(null);
        if (isAuthenticated) {
            setOpen(true);
            return;
        }
        setAuthError(null);
        setAuthOpen(true);
    }

    function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (passwordInput !== ADMIN_PASSWORD) {
            setAuthError("管理密码错误");
            return;
        }

        setIsAuthenticated(true);
        setAuthError(null);
        setPasswordInput("");
        setAuthOpen(false);
        setOpen(true);
    }

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setMessage(null);
        setError(null);

        try {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    ...formValues,
                    adminPassword: ADMIN_PASSWORD,
                }),
            });
            const payload = await response.json();

            if (!response.ok || !payload.ok) {
                throw new Error(payload.message || "保存失败");
            }

            setStatus(payload.status);
            setFormValues(payload.status.formValues);
            setMessage("设置已保存，config.yaml 已更新。");
            if (payload.status.isValid) {
                setOpen(false);
            }
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "保存失败");
        } finally {
            setSubmitting(false);
        }
    }

    const forceOpen = !status.isValid;

    return (
        <>
            <Button
                variant="text"
                color="inherit"
                startIcon={<SettingsIcon />}
                sx={{ borderRadius: 999, px: 2, color: "#f8fff9" }}
                onClick={handleOpenSettings}
            >
                设置
            </Button>

            <Dialog
                open={authOpen}
                onClose={!status.isValid ? undefined : () => setAuthOpen(false)}
                fullWidth
                maxWidth="xs"
            >
                <Stack component="form" onSubmit={handlePasswordSubmit}>
                    <DialogTitle>管理密码</DialogTitle>
                    <DialogContent>
                        <Stack spacing={2} sx={{ pt: 1 }}>
                            {authError ? <Alert severity="error">{authError}</Alert> : null}
                            <TextField
                                {...dialogFieldProps}
                                label="请输入管理密码"
                                type="password"
                                value={passwordInput}
                                onChange={(event) => setPasswordInput(event.target.value)}
                                autoFocus
                            />
                        </Stack>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 3 }}>
                        {status.isValid ? (
                            <Button onClick={() => setAuthOpen(false)} color="inherit">
                                取消
                            </Button>
                        ) : null}
                        <Button type="submit" variant="contained" color="success">
                            验证
                        </Button>
                    </DialogActions>
                </Stack>
            </Dialog>

            <Dialog
                open={open}
                onClose={forceOpen ? undefined : () => setOpen(false)}
                fullWidth
                maxWidth="sm"
            >
                <Stack component="form" onSubmit={handleSubmit}>
                    <DialogTitle>设置</DialogTitle>
                    <DialogContent>
                        <Stack spacing={3} sx={{ pt: 1 }}>
                            {!status.isValid ? (
                                <Alert severity="warning">
                                    {status.issues.join("；")}
                                </Alert>
                            ) : null}

                            {message ? <Alert severity="success">{message}</Alert> : null}
                            {error ? <Alert severity="error">{error}</Alert> : null}

                            <TextField
                                {...dialogFieldProps}
                                label="风机图片目录"
                                value={formValues.windImageDir}
                                onChange={(event) =>
                                    setFormValues((current) => ({
                                        ...current,
                                        windImageDir: event.target.value,
                                    }))
                                }
                                helperText="例如：wind_result/map"
                            />

                            <TextField
                                {...dialogFieldProps}
                                label="光伏图片目录"
                                value={formValues.solarImageDir}
                                onChange={(event) =>
                                    setFormValues((current) => ({
                                        ...current,
                                        solarImageDir: event.target.value,
                                    }))
                                }
                                helperText="例如：solar_result/map"
                            />

                            <TextField
                                {...dialogFieldProps}
                                label="数据文件名称"
                                value={formValues.dataFileName}
                                onChange={(event) =>
                                    setFormValues((current) => ({
                                        ...current,
                                        dataFileName: event.target.value,
                                    }))
                                }
                                helperText="例如：project_store，实际保存为 assets/data/project_store.sqlite"
                            />
                        </Stack>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 3 }}>
                        {!forceOpen ? (
                            <Button onClick={() => setOpen(false)} color="inherit">
                                关闭
                            </Button>
                        ) : null}
                        <Button
                            type="submit"
                            variant="contained"
                            color="success"
                            startIcon={<SaveIcon />}
                            disabled={submitting}
                        >
                            {submitting ? "保存中..." : "保存设置"}
                        </Button>
                    </DialogActions>
                </Stack>
            </Dialog>
        </>
    );
}
