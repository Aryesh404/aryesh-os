import { useEffect, useState } from 'react';
import { PLANNING_TIME_ZONE } from '@aryesh/domain';

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: PLANNING_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: PLANNING_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
});

export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, []);

  // A readable time element, without a live region announcing every second.
  return <time className="workspace-clock" dateTime={now.toISOString()}>
    <span className="workspace-clock-date">{dateFormat.format(now)}</span>
    <span className="workspace-clock-time">{timeFormat.format(now)}<span className="workspace-clock-zone" title="India Standard Time · Asia/Kolkata">IST</span></span>
  </time>;
}
