import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/assets/tailwind.css';
import { SidePanel } from './SidePanel';

const container = document.getElementById('root');
if (!container) {
  throw new Error('ไม่พบ #root ในหน้าแผงข้าง');
}

createRoot(container).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
