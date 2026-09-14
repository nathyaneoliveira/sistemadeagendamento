import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="app-shell">
      <section className="card">
        <p className="eyebrow">Sistema de agendamento</p>
        <h1>Clínica Agenda</h1>
        <p>
          Estrutura inicial configurada com frontend, backend e banco de dados.
        </p>
        <button type="button">Acessar painel</button>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
