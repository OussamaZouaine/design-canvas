import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import './styles/globals.css';
import { CommentsPage } from './pages/CommentsPage';
import { HomePage } from './pages/HomePage';
import { Toaster } from './ui/Toaster';
import { ProjectPage } from './pages/ProjectPage';

// Code-based TanStack Router (no file-based plugin: only three routes, so one file is clearer).
const rootRoute = createRootRoute({ component: Outlet });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$id',
  // ?comment=<id> deep link (from the Comments page); the canvas opens that thread in Phase 6.
  validateSearch: (s: Record<string, unknown>): { comment?: string } => (typeof s.comment === 'string' ? { comment: s.comment } : {}),
  component: function Project() { return <ProjectPage projectId={projectRoute.useParams().id} />; },
});
const commentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/comments', component: CommentsPage });

const routeTree = rootRoute.addChildren([homeRoute, projectRoute, commentsRoute]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster />
  </StrictMode>,
);
