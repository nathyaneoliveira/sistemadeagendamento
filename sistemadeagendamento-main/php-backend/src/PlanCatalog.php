<?php
declare(strict_types=1);

namespace Noa;

final class PlanCatalog
{
    private static ?array $catalog = null;

    public static function all(): array
    {
        if (self::$catalog !== null) return self::$catalog;

        $path = dirname(__DIR__, 2) . '/shared/planCatalog.json';
        $json = file_get_contents($path);
        if ($json === false) throw new \RuntimeException('Shared plan catalog is unavailable.');

        try {
            $catalog = json_decode($json, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new \RuntimeException('Shared plan catalog is invalid.', 0, $error);
        }

        if (!is_array($catalog['plans'] ?? null) ||
            !is_array($catalog['billingCycles'] ?? null) ||
            !is_array($catalog['capabilities'] ?? null) ||
            !is_array($catalog['planLimitResources'] ?? null) ||
            !is_array($catalog['commercialPlanIds'] ?? null)) {
            throw new \RuntimeException('Shared plan catalog has an invalid shape.');
        }

        self::$catalog = $catalog;
        return self::$catalog;
    }

    public static function plans(): array
    {
        return self::all()['plans'];
    }

    public static function plan(string $id): ?array
    {
        $plan = self::plans()[$id] ?? null;
        return is_array($plan) ? $plan : null;
    }

    public static function billingCycles(): array
    {
        return self::all()['billingCycles'];
    }

    public static function commercialPlanIds(): array
    {
        return self::all()['commercialPlanIds'];
    }

    public static function capabilityIsAvailable(string $planId, string $capability): bool
    {
        $plan = self::plan($planId);
        return $plan !== null && ($plan['capabilities'][$capability] ?? false) === true;
    }

    public static function resourceLimit(string $planId, string $resource): ?int
    {
        $plan = self::plan($planId);
        if ($plan === null || !array_key_exists($resource, $plan['limits'] ?? [])) {
            throw new \InvalidArgumentException('Unknown plan or resource.');
        }

        $limit = $plan['limits'][$resource];
        if ($limit !== null && (!is_int($limit) || $limit < 0)) {
            throw new \RuntimeException('Shared plan catalog contains an invalid resource limit.');
        }
        return $limit;
    }

    public static function priceInCents(string $planId, string $billingCycle): ?int
    {
        $price = self::plan($planId)['pricesInCents'][$billingCycle] ?? null;
        return is_int($price) ? $price : null;
    }
}
