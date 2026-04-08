"use client";

import dynamic from "next/dynamic";

const AssociationWorkspace = dynamic(() => import("./association-workspace"), {
    ssr: false,
});

export default function AssociationWorkspaceLoader() {
    return <AssociationWorkspace />;
}
