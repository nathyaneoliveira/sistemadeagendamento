<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/MercadoPagoWebhook.php';

use Noa\MercadoPagoWebhook;

$assertions = 0;
$assert = static function (bool $condition, string $message) use (&$assertions): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL $message\n");
        exit(1);
    }
    $assertions++;
};

$payment = [
    'id' => '123456789',
    'status' => 'approved',
    'currency_id' => 'BRL',
    'transaction_amount' => 150.00,
];
$assert(MercadoPagoWebhook::isValidPayment($payment, '123456789'), 'valid approved payment accepted');
$assert(!MercadoPagoWebhook::isValidPayment($payment, '987654321'), 'provider payment id must match notification id');
$assert(!MercadoPagoWebhook::isValidPayment(array_replace($payment, ['currency_id' => 'USD']), '123456789'), 'currency mismatch rejected');
$assert(!MercadoPagoWebhook::isValidPayment(array_replace($payment, ['transaction_amount' => 150.001]), '123456789'), 'amount precision beyond cents rejected');
$assert(!MercadoPagoWebhook::isValidPayment(array_replace($payment, ['transaction_amount' => INF]), '123456789'), 'non-finite amount rejected');

$assert(MercadoPagoWebhook::nextSessionStatus('pending', 'approved') === 'paid', 'pending approved transition');
$assert(MercadoPagoWebhook::nextSessionStatus('pending', 'rejected') === 'failed', 'pending rejected transition');
$assert(MercadoPagoWebhook::nextSessionStatus('pending', 'cancelled') === 'failed', 'pending cancelled transition');
$assert(MercadoPagoWebhook::nextSessionStatus('failed', 'approved') === 'paid_late', 'failed late approval transition');
$assert(MercadoPagoWebhook::nextSessionStatus('expired', 'approved') === 'paid_late', 'expired late approval transition');
$assert(MercadoPagoWebhook::nextSessionStatus('paid', 'approved') === null, 'paid session is terminal');
$assert(MercadoPagoWebhook::nextSessionStatus('paid_late', 'approved') === null, 'paid_late session is terminal');

$manifest = 'id:123456789;request-id:req-test;ts:123456;';
$signature = 'ts=123456,v1=' . hash_hmac('sha256', $manifest, 'synthetic-secret');
$assert(MercadoPagoWebhook::isValidSignature($signature, 'req-test', '123456789', 'synthetic-secret'), 'valid signature accepted');
$assert(!MercadoPagoWebhook::isValidSignature($signature, 'different-request', '123456789', 'synthetic-secret'), 'request id signature mismatch rejected');
$assert(!MercadoPagoWebhook::isValidSignature('invalid', 'req-test', '123456789', 'synthetic-secret'), 'malformed signature rejected');

$assert(MercadoPagoWebhook::canActivateClinic('suspended', 'onboarding'), 'onboarding clinic may activate after timely payment');
$assert(MercadoPagoWebhook::canActivateClinic('suspended', 'billing'), 'billing suspension may activate after timely payment');
$assert(!MercadoPagoWebhook::canActivateClinic('suspended', 'administrative'), 'administrative suspension must not activate after payment');
$assert(!MercadoPagoWebhook::canActivateClinic('active', null), 'active state does not need payment reactivation');

fwrite(STDOUT, "PASS $assertions PHP Mercado Pago webhook rule assertions.\n");
