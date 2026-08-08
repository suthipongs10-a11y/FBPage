import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/assets/tailwind.css';
import { Options } from './Options';

const container = document.getElementById('root');
if (!container) {
  throw new Error('ไม่พบ #root ในหน้าตั้งค่า');
}

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
