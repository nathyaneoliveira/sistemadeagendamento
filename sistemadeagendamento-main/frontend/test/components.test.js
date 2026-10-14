import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { BrowserRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
let vite;
let ApplicationRoutes;
let root;
let calls;
let storage;
let originalGlobals;
let currentRoute;
let routerNavigate;

const clinicUser = { id: 'clinic-user-1', name: 'Pessoa Sintética', role: 'admin' };
const platformUser = { id: 'platform-user-1', name: 'Proprietário Sintético', email: 'owner@example.invalid' };
const clinicRecord = {
  id: 'clinic-1',
  name: 'Clínica Sintética',
  trade_name: 'Clínica Sintética',
  contact_email: 'clinic@example.invalid',
  contact_phone: '0000000000',
  administrator_name: 'Admin Sintético',
  administrator_email: 'admin@example.invalid',
  planName: 'Essencial',
  subscription_status: 'active',
  billing_cycle: 'monthly',
  renewal_at: '2026-11-30T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
};

const dashboardData = {
  metrics: {
    totalClinics: 12,
    activeSubscriptions: 7,
    newContracts: 2,
    pendingSubscriptions: { supported: false, count: 0 },
    delinquentSubscriptions: 1,
    cancelledSubscriptions: 2,
    expiredSubscriptions: 0,
    mrrEstimateInCents: 123000,
    arrEstimateInCents: 1476000,
    activeSubscriptionsWithoutPaymentConfirmation: 1,
  },
  planDistribution: [{ plan: 'essential', planName: 'Essencial', clinics: 7 }],
  contractsTimeline: [],
  recentEvents: [],
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function defaultFetch(url, options = {}) {
  const parsedUrl = new URL(url);
  const call = {
    pathname: parsedUrl.pathname,
    searchParams: parsedUrl.searchParams,
    method: options.method || 'GET',
    headers: new Headers(options.headers || {}),
    body: options.body ? JSON.parse(options.body) : null,
  };
  calls.push(call);

  if (call.pathname === '/api/auth/login') {
    return Promise.resolve(response(200, { data: { token: 'synthetic-clinic-token', user: clinicUser } }));
  }
  if (call.pathname === '/api/platform/auth/login') {
    return Promise.resolve(response(200, { data: { token: 'synthetic-platform-token', user: platformUser } }));
  }
  if (call.pathname === '/api/auth/me') {
    return Promise.resolve(response(200, { data: clinicUser }));
  }
  if (call.pathname === '/api/public/clinics/synthetic-clinic') {
    return Promise.resolve(response(200, { data: { name: 'Clínica Sintética', timezone: 'UTC' } }));
  }
  if (call.pathname === '/api/platform/dashboard') {
    return Promise.resolve(response(200, { data: dashboardData }));
  }
  if (call.pathname === '/api/platform/clinics') {
    return Promise.resolve(response(200, {
      data: [clinicRecord],
      pagination: { total: 21, page: Number(call.searchParams.get('page') || 1), totalPages: 2 },
    }));
  }
  if (call.pathname === '/api/platform/clinics/clinic-1') {
    return Promise.resolve(response(200, {
      data: {
        clinic: clinicRecord,
        subscriptions: [],
        subscriptionEvents: [],
        financialNote: 'Dados financeiros limitados.',
      },
    }));
  }
  if (call.pathname === '/api/platform/subscriptions') {
    return Promise.resolve(response(200, {
      data: [{
        id: 'subscription-1',
        clinic_name: 'Clínica Sintética',
        administrator_name: 'Admin Sintético',
        planName: 'Essencial',
        created_at: '2026-01-01T00:00:00.000Z',
        billing_cycle: 'monthly',
        status: 'active',
        current_period_end: '2026-11-30T00:00:00.000Z',
        priceInCents: 15000,
      }],
      pagination: { total: 1, page: 1, totalPages: 1 },
    }));
  }
  return Promise.resolve(response(200, { data: [] }));
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props && Object.hasOwn(node.props, 'children')) return textOf(node.props.children);
  return textOf(node.children);
}

function buttonByText(label) {
  return root.root.findAllByType('button')
    .find((button) => textOf(button.props.children).includes(label));
}

function alertText() {
  return root.root.findAll((node) => node.props.role === 'alert').map((node) => textOf(node.children)).join(' ');
}

function storageFor(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

function setFetch(handler = defaultFetch) {
  globalThis.fetch = (url, options) => handler(url, options);
}

async function renderApp(pathname = '/', seed = {}) {
  storage = storageFor(seed);
  globalThis.localStorage = storage;
  globalThis.window.localStorage = storage;
  globalThis.window.location.pathname = pathname;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(
        MemoryRouter,
        { initialEntries: [pathname] },
        React.createElement(React.Fragment, null,
          React.createElement(RouterProbe),
          React.createElement(ApplicationRoutes)
        )
      )
    );
    await Promise.resolve();
  });
}

