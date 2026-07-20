import React, { useEffect, useRef, useState } from 'react';

const makeTarget = () => ({
  id: Math.random(),
  x: 8 + Math.random() * 78,
  y: 12 + Math.random() * 66,
  good: Math.random() > 0.28,
});

export default function PriceGuardGame({ open, onClose, onFastClose }) {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(20);
  const [playing, setPlaying] = useState(false);
  const [target, setTarget] = useState(makeTarget);
  const openedAt = useRef(0);

  const restart = () => {
    setScore(0);
    setTimeLeft(20);
    setPlaying(true);
    setTarget(makeTarget());
  };

  useEffect(() => {
    if (open) {
      openedAt.current = Date.now();
      restart();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !playing) return undefined;
    const timer = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          setPlaying(false);
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [open, playing]);

  useEffect(() => {
    if (!open || !playing) return undefined;
    const mover = window.setInterval(() => setTarget(makeTarget()), 850);
    return () => window.clearInterval(mover);
  }, [open, playing]);

  if (!open) return null;

  const closeGame = () => {
    const escapedImmediately = Date.now() - openedAt.current <= 2_000;
    onClose();
    if (escapedImmediately) onFastClose?.();
  };

  const hitTarget = () => {
    if (!playing) return;
    setScore((current) => Math.max(0, current + (target.good ? 1 : -1)));
    setTarget(makeTarget());
  };

  return (
    <div className="game-backdrop" role="presentation">
      <section className="price-game" role="dialog" aria-modal="true" aria-labelledby="price-game-title">
        <div className="game-header">
          <div><span>20 秒休息一下</span><h2 id="price-game-title">價格守門員</h2></div>
          <button className="game-close" onClick={closeGame} aria-label="關閉小遊戲">×</button>
        </div>
        <p className="game-help">抓住綠色「−$2」，避開紅色「+$2」。看看你能守住幾次目標價！</p>
        <div className="game-hud"><strong>{score}<small> 分</small></strong><span>{timeLeft} 秒</span></div>
        <div className="game-arena">
          {playing
            ? <button
                key={target.id}
                className={`price-token ${target.good ? 'good' : 'bad'}`}
                style={{ left: `${target.x}%`, top: `${target.y}%` }}
                onClick={hitTarget}
                aria-label={target.good ? '正確目標價，得一分' : '錯誤漲價，會扣一分'}
              >{target.good ? '−$2' : '+$2'}</button>
            : <div className="game-result"><strong>{score >= 12 ? '守價高手！' : score >= 7 ? '判斷很準！' : '再試一次？'}</strong><span>本輪得到 {score} 分</span><button className="button primary" onClick={restart}>重新挑戰</button></div>}
        </div>
      </section>
    </div>
  );
}
