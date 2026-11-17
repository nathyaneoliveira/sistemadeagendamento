# Demonstração PHP — NOA CONNECT

Protótipo visual independente do app atual, feito com PHP, HTML, CSS e JavaScript sem framework. Reúne a página comercial, login e recuperação de acesso, painel da clínica, reserva pública demonstrativa e administração global com resumo, lista de clínicas e assinaturas.

A camada `assets/figma-theme.css` adapta a apresentação do protótipo à identidade visual do Figma: paleta verde e neutra, marca NOA CONNECT, navegação compacta, login centralizado e reserva em formato mobile-first. O logo local fica em `assets/noa-connect-logo.png`.

Os nomes, métricas e horários são fictícios. Este protótipo não se conecta ao PostgreSQL nem implementa autenticação, permissões, e-mail, agenda real ou APIs. Ele mostra como a interface poderia ser organizada após uma migração; não substitui o sistema existente.

## Telas

- `?page=commercial` — página comercial e planos.
- `?page=contract&plan=essential` ou `?page=contract&plan=professional` — fluxo demonstrativo de contratação: escolha do plano/período, dados da clínica, revisão e confirmação.
- `?page=login`, `?page=register`, `?page=forgot`, `?page=reset` — autenticação demonstrativa.
- `?page=dashboard`, `?page=appointments`, `?page=schedule`, `?page=professionals`, `?page=services`, `?page=patients`, `?page=settings` — área da clínica.
- `?page=booking` — solicitação de reserva pública, sem envio ou persistência.
- `?page=platform-login` — entrada do proprietário; o formulário fictício leva ao resumo global.
- `?page=owner`, `?page=owner-clinics`, `?page=owner-subscriptions` — métricas, clínicas e assinaturas da plataforma.

No resumo do proprietário, os números de exemplo são 54 clínicas cadastradas, 37 assinaturas ativas e MRR estimado de R$ 6.350. O valor é calculado de forma ilustrativa a partir de preços de catálogo, sem representar pagamentos recebidos.

O fluxo de contratação também é apenas uma simulação: não envia nem persiste os dados informados, não cria uma clínica e não realiza cobrança. Em produção, seria necessário integrar o recebimento de solicitações, provisionamento da clínica, contrato e checkout de pagamento.

## Executar

Com PHP instalado, execute na raiz do projeto:

```bash
php -S 127.0.0.1:8766 -t php-demo
```

Depois abra `http://127.0.0.1:8766`. O servidor embutido do PHP é apenas para desenvolvimento local.
