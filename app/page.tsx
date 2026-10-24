"use client";
import { observer } from "mobx-react-lite";
import { useRouter } from "next/navigation";

import { projectHref } from "lib/routes";
import { useProject } from "projectContext";
import ProjectSelector from "screens/ProjectSelector";

function LandingPage() {
    const router = useRouter();
    const { selectProject } = useProject();

    const handleSelectProject = (
        id: string,
        name: string,
        options?: { overviewSeed?: string },
    ) => {
        void selectProject(id, name, options);
        router.push(projectHref(id));
    };

    return <ProjectSelector onSelect={handleSelectProject} />;
}

export default observer(LandingPage);
