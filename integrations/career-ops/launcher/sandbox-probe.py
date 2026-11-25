"""No-model native sandbox assertions; run via `codex sandbox` inside the pilot."""
from pathlib import Path
import errno
import json
import socket

assert Path('/data/readonly-probe.txt').read_text().strip() == 'CAREER_SANDBOX_READ_OK'
results = {'read_local_file': 'allowed'}
for path in ['/data/must-not-write', '/tmp/must-not-write']:
    try:
        Path(path).write_text('unexpected')
    except OSError as exc:
        assert exc.errno in (errno.EACCES, errno.EPERM, errno.EROFS), exc
        results['write_' + path] = 'denied'
    else:
        raise AssertionError('sandbox permitted write: ' + path)
for name, family, kind, address in [
    ('public_tcp', socket.AF_INET, socket.SOCK_STREAM, ('1.1.1.1', 443)),
    ('public_dns_udp', socket.AF_INET, socket.SOCK_DGRAM, ('1.1.1.1', 53)),
    ('ipv6_tcp', socket.AF_INET6, socket.SOCK_STREAM, ('2606:4700:4700::1111', 443)),
]:
    try:
        with socket.socket(family, kind) as sock:
            sock.settimeout(2)
            sock.connect(address)
    except OSError as exc:
        assert exc.errno in (errno.EACCES, errno.EPERM, errno.ENETUNREACH, errno.EAFNOSUPPORT), exc
        results[name] = 'denied'
    else:
        raise AssertionError('sandbox permitted network: ' + name)
status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert int(status['CapEff'].strip(), 16) == 0
assert status['NoNewPrivs'].strip() == '1'
results['effective_caps'] = 'zero'
results['no_new_privileges'] = True
print(json.dumps(results, sort_keys=True))
