import { Link } from 'react-router-dom';
import { Button, Callout } from '../components/ui/index.jsx';
import { CheckIcon, ClockIcon, ScreenIcon, ShieldIcon, SparkIcon, UsersIcon } from '../components/icons.jsx';
import { useMeeting } from '../context/MeetingContext.jsx';

const FEATURES = [
  {
    icon: <ScreenIcon size={20} />,
    title: 'Real peer-to-peer video',
    body: 'Camera and audio travel directly between browsers over WebRTC. Your meeting server only introduces participants - it never sees your media.',
  },
  {
    icon: <UsersIcon size={20} />,
    title: 'No artificial limits',
    body: 'No meeting timer and no hard-coded participant cap. Capacity is decided by your own hardware and network, not by the app.',
  },
  {
    icon: <ShieldIcon size={20} />,
    title: 'Private by design',
    body: 'No accounts, no sign-ups, no external AI services and no paid APIs. Room state lives in the server memory and disappears when everybody leaves.',
  },
  {
    icon: <SparkIcon size={20} />,
    title: 'Built for real meetings',
    body: 'Screen sharing with presentation mode, in-meeting chat, raise hand, device switching, host controls and a waiting room.',
  },
];

const STEPS = [
  { icon: <CheckIcon size={16} />, text: 'Create a meeting and copy the link.' },
  { icon: <CheckIcon size={16} />, text: 'Send the link to whoever you need.' },
  { icon: <CheckIcon size={16} />, text: 'Allow camera and microphone when the browser asks.' },
];

export const HomePage = () => {
  const { state } = useMeeting();

  return (
    <div className="home">
      <section className="home__hero">
        <p className="home__eyebrow">Self-hosted · WebRTC · No sign-up</p>
        <h1 className="home__title">
          AUREX <span>MEET</span>
        </h1>
        <p className="home__lede">
          A calm, private video meeting room that runs in your browser. Audio and video go straight to the other
          participants - a small local server only introduces you to each other.
        </p>
        <div className="home__actions">
          <Link to="/create" className="btn btn--primary btn--lg">
            New meeting
          </Link>
          <Link to="/join" className="btn btn--ghost btn--lg">
            Join with a link
          </Link>
        </div>
        {state.signalingStatus === 'connected' ? (
          <p className="home__status">
            <span className="status-pill status-pill--ok">
              <span className="status-pill__dot" aria-hidden="true" /> Meeting server reachable
            </span>
          </p>
        ) : null}
        {state.signalingStatus === 'failed' || state.signalingStatus === 'offline' ? (
          <Callout tone="warning" title="Meeting server unreachable">
            Start the signaling server (<code>npm run dev</code> in the project root) and reload this page.
          </Callout>
        ) : null}
      </section>

      <section className="home__features" aria-label="What AUREX MEET does">
        {FEATURES.map((feature) => (
          <article className="feature" key={feature.title}>
            <span className="feature__icon">{feature.icon}</span>
            <h2 className="feature__title">{feature.title}</h2>
            <p className="feature__body">{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="home__steps" aria-label="How to get started">
        <div className="home__steps-inner">
          <h2 className="home__steps-title">
            <ClockIcon size={18} /> Three steps to your first meeting
          </h2>
          <ol className="home__steps-list">
            {STEPS.map((step) => (
              <li key={step.text} className="home__step">
                <span className="home__step-icon">{step.icon}</span>
                {step.text}
              </li>
            ))}
          </ol>
          <p className="home__note">
            AUREX MEET is a self-hosted project. It needs a modern browser (Chrome, Edge, Firefox or Safari 15+) and a
            secure context - <code>localhost</code> counts as secure.
          </p>
          <Link to="/create">
            <Button>Create a meeting</Button>
          </Link>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
