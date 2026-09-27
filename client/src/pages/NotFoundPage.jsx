import { Link } from 'react-router-dom';
import { Button } from '../components/ui/index.jsx';

export const NotFoundPage = () => (
  <div className="page page--narrow">
    <div className="end-screen__card">
      <h1 className="end-screen__title">Page not found</h1>
      <p className="end-screen__text">That address does not exist in AUREX MEET.</p>
      <div className="end-screen__actions">
        <Link to="/">
          <Button>Back to home</Button>
        </Link>
      </div>
    </div>
  </div>
);

export default NotFoundPage;
