import AppKit
import ApplicationServices
import ScreenCaptureKit
import CryptoKit
import Foundation
import Darwin

// Private window and AX references never cross the process boundary.
struct DesktopFault: Error { let message: String }
struct DesktopWindow {
    let app: NSRunningApplication
    let born: Date
    let window: AXUIElement
    let title: String
}
struct DesktopObservation {
    let id: String
    let title: String
    let stamp: String
    let at: Date
    let frame: CGRect
    let elements: [String: AXUIElement]
    let pointer: CGPoint
    let targetStamps: [String:String]
    let focus: AXUIElement?
    let focusStamp: String?
    let image: CGImage?
    let windowNumber: CGWindowID?
}
func fault(_ message: String) throws -> Never { throw DesktopFault(message: message) }
func ax(_ e: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, key as CFString, &value) == .success else { return nil }
    return value
}
func str(_ e: AXUIElement, _ key: String) -> String {
    let raw = ax(e,key)
    var primary = raw as? String ?? ""
    // AX checkbox values may be CFBoolean or CFNumber rather than CFString.
    // Preserve mixed (2) as distinct; callers must never treat it as unchecked.
    if primary.isEmpty, key == kAXValueAttribute,
       ax(e,kAXRoleAttribute) as? String == kAXCheckBoxRole,
       let raw, CFGetTypeID(raw) == CFBooleanGetTypeID() || CFGetTypeID(raw) == CFNumberGetTypeID(),
       let number = raw as? NSNumber {
        let value = number.doubleValue
        if value == 0 || value == 1 || value == 2 { primary = String(Int(value)) }
    }
    // Chromium inputs expose their accessible search hint as a placeholder.
    // Never replace a nonempty native description or expose protected input.
    let value = primary.isEmpty && key == kAXDescriptionAttribute
        ? (ax(e,"AXPlaceholderValue") as? String ?? "") : primary
    return String(value.prefix(4000))
}
func frame(_ e: AXUIElement) -> CGRect? {
    guard let pv=ax(e,kAXPositionAttribute), CFGetTypeID(pv)==AXValueGetTypeID(),
          let sv=ax(e,kAXSizeAttribute), CFGetTypeID(sv)==AXValueGetTypeID() else { return nil }
    var p=CGPoint.zero, s=CGSize.zero
    guard AXValueGetValue(pv as! AXValue,.cgPoint,&p), AXValueGetValue(sv as! AXValue,.cgSize,&s), s.width>0,s.height>0 else { return nil }
    return CGRect(origin:p,size:s)
}
func rectJSON(_ f: CGRect) -> [String:Double] { ["x":f.minX,"y":f.minY,"width":f.width,"height":f.height] }
func same(_ a: AXUIElement,_ b: AXUIElement) -> Bool { CFEqual(a,b) }
// AX may append the owning app's display name while ScreenCaptureKit omits it.
// Remove only that exact decoration; owner, geometry and uniqueness still match.
func captureTitle(_ title:String,_ appName:String) -> String {
    let suffix=" - " + appName
    let base = !appName.isEmpty && title.hasSuffix(suffix) ? String(title.dropLast(suffix.count)) : title
    // Read-only AX/SC metadata proved Chrome adds this decoration only to AX.
    // Keep the exact PID/frame and both uniqueness guards below unchanged.
    return appName=="Google Chrome" ? base.replacingOccurrences(of:" - 内存用量高 - [0-9]+(?:\\.[0-9]+)? MB$",with:"",options:.regularExpression) : base
}
// Only the independently observed Chrome memory decoration is non-contextual.
// Other apps and the complete document title remain exact; PID/window/frame checks stay separate.
func sameContextTitle(_ current:String,_ previous:String,_ app:NSRunningApplication) -> Bool {
    let name=app.localizedName ?? ""
    return name=="Google Chrome" ? captureTitle(current,name)==captureTitle(previous,name) : current==previous
}
func jsonStamp(_ value:Any) throws -> String {
    let bytes=try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys])
    return SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()
}

