// Development-only project identity. Each created project owns a provider tree.
import { createContext, useContext, useMemo } from 'react';
import { u1PlanOne, u1Project, u1ReportOne, u1ReportTwo } from './u1-data.js';

export interface FixtureProject {
  id: string;
  enterpriseId: string;
  customerLabel: string;
  title: string;
  code: string;
}
export const FixtureProjectContext = createContext<FixtureProject>(u1Project);
export function useFixtureProject() {
  return useContext(FixtureProjectContext);
}
export function projectPaths(projectId: string) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return {
    projectId,
    base,
    workPath: `${base}/work`,
    resultsPath: `${base}/results`,
    manualPath: `${base}/stages/manual`,
    proceduresPath: `${base}/stages/procedures`,
    rulesPath: `${base}/stages/rules`,
    scopePath: `${base}/startup/U1-REPORT-02`,
    reworkPath: `${base}/rework`,
    recoveryPath: `${base}/recovery`,
    deliveryPath: `${base}/delivery`,
  };
}
export function useProjectPaths() {
  return projectPaths(useFixtureProject().id);
}
export function useProjectTemplates() {
  const project = useFixtureProject();
  return useMemo(
    () => ({
      u1Project: project,
      u1ReportOne: { ...u1ReportOne, projectId: project.id },
      u1ReportTwo: { ...u1ReportTwo, projectId: project.id },
      u1PlanOne: { ...u1PlanOne, projectId: project.id },
    }),
    [project],
  );
}
