# Arma la app: dist/artifact.html (para publicar) y dist/modem_acustico.html (archivo independiente)
import json, pathlib
root = pathlib.Path(__file__).parent
app = (root / 'src/app.html').read_text()
modem = (root / 'src/modem.js').read_text()
ref = json.loads((root / 'dist/reference.json').read_text())
app = app.replace('/*__MODEM_JS__*/', modem).replace('/*__REFERENCE_JSON__*/null', json.dumps(ref, separators=(',', ':')))
(root / 'dist/artifact.html').write_text(app)
skeleton = ('<!doctype html><html lang="es"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
(root / 'dist/modem_acustico.html').write_text(skeleton + app + '</body></html>')
print('ok', len(app))
