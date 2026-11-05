import { Icon } from '../../components/icon.js';

/** Three quiet markers represent the user's actual choices, not a daily score. */
export function FocusOrbit({ completed }: { completed: boolean[] }) {
  const done = completed.filter(Boolean).length;
  return <div className="focus-orbit" role="img" aria-label={completed.length
    ? `${done} of ${completed.length} chosen priorities complete`
    : 'A fresh day. Choose your first priority.'}>
    <svg viewBox="0 0 144 144" fill="none" aria-hidden="true">
      <circle cx="72" cy="72" r="68" stroke="currentColor" strokeOpacity=".12" />
      <circle cx="72" cy="72" r="47" stroke="currentColor" strokeOpacity=".1" strokeDasharray="1 7" />
      {[0, 1, 2].map((index) => <circle key={index} cx="72" cy="72" r="58" pathLength="100"
        stroke={completed[index] ? '#a7dfc7' : index < completed.length ? '#b1a1ff' : '#454052'}
        strokeWidth="3" strokeLinecap="round" strokeDasharray="27 73"
        transform={`rotate(${index * 120 - 84} 72 72)`} />)}
      <path d="M123 12v12m-6-6h12" stroke="#d7bc90" strokeWidth="1.5" />
      <circle cx="13" cy="104" r="3" fill="#b1a1ff" />
    </svg>
    <div className="focus-orbit-label" aria-hidden="true">
      {completed.length ? <><strong>{done}<span>/{completed.length}</span></strong><span>priorities done</span></>
        : <><Icon name="sun" size={30} /><span>Room to begin</span></>}
    </div>
  </div>;
}
