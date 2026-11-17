<?php
declare(strict_types=1);

namespace Noa;

require_once __DIR__ . '/PlanCatalog.php';

final class PlatformAdmin
{
    private const AUDIENCE = 'noa-connect-platform-admin';
    private const SUBSCRIPTION_STATUSES = ['trialing','active','past_due','cancelled','expired'];
    private const CLINIC_STATUSES = ['active','inactive','suspended'];

    private static function planName(string $plan): string
    {
        return PlanCatalog::plan($plan)['name'] ?? $plan;
    }

    private static function audit(?string $adminId, string $action, string $entityType='platform_admin', ?string $entityId=null, ?array $details=null, ?string $requestId=null, ?PDO $db=null): void
    {
        $db ??= Database::connection();
        $stmt=$db->prepare('INSERT INTO platform_audit_logs (platform_admin_id,action,entity_type,entity_id,details,request_id) VALUES (:admin,:action,:entity_type,:entity_id,CAST(:details AS jsonb),:request_id)');
        $stmt->execute(['admin'=>$adminId,'action'=>$action,'entity_type'=>$entityType,'entity_id'=>$entityId,'details'=>$details===null?null:json_encode($details,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),'request_id'=>$requestId]);
    }

    public static function login(array $body, string $requestId): array
    {
        $email=$body['email'] ?? null; $password=$body['password'] ?? null;
        if(!is_string($email) || trim($email)==='' || jsStringLength($email)>255 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',trim($email)) || !is_string($password) || $password==='' || jsStringLength($password)>1024) throw new ApiException(400,'Informe um e-mail e uma senha válidos.');
        $db=Database::connection(); $stmt=$db->prepare('SELECT id,email,name,password_hash,status,token_version FROM platform_admin_accounts WHERE email=LOWER(:email)'); $stmt->execute(['email'=>trim($email)]); $account=$stmt->fetch();
        $matched=$account ? password_verify($password,$account['password_hash']) : false;
        if(!$account || $account['status']!=='active' || !$matched) {
            self::audit(null,'platform.auth.denied','platform_admin',null,['reason'=>'invalid_credentials'],$requestId);
            throw new ApiException(401,'Credenciais inválidas.');
        }
        $db->beginTransaction();
        try {
            $update=$db->prepare("UPDATE platform_admin_accounts SET last_login_at=NOW(),updated_at=NOW() WHERE id=:id AND status='active' RETURNING id,email,name,token_version"); $update->execute(['id'=>$account['id']]); $active=$update->fetch();
            if(!$active) throw new ApiException(401,'Credenciais inválidas.');
            self::audit($active['id'],'platform.auth.login','platform_admin',null,null,$requestId,$db); $db->commit();
        } catch(\Throwable $error) { if($db->inTransaction()) $db->rollBack(); throw $error; }
        $token=Jwt::sign(['sub'=>$active['id'],'scope'=>'platform_admin','sessionVersion'=>(int)$active['token_version']],Jwt::ttl(),self::AUDIENCE);
        return ['token'=>$token,'user'=>['id'=>$active['id'],'email'=>$active['email'],'name'=>$active['name']]];
    }

    public static function authenticate(string $requestId): array
    {
        $header=$_SERVER['HTTP_AUTHORIZATION'] ?? ''; $token=preg_match('/^Bearer\s+(.+)$/i',$header,$m)?trim($m[1]):''; $claims=null;
        if($token!=='') { try { $claims=Jwt::verify($token,self::AUDIENCE); } catch(\Throwable) { $claims=null; } }
        if(!is_array($claims) || !is_string($claims['sub'] ?? null) || ($claims['scope'] ?? null)!=='platform_admin' || !isValidSessionVersion($claims['sessionVersion'] ?? null)) {
            self::audit(null,'platform.auth.denied','platform_admin',null,['reason'=>'invalid_or_missing_token'],$requestId);
            throw new ApiException(401,'Autenticação administrativa necessária.');
        }
        $stmt=Database::connection()->prepare('SELECT id,email,name,status,token_version FROM platform_admin_accounts WHERE id=:id'); $stmt->execute(['id'=>$claims['sub']]); $account=$stmt->fetch();
        if(!$account || $account['status']!=='active' || !isSessionVersionCurrent($claims['sessionVersion'],$account['token_version'])) {
            self::audit(null,'platform.auth.denied','platform_admin',null,['reason'=>'inactive_or_revoked_account'],$requestId);
            throw new ApiException(401,'Sessão administrativa inválida ou expirada.');
        }
        return ['id'=>$account['id'],'email'=>$account['email'],'name'=>$account['name']];
    }

    public static function me(array $admin,string $requestId): array
    {
        self::audit($admin['id'],'platform.auth.session_view','platform_admin',null,null,$requestId);
        return ['user'=>$admin];
    }

    public static function logout(array $admin,string $requestId): void
    {
        $db=Database::connection(); $db->beginTransaction();
        try {
            $stmt=$db->prepare("UPDATE platform_admin_accounts SET token_version=token_version+1,updated_at=NOW() WHERE id=:id AND status='active' RETURNING id"); $stmt->execute(['id'=>$admin['id']]);
            if(!$stmt->fetchColumn()) throw new ApiException(401,'Sessão administrativa inválida ou expirada.');
            self::audit($admin['id'],'platform.auth.logout','platform_admin',null,null,$requestId,$db); $db->commit();
        } catch(\Throwable $error) { if($db->inTransaction()) $db->rollBack(); throw $error; }
    }

    private static function validation(string $message): never { throw new ApiException(400,$message); }

    private static function pagination(array $filters): array
    {
        $page=$filters['page'] ?? '1'; $size=$filters['pageSize'] ?? '20';
        if((!is_string($page) && !is_int($page) && !is_float($page)) || (!is_string($size) && !is_int($size) && !is_float($size)) || !is_numeric($page) || !is_numeric($size)) self::validation('Parâmetros de paginação inválidos.');
        $p=(float)$page; $s=(float)$size;
        if(!is_finite($p) || floor($p)!==$p || $p<1 || $p>9007199254740991 || !is_finite($s) || floor($s)!==$s || $s<1 || $s>100) self::validation('Parâmetros de paginação inválidos.');
        return ['page'=>(int)$p,'pageSize'=>(int)$s,'offset'=>((int)$p-1)*(int)$s];
    }

    private static function date(mixed $value,string $field): ?string
    {
        if($value===null || $value==='') return null;
        if(!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/',$value)) self::validation("O filtro $field deve usar AAAA-MM-DD.");
        if(!checkdate((int)substr($value,5,2),(int)substr($value,8,2),(int)substr($value,0,4))) self::validation("O filtro $field contém uma data inválida.");
        return $value;
    }

    private static function dateRange(array $filters): array
    {
        $from=self::date($filters['from'] ?? null,'from'); $to=self::date($filters['to'] ?? null,'to');
        if($from && $to && $from>$to) self::validation('A data inicial deve ser anterior ou igual à data final.');
        if($from && $to && (strtotime($to.' UTC')-strtotime($from.' UTC'))>366*86400) self::validation('O período não pode exceder 367 dias.');
        return ['from'=>$from,'to'=>$to];
    }

    private static function filters(array $filters,bool $includeClinicStatus=false): array
    {
        $clauses=[]; $params=[];
        $add=static function(string $name,string $column,$value) use (&$clauses,&$params): void { if($value!==null && $value!=='') { $clauses[]="$column=:$name"; $params[$name]=$value; } };
        foreach([['status',self::SUBSCRIPTION_STATUSES,'s.status'],['plan',array_keys(PlanCatalog::plans()),'s.plan'],['billingCycle',array_keys(PlanCatalog::billingCycles()),'s.billing_cycle']] as [$key,$values,$column]) {
            $value=$filters[$key] ?? null; if($value!==null && $value!=='' && !in_array($value,$values,true)) self::validation("Filtro $key inválido."); $add('filter_'.$key,$column,$value);
        }
        if($includeClinicStatus) { $v=$filters['clinicStatus'] ?? null; if($v!==null && $v!=='' && !in_array($v,self::CLINIC_STATUSES,true)) self::validation('Filtro clinicStatus inválido.'); $add('filter_clinicStatus','c.status',$v); }
        $range=self::dateRange($filters); if($range['from']) {$clauses[]='s.created_at>=CAST(:filter_from AS date)';$params['filter_from']=$range['from'];} if($range['to']) {$clauses[]="s.created_at<CAST(:filter_to AS date)+INTERVAL '1 day'";$params['filter_to']=$range['to'];}
        if(array_key_exists('search',$filters) && !is_string($filters['search'])) self::validation('O parâmetro de pesquisa é inválido.');
        $search=trim((string)($filters['search'] ?? '')); if(textLength($search)>100) self::validation('A pesquisa deve ter no máximo 100 caracteres.');
        if($search!=='') { $clauses[]='(c.name ILIKE :search1 OR c.trade_name ILIKE :search2 OR c.email ILIKE :search3 OR c.phone ILIKE :search4 OR admin.name ILIKE :search5 OR admin.email ILIKE :search6)'; for($i=1;$i<=6;$i++) $params['search'.$i]='%'.$search.'%'; }
        return ['sql'=>$clauses?'WHERE '.implode(' AND ',$clauses):'','params'=>$params];
    }

    private static function recordView(array $admin,string $action,?string $entityId,string $requestId): void
    {
        self::audit($admin['id'],$action,$entityId?'clinic':'platform',$entityId,null,$requestId);
    }

    public static function dashboard(array $filters,array $admin,string $requestId): array
    {
        $requested=self::dateRange($filters); $to=$requested['to'] ?? gmdate('Y-m-d'); $from=$requested['from'] ?? gmdate('Y-m-d',strtotime($to.' UTC')-29*86400);
        $range=self::dateRange(['from'=>$from,'to'=>$to]); $days=(int)((strtotime($to.' UTC')-strtotime($from.' UTC'))/86400); $granularity=$days>62?'month':'day'; $db=Database::connection();
        $summary=$db->prepare("WITH latest AS (SELECT DISTINCT ON (clinic_id) clinic_id,plan,status,current_period_end FROM subscriptions ORDER BY clinic_id,created_at DESC,id DESC) SELECT (SELECT COUNT(*) FROM clinics)::int AS total_clinics,(SELECT COUNT(*) FROM latest WHERE status='active' AND current_period_end>NOW())::int AS active_subscriptions,(SELECT COUNT(*) FROM subscriptions WHERE created_at>=CAST(:from_start AS date) AND created_at<CAST(:to_end AS date)+INTERVAL '1 day')::int AS new_contracts,(SELECT COUNT(*) FROM latest WHERE status='cancelled')::int AS cancelled_subscriptions,(SELECT COUNT(*) FROM latest WHERE status='past_due')::int AS delinquent_subscriptions,(SELECT COUNT(*) FROM latest WHERE status='expired' OR (status IN ('active','trialing','past_due') AND current_period_end<=NOW()))::int AS expired_subscriptions"); $summary->execute(['from_start'=>$from,'to_end'=>$to]); $metrics=$summary->fetch();
        $active=$db->query("SELECT plan,billing_cycle FROM subscriptions WHERE status='active' AND current_period_end>NOW()")->fetchAll(); $mrr=0;
        foreach($active as $sub) { $price=PlanCatalog::priceInCents($sub['plan'],$sub['billing_cycle']); $months=PlanCatalog::billingCycles()[$sub['billing_cycle']]['months'] ?? null; if(!is_int($price)||!$months) throw new \RuntimeException('Uma assinatura ativa possui plano ou ciclo sem preço comercial definido.'); $mrr+=(int)round($price/$months); }
        $distribution=$db->query('SELECT latest.plan,COUNT(*)::int AS clinics FROM (SELECT DISTINCT ON (clinic_id) clinic_id,plan FROM subscriptions ORDER BY clinic_id,created_at DESC,id DESC) latest GROUP BY latest.plan ORDER BY latest.plan')->fetchAll();
        $timeline=$db->prepare("WITH buckets AS (SELECT generate_series(date_trunc('$granularity',CAST(:from_date AS date)::timestamp),date_trunc('$granularity',CAST(:to_date AS date)::timestamp),INTERVAL '1 $granularity') AS period) SELECT buckets.period::date AS period,COUNT(sub.id)::int AS contracts FROM buckets LEFT JOIN subscriptions sub ON sub.created_at>=buckets.period AND sub.created_at<buckets.period+INTERVAL '1 $granularity' GROUP BY buckets.period ORDER BY buckets.period"); $timeline->execute(['from_date'=>$from,'to_date'=>$to]);
        $events=$db->query("SELECT * FROM (SELECT c.id AS event_id,c.created_at AS occurred_at,'clinic.created'::text AS event_type,COALESCE(c.trade_name,c.name) AS clinic_name,NULL::text AS plan,NULL::text AS status FROM clinics c UNION ALL SELECT a.id AS event_id,a.created_at AS occurred_at,a.action AS event_type,COALESCE(c.trade_name,c.name) AS clinic_name,a.details->>'plan' AS plan,COALESCE(a.details->>'status',a.details->>'previousStatus') AS status FROM audit_logs a JOIN clinics c ON c.id=a.clinic_id WHERE a.entity_type='subscriptions' AND a.action IN ('subscription.created','subscription.updated','subscription.cancelled','subscription.trial_started','subscription.trial_ended')) events ORDER BY occurred_at DESC,event_id DESC LIMIT 20")->fetchAll();
        self::recordView($admin,'platform.dashboard.view',null,$requestId); $activeCount=(int)$metrics['active_subscriptions'];
        return ['period'=>$range,'metrics'=>['totalClinics'=>(int)$metrics['total_clinics'],'activeSubscriptions'=>$activeCount,'newContracts'=>(int)$metrics['new_contracts'],'pendingSubscriptions'=>['count'=>null,'supported'=>false],'cancelledSubscriptions'=>(int)$metrics['cancelled_subscriptions'],'delinquentSubscriptions'=>(int)$metrics['delinquent_subscriptions'],'expiredSubscriptions'=>(int)$metrics['expired_subscriptions'],'mrrEstimateInCents'=>$mrr,'arrEstimateInCents'=>$mrr*12,'activeSubscriptionsWithoutPaymentConfirmation'=>$activeCount,'confirmedSubscriptionPayments'=>['amountInCents'=>null,'count'=>null,'supported'=>false],'pendingSubscriptionCharges'=>['amountInCents'=>null,'count'=>null,'supported'=>false]],'planDistribution'=>array_map(static fn($r)=>['plan'=>$r['plan'],'planName'=>self::planName($r['plan']),'clinics'=>(int)$r['clinics']],$distribution),'contractsTimeline'=>$timeline->fetchAll(),'recentEvents'=>$events,'financialNotes'=>['MRR estimado soma apenas assinaturas active dentro do período vigente, normalizadas pelo preço do catálogo compartilhado: mensal = preço mensal; trimestral = preço total / 3; anual = preço total / 12.','ARR estimado = MRR estimado × 12. Valores estimados não representam dinheiro recebido.','Não existe integração ou registro de pagamentos de assinatura. Pagamentos existentes são vinculados a agendamentos das clínicas e não são receita da plataforma.','O estado pending não existe no domínio de assinaturas atual; cobranças pendentes da plataforma não podem ser determinadas.']];
    }

    public static function listClinics(array $filters,array $admin,string $requestId): array
    {
        $page=self::pagination($filters); $where=self::filters($filters,true); $params=$where['params']+['limit'=>$page['pageSize'],'offset'=>$page['offset']]; $db=Database::connection();
        $sql="SELECT c.id,c.name,c.trade_name,c.status,c.email AS contact_email,c.phone AS contact_phone,c.created_at,admin.name AS administrator_name,admin.email AS administrator_email,s.plan,s.billing_cycle,s.status AS subscription_status,s.started_at AS subscription_started_at,s.current_period_end AS renewal_at,COUNT(*) OVER()::int AS total FROM clinics c LEFT JOIN LATERAL (SELECT u.name,u.email FROM users u WHERE u.clinic_id=c.id AND u.role='admin' AND u.status='active' ORDER BY u.created_at,u.id LIMIT 1) admin ON TRUE LEFT JOIN LATERAL (SELECT sub.plan,sub.billing_cycle,sub.status,sub.started_at,sub.current_period_end,sub.created_at FROM subscriptions sub WHERE sub.clinic_id=c.id ORDER BY sub.created_at DESC,sub.id DESC LIMIT 1) s ON TRUE {$where['sql']} ORDER BY c.created_at DESC,c.id LIMIT :limit OFFSET :offset";
        $stmt=$db->prepare($sql); $stmt->execute($params); $rows=$stmt->fetchAll(); $total=$rows?(int)$rows[0]['total']:self::countClinics($db,$where);
        self::recordView($admin,'platform.clinics.list',null,$requestId);
        return ['data'=>array_map(static function($row){unset($row['total']);$row['planName']=$row['plan']?self::planName($row['plan']):null;$row['subscriptionPaymentStatus']='unavailable';return $row;},$rows),'pagination'=>['page'=>$page['page'],'pageSize'=>$page['pageSize'],'total'=>$total,'totalPages'=>(int)ceil($total/$page['pageSize'])]];
    }

    private static function countClinics(PDO $db,array $where): int
    {
        $sql="SELECT COUNT(*)::int AS total FROM clinics c LEFT JOIN LATERAL (SELECT u.name,u.email FROM users u WHERE u.clinic_id=c.id AND u.role='admin' AND u.status='active' ORDER BY u.created_at,u.id LIMIT 1) admin ON TRUE LEFT JOIN LATERAL (SELECT sub.plan,sub.billing_cycle,sub.status,sub.created_at FROM subscriptions sub WHERE sub.clinic_id=c.id ORDER BY sub.created_at DESC,sub.id DESC LIMIT 1) s ON TRUE {$where['sql']}"; $stmt=$db->prepare($sql);$stmt->execute($where['params']);return (int)$stmt->fetchColumn();
    }

    public static function clinicDetails(string $clinicId,array $admin,string $requestId): array
    {
        if(!isUuid($clinicId)) self::validation('Identificador de clínica inválido.'); $db=Database::connection();
        $stmt=$db->prepare("SELECT c.id,c.name,c.trade_name,c.status,c.email AS contact_email,c.phone AS contact_phone,c.whatsapp,c.city,c.state,c.created_at,c.updated_at,admin.id AS administrator_id,admin.name AS administrator_name,admin.email AS administrator_email,admin.phone AS administrator_phone,s.id AS subscription_id,s.plan,s.billing_cycle,s.status AS subscription_status,s.started_at AS subscription_started_at,s.current_period_start,s.current_period_end,s.trial_ends_at,s.cancelled_at FROM clinics c LEFT JOIN LATERAL (SELECT u.id,u.name,u.email,u.phone FROM users u WHERE u.clinic_id=c.id AND u.role='admin' AND u.status='active' ORDER BY u.created_at,u.id LIMIT 1) admin ON TRUE LEFT JOIN LATERAL (SELECT sub.* FROM subscriptions sub WHERE sub.clinic_id=c.id ORDER BY sub.created_at DESC,sub.id DESC LIMIT 1) s ON TRUE WHERE c.id=:clinic"); $stmt->execute(['clinic'=>$clinicId]); $clinic=$stmt->fetch(); if(!$clinic) throw new ApiException(404,'Clínica não encontrada.');
        $history=$db->prepare('SELECT id,plan,billing_cycle,status,started_at,current_period_start,current_period_end,trial_ends_at,cancelled_at,created_at,updated_at FROM subscriptions WHERE clinic_id=:clinic ORDER BY created_at DESC LIMIT 50');$history->execute(['clinic'=>$clinicId]);
        $events=$db->prepare("SELECT a.id,a.action,a.entity_id,jsonb_strip_nulls(jsonb_build_object('plan',a.details->>'plan','billingCycle',a.details->>'billingCycle','status',a.details->>'status','previousStatus',a.details->>'previousStatus','trialEndsAt',a.details->>'trialEndsAt','priceInCents',a.details->>'priceInCents')) AS details,a.created_at,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id AND u.clinic_id=a.clinic_id WHERE a.clinic_id=:clinic AND a.entity_type='subscriptions' AND a.action LIKE 'subscription.%' ORDER BY a.created_at DESC LIMIT 50");$events->execute(['clinic'=>$clinicId]);$eventRows=$events->fetchAll(); foreach($eventRows as &$event) if(is_string($event['details'])) $event['details']=json_decode($event['details'],true); unset($event);
        self::recordView($admin,'platform.clinic.view',$clinicId,$requestId);$clinic['planName']=$clinic['plan']?self::planName($clinic['plan']):null;$clinic['subscriptionPaymentStatus']='unavailable';
        $subscriptions=array_map(static function($sub){$sub['planName']=self::planName($sub['plan']);$sub['priceInCents']=PlanCatalog::priceInCents($sub['plan'],$sub['billing_cycle']);return $sub;},$history->fetchAll());
        return ['clinic'=>$clinic,'subscriptions'=>$subscriptions,'subscriptionEvents'=>$eventRows,'financialNote'=>'Pagamentos SaaS não estão integrados; os registros de pagamento existentes referem-se a agendamentos.'];
    }

    public static function subscriptions(array $filters,array $admin,string $requestId): array
    {
        $page=self::pagination($filters);$where=self::filters($filters);$params=$where['params']+['limit'=>$page['pageSize'],'offset'=>$page['offset']];$db=Database::connection();
        $sql="SELECT s.id,s.clinic_id,COALESCE(c.trade_name,c.name) AS clinic_name,c.email AS clinic_email,admin.name AS administrator_name,s.plan,s.billing_cycle,s.status,s.started_at,s.current_period_start,s.current_period_end,s.trial_ends_at,s.cancelled_at,s.created_at,s.updated_at,COUNT(*) OVER()::int AS total FROM subscriptions s JOIN clinics c ON c.id=s.clinic_id LEFT JOIN LATERAL (SELECT u.name FROM users u WHERE u.clinic_id=c.id AND u.role='admin' AND u.status='active' ORDER BY u.created_at,u.id LIMIT 1) admin ON TRUE {$where['sql']} ORDER BY s.created_at DESC,s.id DESC LIMIT :limit OFFSET :offset";
        $stmt=$db->prepare($sql);$stmt->execute($params);$rows=$stmt->fetchAll();$total=$rows?(int)$rows[0]['total']:self::countSubscriptions($db,$where);self::recordView($admin,'platform.subscriptions.list',null,$requestId);
        $data=[];foreach($rows as $row){unset($row['total']);$price=PlanCatalog::priceInCents($row['plan'],$row['billing_cycle']);$months=PlanCatalog::billingCycles()[$row['billing_cycle']]['months']??null;$row['planName']=self::planName($row['plan']);$row['priceInCents']=$price;$row['monthlyEquivalentInCents']=is_int($price)&&$months?(int)round($price/$months):null;$row['subscriptionPaymentStatus']='unavailable';$data[]=$row;}
        return ['data'=>$data,'pagination'=>['page'=>$page['page'],'pageSize'=>$page['pageSize'],'total'=>$total,'totalPages'=>(int)ceil($total/$page['pageSize'])]];
    }

    private static function countSubscriptions(PDO $db,array $where): int
    {
        $sql="SELECT COUNT(*)::int AS total FROM subscriptions s JOIN clinics c ON c.id=s.clinic_id LEFT JOIN LATERAL (SELECT u.name,u.email FROM users u WHERE u.clinic_id=c.id AND u.role='admin' AND u.status='active' ORDER BY u.created_at,u.id LIMIT 1) admin ON TRUE {$where['sql']}";$stmt=$db->prepare($sql);$stmt->execute($where['params']);return (int)$stmt->fetchColumn();
    }

    private static function eventSource(): string
    {
        return "SELECT c.id AS event_id,c.created_at AS occurred_at,'clinic.created'::text AS event_type,COALESCE(c.trade_name,c.name) AS clinic_name,NULL::text AS plan,NULL::text AS status FROM clinics c UNION ALL SELECT a.id AS event_id,a.created_at AS occurred_at,a.action AS event_type,COALESCE(c.trade_name,c.name) AS clinic_name,a.details->>'plan' AS plan,COALESCE(a.details->>'status',a.details->>'previousStatus') AS status FROM audit_logs a JOIN clinics c ON c.id=a.clinic_id WHERE a.entity_type='subscriptions' AND a.action IN ('subscription.created','subscription.updated','subscription.cancelled','subscription.trial_started','subscription.trial_ended')";
    }

    public static function events(array $filters,array $admin,string $requestId): array
    {
        $page=self::pagination($filters);$db=Database::connection();$source=self::eventSource();$stmt=$db->prepare("SELECT * FROM ($source) events ORDER BY occurred_at DESC,event_id DESC LIMIT :limit OFFSET :offset");$stmt->execute(['limit'=>$page['pageSize'],'offset'=>$page['offset']]);$count=(int)$db->query("SELECT COUNT(*) FROM ($source) events")->fetchColumn();self::recordView($admin,'platform.events.list',null,$requestId);
        return ['data'=>$stmt->fetchAll(),'pagination'=>['page'=>$page['page'],'pageSize'=>$page['pageSize'],'total'=>$count,'totalPages'=>(int)ceil($count/$page['pageSize'])]];
    }
}
