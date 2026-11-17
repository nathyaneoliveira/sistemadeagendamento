<?php
declare(strict_types=1);

$arguments = array_slice($argv, 1);
if (in_array('--help', $arguments, true) || in_array('-h', $arguments, true)) {
    fwrite(STDOUT, "Usage: php bin/reminder-worker.php [--once]\n\nWithout --once, processes a batch every 60 seconds.\n");
    exit(0);
}
if (array_diff($arguments, ['--once']) !== []) {
    fwrite(STDERR, "Unknown argument. Use --help.\n");
    exit(2);
}

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/SmtpMailer.php';
require_once dirname(__DIR__) . '/src/ReminderWorker.php';

use Noa\ReminderWorker;

try {
    Noa\validateDatabaseConfiguration();
} catch (Throwable $error) {
    fwrite(STDERR, "Invalid worker configuration: {$error->getMessage()}\n");
    exit(1);
}

$once = in_array('--once', $arguments, true);
do {
    try {
        $count = ReminderWorker::runBatch();
        fwrite(STDOUT, sprintf("%s processed=%d\n", gmdate('c'), $count));
    } catch (Throwable $error) {
        fwrite(STDERR, sprintf("%s reminder batch failed (%s).\n", gmdate('c'), get_class($error)));
        if ($once) exit(1);
    }
    if (!$once) sleep(60);
} while (!$once);
