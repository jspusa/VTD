import React, { useEffect, useState } from 'react';

export default function AdminGate({ open, onSuccess, onFail }) {
  const [password, setPassword] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setShake(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (password === '0713') {
      onSuccess();
      return;
    }
    setShake(true);
    window.setTimeout(onFail, 360);
  };

  return (
    <div className="admin-gate-backdrop" role="presentation">
      <form className={`admin-gate ${shake ? 'wrong' : ''}`} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="admin-gate-title">
        <span className="admin-lock" aria-hidden="true">⌁</span>
        <p>RESTRICTED PRICE CONTROL</p>
        <h2 id="admin-gate-title">管理者驗證</h2>
        <span className="admin-gate-copy">請輸入管理密碼，才能前往手動更新頁面。</span>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={password}
          onChange={(event) => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          aria-label="管理者密碼"
        />
        <div className="admin-gate-actions">
          <button type="button" className="button secondary" onClick={onFail}>關閉</button>
          <button type="submit" className="button primary">驗證並前往</button>
        </div>
      </form>
    </div>
  );
}
