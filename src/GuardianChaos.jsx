import React, { useEffect, useState } from 'react';

const taunts = ['太貴了！', '價格 −2！', '守門失敗', 'NOPE', '毛利震怒', '💥', '📉', '又亂調！'];

function Guardian({ mood = 'angry' }) {
  return (
    <div className={`guardian-character ${mood}`} aria-hidden="true">
      <div className="guardian-siren" />
      <div className="guardian-head">
        <span className="guardian-brow left" /><span className="guardian-brow right" />
        <span className="guardian-eye left" /><span className="guardian-eye right" />
        <span className="guardian-mouth" />
      </div>
      <div className="guardian-body"><span>−$2</span></div>
      <div className="guardian-arm left" /><div className="guardian-arm right" />
    </div>
  );
}

function MiniGuardGame({ index }) {
  const good = index % 4 !== 0;
  return (
    <div className="takeover-game" style={{ '--delay': `${(index % 7) * -0.31}s`, '--tilt': `${(index % 5) - 2}deg` }}>
      <div className="takeover-game-head"><b>價格守門員 #{String(index + 1).padStart(2, '0')}</b><span>20 秒</span></div>
      <div className="takeover-arena"><i className={good ? 'good' : 'bad'}>{good ? '−$2' : '+$2'}</i><em>{index % 3 === 0 ? '快點我！' : '不准亂調！'}</em></div>
    </div>
  );
}

export default function GuardianChaos({ mode }) {
  const [stage, setStage] = useState('idle');

  useEffect(() => {
    if (mode !== 'rage') return undefined;
    document.documentElement.classList.add('guardian-rage');
    setStage('closing');
    const blackout = window.setTimeout(() => setStage('blackout'), 720);
    const reveal = window.setTimeout(() => setStage('reveal'), 1_250);
    const rage = window.setTimeout(() => setStage('rage'), 2_850);
    return () => {
      window.clearTimeout(blackout);
      window.clearTimeout(reveal);
      window.clearTimeout(rage);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'takeover') return undefined;
    setStage('plea');
    const swarm = window.setTimeout(() => setStage('swarm'), 2_900);
    return () => window.clearTimeout(swarm);
  }, [mode]);

  useEffect(() => {
    if (stage !== 'rage') return undefined;

    const explode = (event) => {
      const target = event.target.closest('h1, h2, p, th, td, strong, span, a, button, label, small');
      if (!target || target.dataset.chaosHit || target.closest('.guardian-chaos, .game-launch, .admin-gate')) return;
      const text = target.textContent?.trim();
      if (!text) return;
      target.dataset.chaosHit = 'true';
      target.classList.add('chaos-target-hit');
      const rect = target.getBoundingClientRect();
      const burst = document.createElement('b');
      burst.className = 'chaos-burst';
      burst.textContent = Math.random() > .35 ? '−2!' : taunts[Math.floor(Math.random() * taunts.length)];
      burst.style.left = `${rect.left + rect.width / 2}px`;
      burst.style.top = `${rect.top + rect.height / 2}px`;
      document.body.appendChild(burst);
      window.setTimeout(() => target.classList.add('chaos-gone'), 280);
      window.setTimeout(() => burst.remove(), 950);
    };

    const surprise = window.setInterval(() => {
      const flyer = document.createElement('span');
      flyer.className = 'chaos-flyer';
      flyer.textContent = taunts[Math.floor(Math.random() * taunts.length)];
      flyer.style.top = `${10 + Math.random() * 75}vh`;
      flyer.style.setProperty('--fly-color', ['#b6ff00', '#ff3d71', '#47e8ff', '#ffe600'][Math.floor(Math.random() * 4)]);
      document.body.appendChild(flyer);
      window.setTimeout(() => flyer.remove(), 2_400);
    }, 1_850);

    document.addEventListener('pointerover', explode);
    return () => {
      document.removeEventListener('pointerover', explode);
      window.clearInterval(surprise);
    };
  }, [stage]);

  if (!mode || stage === 'idle') return null;

  if (stage === 'swarm') {
    return (
      <div className="guardian-chaos guardian-takeover" role="alert" aria-label="價格守門員全面接管">
        <div className="takeover-marquee"><span>⚠ PRICE GUARDIAN HAS TAKEN OVER · 全面 −$2 · 不要再亂調價格 · </span></div>
        <div className="takeover-grid">{Array.from({ length: 24 }, (_, index) => <MiniGuardGame key={index} index={index} />)}</div>
        <div className="takeover-stamp">ONLY REFRESH<br />CAN SAVE YOU</div>
      </div>
    );
  }

  if (stage === 'plea') {
    return (
      <div className="guardian-chaos guardian-plea" role="alert">
        <Guardian mood="pleading" />
        <div className="guardian-speech"><span>拜託啦！！！</span><strong>不要再亂調價格了！</strong><small>你是不是以為我只是一個小遊戲？</small></div>
      </div>
    );
  }

  return (
    <div className={`guardian-chaos rage-sequence ${stage}`} role="alert">
      <div className="rage-door left"><span>PRICE</span></div>
      <div className="rage-door right"><span>GUARD</span></div>
      <div className="rage-warning">
        <Guardian />
        <p>WARNING · PRICE POLICY VIOLATION</p>
        <h2>守門員<br /><em>生氣了！</em></h2>
        <span>滑鼠最好不要亂動喔。</span>
      </div>
      {stage === 'rage' && <div className="rage-corner-note">第二次點「價格守門員」<br />會發生更糟的事 ↘</div>}
    </div>
  );
}
