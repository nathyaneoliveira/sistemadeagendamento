import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveApiUrl } from './apiConfig.js';
import { ThemeToggle, useTheme } from './theme.jsx';

const API_URL = resolveApiUrl({
  isProduction: import.meta.env.PROD,
  apiUrl: import.meta.env.VITE_API_URL,
});
const PLANS = [
  { value: 'essential', label: 'Essencial' },
  { value: 'professional', label: 'Profissional' },
  { value: 'complete', label: 'Completo (legado)' },
  { value: 'premium', label: 'Premium (legado)' },
];
const STATUSES = [
  { value: 'trialing', label: 'Em avaliação' },
  { value: 'active', label: 'Ativa' },
  { value: 'past_due', label: 'Inadimplente' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'expired', label: 'Vencida' },
];
const CYCLES = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

function formatMoney(cents) {
  return cents === null || cents === undefined
    ? 'Não disponível'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

function formatPeriod(value) {
  const day = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || '').slice(0, 10);
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function statusLabel(status) {
  return STATUSES.find((item) => item.value === status)?.label || status || 'Sem assinatura';
}

async function request(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}/platform${path}`, { ...options, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(payload?.message || 'Não foi possível concluir a solicitação.'),
      { status: response.status }
    );
  }
  return payload;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth() {
  return `${today().slice(0, 8)}01`;
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="platform-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.totalPages < 1) return null;
  return (
    <div className="platform-pagination">
      <span>{pagination.total} resultado(s) · página {pagination.page} de {pagination.totalPages}</span>
      <div>
        <button type="button" className="secondary-button" onClick={() => onPage(pagination.page - 1)} disabled={pagination.page <= 1}>Anterior</button>
        <button type="button" className="secondary-button" onClick={() => onPage(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Próxima</button>
      </div>
    </div>
  );
}

export default function PlatformAdmin() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sectionPath = location.pathname.replace(/\/+$/, '');
  const section = sectionPath === '/platform-admin'
    ? 'overview'
    : sectionPath.slice('/platform-admin/'.length);
  const validSection = ['overview', 'clinics', 'subscriptions'].includes(section);
  const [dashboard, setDashboard] = useState(null);
  const [clinicResult, setClinicResult] = useState(null);
  const [subscriptionResult, setSubscriptionResult] = useState(null);
  const [selectedClinic, setSelectedClinic] = useState(null);
  const [period, setPeriod] = useState({ from: startOfMonth(), to: today() });
  const [clinicFilters, setClinicFilters] = useState({ search: '', status: '', plan: '', clinicStatus: '' });
  const [clinicSearchDraft, setClinicSearchDraft] = useState('');
  const [subscriptionFilters, setSubscriptionFilters] = useState({ status: '', plan: '', billingCycle: '' });
  const [page, setPage] = useState(1);

  const clearSession = useCallback(() => {
    setToken('');
    setUser(null);
    setCredentials((previous) => ({ ...previous, password: '' }));
    setDashboard(null);
    setClinicResult(null);
    setSubscriptionResult(null);
    setSelectedClinic(null);
    setClinicFilters({ search: '', status: '', plan: '', clinicStatus: '' });
    setClinicSearchDraft('');
    setSubscriptionFilters({ status: '', plan: '', billingCycle: '' });
    setPage(1);
  }, []);

  useEffect(() => {
    document.title = user ? 'Plataforma | NOA CONNECT' : 'Administração | NOA CONNECT';
    return () => {
      document.title = 'NOA CONNECT | Gestão de clínicas';
    };
  }, [user]);

  useEffect(() => {
    if (!validSection) {
      navigate('/', { replace: true });
      return undefined;
    }
    if (!token) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    let path;
    if (section === 'overview') {
      query.set('from', period.from);
      query.set('to', period.to);
      path = `/dashboard?${query}`;
    } else if (section === 'clinics') {
      for (const [key, value] of Object.entries(clinicFilters)) {
        if (value) query.set(key, value);
      }
      path = `/clinics?${query}`;
    } else {
      for (const [key, value] of Object.entries(subscriptionFilters)) {
        if (value) query.set(key, value);
      }
      path = `/subscriptions?${query}`;
    }
    request(path, token)
      .then((payload) => {
        if (cancelled) return;
        if (section === 'overview') setDashboard(payload.data);
        if (section === 'clinics') setClinicResult(payload);
        if (section === 'subscriptions') setSubscriptionResult(payload);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError.message);
        if (requestError.status === 401) {
          clearSession();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession, clinicFilters, navigate, page, period, section, subscriptionFilters, token, validSection]);

  useEffect(() => {
    if (!location.pathname.startsWith('/platform-admin')) return;
    if (
      location.pathname !== '/platform-admin' &&
      !['/platform-admin/clinics', '/platform-admin/subscriptions'].includes(sectionPath)
    ) {
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate, sectionPath]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = await request('/auth/login', '', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      if (!payload?.data?.token || !payload?.data?.user) {
        throw new Error('A resposta não contém uma sessão administrativa válida.');
      }
      setToken(payload.data.token);
      setUser(payload.data.user);
      setCredentials((previous) => ({ ...previous, password: '' }));
      setPage(1);
      navigate('/platform-admin', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await request('/auth/logout', token, { method: 'POST' });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setToken('');
      setUser(null);
      setDashboard(null);
      setClinicResult(null);
      setSubscriptionResult(null);
      setSelectedClinic(null);
      setLoading(false);
      navigate('/platform-admin', { replace: true });
    }
  };

  const openClinic = async (clinicId) => {
    setLoading(true);
    setError('');
    setSelectedClinic(null);
    try {
      const payload = await request(`/clinics/${encodeURIComponent(clinicId)}`, token);
      setSelectedClinic(payload.data);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.status === 401) clearSession();
    } finally {
      setLoading(false);
    }
  };

  if (!token || !user) {
    return (
      <div className="auth-screen platform-auth-screen">
        <div className="auth-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        <section className="auth-card">
          <a className="auth-back-link" href="/login">Acesso da clínica</a>
          <div className="auth-brand"><img className="brand-logo" src="/noa-connect-logo.png" alt="NOA CONNECT" /></div>
          <p className="eyebrow">Administração da plataforma</p>
          <h1>Área do proprietário</h1>
          <p className="muted-text auth-description">Entre com a conta administrativa global da NOA CONNECT.</p>
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              E-mail
              <input
                type="email"
                autoComplete="username"
                value={credentials.email}
                onChange={(event) => setCredentials((previous) => ({ ...previous, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                value={credentials.password}
                onChange={(event) => setCredentials((previous) => ({ ...previous, password: event.target.value }))}
                required
              />
            </label>
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            <button type="submit" disabled={loading}>{loading ? 'Autenticando...' : 'Entrar'}</button>
          </form>
        </section>
      </div>
    );
  }

  const metrics = dashboard?.metrics;
  const selectedPagination = section === 'clinics'
    ? clinicResult?.pagination
    : subscriptionResult?.pagination;
  const subscriptions = subscriptionResult?.data || [];
  const contractsTimeline = dashboard?.contractsTimeline || [];
  const timelineMaximum = Math.max(...contractsTimeline.map((item) => item.contracts), 1);

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <a className="platform-brand" href="/platform-admin" aria-label="NOA CONNECT, painel global">
          <img className="brand-logo" src="/noa-connect-logo.png" alt="NOA CONNECT" />
        </a>
        <p className="eyebrow">Administração global</p>
        <nav className="platform-nav" aria-label="Administração da plataforma">
          {[
            ['overview', 'Visão geral'],
            ['clinics', 'Clínicas'],
            ['subscriptions', 'Assinaturas'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`nav-link${section === value ? ' active' : ''}`}
              onClick={() => {
                navigate(value === 'overview' ? '/platform-admin' : `/platform-admin/${value}`);
                setPage(1);
                setSelectedClinic(null);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="platform-admin-user">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
          <button type="button" className="secondary-button" onClick={handleLogout} disabled={loading}>Sair</button>
          <a href="/login">Painel da clínica</a>
        </div>
      </aside>

      <main className="platform-main">
        <header className="platform-topbar">
          <div>
            <p className="eyebrow">NOA CONNECT · Proprietário</p>
            <h1>{section === 'overview' ? 'Visão geral' : section === 'clinics' ? 'Clínicas' : 'Assinaturas'}</h1>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        {error ? <p className="error-text page-message" role="alert">{error}</p> : null}
        {loading ? <p className="muted-text" role="status">Carregando...</p> : null}

        {section === 'overview' ? (
          <div className="platform-content">
            <section className="platform-filter-bar" aria-label="Filtro do período">
              <label>De <input type="date" value={period.from} max={period.to} onChange={(event) => setPeriod((previous) => ({ ...previous, from: event.target.value }))} /></label>
              <label>Até <input type="date" value={period.to} min={period.from} max={today()} onChange={(event) => setPeriod((previous) => ({ ...previous, to: event.target.value }))} /></label>
            </section>
            <section className="platform-metrics-grid" aria-label="Indicadores da plataforma">
              <MetricCard label="Clínicas cadastradas" value={metrics?.totalClinics ?? '—'} />
              <MetricCard label="Assinaturas ativas" value={metrics?.activeSubscriptions ?? '—'} detail="Dentro do período contratado" />
              <MetricCard label="Novas assinaturas registradas" value={metrics?.newContracts ?? '—'} detail="No período selecionado" />
              <MetricCard label="Assinaturas pendentes" value={metrics?.pendingSubscriptions?.supported ? metrics.pendingSubscriptions.count : 'Não suportado'} detail="O status pending não existe no modelo atual" />
              <MetricCard label="Inadimplentes" value={metrics?.delinquentSubscriptions ?? '—'} />
              <MetricCard label="Canceladas" value={metrics?.cancelledSubscriptions ?? '—'} />
              <MetricCard label="Vencidas" value={metrics?.expiredSubscriptions ?? '—'} />
              <MetricCard label="MRR estimado" value={formatMoney(metrics?.mrrEstimateInCents)} detail="Preço de catálogo, apenas assinaturas ativas" />
              <MetricCard label="ARR estimado" value={formatMoney(metrics?.arrEstimateInCents)} detail="MRR × 12; não representa receita recebida" />
              <MetricCard label="Ativas sem pagamento confirmado" value={metrics?.activeSubscriptionsWithoutPaymentConfirmation ?? '—'} />
            </section>
            <section className="platform-two-column">
              <article className="platform-panel platform-chart-panel">
                <h2>Evolução das contratações</h2>
                {contractsTimeline.length ? (
                  <div className="platform-chart" role="img" aria-label="Contratos por período">
                    <svg
                      width={Math.max(contractsTimeline.length * 36, 360)}
                      height="180"
                      viewBox={`0 0 ${contractsTimeline.length * 36} 180`}
                      aria-hidden="true"
                    >
                      {contractsTimeline.map((item, index) => {
                        const barHeight = item.contracts ? Math.max(4, (item.contracts / timelineMaximum) * 112) : 0;
                        const x = index * 36 + 9;
                        const label = formatPeriod(item.period);
                        return (
                          <g key={item.period}>
                            <title>{label}: {item.contracts} contratação(ões)</title>
                            <rect className="platform-chart-bar" x={x} y={132 - barHeight} width="18" height={barHeight} rx="4" />
                            <text className="platform-chart-count" x={x + 9} y={Math.max(12, 124 - barHeight)} textAnchor="middle">{item.contracts}</text>
                            <text className="platform-chart-label" x={x + 9} y="160" textAnchor="middle">{label}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                ) : <p className="muted-text">Sem contratações no período.</p>}
              </article>
              <article className="platform-panel">
                <h2>Distribuição por plano</h2>
                {dashboard?.planDistribution?.length ? dashboard.planDistribution.map((item) => (
                  <div className="platform-plan-row" key={item.plan}>
                    <span>{item.planName}</span><strong>{item.clinics}</strong>
                  </div>
                )) : <p className="muted-text">Ainda não há assinaturas registradas.</p>}
              </article>
              <article className="platform-panel">
                <h2>Recebimentos e cobranças SaaS</h2>
                <p>Pagamentos confirmados: <strong>não disponíveis</strong></p>
                <p>Cobranças pendentes: <strong>não disponíveis</strong></p>
                <p className="muted-text">Não há gateway nem pagamentos vinculados às assinaturas. Os pagamentos existentes são de agendamentos das clínicas.</p>
              </article>
            </section>
            <article className="platform-panel">
              <h2>Eventos recentes</h2>
              {dashboard?.recentEvents?.length ? (
                <div className="platform-event-list">
                  {dashboard.recentEvents.map((event) => (
                    <div className="platform-event" key={`${event.event_type}-${event.event_id}`}>
                      <span className="platform-event-dot" aria-hidden="true" />
                      <div><strong>{event.clinic_name}</strong><p>{event.event_type.replaceAll('.', ' ')}{event.plan ? ` · ${event.plan}` : ''}{event.status ? ` · ${statusLabel(event.status)}` : ''}</p></div>
                      <time>{formatDate(event.occurred_at)}</time>
                    </div>
                  ))}
                </div>
              ) : <p className="muted-text">Nenhum evento encontrado.</p>}
            </article>
            <p className="platform-disclaimer">Assinaturas pendentes e cobrança SaaS não estão modeladas; MRR/ARR são estimativas do catálogo atual, sem comprovação de recebimento.</p>
          </div>
        ) : null}

        {section === 'clinics' ? (
          <div className="platform-content">
            <form className="platform-filter-bar platform-clinic-filters" onSubmit={(event) => { event.preventDefault(); setClinicFilters((previous) => ({ ...previous, search: clinicSearchDraft.trim() })); setPage(1); }}>
              <label>Pesquisar<input value={clinicSearchDraft} onChange={(event) => setClinicSearchDraft(event.target.value)} placeholder="Clínica, e-mail ou administrador" maxLength={100} /></label>
              <label>Situação da assinatura<select value={clinicFilters.status} onChange={(event) => { setClinicFilters((previous) => ({ ...previous, status: event.target.value })); setPage(1); }}><option value="">Todas</option>{STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Plano<select value={clinicFilters.plan} onChange={(event) => { setClinicFilters((previous) => ({ ...previous, plan: event.target.value })); setPage(1); }}><option value="">Todos</option>{PLANS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Clínica<select value={clinicFilters.clinicStatus} onChange={(event) => { setClinicFilters((previous) => ({ ...previous, clinicStatus: event.target.value })); setPage(1); }}><option value="">Todas</option><option value="active">Ativa</option><option value="inactive">Inativa</option><option value="suspended">Suspensa</option></select></label>
              <button type="submit" className="secondary-button">Aplicar pesquisa</button>
            </form>
            <div className="platform-table-wrap">
              <table className="platform-table">
                <thead><tr><th>Clínica</th><th>Administrador</th><th>Plano / assinatura</th><th>Renovação</th><th>Cadastro</th><th>Financeiro</th><th /></tr></thead>
                <tbody>
                  {(clinicResult?.data || []).map((clinic) => (
                    <tr key={clinic.id}>
                      <td><strong>{clinic.trade_name || clinic.name}</strong><small>{clinic.contact_email || clinic.contact_phone || 'Sem contato cadastrado'}</small></td>
                      <td>{clinic.administrator_name || '—'}<small>{clinic.administrator_email || ''}</small></td>
                      <td>{clinic.planName || 'Sem plano'}<small>{statusLabel(clinic.subscription_status)}{clinic.billing_cycle ? ` · ${CYCLES[clinic.billing_cycle] || clinic.billing_cycle}` : ''}</small></td>
                      <td>{formatDate(clinic.renewal_at)}</td>
                      <td>{formatDate(clinic.created_at)}</td>
                      <td>Não disponível</td>
                      <td><button type="button" className="secondary-button" onClick={() => openClinic(clinic.id)}>Detalhes</button></td>
                    </tr>
                  ))}
                  {!clinicResult?.data?.length ? <tr><td colSpan="7">Nenhuma clínica encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <Pagination pagination={clinicResult?.pagination} onPage={setPage} />
          </div>
        ) : null}

        {section === 'subscriptions' ? (
          <div className="platform-content">
            <div className="platform-filter-bar">
              <label>Status<select value={subscriptionFilters.status} onChange={(event) => { setSubscriptionFilters((previous) => ({ ...previous, status: event.target.value })); setPage(1); }}><option value="">Todos</option>{STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Plano<select value={subscriptionFilters.plan} onChange={(event) => { setSubscriptionFilters((previous) => ({ ...previous, plan: event.target.value })); setPage(1); }}><option value="">Todos</option>{PLANS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Periodicidade<select value={subscriptionFilters.billingCycle} onChange={(event) => { setSubscriptionFilters((previous) => ({ ...previous, billingCycle: event.target.value })); setPage(1); }}><option value="">Todas</option><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></select></label>
            </div>
            <div className="platform-table-wrap">
              <table className="platform-table">
                <thead><tr><th>Clínica</th><th>Plano</th><th>Contratada em</th><th>Periodicidade</th><th>Status</th><th>Período até</th><th>Preço de catálogo</th><th>Pagamento</th></tr></thead>
                <tbody>
                  {subscriptions.map((subscription) => (
                    <tr key={subscription.id}>
                      <td>{subscription.clinic_name}<small>{subscription.administrator_name || subscription.clinic_email}</small></td>
                      <td>{subscription.planName}</td>
                      <td>{formatDate(subscription.created_at)}</td>
                      <td>{CYCLES[subscription.billing_cycle] || subscription.billing_cycle}</td>
                      <td>{statusLabel(subscription.status)}</td>
                      <td>{formatDate(subscription.current_period_end)}</td>
                      <td>{formatMoney(subscription.priceInCents)}<small>total do ciclo</small></td>
                      <td>Não integrado</td>
                    </tr>
                  ))}
                  {!subscriptions.length ? <tr><td colSpan="8">Nenhuma assinatura encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <Pagination pagination={subscriptionResult?.pagination} onPage={setPage} />
            <p className="platform-disclaimer">Planos e valores vêm do catálogo compartilhado. Esta tela é somente leitura: mudanças de status exigem fluxo e auditoria próprios.</p>
          </div>
        ) : null}
      </main>

      {selectedClinic ? (
        <div className="platform-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedClinic(null); }}>
          <section className="platform-modal" role="dialog" aria-modal="true" aria-labelledby="platform-clinic-detail-heading">
            <button type="button" className="secondary-button platform-modal-close" onClick={() => setSelectedClinic(null)}>Fechar</button>
            <p className="eyebrow">Consulta administrativa · somente leitura</p>
            <h2 id="platform-clinic-detail-heading">{selectedClinic.clinic.trade_name || selectedClinic.clinic.name}</h2>
            <dl className="platform-detail-grid">
              <div><dt>Cadastro</dt><dd>{formatDate(selectedClinic.clinic.created_at)}</dd></div>
              <div><dt>Contato</dt><dd>{selectedClinic.clinic.contact_email || '—'} · {selectedClinic.clinic.contact_phone || '—'}</dd></div>
              <div><dt>Administrador</dt><dd>{selectedClinic.clinic.administrator_name || '—'} · {selectedClinic.clinic.administrator_email || '—'}</dd></div>
              <div><dt>Assinatura atual</dt><dd>{selectedClinic.clinic.planName || 'Sem plano'} · {statusLabel(selectedClinic.clinic.subscription_status)}</dd></div>
              <div><dt>Periodicidade</dt><dd>{CYCLES[selectedClinic.clinic.billing_cycle] || '—'}</dd></div>
              <div><dt>Renovação / vencimento</dt><dd>{formatDate(selectedClinic.clinic.current_period_end)}</dd></div>
            </dl>
            <h3>Histórico de assinaturas</h3>
            {selectedClinic.subscriptions.map((subscription) => (
              <p key={subscription.id}>{subscription.planName} · {CYCLES[subscription.billing_cycle] || subscription.billing_cycle} · {statusLabel(subscription.status)} · {formatDate(subscription.created_at)}</p>
            ))}
            <h3>Eventos de assinatura</h3>
            {selectedClinic.subscriptionEvents.map((event) => (
              <p key={event.id}>{event.action.replaceAll('.', ' ')} · {event.actor_name || 'Sistema'} · {formatDate(event.created_at)}</p>
            ))}
            <p className="platform-disclaimer">{selectedClinic.financialNote}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
