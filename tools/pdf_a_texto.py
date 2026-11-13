#!/usr/bin/env python3
"""Convierte un PDF a texto plano, con o sin capa de texto.

1. Si el PDF tiene texto, lo extrae tal cual.
2. Si no tiene (escaneado o texto vectorizado), hace OCR con el framework
   Vision de macOS. Todo local, sin red y sin coste.

Uso:
    python3 tools/pdf_a_texto.py examen.pdf
    python3 tools/pdf_a_texto.py examen.pdf -o salida.txt
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile


def binario_ocr():
    """Compila ocr_vision.swift la primera vez y lo reutiliza."""
    base = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(base, 'ocr_vision.swift')
    exe = os.path.join(base, '.ocr_vision')

    if not os.path.exists(src):
        raise SystemExit('Falta tools/ocr_vision.swift')
    if os.path.exists(exe) and os.path.getmtime(exe) >= os.path.getmtime(src):
        return exe

    print('Compilando el OCR de Vision (solo la primera vez)…', file=sys.stderr)
    subprocess.run(['swiftc', '-O', src, '-o', exe], check=True)
    return exe


def ocr_paginas(doc, exe, dpi=220):
    tmp = tempfile.mkdtemp(prefix='pdf_ocr_')
    partes = []
    try:
        for i in range(doc.page_count):
            png = os.path.join(tmp, 'p%03d.png' % i)
            doc[i].get_pixmap(dpi=dpi).save(png)
            r = subprocess.run([exe, png], capture_output=True, text=True)
            if r.returncode != 0:
                print('  aviso: pagina %d fallo (%s)' % (i + 1, r.stderr.strip()), file=sys.stderr)
            partes.append(r.stdout)
            print('  OCR pagina %d/%d' % (i + 1, doc.page_count), file=sys.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return '\n\n'.join(partes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('-o', '--salida')
    ap.add_argument('--forzar-ocr', action='store_true')
    args = ap.parse_args()

    try:
        import fitz
    except ImportError:
        raise SystemExit('Falta pymupdf:  python3 -m pip install pymupdf')

    if not os.path.exists(args.pdf):
        raise SystemExit('No existe: ' + args.pdf)

    doc = fitz.open(args.pdf)
    nativo = '\n'.join(p.get_text('text') for p in doc).strip()

    print('PDF: %s' % os.path.basename(args.pdf), file=sys.stderr)
    print('Paginas: %d' % doc.page_count, file=sys.stderr)
    print('Texto nativo: %d caracteres' % len(nativo), file=sys.stderr)

    if nativo and not args.forzar_ocr:
        texto = nativo
        modo = 'texto nativo'
    else:
        if not nativo:
            print('Sin capa de texto: se usa OCR de Vision.', file=sys.stderr)
        texto = ocr_paginas(doc, binario_ocr())
        modo = 'OCR Vision'

    salida = args.salida
    if not salida:
        base = os.path.splitext(args.pdf)[0]
        salida = base + '.txt'
    with open(salida, 'w', encoding='utf-8') as f:
        f.write(texto)

    print('\n%s -> %s' % (modo, salida), file=sys.stderr)
    print('Caracteres: %d' % len(texto), file=sys.stderr)
    print(salida)


if __name__ == '__main__':
    main()
