<?php
declare(strict_types=1);

function e(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

$pages = [
    'dashboard' => 'Visão geral',
    'appointments' => 'Agendamentos',
    'schedule' => 'Agenda semanal',
    'professionals' => 'Profissionais',
    'services' => 'Serviços',
    'patients' => 'Pacientes',
    'settings' => 'Configurações',
];
$page = $_GET['page'] ?? 'dashboard';
$extraPages = ['commercial', 'contract', 'login', 'register', 'forgot', 'reset', 'platform-login', 'owner', 'owner-clinics', 'owner-subscriptions', 'booking'];
if (!is_string($page) || (!isset($pages[$page]) && !in_array($page, $extraPages, true))) { $page = 'dashboard'; }
$today = new DateTimeImmutable('today', new DateTimeZone('America/Sao_Paulo'));
$dateLabel = $today->format('d/m/Y');
$weekdayNames = ['Sunday' => 'DOMINGO', 'Monday' => 'SEGUNDA-FEIRA', 'Tuesday' => 'TERÇA-FEIRA', 'Wednesday' => 'QUARTA-FEIRA', 'Thursday' => 'QUINTA-FEIRA', 'Friday' => 'SEXTA-FEIRA', 'Saturday' => 'SÁBADO'];
$weekdayLabel = $weekdayNames[$today->format('l')];
$appointments = [
    ['time' => '09:00', 'patient' => 'Mariana Costa', 'service' => 'Consulta inicial', 'professional' => 'Dra. Ana Ribeiro', 'status' => 'Confirmado', 'tone' => 'green'],
    ['time' => '10:30', 'patient' => 'Lucas Martins', 'service' => 'Retorno', 'professional' => 'Dr. Pedro Lima', 'status' => 'Aguardando', 'tone' => 'amber'],
    ['time' => '13:00', 'patient' => 'Camila Souza', 'service' => 'Avaliação', 'professional' => 'Dra. Ana Ribeiro', 'status' => 'Confirmado', 'tone' => 'green'],
    ['time' => '14:30', 'patient' => 'Rafael Alves', 'service' => 'Sessão de acompanhamento', 'professional' => 'Dra. Júlia Nunes', 'status' => 'Confirmado', 'tone' => 'green'],
];
$professionals = [
    ['initials' => 'AR', 'name' => 'Dra. Ana Ribeiro', 'specialty' => 'Clínica geral', 'color' => 'lavender', 'count' => '8 atendimentos'],
    ['initials' => 'PL', 'name' => 'Dr. Pedro Lima', 'specialty' => 'Cardiologia', 'color' => 'mint', 'count' => '6 atendimentos'],
    ['initials' => 'JN', 'name' => 'Dra. Júlia Nunes', 'specialty' => 'Dermatologia', 'color' => 'peach', 'count' => '5 atendimentos'],
];
$services = [
    ['name'=>'Consulta inicial','duration'=>'50 min','price'=>'R$ 180,00','staff'=>'4 profissionais','state'=>'Ativo'],
    ['name'=>'Retorno','duration'=>'30 min','price'=>'R$ 120,00','staff'=>'5 profissionais','state'=>'Ativo'],
    ['name'=>'Avaliação especializada','duration'=>'60 min','price'=>'R$ 220,00','staff'=>'3 profissionais','state'=>'Ativo'],
    ['name'=>'Sessão de acompanhamento','duration'=>'45 min','price'=>'R$ 160,00','staff'=>'2 profissionais','state'=>'Ativo'],
];
$patients = [
    ['name'=>'Mariana Costa','phone'=>'(11) 98888-1200','email'=>'mariana@exemplo.invalid','last'=>'Hoje, 09:00','state'=>'Ativo'],
    ['name'=>'Lucas Martins','phone'=>'(11) 97777-2300','email'=>'lucas@exemplo.invalid','last'=>'Hoje, 10:30','state'=>'Ativo'],
    ['name'=>'Camila Souza','phone'=>'(11) 96666-3400','email'=>'camila@exemplo.invalid','last'=>'Hoje, 13:00','state'=>'Ativo'],
    ['name'=>'Rafael Alves','phone'=>'(11) 95555-4500','email'=>'rafael@exemplo.invalid','last'=>'Hoje, 14:30','state'=>'Ativo'],
    ['name'=>'Joana Lima','phone'=>'(11) 94444-5600','email'=>'joana@exemplo.invalid','last'=>'28 out, 2026','state'=>'Inativo'],
];
$scheduleDays = [
    ['day'=>'Segunda-feira','hours'=>'08:00 — 18:00','appointments'=>18,'state'=>'Aberto'],
    ['day'=>'Terça-feira','hours'=>'08:00 — 18:00','appointments'=>23,'state'=>'Aberto'],
    ['day'=>'Quarta-feira','hours'=>'08:00 — 18:00','appointments'=>19,'state'=>'Aberto'],
    ['day'=>'Quinta-feira','hours'=>'08:00 — 18:00','appointments'=>21,'state'=>'Aberto'],
    ['day'=>'Sexta-feira','hours'=>'08:00 — 16:00','appointments'=>16,'state'=>'Aberto'],
    ['day'=>'Sábado','hours'=>'09:00 — 13:00','appointments'=>8,'state'=>'Aberto'],
    ['day'=>'Domingo','hours'=>'—','appointments'=>0,'state'=>'Fechado'],
];
$navIcons = ['dashboard' => '◫', 'appointments' => '▦', 'schedule' => '◷', 'professionals' => '♙', 'services' => '✳', 'patients' => '♡', 'settings' => '⚙'];
if (in_array($page, $extraPages, true)) {
    require __DIR__ . '/views/' . (in_array($page, ['login', 'register', 'forgot', 'reset', 'platform-login'], true) ? 'auth.php' : ($page === 'booking' ? 'booking.php' : ($page === 'commercial' ? 'commercial.php' : ($page === 'contract' ? 'contract.php' : 'owner.php'))));
    exit;
}
?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Demonstração visual do NOA CONNECT em PHP, HTML, CSS e JavaScript">
  <title><?= e($pages[$page]) ?> | NOA CONNECT</title>
  <link rel="stylesheet" href="assets/style.css"><link rel="stylesheet" href="assets/figma-theme.css">
</head>
<body>
<div class="app-shell">
  <aside class="sidebar" id="sidebar">
    <a class="brand" href="?page=dashboard" aria-label="NOA CONNECT início"><span class="brand-mark">n</span><span>NOA<span class="brand-light">CONNECT</span></span></a>
    <div class="clinic-switch"><span class="clinic-avatar">V</span><span class="clinic-name"><b>Clínica Vida Plena</b><small>Plano Profissional</small></span><span class="chevron">⌄</span></div>
    <p class="nav-caption">MENU PRINCIPAL</p>
    <nav class="navigation" aria-label="Navegação principal">
      <?php foreach ($pages as $key => $label): ?>
        <a class="nav-item <?= $page === $key ? 'active' : '' ?>" href="?page=<?= e($key) ?>"><span class="nav-icon"><?= e($navIcons[$key]) ?></span><?= e($label) ?><?php if ($key === 'appointments'): ?><span class="nav-count">4</span><?php endif; ?></a>
      <?php endforeach; ?>
    </nav>
    <div class="sidebar-bottom"><div class="help-card"><span class="help-icon">?</span><b>Precisa de ajuda?</b><small>Estamos aqui para você.</small><a href="?page=settings">Acessar suporte <span>→</span></a></div><div class="profile"><span class="profile-avatar">NC</span><span><b>Nathyane Costa</b><small>Administradora</small></span><button class="icon-button" title="Mais opções">···</button></div></div>
  </aside>

  <main class="main-area">
    <header class="topbar"><button class="mobile-menu icon-button" id="menuToggle" aria-label="Abrir menu">☰</button><div class="breadcrumb">Clínica Vida Plena <span>/</span> <b><?= e($pages[$page]) ?></b></div><div class="top-actions"><button class="icon-button theme-toggle" aria-label="Alternar tema" title="Alternar tema">☼</button><button class="icon-button notification" aria-label="Notificações">♧<i></i></button><span class="top-divider"></span><span class="today-label"><?= e($dateLabel) ?></span></div></header>
    <div class="content">
      <?php if ($page === 'dashboard'): ?>
        <section class="page-heading"><div><p class="eyebrow"><?= e($weekdayLabel . ', ' . $today->format('d/m')) ?></p><h1>Bom dia, Nathyane <span class="wave">✦</span></h1><p class="subheading">Aqui está o resumo da sua clínica hoje.</p></div><button class="primary-button" data-open-modal><span>＋</span> Novo agendamento</button></section>
        <section class="stats-grid" aria-label="Resumo da clínica">
          <article class="stat-card"><div class="stat-top"><span>Agendamentos hoje</span><span class="stat-icon teal">▦</span></div><strong id="appointmentCount">23</strong><small><span class="trend-up">↗ 12%</span> <span class="muted">em relação à semana passada</span></small><div class="sparkline teal-line"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
          <article class="stat-card"><div class="stat-top"><span>Pacientes atendidos</span><span class="stat-icon purple">♙</span></div><strong>18</strong><small><span class="trend-up">↗ 8%</span> <span class="muted">em relação à semana passada</span></small><div class="sparkline purple-line"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
          <article class="stat-card"><div class="stat-top"><span>Taxa de comparecimento</span><span class="stat-icon amber">◷</span></div><strong>94<span class="percent">%</span></strong><small><span class="trend-up">↗ 3%</span> <span class="muted">em relação à semana passada</span></small><div class="sparkline amber-line"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
          <article class="stat-card"><div class="stat-top"><span>Receita do mês</span><span class="stat-icon rose">R$</span></div><strong class="revenue">R$ 12.480</strong><small><span class="trend-up">↗ 16%</span> <span class="muted">em relação ao mês passado</span></small><div class="sparkline rose-line"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
        </section>
        <section class="dashboard-grid">
          <article class="panel schedule-panel"><div class="panel-heading"><div><h2>Agenda de hoje</h2><p>Seus próximos atendimentos</p></div><a href="?page=appointments" class="text-link">Ver agenda <span>→</span></a></div><div class="day-strip"><span class="day-label">Hoje, <?= e($today->format('d/m')) ?></span><span class="day-line"></span><span class="day-count">4 atendimentos</span></div>
            <div class="appointment-list" id="appointmentList">
              <?php foreach ($appointments as $item): ?><div class="appointment-row"><span class="appointment-time"><?= e($item['time']) ?></span><span class="timeline-dot <?= e($item['tone']) ?>"></span><span class="patient-avatar <?= e($item['tone']) ?>"><?= e(substr($item['patient'], 0, 1)) ?></span><span class="appointment-info"><b><?= e($item['patient']) ?></b><small><?= e($item['service']) ?> <span>·</span> <?= e($item['professional']) ?></small></span><span class="status-pill <?= e($item['tone']) ?>"><?= e($item['status']) ?></span><button class="row-more" aria-label="Mais opções">···</button></div><?php endforeach; ?>
            </div>
            <div class="schedule-footer"><span class="legend-dot green"></span> Confirmado <span class="legend-dot amber"></span> Aguardando <a href="?page=appointments">Abrir agenda completa <span>→</span></a></div>
          </article>
          <article class="panel team-panel"><div class="panel-heading"><div><h2>Equipe</h2><p>Profissionais em atendimento</p></div><button class="round-add" title="Adicionar profissional" data-toast="Ação demonstrativa">＋</button></div><div class="team-list"><?php foreach ($professionals as $person): ?><div class="team-row"><span class="person-avatar <?= e($person['color']) ?>"><?= e($person['initials']) ?></span><span class="team-info"><b><?= e($person['name']) ?></b><small><?= e($person['specialty']) ?></small></span><span class="team-count"><?= e($person['count']) ?></span><span class="online-dot"></span></div><?php endforeach; ?></div><a class="team-link" href="?page=professionals">Ver todos os profissionais <span>→</span></a><div class="team-summary"><div><strong>12</strong><small>Profissionais ativos</small></div><div><strong>86</strong><small>Atendimentos na semana</small></div></div></article>
          <article class="panel activity-panel"><div class="panel-heading"><div><h2>Visão da semana</h2><p>Atendimentos realizados</p></div><button class="select-button">Esta semana⌄</button></div><div class="chart-legend"><span><i class="legend-square"></i> Agendados</span><span><i class="legend-square light"></i> Realizados</span></div><div class="chart"><div class="chart-y"><span>30</span><span>20</span><span>10</span><span>0</span></div><div class="chart-content"><div class="grid-lines"><i></i><i></i><i></i><i></i></div><div class="bars"><?php foreach ([['Seg',22,16],['Ter',26,21],['Qua',18,14],['Qui',29,24],['Sex',24,20],['Sáb',13,11],['Dom',7,6]] as $bar): ?><div class="bar-group"><div class="bar-pair"><i style="height:<?= (int)$bar[1] * 3 ?>px"></i><i style="height:<?= (int)$bar[2] * 3 ?>px"></i></div><small><?= e($bar[0]) ?></small></div><?php endforeach; ?></div></div></div></article>
          <article class="panel quick-panel"><div class="panel-heading"><div><h2>Acesso rápido</h2><p>Atalhos para o seu dia</p></div></div><div class="quick-links"><a href="?page=appointments"><span class="quick-icon teal">＋</span><span><b>Novo agendamento</b><small>Reserve um horário</small></span><span class="quick-arrow">→</span></a><a href="?page=patients"><span class="quick-icon purple">♙</span><span><b>Cadastrar paciente</b><small>Adicione à sua clínica</small></span><span class="quick-arrow">→</span></a><a href="?page=professionals"><span class="quick-icon amber">✳</span><span><b>Gerenciar equipe</b><small>Profissionais e horários</small></span><span class="quick-arrow">→</span></a><a href="?page=settings"><span class="quick-icon rose">↗</span><span><b>Link de agendamento</b><small>Compartilhe com pacientes</small></span><span class="quick-arrow">→</span></a></div></article>
        </section>
      <?php elseif ($page === 'appointments'): ?>
        <section class="page-heading"><div><p class="eyebrow">ROTINA DA CLÍNICA</p><h1>Agendamentos</h1><p class="subheading">Acompanhe consultas, horários e confirmações.</p></div><button class="primary-button" data-open-modal><span>＋</span> Novo agendamento</button></section>
        <article class="panel full-panel"><div class="panel-heading"><div><h2>Agenda de hoje</h2><p><?= e($dateLabel) ?> · 4 atendimentos</p></div><label class="search-box">⌕ <input id="searchAppointments" placeholder="Buscar paciente"></label></div><div class="table-wrap"><table><thead><tr><th>HORÁRIO</th><th>PACIENTE</th><th>SERVIÇO</th><th>PROFISSIONAL</th><th>STATUS</th><th></th></tr></thead><tbody><?php foreach ($appointments as $item): ?><tr><td><b><?= e($item['time']) ?></b></td><td><?= e($item['patient']) ?></td><td><?= e($item['service']) ?></td><td><?= e($item['professional']) ?></td><td><span class="status-pill <?= e($item['tone']) ?>"><?= e($item['status']) ?></span></td><td><button class="row-more">···</button></td></tr><?php endforeach; ?></tbody></table></div></article>
      <?php elseif ($page === 'schedule'): ?>
        <section class="page-heading"><div><p class="eyebrow">HORÁRIOS DA EQUIPE</p><h1>Agenda semanal</h1><p class="subheading">Expediente e volume previsto para cada dia.</p></div><button class="primary-button" data-toast="Edição de expediente (demonstração)"><span>＋</span> Ajustar horários</button></section>
        <section class="week-summary"><article class="stat-card"><div class="stat-top"><span>Atendimentos nesta semana</span><span class="stat-icon teal">▦</span></div><strong>105</strong><small class="muted">Em todos os profissionais</small></article><article class="stat-card"><div class="stat-top"><span>Horário de funcionamento</span><span class="stat-icon purple">◷</span></div><strong>08–18<span class="percent">h</span></strong><small class="muted">Segunda a quinta-feira</small></article><article class="stat-card"><div class="stat-top"><span>Próximo bloqueio</span><span class="stat-icon amber">◩</span></div><strong class="revenue">Sáb, 13:00</strong><small class="muted">Encerramento do expediente</small></article></section>
        <article class="panel full-panel"><div class="panel-heading"><div><h2>Expediente da clínica</h2><p>Disponibilidade semanal configurada</p></div><span class="status-pill green">Fuso de Brasília</span></div><div class="table-wrap"><table><thead><tr><th>DIA</th><th>EXPEDIENTE</th><th>AGENDAMENTOS</th><th>STATUS</th><th></th></tr></thead><tbody><?php foreach($scheduleDays as $day): ?><tr><td><b><?= e($day['day']) ?></b></td><td><?= e($day['hours']) ?></td><td><?= (int)$day['appointments'] ?> horários</td><td><span class="status-pill <?= $day['state']==='Aberto'?'green':'amber' ?>"><?= e($day['state']) ?></span></td><td><button class="row-more" aria-label="Editar <?= e($day['day']) ?>" data-toast="Edição demonstrativa">···</button></td></tr><?php endforeach; ?></tbody></table></div></article>
      <?php elseif ($page === 'professionals'): ?>
        <section class="page-heading"><div><p class="eyebrow">EQUIPE DA CLÍNICA</p><h1>Profissionais</h1><p class="subheading">Gerencie especialistas e acompanhe a agenda da equipe.</p></div><button class="primary-button" data-toast="Cadastro de profissional (demonstração)"><span>＋</span> Novo profissional</button></section>
        <article class="panel full-panel"><div class="panel-heading"><div><h2>Equipe profissional</h2><p>12 profissionais ativos</p></div><label class="search-box">⌕ <input class="clinic-search" placeholder="Buscar profissional"></label></div><div class="table-wrap"><table><thead><tr><th>PROFISSIONAL</th><th>ESPECIALIDADE</th><th>ATENDIMENTOS NA SEMANA</th><th>STATUS</th><th></th></tr></thead><tbody><?php foreach($professionals as $person): ?><tr><td><b><?= e($person['name']) ?></b></td><td><?= e($person['specialty']) ?></td><td><?= e($person['count']) ?></td><td><span class="status-pill green">Ativo</span></td><td><button class="row-more" aria-label="Opções para <?= e($person['name']) ?>">···</button></td></tr><?php endforeach; ?></tbody></table></div></article>
      <?php elseif ($page === 'services'): ?>
        <section class="page-heading"><div><p class="eyebrow">CATÁLOGO DA CLÍNICA</p><h1>Serviços</h1><p class="subheading">Serviços, preços e profissionais associados.</p></div><button class="primary-button" data-toast="Cadastro de serviço (demonstração)"><span>＋</span> Novo serviço</button></section>
        <article class="panel full-panel"><div class="panel-heading"><div><h2>Serviços disponíveis</h2><p>4 serviços ativos</p></div><label class="search-box">⌕ <input class="clinic-search" placeholder="Buscar serviço"></label></div><div class="table-wrap"><table><thead><tr><th>SERVIÇO</th><th>DURAÇÃO</th><th>PREÇO</th><th>EQUIPE</th><th>STATUS</th><th></th></tr></thead><tbody><?php foreach($services as $service): ?><tr><td><b><?= e($service['name']) ?></b></td><td><?= e($service['duration']) ?></td><td><?= e($service['price']) ?></td><td><?= e($service['staff']) ?></td><td><span class="status-pill green"><?= e($service['state']) ?></span></td><td><button class="row-more" aria-label="Opções para <?= e($service['name']) ?>">···</button></td></tr><?php endforeach; ?></tbody></table></div></article>
      <?php elseif ($page === 'patients'): ?>
        <section class="page-heading"><div><p class="eyebrow">RELACIONAMENTO</p><h1>Pacientes</h1><p class="subheading">Encontre cadastros e acompanhe o último atendimento.</p></div><button class="primary-button" data-toast="Cadastro de paciente (demonstração)"><span>＋</span> Novo paciente</button></section>
        <article class="panel full-panel"><div class="panel-heading"><div><h2>Base de pacientes</h2><p>428 cadastros na clínica</p></div><label class="search-box">⌕ <input class="clinic-search" placeholder="Buscar paciente"></label></div><div class="table-wrap"><table><thead><tr><th>PACIENTE</th><th>CELULAR</th><th>E-MAIL</th><th>ÚLTIMO ATENDIMENTO</th><th>STATUS</th><th></th></tr></thead><tbody><?php foreach($patients as $patient): ?><tr><td><b><?= e($patient['name']) ?></b></td><td><?= e($patient['phone']) ?></td><td><?= e($patient['email']) ?></td><td><?= e($patient['last']) ?></td><td><span class="status-pill <?= $patient['state']==='Ativo'?'green':'amber' ?>"><?= e($patient['state']) ?></span></td><td><button class="row-more" aria-label="Opções para <?= e($patient['name']) ?>">···</button></td></tr><?php endforeach; ?></tbody></table></div></article>
      <?php else: ?>
        <section class="page-heading"><div><p class="eyebrow">GESTÃO DA CLÍNICA</p><h1><?= e($pages[$page]) ?></h1><p class="subheading">Organize as informações e acompanhe a rotina da sua clínica.</p></div><?php if ($page !== 'settings'): ?><button class="primary-button" data-toast="Formulário de demonstração"><span>＋</span> Adicionar registro</button><?php endif; ?></section>
        <article class="panel placeholder-panel"><div class="placeholder-icon"><?= e($navIcons[$page]) ?></div><h2><?= e($pages[$page]) ?> em um só lugar</h2><p>Esta área está representada nesta demonstração visual. No sistema completo, aqui ficariam os cadastros e ações conectados ao banco de dados.</p><?php if ($page === 'settings'): ?><div class="settings-row"><span><b>Link público da clínica</b><small>Compartilhe uma página para receber solicitações de horário.</small></span><div class="settings-actions"><button class="secondary-button" data-toast="Link copiado (demonstração)">Copiar link</button><a class="secondary-button" href="?page=booking">Abrir reserva</a></div></div><div class="settings-row"><span><b>Preferência de tema</b><small>Use o botão no topo para alternar claro e escuro.</small></span><button class="secondary-button theme-toggle">Alternar tema</button></div><?php endif; ?></article>
      <?php endif; ?>
      <footer class="footer"><span>© <?= e($today->format('Y')) ?> NOA CONNECT</span><span>Feito para cuidar melhor <b>✦</b></span></footer>
    </div>
  </main>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<dialog class="appointment-modal" id="appointmentModal"><form method="dialog" id="appointmentForm"><div class="modal-heading"><div><p class="eyebrow">NOVO HORÁRIO</p><h2>Novo agendamento</h2></div><button class="icon-button" aria-label="Fechar">×</button></div><label>Nome do paciente<input name="patient" required placeholder="Ex.: Joana Silva"></label><div class="form-row"><label>Horário<input name="time" type="time" required value="15:30"></label><label>Serviço<select name="service"><option>Consulta inicial</option><option>Retorno</option><option>Avaliação</option></select></label></div><label>Profissional<select name="professional"><option>Dra. Ana Ribeiro</option><option>Dr. Pedro Lima</option><option>Dra. Júlia Nunes</option></select></label><div class="modal-actions"><button class="secondary-button" value="cancel">Cancelar</button><button class="primary-button" id="saveAppointment" value="default">Salvar demonstração</button></div><p class="demo-note">Demonstração: os dados não são gravados no servidor.</p></form></dialog>
<script src="assets/app.js" defer></script>
</body></html>
