"use client";

import dynamic from "next/dynamic";

const SolarStationWorkspace = dynamic(() => import("./solar-station-workspace"), {
    ssr: false,
});

export default function SolarStationWorkspaceLoader() {
    return <SolarStationWorkspace />;
}
