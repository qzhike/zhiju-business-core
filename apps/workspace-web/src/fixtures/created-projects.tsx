// Keep each in-memory rehearsal mounted when its route is not selected.
import { useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { IntakeProject } from '../intake/model.js';
import { useFixtureIntake } from './intake.js';
import { FixtureProjectContext } from './project-session.js';
import { FixtureU1Provider } from './u1.js';
import { FixtureU2Provider } from './u2.js';
import { FixtureU3Provider } from './u3.js';
import { FixtureResultsProvider } from './results.js';
import { FixtureCatalogProvider } from './project-catalog.js';
import { MvpHandoffContext } from './handoff.js';

function ProjectProgress({ id }: { id: string }) {
  const handoff = useContext(MvpHandoffContext);
  const { updateProgress } = useFixtureIntake();
  const status = handoff?.projectStatus ?? '待开始分析';
  const detail = handoff?.projectProgress ?? '阶段定稿 0/3';
  const reason = handoff?.next?.reason ?? '返回当前工作继续处理。';
  useEffect(() => {
    updateProgress(id, { status, detail, reason });
  }, [id, status, detail, reason, updateProgress]);
  return null;
}

function CreatedProject({ project, children }: { project: IntakeProject; children: ReactNode }) {
  const identity = useMemo(
    () => ({
      id: project.id,
      enterpriseId: project.customer.id,
      customerLabel: project.customer.name,
      title: project.title,
      code: project.customer.code,
    }),
    [project],
  );
  return (
    <FixtureProjectContext.Provider value={identity}>
      <FixtureU1Provider>
        <FixtureU2Provider>
          <FixtureU3Provider>
            <ProjectProgress id={project.id} />
            <FixtureResultsProvider>
              <FixtureCatalogProvider>{children}</FixtureCatalogProvider>
            </FixtureResultsProvider>
          </FixtureU3Provider>
        </FixtureU2Provider>
      </FixtureU1Provider>
    </FixtureProjectContext.Provider>
  );
}
export function FixtureCreatedProjectSessions({ children }: { children: ReactNode }) {
  const { projects } = useFixtureIntake();
  const location = useLocation();
  const created = projects.filter((project) => project.id.startsWith('DEMO-CREATED-'));
  const active = created.find((project) =>
    location.pathname.startsWith(`/projects/${project.id}/`),
  );
  return (
    <>
      {!active && children}
      {created.map((project) => (
        <CreatedProject key={project.id} project={project}>
          {active?.id === project.id ? children : null}
        </CreatedProject>
      ))}
    </>
  );
}
