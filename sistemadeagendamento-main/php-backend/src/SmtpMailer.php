<?php
declare(strict_types=1);

namespace Noa;

final class SmtpMailer
{
    public static function send(string $to,string $subjectText,string $text,string $html): void
    {
        $host=trim(getenv('SMTP_HOST') ?: ''); $port=(int)(getenv('SMTP_PORT') ?: 0); $secure=strtolower(trim(getenv('SMTP_SECURE') ?: ''));
        $username=getenv('SMTP_USER') ?: ''; $password=getenv('SMTP_PASSWORD') ?: ''; $from=trim(getenv('SMTP_FROM') ?: '');
        if($host==='' || $port<1 || $port>65535 || !in_array($secure,['true','false'],true) || $username==='' || $password==='' || $from==='' || preg_match('/[\r\n]/',$host) || preg_match('/[\r\n]/',$from)) throw new \RuntimeException('SMTP configuration unavailable.');
        if(preg_match('/<([^<>]+)>/',$from,$senderMatch)) $sender=trim($senderMatch[1]); else $sender=$from;
        if(!filter_var($sender,FILTER_VALIDATE_EMAIL) || !filter_var($to,FILTER_VALIDATE_EMAIL)) throw new \RuntimeException('SMTP address invalid.');
        $transport=($secure==='true'?'ssl://':'tcp://').$host.':'.$port; $socket=@stream_socket_client($transport,$errorCode,$errorMessage,15,STREAM_CLIENT_CONNECT);
        if(!is_resource($socket)) throw new \RuntimeException('SMTP connection failed.'); stream_set_timeout($socket,15);
        $readResponse=static function(array $expected) use($socket): void { $last=''; do { $line=fgets($socket,2048); if($line===false) throw new \RuntimeException('SMTP response unavailable.'); $last=$line; } while(isset($line[3]) && $line[3]==='-'); $code=(int)substr($last,0,3); if(!in_array($code,$expected,true)) throw new \RuntimeException('SMTP command rejected.'); };
        $write=static function(string $data) use($socket): void { while($data!=='') { $sent=fwrite($socket,$data); if($sent===false || $sent===0) throw new \RuntimeException('SMTP write failed.'); $data=substr($data,$sent); } };
        $command=static function(string $value,array $expected) use($write,$readResponse): void { $write($value."\r\n"); $readResponse($expected); };
        try {
            $readResponse([220]); $hostname=gethostname() ?: 'localhost'; $command('EHLO '.$hostname,[250]);
            if($secure==='false') { $command('STARTTLS',[220]); if(stream_socket_enable_crypto($socket,true,STREAM_CRYPTO_METHOD_TLS_CLIENT)!==true) throw new \RuntimeException('SMTP TLS negotiation failed.'); $command('EHLO '.$hostname,[250]); }
            $command('AUTH LOGIN',[334]); $command(base64_encode($username),[334]); $command(base64_encode($password),[235]); $command('MAIL FROM:<'.$sender.'>',[250]); $command('RCPT TO:<'.$to.'>',[250,251]); $command('DATA',[354]);
            $boundary='=_noa_'.bin2hex(random_bytes(12)); $subject='=?UTF-8?B?'.base64_encode($subjectText).'?=';
            $message='From: '.$from."\r\nTo: <".$to.">\r\nSubject: ".$subject."\r\nDate: ".gmdate('D, d M Y H:i:s')." +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$boundary\"\r\n\r\n";
            $message.="--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n".quoted_printable_encode($text)."\r\n--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n".quoted_printable_encode($html)."\r\n--$boundary--\r\n";
            $message=preg_replace('/\r\n|\r|\n/',"\r\n",$message); $message=preg_replace('/(^|\r\n)\./','$1..',$message); $write($message."\r\n.\r\n"); $readResponse([250]); $command('QUIT',[221]);
        } finally { fclose($socket); }
    }
}
