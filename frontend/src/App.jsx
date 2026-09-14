import { useEffect, useMemo, useState } from 'react';

const API_URL = 'http://localhost:4000/api';

const defaultForm = {
  clinicId: '11111111-1111-1111-1111-111111111111',
  email: 'admin@clinica.com',
  password: '123456',
};

export default function App() {
  const [logged, setLogged] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [form, setForm] = useState(defaultForm);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState({ appointments: [], professionals: [] });

  useEffect(() => {
    const token = localStorage.getItem('clinic_token');
    if (token) {
      setLogged(true);
      fetchDashboard(token);
    }
  }, []);

  const fetchDashboard = async (token) => {
    try {
      const [appointmentsRes, professionalsRes] = await Promise.all([
        fetch(`${API_URL}/appointments`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/professionals`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const appointmentsData = await appointmentsRes.json();
      const professionalsData = await professionalsRes.json();

      setDashboard({
        appointments: appointmentsData?.data || [],
        professionals: professionalsData?.data || [],
      });
    } catch (err) {
      console.error(err);
    }
  };

  const activeTabLabel = useMemo(() => {
    const labels = {
      dashboard: 'Dashboard',
      professionals: 'Profissionais',
      schedule: 'Agenda',
      appointments: 'Consultas',
    };

    return labels[tab] || 'Dashboard';
  }, [tab]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: form.clinicId,
          email: form.email,
          password: form.password,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload?.data?.token) {
        throw new Error(payload?.message || 'Falha ao autenticar.');
      }

      localStorage.setItem('clinic_token', payload.data.token);
      setUser(payload.data.user);
      setLogged(true);
      await fetchDashboard(payload.data.token);
    } catch (err) {
      setError(err.message || 'Erro ao fazer login.');
    } finally {
      setLoading(false);
    }
  };

  const dashboardStats = [
    { label: 'Consultas hoje', value: String(dashboard.appointments.length || 0) },
    { label: 'Próximas', value: String(Math.max(dashboard.appointments.length, 1)) },
    { label: 'Profissionais', value: String(dashboard.professionals.length || 0) },
    { label: 'Status', value: user?.role || 'admin' },
  ];

  const renderAppointments = dashboard.appointments.length
    ? dashboard.appointments
    : [
        { patient_id: 'demo-1', patient_name: 'Maria Silva', professional_name: 'Dr. João', scheduled_start: '2026-09-14T09:00:00Z', status: 'scheduled' },
        { patient_id: 'demo-2', patient_name: 'Pedro Santos', professional_name: 'Dra. Ana', scheduled_start: '2026-09-14T10:30:00Z', status: 'confirmed' },
      ];

  const renderProfessionals = dashboard.professionals.length
    ? dashboard.professionals
    : [
        { id: 'p1', name: 'Dr. João', specialty_name: 'Cardiologia', status: 'active' },
        { id: 'p2', name: 'Dra. Ana', specialty_name: 'Dermatologia', status: 'active' },
      ];

  if (!logged) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="eyebrow">Sistema de agendamento</p>
          <h1>Entrar</h1>
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              Clínica
              <input
                type="text"
                value={form.clinicId}
                onChange={(event) => handleChange('clinicId', event.target.value)}
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => handleChange('email', event.target.value)}
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={form.password}
                onChange={(event) => handleChange('password', event.target.value)}
              />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>Clínica</span>
          <strong>Agenda</strong>
        </div>

        <nav className="nav">
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button className={tab === 'professionals' ? 'active' : ''} onClick={() => setTab('professionals')}>Profissionais</button>
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>Agenda</button>
          <button className={tab === 'appointments' ? 'active' : ''} onClick={() => setTab('appointments')}>Consultas</button>
          <button
            className="logout-button"
            onClick={() => {
              localStorage.removeItem('clinic_token');
              setLogged(false);
              setUser(null);
            }}
          >
            Sair
          </button>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Painel administrativo</p>
            <h2>{activeTabLabel}</h2>
          </div>
          <div className="user-box">
            <strong>{user?.name || 'Usuário'}</strong>
            <small>{user?.role || 'admin'}</small>
          </div>
        </header>

        {tab === 'dashboard' && (
          <>
            <section className="stats-grid">
              {dashboardStats.map((item) => (
                <article key={item.label} className="stat-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </section>

            <section className="panel">
              <h3>Próximas consultas</h3>
              <table>
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Profissional</th>
                    <th>Horário</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {renderAppointments.map((item) => (
                    <tr key={item.patient_id || item.id || `${item.patient_name}-${item.scheduled_start}`}>
                      <td>{item.patient_name || item.patient || 'Paciente'}</td>
                      <td>{item.professional_name || item.professional || 'Profissional'}</td>
                      <td>{item.scheduled_start ? new Date(item.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : item.time}</td>
                      <td><span className="badge">{item.status || 'scheduled'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === 'professionals' && (
          <section className="panel">
            <h3>Profissionais</h3>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Especialidade</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {renderProfessionals.map((item) => (
                  <tr key={item.id || item.name}>
                    <td>{item.name}</td>
                    <td>{item.specialty_name || item.specialty || 'Sem especialidade'}</td>
                    <td><span className="badge muted">{item.status || 'active'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === 'schedule' && (
          <section className="panel schedule-grid">
            <div className="day-box"><strong>Seg</strong><span>9 vagas</span></div>
            <div className="day-box"><strong>Ter</strong><span>11 vagas</span></div>
            <div className="day-box"><strong>Qua</strong><span>8 vagas</span></div>
            <div className="day-box"><strong>Qui</strong><span>10 vagas</span></div>
            <div className="day-box"><strong>Sex</strong><span>12 vagas</span></div>
            <div className="day-box"><strong>Sáb</strong><span>6 vagas</span></div>
          </section>
        )}

        {tab === 'appointments' && (
          <section className="panel">
            <h3>Consultas do dia</h3>
            <ul className="appointment-list">
              {renderAppointments.map((item) => (
                <li key={item.patient_id || item.id || `${item.patient_name}-${item.scheduled_start}`}>
                  <div>
                    <strong>{item.patient_name || item.patient || 'Paciente'}</strong>
                    <small>{item.professional_name || item.professional || 'Profissional'}</small>
                  </div>
                  <span>
                    {item.scheduled_start ? new Date(item.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : item.time}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
