import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css'
import DashLayout from './layouts/DashLayout';
import Agent from './pages/agent';
import Dashboard from './pages/dashboard';
import FundMandate from './pages/fundMandate';
import SourcingAgent from './pages/SourcingAgent';
import Error from './pages/Error';


const router = createBrowserRouter([
  {
    path: '/',
    element: <DashLayout />,
    errorElement: <Error />,
    children: [
      {
        index: true,
        element: <Dashboard />,
        errorElement: <Error />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
        errorElement: <Error />,
      },
      {
        path: 'fund-mandate',
        element: <FundMandate />,
        errorElement: <Error />,
      },
      {
        path: 'sourcing-agent',
        element: <SourcingAgent />,
        errorElement: <Error />,
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
