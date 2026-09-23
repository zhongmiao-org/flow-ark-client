import AppKit
import ApplicationServices
import Foundation

// Window references stay in this process. Only list and explicit selection reads are accepted.
struct WindowInfo: Encodable {
    let id: String
    let title: String
    let minimized: Bool
}
struct Discovery: Encodable {
    let version = 2
    var accessibility: String
    var availability: String
    var windows: [WindowInfo] = []
    var truncated = false
}
struct WindowEntry {
    let app: NSRunningApplication
    let launched: Date
    let window: AXUIElement
    let title: String
}
var entries: [String: WindowEntry] = [:]

func attribute(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return (error, value)
}

func discover() -> Discovery {
    entries.removeAll()
    guard AXIsProcessTrusted() else {
        return Discovery(accessibility: "not-granted", availability: "permission-required")
    }
    var result = Discovery(accessibility: "granted", availability: "available")
    let applications = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.TextEdit")
    let deadline = ProcessInfo.processInfo.systemUptime + 5
    for application in applications {
        if result.windows.count >= 30 || ProcessInfo.processInfo.systemUptime >= deadline {
            result.truncated = true
            break
        }
        let element = AXUIElementCreateApplication(application.processIdentifier)
        AXUIElementSetMessagingTimeout(element, 0.3)
        var count = 0
        let countError = AXUIElementGetAttributeValueCount(element, kAXWindowsAttribute as CFString, &count)
        if countError == .noValue { continue }
        guard countError == .success else {
            return Discovery(accessibility: "granted", availability: "unavailable")
        }
        if count == 0 { continue }
        let limit = min(count, 30 - result.windows.count)
        var values: CFArray?
        let error = AXUIElementCopyAttributeValues(element, kAXWindowsAttribute as CFString, 0, limit, &values)
        guard error == .success, let windows = values as? [AXUIElement] else {
            return Discovery(accessibility: "granted", availability: "unavailable")
        }
        if count > limit { result.truncated = true }
        for window in windows {
            if ProcessInfo.processInfo.systemUptime >= deadline {
                result.truncated = true
                break
            }
            AXUIElementSetMessagingTimeout(window, 0.3)
            let (titleError, titleValue) = attribute(window, kAXTitleAttribute)
            let (minimizedError, minimizedValue) = attribute(window, kAXMinimizedAttribute)
            guard titleError == .success, let title = titleValue as? String,
                  minimizedError == .success, let minimized = minimizedValue as? Bool else {
                result.truncated = true
                continue
            }
            if title.utf16.count > 1024 { result.truncated = true }
            let displayTitle = String(decoding: title.utf16.prefix(1024), as: UTF16.self)
            guard let launched = application.launchDate else { result.truncated = true; continue }
            let id = UUID().uuidString.lowercased()
            entries[id] = WindowEntry(app: application, launched: launched, window: window, title: title)
            result.windows.append(WindowInfo(id: id, title: displayTitle, minimized: minimized))
        }
    }
    return result
}

