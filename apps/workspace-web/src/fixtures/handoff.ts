import { createContext } from 'react';
import type { JourneyReviewStage } from '../mvp/JourneyNav.js';
import type { OverviewStage } from '../overview/Page.js';

/**
 * Development-only handoff from the U2 adapter to the shared U1 overview.
 * It lets the overview show the derived next stage without importing the U2
 * fixture module (which consumes the U1 context).
 */
export interface MvpHandoffStage {
  id: string;
  label: string;
  href: string;
  ready: boolean;
  reason?: string | undefined;
}

export interface MvpHandoff {
  next?: { label: string; href: string; reason: string } | undefined;
  stages?: readonly OverviewStage[] | undefined;
  reviewStages?: readonly JourneyReviewStage[] | undefined;
  u3Stages?: readonly MvpHandoffStage[] | undefined;
  projectStatus?: string | undefined;
  projectProgress?: string | undefined;
}

export const MvpHandoffContext = createContext<MvpHandoff | null>(null);
