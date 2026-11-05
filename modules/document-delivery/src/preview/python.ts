// Only this fixed wrapper and hash-checked code execute. No customer text is code.
export const PYTHON_WRAPPER = `import sys, resource, signal, os, json
from pathlib import Path
if sys.version_info < (3, 10):
    raise RuntimeError('unsupported Python')
os.umask(0o077)
resource.setrlimit(resource.RLIMIT_FSIZE, (8388608, 8388608))
resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
signal.signal(signal.SIGXFSZ, signal.SIG_DFL)
if sys.stdin.readline() != 'go\\n':
    raise RuntimeError('monitor unavailable')
sys.path.insert(0, str(Path('code').resolve()))
from runner_evidence.reader import collect
collect(Path('manifest.json'), Path('.'), Path('output'))
print(json.dumps({'pythonVersion': sys.version.split()[0]}))
`;