function installBrowserHistory(pathname) {
  let currentUrl = new URL(pathname, globalThis.window.origin);
  let entries = [{ url: currentUrl, state: null }];
  let index = 0;
  const listeners = new Map();
  const location = {};
  Object.defineProperties(location, Object.fromEntries(
    ['href', 'pathname', 'search', 'hash', 'origin'].map((property) => [
      property,
      { get: () => currentUrl[property] },
    ])
  ));
  const dispatchPopState = () => {
    for (const listener of listeners.get('popstate') || []) {
      listener({ type: 'popstate', state: entries[index].state });
    }
  };
  const history = {
    get length() {
      return entries.length;
    },
    get state() {
      return entries[index].state;
    },
    scrollRestoration: 'auto',
    pushState(state, _title, url) {
      currentUrl = new URL(url || currentUrl.href, currentUrl.href);
      entries = entries.slice(0, index + 1);
      entries.push({ url: currentUrl, state });
      index += 1;
    },
    replaceState(state, _title, url) {
      currentUrl = new URL(url || currentUrl.href, currentUrl.href);
      entries[index] = { url: currentUrl, state };
    },
    go(delta = 0) {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= entries.length || nextIndex === index) return;
      index = nextIndex;
      currentUrl = entries[index].url;
      dispatchPopState();
    },
  };
  Object.assign(globalThis.window, {
    location,
    history,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || new Set();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  });
}

async function renderBrowserApp(pathname = '/', seed = {}) {
  storage = storageFor(seed);
  globalThis.localStorage = storage;
  globalThis.window.localStorage = storage;
  installBrowserHistory(pathname);
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(
        BrowserRouter,
        { window: globalThis.window },
        React.createElement(React.Fragment, null,
          React.createElement(RouterProbe),
          React.createElement(ApplicationRoutes)
        )
      )
    );
    await Promise.resolve();
  });
}

function RouterProbe() {
  currentRoute = useLocation().pathname;
  routerNavigate = useNavigate();
  return null;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  });
}

function changeInput(input, value) {
  input.props.onChange({ target: { value } });
}

async function enterCredentials(email, password) {
  const inputs = root.root.findAllByType('input').filter((input) => input.props.type !== 'date');
  assert.equal(inputs.length, 2);
  await act(async () => {
    changeInput(inputs[0], email);
    changeInput(inputs[1], password);
  });
}

async function submitForm(form = root.root.findByType('form')) {
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} });
  });
}

async function loginToPlatform() {
  await enterCredentials('owner@example.invalid', 'synthetic-password');
  await submitForm();
  await settle();
}

before(async () => {
  vite = await createServer({
    configFile: false,
    root: frontendRoot,
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    appType: 'custom',
    logLevel: 'error',
    plugins: [react()],
    optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    server: { middlewareMode: true },
  });
  ({ default: ApplicationRoutes } = await vite.ssrLoadModule('/src/routes.jsx'));
});

