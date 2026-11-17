<?php
declare(strict_types=1);

namespace Noa;

final class MercadoPagoWebhook
{
    public static function isValidSignature(string $signature, string $requestId, string $paymentId, string $secret): bool
    {
        if ($requestId === '' || $paymentId === '' ||
            !preg_match('/(?:^|,)\s*ts=([^,]+)/', $signature, $timestamp) ||
            !preg_match('/(?:^|,)\s*v1=([a-f0-9]{64})/i', $signature, $digest)) return false;
        $manifest = 'id:' . $paymentId . ';request-id:' . $requestId . ';ts:' . $timestamp[1] . ';';
        return hash_equals(hash_hmac('sha256', $manifest, $secret), strtolower($digest[1]));
    }

    public static function isValidPayment(array $payment, string $paymentId): bool
    {
        $amount = $payment['transaction_amount'] ?? null;
        if ((string)($payment['id'] ?? '') !== $paymentId ||
            !in_array($payment['status'] ?? null, ['approved', 'rejected', 'cancelled', 'pending', 'in_process'], true) ||
            ($payment['currency_id'] ?? null) !== 'BRL' || !is_numeric($amount) ||
            !is_finite((float)$amount) || (float)$amount <= 0) return false;
        $cents = (float)$amount * 100;
        return abs($cents - round($cents)) < 0.0000001;
    }

    public static function nextSessionStatus(string $sessionStatus, string $paymentStatus): ?string
    {
        if ($sessionStatus === 'pending' && $paymentStatus === 'approved') return 'paid';
        if (in_array($sessionStatus, ['failed', 'expired'], true) && $paymentStatus === 'approved') return 'paid_late';
        if ($sessionStatus === 'pending' && in_array($paymentStatus, ['rejected', 'cancelled'], true)) return 'failed';
        return null;
    }

    public static function canActivateClinic(string $status, ?string $suspensionReason): bool
    {
        return $status === 'suspended' && in_array($suspensionReason, ['onboarding', 'billing'], true);
    }
}
