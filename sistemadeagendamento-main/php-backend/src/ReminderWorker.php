<?php
declare(strict_types=1);

namespace Noa;

final class ReminderWorker
{
    public static function runBatch(int $batchSize=20,?array $source=null): int
    {
        if($batchSize<1 || $batchSize>100) throw new \InvalidArgumentException('Batch size must be between 1 and 100.');
        $source ??= self::environment(); $db=Database::connection(); $db->beginTransaction(); $reminders=[];
        try {
            $select=$db->prepare("SELECT r.id FROM appointment_reminders r JOIN appointments a ON a.id=r.appointment_id AND a.clinic_id=r.clinic_id JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id JOIN clinics c ON c.id=a.clinic_id JOIN clinic_configurations cc ON cc.clinic_id=c.id WHERE (r.status IN ('pending','failed') OR (r.status='processing' AND r.updated_at<NOW()-INTERVAL '15 minutes')) AND r.due_at<=NOW() AND r.attempts<5 AND a.status IN ('scheduled','confirmed') AND p.reminder_consent_at IS NOT NULL AND cc.appointment_reminders_enabled=TRUE ORDER BY r.due_at LIMIT :batch FOR UPDATE OF r SKIP LOCKED");
            $select->execute(['batch'=>$batchSize]); $ids=array_column($select->fetchAll(),'id');
            if($ids) {
                $idParams=[];$holders=[];foreach($ids as $index=>$id){$key='id'.$index;$holders[]=':'.$key;$idParams[$key]=$id;}
                foreach($ids as $id){$mark=$db->prepare("UPDATE appointment_reminders SET status='processing',attempts=attempts+1,updated_at=NOW() WHERE id=:id");$mark->execute(['id'=>$id]);}
                $query=$db->prepare("SELECT r.id,r.channel,r.kind,a.scheduled_start,p.email AS patient_email,p.phone AS patient_phone,COALESCE(NULLIF(trim(cc.name),''),c.trade_name,c.name) AS clinic_name,cc.timezone FROM appointment_reminders r JOIN appointments a ON a.id=r.appointment_id AND a.clinic_id=r.clinic_id JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id JOIN clinics c ON c.id=a.clinic_id JOIN clinic_configurations cc ON cc.clinic_id=c.id WHERE r.id IN (".implode(',',$holders).')');
                $query->execute($idParams);$reminders=$query->fetchAll();
            }
            $db->commit();
        } catch(\Throwable $error) { if($db->inTransaction())$db->rollBack(); throw $error; }
        foreach($reminders as $reminder) {
            try {
                self::deliver($reminder,$source);
                $sent=$db->prepare("UPDATE appointment_reminders SET status='sent',sent_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=:id AND status='processing'");$sent->execute(['id'=>$reminder['id']]);
            } catch(\Throwable $error) {
                $message=self::truncate($error->getMessage(),300);
                $failed=$db->prepare("UPDATE appointment_reminders SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,due_at=NOW()+LEAST(attempts,60)*INTERVAL '5 minutes',last_error=:error,updated_at=NOW() WHERE id=:id AND status='processing'");$failed->execute(['error'=>$message,'id'=>$reminder['id']]);
            }
        }
        return count($reminders);
    }

    private static function deliver(array $reminder,array $source): void
    {
        $zone=new \DateTimeZone(is_string($reminder['timezone'] ?? null) && $reminder['timezone']!==''?$reminder['timezone']:'UTC');
        $date=(new \DateTimeImmutable($reminder['scheduled_start']))->setTimezone($zone)->format('d/m/Y, H:i');
        $confirmation=$reminder['kind']==='confirmation';$message=($confirmation?'Confirmação: seu agendamento foi confirmado':'Lembrete: você tem um agendamento').' em '.$date.'. Para alterar ou cancelar, entre em contato com a clínica '.$reminder['clinic_name'].'.';
        if($reminder['channel']==='email') {
            if(!self::configured($source,['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM']) || !in_array(strtolower((string)($source['SMTP_SECURE'] ?? '')),['true','false'],true) || empty($reminder['patient_email'])) throw new \RuntimeException('E-mail de lembrete não configurado ou ausente.');
            $subject=$confirmation?'Confirmação de agendamento':'Lembrete de agendamento';
            SmtpMailer::send($reminder['patient_email'],$subject,$message,'<p>'.htmlspecialchars($message,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</p>');
            return;
        }
        if(empty($source['WHATSAPP_API_URL']) || empty($source['WHATSAPP_API_TOKEN']) || empty($reminder['patient_phone'])) throw new \RuntimeException('Provedor de WhatsApp não configurado ou telefone ausente.');
        $url=(string)$source['WHATSAPP_API_URL'];$parts=parse_url($url);$production=strtolower((string)($source['NODE_ENV'] ?? ''))==='production';
        if(!is_array($parts) || !in_array(strtolower($parts['scheme'] ?? ''),['http','https'],true) || empty($parts['host']) || ($production && strtolower($parts['scheme'])!=='https')) throw new \RuntimeException('URL do provedor de WhatsApp inválida.');
        $options=['http'=>['method'=>'POST','header'=>"Authorization: Bearer ".$source['WHATSAPP_API_TOKEN']."\r\nContent-Type: application/json\r\n",'content'=>json_encode(['to'=>$reminder['patient_phone'],'message'=>$message],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'ignore_errors'=>true,'timeout'=>20,'follow_location'=>0]];
        $response=@file_get_contents($url,false,stream_context_create($options));$headers=$http_response_header ?? [];$status=0;
        if(isset($headers[0]) && preg_match('/\s(\d{3})\s/',$headers[0],$match))$status=(int)$match[1];
        if($status<200 || $status>=300) throw new \RuntimeException('Provedor de WhatsApp respondeu HTTP '.$status.'.');
    }

    private static function configured(array $source,array $keys): bool
    {
        foreach($keys as $key) if(!is_string($source[$key] ?? null) || trim($source[$key])==='') return false;
        $port=$source['SMTP_PORT'] ?? null;return is_string($port) && ctype_digit($port) && (int)$port>=1 && (int)$port<=65535;
    }

    private static function environment(): array
    {
        $source = [];
        foreach (['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','SMTP_SECURE','WHATSAPP_API_URL','WHATSAPP_API_TOKEN','NODE_ENV'] as $key) {
            $value = getenv($key);
            if ($value !== false) $source[$key] = $value;
        }
        return $source;
    }

    private static function truncate(string $value,int $limit): string
    {
        if(function_exists('mb_substr')) return mb_substr($value,0,$limit,'UTF-8');
        if(preg_match('/^.{0,'.$limit.'}/us',$value,$match)) return $match[0];
        return substr($value,0,$limit);
    }
}
