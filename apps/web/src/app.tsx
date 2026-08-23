import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from './components/ui.tsx';
import { keys, useApi } from './lib/query.js';
import { trpc } from './lib/trpc.js';
import { LoginScreen } from './features/auth/login.tsx';
import { Shell } from './features/shell/shell.tsx';
import { StructurePage } from './features/structure/structure-page.tsx';
import { GoalsPage } from './features/goals/goals-page.tsx';
import { GoalDetail } from './features/goals/goal-detail.tsx';
import { MetricsPage } from './features/metrics/metrics-page.tsx';
import { WorkPage } from './features/work/work-page.tsx';

/**
 * Routing is a hash route plus a small union rather than a router library.
 * There are five destinations and one detail view; a router would be more
 * configuration than navigation (design rule 6). It moves to TanStack Router
 * when the graph and dashboards arrive in Phase 2 and routes carry real state.
 */
export type Route =
  | { name: 'goals' }
  | { name: 'goal'; id: string }
  | { name: 'metrics' }
  | { name: 'work' }
  | { name: 'structure' };

export const routeToHash = (route: Route): string =>
  route.name === 'goal' ? `#/goals/${route.id}` : `#/${route.name}`;

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, id] = path.split('/');
  if (head === 'goals' && id) return { name: 'goal', id };
  if (head === 'metrics') return { name: 'metrics' };
  if (head === 'work') return { name: 'work' };
  if (head === 'structure') return { name: 'structure' };
  return { name: 'goals' };
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return [
    route,
    (next: Route) => {
      window.location.hash = routeToHash(next);
    },
  ];
}

export function App(): React.JSX.Element {
  const client = useQueryClient();
  const status = useApi(keys.auth, () => trpc.auth.status.query(), { retry: false });
  const [route, navigate] = useRoute();

  if (status.isPending) {
    return (
      <div className="min-h-full grid place-items-center">
        <Skeleton className="h-6 w-40" />
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="min-h-full grid place-items-center p-6 text-center">
        <div>
          <p className="text-behind m-0">▲ Cannot reach the API</p>
          <p className="text-fg-subtle text-[12px] mt-1">
            Is it running? <code>npm run dev</code>
          </p>
        </div>
      </div>
    );
  }

  if (!status.data?.authenticated) {
    return <LoginScreen initialised={status.data?.initialised ?? false} />;
  }

  const signOut = async (): Promise<void> => {
    await trpc.auth.logout.mutate();
    await client.invalidateQueries({ queryKey: keys.auth });
  };

  return (
    <Shell route={route} navigate={navigate} onSignOut={signOut}>
      {route.name === 'goals' && <GoalsPage navigate={navigate} />}
      {route.name === 'goal' && <GoalDetail id={route.id} navigate={navigate} />}
      {route.name === 'metrics' && <MetricsPage />}
      {route.name === 'work' && <WorkPage />}
      {route.name === 'structure' && <StructurePage />}
    </Shell>
  );
}
