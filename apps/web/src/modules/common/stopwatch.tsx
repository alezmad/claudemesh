import dayjs from "dayjs";
import { useEffect, useState } from "react";

interface StopwatchProps {
  startTime: Date;
}

export function Stopwatch({ startTime }: StopwatchProps) {
  const [elapsed, setElapsed] = useState(dayjs().diff(dayjs(startTime)));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(dayjs().diff(dayjs(startTime)));
    }, 100);

    return () => clearInterval(interval);
  }, [startTime]);

  const value = +(elapsed / 1000).toFixed(1);

  return value;
}