beforeEach(() => {
  originalGlobals = {
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    actEnvironment: Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'),
  };
  calls = [];
  storage = storageFor();
  globalThis.localStorage = storage;
  globalThis.window = {
    location: { pathname: '/', hash: '' },
    localStorage: storage,
    confirm: () => true,
    origin: 'http://localhost:5173',
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    title: '',
    activeElement: null,
    documentElement: { dataset: {} },
    querySelector: () => null,
    getElementById: () => ({ scrollIntoView() {} }),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setFetch();
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
    root = undefined;
  }
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

after(async () => {
  await vite?.close();
});

test('clínica: login inicial exige e-mail e senha e não mostra áreas protegidas', async () => {
  await renderApp('/login');

  assert.match(textOf(root.toJSON()), /Entrar/);
  assert.equal(root.root.findAllByType('input').filter((input) => input.props.required).length, 2);
  assert.equal(buttonByText('Dashboard'), undefined);
  assert.equal(calls.length, 0);
});

test('clínica: credenciais inválidas e falha da API permanecem na tela de login', async () => {
  setFetch(async (url) => {
    calls.push({ pathname: new URL(url).pathname });
    return response(401, { message: 'Credenciais inválidas.' });
  });
  await renderApp('/login');
  await enterCredentials('clinic@example.invalid', 'wrong-synthetic-password');
  await submitForm();

  assert.match(alertText(), /Credenciais inválidas/);
  assert.equal(storage.getItem('clinic_token'), null);
  assert.match(textOf(root.toJSON()), /Entrar/);

  setFetch(async (url) => {
    calls.push({ pathname: new URL(url).pathname });
    return response(503, { message: 'Serviço temporariamente indisponível.' });
  });
  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  await submitForm();
  assert.match(alertText(), /Não foi possível concluir a solicitação/);
  assert.equal(storage.getItem('clinic_token'), null);
});

test('clínica: login válido carrega dados com o token clínico e logout limpa a sessão', async () => {
  await renderApp('/login');
  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  await submitForm();

  assert.equal(storage.getItem('clinic_token'), 'synthetic-clinic-token');
  assert.equal(currentRoute, '/clinic/dashboard');
  assert.match(textOf(root.toJSON()), /Painel/);
  assert.ok(calls.some((call) => call.pathname === '/api/appointments'));
  assert.ok(calls.filter((call) => call.pathname.startsWith('/api/appointments')).every(
    (call) => call.headers.get('authorization') === 'Bearer synthetic-clinic-token'
  ));
  await act(async () => {
    buttonByText('Agenda').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(currentRoute, '/clinic/schedule');
  await act(async () => {
    routerNavigate(-1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(currentRoute, '/clinic/dashboard');

  await act(async () => {
    await root.root.findByProps({ 'aria-label': 'Sair' }).props.onClick();
  });
  assert.equal(storage.getItem('clinic_token'), null);
  assert.equal(currentRoute, '/login');
  assert.match(textOf(root.toJSON()), /Entrar/);
  assert.doesNotMatch(textOf(root.toJSON()), /Pessoa Sintética/);
  await act(async () => {
    routerNavigate('/clinic/appointments');
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/login');
  assert.doesNotMatch(textOf(root.toJSON()), /Pessoa Sintética/);
});

test('clínica: respostas pendentes de uma sessão encerrada não reaparecem na próxima sessão', async () => {
  let loginCount = 0;
  const oldAppointmentResponses = [];
  const newAppointmentResponses = [];
  setFetch((url, options = {}) => {
    const parsedUrl = new URL(url);
    const authorization = new Headers(options.headers || {}).get('authorization');
    if (parsedUrl.pathname === '/api/auth/login') {
      loginCount += 1;
      const token = loginCount === 1 ? 'first-clinic-token' : 'second-clinic-token';
      return Promise.resolve(response(200, {
        data: { token, user: { ...clinicUser, name: `Usuária ${loginCount}` } },
      }));
    }
    if (parsedUrl.pathname === '/api/appointments' && authorization === 'Bearer first-clinic-token') {
      return new Promise((resolve) => oldAppointmentResponses.push(resolve));
    }
    if (parsedUrl.pathname === '/api/appointments' && authorization === 'Bearer second-clinic-token') {
      return new Promise((resolve) => newAppointmentResponses.push(resolve));
    }
    return defaultFetch(url, options);
  });

  await renderApp('/login');
  let firstLogin;
  await act(async () => {
    firstLogin = root.root.findByType('form').props.onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });
  await settle();
  assert.ok(oldAppointmentResponses.length >= 1);

  await act(async () => {
    await root.root.findByProps({ 'aria-label': 'Sair' }).props.onClick();
  });
  for (const resolve of oldAppointmentResponses) {
    resolve(response(200, {
      data: [{
        id: 'old-session-appointment',
        patient_name: 'DADO PRIVADO DA SESSÃO ENCERRADA',
        scheduled_start: '2026-06-01T10:00:00.000Z',
        status: 'scheduled',
      }],
    }));
  }
  await settle();
  await act(async () => firstLogin);

  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  let secondLogin;
  await act(async () => {
    secondLogin = root.root.findByType('form').props.onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });
  await settle();

  assert.ok(newAppointmentResponses.length >= 1);
  assert.equal(currentRoute, '/clinic/dashboard');
  assert.doesNotMatch(textOf(root.toJSON()), /DADO PRIVADO DA SESSÃO ENCERRADA/);
  for (const resolve of newAppointmentResponses) {
    resolve(response(200, { data: [] }));
  }
  await act(async () => secondLogin);
});

test('clínica: token expirado no carregamento é removido e dados protegidos não aparecem', async () => {
  setFetch(async (url) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname });
    return response(401, { message: 'Sessão expirada.' });
  });
  await renderApp('/clinic/dashboard', { clinic_token: 'synthetic-expired-token' });
  await settle();

  assert.equal(storage.getItem('clinic_token'), null);
  assert.match(textOf(root.toJSON()), /Entrar/);
  assert.match(alertText(), /Sua sessão expirou/);
  assert.equal(buttonByText('Dashboard'), undefined);
});

test('clínica: controles de navegação respeitam o papel retornado pela API', async () => {
  setFetch(async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname });
    if (pathname === '/api/auth/login') {
      return response(200, { data: { token: 'synthetic-reception-token', user: { ...clinicUser, role: 'reception' } } });
    }
    return response(200, { data: [] });
  });
  await renderApp('/login');
  await enterCredentials('reception@example.invalid', 'synthetic-password');
  await submitForm();
  await settle();

  assert.equal(currentRoute, '/clinic/dashboard');
  assert.ok(buttonByText('Serviços'));
  assert.equal(buttonByText('Configurações'), undefined);
});

test('painel global: login exibe campos obrigatórios e falha de autenticação', async () => {
  setFetch(async (url) => {
    calls.push({ pathname: new URL(url).pathname });
    return response(401, { message: 'Autenticação administrativa inválida.' });
  });
  await renderApp('/platform-admin');

  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.equal(root.root.findAllByType('input').filter((input) => input.props.required).length, 2);
  await enterCredentials('owner@example.invalid', 'wrong-synthetic-password');
  await submitForm();

  assert.match(alertText(), /Autenticação administrativa inválida/);
  assert.equal(storage.getItem('platform_token'), null);
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/platform/')).length, 1);
});

test('painel global: login carrega métricas sintéticas sem persistir token administrativo', async () => {
  await renderApp('/platform-admin');
  await loginToPlatform();

  assert.match(textOf(root.toJSON()), /Visão geral/);
  assert.match(textOf(root.toJSON()), /Clínicas cadastradas12/);
  assert.match(textOf(root.toJSON()), /Pagamentos confirmados: não disponíveis/);
  assert.equal(storage.getItem('platform_token'), null);
  const dashboardCall = calls.find((call) => call.pathname === '/api/platform/dashboard');
  assert.equal(dashboardCall.headers.get('authorization'), 'Bearer synthetic-platform-token');
  assert.equal(dashboardCall.searchParams.get('from')?.slice(-2), '01');
  assert.equal(dashboardCall.searchParams.get('to')?.length, 10);
  assert.match(textOf(root.toJSON()), /Sem contratações no período/);
  assert.match(textOf(root.toJSON()), /Nenhum evento encontrado/);
});

test('painel global: estado de carregamento permanece visível enquanto a listagem responde', async () => {
  let resolveClinics;
  setFetch(async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/platform/clinics') {
      calls.push({ pathname });
      return new Promise((resolve) => {
        resolveClinics = () => resolve(response(200, {
          data: [clinicRecord],
          pagination: { total: 1, page: 1, totalPages: 1 },
        }));
      });
    }
    return defaultFetch(url);
  });
  await renderApp('/platform-admin');
  await loginToPlatform();
  await act(async () => {
    buttonByText('Clínicas').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.match(textOf(root.toJSON()), /Carregando/);
  assert.equal(typeof resolveClinics, 'function');

  await act(async () => {
    resolveClinics();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.doesNotMatch(textOf(root.toJSON()), /Carregando/);
  assert.match(textOf(root.toJSON()), /Clínica Sintética/);
});

test('painel global: erros ao carregar o painel são apresentados sem inventar dados', async () => {
  setFetch(async (url) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname });
    if (pathname === '/api/platform/auth/login') {
      return response(200, { data: { token: 'synthetic-platform-token', user: platformUser } });
    }
    return response(503, { message: 'Dashboard indisponível.' });
  });
  await renderApp('/platform-admin');
  await loginToPlatform();

  assert.match(alertText(), /Dashboard indisponível/);
  assert.doesNotMatch(textOf(root.toJSON()), /Clínicas cadastradas12/);
});

test('painel global: pesquisa de clínicas, detalhes e paginação usam respostas sintéticas', async () => {
  await renderApp('/platform-admin');
  await loginToPlatform();
  await act(async () => {
    buttonByText('Clínicas').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();

  assert.match(textOf(root.toJSON()), /Clínica Sintética/);
  const search = root.root.findAllByType('input').find((input) => input.props.placeholder === 'Clínica, e-mail ou administrador');
  assert.ok(search);
  await act(async () => changeInput(search, ' Clínica Sintética '));
  await submitForm(root.root.findByType('form'));
  await settle();

  const clinicCall = calls.filter((call) => call.pathname === '/api/platform/clinics').at(-1);
  assert.equal(clinicCall.searchParams.get('search'), 'Clínica Sintética');
  await act(async () => {
    buttonByText('Próxima').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(calls.filter((call) => call.pathname === '/api/platform/clinics').at(-1).searchParams.get('page'), '2');
  const detailButton = buttonByText('Detalhes');
  assert.ok(detailButton);
  await act(async () => {
    await detailButton.props.onClick();
  });
  assert.match(textOf(root.toJSON()), /Histórico de assinaturas/);
  assert.match(textOf(root.toJSON()), /Dados financeiros limitados/);
});

test('painel global: filtros de assinatura aplicam o plano e a periodicidade selecionados', async () => {
  await renderApp('/platform-admin');
  await loginToPlatform();
  await act(async () => {
    buttonByText('Assinaturas').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();

  const selects = root.root.findAllByType('select');
  assert.equal(selects.length, 3);
  await act(async () => {
    selects[1].props.onChange({ target: { value: 'essential' } });
    selects[2].props.onChange({ target: { value: 'monthly' } });
  });
  await settle();

  const subscriptionCall = calls.filter((call) => call.pathname === '/api/platform/subscriptions').at(-1);
  assert.equal(subscriptionCall.searchParams.get('plan'), 'essential');
  assert.equal(subscriptionCall.searchParams.get('billingCycle'), 'monthly');
  assert.match(textOf(root.toJSON()), /Admin Sintético/);
  assert.match(textOf(root.toJSON()), /R\$\s?150,00/);
});

test('painel global: resposta 401 remove o painel e retorna à autenticação', async () => {
  setFetch(async (url) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname });
    if (pathname === '/api/platform/auth/login') {
      return response(200, { data: { token: 'synthetic-platform-token', user: platformUser } });
    }
    return response(401, { message: 'Sessão administrativa expirada.' });
  });
  await renderApp('/platform-admin');
  await loginToPlatform();

  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.match(alertText(), /Sessão administrativa expirada/);
  assert.doesNotMatch(textOf(root.toJSON()), /Proprietário Sintético/);
});

test('painel global: 401 ao carregar detalhes limpa todos os dados administrativos sem encerrar sessão clínica', async () => {
  setFetch(async (url, options) => {
    if (new URL(url).pathname === '/api/platform/clinics/clinic-1') {
      calls.push({ pathname: '/api/platform/clinics/clinic-1' });
      return response(401, { message: 'Sessão administrativa expirada nos detalhes.' });
    }
    return defaultFetch(url, options);
  });
  await renderApp('/platform-admin', { clinic_token: 'synthetic-clinic-token' });
  await loginToPlatform();
  await act(async () => {
    buttonByText('Clínicas').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.match(textOf(root.toJSON()), /Clínica Sintética/);

  await act(async () => {
    await buttonByText('Detalhes').props.onClick();
  });
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.match(alertText(), /Sessão administrativa expirada nos detalhes/);
  assert.doesNotMatch(textOf(root.toJSON()), /Proprietário Sintético|Clínica Sintética|Clínicas cadastradas12/);
  assert.equal(storage.getItem('clinic_token'), 'synthetic-clinic-token');
  assert.equal(storage.getItem('platform_token'), null);
  assert.equal(calls.some((call) => call.pathname.startsWith('/api/auth/')), false);
});

test('painel global: logout limpa estado e dados apresentados', async () => {
  await renderApp('/platform-admin');
  await loginToPlatform();
  assert.match(textOf(root.toJSON()), /Proprietário Sintético/);

  await act(async () => {
    await buttonByText('Sair').props.onClick();
  });
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.doesNotMatch(textOf(root.toJSON()), /Proprietário Sintético/);
  assert.equal(storage.getItem('platform_token'), null);
  assert.ok(calls.some((call) => call.pathname === '/api/platform/auth/logout'));

  await act(async () => {
    routerNavigate('/platform-admin/clinics');
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/platform-admin/clinics');
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.doesNotMatch(textOf(root.toJSON()), /Clínica Sintética/);
});

test('painel global: acesso direto a seção protegida sem sessão não carrega dados', async () => {
  await renderApp('/platform-admin/clinics');
  await settle();

  assert.equal(currentRoute, '/platform-admin/clinics');
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.equal(calls.length, 0);
});

test('painel global: 401 durante navegação limpa dados antigos antes de uma nova sessão', async () => {
  let expireClinicRequest = false;
  let deferDashboard = false;
  let resolveDashboard;
  setFetch((url, options) => {
    const pathname = new URL(url).pathname;
    if (expireClinicRequest && pathname === '/api/platform/clinics') {
      calls.push({ pathname });
      return Promise.resolve(response(401, { message: 'Não autenticado.' }));
    }
    if (deferDashboard && pathname === '/api/platform/dashboard') {
      calls.push({ pathname });
      return new Promise((resolve) => {
        resolveDashboard = () => resolve(response(200, {
          data: {
            ...dashboardData,
            metrics: { ...dashboardData.metrics, totalClinics: 99 },
          },
        }));
      });
    }
    return defaultFetch(url, options);
  });
  await renderApp('/platform-admin');
  await loginToPlatform();
  assert.match(textOf(root.toJSON()), /Clínicas cadastradas12/);

  expireClinicRequest = true;
  await act(async () => {
    buttonByText('Clínicas').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.doesNotMatch(textOf(root.toJSON()), /Proprietário Sintético/);

  deferDashboard = true;
  await loginToPlatform();
  assert.doesNotMatch(textOf(root.toJSON()), /Clínicas cadastradas12/);
  assert.doesNotMatch(textOf(root.toJSON()), /Clínicas cadastradas99/);
  assert.equal(typeof resolveDashboard, 'function');

  await act(async () => {
    resolveDashboard();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.match(textOf(root.toJSON()), /Clínicas cadastradas99/);
});

test('tema: alternância é persistida e restaurada na renderização seguinte', async () => {
  await renderApp('/platform-admin');
  let themeButton = root.root.findByProps({ 'aria-label': 'Ativar tema escuro' });
  await act(async () => themeButton.props.onClick());

  assert.equal(storage.getItem('clinic_theme'), 'dark');
  assert.equal(globalThis.document.documentElement.dataset.theme, 'dark');
  assert.ok(root.root.findByProps({ 'aria-label': 'Ativar tema claro' }));

  await act(async () => root.unmount());
  root = undefined;
  await renderApp('/platform-admin', { clinic_theme: 'dark' });
  assert.ok(root.root.findByProps({ 'aria-label': 'Ativar tema claro' }));
  assert.equal(globalThis.document.documentElement.dataset.theme, 'dark');
});

test('sessões: token clínico não autentica o painel global e token global não é herdado pelo painel clínico', async () => {
  await renderApp('/platform-admin', { clinic_token: 'synthetic-clinic-token' });
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.equal(calls.length, 0);
  await loginToPlatform();

  const platformLogin = calls.find((call) => call.pathname === '/api/platform/auth/login');
  assert.equal(platformLogin.headers.get('authorization'), null);
  assert.equal(storage.getItem('platform_token'), null);
  storage.removeItem('clinic_token');

  await act(async () => {
    routerNavigate('/login');
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();

  assert.equal(currentRoute, '/login');
  assert.match(textOf(root.toJSON()), /Entrar/);
  assert.doesNotMatch(textOf(root.toJSON()), /Proprietário Sintético/);
  assert.equal(calls.some((call) => call.pathname === '/api/auth/me'), false);
});

test('rotas públicas: páginas comerciais abrem diretamente sem iniciar chamadas protegidas', async () => {
  for (const [path, expected] of [
    ['/', /Gestão de clínicas de forma/],
    ['/planos', /PLANOS COMERCIAIS/],
    ['/recursos', /RECURSOS DO SISTEMA/],
    ['/sobre', /SEGURANÇA E PRIVACIDADE/],
    ['/contato', /Pronto para organizar a gestão/],
  ]) {
    await renderApp(path);
    assert.match(textOf(root.toJSON()), expected, path);
    assert.equal(currentRoute, path);
    assert.equal(calls.length, 0);
    await act(async () => root.unmount());
    root = undefined;
  }
});

test('rota pública de agendamento preserva o slug na consulta da clínica', async () => {
  await renderApp('/booking/synthetic-clinic');
  await settle();

  assert.match(textOf(root.toJSON()), /Clínica Sintética/);
  assert.ok(calls.some((call) => call.pathname === '/api/public/clinics/synthetic-clinic'));
  assert.equal(calls.some((call) => call.pathname.startsWith('/api/auth/')), false);
});

test('URLs inexistentes retornam à página inicial em vez de abrir login clínico', async () => {
  await renderApp('/rota-inexistente');
  await settle();

  assert.equal(currentRoute, '/');
  assert.match(textOf(root.toJSON()), /Gestão de clínicas de forma/);
  assert.doesNotMatch(textOf(root.toJSON()), /Sistema de agendamentoEntrar/);
  assert.equal(calls.length, 0);

  await act(async () => root.unmount());
  root = undefined;
  await renderApp('/platform-admin/rota-inexistente');
  await settle();

  assert.equal(currentRoute, '/');
  assert.match(textOf(root.toJSON()), /Gestão de clínicas de forma/);
  assert.equal(calls.length, 0);
});

test('rota clínica direta sem sessão é redirecionada ao login e logout encerra a navegação protegida', async () => {
  await renderApp('/clinic/appointments');
  await settle();

  assert.equal(currentRoute, '/login');
  assert.match(textOf(root.toJSON()), /Entrar/);
  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  await submitForm();
  await settle();
  assert.equal(currentRoute, '/clinic/dashboard');

  await act(async () => {
    await root.root.findByProps({ 'aria-label': 'Sair' }).props.onClick();
  });
  assert.equal(currentRoute, '/login');
  assert.match(textOf(root.toJSON()), /Entrar/);
});

test('MemoryRouter: navegar por uma rota e voltar restaura o caminho em memória', async () => {
  await renderApp('/platform-admin');
  await loginToPlatform();
  await act(async () => {
    routerNavigate('/platform-admin/clinics');
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/platform-admin/clinics');

  await act(async () => {
    routerNavigate(-1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/platform-admin');
  assert.match(textOf(root.toJSON()), /Visão geral/);

  await act(async () => {
    routerNavigate('/clinic/dashboard');
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/login');
});

test('BrowserRouter: histórico real do roteador restaura as seções clínicas em voltar e avançar', async () => {
  await renderBrowserApp('/login');
  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  await submitForm();
  await settle();
  assert.equal(currentRoute, '/clinic/dashboard');
  const clinicAuthorization = calls.find((call) => call.pathname === '/api/appointments')?.headers.get('authorization');
  assert.ok(clinicAuthorization);

  for (const [label, route] of [
    ['Profissionais', '/clinic/professionals'],
    ['Serviços', '/clinic/services'],
    ['Agenda', '/clinic/schedule'],
    ['Consultas', '/clinic/appointments'],
    ['Configurações', '/clinic/settings'],
  ]) {
    await act(async () => {
      buttonByText(label).props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
    });
    await settle();
    assert.equal(currentRoute, route);
    assert.equal(root.root.findAllByProps({ 'aria-current': 'page' }).length, 1);
  }

  await act(async () => {
    globalThis.window.history.go(-1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/clinic/appointments');
  await act(async () => {
    globalThis.window.history.go(1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/clinic/settings');
  assert.equal(storage.getItem('clinic_token'), 'synthetic-clinic-token');

  await act(async () => root.unmount());
  root = undefined;
  await renderBrowserApp('/clinic/settings', { clinic_token: 'synthetic-clinic-token' });
  await settle();
  assert.equal(currentRoute, '/clinic/settings');
  assert.equal(storage.getItem('clinic_token'), 'synthetic-clinic-token');
  assert.match(textOf(root.toJSON()), /Configurações/);
  assert.ok(calls.some((call) => call.pathname === '/api/auth/me'));
  assert.equal(
    calls.find((call) => call.pathname === '/api/auth/me').headers.get('authorization'),
    clinicAuthorization
  );
});

test('BrowserRouter: expiração clínica limpa dados protegidos e logout bloqueia retorno no histórico', async () => {
  let expireSession = false;
  setFetch(async (url, options) => {
    const pathname = new URL(url).pathname;
    if (expireSession && pathname === '/api/settings') {
      calls.push({ pathname });
      return response(401, { message: 'Sessão clínica expirada.' });
    }
    return defaultFetch(url, options);
  });
  await renderBrowserApp('/login');
  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  await submitForm();
  await settle();
  expireSession = true;
  await act(async () => {
    buttonByText('Configurações').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/login');
  assert.equal(storage.getItem('clinic_token'), null);
  assert.match(alertText(), /Sua sessão expirou/);
  assert.doesNotMatch(textOf(root.toJSON()), /Pessoa Sintética/);

  await act(async () => {
    routerNavigate('/clinic/appointments');
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/login');
  assert.doesNotMatch(textOf(root.toJSON()), /Consultas/);

  expireSession = false;
  await enterCredentials('clinic@example.invalid', 'synthetic-password');
  await submitForm();
  await settle();
  await act(async () => {
    buttonByText('Consultas').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  await act(async () => {
    await root.root.findByProps({ 'aria-label': 'Sair' }).props.onClick();
  });
  assert.equal(currentRoute, '/login');
  assert.equal(storage.getItem('clinic_token'), null);
  await act(async () => {
    globalThis.window.history.go(-1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/login');
  assert.doesNotMatch(textOf(root.toJSON()), /Pessoa Sintética/);

});

test('BrowserRouter: voltar e avançar entre áreas administrativas mantém a sessão em memória', async () => {
  await renderBrowserApp('/platform-admin');
  await loginToPlatform();

  for (const [label, route] of [
    ['Clínicas', '/platform-admin/clinics'],
    ['Assinaturas', '/platform-admin/subscriptions'],
  ]) {
    await act(async () => {
      buttonByText(label).props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
    });
    await settle();
    assert.equal(currentRoute, route);
    assert.match(textOf(root.toJSON()), /Proprietário Sintético/);
  }

  await act(async () => {
    globalThis.window.history.go(-1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/platform-admin/clinics');
  assert.match(textOf(root.toJSON()), /Clínicas/);
  await act(async () => {
    globalThis.window.history.go(1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/platform-admin/subscriptions');
  assert.match(textOf(root.toJSON()), /Proprietário Sintético/);
  assert.equal(storage.getItem('platform_token'), null);
  assert.equal(storage.getItem('clinic_token'), null);

  await act(async () => {
    await buttonByText('Sair').props.onClick();
  });
  assert.equal(currentRoute, '/platform-admin');
  assert.doesNotMatch(textOf(root.toJSON()), /Proprietário Sintético/);
  await act(async () => {
    globalThis.window.history.go(-1);
    await new Promise((resolve) => setImmediate(resolve));
  });
  await settle();
  assert.equal(currentRoute, '/platform-admin/clinics');
  assert.match(textOf(root.toJSON()), /Área do proprietário/);
  assert.doesNotMatch(textOf(root.toJSON()), /Clínica Sintética/);
});
