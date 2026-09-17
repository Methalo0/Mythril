import { useCallback, useEffect, useState } from 'react';

// Account state only — sign-in status and the access token. The bootstrap
// config (/v1/config: service URLs, billing catalog, model recommendations)
// is deliberately NOT part of this snapshot: it's unauthenticated and
// sign-in independent, so consumers read it from use-mythril-config instead.
interface MythrilAccountState {
  signedIn: boolean;
  accessToken: string | null;
}

export type MythrilAccountSnapshot = MythrilAccountState;

const DEFAULT_STATE: MythrilAccountState = {
  signedIn: false,
  accessToken: null,
};

export function useMythrilAccount() {
  const [state, setState] = useState<MythrilAccountState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refresh = useCallback(async (): Promise<MythrilAccountSnapshot | null> => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('account:getMythril', null);
      const next: MythrilAccountSnapshot = {
        signedIn: result.signedIn,
        accessToken: result.accessToken,
      };
      setState(next);
      return next;
    } catch (error) {
      console.error('Failed to load Mythril account state:', error);
      setState(DEFAULT_STATE);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider !== 'mythril') {
        return;
      }
      refresh();
    });
    return cleanup;
  }, [refresh]);

  return {
    signedIn: state.signedIn,
    accessToken: state.accessToken,
    isLoading,
    refresh,
  };
}
