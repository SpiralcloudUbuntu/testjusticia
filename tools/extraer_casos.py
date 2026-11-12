#!/usr/bin/env python3
"""Extrae el supuesto de hecho de los cuadernillos de caso práctico
y genera datos/casos.js para la app TestJusticia."""
import fitz, re, json, io, os

BASE = os.path.expanduser('~/.hermes/workspace/testjusticia/fuentes/examenes')

DEFS = [
    ('tramitacion-2024-A',   '_opoluz/2024_2do.pdf',                    'TEXTO:',               'CUESTIONES'),
    ('tramitacion-2024-inc', '_opoluz/2024inc_2do.pdf',                 'SUPUESTO PRÁCTICO',    'PREGUNTAS'),
    ('tramitacion-2025-A',   '_ministerio/2025_casopractico_A_1437.pdf','Dª Lucía Álvarez Sotero contrajo matrimonio', 'CUESTIONES'),
    ('tramitacion-2025-B',   '_ministerio/2025_casopractico_B_1437.pdf','Dª Lucía Álvarez Sotero contrajo matrimonio', 'CUESTIONES'),
    ('tramitacion-2025-inc', '_ministerio/2025inc_ej2_1437.pdf',        'Sobre las 23:00 horas','CUESTIONES'),
]

RUIDO = [
    r'P\s*á\s*g\s*i\s*n\s*a\s*\d+\s*\|\s*\d+',
    r'^\s*Segundo ejercicio\.?[^\n]*-?\s*Página\s*\d+\s*\|\s*\d+\s*$',
    r'^\s*E\s*J\s*E\s*R\s*C\s*I\s*C\s*I\s*O\s*2[^\n]*$',
]

def limpia(t):
    t = t.replace('\u00ad', '').replace('\xa0', ' ')
    for r in RUIDO:
        t = re.sub(r, ' ', t, flags=re.MULTILINE)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\s*\n\s*', '\n', t)
    t = re.sub(r'\n{2,}', '\n\n', t)
    return t.strip()

def extrae(path, ini, fin):
    d = fitz.open(path)
    t = ''.join(d[i].get_text() for i in range(d.page_count))
    t = limpia(t)
    i = t.find(ini)
    if i < 0:
        raise ValueError('no encuentro inicio %r en %s' % (ini, path))
    t = t[i:]
    for rot in ('TEXTO:', 'SUPUESTO PRÁCTICO'):
        if t.lstrip().startswith(rot):
            t = t.lstrip()[len(rot):]
    j = t.find(fin)
    if j < 0:
        raise ValueError('no encuentro fin %r en %s' % (fin, path))
    t = t[:j]
    t = t.lstrip(' .:-\n')
    # Unir lineas cortadas a mitad de frase
    lineas = [l.strip() for l in t.split('\n') if l.strip()]
    parrafos, buf = [], ''
    for l in lineas:
        if buf and not re.search(r'[.:;»"”]$', buf) and not re.match(r'^[-•\d]', l):
            buf += ' ' + l
        else:
            if buf:
                parrafos.append(buf)
            buf = l
    if buf:
        parrafos.append(buf)
    t = '\n\n'.join(parrafos)
    t = re.sub(r' +', ' ', t)
    return t.strip()

res = {}
for clave, rel, ini, fin in DEFS:
    txt = extrae(os.path.join(BASE, rel), ini, fin)
    res[clave] = txt
    print('%-22s %5d chars | %s' % (clave, len(txt), txt[:90].replace('\n', ' ')))

salida = os.path.expanduser('~/.hermes/workspace/testjusticia-pwa/datos/casos.js')
with io.open(salida, 'w', encoding='utf-8') as f:
    f.write('// Supuestos de hecho de los casos practicos (texto oficial del tribunal).\n')
    f.write('// Generado por tools/extraer_casos.py — no editar a mano.\n')
    f.write('window.CASOS = ' + json.dumps(res, ensure_ascii=False, indent=1) + ';\n')
print('\nEscrito:', salida)