@main struct DesktopAutomation {
    static var windows: [String:DesktopWindow]=[:]
    static var selected: DesktopWindow?
    static var binding: String?
    static var capturedWindowNumber: CGWindowID?
    static var observation: DesktopObservation?
    static var consumed=Set<String>()
    static var expires=Date.distantPast
    static func check() throws -> DesktopWindow {
        guard AXIsProcessTrusted() else { try fault("permission-required") }
        guard let w=selected, binding != nil, Date()<expires, !w.app.isTerminated,
              w.app.launchDate==w.born else { try fault("binding-expired") }
        let root=AXUIElementCreateApplication(w.app.processIdentifier)
        guard let ws=ax(root,kAXWindowsAttribute) as? [AXUIElement], ws.contains(where:{same($0,w.window)}),
              frame(w.window) != nil else { try fault("window-changed") }
        return w
    }
    static func focused(_ w:DesktopWindow,timeout:Float?=nil) throws {
        let root=AXUIElementCreateApplication(w.app.processIdentifier)
        if let timeout {guard AXUIElementSetMessagingTimeout(root,timeout) == .success else {try fault("focus-read-timeout-unavailable")}}
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier==w.app.processIdentifier,
              let f=ax(root,kAXFocusedWindowAttribute),
              CFGetTypeID(f)==AXUIElementGetTypeID(), same(f as! AXUIElement,w.window) else { try fault("focus-changed") }
    }
    static func activateBoundWindow(_ w:DesktopWindow) async throws {
        guard w.app.activate(options:[]) else {try fault("activation-phase:app-request-unconfirmed")}
        for (attribute,phase) in [(kAXMainAttribute,"main"),(kAXFocusedAttribute,"focused")] {
            var settable:DarwinBoolean=false
            let result=AXUIElementIsAttributeSettable(w.window,attribute as CFString,&settable)
            if result == .attributeUnsupported {continue}
            guard result == .success else {try fault("activation-phase:"+phase+"-attribute-query-unconfirmed")}
            if settable.boolValue {
                guard AXUIElementSetAttributeValue(w.window,attribute as CFString,kCFBooleanTrue) == .success else {try fault("activation-phase:"+phase+"-attribute-request-unconfirmed")}
            }
        }
        guard AXUIElementPerformAction(w.window,kAXRaiseAction as CFString) == .success else {try fault("activation-phase:raise-request-unconfirmed")}
        // App activation and AXRaise do not establish which app window owns input.
        // Only observe the postcondition; never activate again or send fallback input.
        let deadline=ProcessInfo.processInfo.systemUptime+1.5
        var phase="activation-phase:focused-window-unconfirmed"
        while ProcessInfo.processInfo.systemUptime<deadline {
            let remaining=deadline-ProcessInfo.processInfo.systemUptime
            if remaining<=0 {break}
            if NSWorkspace.shared.frontmostApplication?.processIdentifier != w.app.processIdentifier {
                phase="activation-phase:foreground-pid-unconfirmed"
            } else {
                var confirmed=false
                do {
                    try focused(w,timeout:Float(min(0.1,remaining)))
                    confirmed=ProcessInfo.processInfo.systemUptime<deadline
                } catch {phase="activation-phase:focused-window-unconfirmed"}
                if confirmed {
                    let current:DesktopWindow
                    do {current=try check()} catch {try fault("activation-phase:binding-unconfirmed")}
                    guard current.app.processIdentifier==w.app.processIdentifier,current.born==w.born,same(current.window,w.window) else {try fault("activation-phase:binding-unconfirmed")}
                    if ProcessInfo.processInfo.systemUptime<deadline {return}
                    phase="activation-phase:confirmation-timeout"
                }
            }
            let delay=min(0.02,deadline-ProcessInfo.processInfo.systemUptime)
            if delay>0 {
                do {try await Task.sleep(nanoseconds:UInt64(delay*1_000_000_000))}
                catch {try fault("activation-phase:confirmation-interrupted")}
            }
        }
        try fault(phase)
    }
    static func tree(_ w:DesktopWindow) throws -> (CGRect,[[String:Any]],[String:AXUIElement],String,Bool) {
        guard let bounds=frame(w.window) else { try fault("window-changed") }
        var rows=[[String:Any]](), refs=[String:AXUIElement](), queue:[(AXUIElement,Int)]=[(w.window,0)], cursor=0
        var truncated=false
        let deadline=Date().addingTimeInterval(3)
        while cursor<queue.count && rows.count<2000 && Date()<deadline {
            let (e,depth)=queue[cursor];cursor+=1
            let role=str(e,kAXRoleAttribute), sub=str(e,kAXSubroleAttribute)
            let secure=sub==kAXSecureTextFieldSubrole || role=="AXSecureTextField"
            let id=String(rows.count), box=frame(e)
            var row:[String:Any]=["id":id,"role":role,"subrole":sub,"title":secure ? "[protected]":str(e,kAXTitleAttribute),"description":secure ? "":str(e,kAXDescriptionAttribute),"value":secure ? "[protected]":str(e,kAXValueAttribute),"depth":depth]
            if let b=box { row["bounds"]=rectJSON(CGRect(x:b.minX-bounds.minX,y:b.minY-bounds.minY,width:b.width,height:b.height)) }
            if !secure { refs[id]=e }
            rows.append(row)
            if !secure && depth<60, let children=ax(e,kAXChildrenAttribute) as? [AXUIElement] {
                if children.count>3000-queue.count {truncated=true}
                for child in children.prefix(3000-queue.count) { queue.append((child,depth+1)) }
            } else if !secure && depth>=60, let children=ax(e,kAXChildrenAttribute) as? [AXUIElement], !children.isEmpty {
                truncated=true
            }
        }
        // Unrelated live text is not the identity of every control in the window.
        // The selected target/focus is separately checked using its full attributes.
        let structure=rows.map { row in row.filter { !["title","description","value"].contains($0.key) } }
        let stamp=try jsonStamp(["bounds":rectJSON(bounds),"rows":structure])
        return (bounds,rows,refs,stamp,truncated || cursor<queue.count)
    }
    static func captureFocus(_ w:DesktopWindow) throws -> (AXUIElement,String,String,String,CGRect?)? {
        let root=AXUIElementCreateApplication(w.app.processIdentifier)
        guard let fw=ax(root,kAXFocusedWindowAttribute),CFGetTypeID(fw)==AXUIElementGetTypeID(),same(fw as! AXUIElement,w.window),
              let focused=ax(root,kAXFocusedUIElementAttribute),CFGetTypeID(focused)==AXUIElementGetTypeID() else {return nil}
        let e=focused as! AXUIElement
        guard str(e,kAXSubroleAttribute) != kAXSecureTextFieldSubrole else {return nil}
        let role=str(e,kAXRoleAttribute), subrole=str(e,kAXSubroleAttribute), box=frame(e)
        var attributes:[String:Any]=["role":role,"subrole":subrole,"title":str(e,kAXTitleAttribute),"description":str(e,kAXDescriptionAttribute),"value":str(e,kAXValueAttribute),"selection":str(e,kAXSelectedTextAttribute)]
        if let box {attributes["bounds"]=rectJSON(box)}
        if let raw=ax(e,kAXSelectedTextRangeAttribute),CFGetTypeID(raw)==AXValueGetTypeID() {
            var range=CFRange();if AXValueGetValue(raw as! AXValue,.cfRange,&range){attributes["range"]=[range.location,range.length]}
        }
        return (e,try jsonStamp(attributes),role,subrole,box)
    }
    static func checkFocus(_ w:DesktopWindow,_ old:DesktopObservation) throws {
        guard let e=old.focus,let stamp=old.focusStamp,let current=try captureFocus(w),same(e,current.0),stamp==current.1 else {try fault("focus-or-selection-changed")}
    }
    static func image(_ payload:[String:Any]) -> CGImage? {
        guard let encoded=payload["data"] as? String,let data=Data(base64Encoded:encoded) else{return nil}
        return NSBitmapImageRep(data:data)?.cgImage
    }
    static func patch(_ image:CGImage,_ p:CGPoint,_ bounds:CGRect) throws -> String {
        let sx=Double(image.width)/bounds.width,sy=Double(image.height)/bounds.height
        let rect=CGRect(x:(p.x-bounds.minX)*sx-10*sx,y:(p.y-bounds.minY)*sy-10*sy,width:20*sx,height:20*sy).integral.intersection(CGRect(x:0,y:0,width:image.width,height:image.height))
        guard !rect.isEmpty,let cropped=image.cropping(to:rect) else {try fault("image-target-unavailable")}
        let width=Int(rect.width),height=Int(rect.height)
        guard let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else {try fault("image-target-unavailable")}
        context.clear(CGRect(x:0,y:0,width:width,height:height));context.interpolationQuality = .none
        context.draw(cropped,in:CGRect(x:0,y:0,width:width,height:height))
        guard let bytes=context.data else {try fault("image-target-unavailable")}
        return SHA256.hash(data:Data(bytes:bytes,count:width*height*4)).map{String(format:"%02x",$0)}.joined()
    }
    static func discover() throws -> Any {
        windows.removeAll(); selected=nil;binding=nil;observation=nil;capturedWindowNumber=nil
        guard AXIsProcessTrusted() else { return ["version":1,"accessibility":"not-granted","screenRecording":CGPreflightScreenCaptureAccess(),"windows":[]] as [String:Any] }
        var result=[[String:Any]]();let deadline=Date().addingTimeInterval(5)
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular && app.processIdentifier != getpid() {
            if Date()>deadline || result.count>=80 { break }
            guard let born=app.launchDate else { continue }
            let root=AXUIElementCreateApplication(app.processIdentifier);AXUIElementSetMessagingTimeout(root,0.15)
            guard let items=ax(root,kAXWindowsAttribute) as? [AXUIElement] else { continue }
            for window in items.prefix(15) {
                guard frame(window) != nil else { continue }
                let title=str(window,kAXTitleAttribute), id=UUID().uuidString
                windows[id]=DesktopWindow(app:app,born:born,window:window,title:title)
                result.append(["id":id,"application":app.localizedName ?? "Application","bundleId":app.bundleIdentifier ?? "","title":title,"minimized":(ax(window,kAXMinimizedAttribute) as? Bool) ?? false])
            }
        }
        return ["version":1,"accessibility":"granted","screenRecording":CGPreflightScreenCaptureAccess(),"windows":result] as [String:Any]
    }
    static func screenshot(_ w:DesktopWindow,_ expected:CGRect) async throws -> [String:Any] {
        guard CGPreflightScreenCaptureAccess() else { try fault("screen-recording-required") }
        if #available(macOS 14.0,*) {
            let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
            let candidates=content.windows.filter { $0.owningApplication?.processID==w.app.processIdentifier && $0.frame==expected }
            let appName=w.app.localizedName ?? "", title=captureTitle(str(w.window,kAXTitleAttribute),appName)
            let root=AXUIElementCreateApplication(w.app.processIdentifier)
            let siblings=(ax(root,kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { frame($0)==expected }
            let titledSiblings=siblings.filter {captureTitle(str($0,kAXTitleAttribute),appName)==title}
            guard titledSiblings.count==1 && same(titledSiblings[0],w.window) else {try fault("capture-window-ambiguous")}
            var matches=candidates.filter { captureTitle($0.title ?? "",appName)==title }
            if matches.isEmpty {
                if siblings.count==1 && same(siblings[0],w.window) && candidates.count==1 { matches=candidates }
            }
            guard matches.count==1 else { try fault("capture-window-ambiguous") }
            let filter=SCContentFilter(desktopIndependentWindow:matches[0]), config=SCStreamConfiguration()
            let scale=min(2,1600/max(expected.width,expected.height));config.width=max(1,Int(expected.width*scale));config.height=max(1,Int(expected.height*scale));config.showsCursor=false
            let cg=try await SCScreenshotManager.captureImage(contentFilter:filter,configuration:config)
            guard try check().app.processIdentifier==w.app.processIdentifier, frame(w.window)==expected else { try fault("window-changed") }
            let rep=NSBitmapImageRep(cgImage:cg)
            guard let data=rep.representation(using:.png,properties:[:]), data.count<=6*1024*1024 else { try fault("image-limit") }
            capturedWindowNumber=matches[0].windowID
            return ["mimeType":"image/png","data":data.base64EncodedString(),"width":cg.width,"height":cg.height]
        }
        try fault("capture-requires-macos14")
    }
    static func observe(_ args:[String:Any]) async throws -> Any {
        let w=try check();let (bounds,rows,refs,stamp,truncated)=try tree(w)
        var result:[String:Any]=["version":1,"observationId":UUID().uuidString,"title":str(w.window,kAXTitleAttribute),"application":w.app.localizedName ?? "Application","bounds":rectJSON(bounds),"elements":rows,"truncated":truncated]
        if args["screenshot"] as? Bool == true { result["image"]=try await screenshot(w,bounds) }
        // A bounded read is a snapshot, not an atomic transaction over an entire live UI.
        let checked=try check();guard same(checked.window,w.window),frame(w.window)==bounds else {try fault("window-changed")}
        let id=result["observationId"] as! String
        var targets=[String:String]();for row in rows {if let id=row["id"] as? String {targets[id]=try jsonStamp(row)}}
        let focus=try captureFocus(w)
        // Expose only nontext metadata; the complete stamp above remains private.
        if NSWorkspace.shared.frontmostApplication?.processIdentifier==w.app.processIdentifier,let focus,focus.2 != "AXSecureTextField",focus.3 != kAXSecureTextFieldSubrole {
            var snapshot:[String:Any]=["role":focus.2,"subrole":focus.3]
            let matchingIds=refs.compactMap { same($0.value,focus.0) ? $0.key:nil }
            if matchingIds.count==1 {snapshot["elementId"]=matchingIds[0]}
            if let box=focus.4 {snapshot["bounds"]=rectJSON(CGRect(x:box.minX-bounds.minX,y:box.minY-bounds.minY,width:box.width,height:box.height))}
            result["focus"]=snapshot
        }
        observation=DesktopObservation(id:id,title:result["title"] as! String,stamp:stamp,at:Date(),frame:bounds,elements:refs,pointer:CGEvent(source:nil)?.location ?? .zero,targetStamps:targets,focus:focus?.0,focusStamp:focus?.1,image:(result["image"] as? [String:Any]).flatMap{image($0)},windowNumber:capturedWindowNumber)
        return result
    }
    enum InputGuardPhase:String {case initial;case afterScreenshot="after-screenshot";case beforeDispatch="before-dispatch";case copy}
    static func pointerGuardReason(_ phase:InputGuardPhase,_ pointer:CGPoint,_ reference:CGPoint) -> String {
        // Diagnostics only: guard comparisons retain full-precision coordinates.
        let dx=String(format:"%.3f",pointer.x-reference.x),dy=String(format:"%.3f",pointer.y-reference.y)
        return "user-intervention:pointer-changed;phase="+phase.rawValue+";dx="+dx+";dy="+dy
    }
    static func modifierGuardReason(_ phase:InputGuardPhase,_ flags:CGEventFlags) -> String {
        let names=[(CGEventFlags.maskCommand,"Command"),(.maskShift,"Shift"),(.maskAlternate,"Option"),(.maskControl,"Control")]
            .filter{flags.contains($0.0)}.map{$0.1}.joined(separator:",")
        return "user-intervention:modifier-held;phase="+phase.rawValue+";held="+names
    }
    static func clipboardSnapshot(_ board:NSPasteboard) throws -> ([[NSPasteboard.PasteboardType:Data]],Int) {
        let count=board.changeCount
        var snapshot=[[NSPasteboard.PasteboardType:Data]](),total=0
        for item in board.pasteboardItems ?? [] {
            var values=[NSPasteboard.PasteboardType:Data]()
            for type in item.types {
                guard let data=item.data(forType:type) else {try fault("clipboard-unavailable")}
                total+=data.count
                guard total<=16*1024*1024 else {try fault("clipboard-snapshot-limit")}
                values[type]=data
            }
            snapshot.append(values)
        }
        guard board.changeCount==count else {try fault("clipboard-changed")}
        return (snapshot,count)
    }
    static func readSelection(_ args:[String:Any]) throws -> Any {
        let w=try check();try focused(w)
        guard CGPreflightPostEventAccess() else {try fault("input-posting-not-authorized")}
        guard let old=observation,args["observationId"] as? String==old.id,Date().timeIntervalSince(old.at)<30 else { try fault("observation-expired") }
        guard sameContextTitle(str(w.window,kAXTitleAttribute),old.title,w.app) else {try fault("window-context-changed")}
        guard frame(w.window)==old.frame else { try fault("observation-changed") }
        try checkFocus(w,old)
        let root=AXUIElementCreateApplication(w.app.processIdentifier)
        guard let element=ax(root,kAXFocusedUIElementAttribute),CFGetTypeID(element)==AXUIElementGetTypeID(),str(element as! AXUIElement,kAXSubroleAttribute) != kAXSecureTextFieldSubrole else { try fault("secure-or-missing-input") }
        let board=NSPasteboard.general
        let (snapshot,before)=try clipboardSnapshot(board)
        let pointer=CGEvent(source:nil)?.location ?? .zero
        guard abs(pointer.x-old.pointer.x)<1,abs(pointer.y-old.pointer.y)<1 else {try fault(pointerGuardReason(.copy,pointer,old.pointer))}
        let heldModifiers=CGEventSource.flagsState(.combinedSessionState).intersection([.maskCommand,.maskShift,.maskAlternate,.maskControl])
        guard heldModifiers.isEmpty else {try fault(modifierGuardReason(.copy,heldModifiers))}
        observation=nil
        try key(8,.maskCommand,pid:w.app.processIdentifier)
        let deadline=Date().addingTimeInterval(1)
        while board.changeCount==before && Date()<deadline {Thread.sleep(forTimeInterval:0.02)}
        guard board.changeCount != before else {try fault("copy-not-confirmed")}
        let ownCount=board.changeCount
        defer {if board.changeCount==ownCount{board.clearContents();let items=snapshot.map{values -> NSPasteboardItem in let item=NSPasteboardItem();for(type,data)in values{item.setData(data,forType:type)};return item};board.writeObjects(items)}}
        try focused(w);_ = try check()
        guard let text=board.string(forType:.string),text.utf8.count<=256*1024,board.changeCount==ownCount else {try fault("selection-read-limit-or-changed")}
        return ["version":1,"text":text,"source":"bound-window-selection"]
    }
    static func point(_ raw:Any?,_ bounds:CGRect) throws -> CGPoint {
        guard let p=raw as? [String:Any],let x=p["x"] as? Double,let y=p["y"] as? Double,x.isFinite,y.isFinite,x>=0,y>=0,x<bounds.width,y<bounds.height else { try fault("point-outside-window") }
        return CGPoint(x:bounds.minX+x,y:bounds.minY+y)
    }
    // The WindowServer foreground route is required for real pointer/keyboard UI input.
    // PID posting alone was observed to leave the bound browser selection unchanged.
    static func postForeground(_ event:CGEvent,pid:pid_t) throws {
        let w=try check()
        guard w.app.processIdentifier==pid,CGPreflightPostEventAccess(),let beforeFrame=frame(w.window) else {try fault("input-window-changed")}
        let beforeTitle=str(w.window,kAXTitleAttribute)
        try focused(w)
        let current=try check()
        guard same(current.window,w.window),frame(w.window)==beforeFrame,sameContextTitle(str(w.window,kAXTitleAttribute),beforeTitle,w.app) else {try fault("input-window-changed")}
        event.post(tap:.cghidEventTap)
        // A later failure is uncertain: the event may already have been handled.
        let after=try check();try focused(w)
        guard same(after.window,w.window),frame(w.window)==beforeFrame,sameContextTitle(str(w.window,kAXTitleAttribute),beforeTitle,w.app) else {try fault("input-window-changed-after-post")}
    }
    static func mouse(_ type:CGEventType,_ p:CGPoint,_ count:Int=1,pid:pid_t) throws {
        guard let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:p,mouseButton:.left) else { try fault("input-unavailable") }
        guard let number=capturedWindowNumber else {try fault("input-window-unavailable")}
        event.setIntegerValueField(.mouseEventClickState,value:Int64(count))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer,value:Int64(number))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent,value:Int64(number))
        try postForeground(event,pid:pid)
    }
    static func keyPair(_ down:CGEvent,_ up:CGEvent,pid:pid_t) throws {
        // Release only to the still-bound foreground window, even if post-check failed.
        var released=false
        defer {if !released {try? postForeground(up,pid:pid)}}
        try postForeground(down,pid:pid)
        try postForeground(up,pid:pid)
        released=true
        // HID delivery is asynchronous. Wait briefly for release, never resend input.
        let deadline=ProcessInfo.processInfo.systemUptime+0.25
        let modifiers:CGEventFlags=[.maskCommand,.maskShift,.maskAlternate,.maskControl]
        var quietSince:TimeInterval?=nil
        while ProcessInfo.processInfo.systemUptime<deadline {
            let current=try check()
            guard current.app.processIdentifier==pid else {try fault("input-window-changed")}
            try focused(current)
            let now=ProcessInfo.processInfo.systemUptime
            guard now<deadline else {try fault("input-modifier-release-unconfirmed")}
            if CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty {
                if let since=quietSince,now-since>=0.04 {return}
                if quietSince==nil {quietSince=now}
            } else {quietSince=nil}
            Thread.sleep(forTimeInterval:0.005)
        }
        try fault("input-modifier-release-unconfirmed")
    }
    static func key(_ code:CGKeyCode,_ flags:CGEventFlags=[],pid:pid_t) throws {
        guard let down=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:false) else { try fault("input-unavailable") }
        down.flags=flags;up.flags=[];try keyPair(down,up,pid:pid)
    }
    static func act(_ args:[String:Any]) async throws -> Any {
        let w=try check()
        guard CGPreflightPostEventAccess() else {try fault("input-posting-not-authorized")}
        guard let actionId=args["actionId"] as? String,UUID(uuidString:actionId) != nil,!consumed.contains(actionId) else { try fault("action-already-consumed") }
        guard let old=observation,args["observationId"] as? String==old.id,Date().timeIntervalSince(old.at)<30 else { try fault("observation-expired") }
        guard sameContextTitle(str(w.window,kAXTitleAttribute),old.title,w.app) else {try fault("window-context-changed")}
        let pointer=CGEvent(source:nil)?.location ?? .zero
        guard abs(pointer.x-old.pointer.x)<1,abs(pointer.y-old.pointer.y)<1 else {try fault(pointerGuardReason(.initial,pointer,old.pointer))}
        let initialModifiers=CGEventSource.flagsState(.combinedSessionState).intersection([.maskCommand,.maskShift,.maskAlternate,.maskControl])
        guard initialModifiers.isEmpty else {try fault(modifierGuardReason(.initial,initialModifiers))}
        guard let command=args["command"] as? [String:Any],let kind=command["kind"] as? String else { try fault("invalid-command") }
        // Activation changes no document input and targets the bound native window.
        // Unrelated background AX structure may change before it becomes foreground.
        let current=try tree(w)
        let focusedKey = kind=="key" && command["elementId"] == nil
        guard current.0==old.frame,kind=="activate" || focusedKey || current.3==old.stamp else { try fault("observation-changed") }
        if kind != "activate" { try focused(w);try checkFocus(w,old) }
        var target:AXUIElement?
        if let id=command["elementId"] as? String {
            guard let e=old.elements[id],let now=current.2[id],same(e,now),let row=current.1.first(where:{$0["id"] as? String==id}),try jsonStamp(row)==old.targetStamps[id] else {try fault("target-changed")};target=e
        }
        let coordinateKeys = kind=="drag" ? ["from","to"] : command["point"] != nil ? ["point"] : []
        if !coordinateKeys.isEmpty {
            guard let before=old.image else {try fault("coordinate-observation-requires-image")}
            let points=try coordinateKeys.map{try point(command[$0],old.frame)}
            guard let after=image(try await screenshot(w,old.frame)),after.width==before.width,after.height==before.height else {try fault("image-target-unavailable")}
            guard old.windowNumber==capturedWindowNumber,old.windowNumber != nil else {try fault("input-window-changed")}
            for p in points {guard try patch(before,p,old.frame)==patch(after,p,old.frame) else {try fault("image-target-changed")}}
            try focused(w);try checkFocus(w,old)
            let pointer=CGEvent(source:nil)?.location ?? .zero
            guard abs(pointer.x-old.pointer.x)<1,abs(pointer.y-old.pointer.y)<1 else {try fault(pointerGuardReason(.afterScreenshot,pointer,old.pointer))}
        }
        if kind != "activate" {
            try focused(w)
            let dispatchPointer=CGEvent(source:nil)?.location ?? .zero
            guard abs(dispatchPointer.x-old.pointer.x)<1,abs(dispatchPointer.y-old.pointer.y)<1 else {try fault(pointerGuardReason(.beforeDispatch,dispatchPointer,old.pointer))}
            let dispatchModifiers=CGEventSource.flagsState(.combinedSessionState).intersection([.maskCommand,.maskShift,.maskAlternate,.maskControl])
            guard dispatchModifiers.isEmpty else {try fault(modifierGuardReason(.beforeDispatch,dispatchModifiers))}
        }
        // Consume before the first native event. Any subsequent failure is unknown, never retried.
        consumed.insert(actionId);observation=nil
        do {
            switch kind {
            case "activate":
                try await activateBoundWindow(w)
            case "click", "doubleClick":
                var p:CGPoint
                if let e=target,let box=frame(e) { p=CGPoint(x:box.midX,y:box.midY);guard old.frame.contains(p) else { try fault("element-outside-window") } }
                else { p=try point(command["point"],old.frame) }
                if kind=="click",let e=target {
                    var actions:CFArray?;AXUIElementCopyActionNames(e,&actions)
                    if (actions as? [String])?.contains(kAXPressAction)==true { guard AXUIElementPerformAction(e,kAXPressAction as CFString) == .success else { try fault("press-failed") };break }
                }
                for i in 1...(kind=="doubleClick" ? 2:1) { try focused(w);try mouse(.leftMouseDown,p,i,pid:w.app.processIdentifier);try mouse(.leftMouseUp,p,i,pid:w.app.processIdentifier) }
            case "input":
                guard let text=command["text"] as? String,text.utf16.count<=20000 else { try fault("text-limit") }
                let root=AXUIElementCreateApplication(w.app.processIdentifier)
                guard let element=ax(root,kAXFocusedUIElementAttribute),CFGetTypeID(element)==AXUIElementGetTypeID() else { try fault("input-focus-missing") }
                let e=element as! AXUIElement
                guard str(e,kAXSubroleAttribute) != kAXSecureTextFieldSubrole else { try fault("secure-input-denied") }
                for chunk in unicodeChunks(text) {
                    try focused(w)
                    guard let event=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:false) else { try fault("input-unavailable") }
                    event.keyboardSetUnicodeString(stringLength:chunk.count,unicodeString:chunk);try keyPair(event,up,pid:w.app.processIdentifier)
                }
            case "paste":
                guard let text=command["text"] as? String,text.utf16.count<=20000 else { try fault("text-limit") }
                let root=AXUIElementCreateApplication(w.app.processIdentifier)
                guard let focusedElement=ax(root,kAXFocusedUIElementAttribute),CFGetTypeID(focusedElement)==AXUIElementGetTypeID(),str(focusedElement as! AXUIElement,kAXSubroleAttribute) != kAXSecureTextFieldSubrole else { try fault("secure-or-missing-input") }
                let board=NSPasteboard.general
                let (snapshot,previousCount)=try clipboardSnapshot(board)
                guard board.changeCount==previousCount else { try fault("clipboard-changed") }
                board.clearContents();guard board.setString(text,forType:.string) else { try fault("clipboard-write-failed") }
                let ownCount=board.changeCount
                defer {
                    if board.changeCount==ownCount {
                        board.clearContents()
                        let items=snapshot.map { values -> NSPasteboardItem in let item=NSPasteboardItem();for(type,data)in values{item.setData(data,forType:type)};return item }
                        board.writeObjects(items)
                    }
                }
                try focused(w);try key(9,.maskCommand,pid:w.app.processIdentifier);try await Task.sleep(nanoseconds:200_000_000)
            case "key":
                guard let name=command["key"] as? String else { try fault("invalid-key") }
                let codes:[String:CGKeyCode]=["a":0,"s":1,"c":8,"v":9,"x":7,"z":6,"f":3,"Return":36,"Tab":48,"Escape":53,"Backspace":51,"Space":49,"Left":123,"Right":124,"Down":125,"Up":126,"Home":115,"End":119]
                guard let code=codes[name] else { try fault("unsupported-key") }
                let modifiers=command["modifiers"] as? [String] ?? []
                guard modifiers.allSatisfy({["command","shift","option","control"].contains($0)}) else { try fault("unsupported-modifier") }
                var flags:CGEventFlags=[];for m in modifiers { flags.insert(m=="command" ? .maskCommand:m=="shift" ? .maskShift:m=="option" ? .maskAlternate:.maskControl) };try key(code,flags,pid:w.app.processIdentifier)
            case "scroll":
                let p=try point(command["point"],old.frame);try mouse(.mouseMoved,p,pid:w.app.processIdentifier)
                guard let dy=command["deltaY"] as? Int,abs(dy)<=1000,let dx=command["deltaX"] as? Int,abs(dx)<=1000,
                      let e=CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:2,wheel1:Int32(dy),wheel2:Int32(dx),wheel3:0) else { try fault("invalid-scroll") }
                e.location=p;try postForeground(e,pid:w.app.processIdentifier)
            case "drag":
                let from=try point(command["from"],old.frame),to=try point(command["to"],old.frame)
                try mouse(.leftMouseDown,from,pid:w.app.processIdentifier)
                defer { try? mouse(.leftMouseUp,to,pid:w.app.processIdentifier) }
                for i in 1...12 { try focused(w);let t=Double(i)/12;try mouse(.leftMouseDragged,CGPoint(x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t),pid:w.app.processIdentifier);try await Task.sleep(nanoseconds:15_000_000) }
            default:try fault("unsupported-command")
            }
            return ["status":"performed","actionId":actionId]
        } catch { return ["status":"unknown","actionId":actionId,"reason":(error as? DesktopFault)?.message ?? "native-action-failed"] }
    }
    static func request(_ method:String,_ args:[String:Any]) async throws -> Any {
        if method=="list" { return try discover() }
        if method=="permissions" {
            if args["request"] as? String=="accessibility" { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary) }
            if args["request"] as? String=="screen-recording" { _ = CGRequestScreenCaptureAccess() }
            return ["accessibility":AXIsProcessTrusted(),"screenRecording":CGPreflightScreenCaptureAccess()] }
        if method=="bind" {
            guard let id=args["windowId"] as? String,let w=windows[id],!w.app.isTerminated,w.app.launchDate==w.born else { try fault("window-changed") }
            selected=w;capturedWindowNumber=nil;binding=UUID().uuidString;expires=Date().addingTimeInterval(min(3600,max(10,(args["durationMs"] as? Double ?? 600000)/1000)));observation=nil;consumed.removeAll()
            return ["bindingId":binding!,"application":w.app.localizedName ?? "Application","title":w.title,"expiresAt":expires.timeIntervalSince1970*1000] as [String:Any]
        }
        guard args["bindingId"] as? String==binding,binding != nil else { try fault("binding-mismatch") }
        if method=="release" {selected=nil;binding=nil;observation=nil;return true}
        if method=="observe" {return try await observe(args)}
        if method=="readSelection" {return try readSelection(args)}
        if method=="act" {return try await act(args)}
        try fault("unsupported-method")
    }
    static func main() async {
        while let line=readLine() {
            guard line.utf8.count<256*1024,let data=line.data(using:.utf8),let raw=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let id=raw["rpc"] as? String,let method=raw["method"] as? String else {break}
            let result:Any
            do {result=try await request(method,raw["args"] as? [String:Any] ?? [:])}
            catch {result=["error":(error as? DesktopFault)?.message ?? "native-unavailable"]}
            guard let bytes=try? JSONSerialization.data(withJSONObject:["rpc":id,"reply":true,"result":result],options:[.sortedKeys]),let output=String(data:bytes,encoding:.utf8) else {break}
            print(output);fflush(stdout)
        }
    }
}
extension Collection {func chunked(_ size:Int)->[[Element]]{var out=[[Element]]();var batch=[Element]();for v in self{batch.append(v);if batch.count==size{out.append(batch);batch=[]}};if !batch.isEmpty{out.append(batch)};return out}}

func unicodeChunks(_ text:String)->[[UInt16]] {var result=[[UInt16]](),part=[UInt16]();for scalar in text.unicodeScalars{let units=Array(String(scalar).utf16);if part.count+units.count>100{result.append(part);part=[]};part+=units};if !part.isEmpty{result.append(part)};return result}
