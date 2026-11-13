#!/usr/bin/env python3
"""Diagnostico de un PDF: por que no se le puede sacar texto.

Uso:
    python3 tools/diagnostico_pdf.py /ruta/al/fichero.pdf
"""
import sys, os

def main(ruta):
    try:
        import fitz
    except ImportError:
        print('Falta pymupdf:  python3 -m pip install pymupdf')
        return 1

    if not os.path.exists(ruta):
        print('No existe:', ruta)
        return 1

    tam = os.path.getsize(ruta)
    d = fitz.open(ruta)

    print('=' * 66)
    print('FICHERO :', os.path.basename(ruta))
    print('TAMANO  :', '%.1f MB' % (tam / 1048576))
    print('PAGINAS :', d.page_count)
    print('CIFRADO :', d.is_encrypted)
    print('PDF ver :', getattr(d, 'pdf_version', '?'))
    print('=' * 66)

    total_chars = 0
    total_imgs = 0
    total_dibujos = 0
    fuentes = {}

    for i in range(d.page_count):
        p = d[i]
        t = p.get_text('text')
        total_chars += len(t.strip())
        imgs = p.get_images(full=True)
        total_imgs += len(imgs)
        dibujos = len(p.get_drawings())
        total_dibujos += dibujos

        try:
            for f in p.get_fonts(full=True):
                fuentes[f[3]] = fuentes.get(f[3], 0) + 1
        except Exception:
            pass

        print('pag %2d | texto %5d ch | imagenes %2d | dibujos %4d | %s'
              % (i + 1, len(t.strip()), len(imgs), dibujos,
                 (t.strip()[:48].replace('\n', ' ') if t.strip() else '(sin texto)')))

    print('-' * 66)
    print('TOTAL texto   :', total_chars, 'caracteres')
    print('TOTAL imagenes:', total_imgs)
    print('TOTAL dibujos :', total_dibujos)
    print('FUENTES       :', ', '.join(sorted(fuentes)) if fuentes else 'ninguna')

    # Extras que explican un texto invisible
    try:
        xref_cat = d.pdf_catalog()
        cat = d.xref_object(xref_cat)
        print('CATALOGO      :', cat[:300].replace('\n', ' '))
    except Exception as e:
        print('CATALOGO      : no legible', e)

    print('-' * 66)
    if total_chars == 0 and total_imgs >= d.page_count:
        print('DIAGNOSTICO: PDF escaneado. Cada pagina es una imagen sin capa de texto.')
        print('             Necesita OCR, o pegar el texto a mano en la app.')
    elif total_chars == 0 and total_imgs == 0:
        print('DIAGNOSTICO: sin texto y sin imagenes. Contenido vectorial o formulario.')
        print('             Puede ser XFA/AcroForm: el texto vive en campos, no en la pagina.')
    elif total_chars == 0:
        print('DIAGNOSTICO: sin texto extraible pese a no ser imagenes puras.')
        print('             Revisar fuentes CID sin ToUnicode o contenido en XObject.')
    else:
        print('DIAGNOSTICO: el PDF SI tiene texto (%d caracteres).' % total_chars)
        print('             Si pdf.js ve 0 fragmentos, es un fallo de lectura, no del PDF.')
    print('=' * 66)
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Uso: python3 tools/diagnostico_pdf.py fichero.pdf')
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
