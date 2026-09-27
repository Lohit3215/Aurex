/** Shared inline SVG icon set. Stroke-based, inherits `currentColor`. */

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const Icon = ({ children, size = 20, ...rest }) => (
  <svg {...base} width={size} height={size} {...rest}>
    {children}
  </svg>
);

export const MicIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

export const MicOffIcon = (props) => (
  <Icon {...props}>
    <path d="M9 9v3a3 3 0 0 0 4.6 2.5M15 11.5V6a3 3 0 0 0-5.7-1.3" />
    <path d="M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const VideoIcon = (props) => (
  <Icon {...props}>
    <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
    <path d="M15.5 10.5 21.5 7v10l-6-3.5" />
  </Icon>
);

export const VideoOffIcon = (props) => (
  <Icon {...props}>
    <path d="M15.5 10.5V8.5a2.5 2.5 0 0 0-2.5-2.5H8" />
    <path d="M2.5 8.5v7A2.5 2.5 0 0 0 5 18h8a2.5 2.5 0 0 0 2.5-2.5v-2" />
    <path d="M21.5 7v10l-4-2.3" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const ScreenIcon = (props) => (
  <Icon {...props}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);

export const ScreenOffIcon = (props) => (
  <Icon {...props}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const UsersIcon = (props) => (
  <Icon {...props}>
    <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 5 17.5V19" />
    <circle cx="10.5" cy="8" r="3.2" />
    <path d="M19 19v-1.4a3.4 3.4 0 0 0-2.4-3.2M15.5 5.2a3.2 3.2 0 0 1 0 5.6" />
  </Icon>
);

export const ChatIcon = (props) => (
  <Icon {...props}>
    <path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.4A7.5 7.5 0 1 1 20.5 12.5Z" />
  </Icon>
);

export const SettingsIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M19.4 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.7-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.7l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.6-1.1v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.7 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4 1Z" />
  </Icon>
);

export const LeaveIcon = (props) => (
  <Icon {...props}>
    <path d="M15.5 4.5h2A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5h-2" />
    <path d="M11 16.5 6.5 12 11 7.5M6.5 12H16" />
  </Icon>
);

export const HandIcon = ({ raised = false, ...props }) => (
  <Icon {...props}>
    <path d="M8.5 11V5.6a1.3 1.3 0 0 1 2.6 0V11" />
    <path d="M11.1 10.6V4.9a1.3 1.3 0 0 1 2.6 0v5.7" />
    <path d="M13.7 11V6.6a1.3 1.3 0 0 1 2.6 0V14a6 6 0 0 1-6 6h-.6a5 5 0 0 1-3.9-1.9l-2.6-3.2a1.4 1.4 0 0 1 2-1.9l1.6 1.4" />
    {!raised && <path d="M3.5 3.5l17 17" />}
  </Icon>
);

export const PinIcon = ({ active = false, ...props }) => (
  <Icon {...props}>
    <path d="M9 3.5h6l-.8 5.2 3 3.1H6.8l3-3.1z" />
    <path d="M12 11.8V20.5" />
    {!active && <path d="M3.5 3.5l17 17" />}
  </Icon>
);

export const ExpandIcon = (props) => (
  <Icon {...props}>
    <path d="M8.5 3.5H4A.5.5 0 0 0 3.5 4v4.5M15.5 3.5H20a.5.5 0 0 1 .5.5V8.5M20.5 15.5V20a.5.5 0 0 1-.5.5H15.5M3.5 15.5V20a.5.5 0 0 0 .5.5h4.5" />
  </Icon>
);

export const CollapseIcon = (props) => (
  <Icon {...props}>
    <path d="M3.5 8.5H8V4M20.5 8.5H16V4M16 20v-4.5h4.5M8 20v-4.5H3.5" />
  </Icon>
);

export const CopyIcon = (props) => (
  <Icon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5" />
  </Icon>
);

export const CheckIcon = (props) => (
  <Icon {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
);

export const LockIcon = (props) => (
  <Icon {...props}>
    <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </Icon>
);

export const UnlockIcon = (props) => (
  <Icon {...props}>
    <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
    <path d="M8 10V7.5a4 4 0 0 1 7.5-2" />
  </Icon>
);

export const CloseIcon = (props) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ChevronIcon = ({ direction = 'down', ...props }) => {
  const rotate = { down: 0, up: 180, left: 90, right: -90 }[direction] ?? 0;
  return (
    <Icon {...props} style={{ transform: `rotate(${rotate}deg)`, ...(props.style ?? {}) }}>
      <path d="m6 9.5 6 6 6-6" />
    </Icon>
  );
};

export const AlertIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3.8 21 19.5H3z" />
    <path d="M12 9.5v4.2M12 16.6v.1" />
  </Icon>
);

export const ShieldIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
    <path d="m9.2 12 2 2 3.6-4" />
  </Icon>
);

export const SparkIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </Icon>
);

export const SignalIcon = ({ quality = 'good', ...props }) => {
  const filled = { excellent: 4, good: 3, unstable: 2, poor: 1 }[quality] ?? 0;
  return (
    <Icon {...props}>
      <rect x="3" y="14" width="3" height="6" rx="1" fill={filled >= 1 ? 'currentColor' : 'none'} />
      <rect x="8.5" y="10" width="3" height="10" rx="1" fill={filled >= 2 ? 'currentColor' : 'none'} />
      <rect x="14" y="6.5" width="3" height="13.5" rx="1" fill={filled >= 3 ? 'currentColor' : 'none'} />
      <rect x="19.5" y="3.5" width="3" height="16.5" rx="1" fill={filled >= 4 ? 'currentColor' : 'none'} />
    </Icon>
  );
};

export const HomeIcon = (props) => (
  <Icon {...props}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
  </Icon>
);

export const SendIcon = (props) => (
  <Icon {...props}>
    <path d="M4 12 20.5 4 14 20l-2.5-6.5z" />
  </Icon>
);

export const TrashIcon = (props) => (
  <Icon {...props}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Icon>
);

export const CrownIcon = (props) => (
  <Icon {...props}>
    <path d="M4 8.5 7.5 12 12 5.5 16.5 12 20 8.5V18H4z" />
  </Icon>
);

export const ClockIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
