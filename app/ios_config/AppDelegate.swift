import UIKit
import Flutter
import PDFKit

@main
@objc class AppDelegate: FlutterAppDelegate {

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {

    GeneratedPluginRegistrant.register(with: self)

    guard
      let controller = window?.rootViewController as? FlutterViewController
    else {
      return super.application(application,
                               didFinishLaunchingWithOptions: launchOptions)
    }

    let channel = FlutterMethodChannel(
      name: "com.papershelf/pdf",
      binaryMessenger: controller.binaryMessenger
    )

    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else { return }
      switch call.method {
      case "extractText":
        self.handleExtractText(call: call, result: result)
      case "getPageCount":
        self.handleGetPageCount(call: call, result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    return super.application(application,
                             didFinishLaunchingWithOptions: launchOptions)
  }

  // ── extractText ────────────────────────────────────────────────────────────

  private func handleExtractText(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard
      let args = call.arguments as? [String: Any],
      let flutterBytes = args["bytes"] as? FlutterStandardTypedData
    else {
      result(FlutterError(code: "INVALID_ARGS",
                          message: "bytes argument is required",
                          details: nil))
      return
    }

    // Dispatch heavy work off the main thread.
    DispatchQueue.global(qos: .userInitiated).async {
      let data = flutterBytes.data
      guard let pdf = PDFDocument(data: data) else {
        DispatchQueue.main.async {
          result(FlutterError(code: "PARSE_FAILED",
                              message: "PDFDocument could not be initialised",
                              details: nil))
        }
        return
      }

      let blocks = self.extractBlocks(from: pdf)

      DispatchQueue.main.async {
        result(blocks)
      }
    }
  }

  private func handleGetPageCount(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard
      let args = call.arguments as? [String: Any],
      let flutterBytes = args["bytes"] as? FlutterStandardTypedData,
      let pdf = PDFDocument(data: flutterBytes.data)
    else {
      result(0)
      return
    }
    result(pdf.pageCount)
  }

  // ── Block extraction ───────────────────────────────────────────────────────

  private func extractBlocks(from pdf: PDFDocument) -> [[String: String]] {
    var rawLines: [(text: String, fontSize: CGFloat, isBold: Bool)] = []

    for pageIndex in 0 ..< pdf.pageCount {
      guard let page = pdf.page(at: pageIndex) else { continue }

      // PDFPage.attributedString gives us attributed text with font information.
      guard let attrStr = page.attributedString else {
        // Fallback: plain string, treated as paragraphs.
        if let plain = page.string, !plain.isEmpty {
          for para in plain.components(separatedBy: "\n") {
            let t = para.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty {
              rawLines.append((text: t, fontSize: 10, isBold: false))
            }
          }
        }
        continue
      }

      // Walk the attributed string line by line.
      let fullRange = NSRange(location: 0, length: attrStr.length)
      var lineStart = 0

      attrStr.string.enumerateSubstrings(in: attrStr.string.startIndex ..< attrStr.string.endIndex,
                                         options: .byLines) { substring, _, _, _ in
        guard let substring else { return }
        let trimmed = substring.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Determine dominant font attributes for this line segment.
        let nsRange = NSRange(trimmed.startIndex ..< trimmed.endIndex, in: trimmed)
        // Map trimmed position back to attrStr range (approximate: use lineStart).
        let searchRange = NSRange(location: lineStart,
                                  length: min(trimmed.utf16.count, attrStr.length - lineStart))
        lineStart += substring.utf16.count + 1 // +1 for the newline

        var maxFontSize: CGFloat = 10
        var boldCount = 0
        var totalCount = 0

        if searchRange.location + searchRange.length <= attrStr.length {
          attrStr.enumerateAttribute(.font,
                                     in: searchRange,
                                     options: []) { value, _, _ in
            totalCount += 1
            guard let font = value as? UIFont else { return }
            maxFontSize = max(maxFontSize, font.pointSize)
            if font.fontDescriptor.symbolicTraits.contains(.traitBold) {
              boldCount += 1
            }
          }
        }

        let isBold = totalCount > 0 && (boldCount * 2 >= totalCount)
        rawLines.append((text: trimmed, fontSize: maxFontSize, isBold: isBold))
      }
    }

    // ── Classify & merge into blocks ────────────────────────────────────────

    var blocks: [[String: String]] = []
    var pendingP = ""

    let flushP = {
      let t = pendingP.trimmingCharacters(in: .whitespacesAndNewlines)
      if !t.isEmpty {
        blocks.append(["type": "p", "text": t])
      }
      pendingP = ""
    }

    for line in rawLines {
      let type = classify(text: line.text, fontSize: line.fontSize, isBold: line.isBold)

      switch type {
      case "h2", "h3", "fig":
        flushP()
        blocks.append(["type": type, "text": line.text])
      default: // "p"
        // Merge adjacent paragraph lines into one block (same logical paragraph).
        if pendingP.isEmpty {
          pendingP = line.text
        } else {
          // Heuristic: if the previous line ended with a hyphen, join without space.
          if pendingP.hasSuffix("-") {
            pendingP = String(pendingP.dropLast()) + line.text
          } else {
            pendingP += " " + line.text
          }

          // Flush when accumulated text is long enough to be a paragraph.
          if pendingP.count > 400 {
            flushP()
          }
        }
      }
    }
    flushP()

    return blocks
  }

  // ── Classification ─────────────────────────────────────────────────────────

  private func classify(text: String, fontSize: CGFloat, isBold: Bool) -> String {
    // Skip very short noise lines (page numbers, isolated symbols).
    let wordCount = text.split(separator: " ").count
    if wordCount < 2 && text.count < 6 { return "fig" }

    // Figure / table captions.
    let lower = text.lowercased()
    if lower.hasPrefix("fig") || lower.hasPrefix("table") ||
       lower.hasPrefix("그림") || lower.hasPrefix("표 ") {
      return "fig"
    }

    let isAllCaps = text == text.uppercased() && text.rangeOfCharacter(from: .letters) != nil

    // H2: large font or all-caps bold heading.
    if (fontSize >= 13.5 || isAllCaps) && isBold && text.count < 140 {
      return "h2"
    }

    // H3: bold but smaller.
    if fontSize >= 11.5 && isBold && text.count < 220 {
      return "h3"
    }

    return "p"
  }
}
