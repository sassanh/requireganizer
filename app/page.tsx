"use client";
import { observer } from "mobx-react-lite";
import { useRouter } from "next/navigation";

import { useProject } from "provider";
import ProjectSelector from "screens/ProjectSelector";

function LandingPage() {
    const router = useRouter();
    const { selectProject } = useProject();

    const handleSelectProject = (id: string, name: string) => {
        selectProject(id, name);
        router.push(`/project/${id}`);
    };

    return <ProjectSelector onSelect={handleSelectProject} />;
}

export default observer(LandingPage);
