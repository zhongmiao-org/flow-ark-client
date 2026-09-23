import AppKit
import ApplicationServices
import Foundation

// This executable observes window metadata only. It has no input or write commands.
struct WindowInfo: Encodable {
    let title: String
    let minimized: Bool
}
struct Discovery: Encodable {
    let version = 1
    var accessibility: String
    var availability: String
    var windows: [WindowInfo] = []
    var truncated = false
}

func attribute(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return (error, value)
}

func discover() -> Discovery {
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
            result.windows.append(WindowInfo(title: displayTitle, minimized: minimized))
        }
    }
    return result
}

do {
    let data = try JSONEncoder().encode(discover())
    FileHandle.standardOutput.write(data)
} catch {
    exit(1)
}
