import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clinicApiFetch } from './clinicApi.js';
import { ThemeToggle, useTheme } from './theme.jsx';

async function submitAuthRequest(path, body) {
  const response = await clinicApiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.message || 'Não foi possível concluir a solicitação. Tente novamente.');
  }
  return payload;
}

function AuthLayout({ title, description, children }) {
  const [theme, toggleTheme] = useTheme();

  return (
    <main className="auth-screen">
      <div className="auth-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
      <section className="auth-card" aria-labelledby="auth-page-heading">
        <Link className="auth-back-link" to="/login">← Voltar ao login</Link>
        <div className="auth-brand">
          <img className="brand-logo" src="/noa-connect-logo.png" alt="NOA CONNECT" />
        </div>
        <p className="eyebrow">Sistema de agendamento</p>
        <h1 id="auth-page-heading">{title}</h1>
        <p className="muted-text auth-description">{description}</p>
        {children}
      </section>
    </main>
  );
}

function RegistrationPage() {
  return (
    <AuthLayout
      title="Criar conta"
      description="O acesso ao sistema é provisionado pela clínica."
    >
      <p className="muted-text">
        Para proteger os dados de cada clínica, não há cadastro público. Peça ao administrador
        da sua clínica para criar seu acesso. Contas de administração da plataforma são
        provisionadas separadamente.
      </p>
    </AuthLayout>
  );
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await submitAuthRequest('/auth/password-reset/request', { email: email.trim() });
      setSubmitted(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Esqueci minha senha"
      description="Informe o e-mail associado à sua conta."
    >
      {submitted ? (
        <p className="success-text" role="status">
          Se o endereço estiver associado a uma conta ativa, as instruções serão enviadas.
        </p>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={255}
              required
            />
          </label>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>{busy ? 'Enviando...' : 'Enviar instruções'}</button>
        </form>
      )}
    </AuthLayout>
  );
}

function ResetPasswordPage() {
  const location = useLocation();
  const token = useMemo(
    () => new URLSearchParams(location.hash.replace(/^#/, '')).get('token') || '',
    [location.hash]
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    const passwordBytes = new TextEncoder().encode(password).length;
    if (Array.from(password).length < 12 || passwordBytes > 72) {
      setError('A senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await submitAuthRequest('/auth/password-reset/confirm', { token, password, confirmPassword });
      setCompleted(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Redefinir senha"
      description="Escolha uma nova senha para sua conta."
    >
      {!token ? (
        <div>
          <p className="error-text" role="alert">O link de redefinição está inválido ou incompleto.</p>
          <Link to="/forgot-password">Solicitar outro link</Link>
        </div>
      ) : completed ? (
        <div>
          <p className="success-text" role="status">Senha redefinida. Entre com sua nova senha.</p>
          <Link to="/login">Ir para o login</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Nova senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              maxLength={1024}
              required
            />
          </label>
          <label>
            Confirmar nova senha
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              maxLength={1024}
              required
            />
          </label>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Redefinir senha'}</button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function AuthPages() {
  const { pathname } = useLocation();
  if (pathname === '/register') return <RegistrationPage />;
  if (pathname === '/forgot-password') return <ForgotPasswordPage />;
  return <ResetPasswordPage />;
}
