"""Troca a versão do app em js/app.js, sw.js e index.html.
uso: python tools/nova_versao.py 0.4.0"""
import pathlib, re, sys

v = sys.argv[1]
assert re.fullmatch(r"\d+\.\d+\.\d+", v), "use o formato X.Y.Z"
raiz = pathlib.Path(__file__).resolve().parent.parent
trocas = {
    "js/app.js": (r"const VERSAO = '[\d.]+';", f"const VERSAO = '{v}';"),
    "sw.js": (r"const VERSAO = '[\d.]+';", f"const VERSAO = '{v}';"),
    "index.html": (r"\?v=[\d.]+", f"?v={v}"),
}
for arq, (padrao, novo) in trocas.items():
    p = raiz / arq
    s, n = re.subn(padrao, novo, p.read_text(encoding="utf-8"))
    assert n, f"versão não encontrada em {arq}"
    p.write_text(s, encoding="utf-8")
    print(f"{arq}: {n} troca(s)")
