import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MeetingProvider } from './context/MeetingContext.jsx';
import HomePage from './pages/HomePage.jsx';
import CreatePage from './pages/CreatePage.jsx';
import JoinPage from './pages/JoinPage.jsx';
import MeetingPage from './pages/MeetingPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

/** Meeting routes render without the marketing header. */
const isMeetingRoute = (pathname) => pathname.startsWith('/meeting/');

const AppRoutes = () => {
  const location = useLocation();
  const bare = isMeetingRoute(location.pathname);

  return (
    <div className={bare ? 'app app--bare' : 'app'}>
      {!bare ? (
        <header className="site-header">
          <Link to="/" className="site-header__brand">
            AUREX <span>MEET</span>
          </Link>
          <nav className="site-header__nav">
            <Link to="/create">New meeting</Link>
            <Link to="/join">Join</Link>
          </nav>
        </header>
      ) : null}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/meeting/:meetingId" element={<MeetingPage />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      {!bare ? (
        <footer className="site-footer">
          <p>
            AUREX MEET · self-hosted WebRTC meetings. No accounts, no external services, no artificial time limit.
          </p>
        </footer>
      ) : null}
    </div>
  );
};

export const App = () => (
  <MeetingProvider>
    <AppRoutes />
  </MeetingProvider>
);

export default App;
