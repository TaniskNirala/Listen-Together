import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { computeClockSample, estimateClockOffsetMs } from '../shared/sync';
import type { ClockSample } from '../shared/types';

const MAX_SAMPLES = 9;

export function useClockSync(socket: Socket | null, connected: boolean) {
  const samplesRef = useRef<ClockSample[]>([]);
  const offsetRef = useRef<number>(0);
  const [offsetMs, setOffsetMs] = useState<number>(0);
  const [rttMs, setRttMs] = useState<number | null>(null);

  const sendPing = useCallback(() => {
    if (!socket || !socket.connected) return;
    const sendTime = Date.now();
    socket.emit(
      'sync:ping',
      { clientSendTime: sendTime },
      (resp?: { clientSendTime: number; serverTime: number }) => {
        if (!resp || typeof resp.serverTime !== 'number') return;
        const receiveTime = Date.now();
        const sample = computeClockSample(resp.clientSendTime, receiveTime, resp.serverTime);
        const next = [...samplesRef.current, sample].slice(-MAX_SAMPLES);
        samplesRef.current = next;
        const estimated = estimateClockOffsetMs(next);
        offsetRef.current = estimated;
        setOffsetMs(Math.round(estimated));
        setRttMs(Math.round(sample.rttMs));
      }
    );
  }, [socket]);

  useEffect(() => {
    if (!socket || !connected) return;

    samplesRef.current = [];
    // Initial 5-ping burst for accurate clock lock right away
    const burstTimers: number[] = [];
    for (let i = 0; i < 5; i++) {
      burstTimers.push(window.setTimeout(() => sendPing(), i * 240));
    }

    const periodic = window.setInterval(() => sendPing(), 25_000);

    return () => {
      for (const id of burstTimers) window.clearTimeout(id);
      window.clearInterval(periodic);
    };
  }, [socket, connected, sendPing]);

  const getEstimatedServerNowMs = useCallback(() => {
    return Date.now() + offsetRef.current;
  }, []);

  return { offsetMs, rttMs, getEstimatedServerNowMs, refreshClock: sendPing };
}
