<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/PlanCatalog.php';

use Noa\PlanCatalog;

$checks = 0;
$expect = static function (bool $condition, string $message) use (&$checks): void {
    $checks++;
    if (!$condition) {
        throw new RuntimeException($message);
    }
};

$expect(PlanCatalog::commercialPlanIds() === ['essential', 'professional'], 'Commercial plans differ from the shared catalog.');
$expect(PlanCatalog::billingCycles()['quarterly']['months'] === 3, 'Quarterly billing cycle is invalid.');
$expect(PlanCatalog::priceInCents('essential', 'monthly') === 15000, 'Essential monthly price is invalid.');
$expect(PlanCatalog::priceInCents('professional', 'yearly') === 240000, 'Professional yearly price is invalid.');
$expect(PlanCatalog::priceInCents('complete', 'monthly') === 14999, 'Legacy plan pricing was not preserved.');
$expect(PlanCatalog::resourceLimit('essential', 'professionals') === 5, 'Essential professional limit is invalid.');
$expect(PlanCatalog::resourceLimit('professional', 'professionals') === null, 'Professional plan should not limit professionals.');
$expect(PlanCatalog::capabilityIsAvailable('essential', 'basicScheduling'), 'Essential scheduling capability should be available.');
$expect(!PlanCatalog::capabilityIsAvailable('essential', 'reports'), 'Essential reports capability should not be available.');
$expect(!PlanCatalog::capabilityIsAvailable('unknown', 'basicScheduling'), 'Unknown plans must fail closed.');
$expect(PlanCatalog::priceInCents('unknown', 'monthly') === null, 'Unknown plans must not have a price.');

try {
    PlanCatalog::resourceLimit('essential', 'unknown');
    throw new RuntimeException('Unknown resources must be rejected.');
} catch (InvalidArgumentException) {
    $checks++;
}

fwrite(STDOUT, "Plan catalog checks passed: {$checks}\n");