enum SelectionError: String, Error {
    case expired, unsupported, ambiguous, unavailable
    case permission = "permission-required"
    case windowChanged = "window-changed"
    case noSelection = "no-selection"
    case selectionChanged = "selection-changed"
    case tooLarge = "too-large"
}
struct TextRange: Encodable, Equatable { let location: Int; let length: Int }
struct Selection: Encodable {
    let status: String
    var text: String? = nil
    var range: TextRange? = nil
}
func checkDeadline(_ deadline: TimeInterval) throws {
    if ProcessInfo.processInfo.systemUptime >= deadline { throw SelectionError.unavailable }
}
func checkedWindow(_ entry: WindowEntry) throws {
    guard AXIsProcessTrusted() else { throw SelectionError.permission }
    guard !entry.app.isTerminated,
          let current = NSRunningApplication(processIdentifier: entry.app.processIdentifier),
          current.bundleIdentifier == "com.apple.TextEdit", current.launchDate == entry.launched else {
        throw SelectionError.windowChanged
    }
    let application = AXUIElementCreateApplication(current.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 0.2)
    var count = 0
    guard AXUIElementGetAttributeValueCount(application, kAXWindowsAttribute as CFString, &count) == .success,
          count > 0, count <= 100 else { throw SelectionError.windowChanged }
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(application, kAXWindowsAttribute as CFString, 0, count, &values) == .success,
          let windows = values as? [AXUIElement], windows.contains(where: { CFEqual($0, entry.window) }) else {
        throw SelectionError.windowChanged
    }
    let (error, value) = attribute(entry.window, kAXTitleAttribute)
    guard error == .success, let title = value as? String, title == entry.title else {
        throw SelectionError.windowChanged
    }
}
func textArea(in window: AXUIElement, deadline: TimeInterval) throws -> AXUIElement {
    var pending: [(AXUIElement, Int)] = [(window, 0)]
    var visited: [AXUIElement] = []
    var areas: [AXUIElement] = []
    while let (element, depth) = pending.popLast() {
        try checkDeadline(deadline)
        if visited.contains(where: { CFEqual($0, element) }) { continue }
        guard visited.count < 200, depth <= 8 else { throw SelectionError.ambiguous }
        visited.append(element)
        AXUIElementSetMessagingTimeout(element, 0.2)
        let (roleError, roleValue) = attribute(element, kAXRoleAttribute)
        guard roleError == .success, let role = roleValue as? String else { throw SelectionError.unsupported }
        if role == kAXSheetRole { throw SelectionError.ambiguous }
        if role == kAXTextAreaRole {
            areas.append(element)
            if areas.count > 1 { throw SelectionError.ambiguous }
            continue
        }
        var count = 0
        let countError = AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count)
        if countError == .attributeUnsupported || countError == .noValue { continue }
        guard countError == .success else { throw SelectionError.unavailable }
        if count == 0 { continue }
        guard count <= 200 - visited.count - pending.count else { throw SelectionError.ambiguous }
        var values: CFArray?
        guard AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, count, &values) == .success,
              let children = values as? [AXUIElement] else { throw SelectionError.unavailable }
        pending.append(contentsOf: children.map { ($0, depth + 1) })
    }
    guard let area = areas.first else { throw SelectionError.unsupported }
    return area
}
func selectedRange(_ area: AXUIElement) throws -> TextRange {
    var count = 0
    let countError = AXUIElementGetAttributeValueCount(area, kAXSelectedTextRangesAttribute as CFString, &count)
    if countError == .success && count == 0 { throw SelectionError.noSelection }
    if countError == .success && count != 1 { throw SelectionError.ambiguous }
    guard countError == .success || countError == .attributeUnsupported || countError == .noValue else { throw SelectionError.unsupported }
    let (error, value) = attribute(area, kAXSelectedTextRangeAttribute)
    guard error == .success, let value = value, CFGetTypeID(value) == AXValueGetTypeID() else {
        throw SelectionError.unsupported
    }
    let ax = value as! AXValue
    guard AXValueGetType(ax) == .cfRange else { throw SelectionError.unsupported }
    var range = CFRange(location: 0, length: 0)
    guard AXValueGetValue(ax, .cfRange, &range), range.location >= 0, range.location <= Int32.max,
          range.length >= 0 else { throw SelectionError.unsupported }
    if range.length == 0 { throw SelectionError.noSelection }
    if range.length > 20000 { throw SelectionError.tooLarge }
    return TextRange(location: range.location, length: range.length)
}
func selectedText(_ area: AXUIElement) throws -> (TextRange, String) {
    let range = try selectedRange(area)
    let (error, value) = attribute(area, kAXSelectedTextAttribute)
    guard error == .success, let text = value as? String else { throw SelectionError.unsupported }
    guard text.utf16.count == range.length, try selectedRange(area) == range else {
        throw SelectionError.selectionChanged
    }
    return (range, text)
}
func preview(_ id: String) -> Selection {
    guard let entry = entries[id] else { return Selection(status: SelectionError.expired.rawValue) }
    let deadline = ProcessInfo.processInfo.systemUptime + 5
    do {
        try checkedWindow(entry)
        let area = try textArea(in: entry.window, deadline: deadline)
        let first = try selectedText(area)
        try checkDeadline(deadline)
        let second = try selectedText(area)
        try checkedWindow(entry)
        try checkDeadline(deadline)
        guard first.0 == second.0, first.1 == second.1 else { throw SelectionError.selectionChanged }
        return Selection(status: "ready", text: first.1, range: first.0)
    } catch let error as SelectionError {
        return Selection(status: error.rawValue)
    } catch {
        return Selection(status: SelectionError.unavailable.rawValue)
    }
}
struct Arguments: Decodable { let windowId: String? }
struct Request: Decodable { let rpc: String; let method: String; let args: Arguments }
struct Reply<T: Encodable>: Encodable { let rpc: String; let reply = true; let result: T }
func send<T: Encodable>(_ request: Request, _ result: T) throws {
    var data = try JSONEncoder().encode(Reply(rpc: request.rpc, result: result))
    data.append(0x0A)
    FileHandle.standardOutput.write(data)
}
while let line = readLine() {
    guard line.utf8.count <= 4096, let data = line.data(using: .utf8) else { exit(1) }
    do {
        let request = try JSONDecoder().decode(Request.self, from: data)
        guard UUID(uuidString: request.rpc) != nil else { exit(1) }
        switch request.method {
        case "list": try send(request, discover())
        case "preview":
            guard let id = request.args.windowId, UUID(uuidString: id) != nil else { exit(1) }
            try send(request, preview(id))
        default: exit(1)
        }
    } catch { exit(1) }
}
