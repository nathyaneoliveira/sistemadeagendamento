import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { resolveApiUrl } from './apiConfig.js';

const API_URL = resolveApiUrl({ isProduction: import.meta.env.PROD, apiUrl: import.meta.env.VITE_API_URL });

async function call(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Não foi possível concluir a solicitação.');
  return payload;
}

function formatDate(value, timezone = 'UTC') {
  return new Date(value).toLocaleString('pt-BR', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' });
}

export default function PatientPortal() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('token')
    || new URLSearchParams(location.search).get('token')
    || '';
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [appointment, setAppointment] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    if (location.search) {
      window.history.replaceState(window.history.state, '', `${location.pathname}${location.hash}`);
    }
    call('/public/appointment-management/lookup', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((payload) => { if (active) setAppointment(payload.data); })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [location.hash, location.pathname, location.search, token]);

  async function requestLink(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const payload = await call('/public/appointment-management-link', { method: 'POST', body: JSON.stringify({ code, email }) });
      setMessage(payload.message);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm('Deseja cancelar este agendamento?')) return;
    setBusy(true); setError('');
    try { await call('/public/appointment-management/cancel', { method: 'POST', body: JSON.stringify({ token }) }); setAppointment((current) => ({ ...current, status: 'cancelled' })); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return <main className="auth-screen"><section className="auth-card" aria-labelledby="patient-portal-title">
    <a className="auth-back-link" href="/">← Voltar ao site</a>
    <p className="eyebrow">Portal do paciente</p><h1 id="patient-portal-title">Gerenciar agendamento</h1>
    {token ? appointment ? <>
      <p className="muted-text">{appointment.clinic_name}</p>
      <dl className="appointment-summary"><div><dt>Código</dt><dd>{appointment.code}</dd></div><div><dt>Data e horário</dt><dd>{formatDate(appointment.scheduled_start, appointment.timezone)}</dd></div><div><dt>Status</dt><dd>{appointment.status === 'cancelled' ? 'Cancelado' : 'Agendado'}</dd></div></dl>
      {appointment.status !== 'cancelled' ? <button type="button" className="danger-button" disabled={busy} onClick={cancel}>{busy ? 'Cancelando...' : 'Cancelar agendamento'}</button> : null}
    </> : <p className="muted-text">Carregando agendamento…</p> : <>
      <p className="muted-text">Informe o código recebido ao agendar e o e-mail cadastrado. Enviaremos um link seguro válido por 24 horas.</p>
      <form className="auth-form" onSubmit={requestLink}>
        <label>Código do agendamento<input required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="PUB-..." autoComplete="off" /></label>
        <label>E-mail<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link seguro'}</button>
      </form>
      {message ? <p className="success-text" role="status">{message}</p> : null}
    </>}
    {error ? <p className="error-text" role="alert">{error}</p> : null}
  </section></main>;
}
