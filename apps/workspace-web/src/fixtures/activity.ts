import { createContext, useContext } from 'react';

/** Project-level modification activity shared by stage review and recovery. */
export interface MvpRecoveryActivity {
  requestId: string;
  status: 'PENDING' | 'UNKNOWN' | 'MISMATCH';
}

export interface MvpActivityState {
  recovery?: MvpRecoveryActivity | undefined;
}

export const MvpActivityContext = createContext<MvpActivityState>({});

export function useMvpActivity(): MvpActivityState {
  return useContext(MvpActivityContext);
}
