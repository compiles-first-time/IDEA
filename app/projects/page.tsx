import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { HostedNotice } from "@/components/hosted-notice";
import { ProjectList } from "@/components/project-list";
import { isHosted } from "@/lib/hosted";
import { projectViews } from "@/lib/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (isHosted()) return <HostedNotice feature="Project management" />;

  // Loaded on the server so the page arrives populated — no mount effect, no
  // loading flash, and one fewer round trip.
  const projects = await projectViews();
  return <ProjectList initialProjects={projects} />;
}
