import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { createLogger } from './utils/logger.js';
import './styles/index.css';

const log = createLogger('boot');

const container = document.getElementById('root');
if (!container) {
  log.error('#root element is missing from index.html');
} else {
  createRoot(container).render(
    // The v7 future flags are opt-in now: enabling them keeps the console clean
    // and makes the eventual React Router 7 upgrade a no-op.
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>,
  );
}
