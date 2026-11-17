import { useCallback, useEffect, useState } from 'react';
import { clinicApiFetch } from './clinicApi.js';

async function request(path, token, options = {}) {
  const response = await clinicApiFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Não foi possível carregar os dados.');
  return payload.data;
}

function today() { return new Date().toISOString().slice(0, 10); }
function monthAgo() { const date = new Date(); date.setDate(date.getDate() - 29); return date.toISOString().slice(0, 10); }

export default function ClinicTools({ tab, token, services = [], appointments = [] }) {
  const [rows, setRows] = useState([]);
  const [report, setReport] = useState(null);
  const [payments, setPayments] = useState([]);
  const [matches, setMatches] = useState([]);
  const [cancelledAppointmentId, setCancelledAppointmentId] = useState('');
  const [paymentForm, setPaymentForm] = useState({ appointmentId: '', amount: '', paymentMode: 'before' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ serviceId: '', name: '', phone: '', email: '', preferredFrom: today(), preferredTo: today(), preferredPeriod: 'any' });
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());

  const load = useCallback(async () => {
    setError('');
    try {
      if (tab === 'waitlist') setRows(await request('/waitlist', token) || []);
      else if (tab === 'payments') setPayments(await request('/payments', token) || []);
      else setReport(await request(`/reports/summary?from=${from}&to=${to}`, token));
    } catch (e) { setError(e.message); }
  }, [tab, token, from, to]);
  useEffect(() => { load(); }, [load]);

  async function addEntry(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request('/waitlist', token, { method: 'POST', body: JSON.stringify({ ...form, consent: true }) });
      setForm((old) => ({ ...old, name: '', phone: '', email: '' }));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function offer(id) {
    setBusy(true); setError('');
    try { await request(`/waitlist/${id}/status`, token, { method: 'PATCH', body: JSON.stringify({ status: 'offered' }) }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function findMatches(id) {
    setCancelledAppointmentId(id); setMatches([]); setError('');
    if (!id) return;
    try { setMatches(await request(`/waitlist/matches?appointmentId=${encodeURIComponent(id)}`, token) || []); }
    catch (e) { setError(e.message); }
  }

  async function addPayment(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request('/payments', token, { method: 'POST', body: JSON.stringify({ ...paymentForm, amount: Number(paymentForm.amount), provider: 'mercadopago', currency: 'BRL', status: 'pending' }) });
      setPaymentForm({ appointmentId: '', amount: '', paymentMode: 'before' }); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function pay(id) {
    setBusy(true); setError('');
    try { const data = await request(`/payments/${id}/checkout`, token, { method: 'POST', body: '{}' }); window.location.assign(data.checkoutUrl); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  if (tab === 'payments') return <>
    <section className="panel"><div className="panel-heading"><h3>Registrar cobrança de atendimento</h3><button className="secondary-button" onClick={load}>Atualizar</button></div>
      <form className="form-grid" onSubmit={addPayment}>
        <label>Agendamento<select required value={paymentForm.appointmentId} onChange={(e) => { const a = appointments.find((item) => item.id === e.target.value); setPaymentForm({ ...paymentForm, appointmentId: e.target.value, amount: a?.service_price_snapshot ?? paymentForm.amount }); }}><option value="">Selecione</option>{appointments.filter((item) => item.status !== 'cancelled').map((a) => <option key={a.id} value={a.id}>{a.patient_name} · {a.service_name_snapshot} · {new Date(a.scheduled_start).toLocaleString('pt-BR')}</option>)}</select></label>
        <label>Valor (R$)<input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></label>
        <label>Momento<select value={paymentForm.paymentMode} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value })}><option value="before">Antes do atendimento</option><option value="after">Depois do atendimento</option></select></label>
        <button className="form-wide" disabled={busy || !appointments.length}>{busy ? 'Salvando…' : 'Registrar cobrança'}</button>
      </form>
    </section>
    <section className="panel"><h3>Pagamentos</h3>{payments.length ? <div className="table-scroll"><table><thead><tr><th>Agendamento</th><th>Valor</th><th>Provedor</th><th>Status</th><th>Ação</th></tr></thead><tbody>{payments.map((p) => <tr key={p.id}><td>{p.appointment_code || '—'}</td><td>{Number(p.amount).toLocaleString('pt-BR', { style: 'currency', currency: p.currency || 'BRL' })}</td><td>{p.provider}</td><td>{p.status === 'paid' ? 'Pago' : p.status === 'pending' ? 'Pendente' : p.status}</td><td>{p.status === 'pending' ? <button className="secondary-button" disabled={busy} onClick={() => pay(p.id)}>Abrir Mercado Pago</button> : p.paid_at ? new Date(p.paid_at).toLocaleString('pt-BR') : '—'}</td></tr>)}</tbody></table></div> : <p className="muted-text">Nenhum pagamento registrado.</p>}</section>
  </>;

  if (tab === 'waitlist') return <>
    <section className="panel">
      <div className="panel-heading"><h3>Adicionar à lista de espera</h3><button type="button" className="secondary-button" onClick={load}>Atualizar</button></div>
      <form className="form-grid" onSubmit={addEntry}>
        <label>Serviço<select required value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}><option value="">Selecione</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Nome<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Telefone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Disponível a partir de<input type="date" required value={form.preferredFrom} onChange={(e) => setForm({ ...form, preferredFrom: e.target.value })} /></label>
        <label>Até<input type="date" required value={form.preferredTo} onChange={(e) => setForm({ ...form, preferredTo: e.target.value })} /></label>
        <label>Período<select value={form.preferredPeriod} onChange={(e) => setForm({ ...form, preferredPeriod: e.target.value })}><option value="any">Qualquer horário</option><option value="morning">Manhã</option><option value="afternoon">Tarde</option><option value="evening">Noite</option></select></label>
        <label className="form-wide"><span><input type="checkbox" required /> Confirmo que o paciente autorizou o contato para oferecer horários vagos.</span></label>
        <button className="form-wide" disabled={busy}>{busy ? 'Salvando...' : 'Adicionar paciente'}</button>
      </form>
    </section>
    <section className="panel"><div className="panel-heading"><h3>Preencher horário cancelado</h3></div>
      <label>Agendamento cancelado<select value={cancelledAppointmentId} onChange={(e) => findMatches(e.target.value)}><option value="">Selecione</option>{appointments.filter((item) => item.status === 'cancelled').map((item) => <option key={item.id} value={item.id}>{item.service_name_snapshot} · {new Date(item.scheduled_start).toLocaleString('pt-BR')}</option>)}</select></label>
      {cancelledAppointmentId && !matches.length ? <p className="muted-text">Nenhuma pessoa com preferência compatível foi encontrada.</p> : null}
      {matches.length ? <div className="table-scroll"><table><thead><tr><th>Paciente</th><th>Contato</th><th>Preferência</th><th>Ação</th></tr></thead><tbody>{matches.map((m) => <tr key={m.id}><td>{m.patient_name}</td><td>{m.patient_phone}</td><td>{m.preferred_from} a {m.preferred_to}</td><td><button type="button" className="secondary-button" disabled={busy} onClick={() => offer(m.id)}>Marcar oferta enviada</button></td></tr>)}</tbody></table></div> : null}
    </section>
    <section className="panel"><div className="panel-heading"><h3>Pessoas aguardando</h3><span>{rows.length} ativas</span></div>
      {rows.length ? <div className="table-scroll"><table><thead><tr><th>Paciente</th><th>Contato</th><th>Serviço</th><th>Preferência</th><th>Ação</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.patient_name}</td><td>{r.patient_phone}{r.patient_email ? <small className="muted-text"><br />{r.patient_email}</small> : null}</td><td>{r.service_name}</td><td>{r.preferred_from} a {r.preferred_to} · {r.preferred_period}</td><td>{r.status === 'waiting' ? <button className="secondary-button" disabled={busy} onClick={() => offer(r.id)}>Marcar oferta enviada</button> : 'Oferta enviada'}</td></tr>)}</tbody></table></div> : <p className="muted-text">A lista está vazia.</p>}
    </section>
  </>;

  const summary = report?.summary || {};
  const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return <>
    <section className="panel"><div className="panel-heading"><h3>Período do relatório</h3><button className="secondary-button" onClick={load}>Atualizar</button></div><div className="form-grid"><label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div></section>
    <section className="stats-grid">{[['Agendamentos', summary.appointments], ['Concluídos', summary.completed], ['Cancelados', summary.cancelled], ['Faltas', summary.no_shows], ['Valor dos serviços concluídos', currency(summary.completed_service_value)], ['Pagamentos registrados', currency(summary.received)]].map(([label, value]) => <article className="stat-card" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</section>
    <section className="panel"><h3>Resumo por serviço</h3>{report?.services?.length ? <div className="table-scroll"><table><thead><tr><th>Serviço</th><th>Consultas</th><th>Concluídas</th><th>Canceladas</th><th>Valor concluído</th></tr></thead><tbody>{report.services.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.appointments}</td><td>{r.completed}</td><td>{r.cancelled}</td><td>{currency(r.completed_service_value)}</td></tr>)}</tbody></table></div> : <p className="muted-text">Sem dados no período escolhido.</p>}</section>
    <section className="panel"><h3>Resumo por profissional</h3>{report?.professionals?.length ? <div className="table-scroll"><table><thead><tr><th>Profissional</th><th>Consultas</th><th>Concluídas</th><th>Canceladas</th><th>Faltas</th></tr></thead><tbody>{report.professionals.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.appointments}</td><td>{r.completed}</td><td>{r.cancelled}</td><td>{r.no_shows}</td></tr>)}</tbody></table></div> : <p className="muted-text">Sem dados no período escolhido.</p>}</section>
  </>;
}
