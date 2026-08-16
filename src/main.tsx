import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleScreen } from './ui/BattleScreen';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません');

createRoot(container).render(
  <StrictMode>
    <BattleScreen />
  </StrictMode>,
);
