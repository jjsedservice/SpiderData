"use client";

import dynamic from "next/dynamic";

const DataImportDashboard = dynamic(() => import("./data-import-dashboard"), {
    ssr: false,
});

export default function DataImportDashboardLoader() {
    return <DataImportDashboard />;
}
