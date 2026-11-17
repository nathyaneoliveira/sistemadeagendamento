<?php
declare(strict_types=1);

namespace Noa;

final class AppointmentState
{
    private const TRANSITIONS = [
        'scheduled' => ['confirmed', 'cancelled'],
        'confirmed' => ['completed', 'cancelled', 'no_show'],
        'completed' => [],
        'cancelled' => [],
        'no_show' => [],
        'rescheduled' => [],
    ];

    public static function isKnownStatus(mixed $status): bool
    {
        return is_string($status) && array_key_exists($status, self::TRANSITIONS);
    }

    public static function allowsStatusTransition(mixed $current, mixed $next): bool
    {
        return is_string($current) &&
            is_string($next) &&
            in_array($next, self::TRANSITIONS[$current] ?? [], true);
    }

    public static function canReschedule(mixed $status): bool
    {
        return in_array($status, ['scheduled', 'confirmed'], true);
    }

    public static function occupiesSchedule(mixed $status): bool
    {
        return in_array($status, ['scheduled', 'confirmed', 'completed', 'no_show'], true);
    }
}
