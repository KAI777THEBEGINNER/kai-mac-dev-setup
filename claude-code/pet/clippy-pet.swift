#!/usr/bin/env swift
import Cocoa

// ── Configuration ──
let AssetsDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".claude/pet/assets/frames")
let SessionsDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".claude/sessions")
let StateFile = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".claude/pet/.state").path

let FrameSize = NSSize(width: 135, height: 125)

struct AnimConfig {
    let rows: [Int]
    let interval: TimeInterval
    let once: Bool
}

let Animations: [String: AnimConfig] = [
    "idle":  AnimConfig(rows: [0], interval: 0.9, once: false),
    "busy":  AnimConfig(rows: [4], interval: 0.18, once: false),
    "done":  AnimConfig(rows: [1], interval: 0.12, once: true),
    "gone":  AnimConfig(rows: [0], interval: 0.9, once: false),
]

// Rows available for random idle animations (look, wave, run, etc.)
let RandomIdleRows = [2, 3, 5, 6, 7, 8]

// ── Process Monitor ──
class ProcessMonitor {
    var timer: Timer?
    var onAlive: (() -> Void)?
    var onDead: (() -> Void)?
    var wasAlive = false

    func start() {
        check()
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            self.check()
        }
    }

    func check() {
        let alive = hasClaudeProcess()
        if alive && !wasAlive {
            wasAlive = true
            onAlive?()
        } else if !alive && wasAlive {
            wasAlive = false
            onDead?()
        }
    }

    func hasClaudeProcess() -> Bool {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: SessionsDir, includingPropertiesForKeys: nil
        ) else { return false }

        for url in files where url.pathExtension == "json" {
            guard let data = try? Data(contentsOf: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = json["pid"] as? Int32
            else { continue }
            if kill(pid, 0) == 0 { return true }
        }
        return false
    }
}

// ── State File Monitor (hook-driven, instant idle) ──
class StateFileMonitor {
    var lastContent = ""
    var lastMtime: TimeInterval = 0
    var timer: Timer?
    var onChange: ((String) -> Void)?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            self.check()
        }
    }

    func check() {
        guard FileManager.default.fileExists(atPath: StateFile) else { return }
        let attrs = try? FileManager.default.attributesOfItem(atPath: StateFile)
        let mtime = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        guard mtime > lastMtime else { return }

        guard let data = FileManager.default.contents(atPath: StateFile),
              let content = String(data: data, encoding: .utf8)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !content.isEmpty
        else { return }

        lastMtime = mtime
        if content != lastContent {
            lastContent = content
            onChange?(content)
        }
    }
}

// ── Session Monitor (aggregate, ignore pre-existing busy at startup) ──
class StateMonitor {
    var lastStatus = "gone"
    var timer: Timer?
    var onChange: ((String) -> Void)?
    // Session IDs that were already busy when pet launched; ignore until they go idle
    var ignoredBusySessions = Set<String>()

    func start() {
        scanInitialState()
        check()
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
            self.check()
        }
    }

    func scanInitialState() {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: SessionsDir, includingPropertiesForKeys: nil
        ) else { return }

        for url in files where url.pathExtension == "json" {
            guard let data = try? Data(contentsOf: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = json["pid"] as? Int32,
                  let sessionId = json["sessionId"] as? String
            else { continue }
            if kill(pid, 0) != 0 { continue }
            if json["status"] as? String == "busy" {
                ignoredBusySessions.insert(sessionId)
            }
        }
    }

    func check() {
        var anyNewBusy = false
        var anyAlive = false

        if let files = try? FileManager.default.contentsOfDirectory(
            at: SessionsDir, includingPropertiesForKeys: nil
        ) {
            for url in files where url.pathExtension == "json" {
                guard let data = try? Data(contentsOf: url),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let pid = json["pid"] as? Int32,
                      let sessionId = json["sessionId"] as? String
                else { continue }

                if kill(pid, 0) != 0 { continue }
                anyAlive = true

                let status = json["status"] as? String ?? "idle"
                if status == "busy" {
                    if ignoredBusySessions.contains(sessionId) {
                        // Pre-existing busy from startup, ignore
                    } else {
                        anyNewBusy = true
                    }
                } else {
                    // Once it goes idle, remove from ignored so next busy counts
                    ignoredBusySessions.remove(sessionId)
                }
            }
        }

        let newStatus = anyNewBusy ? "busy" : (anyAlive ? "idle" : "gone")

        if newStatus != lastStatus {
            lastStatus = newStatus
            onChange?(newStatus)
        }
    }
}

// ── Pet View ──
class PetView: NSView {
    private let imageView = NSImageView()
    private var currentFrames: [NSImage] = []
    private var frameIndex = 0
    private var animTimer: Timer?
    private var completionHandler: (() -> Void)?
    private var randomTimer: Timer?

    override init(frame: NSRect) {
        super.init(frame: frame)
        imageView.frame = bounds
        imageView.imageScaling = .scaleNone
        imageView.autoresizingMask = [.width, .height]
        addSubview(imageView)
    }

    required init?(coder: NSCoder) { fatalError() }

