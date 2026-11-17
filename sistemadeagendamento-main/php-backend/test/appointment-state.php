<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/AppointmentState.php';

$allowed = [
    'scheduled' => ['confirmed', 'cancelled'],
    'confirmed' => ['completed', 'cancelled', 'no_show'],
    'completed' => [],
    'cancelled' => [],
    'no_show' => [],
    'rescheduled' => [],
];

foreach ($allowed as $current => $destinations) {
    if (!Noa\AppointmentState::isKnownStatus($current)) {
        fwrite(STDERR, "FAIL known status $current was rejected\n");
        exit(1);
    }
    foreach (array_keys($allowed) as $next) {
        $expected = in_array($next, $destinations, true);
        if (Noa\AppointmentState::allowsStatusTransition($current, $next) !== $expected) {
            fwrite(STDERR, "FAIL transition $current -> $next\n");
            exit(1);
        }
    }
}

if (Noa\AppointmentState::isKnownStatus('unknown')) {
    fwrite(STDERR, "FAIL unknown status was accepted\n");
    exit(1);
}

if (Noa\AppointmentState::allowsStatusTransition('unknown', 'scheduled')) {
    fwrite(STDERR, "FAIL unknown status was accepted\n");
    exit(1);
}

foreach (['scheduled', 'confirmed'] as $status) {
    if (!Noa\AppointmentState::canReschedule($status)) {
        fwrite(STDERR, "FAIL $status should be reschedulable\n");
        exit(1);
    }
}

foreach (['completed', 'cancelled', 'no_show', 'rescheduled'] as $status) {
    if (Noa\AppointmentState::canReschedule($status)) {
        fwrite(STDERR, "FAIL $status should be final for rescheduling\n");
        exit(1);
    }
}

foreach (['scheduled', 'confirmed', 'completed', 'no_show'] as $status) {
    if (!Noa\AppointmentState::occupiesSchedule($status)) {
        fwrite(STDERR, "FAIL $status should occupy the schedule\n");
        exit(1);
    }
}

foreach (['cancelled', 'rescheduled'] as $status) {
    if (Noa\AppointmentState::occupiesSchedule($status)) {
        fwrite(STDERR, "FAIL $status should release the schedule\n");
        exit(1);
    }
}

fwrite(STDOUT, "PASS PHP appointment transition matrix and schedule occupancy\n");
