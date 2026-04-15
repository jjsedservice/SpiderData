"use client";

import dynamic from "next/dynamic";

const WindStationWorkspace = dynamic(() => import("./wind-station-workspace"), {
    ssr: false,
});

export default function WindStationWorkspaceLoader() {
    return <WindStationWorkspace />;
}