    func play(status: String) {
        randomTimer?.invalidate()
        randomTimer = nil

        let cfg: AnimConfig
        if status == "busy" {
            let busyRows = [4, 5, 6, 7, 8].filter { !loadRow($0).isEmpty }
            let row = busyRows.randomElement() ?? 4
            cfg = AnimConfig(rows: [row], interval: 0.18, once: false)
        } else {
            guard let c = Animations[status] else { return }
            cfg = c
        }

        let frames = cfg.rows.flatMap { loadRow($0) }
        guard !frames.isEmpty else { return }

        animTimer?.invalidate()
        currentFrames = frames
        frameIndex = 0
        completionHandler = cfg.once ? { self.play(status: "idle") } : nil
        showFrame()
        animTimer = Timer.scheduledTimer(withTimeInterval: cfg.interval, repeats: true) { _ in
            self.tick()
        }

        // Schedule random idle animations when in idle state
        if status == "idle" {
            scheduleRandomAnimation()
        }
    }

    private func scheduleRandomAnimation() {
        let delay = Double.random(in: 4...10)
        randomTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            self.playRandomAnimation()
        }
    }

    private func playRandomAnimation() {
        // Only play random animation if we're still effectively idle
        // (animTimer is running and not in the middle of a one-shot)
        guard completionHandler == nil else { return }

        let available = RandomIdleRows.filter { !loadRow($0).isEmpty }
        guard let row = available.randomElement() else {
            scheduleRandomAnimation()
            return
        }

        let frames = loadRow(row)
        guard !frames.isEmpty else {
            scheduleRandomAnimation()
            return
        }

        animTimer?.invalidate()
        currentFrames = frames
        frameIndex = 0
        showFrame()

        // Play through once then back to idle
        var idx = 0
        let interval = 0.15
        _ = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { t in
            idx += 1
            if idx >= frames.count {
                t.invalidate()
                self.play(status: "idle")
                return
            }
            self.frameIndex = idx
            self.showFrame()
        }
    }

    private func tick() {
        frameIndex += 1
        if frameIndex >= currentFrames.count {
            if let cb = completionHandler {
                animTimer?.invalidate()
                cb()
                return
            }
            frameIndex = 0
        }
        showFrame()
    }

    private func showFrame() {
        guard frameIndex < currentFrames.count else { return }
        imageView.image = currentFrames[frameIndex]
    }

    private func loadRow(_ row: Int) -> [NSImage] {
        var images: [NSImage] = []
        for col in 0..<8 {
            let url = AssetsDir.appendingPathComponent("r\(row)_c\(col).png")
            if FileManager.default.fileExists(atPath: url.path),
               let img = NSImage(contentsOf: url) {
                images.append(img)
            }
        }
        return images
    }

    // ── Drag ──
    private var dragStartWindow: NSPoint?
    private var dragStartMouse: NSPoint?

    override func mouseDown(with event: NSEvent) {
        dragStartWindow = window?.frame.origin
        dragStartMouse = NSEvent.mouseLocation
    }

    override func mouseDragged(with event: NSEvent) {
        guard let winStart = dragStartWindow, let mouseStart = dragStartMouse else { return }
        let cur = NSEvent.mouseLocation
        var newOrigin = NSPoint(
            x: winStart.x + (cur.x - mouseStart.x),
            y: winStart.y + (cur.y - mouseStart.y)
        )
        if let screen = window?.screen {
            let frame = screen.visibleFrame
            newOrigin.x = max(frame.minX, min(newOrigin.x, frame.maxX - FrameSize.width))
            newOrigin.y = max(frame.minY, min(newOrigin.y, frame.maxY - FrameSize.height))
        }
        window?.setFrameOrigin(newOrigin)
    }

    override func mouseUp(with event: NSEvent) {
        dragStartWindow = nil
        dragStartMouse = nil
        if let origin = window?.frame.origin {
            UserDefaults.standard.set(origin.x, forKey: "petPosX")
            UserDefaults.standard.set(origin.y, forKey: "petPosY")
        }
    }

    // ── Context Menu ──
    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu()
        menu.addItem(withTitle: "Quit", action: #selector(NSApp.terminate(_:)), keyEquivalent: "")
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }
}

// ── App Delegate ──
class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var monitor = StateMonitor()
    var fileMonitor = StateFileMonitor()
    var processMonitor = ProcessMonitor()
    var petView: PetView!

    func transition(to status: String) {
        if monitor.lastStatus == "busy" && status == "idle" {
            petView.play(status: "done")
        } else {
            petView.play(status: status)
        }
        monitor.lastStatus = status
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        // If no Claude Code process at startup, exit immediately
        guard processMonitor.hasClaudeProcess() else {
            NSApp.terminate(nil)
            return
        }
        processMonitor.wasAlive = true

        let rect = NSRect(origin: .zero, size: FrameSize)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.ignoresMouseEvents = false

        petView = PetView(frame: rect)
        window.contentView = petView

        let x = UserDefaults.standard.double(forKey: "petPosX")
        let y = UserDefaults.standard.double(forKey: "petPosY")
        if x != 0 || y != 0 {
            window.setFrameOrigin(NSPoint(x: x, y: y))
        } else if let screen = NSScreen.main {
            let f = screen.visibleFrame
            window.setFrameOrigin(NSPoint(x: f.maxX - 180, y: f.minY + 40))
        }

        window.makeKeyAndOrderFront(nil)

        // Process lifecycle binding
        processMonitor.onDead = {
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        processMonitor.start()

        // Hook-driven instant idle
        fileMonitor.onChange = { [weak self] status in
            DispatchQueue.main.async { self?.transition(to: status) }
        }
        fileMonitor.start()

        // Fallback: fast busy detection via session polling
        monitor.onChange = { [weak self] status in
            DispatchQueue.main.async { self?.transition(to: status) }
        }
        monitor.start()

        petView.play(status: "idle")
    }
}

// ── Entry ──
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
