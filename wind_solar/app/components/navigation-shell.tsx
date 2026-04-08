"use client";

import SolarPowerIcon from "@mui/icons-material/SolarPower";
import {
  AppBar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SettingsStatus } from "@/lib/settings";
import SettingsDialog from "./settings-dialog";

type NavigationShellProps = {
  title: string;
  description: string;
  settingsStatus: SettingsStatus;
  children?: React.ReactNode;
};

const navItems = [
  { href: "/data-processing", label: "数据导入" },
  { href: "/map-display", label: "场站关联" },
];

export default function NavigationShell({
  title,
  description,
  settingsStatus,
  children,
}: NavigationShellProps) {
  const pathname = usePathname();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(218, 242, 226, 0.9), transparent 35%), linear-gradient(180deg, #f3f7f4 0%, #e2ebe3 100%)",
      }}
    >
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          backdropFilter: "blur(14px)",
          backgroundColor: "rgba(20, 52, 39, 0.82)",
        }}
      >
        <Toolbar sx={{ gap: 1.5, flexWrap: "wrap", py: 1 }}>
          <SolarPowerIcon />
          <Typography
            variant="h6"
            sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: 0.4 }}
          >
            风光数据平台
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {navItems.map((item) => {
              const active = pathname === item.href;

              return (
                <Button
                  key={item.href}
                  component={Link}
                  href={item.href}
                  variant={active ? "contained" : "text"}
                  color={active ? "secondary" : "inherit"}
                  sx={{
                    borderRadius: 999,
                    px: 2,
                    color: active ? undefined : "#f8fff9",
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
            <SettingsDialog initialStatus={settingsStatus} />
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
        <Stack spacing={4}>
          <Box sx={{ px: { xs: 0.5, md: 1 } }}>
            <Typography variant="h4" sx={{ fontWeight: 800, color: "#143427" }}>
              {title}
            </Typography>
            {description ? (
              <Typography
                sx={{
                  mt: 1,
                  maxWidth: 760,
                  color: "rgba(20, 52, 39, 0.72)",
                  lineHeight: 1.8,
                }}
              >
                {description}
              </Typography>
            ) : null}
          </Box>

          {children}
        </Stack>
      </Container>
    </Box>
  );
}
