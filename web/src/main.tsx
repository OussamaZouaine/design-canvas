import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import './styles/globals.css';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';

// Code-based TanStack Router (no file-based plugin: only three routes, so one file is clearer).
const rootRoute = createRootRoute({ component: Outlet });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$id',
  component: function Project() { return <ProjectPage projectId={projectRoute.useParams().id} />; },
});
// /comments is ported in Phase 2.

const routeTree = rootRoute.addChildren([homeRoute, projectRoute]);
// basepath: the app is served under /next/ until the Phase 8 cut-over.
const router = createRouter({ routeTree, basepath: '/next' });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
