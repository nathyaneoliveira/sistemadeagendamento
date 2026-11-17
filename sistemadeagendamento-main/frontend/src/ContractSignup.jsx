import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BILLING_CYCLES, COMMERCIAL_PLAN_IDS, PLAN_CATALOG, getPlanBillingSummary } from '../../shared/planCatalog.js';
import { resolveApiUrl } from './apiConfig.js';

const API_URL = resolveApiUrl({ isProduction: import.meta.env.PROD, apiUrl: import.meta.env.VITE_API_URL });

export default function ContractSignup() {
  const [params] = useSearchParams();
  const checkoutResult = params.get('checkout');
  const plan = COMMERCIAL_PLAN_IDS.includes(params.get('plan')) ? params.get('plan') : 'professional';
  const cycle = Object.hasOwn(BILLING_CYCLES, params.get('cycle')) ? params.get('cycle') : 'monthly';
  const [form, setForm] = useState({ clinicName: '', ownerName: '', email: '', phone: '', password: '', plan, billingCycle: cycle });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const planInfo = PLAN_CATALOG[form.plan];
  const price = getPlanBillingSummary(form.plan, form.billingCycle).priceInCents;
  const currency = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${API_URL}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Não foi possível iniciar a contratação.');
      window.location.assign(payload.data.checkoutUrl);
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  }
  if (['success', 'pending'].includes(checkoutResult)) return <main className="auth-screen"><section className="auth-card">
    <p className="eyebrow">Mercado Pago</p><h1>Pagamento em confirmação</h1>
    <p className="muted-text">O acesso será liberado assim que recebermos a confirmação segura do Mercado Pago. Você pode tentar entrar em alguns instantes.</p>
    <Link className="commercial-button" to="/login">Ir para o login</Link>
  </section></main>;
  if (checkoutResult === 'failure') return <main className="auth-screen"><section className="auth-card">
    <p className="eyebrow">Mercado Pago</p><h1>Pagamento não concluído</h1>
    <p className="muted-text">Nenhuma assinatura foi ativada. Confira o pagamento e tente novamente.</p>
    <Link className="commercial-button" to="/contratacao">Tentar novamente</Link>
  </section></main>;

  return <main className="auth-screen"><section className="auth-card contract-card">
    <Link className="auth-back-link" to="/planos">← Voltar aos planos</Link><p className="eyebrow">Contratação segura · Mercado Pago</p><h1>Comece com sua clínica</h1>
    <p className="muted-text">{planInfo.name} · {BILLING_CYCLES[form.billingCycle].label} · {currency(price)} no período</p>
    <form className="auth-form" onSubmit={submit}>
      <label>Nome da clínica<input required maxLength="200" value={form.clinicName} onChange={(e) => setForm({ ...form, clinicName: e.target.value })} /></label>
      <label>Responsável<input required maxLength="200" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></label>
      <label>E-mail de acesso<input required type="email" maxLength="254" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      <label>Telefone (opcional)<input type="tel" maxLength="20" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      <label>Senha (mínimo de 12 caracteres)<input required type="password" minLength="12" maxLength="72" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
      <label>Plano<select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>{COMMERCIAL_PLAN_IDS.map((id) => <option key={id} value={id}>{PLAN_CATALOG[id].name}</option>)}</select></label>
      <label>Periodicidade<select value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>{Object.entries(BILLING_CYCLES).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? 'Preparando pagamento…' : `Continuar para pagar ${currency(price)}`}</button>
    </form>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    <p className="muted-text">A conta fica sem acesso às ferramentas da clínica até a confirmação do pagamento pelo Mercado Pago.</p>
  </section></main>;
}
