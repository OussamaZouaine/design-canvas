import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import './styles/globals.css';
import { CommentsPage } from './pages/CommentsPage';
import { HomePage } from './pages/HomePage';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectPage } from './pages/ProjectPage';

// Code-based TanStack Router (no file-based plugin: only three routes, so one file is clearer).
const rootRoute = createRootRoute({ component: Outlet });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$id',
  // ?comment=<id> deep link (from the Comments page) opens that thread; ?page=<page id> is the page shown (an id,
  // not the name, so renames never break a link). Anything else is dropped.
  validateSearch: (s: Record<string, unknown>): { comment?: string; page?: string } => ({
    ...(typeof s.comment === 'string' && { comment: s.comment }),
    ...(typeof s.page === 'string' && { page: s.page }),
  }),
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
    {/* Base UI tooltip provider: after one tooltip opens the next ones show instantly (delay=400 only for the first). */}
    <TooltipProvider delay={400} closeDelay={0}>
      <RouterProvider router={router} />
    </TooltipProvider>
    <Toaster />
  </StrictMode>,
);
