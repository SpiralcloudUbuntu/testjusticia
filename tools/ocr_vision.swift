import Foundation
import Vision
import AppKit

// OCR de una imagen usando el framework Vision de macOS.
// Uso: ocr_vision <imagen.png>

let args = CommandLine.arguments
guard args.count > 1 else { print("uso: ocr_vision <imagen>"); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("ERROR: no se puede abrir la imagen\n".data(using: .utf8)!)
    exit(1)
}

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["es-ES", "en-US"]
req.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([req]) } catch {
    FileHandle.standardError.write("ERROR: \(error)\n".data(using: .utf8)!)
    exit(1)
}

guard let obs = req.results else { exit(0) }

// Orden de lectura: de arriba abajo y, en la misma linea, de izquierda a derecha
let items = obs.compactMap { o -> (CGFloat, CGFloat, String)? in
    guard let c = o.topCandidates(1).first else { return nil }
    let bb = o.boundingBox
    return (bb.origin.y, bb.origin.x, c.string)
}.sorted { a, b in
    if abs(a.0 - b.0) > 0.006 { return a.0 > b.0 }
    return a.1 < b.1
}

for it in items { print(it.2) }
